"""Dev-only, cookie-free daily visitor estimates. Never return visitor hashes."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from ipaddress import ip_address
import json
import os
import secrets
import time
import uuid

import boto3

PREFIX = "daily-visitors:v1:"
_salts = {}


def canonical_ip(value):
    """CloudFront-Viewer-Address includes a port; exclude it from the identity."""
    if not isinstance(value, str) or len(value) > 100:
        return None
    value = value.strip()
    try:
        return str(ip_address(value))
    except ValueError:
        if value.startswith("[") and "]:" in value:
            value = value[1:value.index("]")]
        elif value.count(":") == 1:
            value = value.rsplit(":", 1)[0]
        else:
            return None
        try:
            return str(ip_address(value))
        except ValueError:
            return None


def request_identity(event):
    headers = {str(key).lower(): value for key, value in event.get("headers", {}).items()}
    if headers.get("sec-gpc") == "1" or headers.get("dnt") == "1":
        return None
    http = event.get("requestContext", {}).get("http", {})
    address = canonical_ip(http.get("sourceIp"))
    if not address:
        return None
    # CloudFront appends the viewer to XFF, after any spoofed client values.
    # API Gateway can append the edge address again. Never use the leftmost IP.
    if headers.get("x-amz-cf-id"):
        viewer = canonical_ip(headers.get("cloudfront-viewer-address"))
        forwarded = headers.get("x-forwarded-for", "")
        if not viewer and isinstance(forwarded, str) and len(forwarded) <= 4096:
            chain = forwarded.split(",")
            last = canonical_ip(chain[-1])
            viewer = canonical_ip(chain[-2]) if last == address and len(chain) > 1 else last
        if not viewer:
            return None  # Do not merge all visitors into a CloudFront edge IP.
        address = viewer
    agent = headers.get("user-agent", http.get("userAgent"))
    if not isinstance(agent, str) or not agent or len(agent) > 1024:
        return None
    return address, agent


def client():
    from botocore.config import Config  # Bundled in Lambda; local tests inject storage.
    return boto3.client("dynamodb", config=Config(connect_timeout=2, read_timeout=2,
                                                 retries={"total_max_attempts": 2}))


def get_item(db, table, key):
    return db.get_item(TableName=table, Key={"cacheKey": {"S": key}},
                       ConsistentRead=True).get("Item", {})


def record(event, now=None):
    table = os.environ.get("ADMIN_ANALYTICS_CACHE_TABLE")
    if os.environ.get("ENVIRONMENT") != "dev" or not table:
        return False
    identity = request_identity(event)
    if not identity:
        return False
    now = now or datetime.now(timezone.utc)
    day = now.astimezone(timezone.utc).date()
    stamp = day.isoformat()
    expiry = int(datetime.combine(day + timedelta(days=1), datetime.min.time(), timezone.utc).timestamp()) + 3600
    db = client()
    salt_key = (table, stamp)
    salt = _salts.get(salt_key)
    if salt is None:
        result = db.update_item(TableName=table, Key={"cacheKey": {"S": PREFIX + "salt:" + stamp}},
            UpdateExpression="SET salt = if_not_exists(salt, :salt), expiresAt = :ttl",
            ExpressionAttributeValues={":salt": {"S": secrets.token_hex(32)}, ":ttl": {"N": str(expiry)}},
            ReturnValues="ALL_NEW")
        salt = result["Attributes"]["salt"]["S"]
        _salts.clear()
        _salts[salt_key] = salt
    # Page, URL, account identifiers, cookies and authorization never enter this hash.
    digest = hmac.new(bytes.fromhex(salt), json.dumps([stamp, *identity]).encode(), hashlib.sha256).hexdigest()
    marker = PREFIX + "seen:" + stamp + ":" + digest
    if get_item(db, table, marker):
        return False
    retention = int(now.timestamp()) + 400 * 86400
    updates = [
        {"Update": {"TableName": table, "Key": {"cacheKey": {"S": marker}},
            "ConditionExpression": "attribute_not_exists(cacheKey)", "UpdateExpression": "SET expiresAt = :ttl",
            "ExpressionAttributeValues": {":ttl": {"N": str(expiry)}}}},
        {"Update": {"TableName": table, "Key": {"cacheKey": {"S": PREFIX + "count:" + stamp}},
            "UpdateExpression": "SET expiresAt = :ttl ADD visitorCount :one",
            "ExpressionAttributeValues": {":ttl": {"N": str(retention)}, ":one": {"N": "1"}}}},
        {"Update": {"TableName": table, "Key": {"cacheKey": {"S": PREFIX + "started"}},
            "UpdateExpression": "SET firstDay = if_not_exists(firstDay, :day)",
            "ExpressionAttributeValues": {":day": {"S": stamp}}}},
    ]
    token = str(uuid.uuid4())  # Stable across retries of an ambiguous response.
    for attempt in range(3):
        try:
            db.transact_write_items(TransactItems=updates, ClientRequestToken=token)
            return True
        except Exception as error:
            response = getattr(error, "response", {})
            reasons = response.get("CancellationReasons", [])
            if reasons and reasons[0].get("Code") == "ConditionalCheckFailed":
                return False  # Another request atomically counted this visitor.
            if not any(reason.get("Code") == "TransactionConflict" for reason in reasons) or attempt == 2:
                raise
            time.sleep(0.05 * (attempt + 1))
    return False


def report(start, end):
    """Aggregates only. Unknown historical days stay null, never invented zeros."""
    if os.environ.get("ENVIRONMENT") != "dev":
        raise ValueError("Daily visitors are dev only")
    table = os.environ["ADMIN_ANALYTICS_CACHE_TABLE"]
    db = client()
    started = get_item(db, table, PREFIX + "started").get("firstDay", {}).get("S")
    days = [start + timedelta(days=index) for index in range((end - start).days + 1)]
    def read(day):
        stamp = day.isoformat()
        if not started or stamp < started:
            return {"day": stamp, "visitors": None}
        item = get_item(db, table, PREFIX + "count:" + stamp)
        return {"day": stamp, "visitors": int(item.get("visitorCount", {"N": "0"})["N"])}
    with ThreadPoolExecutor(max_workers=4) as executor:
        return list(executor.map(read, days))

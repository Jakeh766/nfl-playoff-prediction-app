"""Private reports. Only API Gateway-verified Cognito admin claims are trusted."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import json
import math
import os
import re
import time
import uuid
from urllib.error import HTTPError

import boto3

from analytics_providers import PROVIDERS, NotConfigured

NAMES = {"custom": "PredictPlayoffs activity", "goatcounter": "Traffic",
         "search-console": "Google Search", "seasons": "Season activity"}
_config = None
_config_until = 0


def response(status, payload):
    return {"statusCode": status, "headers": {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store", "Vary": "Authorization",
        "X-Content-Type-Options": "nosniff"}, "body": json.dumps(payload, allow_nan=False)}


def authorize(event):
    # Signature, kid, issuer, audience and JWT times are checked by the existing
    # API Gateway JWT authorizer, on EVERY admin route. Never decode a raw header.
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
    if not isinstance(claims, dict):
        return 401
    try:
        client = claims.get("aud") if claims.get("token_use") == "id" else claims.get("client_id")
        expiration, issued = float(claims["exp"]), float(claims["iat"])
        if (claims.get("iss") != os.environ["ADMIN_COGNITO_ISSUER"] or
                client != os.environ["ADMIN_COGNITO_CLIENT_ID"] or
                not os.environ["ADMIN_COGNITO_ISSUER"] or not os.environ["ADMIN_COGNITO_CLIENT_ID"] or
                claims.get("token_use") not in {"access", "id"} or
                not isinstance(claims.get("sub"), str) or not claims["sub"] or
                not math.isfinite(expiration) or not math.isfinite(issued) or
                expiration <= time.time() or issued < 0 or issued > time.time() + 30):
            return 401
    except (KeyError, TypeError, ValueError):
        return 401
    groups = claims.get("cognito:groups", [])
    if isinstance(groups, str):
        try:
            groups = json.loads(groups)
        except ValueError:
            # HTTP API authorizer stringifies some array claims as [admin,other].
            groups = (groups[1:-1] if groups.startswith("[") and groups.endswith("]") else groups).split(",")
            groups = [group.strip() for group in groups]
    return 200 if isinstance(groups, list) and "admin" in groups else 403


def date_range(params):
    today = datetime.now(timezone.utc).date()
    end = today - timedelta(days=1)
    start = end - timedelta(days=27)
    if set(params) - {"start", "end"}:
        raise ValueError("Only start and end date parameters are supported.")
    if bool(params.get("start")) != bool(params.get("end")):
        raise ValueError("Choose both a start date and an end date.")
    if params.get("start"):
        if any(not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(params[key])) for key in ("start", "end")):
            raise ValueError("Dates must use YYYY-MM-DD.")
        try:
            start, end = date.fromisoformat(params["start"]), date.fromisoformat(params["end"])
        except ValueError:
            raise ValueError("Choose valid calendar dates.") from None
    if end < start or end > today or (end - start).days > 92 or start < today - timedelta(days=365):
        raise ValueError("Choose up to 93 days within the past year, ending no later than today.")
    return start, end


def settings():
    global _config, _config_until
    if _config is not None and time.time() < _config_until:
        return _config
    try:
        result = boto3.client("ssm").get_parameter(
            Name=os.environ["ADMIN_ANALYTICS_CONFIG_PARAMETER"], WithDecryption=True)
        config = json.loads(result["Parameter"]["Value"])
        if not isinstance(config, dict):
            raise ValueError("Invalid config")
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") != "ParameterNotFound":
            raise
        config = {}
    _config, _config_until = config, time.time() + 300
    return config


def cached_report(provider, start, end):
    # DynamoDB cache and leases work across Lambda containers. Authorization is
    # already checked; provider responses never live in public/CDN/browser caches.
    table = boto3.resource("dynamodb").Table(os.environ["ADMIN_ANALYTICS_CACHE_TABLE"])
    version = "v6" if provider == "custom" else "v7" if provider == "goatcounter" else "v4"
    key = "v2:seasons:all" if provider == "seasons" else f"{version}:{provider}:{start}:{end}"
    now = int(time.time())
    item = table.get_item(Key={"cacheKey": key}, ConsistentRead=True).get("Item", {})
    if int(item.get("freshUntil", 0)) > now and item.get("report"):
        result = json.loads(item["report"])
        result["cached"] = True
        return result
    owner = str(uuid.uuid4())
    try:
        table.update_item(Key={"cacheKey": key},
                          UpdateExpression="SET leaseUntil = :lease, leaseOwner = :owner, expiresAt = :ttl",
                          ConditionExpression="attribute_not_exists(leaseUntil) OR leaseUntil < :now",
                          ExpressionAttributeValues={":lease": now + 30, ":owner": owner,
                                                     ":now": now, ":ttl": now + 172800})
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        return {"provider": provider, "name": NAMES[provider], "status": "updating",
                "message": "This report is being refreshed. Try again in a moment.",
                "metrics": [], "tables": []}
    result = {"provider": provider, "name": NAMES[provider], "status": "ok", "cached": False,
              "fetchedAt": datetime.now(timezone.utc).isoformat(),
              "range": {"start": start.isoformat(), "end": end.isoformat(), "timezone": "UTC"}}
    ttl = 900
    try:
        config = {} if provider in {"custom", "seasons"} else settings()
        report = PROVIDERS[provider](config, start, end)
        if provider == "goatcounter":
            # Pending exports need a short retry, not the normal 15-minute cache.
            ttl = min(900, max(30, int(report.pop("_cache_seconds", 900))))
        result.update(report)
    except NotConfigured:
        result.update(status="not_configured", message="Connect this provider using the admin analytics setup guide.",
                      metrics=[], tables=[])
        ttl = 300
    except Exception as error:
        # Only allowlisted provider names and fixed status codes; never exception
        # text, requests, credentials, URLs or application records.
        code = getattr(error, "response", {}).get("Error", {}).get("Code")
        reason = code if code in {"AccessDeniedException", "ProvisionedThroughputExceededException"} else "report_failed"
        if isinstance(error, HTTPError) and type(error.code) is int and 100 <= error.code <= 599:
            reason = f"HTTP_{error.code}"
        print(json.dumps({"type": "admin_analytics_error", "provider": provider, "reason": reason}))
        # Provider bodies/errors can contain tokens, user data, or signed URLs.
        # No exception text is sent to the browser or written to logs.
        result.update(status="unavailable", message="This provider is unavailable. Check its credentials and permissions, then try again later.",
                      metrics=[], tables=[])
        ttl = 300
    table.update_item(Key={"cacheKey": key},
                      UpdateExpression="SET report = :report, freshUntil = :fresh, expiresAt = :ttl REMOVE leaseUntil, leaseOwner",
                      ConditionExpression="leaseOwner = :owner",
                      ExpressionAttributeValues={":report": json.dumps(result, allow_nan=False), ":fresh": now + ttl,
                                                 ":ttl": now + 172800, ":owner": owner})
    return result


def handler(event, _context):
    environment = os.environ.get("ENVIRONMENT")
    if environment not in {"dev", "prod"}:
        return response(404, {"message": "Not found"})
    status = authorize(event)
    if status != 200:
        return response(status, {"message": "Admin membership required" if status == 403 else "Authentication required"})
    path = event.get("rawPath", "")
    if event.get("requestContext", {}).get("http", {}).get("method") != "GET":
        return response(404, {"message": "Not found"})
    try:
        start, end = date_range(event.get("queryStringParameters") or {})
    except ValueError as error:
        return response(400, {"message": str(error)})
    if path == "/api/admin/analytics":
        return response(200, {"environment": environment, "providers": list(NAMES),
                              "range": {"start": str(start), "end": str(end), "timezone": "UTC"}})
    provider = path.removeprefix("/api/admin/analytics/")
    if provider not in NAMES:
        return response(404, {"message": "Not found"})
    try:
        return response(200, cached_report(provider, start, end))
    except Exception:
        return response(503, {"message": "Report storage is unavailable. Try again later."})

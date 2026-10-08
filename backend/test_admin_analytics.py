"""Authorization, caching, provider contracts and deployment guards."""
import importlib
from datetime import date, timedelta
import json
import os
from pathlib import Path
import sys
import time
import types
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend/lambda"))
sys.modules.setdefault("boto3", types.SimpleNamespace(resource=lambda _name: None))
admin = importlib.import_module("admin_analytics")
providers = importlib.import_module("analytics_providers")

ENV = {"ENVIRONMENT": "dev", "ADMIN_COGNITO_ISSUER": "https://cognito-idp.us-east-1.amazonaws.com/dev-pool",
       "ADMIN_COGNITO_CLIENT_ID": "dev-client", "ADMIN_ANALYTICS_CACHE_TABLE": "dev-cache",
       "ADMIN_ANALYTICS_CONFIG_PARAMETER": "/dev/admin-analytics/config",
       "ADMIN_GOOGLE_CREDENTIALS_PARAMETER": "/dev/admin-analytics/google-service-account",
       "ADMIN_ANALYTICS_LOG_GROUP": "/aws/lambda/dev-backend"}


def event(provider="", groups=None, **overrides):
    claims = {"iss": ENV["ADMIN_COGNITO_ISSUER"], "client_id": "dev-client", "token_use": "access",
              "sub": "admin-user", "exp": time.time() + 3600, "iat": time.time() - 10,
              "cognito:groups": ["admin"] if groups is None else groups, **overrides}
    return {"rawPath": "/api/admin/analytics" + (f"/{provider}" if provider else ""),
            "requestContext": {"http": {"method": "GET"}, "authorizer": {"jwt": {"claims": claims}}},
            "queryStringParameters": {"start": str(date.today() - timedelta(days=7)),
                                      "end": str(date.today() - timedelta(days=1))}}


class ConditionalFailure(Exception):
    response = {"Error": {"Code": "ConditionalCheckFailedException"}}


class FakeCache:
    def __init__(self):
        self.items = {}

    def get_item(self, Key, **_kwargs):
        return {"Item": self.items.get(Key["cacheKey"], {}).copy()}

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues, **_kwargs):
        item = self.items.setdefault(Key["cacheKey"], {})
        values = ExpressionAttributeValues
        if ":lease" in values:
            if item.get("leaseUntil", 0) >= values[":now"]:
                raise ConditionalFailure()
            item.update(leaseUntil=values[":lease"], leaseOwner=values[":owner"], expiresAt=values[":ttl"])
        else:
            if item.get("leaseOwner") != values[":owner"]:
                raise ConditionalFailure()
            item.update(report=values[":report"], freshUntil=values[":fresh"], expiresAt=values[":ttl"])
            item.pop("leaseUntil", None)
            item.pop("leaseOwner", None)


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, ENV)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        admin._config, admin._config_until = None, 0
        self.cache = FakeCache()
        self.resource = patch.object(admin.boto3, "resource", return_value=types.SimpleNamespace(Table=lambda _name: self.cache))
        self.resource.start()
        self.addCleanup(self.resource.stop)

    def test_exact_admin_groups_and_gateway_string_formats(self):
        for groups in (["admin"], ["member", "admin"], '["admin","member"]', "[admin, member]", "admin"):
            self.assertEqual(admin.handler(event(groups=groups), None)["statusCode"], 200, groups)
        for groups in ([], ["administrator"], ["not-admin"], '[[admin]]', "[notadmin]", '["superadmin"]', {}, 123):
            with patch.object(admin, "cached_report") as report:
                self.assertEqual(admin.handler(event("custom", groups), None)["statusCode"], 403, groups)
                report.assert_not_called()

    def test_application_dispatch_rejects_non_admins_on_every_analytics_route(self):
        application = importlib.import_module("app")
        for provider in ["", *admin.NAMES]:
            with patch.object(admin, "cached_report") as report:
                self.assertEqual(application.handler(event(provider, ["member"]), None)["statusCode"], 403)
                report.assert_not_called()

    def test_invalid_or_missing_verified_jwt_claims_fail_before_cache_or_providers(self):
        for changes in ({"exp": time.time() - 1}, {"exp": "NaN"}, {"iat": "Infinity"},
                        {"iat": time.time() + 3600}, {"iss": "https://attacker.example/pool"},
                        {"client_id": "other-client"}, {"token_use": "other"}, {"sub": ""}):
            with patch.object(admin, "cached_report") as report:
                self.assertEqual(admin.handler(event("goatcounter", **changes), None)["statusCode"], 401)
                report.assert_not_called()
        forged = event("custom")
        forged["requestContext"].pop("authorizer")
        forged["headers"] = {"Authorization": "Bearer forged.admin.token", "cognito:groups": "admin"}
        self.assertEqual(admin.handler(forged, None)["statusCode"], 401)
        valid_id = event(token_use="id", aud="dev-client")
        self.assertEqual(admin.handler(valid_id, None)["statusCode"], 200)

    def test_every_endpoint_requires_admin_including_unknown_or_wrong_method(self):
        for provider in ["", *admin.NAMES, "unknown"]:
            request = event(provider, ["member"])
            self.assertEqual(admin.handler(request, None)["statusCode"], 403)
            request["requestContext"]["http"]["method"] = "POST"
            self.assertEqual(admin.handler(request, None)["statusCode"], 403)
        with patch.dict(os.environ, {"ENVIRONMENT": "unknown"}), patch.object(admin, "cached_report") as report:
            self.assertEqual(admin.handler(event("custom"), None)["statusCode"], 404)
            report.assert_not_called()

    def test_production_authorization_is_pool_specific_before_any_report_access(self):
        application = importlib.import_module("app")
        prod = {**ENV, "ENVIRONMENT": "prod", "ADMIN_COGNITO_ISSUER": "https://cognito-idp.us-east-1.amazonaws.com/prod-pool",
                "ADMIN_COGNITO_CLIENT_ID": "prod-client"}
        with patch.dict(os.environ, prod), patch.object(admin, "cached_report", return_value={"metrics": []}) as report:
            for provider in ["", *admin.NAMES, "unknown"]:
                valid = event(provider, iss=prod["ADMIN_COGNITO_ISSUER"], client_id="prod-client")
                member = event(provider, ["member"], iss=prod["ADMIN_COGNITO_ISSUER"], client_id="prod-client")
                self.assertEqual(application.handler(member, None)["statusCode"], 403)
                self.assertEqual(application.handler(event(provider), None)["statusCode"], 401)
                unsigned = event(provider)
                unsigned["requestContext"].pop("authorizer")
                unsigned["headers"] = {"Authorization": "Bearer forged-admin-token"}
                self.assertEqual(application.handler(unsigned, None)["statusCode"], 401)
                report.assert_not_called()
                result = application.handler(valid, None)
                self.assertEqual(result["statusCode"], 404 if provider == "unknown" else 200)
                self.assertEqual(result["headers"]["Cache-Control"], "private, no-store")
                if not provider:
                    self.assertEqual(json.loads(result["body"])["environment"], "prod")
                elif provider == "goatcounter":
                    self.assertEqual(json.loads(result["body"])["status"], "unavailable")
                    report.assert_not_called()
                elif provider in admin.NAMES:
                    report.assert_called_once()
                report.reset_mock()

    def test_production_traffic_does_not_read_cache_config_or_call_provider(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "prod"}), patch.object(admin, "cached_report") as report, \
                patch.object(admin, "settings") as settings:
            result = admin.handler(event("goatcounter"), None)
            self.assertEqual(result["statusCode"], 200)
            self.assertIn("collection is disabled", result["body"])
            report.assert_not_called()
            settings.assert_not_called()

    def test_date_ranges_are_bounded_and_cannot_be_used_for_query_injection(self):
        for params in ({"start": "2026-01-01"}, {"start": "2026-02-30", "end": "2026-03-01"},
                       {"start": "2025-01-01", "end": "2026-10-04"}, {"start": "2026-12-01", "end": "2026-10-01"},
                       {"start": "2099-01-01", "end": "2099-01-02"}, {"start": "|filter secret", "end": "2026-10-01"},
                       {"provider_url": "https://attacker.example"}):
            request = event("custom")
            request["queryStringParameters"] = params
            with patch.object(admin, "cached_report") as report:
                self.assertEqual(admin.handler(request, None)["statusCode"], 400, params)
                report.assert_not_called()

    def test_cached_reports_do_not_bypass_authorization_and_have_private_headers(self):
        with patch.dict(admin.PROVIDERS, custom=Mock(return_value={"metrics": [], "tables": []})):
            first = admin.handler(event("custom"), None)
            second = admin.handler(event("custom"), None)
            self.assertEqual(first["statusCode"], 200)
            self.assertFalse(json.loads(first["body"])["cached"])
            self.assertTrue(json.loads(second["body"])["cached"])
            self.assertEqual(admin.PROVIDERS["custom"].call_count, 1)
            denied = admin.handler(event("custom", ["member"]), None)
            self.assertEqual(denied["statusCode"], 403)
            self.assertNotIn("metrics", json.loads(denied["body"]))
            self.assertEqual(first["headers"]["Cache-Control"], "private, no-store")
            self.assertEqual(first["headers"]["Vary"], "Authorization")

    def test_provider_failure_does_not_expose_secret_error_or_break_other_provider(self):
        with patch.object(admin, "settings", return_value={"token": "super-secret"}), patch.dict(admin.PROVIDERS,
             goatcounter=Mock(side_effect=RuntimeError("super-secret private@example.org")),
             custom=Mock(return_value={"metrics": [], "tables": []})):
            result = admin.handler(event("goatcounter"), None)
            self.assertEqual(json.loads(result["body"])["status"], "unavailable")
            self.assertNotIn("super-secret", result["body"])
            self.assertNotIn("private@example.org", result["body"])
            self.assertEqual(admin.handler(event("custom"), None)["statusCode"], 200)
            self.assertEqual(json.loads(admin.handler(event("goatcounter"), None)["body"])["cached"], True)

    def test_cache_lease_prevents_concurrent_provider_requests(self):
        request = event("custom")
        params = request["queryStringParameters"]
        self.cache.items[f"v6:custom:{params['start']}:{params['end']}"] = {"leaseUntil": time.time() + 20}
        with patch.dict(admin.PROVIDERS, custom=Mock()) as adapter:
            result = admin.handler(request, None)
            self.assertEqual(json.loads(result["body"])["status"], "updating")
            adapter["custom"].assert_not_called()

    def test_season_cache_is_shared_across_date_ranges_without_provider_credentials(self):
        adapter = Mock(return_value={"metrics": [], "tables": [],
                                     "range": {"window": "All retained seasons", "timezone": "Season totals"}})
        with patch.dict(admin.PROVIDERS, seasons=adapter), patch.object(admin, "settings") as settings:
            first = json.loads(admin.handler(event("seasons"), None)["body"])
            request = event("seasons")
            request["queryStringParameters"] = {"start": str(date.today() - timedelta(days=28)),
                                                "end": str(date.today() - timedelta(days=1))}
            second = json.loads(admin.handler(request, None)["body"])
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(second["range"]["window"], "All retained seasons")
        adapter.assert_called_once()
        settings.assert_not_called()

    def test_cache_expiry_and_missing_configuration(self):
        with patch.object(admin, "settings", return_value={}), patch.dict(admin.PROVIDERS,
             goatcounter=Mock(side_effect=providers.NotConfigured)):
            result = admin.handler(event("goatcounter"), None)
            self.assertEqual(json.loads(result["body"])["status"], "not_configured")
            next(iter(self.cache.items.values()))["freshUntil"] = 0
            admin.handler(event("goatcounter"), None)
            self.assertEqual(admin.PROVIDERS["goatcounter"].call_count, 2)

    def test_pending_goatcounter_export_short_cache_hint_is_internal_and_admin_only(self):
        adapter = Mock(return_value={"metrics": [{"label": "Distinct visitors (GoatCounter sessions)",
                                                 "value": None}], "tables": [], "_cache_seconds": 30})
        with patch.object(admin, "settings", return_value={}), patch.dict(admin.PROVIDERS, goatcounter=adapter):
            self.assertEqual(admin.handler(event("goatcounter", ["member"]), None)["statusCode"], 403)
            adapter.assert_not_called()
            result = admin.handler(event("goatcounter"), None)
            self.assertEqual(json.loads(result["body"])["status"], "ok")
            self.assertNotIn("_cache_seconds", result["body"])
            cached = next(iter(self.cache.items.values()))
            self.assertNotIn("_cache_seconds", cached["report"])
            self.assertLessEqual(cached["freshUntil"] - int(time.time()), 30)


class ProviderTests(unittest.TestCase):
    start, end = date(2026, 10, 1), date(2026, 10, 4)

    def setUp(self):
        environment = patch.dict(os.environ, ENV)
        environment.start()
        self.addCleanup(environment.stop)
        active = patch.object(providers.engagement, "report", return_value={"value": None, "daily": {}, "rows": []})
        self.active = active.start()
        self.addCleanup(active.stop)

    def test_engagement_total_daily_and_page_breakdown_and_isolated_failure(self):
        self.active.return_value = {"value": 125, "daily": {"2026-10-02": 125},
                                    "rows": [{"page": "Leaderboard", "sport": "NBA", "seconds": 125}]}
        with patch.object(providers, "cloudwatch_query", return_value=[]):
            result = providers.custom({}, self.start, self.end)
            self.assertEqual(len(result["metrics"]), 14)
            self.assertEqual(result["engagement"]["value"], 125)
            self.assertEqual(result["engagement"]["format"], "seconds")
            self.assertEqual([row["active_time"] for row in result["tables"][0]["rows"]], [None, 125, None, None])
            self.assertEqual(result["tables"][-1]["rows"], self.active.return_value["rows"])
            self.active.side_effect = RuntimeError("secret must not escape")
            result = providers.custom({}, self.start, self.end)
            self.assertEqual(len(result["metrics"]), 14)
            self.assertIsNone(result["engagement"]["value"])
            self.assertNotIn("secret", json.dumps(result))

    def test_activity_daily_totals_types_and_historical_events(self):
        rows = [{"day": "2026-10-01 00:00:00.000", "event": "bracket_created", "bracketType": "nba", "count": "2"},
                {"day": "2026-10-02 00:00:00.000", "event": "bracket_started", "bracketType": "unknown", "count": "3"},
                {"day": "2026-10-02 00:00:00.000", "event": "account_deleted", "count": "1"},
                {"day": "2026-10-01", "event": "group_invite_joined", "count": "4"},
                {"day": "2026-10-01", "event": "page_view", "count": "900"}]
        with patch.object(providers, "cloudwatch_query", return_value=rows) as query:
            result = providers.custom({}, self.start, self.end)
        self.assertEqual(query.call_count, 1)
        metrics = {item["label"]: item["value"] for item in result["metrics"]}
        self.assertEqual(metrics["Brackets created"], 5)
        self.assertEqual(metrics["Accounts deleted"], 1)
        self.assertEqual(metrics["Invite joins"], 4)
        days = result["tables"][0]["rows"]
        self.assertEqual(len(days), 4)
        self.assertEqual([row["total"] for row in days], [6, 4, 0, 0])
        self.assertEqual(days[-1]["cumulative"], 10)
        kinds = {row["bracketType"]: row for row in result["tables"][1]["rows"]}
        self.assertEqual(kinds["NBA"]["bracket_created"], 2)
        self.assertEqual(kinds["Historical / unknown"]["bracket_created"], 3)

    def test_activity_queries_own_environment_and_prod_never_reads_engagement(self):
        for environment in ("dev", "prod"):
            self.active.reset_mock()
            with patch.dict(os.environ, {"ENVIRONMENT": environment}), patch.object(providers, "cloudwatch_query", return_value=[]) as query:
                report = providers.custom({}, self.start, self.end)
                self.assertIn(f'environment = "{environment}"', query.call_args.args[0])
                self.assertIn(f"AWS · {environment}", report["note"])
                if environment == "prod":
                    self.active.assert_not_called()
                    self.assertIsNone(report["engagement"]["value"])
                    self.assertIn("collection is disabled", report["engagement"]["note"])
                    self.assertEqual(report["tables"][-1]["rows"], [])
                else:
                    self.active.assert_called_once()
        with patch.dict(os.environ, {"ENVIRONMENT": 'dev" | filter true'}), patch.object(providers, "cloudwatch_query") as query:
            with self.assertRaises(ValueError):
                providers.custom({}, self.start, self.end)
            query.assert_not_called()

    def test_production_search_is_restricted_to_production_hosts_on_every_query(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "prod"}), patch.object(providers, "google_token", return_value="server-only") as token, \
                patch.object(providers, "http_json", return_value={}) as http:
            for site in ("sc-domain:dev.predictplayoffs.com", "https://dev.example.com/", "sc-domain:other.com"):
                with self.assertRaises(ValueError):
                    providers.search_console({"search_console": {"site_url": site}}, self.start, self.end)
                token.assert_not_called()
                http.assert_not_called()
            for site in ("sc-domain:predictplayoffs.com", "https://predictplayoffs.com/"):
                http.reset_mock()
                providers.search_console({"search_console": {"site_url": site}}, self.start, self.end)
                self.assertEqual(http.call_count, 6)
                for call in http.call_args_list:
                    filters = call.args[2]["dimensionFilterGroups"][0]["filters"]
                    self.assertEqual(filters, [{"dimension": "page", "operator": "includingRegex",
                                               "expression": r"^https://(www\.)?predictplayoffs\.com/"}])

    def test_production_goatcounter_adapter_cannot_call_dev_provider(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "prod"}), patch.object(providers, "http_json") as http:
            with self.assertRaises(providers.NotConfigured):
                providers.goatcounter({"goatcounter": {"site": "predictplayoffs", "token": "test-token"}}, self.start, self.end)
            http.assert_not_called()

    def test_search_totals_daily_and_all_breakdowns(self):
        def answer(url, token, body):
            self.assertEqual(token, "SERVER-SECRET")
            self.assertEqual(body["dataState"], "final")
            dimension = (body.get("dimensions") or [None])[0]
            entry = {"clicks": 10, "impressions": 200, "ctr": .05, "position": 3.2}
            if dimension is not None:
                entry["keys"] = [{"date": "2026-10-01", "page": "https://example.org/picks?invite=PRIVATE"}.get(dimension, "test")]
            return {"rows": [entry]}
        with patch.object(providers, "google_token", return_value="SERVER-SECRET"), patch.object(providers, "http_json", side_effect=answer) as http:
            result = providers.search_console({"search_console": {"site_url": "sc-domain:example.org"}}, self.start, self.end)
        self.assertEqual(http.call_count, 6)
        self.assertEqual({tuple(call.args[2].get("dimensions", [])) for call in http.call_args_list},
                         {(), ("date",), ("query",), ("page",), ("country",), ("device",)})
        self.assertEqual(result["metrics"][2]["value"], .05)
        self.assertEqual(result["metrics"][3]["value"], 3.2)
        self.assertEqual(result["tables"][0]["rows"][0]["cumulative"], 10)
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertNotIn("SERVER-SECRET", json.dumps(result))

    def test_goatcounter_fallback_is_not_mislabeled_pageviews(self):
        def answer(url, token):
            return {"total": 5, "total_events": 1} if "/total?" in url else {"hits": [{"path": "/", "count": 4}, {"path": "/private?secret", "count": 100}]}
        with patch.object(providers, "http_json", side_effect=answer):
            report = providers.goatcounter({"goatcounter": {"token": "secret"}}, self.start, self.end)
        values = {item["label"]: item["value"] for item in report["metrics"]}
        self.assertEqual(values["Unique visits per page"], 4)
        self.assertIsNone(values["Pageviews"])
        self.assertIsNone(values["Distinct visitors / sessions"])
        self.assertNotIn("private", json.dumps(report))

    def test_google_service_account_uses_only_readonly_scopes_and_fixed_token_endpoint(self):
        # Exercise the real Google library's constructor contract, no network.
        try:
            from google.auth import crypt
            from google.oauth2 import service_account
        except ImportError:
            self.skipTest("Dev Google provider dependencies are not installed in this checkout")
        self.assertTrue(callable(crypt.RSASigner.from_string))
        fake = Mock(valid=False, token="server-only")
        parameter = Mock()
        parameter.get_parameter.return_value = {"Parameter": {"Value": json.dumps({
            "client_email": "analytics@example.iam.gserviceaccount.com", "private_key": "test-key",
            "token_uri": "https://attacker.invalid"})}}
        providers._google_credentials.clear()
        with patch.object(providers.boto3, "client", return_value=parameter, create=True), patch.object(service_account.Credentials, "from_service_account_info", return_value=fake) as constructor:
            self.assertEqual(providers.google_token(), "server-only")
        info = constructor.call_args.args[0]
        self.assertEqual(info["token_uri"], "https://oauth2.googleapis.com/token")
        self.assertEqual(constructor.call_args.kwargs["scopes"], ["https://www.googleapis.com/auth/webmasters.readonly"])
        self.assertTrue(parameter.get_parameter.call_args.kwargs["WithDecryption"])
        fake.refresh.assert_called_once()

    def test_http_redirects_do_not_forward_provider_credentials(self):
        with self.assertRaises(ValueError):
            providers.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://attacker.example")


class DeploymentTests(unittest.TestCase):
    def test_bootstrap_additions_are_scoped_without_membership_or_data_access(self):
        config = (ROOT / "terraform/bootstrap/main.tf").read_text()
        group = config.split('sid = "ManageProdCognitoGroups"', 1)[1].split('\n  statement {', 1)[0]
        self.assertIn('userpool/*', group)
        self.assertIn('aws:ResourceTag/Project', group)
        self.assertIn('aws:ResourceTag/Environment', group)
        self.assertIn('values   = ["prod"]', group)
        for operation in ("CreateGroup", "GetGroup", "UpdateGroup", "DeleteGroup"):
            self.assertIn(f'"cognito-idp:{operation}"', group)
        self.assertNotIn("AdminAddUserToGroup", group)
        self.assertNotIn("AdminRemoveUserFromGroup", group)
        cache = config.split('sid = "ProdAdminAnalyticsCache"', 1)[1].split('\n  statement {', 1)[0]
        self.assertIn('table/${var.project_name}-admin-analytics-cache', cache)
        for forbidden in ('"dynamodb:*"', "GetItem", "Scan", "Query", "PutItem", "ssm:"):
            self.assertNotIn(forbidden, cache)
        for operation in ("CreateTable", "DescribeTable", "DescribeTimeToLive", "UpdateTimeToLive", "ListTagsOfResource"):
            self.assertIn(f'"dynamodb:{operation}"', cache)

    def test_admin_routes_use_native_cognito_jwt_authorizer_and_no_public_tracking_scripts(self):
        config = (ROOT / "terraform/modules/app/admin-analytics.tf").read_text()
        self.assertIn('"GET /api/admin/analytics/{provider}"', config)
        self.assertIn('authorization_type = "JWT"', config)
        self.assertIn('authorizer_id      = aws_apigatewayv2_authorizer.cognito.id', config)
        self.assertNotIn('var.environment == "dev"', config)
        self.assertIn('count        = 1', config)
        self.assertIn('name         = "admin"', config)
        self.assertNotIn('"ssm:*"', config)
        page = (ROOT / "frontend/admin-analytics.html").read_text()
        self.assertIn('name="robots" content="noindex,nofollow"', page)
        self.assertIn('id="analytics-main" class="analytics-main" hidden', page)
        self.assertNotIn('/goatcounter.js', page)
        self.assertNotIn('/monitoring.js', page)
        self.assertNotIn('src="/analytics.js', page)
        for environment in ("dev", "prod"):
            workflow = (ROOT / f".github/workflows/deploy-{environment}.yml").read_text()
            self.assertIn('--target backend/lambda/vendor', workflow)
            self.assertIn('--python-version 3.12', workflow)
        self.assertNotIn("seed_dev.py", workflow)


if __name__ == "__main__":
    unittest.main()

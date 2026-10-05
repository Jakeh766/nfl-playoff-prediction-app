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
        with patch.dict(os.environ, {"ENVIRONMENT": "prod"}), patch.object(admin, "cached_report") as report:
            self.assertEqual(admin.handler(event("custom"), None)["statusCode"], 404)
            report.assert_not_called()

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

    def test_clarity_uses_one_shared_six_hour_cache_even_when_dates_change_or_api_fails(self):
        for error in (False, True):
            self.cache.items.clear()
            fake = Mock(side_effect=RuntimeError("token") if error else None,
                        return_value={"metrics": [], "tables": []})
            with patch.object(admin, "settings", return_value={}), patch.dict(admin.PROVIDERS, clarity=fake):
                first = event("clarity")
                self.assertEqual(admin.handler(first, None)["statusCode"], 200)
                second = event("clarity")
                second["queryStringParameters"]["start"] = str(date.today() - timedelta(days=28))
                self.assertTrue(json.loads(admin.handler(second, None)["body"])["cached"])
                self.assertEqual(fake.call_count, 1)
                cached = next(iter(self.cache.items.values()))
                self.assertGreater(cached["freshUntil"] - int(time.time()), 21500)

    def test_cache_lease_prevents_concurrent_provider_requests(self):
        request = event("custom")
        params = request["queryStringParameters"]
        self.cache.items[f"v1:custom:{params['start']}:{params['end']}"] = {"leaseUntil": time.time() + 20}
        with patch.dict(admin.PROVIDERS, custom=Mock()) as adapter:
            result = admin.handler(request, None)
            self.assertEqual(json.loads(result["body"])["status"], "updating")
            adapter["custom"].assert_not_called()

    def test_cache_expiry_and_missing_configuration(self):
        with patch.object(admin, "settings", return_value={}), patch.dict(admin.PROVIDERS,
             ga4=Mock(side_effect=providers.NotConfigured)):
            result = admin.handler(event("ga4"), None)
            self.assertEqual(json.loads(result["body"])["status"], "not_configured")
            next(iter(self.cache.items.values()))["freshUntil"] = 0
            admin.handler(event("ga4"), None)
            self.assertEqual(admin.PROVIDERS["ga4"].call_count, 2)


class ProviderTests(unittest.TestCase):
    start, end = date(2026, 10, 1), date(2026, 10, 4)

    def setUp(self):
        environment = patch.dict(os.environ, ENV)
        environment.start()
        self.addCleanup(environment.stop)

    def test_custom_totals_keep_consent_ids_separate_and_combine_join_events(self):
        def results(query, _start, _end):
            if "by event" in query:
                return [{"event": "page_view", "count": "15", "visitors": "3", "visits": "5"},
                        {"event": "group_joined", "count": "2"}, {"event": "group_invite_joined", "count": "4"}]
            return [{"page": "/picks?invite=secret#private", "pageviews": "10"}]
        with patch.object(providers, "cloudwatch_query", side_effect=results):
            result = providers.custom({}, self.start, self.end)
        counts = {item["label"]: item["value"] for item in result["metrics"]}
        self.assertEqual(counts["Pageviews"], 15)
        self.assertEqual(counts["Visitors with consent"], 3)
        self.assertEqual(counts["Groups joined"], 6)
        self.assertNotIn("secret", json.dumps(result))

    def test_goatcounter_api_referrers_and_counts_are_not_claimed_as_unique_visitors(self):
        def answer(url, token):
            self.assertEqual(token, "server-secret")
            query = parse_qs(urlsplit(url).query)
            self.assertEqual(query["start"], ["2026-10-01T00:00:00Z"])
            self.assertEqual(query["end"], ["2026-10-04T23:00:00Z"])
            if "/total?" in url:
                # GoatCounter rejects unknown query parameters with HTTP 400.
                self.assertEqual(set(query), {"start", "end"})
                return {"total": 14, "total_events": 2}
            if "/hits?" in url:
                self.assertEqual(query["limit"], ["10"])
                return {"hits": [{"path_id": 1, "path": "/picks?invite=secret", "count": 12}]}
            self.assertEqual(urlsplit(url).path, "/api/v0/stats/hits/1")
            self.assertEqual(query["limit"], ["20"])
            return {"refs": [{"name": "https://example.org/private?invite=secret", "count": 10}]}
        with patch.object(providers, "http_json", side_effect=answer):
            result = providers.goatcounter({"goatcounter": {"token": "server-secret"}}, self.start, self.end)
        self.assertEqual(result["metrics"][0]["value"], 12)
        self.assertEqual(result["tables"][1]["rows"][0]["source"], "https://example.org")
        self.assertNotIn("server-secret", json.dumps(result))
        self.assertNotIn("invite=secret", json.dumps(result))
        with patch.object(providers, "http_json") as http:
            with self.assertRaises(ValueError):
                providers.goatcounter({"goatcounter": {"token": "secret", "site": "evil.example/"}}, self.start, self.end)
            http.assert_not_called()

    def test_goatcounter_empty_site_returns_zero_without_requesting_referrers(self):
        def answer(url, _token):
            query = parse_qs(urlsplit(url).query)
            if urlsplit(url).path.endswith("/total"):
                self.assertEqual(set(query), {"start", "end"})
                return {"total": 0, "total_events": 0}
            self.assertEqual(urlsplit(url).path, "/api/v0/stats/hits")
            self.assertEqual(query["limit"], ["10"])
            return {"hits": []}
        with patch.object(providers, "http_json", side_effect=answer) as http:
            result = providers.goatcounter({"goatcounter": {"token": "server-secret"}}, self.start, self.end)
        self.assertEqual(http.call_count, 2)
        self.assertEqual(result["metrics"][0]["value"], 0)
        self.assertTrue(all(not item["rows"] for item in result["tables"]))

    def test_ga4_uses_batch_reports_with_read_only_metrics_and_server_token(self):
        def report(names, values, dimension=None):
            return {"metricHeaders": [{"name": name} for name in names],
                    "dimensionHeaders": [{"name": dimension}] if dimension else [],
                    "rows": [{"metricValues": [{"value": str(value)} for value in values],
                              "dimensionValues": [{"value": "/picks?invite=secret"}] if dimension else []}]}
        reports = [report(["sessions", "keyEvents", "engagementRate"], [10, 2, .6]),
                   report(["screenPageViews"], [20], "pagePath"), report(["sessions"], [10], "sessionSourceMedium")]
        with patch.object(providers, "google_token", return_value="server-token"), patch.object(providers, "http_json", return_value={"reports": reports}) as http:
            result = providers.ga4({"ga4": {"property_id": "12345"}}, self.start, self.end)
        request_url, token, body = http.call_args.args
        self.assertTrue(request_url.endswith("properties/12345:batchRunReports"))
        self.assertEqual(token, "server-token")
        self.assertEqual(len(body["requests"]), 3)
        self.assertEqual(result["tables"][0]["rows"][0]["page"], "/picks")
        self.assertNotIn("server-token", json.dumps(result))

    def test_search_console_uses_aggregate_ctr_position_instead_of_averaging_page_rows(self):
        responses = [{"rows": [{"clicks": 10, "impressions": 200, "ctr": .05, "position": 3.2}]},
                     {"rows": [{"keys": ["https://example.org/picks?invite=secret"], "clicks": 8,
                                "impressions": 100, "ctr": .08, "position": 2.1}]}]
        with patch.object(providers, "google_token", return_value="token"), patch.object(providers, "http_json", side_effect=responses) as http:
            result = providers.search_console({"search_console": {"site_url": "sc-domain:example.org"}}, self.start, self.end)
        self.assertIn("sc-domain%3Aexample.org", http.call_args_list[0].args[0])
        metrics = {item["label"]: item["value"] for item in result["metrics"]}
        self.assertEqual(metrics["Average position"], 3.2)
        self.assertEqual(metrics["Click-through rate"], .05)
        self.assertNotIn("invite=secret", json.dumps(result))

    def test_clarity_reports_only_supported_aggregate_fields_and_percentage_units(self):
        body = [{"metricName": "Traffic", "information": [{"totalSessionCount": "100", "distinctUserCount": "70"}]},
                {"metricName": "RageClickCount", "information": [{"sessionsWithMetricPercentage": 2.5}]},
                {"metricName": "DeadClickCount", "information": [{"sessionsWithMetricPercentage": 12}]},
                {"metricName": "EngagementTime", "information": [{"activeTime": "80"}]}]
        with patch.object(providers, "http_json", return_value=body) as http:
            result = providers.clarity({"clarity": {"token": "secret"}}, self.start, self.end)
        self.assertIn("numOfDays=3", http.call_args.args[0])
        self.assertNotIn("dimension1", http.call_args.args[0])
        metrics = {item["label"]: item for item in result["metrics"]}
        self.assertEqual(metrics["Visits with rage clicks"]["format"], "percent100")
        self.assertEqual(metrics["Visits with rage clicks"]["value"], 2.5)
        self.assertNotIn("Total engagement time", metrics)
        self.assertEqual(result["range"]["window"], "Latest 72 hours at retrieval")

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
        self.assertTrue(all(scope.endswith(".readonly") for scope in constructor.call_args.kwargs["scopes"]))
        self.assertTrue(parameter.get_parameter.call_args.kwargs["WithDecryption"])
        fake.refresh.assert_called_once()

    def test_http_redirects_do_not_forward_provider_credentials(self):
        with self.assertRaises(ValueError):
            providers.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://attacker.example")


class DeploymentTests(unittest.TestCase):
    def test_admin_routes_use_native_cognito_jwt_authorizer_and_no_public_tracking_scripts(self):
        config = (ROOT / "terraform/modules/app/admin-analytics.tf").read_text()
        self.assertIn('"GET /api/admin/analytics/{provider}"', config)
        self.assertIn('authorization_type = "JWT"', config)
        self.assertIn('authorizer_id      = aws_apigatewayv2_authorizer.cognito.id', config)
        self.assertIn('count        = var.environment == "dev" ? 1 : 0', config)
        self.assertIn('name         = "admin"', config)
        self.assertNotIn('"ssm:*"', config)
        page = (ROOT / "frontend/admin-analytics.html").read_text()
        self.assertIn('name="robots" content="noindex,nofollow"', page)
        self.assertIn('id="analytics-main" class="analytics-main" hidden', page)
        self.assertNotIn('/goatcounter.js', page)
        self.assertNotIn('/monitoring.js', page)
        self.assertNotIn('src="/analytics.js', page)
        workflow = (ROOT / ".github/workflows/deploy-dev.yml").read_text()
        self.assertIn('--target backend/lambda/vendor', workflow)
        self.assertIn('--python-version 3.12', workflow)


if __name__ == "__main__":
    unittest.main()

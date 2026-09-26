"""Static SEO and deployment regression checks; run with unittest discovery."""
import json
import re
import struct
import hashlib
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.robotparser import RobotFileParser

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://predictplayoffs.com"
PUBLIC_PAGES = [("index.html", "/"), ("nba.html", "/nba"), ("scoring.html", "/scoring"), ("leaderboard.html", "/leaderboard")]


def png_size(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"{path} is not a PNG")
    return struct.unpack(">II", data[16:24])


class Page(HTMLParser):
    def __init__(self, filename):
        super().__init__()
        self.tags = []
        self.html = (ROOT / "frontend" / filename).read_text(encoding="utf-8")
        self.feed(self.html)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))

    def select(self, tag, **attrs):
        return [a for t, a in self.tags if t == tag and all(a.get(k) == v for k, v in attrs.items())]


class SeoTests(unittest.TestCase):
    def test_public_pages(self):
        titles, descriptions_seen = set(), set()
        for filename, route in PUBLIC_PAGES:
            with self.subTest(page=filename):
                page = Page(filename)
                self.assertEqual(len(page.select("title")), 1)
                self.assertEqual(len(page.select("h1")), 1)
                descriptions = page.select("meta", name="description")
                self.assertEqual(len(descriptions), 1)
                self.assertTrue(descriptions[0]["content"].strip())
                title = unescape(re.search(r"<title>(.*?)</title>", page.html)[1])
                self.assertNotIn(title, titles)
                self.assertNotIn(descriptions[0]["content"], descriptions_seen)
                titles.add(title)
                descriptions_seen.add(descriptions[0]["content"])
                self.assertEqual(page.select("link", rel="canonical"), [{"rel": "canonical", "href": BASE + route}])
                self.assertEqual(page.select("meta", name="robots"), [{"name": "robots", "content": "index,follow"}])
                self.assertFalse(page.select("meta", name="keywords"))
                self.assertNotIn("road to the bowl", page.html.lower())

                for attr, prefix in [("property", "og"), ("name", "twitter")]:
                    for field, expected in [("title", title), ("description", descriptions[0]["content"])]:
                        self.assertEqual(page.select("meta", **{attr: prefix + ":" + field}), [{attr: prefix + ":" + field, "content": expected}])
                    for field in ["image", "image:alt"]:
                        self.assertEqual(len(page.select("meta", **{attr: prefix + ":" + field})), 1)
                self.assertEqual(page.select("meta", property="og:url")[0]["content"], BASE + route)
                self.assertEqual(page.select("meta", name="twitter:card")[0]["content"], "summary_large_image")
                links = {a.get("href") for a in page.select("a")}
                self.assertTrue({"/", "/nba", "/scoring", "/leaderboard", "/picks"}.issubset(links))
                for script in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page.html, re.S):
                    json.loads(script)

    def test_homepage_content_and_social_data(self):
        page = Page("index.html")
        self.assertIn("<title>Predict Playoffs | 2026 NFL Playoff Prediction Challenge</title>", page.html)
        self.assertIn("Predict the 2026<br />NFL Playoffs.", page.html)
        self.assertIn('href="/nba" data-no-sport-copy', page.html)
        for text in ["14 NFL playoff teams", "AFC and NFC", "Super Bowl", "Compete with friends"]:
            self.assertIn(text, page.html)

        nba = Page("nba.html")
        self.assertIn("<title>Predict Playoffs | 2026–27 NBA Playoff Predictor</title>", nba.html)
        self.assertIn("Predict the 2026–27<br />NBA Playoffs.", nba.html)
        self.assertIn('href="/" data-no-sport-copy', nba.html)
        for text in ["16 NBA playoff teams", "East and West", "NBA Finals", "Compete with friends"]:
            self.assertIn(text, nba.html)

        for filename, route in [("index.html", "/"), ("nba.html", "/nba")]:
            with self.subTest(page=filename):
                page = Page(filename)
                for prop in ["og:title", "og:site_name", "og:description", "og:url", "og:image"]:
                    self.assertEqual(len(page.select("meta", property=prop)), 1)
                self.assertEqual(page.select("meta", property="og:url")[0]["content"], BASE + route)
                for attr, key in [("property", "og:image"), ("name", "twitter:image")]:
                    url = page.select("meta", **{attr: key})[0]["content"]
                    self.assertTrue(url.startswith(BASE + "/assets/"))
                    asset = ROOT / "frontend" / url.removeprefix(BASE + "/")
                    self.assertEqual(png_size(asset), (1200, 630))
                    self.assertIn('"assets/' + asset.name + '"', (ROOT / "terraform/modules/app/main.tf").read_text())
                self.assertEqual(page.select("meta", property="og:image:width")[0]["content"], "1200")
                self.assertEqual(page.select("meta", property="og:image:height")[0]["content"], "630")
                self.assertEqual(page.select("meta", name="twitter:card")[0]["content"], "summary_large_image")
                schema = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page.html, re.S)[1])
                entities = {entity["@type"]: entity for entity in schema["@graph"]}
                self.assertEqual(set(entities), {"WebSite", "WebApplication", "WebPage"})
                app, website, webpage = (entities[t] for t in ["WebApplication", "WebSite", "WebPage"])
                self.assertEqual(app["name"], "Predict Playoffs")
                self.assertEqual(app["url"], BASE + "/")
                self.assertEqual(webpage["url"], BASE + route)
                self.assertEqual(webpage["mainEntity"]["@id"], app["@id"])
                self.assertEqual(app["isPartOf"]["@id"], website["@id"])
                for invented in ["aggregateRating", "review", "award", "founder", "address"]:
                    self.assertNotIn('"' + invented + '"', json.dumps(schema))

    def test_icons_exist_at_declared_sizes_and_are_published(self):
        expected_links = [
            ("icon", "/favicon.ico"),
            ("icon", "/assets/predict-playoffs-mark.svg"),
            ("icon", "/assets/favicon-32x32.png"),
            ("apple-touch-icon", "/apple-touch-icon.png"),
        ]
        for filename in ["index.html", "nba.html", "picks.html", "leaderboard.html", "scoring.html"]:
            page = Page(filename)
            with self.subTest(page=filename):
                for rel, href in expected_links:
                    self.assertEqual(len(page.select("link", rel=rel, href=href)), 1)

        frontend = ROOT / "frontend"
        self.assertEqual(png_size(frontend / "apple-touch-icon.png"), (180, 180))
        self.assertEqual(png_size(frontend / "assets/favicon-32x32.png"), (32, 32))
        self.assertEqual((frontend / "favicon.ico").read_bytes()[:4], b"\x00\x00\x01\x00")

        config = (ROOT / "terraform/modules/app/main.tf").read_text()
        for deployed_path in [
            "favicon.ico",
            "apple-touch-icon.png",
            "assets/favicon-32x32.png",
            "assets/predict-playoffs-mark.svg",
            "assets/predict-playoffs-social.png",
        ]:
            self.assertIn(f'"{deployed_path}"', config)

    def test_crawl_files_and_private_workspace(self):
        robots = (ROOT / "frontend/robots.txt").read_text()
        parser = RobotFileParser()
        parser.parse(robots.splitlines())
        self.assertEqual(parser.site_maps(), [BASE + "/sitemap.xml"])
        self.assertIn("User-agent: OAI-SearchBot", robots)
        for agent in ["Googlebot", "bingbot", "OAI-SearchBot", "GPTBot"]:
            for route in ["/", "/nba", "/scoring", "/leaderboard", "/picks", "/styles.css?v=123", "/api/leaderboard", "/api/prediction-window", "/api/win-totals"]:
                self.assertTrue(parser.can_fetch(agent, BASE + route))
            self.assertFalse(parser.can_fetch(agent, BASE + "/api/profile"))
        sitemap = ET.parse(ROOT / "frontend/sitemap.xml")
        self.assertEqual(sitemap.getroot().tag, "{http://www.sitemaps.org/schemas/sitemap/0.9}urlset")
        urls = [node.text for node in sitemap.findall("{*}url/{*}loc")]
        self.assertEqual(urls, [BASE + "/", BASE + "/nba", BASE + "/scoring", BASE + "/leaderboard"])
        self.assertEqual(Page("picks.html").select("meta", name="robots")[0]["content"], "noindex,follow")

    def test_public_facts_are_visible_and_deadlines_match_configuration(self):
        for filename in ["index.html", "nba.html"]:
            page = Page(filename)
            section = re.search(r'<section class="prediction-guide".*?</section>', page.html, re.S)[0]
            self.assertNotIn('class="hidden"', section)
            self.assertNotIn('<details', section)
            self.assertIn("Classic", section)
            self.assertIn("Upset Edge", section)
            self.assertIn("not affiliated with the NFL or NBA", section)
            self.assertGreaterEqual(section.count("<h3>"), 5)
        nba_deadline = re.search(r'"lockAt": "([^"]+)"', (ROOT / "frontend/sports.js").read_text())[1]
        nfl_deadline = re.search(r'prediction_lock_at\s*=\s*"([^"]+)"', (ROOT / "terraform/envs/prod/terraform.tfvars").read_text())[1]
        self.assertTrue(Page("nba.html").select("time", datetime=nba_deadline))
        self.assertTrue(Page("index.html").select("time", datetime=nfl_deadline))

    def test_asset_versioning_and_cache_isolation(self):
        config = (ROOT / "terraform/modules/app/main.tf").read_text()
        frontend = config.split('resource "aws_cloudfront_cache_policy" "frontend" {')[1].split('\nresource ', 1)[0]
        self.assertRegex(frontend, r'min_ttl\s*= 0')
        self.assertRegex(frontend, r'max_ttl\s*= 86400')
        self.assertIn('query_string_behavior = "whitelist"', frontend)
        self.assertIn('items = ["v"]', frontend)
        for encoding in ["brotli", "gzip"]:
            self.assertRegex(frontend, 'enable_accept_encoding_' + encoding + r'\s*= true')
        api = config.split('ordered_cache_behavior {', 1)[1].split('\n  }', 1)[0]
        self.assertIn('path_pattern               = "/api/*"', api)
        self.assertIn('aws_cloudfront_cache_policy.disabled.id', api)
        self.assertIn('origin_request_policy_id', api)
        disabled = config.split('resource "aws_cloudfront_cache_policy" "disabled" {')[1].split('\nresource ', 1)[0]
        self.assertRegex(disabled, r'max_ttl\s*= 0')
        self.assertIn('s-maxage=60', config)
        self.assertIn('filemd5(local.frontend_files[key].source)', config)
        self.assertIn('depends_on    = [aws_s3_object.frontend]', config)
        for filename, _ in PUBLIC_PAGES + [("picks.html", "/picks")]:
            page = Page(filename)
            for tag, attrs in page.tags:
                url = attrs.get("src", "") if tag == "script" else attrs.get("href", "") if tag == "link" else ""
                if url.startswith("/") and re.match(r'.*\.(js|css)(\?|$)', url):
                    if url != "/auth-config.js":
                        self.assertRegex(url, r'\?v=\d+$', filename + ": " + url)

    @unittest.skipUnless(shutil.which("terraform"), "Terraform CLI is required for the deployment-render check")
    def test_terraform_renders_release_versions_without_aws(self):
        """Evaluate the real module expressions without a backend, providers, or credentials."""
        config = (ROOT / "terraform/modules/app/main.tf").read_text()
        assets = re.search(r'  frontend_files = \{.*?\n  \}', config, re.S)[0]
        rendering = re.search(r'locals \{\n  # One content-derived release version.*?\n\}', config, re.S)[0]
        fixture = 'variable "frontend_dir" { default = ' + json.dumps((ROOT / "frontend").as_posix()) + ' }\n'
        fixture += 'locals {\n' + assets + '\n}\n' + rendering
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "main.tf").write_text(fixture, encoding="utf-8")
            result = subprocess.run(
                ["terraform", "console", "-no-color"], cwd=directory,
                input='jsonencode({ version = local.frontend_version, pages = local.frontend_pages })\n',
                capture_output=True, text=True, encoding="utf-8", timeout=30,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = json.loads(json.loads(result.stdout))
        files = sorted(p for p in (ROOT / "frontend").iterdir() if p.suffix in [".js", ".css"] and p.name != "auth-config.js")
        expected = hashlib.sha256(''.join(hashlib.md5(p.read_bytes()).hexdigest() for p in files).encode()).hexdigest()[:16]
        self.assertEqual(rendered["version"], expected)
        self.assertEqual(set(rendered["pages"]), {"index.html", "nba", "scoring", "leaderboard", "picks"})
        for html in rendered["pages"].values():
            versions = re.findall(r'\?v=([^" ]+)', html)
            self.assertTrue(versions)
            self.assertEqual(set(versions), {expected})
            self.assertIn('src="/auth-config.js"', html)

    def test_environment_and_publication_guards(self):
        config = (ROOT / "terraform/modules/app/main.tf").read_text()
        self.assertRegex(config, r'"nba"\s*=\s*\{\s*source\s*=\s*"\$\{var.frontend_dir\}/nba.html"\s*content_type\s*=\s*"text/html; charset=utf-8"')
        for filename, mime in [("robots.txt", "text/plain"), ("sitemap.xml", "application/xml")]:
            self.assertRegex(config, '"' + re.escape(filename) + r'"\s*=\s*\{\s*source\s*=\s*"\$\{var.frontend_dir\}/' + re.escape(filename) + r'"\s*content_type\s*=\s*"' + mime)
        self.assertRegex(config, r'count\s*= var.environment == "prod" \? 0 : 1')
        self.assertRegex(config, r'header\s*= "X-Robots-Tag"\s*value\s*= "noindex, nofollow"\s*override\s*= true')
        self.assertEqual(len(re.findall(r'response_headers_policy_id\s*= var.environment == "prod" \? null : aws_cloudfront_response_headers_policy.noindex\[0\].id', config)), 2)
        self.assertNotIn("custom_error_response", config)
        self.assertIn('default_root_object = "index.html"', config)
        for env in ["dev", "prod"]:
            self.assertRegex((ROOT / f"terraform/envs/{env}/main.tf").read_text(), r'environment\s*= "' + env + '"')


if __name__ == "__main__":
    unittest.main()

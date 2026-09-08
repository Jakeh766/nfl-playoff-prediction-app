"""Static SEO and deployment regression checks; run with unittest discovery."""
import json
import re
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://predictplayoffs.com"


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
        for filename, route in [("index.html", "/"), ("scoring.html", "/scoring"), ("leaderboard.html", "/leaderboard")]:
            with self.subTest(page=filename):
                page = Page(filename)
                self.assertEqual(len(page.select("title")), 1)
                self.assertEqual(len(page.select("h1")), 1)
                descriptions = page.select("meta", name="description")
                self.assertEqual(len(descriptions), 1)
                self.assertTrue(descriptions[0]["content"].strip())
                self.assertEqual(page.select("link", rel="canonical"), [{"rel": "canonical", "href": BASE + route}])
                self.assertEqual(page.select("meta", name="robots"), [{"name": "robots", "content": "index,follow"}])
                self.assertFalse(page.select("meta", name="keywords"))
                self.assertNotIn("road to the bowl", page.html.lower())

    def test_homepage_content_and_social_data(self):
        page = Page("index.html")
        self.assertIn("<title>Predict Playoffs | 2026 NFL Playoff Prediction Challenge</title>", page.html)
        self.assertIn("Predict the 2026<br />NFL Playoffs.", page.html)
        for text in ["14 NFL playoff teams", "AFC and NFC", "Super Bowl", "Compete with friends"]:
            self.assertIn(text, page.html)
        self.assertEqual(page.select("meta", property="og:url")[0]["content"], BASE + "/")
        for attr, key in [("property", "og:image"), ("name", "twitter:image")]:
            url = page.select("meta", **{attr: key})[0]["content"]
            self.assertTrue(url.startswith(BASE + "/assets/"))
            asset = ROOT / "frontend" / url.removeprefix(BASE + "/")
            self.assertEqual(asset.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
            self.assertIn('"assets/' + asset.name + '"', (ROOT / "terraform/modules/app/main.tf").read_text())
        schema = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page.html, re.S)[1])
        self.assertEqual(schema["name"], "Predict Playoffs")
        self.assertEqual(schema["url"], BASE + "/")
        self.assertEqual(schema["@type"], "WebApplication")
        self.assertNotIn("aggregateRating", schema)
        self.assertNotIn("review", schema)

    def test_crawl_files_and_private_workspace(self):
        robots = (ROOT / "frontend/robots.txt").read_text()
        self.assertEqual(robots, "User-agent: *\nAllow: /\n\nSitemap: " + BASE + "/sitemap.xml\n")
        sitemap = ET.parse(ROOT / "frontend/sitemap.xml")
        self.assertEqual(sitemap.getroot().tag, "{http://www.sitemaps.org/schemas/sitemap/0.9}urlset")
        urls = [node.text for node in sitemap.findall("{*}url/{*}loc")]
        self.assertEqual(urls, [BASE + "/", BASE + "/scoring", BASE + "/leaderboard"])
        self.assertEqual(Page("picks.html").select("meta", name="robots")[0]["content"], "noindex,follow")

    def test_environment_and_publication_guards(self):
        config = (ROOT / "terraform/modules/app/main.tf").read_text()
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

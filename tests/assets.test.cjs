const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
test("production assets are reproducible, content-addressed and smaller than the source", () => {
  const before = fs.readFileSync("static/index.html", "utf8");
  execFileSync(process.execPath, ["scripts/build-assets.cjs", "--check"]);
  assert.equal(
    fs.readFileSync("static/index.html", "utf8"),
    before,
    "Run npm run build before committing source edits",
  );
  const paths = [
    ...before.matchAll(
      /(?:src|href)="(\/assets\/site-([a-f0-9]{12})\.(js|css))"/g,
    ),
  ];
  assert.equal(paths.length, 2);
  for (const [, url, hash, type] of paths) {
    const content = fs.readFileSync("static" + url);
    assert.equal(
      crypto.createHash("sha256").update(content).digest("hex").slice(0, 12),
      hash,
    );
    assert.ok(
      content.length < (type === "css" ? 105000 : 100000),
      `${type} production budget (105KB CSS for the Figma scoreboard; 100KB JS including verified results and goal-scorer interactions)`,
    );
  }
  assert.match(
    before,
    /property="og:image"[\s\S]*?content="https:\/\/nhl-lines\.pages\.dev\/social-preview\.jpg"/,
  );
  assert.match(before, /name="twitter:card" content="summary_large_image"/);
  assert.match(before, /property="og:image:width" content="1200"/);
  assert.match(before, /property="og:image:height" content="630"/);
  const preview = fs.readFileSync("static/social-preview.jpg");
  assert.equal(
    preview.readUInt16BE(0),
    0xffd8,
    "Public sharing asset is a JPEG",
  );
  assert.ok(preview.length < 100000, "Social preview stays below 100KB");
  assert.match(before, /<script defer src="\/assets\//);
  assert.ok(
    !before.includes('src="/dfo.js"'),
    "Diagnostic HTML parser is not loaded in production",
  );
  assert.match(
    fs.readFileSync("static/_headers", "utf8"),
    /\/assets\/\*[\s\S]*max-age=31536000, immutable/,
  );
});
test("crawlable HTML, canonical, sitemap and truthful structured data describe the public site", () => {
  const html = fs.readFileSync("static/index.html", "utf8");
  assert.match(html, /rel="canonical" href="https:\/\/nhl-lines.pages.dev\/"/);
  assert.match(
    html,
    /<h2 id="about-heading">\s*NHL line combinations and player statistics\s*<\/h2>/,
  );
  assert.match(html, /<noscript\s*>/);
  const data = JSON.parse(
    html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
  );
  assert.equal(data["@graph"][0].name, "Next Shift");
  assert.equal(data["@graph"][1].isAccessibleForFree, true);
  assert.ok(!JSON.stringify(data).includes("aggregateRating"));
  const robots = fs.readFileSync("static/robots.txt", "utf8");
  assert.match(robots, /Sitemap: https:\/\/nhl-lines.pages.dev\/sitemap.xml/);
  assert.ok(
    !robots.includes("Disallow: /api/"),
    "Rendering resources stay available to crawlers",
  );
  assert.match(
    fs.readFileSync("static/sitemap.xml", "utf8"),
    /<loc>https:\/\/nhl-lines.pages.dev\/<\/loc>/,
  );
});

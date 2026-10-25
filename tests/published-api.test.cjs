const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const table = fs
  .readFileSync("lib/dfo-teams.js", "utf8")
  .replace("export default", "const teamSlugs =");
const library = fs
  .readFileSync("lib/nhl-lineups.js", "utf8")
  .replace(/import teamSlugs from [^;]+;/, table);
const libraryUrl =
  "data:text/javascript;base64," + Buffer.from(library).toString("base64");
const handlerSource = fs
  .readFileSync("functions/api/lineups.js", "utf8")
  .replace('"../../lib/nhl-lineups.js"', JSON.stringify(libraryUrl));
const handler = import(
  "data:text/javascript;base64," + Buffer.from(handlerSource).toString("base64")
);
const libraryModule = import(libraryUrl);
const now = Date.parse("2026-10-20T17:00:00Z");
// Player names use letters, not numeric fixture IDs.
const group = (label, prefix = "Alpha") =>
  `**${label} projected lineup**\n\n` +
  ["One", "Two", "Three", "Four"]
    .map(
      (n) =>
        `${prefix} Left ${n} -- ${prefix} Center ${n} -- ${prefix} Right ${n}`,
    )
    .join("\n\n") +
  "\n\n" +
  ["One", "Two", "Three"]
    .map((n) => `${prefix} Defense ${n} -- ${prefix} Partner ${n}`)
    .join("\n\n") +
  `\n\n${prefix} Starter\n\n${prefix} Backup\n\n***Scratched:** Someone Else*\n\n`;
function article(url, body, updated = "2026-10-20T16:00:00Z") {
  return `<link rel="canonical" href="${url}"><script type="application/ld&#x2B;json">${JSON.stringify({ "@type": "NewsArticle", dateModified: updated, articleBody: body })}</script>`;
}
test("official NHL parser preserves published rows, dates and an unpaired seventh defenseman", async () => {
  const { parseArticle, dailyUrl, previewCandidates, nhlDay } =
    await libraryModule;
  const url = dailyUrl(now);
  let body = group("Ducks");
  const parsed = parseArticle(article(url, body), url, now);
  assert.deepEqual(parsed.teams["anaheim-ducks"].forwards[0], [
    "Alpha Left One",
    "Alpha Center One",
    "Alpha Right One",
  ]);
  assert.deepEqual(parsed.teams["anaheim-ducks"].goalies, [
    ["Alpha Starter"],
    ["Alpha Backup"],
  ]);
  assert.equal(parsed.teams["anaheim-ducks"].game_date, "2026-10-20");
  body = body
    .replace(" -- Alpha Right Three", "")
    .replace("\n\nAlpha Starter", "\n\nSeventh Defender\n\nAlpha Starter");
  const short = parseArticle(article(url, body), url, now).teams[
    "anaheim-ducks"
  ];
  assert.equal(short.forwards[2].length, 2);
  assert.equal(short.forwards[3].length, 3);
  assert.deepEqual(short.defense[3], ["Seventh Defender"]);
  assert.equal(short.goalies.length, 2);
  const identical = group("Canucks")
    .replace("Alpha Center One", "Elias Pettersson")
    .replace("Alpha Defense One", "Elias Pettersson");
  assert.ok(
    parseArticle(article(url, identical), url, now).teams["vancouver-canucks"],
  );
  for (const bad of [
    article(url, "No published rows"),
    article(url, group("Ducks").replace("\n\nAlpha Starter", "\n\nSeventh Defender\n\nAlpha Starter")),
    article(url, group("Ducks"), "2026-09-01T00:00:00Z"),
    article(url, group("Ducks")).replace('rel="canonical"', 'rel="alternate"'),
    article(url, group("Ducks").replace("Alpha Starter", "Alpha Backup")),
    article(
      url,
      group("Ducks").replace("Alpha Left One", "<script>bad</script>"),
    ),
  ])
    assert.throws(() => parseArticle(bad, url, now));
  const schedule = {
    gameWeek: [
      {
        date: "2026-10-19",
        games: [{ awayTeam: { abbrev: "ANA" }, homeTeam: { abbrev: "NYR" } }],
      },
      {
        date: "2026-10-21",
        games: [{ awayTeam: { abbrev: "ANA" }, homeTeam: { abbrev: "NYR" } }],
      },
    ],
  };
  const candidates = previewCandidates(schedule, "ANA", "2026-10-20");
  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0].url,
    "https://www.nhl.com/news/anaheim-ducks-new-york-rangers-game-preview-october-19-2026",
  );
  assert.equal(nhlDay(Date.parse("2026-10-21T01:00:00Z")), "2026-10-20");
});
test("team-scoped NHL adapter shares edge snapshots and uses dated previews without cached errors", async () => {
  const { onRequestGet } = await handler,
    { dailyUrl } = await libraryModule;
  const originalFetch = global.fetch,
    originalCaches = global.caches,
    originalNow = Date.now;
  const stored = new Map(),
    requests = [];
  let fail = false;
  Date.now = () => now;
  global.caches = {
    default: {
      match: async (r) => stored.get(r.url)?.clone(),
      put: async (r, res) => {
        stored.set(r.url, res.clone());
      },
    },
  };
  global.fetch = async (url, options) => {
    requests.push(url);
    assert.equal(options.redirect, "manual");
    if (fail) return new Response("Unavailable", { status: 403 });
    if (url === dailyUrl(now))
      return new Response(
        article(url, group("Ducks") + group("Islanders", "Beta")),
      );
    if (url === "https://api-web.nhle.com/v1/schedule/2026-10-14")
      return Response.json({
        gameWeek: [
          {
            date: "2026-10-18",
            games: [
              { awayTeam: { abbrev: "CAR" }, homeTeam: { abbrev: "CGY" } },
            ],
          },
        ],
      });
    if (
      url ===
      "https://www.nhl.com/news/carolina-hurricanes-calgary-flames-game-preview-october-18-2026"
    )
      return new Response(
        article(url, group("Hurricanes"), "2026-10-18T16:00:00Z"),
      );
    throw Error("Unexpected request: " + url);
  };
  const get = (team) =>
    onRequestGet({
      request: new Request("https://test/api/lineups?team=" + team),
    });
  try {
    assert.equal((await get("bad")).status, 400);
    assert.equal(requests.length, 0);
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => get("ANA")),
    );
    assert.equal(
      requests.length,
      1,
      "Concurrent cold requests share one source read",
    );
    let response = concurrent[0];
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-Line-Provider"), "NHL.com");
    assert.match(response.headers.get("Cache-Control"), /s-maxage=300/);
    assert.deepEqual(Object.keys((await response.json()).teams), [
      "anaheim-ducks",
    ]);
    await get("ANA");
    await get("NYI");
    assert.equal(requests.length, 1, "Teams share one processed daily article");
    response = await get("CAR");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.teams["carolina-hurricanes"].game_date, "2026-10-18");
    assert.match(data.updated_at, /2026-10-18/);
    assert.equal(requests.length, 3);
    await get("CAR");
    assert.equal(requests.length, 3);
    fail = true;
    stored.clear();
    response = await get("EDM");
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match(response.headers.get("X-Line-Error"), /HTTP 403/);
    assert.equal(stored.size, 0);
    assert.ok(
      requests.every(
        (u) =>
          u.startsWith("https://www.nhl.com/news/") ||
          u.startsWith("https://api-web.nhle.com/v1/schedule/"),
      ),
    );
  } finally {
    global.fetch = originalFetch;
    global.caches = originalCaches;
    Date.now = originalNow;
  }
});


test("official NHL separators need no spaces and preserve hyphenated player names",async()=>{
 const {parseArticle,dailyUrl}=await libraryModule;const url=dailyUrl(now);
 const body=group("Lightning").replace("Alpha Left One -- Alpha Center One -- Alpha Right One","Jake Guentzel--Gage Goncalves-- Brayden Point").replace("Alpha Left Two -- Alpha Center Two -- Alpha Right Two","Pierre-Luc Dubois—Alex Barré-Boulet – Jean-Gabriel Pageau");
 const parsed=parseArticle(article(url,body),url,now).teams["tampa-bay-lightning"];
 assert.deepEqual(parsed.forwards[0],["Jake Guentzel","Gage Goncalves","Brayden Point"]);
 assert.deepEqual(parsed.forwards[1],["Pierre-Luc Dubois","Alex Barré-Boulet","Jean-Gabriel Pageau"]);
});

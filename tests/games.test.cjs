const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
require("../static/game-goal-data.js");
require("../static/games.js");
const libraryUrl =
  "data:text/javascript;base64," +
  Buffer.from(
    fs
      .readFileSync("lib/game-goals.js", "utf8")
      .replace(/^import\s[^;]+;\s*/gm, ""),
  ).toString("base64");
const handlerSource = fs
  .readFileSync("functions/api/games.js", "utf8")
  .replace('"../../lib/game-goals.js"', JSON.stringify(libraryUrl));
const handler = import(
  "data:text/javascript;base64," + Buffer.from(handlerSource).toString("base64")
);
const rawGame = () => ({
  id: 2026020137,
  startTimeUTC: "2026-10-20T23:00:00Z",
  gameState: "FUT",
  gameScheduleState: "OK",
  awayTeam: { abbrev: "ANA" },
  homeTeam: { abbrev: "NYR" },
  periodDescriptor: { number: 2, periodType: "REG" },
  clock: { timeRemaining: "12:20" },
});
test("game dates and start times use the client timezone and preserve next-day European starts", () => {
  assert.equal(
    GameScores.day(new Date("2026-10-20T22:30:00Z"), "Europe/Budapest"),
    "2026-10-21",
  );
  assert.equal(
    GameScores.day(new Date("2026-10-20T22:30:00Z"), "America/New_York"),
    "2026-10-20",
  );
  const data = GameScores.normalize({
    currentDate: "2026-10-20",
    games: [rawGame()],
  });
  assert.ok(GameScores.valid(data, "2026-10-20"));
  assert.match(
    GameScores.status(data.games[0], "Europe/Budapest"),
    /21 Oct.*01:00/,
  );
  assert.equal(
    data.games[0].away.score,
    null,
    "Missing scores never become fake zeroes",
  );
  const live = { ...data.games[0], state: "LIVE" };
  assert.equal(GameScores.status(live), "P2 · 12:20");
  assert.equal(GameScores.interval({ games: [live] }), 60000);
  assert.equal(
    GameScores.status({ ...live, state: "OFF", outcome: "OT" }),
    "Final · OT",
  );
  assert.equal(
    GameScores.status({ ...live, scheduleState: "PPD" }),
    "Postponed",
  );
  assert.equal(GameScores.interval(data), 300000);
  assert.equal(GameScores.interval({ games: [] }), 21600000);
  assert.equal(
    GameScores.interval({ games: [{ ...live, state: "OFF" }] }),
    21600000,
    "Completed results do not need live-score polling",
  );
});
test("previous NHL game day follows New York calendar boundaries independently of Budapest dates and DST", () => {
  const cases = [
    ["2026-10-24T09:00:00Z", "2026-10-23"],
    ["2026-10-23T22:30:00Z", "2026-10-22"],
    ["2026-10-24T03:59:59Z", "2026-10-22"],
    ["2026-10-24T04:00:00Z", "2026-10-23"],
    ["2026-11-01T03:59:59Z", "2026-10-30"],
    ["2026-11-01T04:00:00Z", "2026-10-31"],
    ["2026-11-02T04:59:59Z", "2026-10-31"],
    ["2026-11-02T05:00:00Z", "2026-11-01"],
    ["2026-03-08T05:00:00Z", "2026-03-07"],
    ["2026-03-09T04:00:00Z", "2026-03-08"],
    ["2027-01-01T05:00:00Z", "2026-12-31"],
    ["2028-03-01T05:00:00Z", "2028-02-29"],
  ];
  for (const [at, expected] of cases)
    assert.equal(GameScores.resultDay(new Date(at)), expected, at);
  assert.equal(
    GameScores.day(new Date("2026-10-23T22:30:00Z"), "Europe/Budapest"),
    "2026-10-24",
    "The displayed NHL game day is deliberately different from the local date",
  );
});
test("visible results schedule the next New York date change across 23-hour and 25-hour days", () => {
  const cases = [
    ["2026-10-24T03:59:59Z", "2026-10-24T04:00:00Z"],
    ["2026-10-24T04:00:00Z", "2026-10-25T04:00:00Z"],
    ["2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z"],
    ["2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"],
    ["2026-10-25T04:00:00Z", "2026-10-26T04:00:00Z"],
    ["2026-12-31T22:30:00Z", "2027-01-01T05:00:00Z"],
  ];
  for (const [at, next] of cases) {
    const boundary = GameScores.nextResultChange(Date.parse(at));
    assert.ok(Math.abs(boundary - Date.parse(next)) <= 1000, `${at} → ${next}`);
    assert.ok(
      boundary > Date.parse(at),
      "The scheduled date change is in the future",
    );
  }
});
test("score proxy validates dates, fixed origin, game identity and upstream failure without caching errors", async () => {
  const { onRequestGet } = await handler;
  const original = global.fetch;
  let calls = 0;
  try {
    global.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "https://api-web.nhle.com/v1/score/2026-10-20");
      assert.equal(options.redirect, "manual");
      return Response.json({ currentDate: "2026-10-20", games: [rawGame()] });
    };
    const request = (date) => ({
      request: new Request("https://test/api/games?date=" + date),
    });
    for (const date of ["2026-02-30", "https://evil.test", "2026-13-01", ""])
      assert.equal((await onRequestGet(request(date))).status, 400);
    assert.equal(calls, 0);
    const ok = await onRequestGet(request("2026-10-20"));
    assert.equal(ok.status, 200);
    assert.ok(GameScores.valid(await ok.json(), "2026-10-20"));
    assert.equal(ok.headers.get("X-Data-Source"), "NHL");
    for (const payload of [
      { currentDate: "2026-10-19", games: [] },
      { currentDate: "2026-10-20", games: [rawGame(), rawGame()] },
      {
        currentDate: "2026-10-20",
        games: [{ ...rawGame(), gameState: "UNKNOWN" }],
      },
    ]) {
      global.fetch = async () => Response.json(payload);
      const bad = await onRequestGet(request("2026-10-20"));
      assert.equal(bad.status, 502);
      assert.equal(bad.headers.get("Cache-Control"), "no-store");
    }
    global.fetch = async () =>
      Response.json({ currentDate: "2026-10-20", games: [] });
    assert.deepEqual(
      (await (await onRequestGet(request("2026-10-20"))).json()).games,
      [],
    );
    global.fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.test" },
      });
    assert.equal((await onRequestGet(request("2026-10-20"))).status, 502);
  } finally {
    global.fetch = original;
  }
});

test("past completed scores use a six-hour shared cache while live and unplayed games retain short caching", async () => {
  const { onRequestGet } = await handler;
  const original = global.fetch;
  const request = () => ({
    request: new Request("https://test/api/games?date=2026-10-20"),
  });
  try {
    for (const state of ["OFF", "FINAL", "LIVE", "FUT", "PRE"]) {
      global.fetch = async () =>
        Response.json({
          currentDate: "2026-10-20",
          games: [
            {
              ...rawGame(),
              gameState: state,
              awayTeam: { abbrev: "ANA", score: 2 },
              homeTeam: { abbrev: "NYR", score: 1 },
            },
          ],
        });
      const result = await onRequestGet(request());
      assert.equal(result.status, 200);
      assert.match(
        result.headers.get("Cache-Control"),
        ["OFF", "FINAL"].includes(state)
          ? /s-maxage=21600(?:,|$)/
          : /s-maxage=30(?:,|$)/,
        `Cache policy for ${state}`,
      );
    }
  } finally {
    global.fetch = original;
  }
});

test("scores retain same-date last-good data only for transient failures and never renew its original age", async () => {
  const { onRequestGet } = await handler;
  const originalFetch = global.fetch,
    originalCaches = global.caches,
    originalNow = Date.now;
  let now = originalNow(),
    mode = "fresh",
    calls = 0;
  const records = new Map();
  const request = (date) => ({
    request: new Request("https://test/api/games?date=" + date),
  });
  try {
    Date.now = () => now;
    global.caches = {
      default: {
        match: async (key) => records.get(key.url)?.clone(),
        put: async (key, value) => records.set(key.url, value.clone()),
      },
    };
    global.fetch = async () => {
      calls++;
      if (mode === "connection") throw Error("Offline");
      if (mode === "bad")
        return Response.json({ currentDate: "2026-10-19", games: [] });
      if (mode !== "fresh") return new Response(null, { status: Number(mode) });
      return Response.json({ currentDate: "2026-10-20", games: [rawGame()] });
    };
    const first = await onRequestGet(request("2026-10-20"));
    assert.equal(first.headers.get("X-Data-State"), "fresh");
    const checked = first.headers.get("X-NHL-Checked-At");
    now = Date.parse(checked) + 1000;
    const expected = await first.json();
    await onRequestGet(request("2026-10-20"));
    assert.equal(calls, 1, "Fresh short cache shares the source response");
    records.delete("https://test/api/games?date=2026-10-20");
    for (const transient of ["503", "connection"]) {
      mode = transient;
      const saved = await onRequestGet(request("2026-10-20"));
      assert.equal(saved.status, 200);
      assert.equal(saved.headers.get("X-Data-State"), "stale");
      assert.equal(saved.headers.get("X-NHL-Checked-At"), checked);
      assert.equal(saved.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await saved.json(), expected);
    }
    for (const permanent of ["403", "429", "302", "bad"]) {
      mode = permanent;
      const denied = await onRequestGet(request("2026-10-20"));
      assert.equal(denied.status, 502);
      assert.equal(denied.headers.get("Cache-Control"), "no-store");
    }
    mode = "503";
    assert.equal(
      (await onRequestGet(request("2026-10-21"))).status,
      502,
      "Another date cannot use the saved game day",
    );
    now = Date.parse(checked) + 86400001;
    assert.equal(
      (await onRequestGet(request("2026-10-20"))).status,
      502,
      "Expired last-good data is never refreshed by fallback use",
    );
  } finally {
    global.fetch = originalFetch;
    global.caches = originalCaches;
    Date.now = originalNow;
  }
});


test("score adapters retain official shots without turning missing shots into zero", async () => {
  const raw = rawGame();
  raw.awayTeam.sog = 30;
  raw.homeTeam.sog = 0;
  const normalized = GameScores.normalize({currentDate:"2026-10-20",games:[raw]});
  assert.equal(normalized.games[0].away.shots,30);
  assert.equal(normalized.games[0].home.shots,0);
  delete raw.homeTeam.sog;
  assert.equal(GameScores.normalize({currentDate:"2026-10-20",games:[raw]}).games[0].home.shots,null);
  const originalFetch=global.fetch,originalCaches=global.caches;
  try {
    global.caches=undefined;
    global.fetch=async()=>Response.json({currentDate:"2026-10-20",games:[raw]});
    const response=await (await handler).onRequestGet({request:new Request("https://test/api/games?date=2026-10-20")});
    const data=await response.json();
    assert.equal(data.games[0].away.shots,30);
    assert.equal(data.games[0].home.shots,null);
  } finally {global.fetch=originalFetch;global.caches=originalCaches;}
});

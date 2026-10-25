// Fixed official NHL score endpoint; never a user-supplied upstream URL.
import { addGameShots } from "../../lib/game-shots.js";
import { normalizeScoreGoals } from "../../lib/game-goals.js";
const lastGoodMaxAge = 24 * 60 * 60 * 1000;
export async function onRequestGet({ request }) {
  const date = new URL(request.url).searchParams.get("date") || "";
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    return Response.json({ error: "Invalid game date." }, { status: 400 });
  const cache = globalThis.caches?.default;
  const key = new Request(new URL("/api/games-v2?date=" + date, request.url));
  const lastGoodKey = new Request(
    new URL("/api/games-last-good-v2?date=" + date, request.url),
  );
  if (cache) {
    try {
      const saved = await cache.match(key);
      if (saved) return saved;
    } catch {}
  }
  let stage = "connection",
    upstreamStatus = null;
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/score/${date}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json" },
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: { "200-299": 30, "300-599": 0 },
      },
    });
    stage = "http";
    upstreamStatus = response.status;
    if (!response.ok) throw Error("NHL score source unavailable");
    stage = "schema";
    const raw = await response.json();
    if (
      raw.currentDate !== date ||
      !Array.isArray(raw.games) ||
      raw.games.length > 20
    )
      throw Error("Invalid NHL score response");
    const seen = new Set();
    const games = raw.games.map((g) => {
      if (
        !Number.isSafeInteger(g.id) ||
        seen.has(g.id) ||
        !Number.isFinite(Date.parse(g.startTimeUTC)) ||
        !["FUT", "PRE", "LIVE", "CRIT", "FINAL", "OFF"].includes(g.gameState)
      )
        throw Error("Invalid NHL game");
      seen.add(g.id);
      const team = (t) => {
        if (!/^[A-Z]{2,3}$/.test(t?.abbrev)) throw Error("Invalid NHL team");
        return {
          code: t.abbrev,
          score: Number.isInteger(t.score) && t.score >= 0 ? t.score : null,
          shots: Number.isInteger(t.sog) && t.sog >= 0 ? t.sog : null,
        };
      };
      return {
        id: g.id,
        start: g.startTimeUTC,
        state: g.gameState,
        scheduleState: g.gameScheduleState || "OK",
        away: team(g.awayTeam),
        home: team(g.homeTeam),
        period: Number.isInteger(g.periodDescriptor?.number)
          ? g.periodDescriptor.number
          : null,
        periodType: g.periodDescriptor?.periodType || "",
        clock:
          typeof g.clock?.timeRemaining === "string" &&
          /^\d{1,2}:\d{2}$/.test(g.clock.timeRemaining)
            ? g.clock.timeRemaining
            : "",
        intermission: g.clock?.inIntermission === true,
        outcome: g.gameOutcome?.lastPeriodType || "",
        goalDetails: normalizeScoreGoals(g),
      };
    });
    await addGameShots(games);
    const currentEasternDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const settled =
      date < currentEasternDay &&
      games.every((game) => ["OFF", "FINAL"].includes(game.state) && [game.away,game.home].every(team => Number.isInteger(team.shots)));
    const result = Response.json(
      { date, games },
      {
        headers: {
          "Cache-Control": settled
            ? "public, max-age=300, s-maxage=21600"
            : "public, max-age=15, s-maxage=30",
          "X-Data-Source": "NHL",
          "X-Data-State": "fresh",
          "X-NHL-Checked-At": new Date().toISOString(),
        },
      },
    );
    if (cache) {
      try {
        const saved = result.clone();
        saved.headers.set("Cache-Control", "public, max-age=86400");
        await Promise.allSettled([
          cache.put(key, result.clone()),
          cache.put(lastGoodKey, saved),
        ]);
      } catch {}
    }
    return result;
  } catch {
    if (
      cache &&
      (stage === "connection" || (stage === "http" && upstreamStatus >= 500))
    ) {
      try {
        const saved = await cache.match(lastGoodKey);
        const age =
          Date.now() - Date.parse(saved?.headers.get("X-NHL-Checked-At"));
        if (saved?.ok && age >= 0 && age <= lastGoodMaxAge) {
          const headers = new Headers(saved.headers);
          headers.set("X-Data-State", "stale");
          headers.set("Cache-Control", "no-store");
          headers.set("Warning", '110 - "Response is stale"');
          return new Response(saved.body, { headers });
        }
      } catch {}
    }
    return Response.json(
      { error: "NHL scores are temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

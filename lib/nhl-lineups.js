import teamSlugs from "./dfo-teams.js";

// NHL's own editorial projections. Position order is published, never inferred.
const labels = {
  ANA: "Ducks",
  BOS: "Bruins",
  BUF: "Sabres",
  CGY: "Flames",
  CAR: "Hurricanes",
  CHI: "Blackhawks",
  COL: "Avalanche",
  CBJ: "Blue Jackets",
  DAL: "Stars",
  DET: "Red Wings",
  EDM: "Oilers",
  FLA: "Panthers",
  LAK: "Kings",
  MIN: "Wild",
  MTL: "Canadiens",
  NSH: "Predators",
  NJD: "Devils",
  NYI: "Islanders",
  NYR: "Rangers",
  OTT: "Senators",
  PHI: "Flyers",
  PIT: "Penguins",
  SJS: "Sharks",
  SEA: "Kraken",
  STL: "Blues",
  TBL: "Lightning",
  TOR: "Maple Leafs",
  UTA: "Mammoth",
  VAN: "Canucks",
  VGK: "Golden Knights",
  WSH: "Capitals",
  WPG: "Jets",
};
const teamCodes = Object.fromEntries(
  Object.entries(labels).map(([code, label]) => [label.toLowerCase(), code]),
);
const clean = (value) =>
  value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_]/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
function nhlDay(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type).value)
    .join("-");
}
function dailyUrl(now = Date.now()) {
  const date = new Date(now),
    year = date.getUTCFullYear() - (date.getUTCMonth() < 6 ? 1 : 0);
  return `https://www.nhl.com/news/nhl-lineup-projections-${year}-${String(year + 1).slice(-2)}-season`;
}
function parseArticle(html, sourceUrl, now = Date.now(), gameDate = null) {
  if (
    typeof html !== "string" ||
    html.length > 2000000 ||
    !/^https:\/\/www\.nhl\.com\/news\/[a-z0-9-]+$/.test(sourceUrl)
  )
    throw Error("Invalid NHL lineup article.");
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)]
    .find((m) => /\brel=["']canonical["']/i.test(m[0]))?.[0]
    .match(/\bhref=["']([^"']+)["']/i)?.[1];
  if (canonical !== sourceUrl) throw Error("Unexpected NHL article URL.");
  const articles = [];
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]);
      for (const item of Array.isArray(value)
        ? value
        : value["@graph"] || [value]) {
        if (
          item?.["@type"] === "NewsArticle" &&
          typeof item.articleBody === "string" &&
          (!item.url || item.url === sourceUrl)
        )
          articles.push(item);
      }
    } catch {}
  }
  if (articles.length !== 1)
    throw Error("NHL lineup article structure changed.");
  const article = articles[0],
    updated = article.dateModified || article.datePublished,
    time = Date.parse(updated);
  if (
    !Number.isFinite(time) ||
    time > now + 600000 ||
    now - time > 7 * 86400000
  )
    throw Error("NHL lineup article is outdated.");
  const body = article.articleBody;
  const headings = [
    ...body.matchAll(/(?:\*\*|^)([A-Za-z ]+?) projected lineup\*\*[^\n]*\n/gi),
  ];
  const teams = {};
  for (let i = 0; i < headings.length; i++) {
    const code = teamCodes[headings[i][1].trim().toLowerCase()];
    if (!code) continue;
    const start = headings[i].index + headings[i][0].length;
    const section = body.slice(start, headings[i + 1]?.index ?? body.length);
    const lines = [];
    for (const raw of section.split(/\r?\n/)) {
      const line = clean(raw);
      if (!line) continue;
      if (
        /^(?:Scratched|Injured|Status report)\s*:?/i.test(line) ||
        /^#{1,6}\s/.test(line)
      )
        break;
      lines.push(line.split(/\s*(?:-{2,}|[—–])\s*/).map(clean));
    }
    const forwards = lines.slice(0, 4);
    // Editorial projections end in the two goalie names. A lone seventh
    // defenseman before them remains an incomplete defensive row, not a goalie.
    const defense = lines.slice(4, -2),
      goalies = lines.slice(-2);
    const validName = (name) =>
      name.length > 1 &&
      name.length <= 100 &&
      /^[\p{L}\p{M} .’'\-]+$/u.test(name);
    if (
      forwards.length !== 4 ||
      forwards.some((r) => r.length < 2 || r.length > 3) ||
      defense.length < 3 ||
      defense.length > 4 ||
      defense.some((r) => r.length < 1 || r.length > 2) ||
      (defense.length === 4 &&
        (forwards.flat().length !== 11 ||
          defense.slice(0, 3).some((r) => r.length !== 2) ||
          defense[3].length !== 1)) ||
      goalies.length !== 2 ||
      goalies.some((r) => r.length !== 1) ||
      !lines.flat().every(validName)
    )
      continue;
    if (
      [forwards, defense, goalies].some((group) => {
        const names = group.flat().map((n) => n.toLowerCase());
        return new Set(names).size !== names.length;
      })
    )
      continue;
    const slug = teamSlugs[code];
    if (teams[slug]) throw Error("Duplicate NHL team projection.");
    teams[slug] = {
      forwards,
      defense,
      goalies,
      pp1: [],
      pp2: [],
      source_url: sourceUrl,
      updated_at: updated,
      game_date: gameDate || nhlDay(time),
    };
  }
  if (!Object.keys(teams).length)
    throw Error("No verified NHL lineup rows found.");
  return { source: "nhl.com", updated_at: updated, teams };
}
function previewCandidates(schedule, code, today) {
  if (!Object.hasOwn(teamSlugs, code) || !Array.isArray(schedule?.gameWeek))
    throw Error("Invalid NHL schedule.");
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const earliest = Date.parse(today) - 6 * 86400000;
  return schedule.gameWeek
    .flatMap((day) =>
      Array.isArray(day.games)
        ? day.games.map((game) => ({ ...game, gameDate: day.date }))
        : [],
    )
    .filter(
      (g) =>
        /^20\d{2}-\d{2}-\d{2}$/.test(g.gameDate) &&
        g.gameDate <= today &&
        Date.parse(g.gameDate) >= earliest &&
        [g.awayTeam?.abbrev, g.homeTeam?.abbrev].includes(code) &&
        Object.hasOwn(teamSlugs, g.awayTeam?.abbrev) &&
        Object.hasOwn(teamSlugs, g.homeTeam?.abbrev),
    )
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate))
    .slice(0, 2)
    .map((g) => {
      const [year, month, day] = g.gameDate.split("-").map(Number);
      return {
        date: g.gameDate,
        url: `https://www.nhl.com/news/${teamSlugs[g.awayTeam.abbrev]}-${teamSlugs[g.homeTeam.abbrev]}-game-preview-${months[month - 1]}-${day}-${year}`,
      };
    });
}
export { teamSlugs, nhlDay, dailyUrl, parseArticle, previewCandidates };

const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../static/published-lines.js");
const now = Date.parse("2026-10-19T16:00:00Z");
const entry = {
  forwards: [
    ["Jake Guentzel", "Brayden Point", "Gage Goncalves"],
    ["Dominic James", "Conor Geekie"],
  ],
  defense: [["Victor Hedman", "Erik Cernak"]],
  goalies: [["Andrei Vasilevskiy"]],
  pp1: [
    "Jake Guentzel",
    "Brayden Point",
    "Gage Goncalves",
    "Victor Hedman",
    "Erik Cernak",
  ],
  pp2: [],
};
const feed = () => ({
  source: "dailyfaceoff.com",
  updated_at: "2026-10-19 14:45:21 UTC",
  teams: { "tampa-bay-lightning": structuredClone(entry) },
});
const roster = [
  {
    id: 8478010,
    name: "Brayden Point",
    first: "Brayden",
    last: "Point",
    group: "F",
  },
];
const parse = (data) =>
  PublishedLines.parse(data, roster, "tampa-bay-lightning", "TBL", now);
test("published lineup preserves rows, partial lines, Point NHL ID and PP source order", () => {
  const x = parse(feed());
  assert.equal(x.forwards[0][1], 8478010);
  assert.equal(x.forwards[1].length, 2);
  assert.equal(x.pp[0][1], 8478010);
  assert.deepEqual(x.pk, []);
  assert.equal(x.extra.length, 7);
  assert.equal(x.updated, "2026-10-19T14:45:21Z");
  assert.ok(PublishedLines.valid(x));
});
test("unidentified source names get no invented NHL ID or portrait", () => {
  const x = parse(feed());
  const p = x.extra.find((p) => p.name === "Jake Guentzel");
  assert.equal(p.id, "dfo:jakeguentzel");
  assert.equal(p.image, "");
});
test("rejects wrong source, missing timestamp, future, old or malformed published data", () => {
  for (const mutate of [
    (x) => (x.source = "other"),
    (x) => delete x.updated_at,
    (x) => (x.updated_at = "2027-01-01 00:00:00 UTC"),
    (x) => (x.updated_at = "2026-10-01 00:00:00 UTC"),
    (x) => x.teams["tampa-bay-lightning"].forwards[0].push("Extra Player"),
    (x) => (x.teams["tampa-bay-lightning"].forwards[0][0] = "Brayden Point"),
  ]) {
    const x = feed();
    mutate(x);
    assert.throws(() => parse(x));
  }
  assert.equal(
    PublishedLines.valid({ ...parse(feed()), type: "nhl-last-game" }),
    false,
  );
});

test("verified Nicholas Robertson alias resolves only to Nick's NHL roster ID", () => {
  const data = feed();
  data.teams["tampa-bay-lightning"].forwards[0][0] = "Nicholas Robertson";
  const nick = {
    id: 8481582,
    name: "Nick Robertson",
    first: "Nick",
    last: "Robertson",
    group: "F",
    number: 14,
    image: "verified-headshot",
  };
  const known = PublishedLines.parse(
    data,
    [...roster, nick],
    "tampa-bay-lightning",
    "TBL",
    now,
  );
  assert.equal(known.forwards[0][0], 8481582);
  assert.ok(!known.extra.some((p) => p.name === "Nicholas Robertson"));
  const absent = PublishedLines.parse(
    data,
    roster,
    "tampa-bay-lightning",
    "TBL",
    now,
  );
  assert.equal(absent.forwards[0][0], "dfo:nicholasrobertson");
  const otherRobertson = { ...nick, id: 8480027, name: "Jason Robertson" };
  assert.equal(
    PublishedLines.parse(
      data,
      [...roster, otherRobertson],
      "tampa-bay-lightning",
      "TBL",
      now,
    ).forwards[0][0],
    "dfo:nicholasrobertson",
  );
  const recovered = PublishedLines.reconcile(absent, [...roster, nick]);
  assert.equal(recovered.forwards[0][0], 8481582);
  assert.equal(recovered.updated, absent.updated);
  assert.deepEqual(recovered.forwards[0].slice(1), absent.forwards[0].slice(1));
  assert.equal(
    absent.forwards[0][0],
    "dfo:nicholasrobertson",
    "Saved source snapshot stays immutable",
  );
  assert.ok(!recovered.extra.some((p) => p.id === "dfo:nicholasrobertson"));
});

test("Jacob and Jake Middleton resolve to one NHL player, including saved source rows", () => {
  const data = feed();
  data.teams["tampa-bay-lightning"].defense[0][0] = "Jacob Middleton";
  const jake = { id: 8478136, name: "Jake Middleton", group: "D" };
  const resolved = PublishedLines.parse(
    data,
    [...roster, jake],
    "tampa-bay-lightning",
    "TBL",
    now,
  );
  assert.equal(resolved.defense[0][0], 8478136);
  assert.ok(!resolved.extra.some((p) => p.name === "Jacob Middleton"));
  const saved = PublishedLines.parse(
    data,
    roster,
    "tampa-bay-lightning",
    "TBL",
    now,
  );
  const recovered = PublishedLines.reconcile(saved, [...roster, jake]);
  assert.equal(recovered.defense[0][0], 8478136);
  assert.ok(!recovered.extra.some((p) => p.id === "dfo:jacobmiddleton"));
  assert.equal(recovered.updated, saved.updated);
});
test("official NHL localized name variants match without fuzzy nickname guessing", () => {
  const data = feed();
  data.teams["tampa-bay-lightning"].forwards[0][0] = "Official Alternate";
  const verified = {
    id: 1234567,
    name: "Official Default",
    nameAliases: ["Official Alternate"],
    group: "F",
  };
  const resolved = PublishedLines.parse(
    data,
    [...roster, verified],
    "tampa-bay-lightning",
    "TBL",
    now,
  );
  assert.equal(resolved.forwards[0][0], 1234567);
});

test("Verified source-name variants reconcile with single NHL IDs, including cached rows", () => {
  for (const [sourceName, id, officialName] of [
    ["Gabriel Perreault", 8484210, "Gabe Perreault"],
    ["Gabe Perraault", 8484210, "Gabe Perreault"],
    ["Gabe Perrreault", 8484210, "Gabe Perreault"],
    ["Max Shabanov", 8485702, "Maxim Shabanov"],
    ["Matt Kessel", 8482516, "Matthew Kessel"],
    ["Vinni Letteri", 8479968, "Vinni Lettieri"],
    ["Alaiksei Protas", 8481656, "Aliaksei Protas"],
    ["Gabe Perreault", 8484210, "Gabriel Perreault"],
    ["Alex Kerfoot", 8477021, "Alexander Kerfoot"],
    ["Alexander Kerfoot", 8477021, "Alex Kerfoot"],
    ["Zack Boulduc", 8482737, "Zachary Bolduc"],
    ["Zack Bolduc", 8482737, "Zachary Bolduc"],
    ["Zach Bolduc", 8482737, "Zachary Bolduc"],
    ["Johnny Brodzinski", 8477380, "Jonny Brodzinski"],
    ["Jonathan Brodzinski", 8477380, "Jonny Brodzinski"],
    ["Jonathon Brodzinski", 8477380, "Jonny Brodzinski"],
  ]) {
    const data = feed();
    data.teams["tampa-bay-lightning"].forwards[0][0] = sourceName;
    const official = { id, name: officialName, group: "F" };
    const resolved = PublishedLines.parse(
      data,
      [...roster, official],
      "tampa-bay-lightning",
      "TBL",
      now,
    );
    assert.equal(resolved.forwards[0][0], id, sourceName);
    assert.ok(
      !resolved.extra.some(
        (p) => p.name.toLowerCase() === sourceName.toLowerCase(),
      ),
    );
    const saved = PublishedLines.parse(
      data,
      roster,
      "tampa-bay-lightning",
      "TBL",
      now,
    );
    const recovered = PublishedLines.reconcile(saved, [...roster, official]);
    assert.equal(recovered.forwards[0][0], id);
    assert.equal(recovered.extra.length, saved.extra.length - 1);
    assert.equal(recovered.updated, saved.updated);
  }
});

test("Josh and Joshua Mahura resolve to the same NHL ID, also in cached lineups", () => {
  const mahura = { id: 8479372, name: "Josh Mahura", group: "D" };
  for (const name of ["Josh Mahura", "Joshua Mahura"]) {
    const data = feed();
    data.teams["tampa-bay-lightning"].defense[0][0] = name;
    const parsed = PublishedLines.parse(
      data,
      [...roster, mahura],
      "tampa-bay-lightning",
      "TBL",
      now,
    );
    assert.equal(parsed.defense[0][0], mahura.id);
    const saved = PublishedLines.parse(
      data,
      roster,
      "tampa-bay-lightning",
      "TBL",
      now,
    );
    const restored = PublishedLines.reconcile(saved, [...roster, mahura]);
    assert.equal(restored.defense[0][0], mahura.id);
    assert.ok(!restored.extra.some((p) => /mahura/i.test(p.name)));
  }
  assert.equal(
    PublishedLines.matchingPlayer("Joshua Mahura", [
      { id: 123, name: "Josh Mahura", group: "D" },
    ]),
    undefined,
  );
});

test("official full first names combine with the default surname without guessing nicknames", () => {
  const p = {
    id: 8471214,
    firstName: { default: "Alex", sk: "Alexander" },
    lastName: { default: "Ovechkin", sk: "Ovečkin" },
  };
  const names = PublishedLines.rosterNames(p);
  assert.ok(names.includes("Alexander Ovechkin"));
  assert.ok(names.includes("Alex Ovečkin"));
  assert.equal(
    PublishedLines.matchingPlayer("Alexander Ovechkin", [
      { id: p.id, name: "Alex Ovechkin", nameAliases: names },
    ]).id,
    p.id,
  );
  assert.equal(
    PublishedLines.matchingPlayer("Alexander Unknown", [
      { id: p.id, name: "Alex Unknown" },
    ]),
    undefined,
  );
});

test("identical names remain distinct NHL players and use lineup group only when unambiguous", () => {
  const players = [
    { id: 8480012, name: "Elias Pettersson", group: "F" },
    { id: 8483678, name: "Elias Pettersson", group: "D" },
  ];
  assert.equal(
    PublishedLines.matchingPlayer("Elias Pettersson", players, "F").id,
    8480012,
  );
  assert.equal(
    PublishedLines.matchingPlayer("Elias Pettersson", players, "D").id,
    8483678,
  );
  assert.equal(
    PublishedLines.matchingPlayer("Elias Pettersson", players),
    undefined,
  );
  const data = feed();
  data.teams["tampa-bay-lightning"].forwards[0][0] = "Elias Pettersson";
  data.teams["tampa-bay-lightning"].defense[0][0] = "Elias Pettersson";
  data.teams["tampa-bay-lightning"].pp1[0] = "Elias Pettersson";
  const resolved = PublishedLines.parse(
    data,
    [...roster, ...players],
    "tampa-bay-lightning",
    "TBL",
    now,
  );
  assert.equal(resolved.forwards[0][0], 8480012);
  assert.equal(resolved.defense[0][0], 8483678);
  assert.equal(resolved.pp[0][0], "dfo:eliaspettersson");
  const cached = PublishedLines.reconcile(resolved, [...roster, ...players]);
  assert.equal(
    cached.pp[0][0],
    "dfo:eliaspettersson",
    "A cached special-team slot must not guess which namesake played",
  );
});

test("repair cached source IDs even when the extra index or unmatched flag was lost", () => {
  const data = feed();
  data.teams["tampa-bay-lightning"].defense[0][0] = "Jacob Middleton";
  const cached = PublishedLines.parse(
    data,
    roster,
    "tampa-bay-lightning",
    "TBL",
    now,
  );
  const placeholder = cached.extra.find((p) => p.name === "Jacob Middleton");
  const jake = { id: 8478136, name: "Jake Middleton", group: "D" };
  delete placeholder.unmatched;
  cached.extra = [];
  for (const players of [
    [...roster, jake, placeholder],
    [...roster, jake],
  ]) {
    const restored = PublishedLines.reconcileState(cached, players);
    assert.equal(restored.lineData.defense[0][0], jake.id);
    assert.ok(!restored.players.some((p) => p.id === placeholder.id));
    assert.equal(restored.players.filter((p) => p.id === jake.id).length, 1);
    assert.equal(restored.lineData.updated, cached.updated);
  }
});

test("official NHL projections retain source/game date and reject an untrusted source URL", () => {
  const data = feed();
  data.source = "nhl.com";
  Object.assign(data.teams["tampa-bay-lightning"], {
    source_url:
      "https://www.nhl.com/news/nhl-lineup-projections-2026-27-season",
    updated_at: data.updated_at,
    game_date: "2026-10-19",
  });
  const result = parse(data);
  assert.equal(result.type, "published-nhl");
  assert.equal(result.projectionDate, "2026-10-19");
  assert.match(result.sourceUrl, /^https:\/\/www\.nhl\.com\/news\//);
  assert.ok(PublishedLines.valid(result));
  data.teams["tampa-bay-lightning"].source_url = "https://evil.test/news/fake";
  assert.throws(() => parse(data));
  assert.equal(
    PublishedLines.valid({ ...result, sourceUrl: "javascript:alert(1)" }),
    false,
  );
});

test("verified source spelling mistakes resolve to the correct current-roster identity", () => {
  const roster = [
    { id: 8482702, name: "Logan Stankoven", group: "F" },
    { id: 8476958, name: "Jaccob Slavin", group: "D" },
    { id: 8479968, name: "Vinni Lettieri", group: "F" },
    { id: 8482700, name: "Nolan Allan", group: "D" },
  ];
  for (const [name, id, group] of [
    ["Logan Stankhoven", 8482702, "F"],
    ["Jacob Slavin", 8476958, "D"],
    ["Vinnie Lettieri", 8479968, "F"],
    ["Nolan Allen", 8482700, "D"],
  ])
    assert.equal(
      globalThis.PublishedLines.matchingPlayer(name, roster, group)?.id,
      id,
    );
  assert.equal(
    globalThis.PublishedLines.matchingPlayer("Other Slavin", roster, "D"),
    undefined,
  );
});


test("Mitch and Mitchell Gibson match exactly and duplicate goalie aliases collapse",()=>{
 const goalie={id:9000001,name:"Mitch Gibson",first:"Mitch",last:"Gibson",group:"G"};
 assert.equal(PublishedLines.matchingPlayer("Mitchell Gibson",[goalie],"G").id,goalie.id);
 assert.equal(PublishedLines.matchingPlayer("Mitch Gibson",[goalie],"G").id,goalie.id);
 assert.equal(PublishedLines.matchingPlayer("John Gibson",[goalie],"G"),undefined);
 const data=feed();data.teams["tampa-bay-lightning"].goalies=[["Mitch Gibson"],["Mitchell Gibson"]];
 const parsed=PublishedLines.parse(data,[...roster,goalie],"tampa-bay-lightning","TBL",now);
 assert.deepEqual(parsed.goalies,[goalie.id]);
 const old=structuredClone(parsed);old.goalies=["dfo:mitchgibson","dfo:mitchellgibson"];
 old.extra.push({id:"dfo:mitchgibson",name:"Mitch Gibson",first:"Mitch",last:"Gibson",group:"G"},{id:"dfo:mitchellgibson",name:"Mitchell Gibson",first:"Mitchell",last:"Gibson",group:"G"});
 assert.deepEqual(PublishedLines.reconcile(old,[...roster,goalie]).goalies,[goalie.id]);
 assert.deepEqual(PublishedLines.reconcile(old,roster).goalies,["dfo:mitchgibson"]);
});

test("Tampa names separated without spaces stay individual players, including old caches",()=>{
 const data=feed();data.teams["tampa-bay-lightning"].forwards[0]=["Jake Guentzel","Gage Goncalves-- Brayden Point"];
 const parsed=parse(data);
 assert.deepEqual(parsed.forwards[0],["dfo:jakeguentzel","dfo:gagegoncalves",8478010]);
 assert.ok(!parsed.extra.some(p=>p.name.includes("--")));
 const old=parse(feed());old.forwards[0]=["dfo:jakeguentzel","dfo:gagegoncalvesbraydenpoint"];
 old.extra.push({id:"dfo:gagegoncalvesbraydenpoint",name:"Gage Goncalves-- Brayden Point",first:"Gage Goncalves-- Brayden",last:"Point",group:"F"});
 const repaired=PublishedLines.reconcileState(old,roster);
 assert.deepEqual(repaired.lineData.forwards[0],["dfo:jakeguentzel","dfo:gagegoncalves",8478010]);
 assert.ok(!repaired.players.some(p=>p.id==="dfo:gagegoncalvesbraydenpoint"));
});

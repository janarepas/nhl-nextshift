/* Adapt public name-based lineup rows without calculating or reordering units. */
(function (root) {
  const norm = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .replace(/^mitchellgibson$/, "mitchgibson");
  const splitNames = value => String(value).split(/\s*(?:-{2,}|[—–])\s*/).map(name=>name.trim());
  // Explicit, verified source-name aliases only; never match by surname alone.
  const aliases = Object.freeze({
    nicholasrobertson: 8481582,
    loganstankhoven: 8482702,
    jacobslavin: 8476958,
    vinnielettieri: 8479968,
    nolanallen: 8482700,
    eliasnpettersson: 8483678,
    joshmahura: 8479372,
    joshuamahura: 8479372,
    jacobmiddleton: 8478136,
    jakemiddleton: 8478136,
    gabrielperreault: 8484210,
    gabeperreault: 8484210,
    gabeperraault: 8484210,
    gabeperrreault: 8484210,
    maxshabanov: 8485702,
    mattkessel: 8482516,
    vinniletteri: 8479968,
    alaikseiprotas: 8481656,
    alexkerfoot: 8477021,
    alexanderkerfoot: 8477021,
    zackboulduc: 8482737,
    zackbolduc: 8482737,
    zachbolduc: 8482737,
    zacharybolduc: 8482737,
    jonnybrodzinski: 8477380,
    johnnybrodzinski: 8477380,
    jonathanbrodzinski: 8477380,
    jonathonbrodzinski: 8477380,
  });
  // NHL translations can use a full first name and a transliterated surname.
  // Accept their combinations too (e.g. Alexander + Ovechkin).
  function rosterNames(player) {
    const first = Object.values(player.firstName || {}).filter(
      (v) => typeof v === "string" && v.trim(),
    );
    const last = Object.values(player.lastName || {}).filter(
      (v) => typeof v === "string" && v.trim(),
    );
    return [...new Set(first.flatMap((f) => last.map((l) => `${f} ${l}`)))];
  }
  function matchingPlayer(name, roster, group) {
    const key = norm(name);
    const candidates = roster.filter(
      (p) =>
        Number.isSafeInteger(p.id) &&
        (norm(p.name) === key ||
          p.nameAliases?.some((alias) => norm(alias) === key) ||
          p.id === aliases[key]),
    );
    const unique = [...new Map(candidates.map((p) => [p.id, p])).values()];
    if (unique.length === 1) return unique[0];
    // Identical names are not necessarily identical people. Only a known
    // lineup position can disambiguate; special teams have no reliable group.
    const positional = unique.filter((p) => group && p.group === group);
    return positional.length === 1 ? positional[0] : undefined;
  }
  function reconcile(data, roster) {
    if (!valid(data)) return data;
    const copy = structuredClone(data);
    // Repair old saved placeholders containing an unseparated pair of names.
    for(const [key,group,width] of [["forwards","F",3],["defense","D",2]]) {
      copy[key]=copy[key].map(row=>{
        const expanded=row.flatMap(id=>{
          if(typeof id!=="string")return [id];
          const entry=copy.extra.find(player=>player.id===id);
          const parts=splitNames(entry?.name || id.replace(/^dfo:/,""));
          if(parts.length<2 || parts.some(name=>!name || !/^[\p{L}\p{M} .’'\-]+$/u.test(name)))return [id];
          return parts.map(name=>{
            const player=matchingPlayer(name,roster,group);
            if(player)return player.id;
            const sourceId="dfo:"+norm(name),words=name.split(/\s+/);
            if(!copy.extra.some(player=>player.id===sourceId))copy.extra.push({id:sourceId,name,first:words.slice(0,-1).join(" "),last:words.at(-1),number:"—",pos:"—",group,image:"",unmatched:true});
            return sourceId;
          });
        });
        return expanded.length<=width ? expanded : row;
      });
    }
    const replacements = new Map();
    const allIds = [
      copy.forwards.flat(),
      copy.defense.flat(),
      copy.goalies,
      copy.pp.flat(),
      copy.pk.flat(),
    ].flat();
    const metadata = new Map([...roster, ...copy.extra].map((p) => [p.id, p]));
    for (const id of new Set(allIds.filter((id) => typeof id === "string"))) {
      const p = metadata.get(id);
      const groups = [
        ["forwards", "F"],
        ["defense", "D"],
        ["goalies", "G"],
      ]
        .filter(([key]) => copy[key].flat().includes(id))
        .map(([, group]) => group);
      const match = matchingPlayer(
        p?.name || id.replace(/^dfo:/, ""),
        roster,
        groups.length === 1 ? groups[0] : null,
      );
      if (match) replacements.set(id, match.id);
      else if(typeof id==="string" && id.startsWith("dfo:") && norm(p?.name || id.slice(4))==="mitchgibson" && id!=="dfo:mitchgibson") {
        replacements.set(id,"dfo:mitchgibson");
        if(p && !copy.extra.some(player=>player.id==="dfo:mitchgibson"))copy.extra.push({...p,id:"dfo:mitchgibson"});
      }
    }
    // Older snapshots can have source IDs in rows but no corresponding extra
    // record. Repair the rows themselves, rather than trusting that index.
    copy.extra = copy.extra.filter((p) => !replacements.has(p.id));
    for (const key of ["forwards", "defense", "pp", "pk"])
      copy[key] = copy[key].map((row) =>
        row.map((id) => replacements.get(id) ?? id),
      );
    copy.goalies = [...new Set(copy.goalies.map((id) => replacements.get(id) ?? id))];
    return copy;
  }
  function reconcileState(data, players) {
    const lineData = reconcile(data, players);
    if (!valid(lineData)) return { lineData, players };
    const used = new Set(
      [
        lineData.forwards.flat(),
        lineData.defense.flat(),
        lineData.goalies,
        lineData.pp.flat(),
        lineData.pk.flat(),
      ].flat(),
    );
    const unique = new Map();
    for (const p of [...players, ...lineData.extra]) {
      // Provisional records are source placeholders, even in old caches that
      // did not save the unmatched flag. Do not render obsolete placeholders.
      if (typeof p.id === "string" && !used.has(p.id)) continue;
      if (!unique.has(p.id)) unique.set(p.id, p);
    }
    return { lineData, players: [...unique.values()] };
  }
  const sourceUrl =
    "https://github.com/hg913488/nhl-line-combos-app/blob/main/data/lines.json";
  function parse(data, roster, slug, team, now = Date.now()) {
    const official = data?.source === "nhl.com";
    const entry = data?.teams?.[slug];
    const publishedUrl = official ? entry?.source_url : sourceUrl;
    if (
      official &&
      (!/^https:\/\/www\.nhl\.com\/news\/[a-z0-9-]+$/.test(
        publishedUrl || "",
      ) ||
        !/^20\d{2}-\d{2}-\d{2}$/.test(entry?.game_date || ""))
    )
      throw Error("Invalid official NHL lineup source.");
    const updated = String(
      (official ? entry?.updated_at : data?.updated_at) || "",
    )
      .replace(" ", "T")
      .replace(" UTC", "Z");
    const time = Date.parse(updated);
    if (
      (!official && data?.source !== "dailyfaceoff.com") ||
      !Number.isFinite(time) ||
      time > now + 600000 ||
      now - time > 7 * 86400000
    )
      throw Error("Missing or outdated published lineup data.");
    if (!entry)
      throw Error("Published line combinations are missing for this team.");
    const extra = new Map();
    const player = (name, group, matchGroup) => {
      if (typeof name !== "string" || !name.trim() || name.length > 100)
        throw Error("Invalid player name in the feed.");
      const match = matchingPlayer(name, roster, matchGroup);
      if (match) return match.id;
      const id = "dfo:" + norm(name);
      if (!extra.has(id)) {
        const words = name
          .trim()
          .toLocaleLowerCase()
          .replace(/(^|[ .'-])\p{L}/gu, (s) => s.toLocaleUpperCase())
          .split(/\s+/);
        extra.set(id, {
          id,
          name: words.join(" "),
          first: words.slice(0, -1).join(" "),
          last: words.at(-1),
          number: "—",
          pos: "—",
          group,
          image: "",
          customImage: "",
          tsn: "",
          unmatched: true,
        });
      }
      return id;
    };
    const rows = (value, width, maxRows, group, matchGroup = group) => {
      if (!Array.isArray(value) || value.length > maxRows)
        throw Error("Invalid lineup structure in the feed.");
      return value.map((row) => {
        if (!Array.isArray(row))throw Error("Invalid unit size in the feed.");
        const names=row.flatMap(name=>typeof name==="string" ? splitNames(name) : [name]);
        if(names.length<1 || names.length>width)throw Error("Invalid unit size in the feed.");
        const ids = names.map((name) => player(name, group, matchGroup));
        if (new Set(ids).size !== ids.length)
          throw Error("Duplicate player in a unit.");
        return ids;
      });
    };
    const forwards = rows(entry.forwards, 3, 4, "F"),
      defense = rows(entry.defense, 2, 4, "D");
    const goalies = [...new Set(rows(entry.goalies, 1, 3, "G").flat())];
    const pp = rows(
      [entry.pp1, entry.pp2].filter((row) => Array.isArray(row) && row.length),
      5,
      2,
      "F",
      null,
    );
    const pk = rows(
      [entry.pk1, entry.pk2].filter((row) => Array.isArray(row) && row.length),
      4,
      2,
      "F",
      null,
    );
    for (const ids of [forwards.flat(), defense.flat(), goalies])
      if (new Set(ids).size !== ids.length)
        throw Error("Duplicate player in the feed.");
    if (!forwards.length || !defense.length)
      throw Error("The feed contains no usable line combinations.");
    return {
      version: 1,
      type: official ? "published-nhl" : "published-dfo",
      ...(official ? { projectionDate: entry.game_date } : {}),
      team,
      forwards,
      defense,
      goalies,
      pp,
      pk,
      extra: [...extra.values()],
      updated,
      sourceUrl: publishedUrl,
    };
  }
  function valid(data) {
    if (
      !["published-dfo", "published-nhl"].includes(data?.type) ||
      (data.type === "published-nhl" &&
        (!/^https:\/\/www\.nhl\.com\/news\/[a-z0-9-]+$/.test(
          data.sourceUrl || "",
        ) ||
          !/^20\d{2}-\d{2}-\d{2}$/.test(data.projectionDate || ""))) ||
      data.version !== 1 ||
      !Number.isFinite(Date.parse(data.updated)) ||
      !Array.isArray(data.extra)
    )
      return false;
    const id = (v) =>
      Number.isSafeInteger(v) ||
      (typeof v === "string" && /^dfo:[a-z0-9]+$/.test(v));
    return (
      [
        ["forwards", 3, 4],
        ["defense", 2, 4],
        ["pp", 5, 2],
        ["pk", 4, 2],
      ].every(
        ([key, width, max]) =>
          Array.isArray(data[key]) &&
          data[key].length <= max &&
          data[key].every(
            (row) =>
              Array.isArray(row) &&
              row.length > 0 &&
              row.length <= width &&
              row.every(id),
          ),
      ) &&
      Array.isArray(data.goalies) &&
      data.goalies.length <= 3 &&
      data.goalies.every(id)
    );
  }
  root.PublishedLines = {
    parse,
    valid,
    reconcile,
    reconcileState,
    rosterNames,
    matchingPlayer,
  };
})(typeof window !== "undefined" ? window : globalThis);

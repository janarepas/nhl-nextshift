/* NHL game-day scores. No per-second clocks, hidden-tab polling or player-cache use. */
(function (root) {
  // Reuse locale formatters across score cards and visibility refreshes.
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formats = new Map();
  function formatter(kind, zone, options) {
    const key = kind + ":" + zone;
    if (!formats.has(key)) {
      if (formats.size >= 16) formats.delete(formats.keys().next().value);
      formats.set(
        key,
        new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone }),
      );
    }
    return formats.get(key);
  }
  function day(now = new Date(), zone = localZone) {
    const parts = formatter("day", zone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const value = (type) => parts.find((p) => p.type === type).value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  }
  // NHL schedules use Eastern calendar days, even after midnight in Budapest.
  function resultDay(now = new Date()) {
    const date = new Date(day(now, "America/New_York") + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }
  function nextResultChange(now = Date.now()) {
    const current = day(new Date(now), "America/New_York");
    let low = now,
      high = now + 26 * 3600000;
    // A single boundary timer also covers the 23/25-hour daylight-saving days.
    while (high - low > 1000) {
      const middle = Math.floor((low + high) / 2);
      if (day(new Date(middle), "America/New_York") === current) low = middle;
      else high = middle;
    }
    return high;
  }
  function normalize(raw) {
    if (!raw?.currentDate || !Array.isArray(raw.games)) return raw;
    return {
      date: raw.currentDate,
      games: raw.games.map((g) => ({
        id: g.id,
        start: g.startTimeUTC,
        state: g.gameState,
        scheduleState: g.gameScheduleState || "OK",
        away: {
          code: g.awayTeam?.abbrev,
          score: Number.isInteger(g.awayTeam?.score) ? g.awayTeam.score : null,
          shots: Number.isInteger(g.awayTeam?.sog) && g.awayTeam.sog >= 0 ? g.awayTeam.sog : null,
        },
        home: {
          code: g.homeTeam?.abbrev,
          score: Number.isInteger(g.homeTeam?.score) ? g.homeTeam.score : null,
          shots: Number.isInteger(g.homeTeam?.sog) && g.homeTeam.sog >= 0 ? g.homeTeam.sog : null,
        },
        period: g.periodDescriptor?.number || null,
        periodType: g.periodDescriptor?.periodType || "",
        clock: g.clock?.timeRemaining || "",
        intermission: g.clock?.inIntermission === true,
        outcome: g.gameOutcome?.lastPeriodType || "",
        ...(root.GameGoalData
          ? { goalDetails: root.GameGoalData.normalizeScore(g) }
          : {}),
      })),
    };
  }
  function valid(data, date) {
    return (
      data?.date === date &&
      Array.isArray(data.games) &&
      data.games.length <= 20 &&
      new Set(data.games.map((g) => g.id)).size === data.games.length &&
      data.games.every(
        (g) =>
          Number.isSafeInteger(g.id) &&
          Number.isFinite(Date.parse(g.start)) &&
          ["FUT", "PRE", "LIVE", "CRIT", "FINAL", "OFF"].includes(g.state) &&
          [g.away, g.home].every(
            (t) =>
              /^[A-Z]{2,3}$/.test(t?.code) &&
              (t.score === null || (Number.isInteger(t.score) && t.score >= 0)),
          ),
      )
    );
  }
  const storageKey = "nextshift-scores-v1",
    maxSavedAge = 86400000;
  function savedScores(date) {
    try {
      const record = JSON.parse(localStorage.getItem(storageKey));
      const age = Date.now() - record?.at;
      return age >= 0 && age <= maxSavedAge && valid(record?.data, date)
        ? record
        : null;
    } catch {
      return null;
    }
  }
  const live = (g) => ["LIVE", "CRIT"].includes(g.state);
  function status(game, zone) {
    if (game.scheduleState === "PPD") return "Postponed";
    if (game.scheduleState === "CNCL") return "Cancelled";
    if (["OFF", "FINAL"].includes(game.state))
      return (
        "Final" +
        (["OT", "SO"].includes(game.outcome) ? ` · ${game.outcome}` : "")
      );
    if (live(game)) {
      const period =
        game.periodType === "SO"
          ? "SO"
          : game.periodType === "OT"
            ? "OT"
            : game.period
              ? `P${game.period}`
              : "Live";
      return (
        period +
        (game.intermission
          ? " · Intermission"
          : game.clock
            ? ` · ${game.clock}`
            : "")
      );
    }
    // Include the local date: an NHL game day can start the next day in Europe.
    return formatter("start", zone, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(game.start));
  }
  function interval(data) {
    if (data?.games.some(live)) return 60000;
    if (data?.games.some((g) => ["FUT", "PRE"].includes(g.state)))
      return 300000;
    if (data?.games.some(g => ["FINAL","OFF"].includes(g.state) && [g.away,g.home].some(t => t.shots == null))) return 300000;
    return 21600000;
  }
  function mount() {
    const section = document.querySelector("#daily-games");
    if (!section) return;
    const escape = (text) =>
      String(text).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    const zone = "Europe/Budapest";
    let visible = true,
      timer = null,
      active = null,
      data = null,
      checked = 0,
      dataAt = 0,
      stale = false,
      failed = false;
    const goals = root.GameGoalPopover?.mount(section, () => ({
      games: data?.games || [],
      stale,
      at: dataAt,
    }));
    const saved = savedScores(resultDay());
    if (saved) {
      data = saved.data;
      dataAt = saved.at;
      stale = true;
    }
    const schedule = () => {
      clearTimeout(timer);
      timer = null;
      if (!document.hidden && visible && !active)
        timer = setTimeout(
          load,
          Math.max(
            1000,
            Math.min(
              checked + (failed ? 300000 : interval(data)) - Date.now(),
              nextResultChange() - Date.now() + 100,
            ),
          ),
        );
    };
    function render() {
      if (
        data &&
        (data.date !== resultDay() ||
          (stale && Date.now() - dataAt > maxSavedAge))
      )
        data = null;
      const date = data?.date || resultDay();
      const heading = document.querySelector("#games-date");
      heading.dateTime = date;
      heading.textContent = formatter("heading", "UTC", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(date + "T12:00:00Z"));
      LineDOM.text(
        "#games-updated",
        data && stale ? "Saved scores" : failed ? "Refresh unavailable" : "",
      );
      if (!data) {
        LineDOM.update(
          "#games-list",
          `<p class="games-message">${failed ? 'Scores unavailable.<button class="games-retry" type="button">Retry</button>' : "Loading previous game results…"}</p>`,
        );
        goals?.refresh();
        return;
      }
      LineDOM.update(
        "#games-list",
        data.games.length
          ? data.games
              .map((g) => {
                const label =
                  stale && live(g) ? "Saved score" : status(g, zone);
                const start = formatter("result-start", zone, {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                }).format(new Date(g.start));
                const side = (t) => {
                  const played =
                    t.score !== null && !["FUT", "PRE"].includes(g.state);
                  const score = played
                    ? `<button class="game-score" type="button" data-game="${g.id}" data-team="${escape(t.code)}" aria-label="${escape(t.code)} ${t.score} ${t.score === 1 ? "goal" : "goals"}. Show goal scorers" aria-expanded="false" aria-controls="game-goal-tooltip">${t.score}</button>`
                    : '<strong class="game-score" aria-label="Not started">—</strong>';
                  const color = typeof teams !== "undefined" ? teams.find(team => team[0] === t.code)?.[2] : null;
                  const safeColor = /^#[a-f0-9]{6}$/i.test(color || "") ? color : "#42454a";
                  const logo = `https://assets.nhle.com/logos/nhl/svg/${t.code}_${document.documentElement.dataset.theme === "dark" ? "dark" : "light"}.svg`;
                  return `<div class="game-side" style="--game-team-color:${safeColor}"><img class="game-team-watermark" src="${logo}" alt="" loading="lazy" decoding="async" aria-hidden="true"><span class="game-team"><img src="${logo}" alt="" loading="lazy" decoding="async" width="70" height="70"><span class="game-team-code">${escape(t.code)}</span></span>${score}</div>`;
                };
                const stateLabel =
                  ["FUT", "PRE"].includes(g.state) &&
                  !["PPD", "CNCL"].includes(g.scheduleState)
                    ? "Scheduled"
                    : label;
                const running = !stale && live(g) && !["PPD", "CNCL"].includes(g.scheduleState);
                const regularPeriod = g.period ? `${g.period}${g.period === 1 ? "st" : g.period === 2 ? "nd" : g.period === 3 ? "rd" : "th"}` : "Live";
                const periodLabel = running ? (g.periodType === "SO" ? "SO" : g.periodType === "OT" ? "OT" : regularPeriod) : stateLabel;
                const clockLabel = running ? (g.intermission ? "INT" : g.clock || "—")
                  : ["OFF", "FINAL"].includes(g.state) ? (["OT", "SO"].includes(g.outcome) ? g.outcome : "FT")
                  : ["FUT", "PRE"].includes(g.state) && !["PPD", "CNCL"].includes(g.scheduleState) ? formatter("score-start", zone, { hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).format(new Date(g.start)) : "—";
                const shots = (t) => !["FUT", "PRE"].includes(g.state) && Number.isInteger(t.shots) && t.shots >= 0 ? t.shots : "—";
                return `<article class="game-card${running ? " is-live" : ""}" data-game="${g.id}" aria-label="${escape(g.away.code)} versus ${escape(g.home.code)}. ${escape(label)}"><div class="game-clock-panel"><span class="game-status">${escape(periodLabel)}</span><span class="game-clock">${escape(clockLabel)}</span><time class="game-date" datetime="${escape(g.start)}" title="Start time in Europe/Budapest · NHL game day: ${date}">${escape(start)}</time></div><div class="game-matchup">${side(g.away)}${side(g.home)}</div><div class="game-shots" aria-label="Shots on goal"><span class="game-shot game-shot-away" aria-label="${escape(g.away.code)} shots on goal">${shots(g.away)}</span><span class="game-sog">SOG</span><span class="game-shot game-shot-home" aria-label="${escape(g.home.code)} shots on goal">${shots(g.home)}</span></div></article>`;
              })
              .join("")
          : `<p class="games-message">${stale ? "No games in the saved schedule." : "No NHL games scheduled for this game day."}</p>`,
      );
      goals?.refresh();
    }
    async function load() {
      if (document.hidden || !visible || active) return;
      clearTimeout(timer);
      timer = null;
      const date = resultDay();
      if (data && (data.date !== date || Date.now() - dataAt > maxSavedAge)) {
        data = null;
        render();
      }
      const controller = new AbortController();
      active = controller;
      const timeout = setTimeout(() => controller.abort(), 18000);
      try {
        const response = await fetch(`/api/games?date=${date}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw Error("Scores unavailable");
        const result = normalize(await response.json());
        if (!valid(result, date)) throw Error("Invalid scores");
        const savedState = response.headers.get("X-Data-State") === "stale";
        const sourceTime = Date.parse(response.headers.get("X-NHL-Checked-At"));
        if (
          savedState &&
          (!Number.isFinite(sourceTime) ||
            Date.now() - sourceTime > maxSavedAge ||
            sourceTime > Date.now())
        )
          throw Error("Invalid saved score date");
        data = result;
        stale = savedState;
        dataAt = Number.isFinite(sourceTime) ? sourceTime : Date.now();
        if (!stale) {
          try {
            localStorage.setItem(
              storageKey,
              JSON.stringify({ data, at: dataAt }),
            );
          } catch {}
        }
        failed = stale;
      } catch {
        failed = true;
        if (!data) {
          try {
            const response = await fetch("/game-snapshot.json", {
              signal: AbortSignal.timeout?.(4000),
            });
            if (response.ok) {
              const saved = await response.json(),
                at = Date.parse(saved.checkedAt),
                age = Date.now() - at;
              if (
                saved.version === 1 &&
                age >= 0 &&
                age <= maxSavedAge &&
                valid(saved.data, date)
              ) {
                data = saved.data;
                dataAt = at;
              }
            }
          } catch {}
        }
        stale = !!data;
      } finally {
        clearTimeout(timeout);
        active = null;
        checked = Date.now();
        if (!document.hidden) render();
        // An Eastern midnight changes the previous NHL game day independently of Budapest.
        if (date !== resultDay()) load();
        else schedule();
      }
    }
    section.addEventListener("click", (event) => {
      if (event.target.closest(".games-retry")) load();
    });
    const resume = () => {
      if (!document.hidden && visible) render();
      if (
        !document.hidden &&
        visible &&
        (!checked ||
          resultDay() !== data?.date ||
          Date.now() - checked >= (failed ? 300000 : interval(data)))
      )
        load();
      else schedule();
    };
    document.addEventListener("visibilitychange", resume);
    if (typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        resume();
      });
      observer.observe(section);
    }
    render();
    load();
  }
  root.GameScores = {
    day,
    resultDay,
    nextResultChange,
    normalize,
    valid,
    status,
    interval,
    mount,
  };
})(globalThis);

// Synthetic fixtures: production bundle, mobile fresh-cache/feed-failure path and PK fallback.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 393, height: 852 },
      timezoneId: "Europe/Budapest",
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-24T09:00:00Z") });
    await page.addInitScript(() =>
      localStorage.setItem("blueline-v2", JSON.stringify({ team: "ANA" })),
    );
    const specs = [
      ["Adam", "Forward", "F"],
      ["Ben", "Forward", "F"],
      ["Cam", "Forward", "F"],
      ["Dan", "Defense", "D"],
      ["Eli", "Defense", "D"],
      ["Lukas", "Dostal", "G"],
      ["Ville", "Husso", "G"],
    ];
    const roster = { forwards: [], defensemen: [], goalies: [] };
    specs.forEach(([first, last, group], i) =>
      roster[
        group === "F" ? "forwards" : group === "D" ? "defensemen" : "goalies"
      ].push({
        id: 8471000 + i,
        firstName: { default: first },
        lastName: { default: last },
        positionCode: group,
        sweaterNumber: i + 1,
        birthCountry: "CAN",
        shootsCatches: "L",
        headshot: `https://assets.nhle.com/test/${i}.png`,
      }),
    );
    let scoreRequests = 0,
      depthRequests = 0,
      scoreMode = "games";
    const scoreDates = [];
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/games") {
        scoreRequests++;
        if (scoreMode === "error")
          return route.fulfill({ status: 502, json: { error: "Unavailable" } });
        const date = url.searchParams.get("date");
        scoreDates.push(date);
        return route.fulfill({
          json: {
            date,
            games:
              scoreMode === "empty"
                ? []
                : Array.from({ length: 11 }, (_, i) => ({
                    id: 2026020000 + i,
                    start: date + "T23:00:00Z",
                    state: i === 1 ? "LIVE" : i === 2 ? "OFF" : "FUT",
                    scheduleState: "OK",
                    away: { code: "ANA", score: i === 0 ? null : 2, shots: i === 0 ? null : 30 },
                    home: { code: "BOS", score: i === 0 ? null : 1, shots: i === 0 ? null : 21 },
                    period: 2,
                    periodType: "REG",
                    clock: "12:20",
                    intermission: false,
                    outcome: i === 2 ? "SO" : "",
                  })),
          },
        });
      }
      if (url.pathname === "/api/lineups")
        return route.fulfill({
          status: 502,
          headers: { "X-Line-Error": "feed-http" },
          body: "Published source returned 404",
        });
      if (url.pathname === "/api/nhl") {
        const path = url.searchParams.get("path");
        if (path.startsWith("roster/")) return route.fulfill({ json: roster });
        if (path.startsWith("club-stats/"))
          return route.fulfill({
            json: {
              season: 20262027,
              gameType: 2,
              skaters: [...roster.forwards, ...roster.defensemen].map((p) => ({
                playerId: p.id,
                firstName: p.firstName,
                lastName: p.lastName,
                gamesPlayed: 18,
                goals: 4,
                assists: 6,
                points: 10,
              })),
            },
          });
        if (path.includes("/game-log/"))
          return route.fulfill({
            json: {
              gameLog: Array.from({ length: 5 }, (_, i) => ({
                gameDate: new Date(Date.now() - i * 86400000)
                  .toISOString()
                  .slice(0, 10),
                goals: 1,
                assists: 0,
                shotsAgainst: 30,
                goalsAgainst: 2,
                toi: "60:00",
                decision: "W",
              })),
            },
          });
        return route.fulfill({
          json: { forwards: [], defensemen: [], goalies: [] },
        });
      }
      if (url.pathname === "/api/leaders")
        return route.fulfill({ json: { points: [] } });
      if (url.pathname === "/api/injuries")
        return route.fulfill({ json: { injuries: [] } });
      if (url.pathname === "/api/penalty-kill")
        return route.fulfill({
          body: '<h1>NHL Penalty Kill Depth Charts</h1><div class="depth-charts__block"><div class="depth-charts__team"><img alt="ANA"></div><div class="depth-charts__paywall-text">Subscription required</div></div>',
        });
      if (url.pathname === "/api/special-teams") {
        depthRequests++;
        const f = (name) => ({ name, group: "F" }),
          d = (name) => ({ name, group: "D" });
        return route.fulfill({
          json: {
            team: url.searchParams.get("team"),
            source: "ESPN",
            sourceUrl: "https://www.espn.com/nhl/team/depth/_/id/25",
            pp: [
              [
                f("Adam Forward"),
                f("Ben Forward"),
                f("Cam Forward"),
                d("Dan Defense"),
                d("Eli Defense"),
              ],
              [
                f("Adam Forward"),
                f("Ben Forward"),
                f("Unknown Source Player"),
                d("Dan Defense"),
                d("Eli Defense"),
              ],
            ],
            pk: [
              [
                f("Adam Forward"),
                f("Ben Forward"),
                d("Dan Defense"),
                d("Eli Defense"),
              ],
              [
                f("Cam Forward"),
                f("Unknown Source Player"),
                d("Dan Defense"),
                d("Eli Defense"),
              ],
            ],
          },
        });
      }
      return route.fulfill({ status: 404, body: "Unknown fixture request" });
    });
    await page.route("https://assets.nhle.com/**", (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      }),
    );
    await page.goto(process.env.NHL_TEST_BASE_URL || "http://127.0.0.1:3166");
    await page.waitForFunction(() => !loading && pendingForms.size === 0);
    await page.waitForSelector(".game-card");
    assert.equal(await page.locator(".game-card").count(), 11);
    assert.equal(scoreRequests, 1);
    assert.deepEqual(
      scoreDates,
      ["2026-10-23"],
      "Results default to the previous New York NHL game day",
    );
    assert.equal(depthRequests, 0);
    assert.deepEqual(await page.locator('.game-card').nth(1).locator('.game-shot').allTextContents(), ['30', '21']);
    assert.deepEqual(await page.locator('.game-card').first().locator('.game-shot').allTextContents(), ['—', '—']);
    assert.match(await page.locator('.game-team-watermark').first().evaluate(el => getComputedStyle(el).filter), /blur/);
    assert.equal(await page.locator("#games-updated").innerText(), "");
    assert.match(
      await page.locator("#games-date").textContent(),
      /23 Oct.*2026/,
    );
    assert.ok(
      await page.locator("#games-date").isHidden(),
      "The NHL source date remains available without adding a visible heading",
    );
    assert.equal(await page.locator("#games-calendar-note").count(), 0);
    assert.match(
      await page.locator(".game-date").first().innerText(),
      /24 Oct.*2026.*01:00/,
    );
    assert.deepEqual(
      await page.locator("#forwards .position-labels span").allTextContents(),
      ["", "LW", "C", "RW"],
    );
    assert.equal(
      await page
        .locator(".game-card")
        .first()
        .locator(".game-score")
        .first()
        .innerText(),
      "—",
    );
    assert.match(
      await page.locator(".game-card").nth(1).innerText(),
      /2nd[\s\S]*12:20/,
    );
    assert.match(
      await page.locator(".game-card").nth(2).innerText(),
      /Final · SO/,
    );
    assert.deepEqual(
      await page
        .locator(".game-card")
        .nth(3)
        .locator(".game-score")
        .allTextContents(),
      ["—", "—"],
      "Unplayed future games never display their raw scores as completed results",
    );
    assert.doesNotMatch(
      await page.locator(".game-card").nth(3).innerText(),
      /Final/,
    );
    assert.equal(
      await page.locator(".nhl-game-link").count(),
      0,
      "Result cards omit the visible NHL source label",
    );
    assert.doesNotMatch(
      await page.locator(".game-card").first().innerText(),
      /NHL|Budapest/,
    );
    assert.equal(
      await page.locator("#forward-lines .roster-grid .player-card").count(),
      3,
    );
    assert.equal(
      await page.locator("#defense-lines .roster-grid .player-card").count(),
      2,
    );
    assert.equal(
      await page.locator("#goalie-lines .roster-grid .player-card").count(),
      2,
    );
    assert.equal(
      await page.locator(".line-row,.goalie-slot").count(),
      0,
      "No manufactured lines, pairs or goalie order",
    );
    assert.equal(
      await page.locator('[data-roster-group="scratched"]').count(),
      0,
    );
    assert.equal(await page.locator("#lineup-notice").count(), 0);
    assert.match(
      await page.locator("#forward-lines .player-stats").first().innerText(),
      /18 GP/,
    );
    for (const width of [320, 393, 820, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "No page overflow at " + width,
      );
      assert.ok(
        await page
          .locator("#games-list")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        "Every score card wraps into the page without horizontal scrolling at " +
          width,
      );
      assert.ok(
        await page
          .locator(".game-score")
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 47.9),
        "Score numerals have prominent readable size at " + width,
      );
      assert.ok(
        await page
          .locator(".game-card")
          .first()
          .evaluate((el) => {
            const date = el.querySelector(".game-date").getBoundingClientRect();
            const clock = el.querySelector(".game-clock").getBoundingClientRect();
            const matchup = el.querySelector(".game-matchup").getBoundingClientRect();
            return date.left >= clock.left && date.right <= matchup.left + 1 && date.bottom <= el.getBoundingClientRect().bottom + 1;
          }),
        "The actual match date stays below the clock within the left panel at " + width,
      );
      assert.equal(await page.locator('#games-list').evaluate(el=>getComputedStyle(el).display), 'grid');
      if(width>=820){
        const cards=await page.locator('.game-card').evaluateAll(es=>es.slice(0,2).map(e=>e.getBoundingClientRect().toJSON()));
        assert.equal(cards[0].top,cards[1].top,'Desktop scorecards share the first row');
        assert.ok(cards[1].left>=cards[0].right,'Desktop scorecards sit side by side');
      }
      await page.evaluate(()=>document.documentElement.dataset.theme='light');
      assert.equal(await page.locator('.game-card').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
      assert.notEqual(await page.locator('.game-clock').first().evaluate(el=>getComputedStyle(el).color),'rgb(243, 240, 232)');
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
      assert.equal(await page.locator('.game-card').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
      const goalieLayout = await page.evaluate(() => {
        const grid = document.querySelector("#goalie-lines .roster-grid");
        const outer = document.querySelector("#goalie-lines");
        const cards = [...grid.querySelectorAll(".player-card")];
        const rects = cards.map((el) => el.getBoundingClientRect());
        const portraits = cards.map((el) =>
          el.querySelector(".player-portrait").getBoundingClientRect(),
        );
        return {
          fullWidth:
            grid.getBoundingClientRect().width >= outer.clientWidth - 64,
          separate: rects[0].right <= rects[1].left,
          portraitsSeparate: portraits[0].right <= portraits[1].left,
          contained: portraits.every(
            (r, i) => r.left >= rects[i].left && r.right <= rects[i].right,
          ),
        };
      });
      assert.ok(
        goalieLayout.fullWidth,
        "Goalie roster spans both slots at " + width,
      );
      assert.ok(
        goalieLayout.separate &&
          goalieLayout.portraitsSeparate &&
          goalieLayout.contained,
        "Goalie cards and portraits do not overlap at " + width,
      );
      assert.ok(
        await page
          .locator("#forward-lines .player-portrait")
          .first()
          .evaluate((el) => el.getBoundingClientRect().height >= 90),
        "Portrait visible at " + width,
      );
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector(".brand").getBoundingClientRect().bottom <=
            document.querySelector("#daily-games").getBoundingClientRect().top,
        ),
        "Scores follow the brand at " + width,
      );
    }
    assert.equal(
      await page
        .locator(".scroll-glass")
        .evaluate((el) => getComputedStyle(el).backdropFilter),
      "none",
      "Touch scrolling avoids a fixed backdrop blur",
    );
    const brand = await page.evaluate(() => ({
      header: getComputedStyle(document.querySelector(".brand-next")).fontStyle,
      footer: getComputedStyle(
        document.querySelector(".footer-brand .brand-next"),
      ).fontStyle,
      copy: getComputedStyle(document.querySelector(".site-about")).color,
      logo: getComputedStyle(document.querySelector(".footer-name")).color,
    }));
    assert.equal(brand.header, "italic");
    assert.equal(brand.footer, "italic");
    assert.equal(brand.copy, brand.logo);
    await page.locator("#tab-pk").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#special-heading").textContent ===
        "Penalty kill units",
    );
    assert.equal(depthRequests, 1);
    assert.equal(await page.locator(".pk-box .player-card").count(), 8);
    assert.equal(
      await page.locator(".pk-unit").count(),
      2,
      "Explicit ESPN unit ranks produce two PK units",
    );
    assert.match(
      await page.locator("#special-lines").innerText(),
      /Unknown Source\s+Player/,
    );
    assert.doesNotMatch(
      await page.locator("#special-lines").innerText(),
      /Published unit ranks/,
    );
    for (const width of [320, 393, 820]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "PK fallback fits " + width,
      );
    }
    await page.locator(".brand").scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    const before = scoreRequests;
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(120000);
    assert.equal(scoreRequests, before, "No score polling in hidden tabs");
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".game-card").length === 11,
    );
    await page.waitForTimeout(100);
    assert.equal(scoreRequests, before + 1, "Stale scores refresh on return");
    // Separate fresh page distinguishes unavailable source from an empty schedule.
    scoreMode = "error";
    const page2 = await browser.newPage({
      timezoneId: "Europe/Budapest",
      reducedMotion: "reduce",
    });
    await page2.clock.install({ time: new Date("2026-10-24T09:00:00Z") });
    await page2.route("**/api/games?**", (route) => {
      const date = new URL(route.request().url()).searchParams.get("date");
      return scoreMode === "error"
        ? route.fulfill({ status: 502, json: { error: "Unavailable" } })
        : route.fulfill({ json: { date, games: [] } });
    });
    await page2.route("**/game-snapshot.json", (route) =>
      route.fulfill({ status: 404, body: "No saved score fixture" }),
    );
    await page2.route("**/api/nhl?**", (route) =>
      route.fulfill({ status: 502, json: { error: "Unavailable" } }),
    );
    await page2.route("**/api/lineups*", (route) =>
      route.fulfill({ status: 502, body: "Unavailable" }),
    );
    await page2.route("**/api/leaders", (route) =>
      route.fulfill({ json: { points: [] } }),
    );
    await page2.route("**/api/injuries", (route) =>
      route.fulfill({ json: { injuries: [] } }),
    );
    await page2.goto(process.env.NHL_TEST_BASE_URL || "http://127.0.0.1:3166");
    await page2.waitForSelector(".games-retry");
    assert.match(
      await page2.locator("#games-list").innerText(),
      /Scores unavailable/,
    );
    scoreMode = "empty";
    await page2.locator(".games-retry").click();
    await page2.waitForFunction(() =>
      document
        .querySelector("#games-list")
        .textContent.includes("No NHL games scheduled"),
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: "/tmp/nextshift-mobile-pk.png",
      fullPage: false,
    });
    console.log(
      "PASS: daily games and European times, mobile fresh-cache roster fallback and statistics, 32-team PK depth fallback semantics, no false PK units/scratches, no overflow, italic branding, footer colors, hidden polling pause and honest score failure/empty states.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

# NHL Next Shift

Letisztult, magyar nyelvű NHL-sorösszeállító: támadósorok, védőpárok és kapusok egy oldalon. Rust HTTP-szerver és HTML/CSS/JavaScript felület. Cloudflare Pages-en a statikus felületet Pages Functions API-adapter egészíti ki.

## Frontend build és optimalizálás

A HTML forrása `src/index.html`, a CSS/JavaScript olvasható forrásai a `static/`
könyvtárban vannak. Módosítás után `npm ci` és `npm run build` készíti el a
verziózott, tömörített `static/assets/` fájlokat és a `static/index.html` oldalt.
A generált fájlokat is commitolni kell; a Pages közvetlenül ezeket szolgálja ki.
A [teljesítmény- és SEO-leírás](docs/performance-and-seo.md) tartalmazza a mérést,
a gyorsítótárazási működést, a teszteket és a keresőoptimalizálás korlátait.

## Helyi indítás

Rust stable, curl és a tesztekhez Node.js 20+ szükséges.

```sh
cargo run --locked
```

Alapértelmezett cím: `0.0.0.0:3000`, a `NHL_BIND` változóval módosítható. Az alkalmazás nem igényel külső Rust crate-eket vagy API-kulcsot.

```sh
cargo test --locked
node --test tests/*.test.cjs
```

## Automatikus soradatok: hivatalos NHL.com-előrejelzések

A `/api/lineups?team=ANA` a hivatalos NHL.com várható sorbeosztásait adja vissza kis, csapatspecifikus JSON-ként. A szerver először az NHL napi összesítőjének strukturált cikkadatait dolgozza fel. Ha abban még nincs az adott csapat, a hivatalos hétnapos menetrendből megkeresi a legutóbbi két meccsét, és a hozzájuk tartozó NHL-meccselőzetes közölt sorait olvassa. A cikk kódját nem futtatja, és az oldal HTML-je nem kerül a böngészőbe.

A feldolgozott napi cikk, menetrend, meccselőzetes és csapatválasz öt percig közös Cloudflare edge-cache-ben van; az egyidejű azonos lekérések is összevonódnak. A böngésző csak a kiválasztott csapatot kéri le (kétperces HTTP-cache), nincs külön soradat-polling vagy új böngészős könyvtár. A régi, 404-es GitHub-feedet nem kéri többé a felület.

A forrás sorrendje változatlan. A dátum a forrás cikkének tényleges frissítési ideje; a meccs dátuma külön látszik. Korábbi meccs előrejelzése egyértelműen korábbiként jelenik meg, nem aznapi megerősített összeállításként. A kapusok címkéi Projected Starter / Projected Backup, régebbi meccsnél Previous projected. A 11 támadós, 7 védős összeállítás magányos hetedik védője a Fourth defense sorba kerül, nem a kapusokhoz; a kétfős támadósor ilyenkor szándékos, nem hiányos adat. Az NHL-előzetesek nem közölnek teljes PP-egységeket: hiányzó egységet nem találunk ki.

A 2026-10-20-i élő ellenőrzés mind a 32 csapathoz talált feldolgozható, legfeljebb hétnapos hivatalos előrejelzést. A lefedettség forrásfüggő, különösen szünetekben és szezonon kívül. Sikertelen lekérés nem írja felül a mentett sorokat; teljesen hiányzó forrásnál továbbra is egyértelműen jelölt NHL-keretnézet látszik. [Működés és ellenőrzés](docs/nhl-lineup-source.md).

A portrék és statisztikák továbbra is az NHL játékosazonosítójához tartoznak. A régi mentések és igazolt névváltozatok összeegyeztetése megmaradt; hasonló családnevek alapján nincs találgatás.

A 32 csapat a nagy csapatnévről nyíló, kereshető logós listából választható. A név mellett nagy, keret és háttér nélküli csapatlogó látszik. A kapusok közölt sorrendjének címkéi Projected Starter / Projected Backup; a sorrend önmagában nem megerősített kezdőkapus. A felület nyitott, kártyakeretek nélküli elrendezést és nagy rendszerbetűket használ; Apple-eszközökön a platform saját SF betűtípusát. Görgetés nem vált csapatot. A felület alapértelmezett sötét palettája meleg sötétszürke hátteret és visszafogott törtfehér szöveget használ. A fejléc ikonja Light / Dark témát vált; a korábbi vintage beállítás automatikusan Dark-ra vált. Az ikonhátterek átlátszóak, a vektoros ikonok és NHL-logók követik a témát. A színhatást statikus CSS-színek adják, extra képszűrő vagy animáció nélkül. A választást a `nextshift-theme` helyi beállítás őrzi; az első kirajzolás előtt visszaáll, és a témaváltás nem indít adatlekérést. A csapatnév melletti bal/jobb nyíllal az előző/következő klub választható; az első és utolsó csapat között körbeér a lista. Görgetés továbbra sem vált csapatot.

Böngészős regresszió: `NHL_TEST_BASE_URL=http://127.0.0.1:3000 node tests/dfo.browser.cjs`. Ez név alapú feedtesztadatokkal ellenőrzi a füleket, forrássorrendet, dátumozott mentést és hibakezelést; a régi HTML-parser tesztjeit is megtartja. Az éles kapcsolathoz külön tényleges forráskérés szükséges.

## Power Play és Shorthanded: közölt ESPN-unitok

A `/api/special-teams?team=ANA` az ESPN nyilvános depth chartját dolgozza fel szerveren. A játékosok explicit `rank: 1` / `rank: 2` mezője adja az egységtagságot, nem a névsorban elfoglalt hely vagy a statisztikák. A PP1/PP2 öt-öt játékos, a PK unit 1 / PK unit 2 két-két támadó és két-két védő; a PK elrendezésben a támadók felül, a védők alattuk vannak.

A 2026-10-21-i ellenőrzés mind a 32 csapatnál igazolta mindkét PP- és mindkét teljes 2F+2D PK-unitot. Hiányzó vagy hibás rankadatnál nem találunk ki egységtagságot. A két fül közös JSON-t kér, csak az első speciális fül megnyitásakor; a két fül közötti váltás nem kér le új adatot. A szerver összevonja az egyidejű kéréseket, és legfeljebb öt percig gyorsítótárazza a választ. [Részletes működés és ellenőrzés](docs/special-teams-and-dark-mode.md).

A korábbi `/api/penalty-kill` és `/api/pk-depth` adapterek kompatibilitási célra megmaradtak, de az új felület nem tölti le a RotoWire HTML-oldalát, és nem bontja külön forward/defense listákra a PK-t. Az NHL-cikkből esetleg meglévő PP/PK-adat elsőbbsége megmaradt. A játékosstatisztikák napi cache-e ettől független.

## Mozgás és fejléc

A `static/motion.js` kb. 1 másodperces sorbelépést biztosít, a görgetést a böngésző natív működésére bízza. Az animáció a statisztikai újrarajzolásokon át folytatódik, nem indul újra; a csapatlista és a profil saját görgetése natív marad. A `prefers-reduced-motion` letiltja a mozgást. Az üveghatás a fejlécen, a legördülőn, súgókon és profilon jelenik meg, a sorok továbbra is kártyamentesek.

A fejléc jobb oldalán a kiválasztott csapat idényes pontlistavezetője szerepel, holtverseny esetén mindegyik játékos. Adatforrás: NHL `club-stats/{TEAM}/now`; a megjelenített idény és a rájátszás-jelölés is a forrásból származik. Meccs, gól, gólpassz, pont, plusz–mínusz és kapura lövés látható. Hiányzó adatot nem helyettesítünk kitalált számmal. Az ütőfogás kisebb, keretezett jelölést kap.

Önálló mozgásteszt: `node tests/motion.browser.cjs` (Playwright és Chromium szükséges).

## Forma

A teljes 🔥/🧊/👌 formajelöléshez (ikon és szöveg) rámutatásra megjelenő súgó tartozik; billentyűzetfókusszal és érintéssel is elérhető. Nincs külön állandó formamagyarázó blokk. A navigáció, csapatnév, frissítés és állapotok egy rövid, lágy mezmintás fejlécet alkotnak.


Forrás: `/v1/player/{ID}/game-log/now`, az utolsó legfeljebb öt lejátszott meccs. Aktuális hot streak: legalább 3 egymást követő pontszerző mérkőzés, vagy legalább 7 pont pontosan öt meccsen. Pontcsend: az utolsó 3 meccsen nincs pont. A legutóbbi meccsnek az előző 14 naptári napba kell esnie, különben „Korábbi meccsek” jelzés jelenik meg. Kevés vagy hiányos adatnál nem állítunk elő statisztikát. A kapusok statisztikái elsőként töltődnek. A kapusforma az oldal saját SV%-alapú jelölése: legalább 3, legfeljebb 5 legutóbbi meccs és teljes, érvényes lövésadat esetén 🔥 legalább 93%, 🧊 89% alatt, 👌 a kettő között (89% beleértve, 93% nélkül). Régi, kevés vagy hiányos adatnál nincs aktuális formaosztályzat; a meglévő statisztikák láthatók maradnak. A súgó tartalmazza a küszöböket, a hot streak összesítő a kapusokat is számolja. Az utolsó legfeljebb 5 meccs összes lövéséből számolt védési hatékonyság, játékidővel súlyozott GAA (kapott gól / 60 perc) és W–L–OT mérleg jelenik meg. Hiányzó alapadatnál a megfelelő érték nem számítható; nem állítunk elő becslést.

## Cloudflare Pages

Git integration:

| Mező | Érték |
|---|---|
| Production branch | `main` |
| Framework | `None` |
| Build command | üres |
| Root directory | repó gyökere (üres) |
| Output directory | `static` (a wrangler.toml is beállítja) |

A repógyökérben levő `functions/api/` könyvtárat a Pages build automatikusan fordítja. A `static/_routes.json` csak az `/api/*` kéréseket irányítja a Functions-re; a többi fájl statikus. Nem kell külön Rust-szerver a Pages telepítéshez: az ottani API-adapter JavaScript, a helyi/önálló webszerver Rust. A sima `static` mappa feltöltése önmagában nem elég az élő API-hoz: Functions-t tartalmazó Git deployment szükséges.

A Rust fejlesztői szerver ugyanazt az éles `/api/lineups?team=...` adaptert használja, nem tart fenn második HTML-parsert.

Végpontok: `/api/games?date=2026-10-20` (hivatalos NHL napi meccsek), `/api/special-teams?team=ANA` (ESPN PP1/PP2 és PK unit 1/2), `/api/pk-depth?team=ANA` (korábbi ESPN PK depth chart), `/api/penalty-kill` (nyilvános RotoWire PK-adatlap), `/api/lineups?team=ANA` (hivatalos NHL projected lineup JSON), `/api/lines?team=TBL` (korábbi közvetlen Daily Faceoff-adapter), `/health` (csak Rust), `/api/nhl?path=roster%2FEDM%2Fcurrent`, `/api/nhl?path=club-stats%2FSJS%2Fnow`, `/api/nhl?path=player%2F8478402%2Fgame-log%2Fnow`, `/api/portrait?url=...` (korábbi adapter, a felület már nem használja). A proxy kizárólag az engedélyezett NHL-útvonalakat éri el; nem általános URL-proxy.

Hálózati igény: `www.nhl.com`, `api-web.nhle.com`, `api.nhle.com`, `assets.nhle.com`; opcionális TSN-importhoz `www.tsn.ca`, `tsn.ca` és a TSN-oldal által visszaadott kép CDN-je. A Cloudflare fiók Pages Functions/Workers kéréskorlátai érvényesek.

## Élő ellenőrzés

A nyilvános feed 2026-10-19-i állománya mind a 32 csapatot tartalmazta. A helyi Rust-szerver a tényleges feedet és az aktuális hivatalos NHL-keretet együtt szolgálja ki. A közvetlen DFO-letöltés továbbra is 403-mal elutasított; a korábbi HTML-parser önmagában nem igazolt éles kapcsolat.

## Jelzések és sérülésadatok

- 👌 Stabil forma: az utolsó öt meccs pontadatai nem teljesítik a hot streak vagy pontcsend feltételeit.
- 🔝 Az NHL aktuális idényének és a kiválasztott csapatnak a pontlistavezetője: a külön `/api/leaders` végpont az NHL `skater-stats-leaders/current?categories=points&limit=-1` listáját kéri le. A teljes lista `teamAbbrev` mezője szerint külön kiszámítjuk a csapat maximumát. Minden pozitív pontszámmal holtversenyben vezető játékos jelzést kap; a tooltip megkülönbözteti a csapat- és NHL-vezetést. hiányos lista esetén nincs jelölés.
- 🩹 Automatikus külső sérülésjelentés: `/api/injuries`, forrása az ESPN nyilvános NHL injuries feedje (`site.api.espn.com`). Csapat és normalizált teljes név alapján egyeztetünk az NHL aktuális keretével, nem végzünk bizonytalan névhasonlósági találgatást. Külön sorban jelenik meg a 🩹, a sérülés típusa és az ESPN `details.returnDate` alapján a várható visszatérés, illetve hozzávetőleges hátralévő napok száma. A napkülönbség budapesti naptári dátumok szerint számolódik. Hiányzó adatnál nem ismert időpontot jelzünk; lejárt becslést nem állítunk be visszatérésként. A tooltip jelzi a forrást és a becslés jellegét. Felfüggesztést és személyes ok miatti hiányzást nem címkézünk sérülésként.

Az ESPN-jelentés nem helyettesíti az NHL-keretet, és nem ad hozzá az NHL aktuális keretében nem szereplő játékost. A sérülésjelentés és a pontlista minden keretfrissítésnél frissül. Ha a külső forrás nem elérhető vagy a válasz sémája megváltozott, ezt a felület jelzi, és nem mutat megerősítetlen ikonokat. A jelzés hiánya nem igazol egészséges státuszt. Az ESPN éles feedjének strukturált sérüléstípus- és visszatérési dátummezőit ellenőriztük. A megjelenítés és a hiányzó/lejárt dátumok kezelése külön tesztekben is szerepel.

## Forrásletöltési hiba diagnosztikája

A Pages `/api/lines` hiba esetén nem gyorsítótárazható 502 választ küld. Az `X-Line-Error` fejléc különbözteti meg az elutasított hozzáférést (`source-access-denied`), forrásoldali HTTP-hibát, ellenőrző oldalt, átirányítást és hálózati hibát. Az `X-Upstream-Status` az eredeti HTTP-státuszt mutatja, ha rendelkezésre áll. A függvény legfeljebb három HTTPS átirányítást követhet ugyanarra a csapatoldalra a Daily Faceoff saját domainjein. Másik domainre nem lép át, és semmilyen Cloudflare-ellenőrzést nem kerül meg. A felület megjeleníti a konkrét forráshibát.

Az éles Pages adatvégpont 502 válasza és a közvetlen Daily Faceoff-oldal 403-as Cloudflare-elutasítása is megfigyelhető volt. Engedélyezett gépi hozzáférés nélkül a kód módosítása önmagában nem igazolja vagy oldja meg az adatletöltést.

A felső márkajelzés a felhasználó által átadott, helyben kiszolgált `static/nhl-shield.svg`, középre rendezve, alatta Next Shift felirattal. A csapatnév két oldalán léptetőikonok vannak, a névről nyíló kereső saját SVG-chevron jelölést kap. Holtversenyes pontlistavezetőknél egyszerre egy játékos látszik nagy portréval és a saját idényes statisztikájával; az előző/következő gomb és az 1/N számláló minden vezetőhöz eljuttat. A választás megmarad a statisztikák háttérfrissítése alatt, csapatváltáskor nullázódik. A fejléc magassága nem függ a vezetők számától.

Az NHL-proxy a `current`/`now` végpontok hivatalos idény-átirányításait kézzel követi (legfeljebb három átirányítás), kizárólag azonos NHL-hoston, ugyanazon csapat/játékos kanonikus idényvégpontjára. A hibák nem gyorsítótárazhatók; az `X-NHL-Error` és `X-Upstream-Status` fejlécek elkülönítik a kapcsolat-, átirányítás-, HTTP- és formátumhibát. A keretfrissítés és a közölt sorfeed továbbra is külön adatfolyam.

A márkajelzés a pajzs két oldalán Line / Combos felirattal jelenik meg. A felület alatti fehér jéghatás kizárólag finom CSS-árnyalatokból és vonalakból áll. Görgetéskor a képernyő felső szélén dekoratív opálüveg-elmosás jelenik meg; nem fog el kattintást vagy görgetést, és csökkentett mozgás mellett nincs áttűnés.

NHL kéréskorlát (HTTP 429) esetén a proxy a `Retry-After` értékét továbbítja (hiányzó értéknél 60 másodpercet jelez). A böngésző szünetelteti az NHL-lekéréseket, leállítja a további statisztika-feladatokat, és a várakozás után újrapróbál, ha a lap látható. A sikeres NHL-válaszok Cloudflare Cache API-gyorsítótárba kerülnek 5 percre, a hibák nem. A meccsnaplókat két munkafolyamat olvassa, köztük 300 ms szünettel; a meglévő helyi statisztikagyorsítótár továbbra is 10 perces.

A fejlécben nincs kézi frissítésgomb és látható státusz-/forrássáv; az automatikus frissítés és a háttérben kezelt diagnosztikai állapot megmarad. A teljes csapatnév egysoros, levágás és ellipszis nélkül; betűmérete a rendelkezésre álló szélességhez igazodik. Mobilon a csapatlogó a név fölött kap helyet, így a hosszú klubnevek is olvashatók. A csapat- és NHL-logók nagyobbak, a lenyíló ikon a két oldalsó nyíllal azonos vonalas stílusú, körháttér nélkül.

A teljes felület angol nyelvű (`lang=en`): menük, pozíciók, profilok, állapotjelzések, forma- és sérüléssúgók, hibaüzenetek. A dátumok en-GB formátumot, a mérkőzésszámok GP rövidítést használnak. A Left Wing / Center / Right Wing és Left Defense / Right Defense feliratok kompakt, alacsony sorban jelennek meg. A Columbus Blue Jackets teljes nevét 320, 390, 768 és 1440 px szélességen is ellenőrzi a böngészős teszt.

A márkajelzés az NHL-pajzs és a Next Shift név. A csapatnévnél nincs lenyíló nyíl: a név két felére mutatás finom, ±2 px-es irányjelző elmozdulást ad, csapatot nem vált; kattintás a kereshető csapatlistát nyitja. A játékos családneve 4%-kal nagyobb a korábbi méretnél, névre mutatáskor 2,5%-os átmeneti kiemelést kap. Csökkentett mozgás mellett egyik animáció sem fut. A helyi `static/ice-texture.svg` szemcsés, karcolásos fehér jégfelületet ad; szándékosan a lap alsó részén erősebb, a fejléc fehér marad.

A háttér tiszta fehér: a jégtextúra és az SVG-asset eltávolítva. A csapatnév bal/jobb felére mutatva az előző/következő csapat neve finoman, kerékszerű előnézetként becsúszik a név alá; rámutatás nem vált csapatot és nem indít adatlekérést. Az előnézet a képernyőolvasók elől rejtett, érintőképernyőn nem jelenik meg. A már meglévő csapatváltó gombok és a névre kattintással nyíló kereső változatlanul használhatók.

### Daily player-data cache

The browser stores successful NHL rosters, club season statistics, scoring leaders,
and player game logs in IndexedDB for 24 hours per endpoint. Reloading or switching
teams reuses these records; simultaneous reads share a single request. Failed or
invalid responses are never cached. If browser storage is unavailable, the same
cache works in memory for the current page. Published line combinations and injury
reports keep their independent refresh behavior.

Verify persistent storage and expiry with
`NHL_TEST_BASE_URL=http://127.0.0.1:3163 node tests/player-cache.browser.cjs`
against a static server serving `static/`.

Published lineup names missing from the current NHL roster are also checked against
the same team's official NHL prospect list (`prospects/{team}`). Only exact normalized
names or explicitly verified aliases can resolve a source slot. Unrelated prospects
are not added to the displayed roster, published unit membership/order is preserved,
and absent NHL game logs never become invented statistics. Prospect responses share
the 24-hour player-data cache.

Player details request the official NHL `player/{id}/landing` profile only when
opened. Season totals, NHL career totals, playoffs, awards and NHL season history
are displayed separately, with missing fields left absent. Published goalie rates
are used directly; rates from team stints or seasons are not averaged. The profile
uses the same persistent 24-hour cache as other player data.


## Kompakt, Figma-alapú eredményjelző

A főoldal meglévő eredményjelzői 500:200 arányú, legfeljebb 250 × 100 CSS-pixeles megjelenítést kapnak. Az idő és a budapesti meccsdátum balra, az egymás fölé rendezett csapatsávok középen, a kapuralövések jobbra láthatók. A háttérlogók enyhén elmosottak, a csapatszín felülről lefelé sötét átmenetet kap. Az előtérlogók és az eredmény élesek; a gólszerzőket megnyitó eredménygombok megmaradtak.

A FUT/PRE, élő, szünet, OT/SO, végleges, halasztott és mentett állapotok továbbra is forrásadatot mutatnak. A kapuralövés az NHL `sog` mezőjéből származik; hiányzó adatnál „—” jelenik meg. A dizájn nem indít új adatlekérést, és nem tartalmaz látványtervből átvett meccsadatokat. A gyártási méretkeret CSS-re 105 KB, JavaScriptre 100 KB; mindkettőt a buildteszt ellenőrzi.

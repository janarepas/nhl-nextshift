// Enrich only missing shots from the same official game and matching score state.
export async function addGameShots(games) {
  const queue = games.filter(game => ["LIVE","CRIT","FINAL","OFF"].includes(game.state) && [game.away,game.home].some(team => !Number.isInteger(team.shots)));
  const deadline = Date.now() + 4000;
  async function worker() {
    while(queue.length && Date.now() < deadline) {
      const game=queue.shift();
      try {
        const response=await fetch(`https://api-web.nhle.com/v1/gamecenter/${game.id}/boxscore`, {
          redirect:"manual",signal:AbortSignal.timeout(Math.max(1,Math.min(2500,deadline-Date.now()))),
          headers:{Accept:"application/json"},
          cf:{cacheEverything:true,cacheTtlByStatus:{"200-299":["OFF","FINAL"].includes(game.state)?21600:30,"300-599":0}},
        });
        if(!response.ok)continue;
        const data=await response.json();
        if(data.id!==game.id || !["LIVE","CRIT","FINAL","OFF"].includes(data.gameState) || (["FINAL","OFF"].includes(game.state) && !["FINAL","OFF"].includes(data.gameState)))continue;
        if(data.awayTeam?.abbrev!==game.away.code || data.homeTeam?.abbrev!==game.home.code || data.awayTeam.score!==game.away.score || data.homeTeam.score!==game.home.score)continue;
        for(const [team,source] of [[game.away,data.awayTeam],[game.home,data.homeTeam]]) {
          if(team.shots==null && Number.isSafeInteger(source.sog) && source.sog>=0)team.shots=source.sog;
        }
      } catch { /* Scores stay available even when detailed shots are unavailable. */ }
    }
  }
  await Promise.all(Array.from({length:Math.min(4,queue.length)},worker));
}

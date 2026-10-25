const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('lib/game-shots.js','utf8')).toString('base64'));
const game=()=>({id:2026020166,state:'OFF',away:{code:'MTL',score:4,shots:null},home:{code:'CHI',score:1,shots:null}});
test('official boxscore enriches only matching games and preserves unknown shots',async()=>{
 const {addGameShots}=await load,original=global.fetch;
 try{
  global.fetch=async url=>{assert.equal(url,'https://api-web.nhle.com/v1/gamecenter/2026020166/boxscore');return Response.json({id:2026020166,gameState:'OFF',awayTeam:{abbrev:'MTL',score:4,sog:30},homeTeam:{abbrev:'CHI',score:1,sog:0}})};
  const g=game();await addGameShots([g]);assert.equal(g.away.shots,30);assert.equal(g.home.shots,0);
  for(const change of [{id:2026020167},{awayTeam:{abbrev:'NYR',score:4,sog:30}},{homeTeam:{abbrev:'CHI',score:2,sog:21}}]){
   global.fetch=async()=>Response.json({id:2026020166,gameState:'OFF',awayTeam:{abbrev:'MTL',score:4,sog:30},homeTeam:{abbrev:'CHI',score:1,sog:21},...change});
   const g=game();await addGameShots([g]);assert.equal(g.away.shots,null);assert.equal(g.home.shots,null);
  }
  global.fetch=async()=>new Response('Unavailable',{status:503});const failed=game();await addGameShots([failed]);assert.equal(failed.away.score,4);assert.equal(failed.away.shots,null);
  global.fetch=()=>{throw Error('Future or complete games must not fetch')};await addGameShots([{...game(),state:'FUT'},{...game(),away:{code:'MTL',score:4,shots:30},home:{code:'CHI',score:1,shots:21}}]);
 }finally{global.fetch=original}
});

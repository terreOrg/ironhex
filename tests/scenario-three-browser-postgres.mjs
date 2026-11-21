// Isolated, real API + PostgreSQL + three independent Chromium cookie jars.
// Never targets production; CI owns and deletes the ephemeral Docker database.
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {createReadStream} from 'node:fs';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {Game} from '../packages/engine/engine.js';

const webPort=Number(process.env.IRONHEX_REAL_BROWSER_PORT);
const apiPort=Number(process.env.IRONHEX_REAL_API_PORT);
assert(Number.isInteger(webPort)&&webPort>1024&&webPort<65536);
assert(Number.isInteger(apiPort)&&apiPort>1024&&apiPort<65536);
const base='http://127.0.0.1:'+webPort;
const dist=resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.glb':'model/gltf-binary'};
const server=createServer((req,res)=>{
 if(req.url?.startsWith('/api/')){
  const upstream=httpRequest({hostname:'127.0.0.1',port:apiPort,
   path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:'+webPort}},
   response=>{res.writeHead(response.statusCode||502,response.headers);response.pipe(res)});
  upstream.on('error',e=>res.writeHead(502).end('Isolated API unavailable: '+e.code));
  req.pipe(upstream);return;
 }
 let pathname;
 try{pathname=decodeURIComponent(new URL(req.url||'/',base).pathname);}
 catch{res.writeHead(400).end('Bad URL');return;}
 const file=resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(dist+sep)){res.writeHead(403).end('Forbidden');return;}
 const stream=createReadStream(file);
 stream.on('error',()=>res.headersSent?res.destroy():res.writeHead(404).end('Not found'));
 stream.on('open',()=>{
  res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
  stream.pipe(res);
 });
});
server.listen(webPort,'127.0.0.1');
await once(server,'listening');
let browser;
const contexts={},pages={};
const suffix=randomBytes(4).toString('hex'),password='Ch11-Real-Browser-CI-2026!';
async function fetchAs(role,method,path,body,expected=200){
 const response=await contexts[role].request.fetch(base+path,{
  method,headers:method==='GET'?{}:{Origin:base},
  ...(method==='GET'?{}:{data:body??{}})
 });
 const text=await response.text();
 assert.equal(response.status(),expected,
  role+' '+method+' '+path+': '+text.slice(0,1200));
 return JSON.parse(text);
}
const post=(role,path,body,status=200)=>fetchAs(role,'POST',path,body,status);
const get=(role,path)=>fetchAs(role,'GET',path);
function checkedGame(snapshot){
 const game=new Game();
 const {map:_map,rng:_rng,...state}=snapshot;
 Object.assign(game,structuredClone(state));
 game.rebuildMap();
 return game;
}
const tile=(g,col,row)=>g.tiles.find(t=>t.q+Math.floor(t.r/2)+
 Math.floor(g.setupMap.width/2)===col&&
 t.r+Math.floor(g.setupMap.height/2)===row);
async function ready(role){
 const page=pages[role];
 await page.waitForFunction(()=>document.querySelector('#status')?.
  textContent.includes('SERVER VERIFIED'),null,{timeout:60000});
}
try{
 for(const role of ['attacker','command','recon']){
  const context=await (browser??=await chromium.launch({
   headless:true,args:['--enable-webgl','--use-gl=angle',
    '--use-angle=swiftshader','--enable-unsafe-swiftshader']})).
   newContext({viewport:{width:1280,height:830}});
  contexts[role]=context;
  const handle=role+suffix;
  const registered=await post(role,'/api/v1/auth/register',{
   handle,email:handle+'@example.invalid',password},201);
  assert.equal(registered.user.handle.toLowerCase(),handle);
  const cookies=await context.cookies(base+'/api/v1/auth/me');
  assert(cookies.some(c=>c.name==='ironhex_session'&&c.httpOnly),
   role+' has an independent real HttpOnly authenticated session');
 }
 const roles=Object.fromEntries(['attacker','command','recon'].map(role=>
  [role,role+suffix]));
 const created=await post('attacker','/api/v1/scenario-rooms',{roles},201);
 const id=created.item.id,route='/api/v1/scenario-rooms/'+id;
 await post('command',route+'/accept',{});
 await post('recon',route+'/accept',{});
 const started=await post('attacker',route+'/start',{version:2,shortened:true});
 assert.equal(started.item.version,3);
 const winner=started.game.scenario.sideRollWinner;
 const choosing=winner===0?'attacker':'command';
 await post(choosing,route+'/setup',{version:3,action:{
  type:'select-side',role:winner===0?'attacker':'defender'}});
 let version=4;
 const snapshot=async(role='attacker')=>(await get(role,route+'/snapshot')).game;
 const signed=async(role,kind,action)=>{
  const result=await post(role,route+'/'+kind,{version,action});
  version++;
  assert.equal(result.item.version,version,'server version must advance once');
  return result;
 };
 const initial=await snapshot();
 assert.deepEqual(initial.setupMap.sheets.map(s=>s.name),
  ['Desert #2','Grassland #3']);
 assert.equal(initial.tiles.length,544);
 const sources=[
  [5,5,'depth1',[{q:0,r:0},{q:1,r:0}]],
  [10,11,'sublevel1',[{q:0,r:0},{q:1,r:0},{q:1,r:-1}]],
  [21,5,'depth2',[{q:0,r:0},{q:1,r:0}]],
  [26,11,'sublevel2',[{q:0,r:0},{q:1,r:0},{q:1,r:-1}]]
 ];
 // Deterministic test fixtures, NOT a claim of exact published coordinates.
 for(const [i,[col,row,terrainType,footprint]] of sources.entries()){
  const g=await snapshot(),hex=tile(g,col,row);
  assert(hex,'source map fixture terrain hex exists');
  const role=g.scenario.looseTerrain.nextTeam===g.scenario.attackerTeam?
   'attacker':i<2?'command':'recon';
  await signed(role,'setup',{type:'place-terrain',
   q:hex.q,r:hex.r,terrainType,footprint});
 }
 for(const role of ['attacker','command','recon'])
  await signed(role,'setup',{type:'confirm-figure'});
 assert.equal((await snapshot()).scenario.picturedTerrain.confirmed,true);
 let steps=0,attackCol=0,commandCol=0,reconCol=0;
 for(;;){
  let g=await snapshot();
  if(g.scenario.placement.complete)break;
  const step=g.scenario.placement.steps[g.scenario.placement.placed.length];
  assert(step&&steps++<8,'shortened printed roster needs exactly seven placements');
  const role=step.team===g.scenario.attackerTeam?'attacker':step.lance;
  const u=g.units.find(x=>x.team===step.team&&x.deployed===false&&
   !x.notFielded&&(role==='attacker'||x.lance===role));
  assert(u,'only authentic printed active unit may deploy');
  let target;
  if(role==='command')target=tile(g,commandCol++,0);
  else if(role==='recon')target=tile(g,31-reconCol++,16);
  else{
   if(!g.scenario.placement.attackerRow){
    await signed('attacker','setup',{type:'choose-row',side:'east'});
    g=await snapshot();
   }
   target=g.scenario.placement.attackerRow.hexes[attackCol++];
  }
  assert(target);
  await signed(role,'setup',{type:'place-mech',
   id:u.id,q:target.q,r:target.r,facing:0});
 }
 assert.equal((await snapshot()).phase,'initiative');
 for(const role of ['attacker','command','recon']){
  const ctx=contexts[role],page=await ctx.newPage();pages[role]=page;
  await page.addInitScript(()=>{
   const old=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(kind,...args){
    if(String(kind).toLowerCase().includes('webgl'))return null;
    return old.call(this,kind,...args);
   };
  });
  await page.goto(base+'/index.html?battle=1&room='+encodeURIComponent(id),
   {waitUntil:'domcontentloaded'});
  await ready(role);
  assert.match(await page.locator('#status').textContent(),/SERVER VERIFIED/);
  assert.equal(await page.locator('#allies .unitcard').count()>0,true);
  const snap=await get(role,route+'/snapshot');
  assert.equal(snap.item.yourRole,role);
  assert.equal(snap.item.version,version);
 }
 const initiative= (await snapshot()).scenario.sharedLances.firstInitiativeController;
 assert(['command','recon'].includes(initiative));
 await pages[initiative].locator('#next').click();
 await pages[initiative].waitForFunction(()=>document.querySelector('#phase')?.
  textContent.includes('ДВИЖЕНИЕ'),null,{timeout:30000});
 version=(await get('attacker',route+'/snapshot')).item.version;
 let dispute=false,rolesUsed=new Set(),cycles=0;
 while(!dispute&&cycles++<4){
  const g=await snapshot();
  if(g.activeTeam===g.scenario.attackerTeam){
   await pages.attacker.reload({waitUntil:'domcontentloaded'});await ready('attacker');
   await pages.attacker.locator('#hold').click();
   rolesUsed.add('attacker');
   version=(await get('attacker',route+'/snapshot')).item.version;
   continue;
  }
  for(const role of ['command','recon']){
   await pages[role].reload({waitUntil:'domcontentloaded'});await ready(role);
   const button=pages[role].locator('#room-dispute-send');
   await button.waitFor({state:'visible',timeout:30000});
   await button.click();rolesUsed.add(role);
   version=(await get(role,route+'/snapshot')).item.version;
  }
  const decided=(await snapshot()).scenario.sharedLances.decided;
  assert(['command','recon'].includes(decided.controller));
  dispute=true;
  for(const role of ['attacker','command','recon']){
   await pages[role].reload({waitUntil:'domcontentloaded'});await ready(role);
   const result=pages[role].locator('#room-dispute-result');
   await result.waitFor({state:'visible',timeout:30000});
   assert.match(await result.textContent(),/Победил/);
  }
 }
 assert(dispute,'real server resolved 2D6 across independent browser sessions');
 if(!rolesUsed.has('attacker')){
  // Defender may win the first move by Initiative. Finish that signed
  // move before asking the independent attacking Chromium seat to act.
  const g=checkedGame(await snapshot());
  assert.equal(g.activeTeam,g.scenario.defenderTeam);
  const ruling=g.scenario.sharedLances.decided.controller;
  const unit=g.units.find(u=>g.canAct(u));
  assert(unit,'defender has a move after server 2D6 ruling');
  await signed(ruling,'command',{type:'hold',id:unit.id});
  await pages.attacker.reload({waitUntil:'domcontentloaded'});
  await ready('attacker');
  await pages.attacker.locator('#hold').click();
  rolesUsed.add('attacker');
  version=(await get('attacker',route+'/snapshot')).item.version;
 }
 assert.equal(rolesUsed.size,3,'every real browser sent an authenticated order');
 // Complete the same persisted round, not a separate mocked Game.
 for(const phase of ['move','fire','physical']){
  let g=checkedGame(await snapshot());
  assert.equal(g.phase,phase);
  let turns=0;
  while(g.queue.length){
   const unit=g.units.find(u=>g.canAct(u)&&!u.notFielded);
   assert(unit,'active team has a legal turn');
   const role=unit.team===g.scenario.attackerTeam?'attacker':
    ['move','fire'].includes(phase)&&
    g.scenario.sharedLances.decided?.round===g.round&&
    g.scenario.sharedLances.decided.phase===phase?
     g.scenario.sharedLances.decided.controller:unit.lance;
   await signed(role,'command',{type:'hold',id:unit.id});
   assert(++turns<=7,'each printed unit takes at most one action per phase');
   g=checkedGame(await snapshot());
  }
  assert.equal(turns<=7,true);
  await signed('attacker','command',{type:'next'});
 }
 assert.equal((await snapshot()).phase,'heat');
 await signed('command','command',{type:'next'});
 assert.equal((await snapshot()).phase,'end');
 await signed('attacker','command',{type:'next'});
 const second=await snapshot();
 assert.equal(second.round,2);
 assert.equal(second.phase,'initiative');
 for(const role of ['attacker','command','recon']){
  await pages[role].reload({waitUntil:'domcontentloaded'});
  await ready(role);
  assert.match(await pages[role].locator('#round').textContent(),/02/);
  const res=await get(role,route+'/snapshot');
  assert.equal(res.item.version,version);
  assert.equal(res.game.round,2);
  assert.deepEqual(res.game.setupMap.sheets.map(s=>s.name),
   ['Desert #2','Grassland #3']);
  assert(!JSON.stringify(res).includes('rngState'));
 }
 console.log('AGoAC Chapter 11 REAL three-browser + PostgreSQL shortened setup, 2D6, complete round and round two: PASS');
}finally{
 await Promise.all(Object.values(contexts).map(c=>c.close().catch(()=>{})));
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}

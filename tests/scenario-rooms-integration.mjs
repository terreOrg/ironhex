// Real API + PostgreSQL smoke in isolated CI containers, never production.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPool} from '../apps/api/src/db.mjs';
import {restoreScenarioRoomGame} from '../apps/api/src/scenario-room-match.mjs';
import {agoacScenario3FigureTiles} from '../packages/engine/agoac-scenario3-figure.js';
const base='http://127.0.0.1:3000',suffix=randomBytes(5).toString('hex');
const pool=createPool(),password='Ch11-PG-Integration-2026!';
async function req(path,{method='GET',body,cookie,origin=true}={}){
 const headers={};
 if(method!=='GET'){headers['Content-Type']='application/json';if(origin)headers.Origin=base;}
 if(cookie)headers.Cookie=cookie;
 const res=await fetch(base+path,{method,headers,
  body:method==='GET'?undefined:JSON.stringify(body??{})});
 return {status:res.status,data:await res.json().catch(()=>({})),
  cookie:res.headers.get('set-cookie')};
}
function checked(res,status,label){
 assert.equal(res.status,status,label+': '+JSON.stringify(res.data));return res.data;
}
async function account(prefix){
 const handle=prefix+suffix;
 const data=await req('/api/v1/auth/register',{method:'POST',
  body:{handle,email:handle.toLowerCase()+'@example.invalid',password}});
 checked(data,201,'register '+prefix);
 assert.match(data.cookie??'',/HttpOnly/);
 return {handle,id:data.data.user.id,cookie:data.cookie.split(';')[0]};
}
try{
 const attacker=await account('Attack'),command=await account('Command'),
  recon=await account('Recon');
 const accounts={attacker,command,recon};
 assert.equal(new Set(Object.values(accounts).map(x=>x.id)).size,3);
 for(const shortened of [false,true]){
  const tag=shortened?'shortened':'full';
  const created=checked(await req('/api/v1/scenario-rooms',{
   method:'POST',cookie:attacker.cookie,body:{roles:{
    attacker:attacker.handle,command:command.handle,recon:recon.handle}}
  }),201,tag+' create');
  const id=created.item.id,route='/api/v1/scenario-rooms/'+id;
  assert.equal(created.item.version,0);
  checked(await req(route+'/accept',{method:'POST',cookie:command.cookie}),200,
   tag+' command accepts');
  const accepted=checked(await req(route+'/accept',{
   method:'POST',cookie:recon.cookie}),200,tag+' recon accepts');
  assert.equal(accepted.item.status,'ready');
  assert.equal(accepted.item.version,2);
  assert.equal((await req(route+'/start',{
   method:'POST',cookie:command.cookie,body:{version:2,shortened}
  })).status,403,'Nonhost cannot start');
  const started=checked(await req(route+'/start',{
   method:'POST',cookie:attacker.cookie,body:{version:2,shortened}
  }),200,tag+' start');
  assert.equal(started.item.version,3);
  const winner=started.game.scenario.sideRollWinner;
  assert([0,1].includes(winner));
  const winnerRole=winner===0?'attacker':'command';
  const action={version:3,action:{type:'select-side',
   role:winner===0?'attacker':'defender'}};
  const denied=await req(route+'/setup',{method:'POST',
   cookie:recon.cookie,body:action});
  assert.equal(denied.status,403);
  assert.equal(denied.data.error,'wrong_side_choice_controller');
  assert.equal((await req(route,{cookie:attacker.cookie})).data.item.version,3);
  const chosen=checked(await req(route+'/setup',{method:'POST',
   cookie:accounts[winnerRole].cookie,body:action}),200,tag+' select side');
  assert.equal(chosen.item.version,4);
  assert.deepEqual(chosen.game.setupMap.sheets.map(s=>s.name),
   ['Desert #2','Grassland #3']);
  assert.deepEqual(chosen.game.setupMap.sheets.map(s=>s.side),['west','east']);
  assert.equal(chosen.game.tiles.length,544);
  for(const [index,name] of ['Desert #2','Grassland #3'].entries()){
   const tiles=chosen.game.tiles.filter(t=>t.sheet===index);
   assert.equal(tiles.length,272);
   assert(tiles.every(t=>t.printedSheet===name));
  }
  assert.equal(chosen.game.units.filter(u=>!u.notFielded).length,shortened?7:10);
  assert.equal((await req(route+'/setup',{method:'POST',
   cookie:accounts[winnerRole].cookie,body:action})).status,409);
  for(const [role,seat]of Object.entries(accounts)){
   const response=checked(await req(route+'/snapshot',{cookie:seat.cookie}),
    200,tag+' '+role+' snapshot');
   assert.equal(response.item.yourRole,role);
   assert.equal(response.item.version,4);
   assert.deepEqual(response.game.setupMap.sheets.map(s=>s.name),
    ['Desert #2','Grassland #3']);
   assert(!JSON.stringify(response).includes('rngState'));
  }
  const row=(await pool.query('SELECT version,battle_state FROM agoac_scenario_rooms WHERE id=$1',
   [id])).rows[0];
  assert.equal(row.version,4);
  const saved=row.battle_state;
  assert(Number.isInteger(saved.rngState));
  const corrupt=structuredClone(saved);
  corrupt.game.setupMap.sheets[0].name='Desert #3';
  await pool.query('UPDATE agoac_scenario_rooms SET battle_state=$2::jsonb WHERE id=$1',
   [id,JSON.stringify(corrupt)]);
  const badGet=await req(route+'/snapshot',{cookie:attacker.cookie});
  assert.equal(badGet.status,409);
  assert.equal(badGet.data.error,'scenario_source_map_mismatch');
  const badMutation=await req(route+'/setup',{method:'POST',cookie:attacker.cookie,
   body:{version:4,action:{type:'place-terrain',q:0,r:0,terrainType:'depth1',
    footprint:[{q:0,r:0},{q:1,r:0}]}}});
  assert.equal(badMutation.status,409);
  assert.equal(badMutation.data.error,'scenario_source_map_mismatch');
  assert.equal((await pool.query('SELECT version FROM agoac_scenario_rooms WHERE id=$1',
   [id])).rows[0].version,4);
  await pool.query('UPDATE agoac_scenario_rooms SET battle_state=$2::jsonb WHERE id=$1',
   [id,JSON.stringify(saved)]);
  checked(await req(route+'/snapshot',{cookie:attacker.cookie}),200,
   tag+' valid map restored');
  // Complete one REAL signed PostgreSQL round (both printed roster variants).
  // Action selection inspects a read-only restored server snapshot; every
  // mutation and 2D6 draw still occurs through the authenticated HTTP API.
  let version=4;
  const source=async()=>{
   const rows=await pool.query('SELECT battle_state FROM agoac_scenario_rooms WHERE id=$1',[id]);
   assert.equal(rows.rows.length,1);
   return restoreScenarioRoomGame(rows.rows[0].battle_state).game;
  };
  const signed=async(role,endpoint,action)=>{
   const result=checked(await req(route+'/'+endpoint,{method:'POST',
    cookie:accounts[role].cookie,body:{version,action}}),200,
    tag+' '+role+' '+action.type);
   version++;
   assert.equal(result.item.version,version,'each authoritative request advances one version');
   assert(!JSON.stringify(result).includes('rngState'),'PRNG seed stays server-private');
   return result;
  };
  const types=['depth1','sublevel1','depth2','sublevel2'];
  for(let index=0;index<types.length;index++){
   const g=await source(),cells=agoacScenario3FigureTiles(g,index);
   assert.equal(cells.length,index%2===0?2:3);
   const hex=cells[0],terrainType=types[index];
   const footprint=cells.map(t=>({q:t.q-hex.q,r:t.r-hex.r}));
   const role=g.scenario.looseTerrain.nextTeam===g.scenario.attackerTeam?
    'attacker':index<2?'command':'recon';
   await signed(role,'setup',{type:'place-terrain',
    q:hex.q,r:hex.r,terrainType,footprint});
  }
  assert.equal((await source()).scenario.looseTerrain.complete,true);
  for(const role of ['command','attacker','recon'])
   await signed(role,'setup',{type:'confirm-figure'});
  assert.equal((await source()).scenario.picturedTerrain.confirmed,true);
  const count=shortened?7:10;
  let commandCol=0,reconCol=0,attackerCol=0,steps=0;
  while(!(await source()).scenario.placement.complete){
   let g=await source();
   const step=g.scenario.placement.steps[g.scenario.placement.placed.length];
   assert(step,'one authentic printed placement step required');
   const role=step.team===g.scenario.attackerTeam?'attacker':step.lance;
   const unit=g.units.find(u=>u.team===step.team&&!u.deployed&&
    !u.notFielded&&(role==='attacker'||u.lance===step.lance));
   assert(unit,'printed pilot must belong to authenticated player '+role);
   let hex;
   if(role==='command')hex=tile(g,commandCol++,0);
   else if(role==='recon')hex=tile(g,31-reconCol++,16);
   else{
    if(!g.scenario.placement.attackerRow){
     await signed('attacker','setup',{type:'choose-row',side:'east'});
     g=await source();
    }
    hex=g.divideAndConquerPrintedRow('east')[attackerCol++];
   }
   assert(hex,'legal source deployment hex');
   await signed(role,'setup',{type:'place-mech',
    id:unit.id,q:hex.q,r:hex.r,facing:0});
   assert(++steps<=count,'each real pilot deployed exactly once');
  }
  let g=await source();
  assert.equal(g.scenario.placement.placed.length,count);
  assert.equal(g.phase,'initiative');
  const wrongInitiative=await req(route+'/command',{method:'POST',
   cookie:recon.cookie,body:{version,action:{type:'next'}}});
  assert.equal(wrongInitiative.status,403,'recon cannot act as initial initiative controller');
  assert.equal(wrongInitiative.data.error,'wrong_initiative_controller');
  await signed('command','command',{type:'next'});
  g=await source();
  assert.equal(g.phase,'move');
  assert.equal(g.queue.length,count);
  let resolvedDispute=null;
  for(const phase of ['move','fire','physical']){
   g=await source();
   assert.equal(g.phase,phase);
   let turns=0;
   while(g.queue.length){
    if(phase==='move'&&!resolvedDispute&&g.activeTeam===g.scenario.defenderTeam){
     const cmd=g.units.find(u=>u.lance==='command'&&g.canAct(u));
     const rec=g.units.find(u=>u.lance==='recon'&&g.canAct(u));
     assert(cmd&&rec,'both defending lances can dispute activation order');
     const proposed=await signed('command','command',{type:'propose-dispute',id:cmd.id});
     assert.equal(proposed.effect.pending,true);
     const attackerUnit=g.units.find(u=>u.team===g.scenario.attackerTeam);
     const denied=await req(route+'/command',{method:'POST',cookie:attacker.cookie,
      body:{version,action:{type:'hold',id:attackerUnit.id}}});
     assert.equal(denied.status,409);
     assert.equal(denied.data.error,'scenario_dispute_pending');
     const decided=await signed('recon','command',{type:'propose-dispute',id:rec.id});
     assert.equal(decided.effect.pending,false);
     assert(['command','recon'].includes(decided.effect.controller));
     assert(decided.effect.rolls.length>=2,'server actually rolls 2D6 for dispute');
     resolvedDispute=decided.effect.controller;
     g=await source();
    }
    const unit=g.units.find(u=>g.canAct(u)&&!u.notFielded);
    assert(unit,'active team needs at least one legal Mech');
    const role=unit.team===g.scenario.attackerTeam?'attacker':
     phase==='move'?resolvedDispute:unit.lance;
    assert(['attacker','command','recon'].includes(role));
    await signed(role,'command',{type:'hold',id:unit.id});
    assert(++turns<=count,'one activation per unit per phase');
    g=await source();
   }
   assert.equal(turns,count,phase+' must process every printed Mech once');
   await signed('attacker','command',{type:'next'});
  }
  assert.equal((await source()).phase,'heat');
  await signed('command','command',{type:'next'});
  assert.equal((await source()).phase,'end');
  await signed('attacker','command',{type:'next'});
  g=await source();
  assert.equal(g.phase,'initiative');
  assert.equal(g.round,2);
  assert.equal(g.scenario.sharedLances.decided.phase,'move');
  assert.equal(g.scenario.sharedLances.decided.round,1);
  const reconNext=await signed('recon','command',{type:'next'});
  assert.equal(reconNext.effect.round,2);
  assert.equal((await source()).phase,'move');
  for(const [role,seat]of Object.entries(accounts)){
   const snap=checked(await req(route+'/snapshot',{cookie:seat.cookie}),200,
    tag+' round2 '+role);
   assert.equal(snap.item.version,version);
   assert.equal(snap.item.yourRole,role);
   assert.equal(snap.game.round,2);
   assert.deepEqual(snap.game.setupMap.sheets.map(x=>x.name),
    ['Desert #2','Grassland #3']);
   assert(!JSON.stringify(snap).includes('rngState'));
  }
  assert.equal((await pool.query('SELECT version FROM agoac_scenario_rooms WHERE id=$1',
   [id])).rows[0].version,version);

 }
 console.log('AGoAC Ch11: real PostgreSQL and three-session full/shortened room lifecycle passed');
}finally{await pool.end();}

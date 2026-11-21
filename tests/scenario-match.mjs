import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AuthError} from '../apps/api/src/auth.mjs';
import {newScenarioRoomGame,captureScenarioRoomGame,restoreScenarioRoomGame,
 applyScenarioRoomSetup,applyScenarioRoomOrder,publicScenarioRoomGame} from
 '../apps/api/src/scenario-room-match.mjs';

const blocked=(fn,code)=>assert.throws(fn,
 err=>err instanceof AuthError&&err.code===code);
const figurePiece=(game,index)=>{
 const spec=game.scenario.picturedTerrain.counters[index];
 const tiles=spec.printedHexes.map(hex=>game.tiles.find(t=>
  t.sheet===spec.sheet&&t.printedHex===hex));
 assert(tiles.every(Boolean),'all source cells must exist');
 const [origin]=tiles;
 return {q:origin.q,r:origin.r,
  footprint:tiles.map(t=>({q:t.q-origin.q,r:t.r-origin.r}))};
};
function begin(shortened=false){
 const runtime=newScenarioRoomGame({shortened});
 const win=runtime.game.scenario.sideRollWinner;
 assert([0,1].includes(win));
 assert.equal(runtime.game.scenario.attackerTeam,null);
 assert(runtime.game.scenario.sideRolls.length>=2);
 assert.equal(runtime.game.scenario.requestedVariation,shortened?'shortened':null);
 const role=win===0?'attacker':'command';
 blocked(()=>applyScenarioRoomSetup(runtime.game,'recon',{
  type:'select-side',role:win===0?'attacker':'defender'}),
  'wrong_side_choice_controller');
 blocked(()=>applyScenarioRoomSetup(runtime.game,role,{
  type:'select-side',role:win===0?'defender':'attacker'}),
  'scenario_role_reassignment_required');
 assert.equal(runtime.game.scenario.attackerTeam,null,
  'a role switch cannot be faked with fixed accepted room seats');
 const chosen=applyScenarioRoomSetup(runtime.game,role,{
  type:'select-side',role:win===0?'attacker':'defender'});
 assert(chosen.ok);
 assert.equal(runtime.game.scenario.attackerTeam,0);
 assert.equal(runtime.game.scenario.defenderTeam,1);
 assert.equal(runtime.game.setupMap.id,'sheets');
 assert.deepEqual(runtime.game.setupMap.sheets.map(s=>s.name),
  ['Desert #2','Grassland #3'],
  'CAT3500D official errata v8.01 p.5 requires Desert #2, not superseded Desert #3');
 assert.equal(runtime.game.units.filter(u=>!u.notFielded).length,shortened?7:10);
 assert.equal(runtime.game.scenario.recordSheetsImported,true);
 assert.equal(runtime.game.scenario.sourceTerrainLoaded,true);
 assert.equal(runtime.game.scenario.looseTerrain.piecesPerTeam,2);
 return runtime;
}
test('AGoAC Ch11: three-user server start rolls source sides and loads exact pinned scenario 3',()=>{
 for(const shortened of [false,true]){
  const runtime=begin(shortened);
  const captured=captureScenarioRoomGame(runtime.game,runtime.rng);
  assert(Number.isInteger(captured.rngState)&&captured.rngState>=0);
  const restored=restoreScenarioRoomGame(captured);
  assert.equal(restored.game.units.length,runtime.game.units.length);
  assert.equal(restored.game.setupMap.width,32);
  assert.equal(restored.game.setupMap.height,17);
  assert(!Object.hasOwn(captured.game,'map'));
  assert(!Object.hasOwn(captured.game,'rng'));
  assert(!Object.hasOwn(publicScenarioRoomGame(captured),'rngState'));
 }
});
test('AGoAC Ch11 errata v8.01: persisted scenario 3 cannot restore obsolete or tampered source maps',()=>{
 const runtime=begin();
 const stored=captureScenarioRoomGame(runtime.game,runtime.rng);
 const accepted=restoreScenarioRoomGame(stored);
 assert.deepEqual(accepted.game.setupMap.sheets.map(s=>s.name),
  ['Desert #2','Grassland #3']);
 const rejectTamper=mutate=>{
  const bad=structuredClone(stored);mutate(bad.game);
  blocked(()=>restoreScenarioRoomGame(bad),'scenario_source_map_mismatch');
 };
 rejectTamper(g=>{g.setupMap.sheets[0].name='Desert #3';});
 rejectTamper(g=>{g.setupMap.sheets[0].side='east';});
 rejectTamper(g=>{g.setupMap.sheets.reverse();});
 rejectTamper(g=>{g.tiles[0].printedSheet='Desert #3';});
 rejectTamper(g=>{g.tiles[0].sheet=1;});
 rejectTamper(g=>{g.tiles.pop();});
 const original=runtime.game.setupMap.sheets[0].name;
 runtime.game.setupMap.sheets[0].name='Desert #3';
 blocked(()=>captureScenarioRoomGame(runtime.game,runtime.rng),
  'scenario_source_map_mismatch');
 runtime.game.setupMap.sheets[0].name=original;
 assert.deepEqual(captureScenarioRoomGame(runtime.game,runtime.rng),stored);
});

test('AGoAC Ch11: logged-in attacker and designated defenders place four source counters',()=>{
 const {game,rng}=begin();
 blocked(()=>applyScenarioRoomSetup(game,'attacker',{type:'place-mech',
  id:0,q:0,r:0,facing:0}),'scenario_deployment_not_ready');
 const types=['depth1','sublevel1','depth2','sublevel2'];
 for(let i=0;i<types.length;i++){
  const tile=figurePiece(game,i);
  const terrainType=types[i],footprint=tile.footprint;
  const team=game.scenario.looseTerrain.nextTeam;
  const role=team===game.scenario.attackerTeam?'attacker':i<2?'command':'recon';
  const order={type:'place-terrain',q:tile.q,r:tile.r,terrainType,footprint};
  const intruder=role==='attacker'?'command':'attacker';
  blocked(()=>applyScenarioRoomSetup(game,intruder,order),
   'scenario_lance_not_owned');
  const placed=applyScenarioRoomSetup(game,role,order);
  assert(placed.ok);
 }
 assert(game.scenario.looseTerrain.complete);
 // Three distinct signatures, each only once, before deployment can start.
 const first=applyScenarioRoomSetup(game,'attacker',{type:'confirm-figure'});
 assert.equal(first.approvals,1);
 blocked(()=>applyScenarioRoomSetup(game,'attacker',{type:'confirm-figure'}),
  'scenario_figure_already_approved');
 const second=applyScenarioRoomSetup(game,'command',{type:'confirm-figure'});
 assert.equal(second.approvals,2);
 blocked(()=>applyScenarioRoomSetup(game,'attacker',{type:'place-mech',
  id:0,q:0,r:0,facing:0}),'scenario_deployment_not_ready');
 const third=applyScenarioRoomSetup(game,'recon',{type:'confirm-figure'});
 assert.equal(third.stage,'deployment');
 assert.equal(game.scenario.picturedTerrain.confirmed,true);
 assert.equal(game.scenario.placement.complete,false);
 blocked(()=>applyScenarioRoomOrder(game,'attacker',{type:'hold',id:0}),
  'printed_scenario_not_ready');
 const persisted=captureScenarioRoomGame(game,rng);
 assert.equal(restoreScenarioRoomGame(persisted).game.scenario.picturedTerrain.confirmed,true);
 const corrupted=mutate=>{
  const bad=structuredClone(persisted);
  mutate(bad.game);
  blocked(()=>restoreScenarioRoomGame(bad),'scenario_source_terrain_mismatch');
 };
 corrupted(g=>{g.scenario.looseTerrain.pieces[0].hexes[0].q++;});
 corrupted(g=>{g.scenario.looseTerrain.pieces[0].terrainType='sublevel1';});
 corrupted(g=>{g.scenario.picturedTerrain.approvals.recon=false;});
 corrupted(g=>{g.scenario.picturedTerrain.pieces.pop();});
 corrupted(g=>{g.tiles.find(t=>t.overlayTerrain).overlayTerrain=null;});
 corrupted(g=>{g.scenario.looseTerrain.pieces[1].hexes.reverse();});
});
test('AGoAC Ch11: restored signed room commands reject unready or cross-role battles',()=>{
 const runtime=begin(true);
 const saved=captureScenarioRoomGame(runtime.game,runtime.rng);
 const restored=restoreScenarioRoomGame(saved);
 blocked(()=>applyScenarioRoomOrder(restored.game,'attacker',{type:'hold',id:0}),
  'printed_scenario_not_ready');
 const again=captureScenarioRoomGame(restored.game,restored.rng);
 assert.equal(JSON.stringify(again.game),JSON.stringify(saved.game));
});


const USERS={
 attacker:'11111111-1111-4111-8111-111111111111',
 command:'22222222-2222-4222-8222-222222222222',
 recon:'33333333-3333-4333-8333-333333333333',
 outsider:'44444444-4444-4444-8444-444444444444'
};
const ROOM='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function serverRoomFixture(){
 const row={
  id:ROOM,created_by:USERS.attacker,
  attacker_id:USERS.attacker,command_id:USERS.command,
  recon_id:USERS.recon,accepted_attacker:true,accepted_command:true,
  accepted_recon:true,status:'ready',version:7,battle_state:null,
  created_at:'2026-11-21T00:00:00Z'
 };
 const queries=[];
 const client={
  async query(sql,args=[]){
   queries.push({sql,args});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
   if(sql.startsWith('SELECT * FROM agoac_scenario_rooms WHERE id=$1 FOR UPDATE'))
    return {rows:args[0]===ROOM?[{...row}]:[]};
   if(sql.startsWith('SELECT r.*, a.handle AS attacker_handle')){
    if(args[0]!==ROOM)return {rows:[]};
    return {rows:[{...row,attacker_handle:'attacker_one',
     command_handle:'command_one',recon_handle:'recon_one'}]};
   }
   if(sql.includes("UPDATE agoac_scenario_rooms SET status='active',battle_state=")){
    row.status='active';row.battle_state=JSON.parse(args[1]);row.version++;
    return {rows:[]};
   }
   if(sql.startsWith('UPDATE agoac_scenario_rooms SET status=$2,battle_state=')){
    row.status=args[1];row.battle_state=JSON.parse(args[2]);row.version++;
    return {rows:[]};
   }
   throw Error('Unexpected SQL: '+sql);
  },
  release(){}
 };
 return {row,queries,pool:{connect:async()=>client,query:(...args)=>client.query(...args)}};
}
test('AGoAC Ch11: locked PostgreSQL scenario match versions and user sessions are authoritative',async()=>{
 const {createScenarioRoomStore}=await import('../apps/api/src/scenario-rooms.mjs');
 const db=serverRoomFixture(),store=createScenarioRoomStore(db.pool);
 await assert.rejects(()=>store.start(USERS.command,ROOM,{version:7}),
  e=>e instanceof AuthError&&e.code==='scenario_not_host');
 await assert.rejects(()=>store.start(USERS.attacker,ROOM,{version:6}),
  e=>e instanceof AuthError&&e.code==='stale_scenario_version');
 assert.equal(db.row.version,7);
 const launched=await store.start(USERS.attacker,ROOM,{version:7});
 assert.equal(launched.item.status,'active');
 assert.equal(launched.item.version,8);
 assert.equal(launched.item.yourRole,'attacker');
 assert.equal(launched.game.scenario.id,'divide-and-conquer');
 assert.equal(launched.game.scenario.attackerTeam,null);
 assert(!JSON.stringify(launched).includes('rngState'));
 await assert.rejects(()=>store.snapshot(USERS.outsider,ROOM),
  e=>e instanceof AuthError&&e.status===404);
 const snap=await store.snapshot(USERS.recon,ROOM);
 assert.equal(snap.item.yourRole,'recon');
 assert.equal(snap.item.version,8);
 await assert.rejects(()=>store.start(USERS.attacker,ROOM,{version:8}),
  e=>e instanceof AuthError&&e.code==='scenario_room_not_ready');
 const winner=snap.game.scenario.sideRollWinner;
 const role=winner===0?'attacker':'command';
 const actor=USERS[role],side=winner===0?'attacker':'defender';
 await assert.rejects(()=>store.setup(USERS.recon,ROOM,{
  version:8,action:{type:'select-side',role:side}}),
  e=>e instanceof AuthError&&e.code==='wrong_side_choice_controller');
 assert.equal(db.row.version,8,'rejected role spoof must not persist state');
 await assert.rejects(()=>store.setup(actor,ROOM,{
  version:8,action:{type:'select-side',role:side,asUser:USERS.outsider}}),
  e=>e instanceof AuthError&&e.code==='invalid_scenario_setup');
 assert.equal(db.row.version,8);
 const accepted=await store.setup(actor,ROOM,{
  version:8,action:{type:'select-side',role:side}});
 assert.equal(accepted.item.version,9);
 assert.equal(accepted.effect.stage,'terrain');
 assert.equal(accepted.game.scenario.attackerTeam,0);
 assert.equal(db.row.battle_state.game.scenario.recordSheetsImported,true);
 await assert.rejects(()=>store.command(USERS.attacker,ROOM,{
  version:8,action:{type:'hold',id:0}}),
  e=>e instanceof AuthError&&e.code==='stale_scenario_version');
 await assert.rejects(()=>store.command(USERS.attacker,ROOM,{
  version:9,action:{type:'hold',id:0}}),
  e=>e instanceof AuthError&&e.code==='printed_scenario_not_ready');
 assert.equal(db.row.version,9,'invalid tactical command cannot advance room version');
 await assert.rejects(()=>store.setup(USERS.outsider,ROOM,{
  version:9,action:{type:'confirm-figure'}}),
  e=>e instanceof AuthError&&e.status===404);
 const saves=db.queries.filter(q=>q.sql.startsWith('UPDATE agoac_scenario_rooms SET'));
 assert.equal(saves.length,2,'only signed legal actions persist authoritative state');
});
test('AGoAC Ch11: HTTP match start, snapshot and orders reject cross-site and unauthenticated writers',async()=>{
 const {createHttpServer}=await import('../apps/api/src/http.mjs');
 const {once}=await import('node:events');
 const tokens={attacker:'a'.repeat(64),command:'b'.repeat(64),recon:'c'.repeat(64)};
 const users=new Map(Object.keys(tokens).map(role=>[tokens[role],
  {id:USERS[role],emailVerified:true}]));
 const calls=[];
 const fake={
  async start(actor,id,body){calls.push(['start',actor,id,body]);return {item:{id,version:8}};},
  async snapshot(actor,id){calls.push(['snapshot',actor,id]);return {item:{id},game:{phase:'initiative'}};},
  async setup(actor,id,body){calls.push(['setup',actor,id,body]);return {item:{id,version:9}};},
  async command(actor,id,body){calls.push(['command',actor,id,body]);return {item:{id,version:10}};}
 };
 const server=createHttpServer({
  authStore:{currentUser:async token=>users.get(token)||null},
  scenarioRoomStore:fake
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const cookie=role=>({Cookie:'ironhex_session='+tokens[role]});
 const post=(role,action,body,origin=base)=>fetch(base+'/api/v1/scenario-rooms/'+ROOM+'/'+action,{
  method:'POST',
  headers:{...cookie(role),Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify(body)
 });
 try{
  assert.equal((await fetch(base+'/api/v1/scenario-rooms/'+ROOM+'/snapshot')).status,401);
  assert.equal((await post('attacker','start',{version:7},'https://evil.example')).status,403);
  assert.equal(calls.length,0);
  assert.equal((await post('attacker','start',{version:7,shortened:false})).status,200);
  assert.deepEqual(calls.at(-1),['start',USERS.attacker,ROOM,{version:7,shortened:false}]);
  assert.equal((await fetch(base+'/api/v1/scenario-rooms/'+ROOM+'/snapshot',{
   headers:cookie('recon')})).status,200);
  assert.deepEqual(calls.at(-1),['snapshot',USERS.recon,ROOM]);
  const stage={version:8,action:{type:'select-side',role:'defender'}};
  assert.equal((await post('command','setup',stage)).status,200);
  assert.deepEqual(calls.at(-1),['setup',USERS.command,ROOM,stage]);
  const order={version:9,action:{type:'hold',id:2}};
  assert.equal((await post('recon','command',order)).status,200);
  assert.deepEqual(calls.at(-1),['command',USERS.recon,ROOM,order]);
  assert.equal((await post('recon','command',order,'https://evil.example')).status,403);
  assert.equal(calls.length,4);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('AGoAC Ch11: all three signed roles persist full original and shortened turns through phases',()=>{
 for(const shortened of [false,true]){
  let runtime=begin(shortened);
  const snapshot=()=>{
   const saved=captureScenarioRoomGame(runtime.game,runtime.rng);
   assert(!Object.hasOwn(publicScenarioRoomGame(saved),'rngState'),
    'server-side dice seed never appears in public snapshot');
   runtime=restoreScenarioRoomGame(saved);
   const replay=captureScenarioRoomGame(runtime.game,runtime.rng);
   assert.deepEqual(replay,saved,'restoring one authenticated transaction is lossless');
  };
  const setup=(role,action)=>{
   const result=applyScenarioRoomSetup(runtime.game,role,action);
   assert(result.ok);snapshot();return result;
  };
  const order=(role,action)=>{
   const result=applyScenarioRoomOrder(runtime.game,role,action);
   assert(result.ok);snapshot();return result;
  };
  const types=['depth1','sublevel1','depth2','sublevel2'];
  for(let index=0;index<types.length;index++){
   const hex=figurePiece(runtime.game,index);
   const terrainType=types[index],footprint=hex.footprint;
   const team=runtime.game.scenario.looseTerrain.nextTeam;
   const role=team===runtime.game.scenario.attackerTeam?
    'attacker':index<2?'command':'recon';
   setup(role,{type:'place-terrain',q:hex.q,r:hex.r,terrainType,footprint});
  }
  assert(runtime.game.scenario.looseTerrain.complete);
  for(const role of ['command','attacker','recon'])
   setup(role,{type:'confirm-figure'});
  assert(runtime.game.scenario.picturedTerrain.confirmed);
  const count=shortened?7:10;
  const defenders=shortened?4:6;
  let command=0,recon=0,attacker=0;
  while(!runtime.game.scenario.placement.complete){
   const g=runtime.game,step=g.scenario.placement.steps[
    g.scenario.placement.placed.length];
   assert(step,'scenario must have a next printed unit');
   const role=step.team===g.scenario.attackerTeam?'attacker':step.lance;
   const unit=g.units.find(u=>u.team===step.team&&!u.deployed&&
    !u.notFielded&&(role==='attacker'||u.lance===step.lance));
   assert(unit,'printed unit for the signed seat '+role);
   let hex;
   if(role==='command')hex=tile(command++,0);
   else if(role==='recon')hex=tile(31-recon++,16);
   else{
    if(!g.scenario.placement.attackerRow)
     setup('attacker',{type:'choose-row',side:'east'});
    const row=runtime.game.divideAndConquerPrintedRow('east');
    hex=row[attacker++];
   }
   assert(hex,'printed deployment hex must exist');
   setup(role,{type:'place-mech',id:unit.id,q:hex.q,r:hex.r,facing:0});
  }
  assert.equal(runtime.game.units.filter(u=>!u.notFielded).length,count);
  assert.equal(runtime.game.scenario.placement.placed.length,count);
  assert.equal(runtime.game.phase,'initiative');
  blocked(()=>applyScenarioRoomOrder(runtime.game,'recon',{type:'next'}),
   'wrong_initiative_controller');
  order('command',{type:'next'});
  assert.equal(runtime.game.phase,'move');
  assert.equal(runtime.game.queue.length,count);
  let dispute=null;
  for(const phase of ['move','fire','physical']){
   assert.equal(runtime.game.phase,phase);
   let turns=0;
   while(runtime.game.queue.length){
    const g=runtime.game;
    if(phase==='move'&&!dispute&&g.activeTeam===g.scenario.defenderTeam){
     const c=g.units.find(u=>u.lance==='command'&&g.canAct(u));
     const r=g.units.find(u=>u.lance==='recon'&&g.canAct(u));
     assert(c&&r,'both signed defender lances must be selectable');
     const first=order('command',{type:'propose-dispute',id:c.id});
     assert(first.pending);
     blocked(()=>applyScenarioRoomOrder(runtime.game,'attacker',
      {type:'hold',id:g.units.find(u=>u.team===g.scenario.attackerTeam).id}),
      'scenario_dispute_pending');
     const decided=order('recon',{type:'propose-dispute',id:r.id});
     assert.equal(decided.pending,false);
     assert(['command','recon'].includes(decided.controller));
     assert(decided.rolls.length>=2,'shared-defender conflict uses real 2D6');
     dispute=decided.controller;
    }
    const current=runtime.game;
    const unit=current.units.find(u=>current.canAct(u)&&!u.notFielded);
    assert(unit,'active team must have a legal BattleMech');
    const role=unit.team===current.scenario.attackerTeam?'attacker':
     phase==='move'?dispute:unit.lance;
    if(unit.team===current.scenario.defenderTeam&&phase==='move'){
     const other=dispute==='command'?'recon':'command';
     blocked(()=>applyScenarioRoomOrder(current,other,{type:'hold',id:unit.id}),
      'scenario_lance_not_owned');
    }
    order(role,{type:'hold',id:unit.id});
    turns++;
    assert(turns<=count,'each phase must terminate without repeating an activation');
   }
   assert.equal(turns,count,phase+' processed the original printed force exactly once');
   order('attacker',{type:'next'});
  }
  assert.equal(runtime.game.phase,'heat');
  order('command',{type:'next'});
  assert.equal(runtime.game.phase,'end');
  order('attacker',{type:'next'});
  assert.equal(runtime.game.phase,'initiative');
  assert.equal(runtime.game.round,2);
  assert.equal(runtime.game.scenario.sharedLances.decided.phase,'move');
  assert.equal(runtime.game.scenario.sharedLances.decided.round,1,
   '2D6 winner cannot claim authority in the new round');
  const second=order('recon',{type:'next'});
  assert.equal(second.round,2,'signed server returns the authoritative new round');
  assert.equal(runtime.game.phase,'move');
  assert.equal(runtime.game.scenario.sharedLances.initiativeController,'recon',
   'initiative control alternates to other defending player on round two');
 }
});

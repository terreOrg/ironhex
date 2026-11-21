import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AuthError} from '../apps/api/src/auth.mjs';
import {newScenarioRoomGame,captureScenarioRoomGame,restoreScenarioRoomGame,
 applyScenarioRoomSetup,applyScenarioRoomOrder,publicScenarioRoomGame} from
 '../apps/api/src/scenario-room-match.mjs';

const blocked=(fn,code)=>assert.throws(fn,
 err=>err instanceof AuthError&&err.code===code);
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
test('AGoAC Ch11: logged-in attacker and designated defenders place four source counters',()=>{
 const {game}=begin();
 blocked(()=>applyScenarioRoomSetup(game,'attacker',{type:'place-mech',
  id:0,q:0,r:0,facing:0}),'scenario_deployment_not_ready');
 const positions=[
  [5,5,'depth1',[{q:0,r:0},{q:1,r:0}]],
  [10,11,'sublevel1',[{q:0,r:0},{q:1,r:0},{q:1,r:-1}]],
  [21,5,'depth2',[{q:0,r:0},{q:1,r:0}]],
  [26,11,'sublevel2',[{q:0,r:0},{q:1,r:0},{q:1,r:-1}]]
 ];
 for(let i=0;i<positions.length;i++){
  const [col,row,terrainType,footprint]=positions[i];
  const tile=game.tiles.find(t=>
   t.q+Math.floor(t.r/2)+Math.floor(game.setupMap.width/2)===col&&
   t.r+Math.floor(game.setupMap.height/2)===row);
  assert(tile);
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

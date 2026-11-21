import {randomBytes} from 'node:crypto';
import {Game} from '../../../packages/engine/engine.js';
import {prepareAgoacPrintedScenario} from './agoac-scenario-setup.mjs';
import {AuthError} from './auth.mjs';
import {runScenarioRoomCommand} from './scenario-command.mjs';
import {publicSnapshot} from './server-combat.mjs';

const ROLES=['attacker','command','recon'];
const check=(yes,code,status=409)=>{
 if(!yes)throw new AuthError(status,code);
};
const rngFrom=initial=>{
 let state=(initial>>>0)||1;
 return {
  next(){
   state^=state<<13;state^=state>>>17;state^=state<<5;
   state>>>=0;return state/4294967296;
  },
  state:()=>state
 };
};
const safeJson=x=>JSON.parse(JSON.stringify(x,(key,value)=>
 key==='map'||key==='rng'?undefined:value));
// Official AGoAC v8.01 p.5 is authoritative over the superseded p.47
// printing. This invariant also protects persisted, independently restored
// three-account sessions from accidentally loading the obsolete mapsheet.
const scenario3Sheets=Object.freeze(['Desert #2','Grassland #3']);
export function assertScenario3SourceMap(game){
 if(game?.scenario?.id!=='divide-and-conquer'||game.setupMap==null)return;
 const map=game.setupMap,sheets=map.sheets;
 check(map.id==='sheets'&&map.printedScenario==='divide-and-conquer'&&
  map.layout==='horizontal'&&map.width===32&&map.height===17&&
  Array.isArray(sheets)&&sheets.length===2&&
  sheets.every((s,i)=>s?.name===scenario3Sheets[i]&&
   s.side===(i===0?'west':'east')),
  'scenario_source_map_mismatch');
 const counts=[0,0];
 check(Array.isArray(game.tiles)&&game.tiles.length===544,
  'scenario_source_map_mismatch');
 for(const tile of game.tiles){
  check((tile.sheet===0||tile.sheet===1)&&
   tile.printedSheet===scenario3Sheets[tile.sheet],
   'scenario_source_map_mismatch');
  counts[tile.sheet]++;
 }
 check(counts[0]===272&&counts[1]===272,'scenario_source_map_mismatch');
}
export function captureScenarioRoomGame(game,rng){
 assertScenario3SourceMap(game);
 return {rngState:rng.state(),game:safeJson(game)};
}
export function restoreScenarioRoomGame(saved){
 check(saved&&Number.isInteger(saved.rngState)&&saved.game&&
  typeof saved.game==='object','scenario_match_not_started');
 const rng=rngFrom(saved.rngState),game=new Game({rng:()=>rng.next()});
 const {map:_map,rng:_rng,...state}=saved.game;
 Object.assign(game,structuredClone(state));
 assertScenario3SourceMap(game);
 game.rebuildMap();
 game.rng=()=>rng.next();
 return {game,rng};
}
export function newScenarioRoomGame({shortened=false}={}){
 check(typeof shortened==='boolean','invalid_scenario_match',422);
 const seed=randomBytes(4).readUInt32LE(0)||1,rng=rngFrom(seed);
 const game=new Game({rng:()=>rng.next()});
 const result=game.configureScenario('divide-and-conquer');
 check(result.ok,'invalid_scenario_match');
 const roll=game.rollScenarioSides();
 check(roll.ok,'invalid_scenario_match');
 // Room seats are agreed upon in the invitation. Neither a remapping
 // of two defenders to one attacker nor any side choice is silently
 // fabricated. If the winner declines the agreed side, new consent
 // and a re-seated room are required, not an automatic role swap.
 game.scenario.fixedRoomSeats=true;
 game.scenario.requestedVariation=shortened?'shortened':null;
 return {game,rng};
}
const ownTeam=(game,role)=>role==='attacker'?
 game.scenario.attackerTeam:game.scenario.defenderTeam;
function eligiblePlacementRole(game,role,team,lance,terrainSheet=null){
 if(team!==ownTeam(game,role))return false;
 if(team===game.scenario.attackerTeam)return role==='attacker';
 if(lance==='command'||lance==='recon')return role===lance;
 if(terrainSheet!==null)return role===(terrainSheet===0?'command':'recon');
 return role==='command';
}
const int=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const simple=(action,keys)=>Object.keys(action).every(k=>['type',...keys].includes(k));
function validHexes(footprint){
 return Array.isArray(footprint)&&footprint.length>=2&&footprint.length<=3&&
  footprint.every(p=>p&&typeof p==='object'&&!Array.isArray(p)&&
   Object.keys(p).length===2&&int(p.q,-15,15)&&int(p.r,-16,16));
}
export function applyScenarioRoomSetup(game,role,action){
 check(ROLES.includes(role),'forbidden_scenario_role',403);
 check(game?.scenario?.id==='divide-and-conquer'&&
  game.winner===null,'invalid_scenario_match');
 check(action&&typeof action==='object'&&!Array.isArray(action)&&
  typeof action.type==='string','invalid_scenario_setup',422);
 const s=game.scenario,loose=s.looseTerrain,placement=s.placement;
 if(action.type==='select-side'){
  check(simple(action,['role'])&&['attacker','defender'].includes(action.role),
   'invalid_scenario_setup',422);
  check(s.sideRollWinner!==null&&s.attackerTeam===null,'scenario_side_already_chosen');
  const expectedRole=s.sideRollWinner===0?'attacker':'command';
  check(role===expectedRole,'wrong_side_choice_controller',403);
  const preagreed=s.sideRollWinner===0?'attacker':'defender';
  check(action.role===preagreed,'scenario_role_reassignment_required');
  check(game.chooseScenarioSide(s.sideRollWinner,action.role).ok,
   'invalid_scenario_setup');
  if(s.requestedVariation)check(
   game.configurePrintedScenarioVariation(s.requestedVariation).ok,'invalid_scenario_setup');
  const shared=game.configureSharedDefenderLances({
   commandController:'verified-room-command',
   reconController:'verified-room-recon'});
  check(shared.ok,'invalid_scenario_setup');
  prepareAgoacPrintedScenario(game,'divide-and-conquer');
  const terrain=game.startScenarioLooseTerrain({piecesPerTeam:2});
  check(terrain.ok,'invalid_scenario_setup');
  return {ok:true,stage:'terrain',firstTeam:terrain.firstTeam,roll:terrain.roll};
 }
 check([0,1].includes(s.attackerTeam)&&[0,1].includes(s.defenderTeam),
  'scenario_side_not_selected');
 if(action.type==='place-terrain'){
  check(simple(action,['q','r','terrainType','footprint'])&&
   int(action.q,-35,35)&&int(action.r,-35,35)&&validHexes(action.footprint)&&
   typeof action.terrainType==='string','invalid_scenario_setup',422);
  check(loose&&!loose.complete,'scenario_terrain_not_ready');
  const pieceIndex=loose.pieces.length;
  check(eligiblePlacementRole(game,role,loose.nextTeam,null,Math.floor(pieceIndex/2)),
   'scenario_lance_not_owned',403);
  const result=game.placeScenarioLooseTerrain({
   team:loose.nextTeam,q:action.q,r:action.r,terrainType:action.terrainType,
   label:action.terrainType,footprint:action.footprint});
  check(result.ok,'illegal_scenario_terrain',422);
  return {ok:true,stage:result.complete?'diagram-approval':'terrain',
   placed:result.placed,remaining:result.remaining};
 }
 if(action.type==='confirm-figure'){
  check(simple(action,[]) ,'invalid_scenario_setup',422);
  check(loose?.complete&&!placement&&!s.picturedTerrain?.confirmed,
   'scenario_terrain_not_ready');
  s.picturedTerrain.approvals??={};
  check(!s.picturedTerrain.approvals[role],'scenario_figure_already_approved');
  s.picturedTerrain.approvals[role]=true;
  if(ROLES.every(seat=>s.picturedTerrain.approvals[seat])){
   const result=game.confirmDivideAndConquerIllustratedTerrain({
    sourceDiagramReviewed:true});
   check(result.ok,'scenario_terrain_not_ready');
   const begun=game.beginPrintedScenarioPlacement();
   check(begun.ok,'scenario_deployment_not_ready');
   return {ok:true,stage:'deployment',approvals:3};
  }
  return {ok:true,stage:'diagram-approval',
   approvals:Object.values(s.picturedTerrain.approvals).filter(Boolean).length};
 }
 if(action.type==='choose-row'){
  check(simple(action,['side'])&&['west','east'].includes(action.side),
   'invalid_scenario_setup',422);
  check(role==='attacker','scenario_lance_not_owned',403);
  const result=game.chooseDivideAndConquerAttackerRow(action.side);
  check(result.ok,'scenario_deployment_not_ready');
  return {ok:true,stage:'deployment',side:action.side};
 }
 if(action.type==='place-mech'){
  check(simple(action,['id','q','r','facing'])&&
   int(action.id,0,31)&&int(action.q,-35,35)&&int(action.r,-35,35)&&
   int(action.facing,0,5),'invalid_scenario_setup',422);
  check(placement&&!placement.complete,'scenario_deployment_not_ready');
  const step=placement.steps[placement.placed.length];
  check(step&&eligiblePlacementRole(game,role,step.team,step.lance),
   'scenario_lance_not_owned',403);
  const unit=game.unit(action.id);
  check(unit&&unit.team===step.team&&
   (step.lance==='printed-row'||unit.lance===step.lance),
   'scenario_lance_not_owned',403);
  const result=game.placePrintedScenarioMech(
   action.id,action.q,action.r,action.facing);
  check(result.ok,'illegal_scenario_deployment',422);
  return {ok:true,stage:result.complete?'battle':'deployment',
   placed:result.placed,remaining:result.remaining};
 }
 throw new AuthError(422,'invalid_scenario_setup');
}
export function applyScenarioRoomOrder(game,role,action){
 return runScenarioRoomCommand(game,role,action);
}
export function publicScenarioRoomGame(saved){
 return publicSnapshot(saved);
}

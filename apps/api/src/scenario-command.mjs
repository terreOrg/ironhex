import {AuthError} from './auth.mjs';

// AGoAC printed p.48: two real defenders, one commanding each lance.
// Caller MUST derive the role from the authenticated database room seat;
// never trust a user-supplied role in the tactical payload.
const ROLES=['attacker','command','recon'];
const check=(condition,code='illegal_scenario_command',status=409)=>{
 if(!condition)throw new AuthError(status,code);
};
const natural=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max;
function validated(action){
 check(action&&typeof action==='object'&&!Array.isArray(action),undefined,422);
 const fields={
  hold:['id'],
  move:['id','q','r','mode'],
  fire:['id','shots','primaryTarget'],
  physical:['id','target','attack','limb'],
  next:['choice'],
  'propose-dispute':['id'],
  'withdraw-dispute':[]
 };
 check(Object.hasOwn(fields,action.type)&&
  Object.keys(action).every(k=>k==='type'||fields[action.type].includes(k)),
  'invalid_scenario_command',422);
 if(['hold','move','fire','physical','propose-dispute'].includes(action.type))
  check(natural(action.id,31),'invalid_scenario_command',422);
 if(action.type==='move')check(
  Number.isInteger(action.q)&&action.q>=-35&&action.q<=35&&
  Number.isInteger(action.r)&&action.r>=-35&&action.r<=35&&
  ['walk','run','jump','evade','minimum'].includes(action.mode),
  'invalid_scenario_command',422);
 if(action.type==='fire'){
  check(Array.isArray(action.shots)&&action.shots.length<=32&&
   action.shots.every(s=>s&&typeof s==='object'&&!Array.isArray(s)&&
    Object.keys(s).every(k=>['index','target','aim','bin','heatMode','spotter'].includes(k))&&
    natural(s.index,31)&&natural(s.target,31)&&
    (s.aim===undefined||s.aim===null||
      ['HD','CT','LT','RT','LA','RA','LL','RL'].includes(s.aim))&&
    (s.bin===undefined||s.bin===null||natural(s.bin,79))&&
    (s.spotter===undefined||s.spotter===null||natural(s.spotter,31))&&
    (s.heatMode===undefined||typeof s.heatMode==='boolean'))&&
   (action.primaryTarget===undefined||natural(action.primaryTarget,31)),
   'invalid_scenario_command',422);
 }
 if(action.type==='physical')check(
  natural(action.target,31)&&['kick','punch','push','club','hatchet'].includes(action.attack)&&
  ['LA','RA','LL','RL','both'].includes(action.limb),
  'invalid_scenario_command',422);
 if(action.type==='next'&&action.choice!==undefined)check(
  action.choice&&typeof action.choice==='object'&&!Array.isArray(action.choice)&&
  Object.keys(action.choice).length===2&&
  typeof action.choice.key==='string'&&action.choice.key.length>=1&&action.choice.key.length<=80&&
  typeof action.choice.option==='string'&&action.choice.option.length>=1&&action.choice.option.length<=32,
  'invalid_scenario_command',422);
 return action;
}
function authoritativeGame(game){
 check(game?.scenario?.id==='divide-and-conquer'&&
  [0,1].includes(game.scenario.attackerTeam)&&
  [0,1].includes(game.scenario.defenderTeam)&&
  game.scenario.attackerTeam!==game.scenario.defenderTeam&&
  game.scenario.sharedLances&&
  game.setupMap?.id==='sheets'&&game.scenario.placement?.complete===true&&
  game.scenario.picturedTerrain?.confirmed===true&&
  game.scenario.sourceTerrainLoaded===true&&
  game.scenario.recordSheetsImported===true,
  'printed_scenario_not_ready');
}
// The side that must resolve LOS, displacement or damage choices is
// named by the engine's pending-choice metadata, NOT by the HTTP caller.
// A choice about a destroyed or incapacitated unit still belongs to
// that signed user's lance; do not apply "canAct" to resolution ownership.
export function canResolveScenarioPendingChoice(game,role){
 const choice=game?.pendingChoice,unit=game?.unit(choice?.unitId);
 if(!choice||!unit||!ROLES.includes(role)||
  ![0,1].includes(choice.team)||unit.team!==choice.team||
  !Number.isInteger(choice.unitId))return false;
 if(role==='attacker')return unit.team===game.scenario?.attackerTeam;
 if(unit.team!==game.scenario?.defenderTeam||
  !['command','recon'].includes(unit.lance))return false;
 const ruling=game.scenario?.sharedLances?.decided;
 const winner=ruling?.round===game.round&&ruling.phase===game.phase?
  ruling.controller:null;
 return winner?role===winner:unit.lance===role;
}
export function canControlScenarioUnit(game,role,id){
 if(!ROLES.includes(role)||!game?.scenario||!natural(id,31))return false;
 const u=game.unit(id);
 if(!u||u.dead||u.notFielded||u.deployed===false)return false;
 if(role==='attacker')return u.team===game.scenario.attackerTeam;
 return game.sharedDefenderCanControl(u,role);
}
function validDisputeCandidate(game,role,id){
 const u=game.unit(id);
 return ['command','recon'].includes(role)&&u?.lance===role&&
  u.team===game.scenario.defenderTeam&&
  !u.dead&&!u.notFielded&&u.deployed!==false&&
  !game.done(u)&&game.canAct(u);
}
function currentProposal(game){
 const state=game.scenario.sharedLances,submitted=state.pendingServerDispute;
 return submitted?.round===game.round&&submitted.phase===game.phase?
  submitted:{round:game.round,phase:game.phase,command:null,recon:null};
}
// Only successful calls should be captured/persisted inside the caller's
// database transaction. Reject stale version before calling this function.
export function runScenarioRoomCommand(game,authenticatedRole,rawAction){
 check(ROLES.includes(authenticatedRole),'forbidden_scenario_role',403);
 authoritativeGame(game);
 const action=validated(rawAction),state=game.scenario.sharedLances;
 if(action.type==='propose-dispute'){
  const phaseDecided=state.decided?.round===game.round&&
   state.decided.phase===game.phase;
  check(['move','fire'].includes(game.phase)&&
   game.activeTeam===game.scenario.defenderTeam&&!phaseDecided,
   'scenario_dispute_unavailable');
  check(validDisputeCandidate(game,authenticatedRole,action.id),
   'scenario_lance_not_owned',403);
  const proposal=currentProposal(game);
  check(proposal[authenticatedRole]===null,'scenario_already_proposed');
  proposal[authenticatedRole]=action.id;
  if(proposal.command===null||proposal.recon===null){
   state.pendingServerDispute=proposal;
   return {ok:true,pending:true,phase:game.phase,round:game.round};
  }
  check(proposal.command!==proposal.recon,'scenario_same_dispute_unit');
  const decided=game.arbitrateSharedDefenderChoice({
   commandChoice:proposal.command,reconChoice:proposal.recon});
  check(decided.ok,'scenario_dispute_unavailable');
  delete state.pendingServerDispute;
  return {ok:true,pending:false,controller:decided.controller,
   unitId:decided.unitId,rolls:structuredClone(decided.rolls)};
 }
 if(action.type==='withdraw-dispute'){
  check(['command','recon'].includes(authenticatedRole),
   'scenario_lance_not_owned',403);
  const proposal=currentProposal(game);
  check(proposal[authenticatedRole]!==null&&
   (proposal.command===null||proposal.recon===null),
   'scenario_dispute_unavailable');
  proposal[authenticatedRole]=null;
  if(proposal.command===null&&proposal.recon===null)
   delete state.pendingServerDispute;
  else state.pendingServerDispute=proposal;
  return {ok:true,withdrawn:true};
 }
 const proposal=currentProposal(game);
 check(proposal.command===null&&proposal.recon===null,
  'scenario_dispute_pending');
 if(action.type==='next'){
  if(game.pendingChoice)check(canResolveScenarioPendingChoice(game,authenticatedRole),
   'scenario_resolution_not_owned',403);
  check(!game.queue.length||game.pendingChoice,
   'phase_pending_orders');
  // The two defending players alternate who rolls initiative for their
  // side each round. The engine rolls for both sides in one trusted action.
  if(game.phase==='initiative'&&!game.pendingChoice){
   const first=state.firstInitiativeController;
   const designated=game.round%2===1?first:first==='command'?'recon':'command';
   check(authenticatedRole===designated,'wrong_initiative_controller',403);
   state.initiativeRound=game.round;state.initiativeController=designated;
  }
  const result=game.nextPhaseWithChoices({humanTeams:[0,1],choice:action.choice});
  check(result?.ok,'illegal_scenario_command',422);
  return {ok:true,phase:game.phase,round:game.round,
   result:structuredClone(result)};
 }
 const unit=game.unit(action.id);
 check(game.canAct(unit),'not_your_turn');
 check(canControlScenarioUnit(game,authenticatedRole,action.id),
  'scenario_lance_not_owned',403);
 check(!game.pendingChoice,'resolution_choice_pending');
 let result;
 if(action.type==='hold')result=game.hold(action.id);
 else if(action.type==='move')
  result=game.moveWithChoices(action.id,action.q,action.r,action.mode,
   {humanTeams:[0,1]});
 else if(action.type==='fire')
  result=game.declareFireWithLosChoices(action.id,action.shots,
   action.primaryTarget??null,{humanTeams:[0,1]});
 else result=game.declarePhysical(action.id,action.target,action.attack,action.limb);
 check(result?.ok,'illegal_tactical_order',422);
 return {ok:true,phase:game.phase,round:game.round,
  result:structuredClone(result)};
}

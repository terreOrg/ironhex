import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../packages/engine/engine.js';
import {AuthError} from '../apps/api/src/auth.mjs';
import {runScenarioRoomCommand,canControlScenarioUnit} from
 '../apps/api/src/scenario-command.mjs';

function ready(){
 const g=new Game();
 assert(g.configureScenario('divide-and-conquer').ok);
 g.scenario.sideRollWinner=0;
 assert(g.chooseScenarioSide(0,'attacker').ok);
 assert(g.configureSharedDefenderLances({
  commandController:'signed-account-command',
  reconController:'signed-account-recon'
 }).ok);
 g.setupMap={id:'sheets',layout:'horizontal',width:32,height:17};
 g.scenario.picturedTerrain={required:true,confirmed:true};
 g.scenario.sourceTerrainLoaded=true;
 g.scenario.recordSheetsImported=true;
 g.scenario.placement={complete:true};
 g.units[2].lance='command';g.units[3].lance='recon';
 g.phase='move';g.activeTeam=1;g.queue=[1,0];g.round=1;
 return g;
}
const blocked=(fn,code)=>assert.throws(fn,e=>
 e instanceof AuthError&&(!code||e.code===code));
test('AGoAC Ch11 p.48: server authorizes only the session owner of each defending lance',()=>{
 const g=ready();
 assert(canControlScenarioUnit(g,'command',2));
 assert(canControlScenarioUnit(g,'recon',3));
 assert(canControlScenarioUnit(g,'attacker',0));
 assert.equal(canControlScenarioUnit(g,'attacker',2),false);
 assert.equal(canControlScenarioUnit(g,'command',3),false);
 assert.equal(canControlScenarioUnit(g,'recon',2),false);
 const before=JSON.stringify(g.units);
 blocked(()=>runScenarioRoomCommand(g,'recon',{type:'hold',id:2}),
  'scenario_lance_not_owned');
 blocked(()=>runScenarioRoomCommand(g,'attacker',{type:'hold',id:2}),
  'scenario_lance_not_owned');
 blocked(()=>runScenarioRoomCommand(g,'command',{type:'hold',id:3}),
  'scenario_lance_not_owned');
 blocked(()=>runScenarioRoomCommand(g,'command',{type:'hold',id:0}),
  'not_your_turn');
 blocked(()=>runScenarioRoomCommand(g,'random',{type:'hold',id:2}),
  'forbidden_scenario_role');
 blocked(()=>runScenarioRoomCommand(g,'command',{type:'hold',id:2,team:1}),
  'invalid_scenario_command');
 assert.equal(JSON.stringify(g.units),before,'unauthorized requests never mutate units');
 const allowed=runScenarioRoomCommand(g,'command',{type:'hold',id:2});
 assert(allowed.ok);assert(g.unit(2).moved);
});
test('AGoAC Ch11 p.48: only two independently authenticated defenders can settle one 2D6 phase dispute',()=>{
 const g=ready(),dice=[...Array(4).fill(.4),...Array(2).fill(.1),...Array(2).fill(.9)];
 g.rng=()=>{assert(dice.length>0);return dice.shift();};
 blocked(()=>runScenarioRoomCommand(g,'attacker',{type:'propose-dispute',id:2}),
  'scenario_lance_not_owned');
 blocked(()=>runScenarioRoomCommand(g,'command',{type:'propose-dispute',id:3}),
  'scenario_lance_not_owned');
 const one=runScenarioRoomCommand(g,'command',{type:'propose-dispute',id:2});
 assert(one.pending);assert.equal(g.scenario.sharedLances.decided,null);
 blocked(()=>runScenarioRoomCommand(g,'command',{type:'propose-dispute',id:2}),
  'scenario_already_proposed');
 blocked(()=>runScenarioRoomCommand(g,'command',{type:'hold',id:2}),
  'scenario_dispute_pending');
 blocked(()=>runScenarioRoomCommand(g,'attacker',{type:'hold',id:0}),
  'scenario_dispute_pending');
 const resolved=runScenarioRoomCommand(g,'recon',{type:'propose-dispute',id:3});
 assert(resolved.ok);assert.equal(resolved.pending,false);
 assert.equal(resolved.rolls.length,4,'2D6 tie must reroll');
 assert.equal(resolved.controller,'recon','second pair of 2D6 resolves the phase');
 assert.equal(dice.length,0);
 assert(canControlScenarioUnit(g,'recon',2),'winning player now controls defending SIDE');
 assert.equal(canControlScenarioUnit(g,'command',2),false);
 blocked(()=>runScenarioRoomCommand(g,'command',{type:'hold',id:2}),
  'scenario_lance_not_owned');
 const winner=runScenarioRoomCommand(g,'recon',{type:'hold',id:2});
 assert(winner.ok);
 assert.equal(g.unit(2).moved,true);
 blocked(()=>runScenarioRoomCommand(g,'recon',{type:'propose-dispute',id:3}),
  'scenario_dispute_unavailable');
 g.phase='fire';
 assert(canControlScenarioUnit(g,'command',2));
 assert.equal(canControlScenarioUnit(g,'recon',2),false);
});
test('AGoAC Ch11 p.48: dispute withdrawal and stale phases never permit role impersonation',()=>{
 const g=ready();
 assert(runScenarioRoomCommand(g,'recon',{type:'propose-dispute',id:3}).pending);
 blocked(()=>runScenarioRoomCommand(g,'command',{type:'withdraw-dispute'}),
  'scenario_dispute_unavailable');
 blocked(()=>runScenarioRoomCommand(g,'attacker',{type:'withdraw-dispute'}),
  'scenario_lance_not_owned');
 assert(runScenarioRoomCommand(g,'recon',{type:'withdraw-dispute'}).withdrawn);
 assert.equal(g.scenario.sharedLances.pendingServerDispute,undefined);
 assert(runScenarioRoomCommand(g,'command',{type:'propose-dispute',id:2}).pending);
 g.round=2;
 assert(runScenarioRoomCommand(g,'recon',{type:'hold',id:3}).ok,
  'old-round proposal cannot block legitimate orders');
});
test('AGoAC Ch11 p.48: no server battle command before canonical printed map and source records',()=>{
 const g=ready();
 for(const mutate of [
  x=>{x.scenario.picturedTerrain.confirmed=false;},
  x=>{x.scenario.placement.complete=false;},
  x=>{x.scenario.sourceTerrainLoaded=false;},
  x=>{x.scenario.recordSheetsImported=false;},
  x=>{x.setupMap.id='demo';}
 ]){
  const copy=structuredClone({
   scenario:g.scenario,setupMap:g.setupMap
  });
  mutate(g);
  blocked(()=>runScenarioRoomCommand(g,'command',{type:'hold',id:2}),
   'printed_scenario_not_ready');
  g.scenario=copy.scenario;g.setupMap=copy.setupMap;
 }
});
test('AGoAC Ch11 p.48: server enforces alternating defending initiative controller',()=>{
 const g=ready();
 g.phase='initiative';g.activeTeam=null;g.queue=[];g.round=1;
 blocked(()=>runScenarioRoomCommand(g,'recon',{type:'next'}),
  'wrong_initiative_controller');
 const first=runScenarioRoomCommand(g,'command',{type:'next'});
 assert(first.ok);assert.equal(g.scenario.sharedLances.initiativeController,'command');
 assert.equal(g.scenario.sharedLances.initiativeRound,1);
 // A second round, with otherwise legal phase transition, belongs to recon.
 const h=ready();h.round=2;h.phase='initiative';h.queue=[];
 blocked(()=>runScenarioRoomCommand(h,'command',{type:'next'}),
  'wrong_initiative_controller');
 assert(runScenarioRoomCommand(h,'recon',{type:'next'}).ok);
 assert.equal(h.scenario.sharedLances.initiativeRound,2);
});

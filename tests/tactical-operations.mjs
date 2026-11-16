import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../packages/engine/engine.js';
import {validateTacticalOrder,runTacticalOrder} from '../apps/api/src/server-combat.mjs';

// Tactical Operations: Advanced Rules, corrected fourth printing (2020),
// printed pp.16-17. These options MUST remain off in an ordinary AGoAC game.
test('TO standing still applies -1 only if zero MP were spent and target is mobile',()=>{
  const game=new Game({rng:()=>.5});
  const t=game.units[2];
  t.distanceMoved=0;t.spent=0;t.moveMode='stand';
  assert.equal(game.targetMovementModifier(t),0,'AGoAC default must not change');
  game.tacticalOptions.standingStill=true;
  assert.equal(game.targetMovementModifier(t),-1);
  t.spent=1;
  assert.equal(game.targetMovementModifier(t),0,
    'A turn in place costs MP; not considered stationary');
  t.spent=0;t.shutdown=true;
  assert.equal(game.targetMovementModifier(t),-4,
    'The immobile modifier replaces, rather than stacks with, standing still');
  t.shutdown=false;
  t.distanceMoved=5;t.spent=5;
  assert.equal(game.targetMovementModifier(t),2);
});

test('TO evading requires both intact hip actuators, running MP and no water entry',()=>{
  const game=new Game({rng:()=>.5});
  const u=game.units[0];
  game.phase='move';game.queue=[0];game.activeTeam=0;game.actingId=null;
  assert.equal(game.mp(u,'evade'),0);
  assert.deepEqual(game.reachable(u,'evade'),[]);
  game.tacticalOptions.evading=true;
  assert.equal(game.mp(u,'evade'),game.mp(u,'run'));
  const paths=game.reachable(u,'evade');
  assert(paths.some(p=>p.cost>0),
    'Evading is an actual movement choice, not just a passive buff');
  const water=paths.filter(p=>game.tile(p.q,p.r)?.depth>=1);
  assert.equal(water.length,0,'Evading cannot enter water, as with running');
  u.actuators.LL.hip=true;
  assert.equal(game.mp(u,'evade'),0);
  assert.deepEqual(game.reachable(u,'evade'),[]);
  u.actuators.LL.hip=false;
  const moved=paths.find(p=>p.cost>0);
  const result=game.move(u.id,moved.q,moved.r,'evade');
  assert.equal(result.ok,true);
  assert.equal(u.moveMode,'evade');
  assert.equal(game.hold(u.id).ok,true);
  assert.equal(u.pendingHeat,4,
    'TO Evading: two normal running heat plus two additional heat');
});

test('TO evading grants +1 defensive hit modifier, cancels it prone and bars attacks',()=>{
  const game=new Game({rng:()=>.5});
  game.tacticalOptions={standingStill:false,evading:true};
  const u=game.units[0],t=game.units[2];
  t.moveMode='run';t.distanceMoved=5;t.spent=5;
  assert.equal(game.targetMovementModifier(t),2);
  t.moveMode='evade';
  assert.equal(game.targetMovementModifier(t),3);
  t.prone=true;
  assert.equal(game.targetMovementModifier(t),2,
    'TO evading bonus disappears if mech falls prone');
  t.prone=false;
  u.moveMode='evade';
  const p=game.preview(0,2,0);
  assert.equal(p.legal,false);
  assert.match(p.reason,/Уклонение/);
  const physical=game.physicalPreview(0,2,'punch','RA');
  assert.equal(physical.legal,false);
  game.phase='fire';game.queue=[0];game.activeTeam=0;
  assert.equal(game.declareFire(0,[{index:0,target:2}]).ok,false,
    'Even direct API calls cannot bypass TO Evading attack restrictions');
});

test('Optional TO movement settings are server-controlled, locked and validated',()=>{
  const cmd=validateTacticalOrder({
    type:'weather',version:1,night:false,gale:false,
    standingStill:true,evading:true
  });
  assert.equal(cmd.evading,true);
  assert.throws(()=>validateTacticalOrder({
    ...cmd,evading:1
  }),e=>e.code==='invalid_command');
  assert.throws(()=>validateTacticalOrder({
    ...cmd,allOptionalRules:true
  }),e=>e.code==='invalid_command');
  const game=new Game({rng:()=>.5});
  assert.equal(runTacticalOrder(game,cmd).result.ok,true);
  assert.deepEqual(game.tacticalOptions,{standingStill:true,evading:true,floatingCriticals:false});
  game.phase='move';
  assert.throws(()=>runTacticalOrder(game,{...cmd,evading:false}),
    e=>e.code==='weather_locked');
  const move=validateTacticalOrder({
    type:'move',id:0,version:1,q:1,r:0,mode:'evade'
  });
  assert.equal(move.mode,'evade');
});

test('BMM floating criticals is validated, server-settable and locked after initiative',()=>{
 const game=new Game({rng:()=>.5});
 assert.equal(game.tacticalOptions.floatingCriticals,false);
 const command=validateTacticalOrder({type:'weather',version:1,night:false,gale:false,
  standingStill:false,evading:false,floatingCriticals:true});
 assert.equal(runTacticalOrder(game,command).result.ok,true);
 assert.equal(game.tacticalOptions.floatingCriticals,true);
 assert.throws(()=>validateTacticalOrder({...command,floatingCriticals:1}),
  e=>e.code==='invalid_command');
 game.phase='move';
 assert.throws(()=>runTacticalOrder(game,{...command,floatingCriticals:false}),
  e=>e.code==='weather_locked');
});

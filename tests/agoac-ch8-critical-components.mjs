import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../dist/engine.js';

// Real criticalHit() slot selection, without random dice or unrelated combat phases.
function harness(location, slots) {
 const game=new Game({rng:()=>0.5}), unit=game.units[0];
 game.phase='fire';
 unit.slots[location]=Array.from({length:location==='HD'||['LL','RL'].includes(location)?6:12},(_,i)=>slots[i]??null);
 unit.crit[location]=unit.slots[location].map(()=>false);
 const positions=[];
 game.phaseRolls=[];
 game.roll=()=>{game.phaseRolls.push({});return 8;}; // one critical
 game.d6=()=>positions.shift()??1;
 return {game,unit,positions,hit:()=>game.criticalHit(unit,location)};
}

test('CAT3500D pp.32–33: first sensor hit degrades and second prevents weapon attacks',()=>{
 const {game,unit,positions,hit}=harness('HD',['sensors','sensors']);
 positions.push(1,2);
 hit();assert.equal(unit.sensorHits,1);
 assert.equal(unit.dead,false);
 const enemy=game.units.find(x=>x.team!==unit.team);
 assert(enemy,'opposing mech for attack-preview integration');
 assert.equal(game.preview(unit.id,enemy.id,0).mods.sensor,2,'first sensor hit adds +2');
 hit();assert.equal(unit.sensorHits,2);
 assert.deepEqual(unit.crit.HD.slice(0,2),[true,true]);
 assert.equal(game.preview(unit.id,enemy.id,0).reason,'Датчики уничтожены','second sensor hit disables weapon attacks');
});

test('CAT3500D p.33: life support critical permanently enables heat and underwater injury effects',()=>{
 const {unit,hit}=harness('HD',['life']);
 assert.equal(unit.lifeSupport,false);
 hit();
 assert.equal(unit.lifeSupport,true);
 assert.equal(unit.crit.HD[0],true);
});

test('CAT3500D pp.32–33: critical equipment losses decrement distinct heat sink and jump capacities',()=>{
 const {unit,positions,hit}=harness('LT',['sink','jump']);
 const beforeSinks=unit.sinksLost,beforeJump=unit.jumpLost;
 positions.push(1,2);
 hit();assert.equal(unit.sinksLost,beforeSinks+1);assert.equal(unit.jumpLost,beforeJump);
 hit();assert.equal(unit.jumpLost,beforeJump+1);assert.equal(unit.sinksLost,beforeSinks+1);
});

test('CAT3500D p.32: three distinct engine slot criticals destroy the mech',()=>{
 const {unit,positions,hit}=harness('CT',['engine','engine','engine']);
 positions.push(1,2,3);
 hit();assert.equal(unit.engineHits,1);assert.equal(unit.dead,false);
 hit();assert.equal(unit.engineHits,2);assert.equal(unit.dead,false);
 hit();assert.equal(unit.engineHits,3);assert.equal(unit.dead,true);
});

test('CAT3500D p.32 and AGoAC errata v8.01: gyro critical has immediate first PSR and second fall',()=>{
 const {game,unit,positions,hit}=harness('CT',['gyro','gyro']);
 const psrs=[],falls=[];
 game.psr=(u,modifier,reason,immediate)=>{assert.equal(u,unit);psrs.push({modifier,reason,immediate});};
 game.fall=(u,levels,tn)=>{assert.equal(u,unit);falls.push({levels,tn});u.prone=true;};
 positions.push(1,2);
 hit();assert.equal(unit.gyroHits,1);assert.equal(psrs.length,1);
 assert.equal(psrs[0].immediate,true);assert.equal(falls.length,0);
 hit();assert.equal(unit.gyroHits,2);assert.equal(falls.length,1);
});

test('CAT3500D p.33: cockpit critical kills pilot and schedules removal',()=>{
 const {unit,hit}=harness('HD',['cockpit']);
 assert.equal(unit.dead,false);
 hit();
 assert.equal(unit.pilotWounds,6);
 assert.equal(unit.dead,true);
 assert.equal(unit.removalPending,true);
});

test('CAT3500D pp.32–34: leg actuators have separate damage and phase history',()=>{
 const {game,unit,positions,hit}=harness('LL',['hip','upper','lower','foot']);
 game.round=4;game.phase='fire';
 positions.push(1,2,3,4);
 hit();
 assert.equal(unit.actuators.LL.hip,true);
 assert.equal(unit.actuatorHitRounds.LL.hip,4);
 assert.equal(unit.actuatorHitPhases.LL.hip,26);
 assert(unit.psrs.some(p=>p.reason==='Актуатор LL'));
 hit();hit();hit();
 assert.deepEqual(unit.actuators.LL,{hip:true,upper:true,lower:true,foot:true});
 assert.deepEqual(unit.actuatorHitRounds.LL,{hip:4,upper:4,lower:4,foot:4});
});

test('CAT3500D pp.32–33: weapon critical permanently disables the affected weapon',()=>{
 const {unit,hit}=harness('RA',['w:0']);
 assert.equal(unit.weapons[0].destroyed,false);
 hit();
 assert.equal(unit.weapons[0].destroyed,true);
 assert.equal(unit.crit.RA[0],true);
});

test('CAT3500D pp.32–33: critical jump jet loss reduces actual available jumping MP',()=>{
 const {game,unit,hit}=harness('LT',['jump']);
 const before=game.mp(unit,'jump');
 assert(before>0,'fixture must start with functioning jump jets');
 hit();
 assert.equal(game.mp(unit,'jump'),before-1);
});

test('CAT3500D pp.32–33: destroyed weapon is rejected by actual fire preview',()=>{
 const {game,unit,hit}=harness('RA',['w:0']);
 const enemy=game.units.find(x=>x.team!==unit.team);
 assert(enemy,'enemy exists for weapon preview');
 hit();
 assert.equal(game.preview(unit.id,enemy.id,0).reason,'Оружие уничтожено или затоплено');
});

test('CAT3500D p.32: engine critical adds five heat to the next heat phase',()=>{
 const make=(damaged)=>{
  const game=new Game({rng:()=>0.5}),unit=game.units[0];
  game.units=[unit];
  game.phase='heat';
  unit.heat=0;unit.pendingHeat=12;unit.shutdown=false;
  if(damaged)unit.engineHits=1;
  game.heatPhase();
  return unit.heat;
 };
 assert.equal(make(true)-make(false),5,'one engine critical adds exactly five heat');
});

test('CAT3500D p.33: destroyed heat sink raises heat retained at phase end by one',()=>{
 const make=(damaged)=>{
  const game=new Game({rng:()=>0.5}),unit=game.units[0];
  game.units=[unit];
  game.phase='heat';
  unit.heat=0;unit.pendingHeat=12;unit.shutdown=false;
  if(damaged)unit.sinksLost=1;
  game.heatPhase();
  return unit.heat;
 };
 assert.equal(make(true)-make(false),1,'one heat sink critical removes one cooling point');
});

test('CAT3500D p.33: damaged life support inflicts heat injury at actual heat-phase resolution',()=>{
 const game=new Game({rng:()=>0.5}),unit=game.units[0];
 game.units=[unit];game.phase='heat';
 unit.lifeSupport=true;unit.shutdown=true;unit.heat=15;unit.sinks=0;unit.pendingHeat=0;
 const injuries=[];
 game.wound=(u,n)=>{assert.equal(u,unit);injuries.push(n);};
 game.consciousness=()=>{};
 game.heatPhase();
 assert.deepEqual(injuries,[1]);
});

test('CAT3500D p.34: left/right torso destruction also destroys corresponding arm exactly once',()=>{
 for(const [torso,arm] of [['LT','LA'],['RT','RA']]){
  const game=new Game({rng:()=>0.5}),unit=game.units[0];
  assert(unit.structure[torso]>0&&unit.structure[arm]>0);
  game.destroyLocation(unit,torso);
  assert.equal(unit.structure[torso],0);
  assert.equal(unit.structure[arm],0);
  assert(unit.destroyedSections.includes(torso));
  assert(unit.destroyedSections.includes(arm));
  const lostBefore=unit.sinksLost,jumpBefore=unit.jumpLost;
  game.destroyLocation(unit,torso);
  assert.equal(unit.sinksLost,lostBefore,'repeat destruction must not remove equipment twice');
  assert.equal(unit.jumpLost,jumpBefore,'repeat destruction must not remove jump jets twice');
 }
});

test('CAT3500D pp.34–35: head and center torso loss destroy the BattleMech',()=>{
 for(const location of ['HD','CT']){
  const game=new Game({rng:()=>0.5}),unit=game.units[0];
  assert.equal(unit.dead,false);
  game.destroyLocation(unit,location);
  assert.equal(unit.structure[location],0);
  assert.equal(unit.dead,true);
  assert.equal(unit.removalPending,true);
  if(location==='HD')assert.equal(unit.pilotWounds,6);
 }
});

test('CAT3500D pp.31–33: natural critical 12 severs an intact head or limb without a player choice',()=>{
 for(const location of ['HD','LA','RA','LL','RL']){
  const {game,unit,hit}=harness(location,['sink']);
  const chosen=[];
  game.chooseResolutionOption=(...args)=>{chosen.push(args);throw Error('No optional three-slot alternative for limb/head roll 12');};
  game.roll=()=>{game.phaseRolls.push({});return 12;};
  game.fall=(u)=>{u.prone=true;};
  hit();
  assert.equal(unit.structure[location],0,location+' must be destroyed');
  assert.equal(chosen.length,0,'automatic blowoff must never request controller choice');
 }
});

test('CAT3500D p.31: natural critical 12 in a torso rolls three slots rather than severing torso',()=>{
 const {game,unit,positions,hit}=harness('LT',['sink','jump','engine']);
 const initial=unit.structure.LT;
 game.roll=()=>{game.phaseRolls.push({});return 12;};
 positions.push(1,2,3);
 hit();
 assert.equal(unit.structure.LT,initial,'torso remains intact after the three critical slots');
 assert.deepEqual(unit.crit.LT.slice(0,3),[true,true,true]);
 assert.equal(unit.sinksLost,1);
 assert.equal(unit.jumpLost,1);
 assert.equal(unit.engineHits,1);
});

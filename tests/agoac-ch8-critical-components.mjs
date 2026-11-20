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

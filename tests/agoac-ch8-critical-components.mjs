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
 hit();assert.equal(unit.sensorHits,2);
 assert.deepEqual(unit.crit.HD.slice(0,2),[true,true]);
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

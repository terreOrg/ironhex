import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game,defaultMechWarriorSkills} from '../dist/engine.js';

const flatGame=()=>{
 const game=new Game({rng:()=>.5});
 for(const t of game.tiles)Object.assign(t,{type:'plain',height:0,surface:0,depth:0});
 return game;
};

test('BMM p.7: each 2D6 roll uses two independent six-sided results and their sum',()=>{
 const g=flatGame(),observed=new Set();
 for(let a=1;a<=6;a++)for(let b=1;b<=6;b++){
  const values=[(a-.5)/6,(b-.5)/6];
  g.rng=()=>values.shift();
  const sum=g.roll('2D6 verification');
  assert.equal(sum,a+b);
  assert.deepEqual(g.lastDice,[a,b]);
  assert.deepEqual(g.phaseRolls.at(-1).dice,[a,b]);
  assert.equal(g.phaseRolls.at(-1).total,a+b);
  observed.add(g.lastDice.join(','));
 }
 assert.equal(observed.size,36);
});

test('BMM p.7: 1D6 uses exactly one die across all six faces',()=>{
 const g=flatGame();
 for(let face=1;face<=6;face++){
  g.rng=()=>((face-.5)/6);
  assert.equal(g.d6('single die'),face);
  assert.deepEqual(g.lastDice,[face]);
  assert.deepEqual(g.phaseRolls.at(-1).dice,[face]);
 }
});

test('BMM p.6: equal target succeeds; target <=2 always succeeds; 13+ fails',()=>{
 const g=flatGame();
 const cases=[
  {dice:1,tn:2,result:'Успех'},
  {dice:1,tn:1,result:'Успех'},
  {dice:1,tn:-3,result:'Успех'},
  {dice:6,tn:12,result:'Успех'},
  {dice:6,tn:13,result:'Неудача'},
  {dice:6,tn:15,result:'Неудача'},
  {dice:1,tn:3,result:'Неудача'}
 ];
 for(const c of cases){
  g.rng=()=>((c.dice-.5)/6);
  g.roll('Target Number',c.tn);
  assert.equal(g.phaseRolls.at(-1).target,c.tn);
  assert.equal(g.phaseRolls.at(-1).result,c.result);
 }
});

test('BMM p.6: ranged and physical preview preserve an un-clamped modified TN',()=>{
 const g=flatGame(),a=g.units[0],t=g.units[2];
 a.q=0;a.r=0;a.facing=0;t.q=1;t.r=0;
 a.weapons[0].min=0;a.gunnery=1;a.piloting=1;
 const shot=g.preview(a.id,t.id,0);
 assert.equal(shot.legal,true,shot.reason);
 assert.equal(shot.targetNumber,1);
 assert.equal(shot.chance,100);
 const kick=g.physicalPreview(a.id,t.id,'kick','RL');
 assert.equal(kick.legal,true,kick.reason);
 assert.equal(kick.targetNumber,-1);
 a.gunnery=13;
 const impossible=g.preview(a.id,t.id,0);
 assert.equal(impossible.targetNumber,13);
 assert.equal(impossible.chance,0);
});

test('BMM p.6: a friendly BattleMech cannot be directly targeted',()=>{
 const g=flatGame(),a=g.units[0],friend=g.units[1];
 a.q=0;a.r=0;a.facing=0;friend.q=1;friend.r=0;
 a.weapons[0].min=0;
 assert.equal(g.preview(a.id,friend.id,0).legal,false);
 assert.equal(g.physicalPreview(a.id,friend.id,'kick','RL').legal,false);
});

test('BMM p.9: ordinary IS MechWarriors start at Gunnery 4 / Piloting 5',()=>{
 const g=flatGame();
 for(const unit of g.units){
  assert.equal(unit.gunnery,4);
  assert.equal(unit.piloting,5);
 }
 assert.deepEqual(defaultMechWarriorSkills(),{gunnery:4,piloting:5});
 assert.deepEqual(defaultMechWarriorSkills('Inner Sphere'),{gunnery:4,piloting:5});
});

test('BMM p.9: default Clan skill ratings are Gunnery 3 / Piloting 4',()=>{
 assert.deepEqual(defaultMechWarriorSkills('Clan'),{gunnery:3,piloting:4});
 assert.deepEqual(defaultMechWarriorSkills('IS'),{gunnery:4,piloting:5});
});

test('BMM p.9: ranged attacks use Gunnery; physical attacks use Piloting',()=>{
 const g=flatGame(),a=g.units[0],t=g.units[2];
 a.q=0;a.r=0;a.facing=0;t.q=1;t.r=0;
 a.weapons[0].min=0;
 a.gunnery=5;a.piloting=3;
 assert.equal(g.preview(a.id,t.id,0).targetNumber,5);
 assert.equal(g.physicalPreview(a.id,t.id,'kick','RL').targetNumber,1);
 a.gunnery=2;a.piloting=6;
 assert.equal(g.preview(a.id,t.id,0).targetNumber,2);
 assert.equal(g.physicalPreview(a.id,t.id,'kick','RL').targetNumber,4);
});

test('BMM p.10: initiative rerolls 101 consecutive ties and honors the higher 2D6',()=>{
 const g=flatGame(),sequence=[];
 for(let i=0;i<101;i++)sequence.push(0,0,0,0);
 sequence.push(.99,.99,0,0);
 g.rng=()=>sequence.shift();
 g.initiative();
 assert.equal(g.initiativeWinner,0);
 assert.equal(g.phase,'move');
 assert.equal(g.phaseRolls.length,204);
 assert.deepEqual(g.queue,[1,0,1,0]);
 assert.equal(sequence.length,0);
});

test('BMM p.10: either team can win and the losing side moves first',()=>{
 for(const [dice,winner] of [[0,1],[1,0]]){
  const g=flatGame(),seq=dice===0?[0,0,.99,.99]:[.99,.99,0,0];
  g.rng=()=>seq.shift();
  g.initiative();
  assert.equal(g.initiativeWinner,winner);
  assert.equal(g.queue[0],1-winner);
  assert.equal(g.activeTeam,1-winner);
 }
});

test('BMM p.12: initiative batches honor 2:1 and 3:1 force ratios',()=>{
 const g=flatGame();g.initiativeWinner=0;
 g.units[1].dead=true;g.buildQueue();
 assert.deepEqual(g.queue,[1,1,0],'one green vs two red (losing side twice as many)');
 g.units[1].dead=false;g.units[2].team=0;g.buildQueue();
 assert.deepEqual(g.queue,[1,0,0,0],'three green vs one red');
 g.initiativeWinner=1;g.buildQueue();
 assert.deepEqual(g.queue,[0,0,0,1],'winning red moves after losing green');
});

test('BMM pp.10-12: normal turns advance through exactly six ordered phases',()=>{
 const g=flatGame(),seq=[.99,.99,0,0];g.rng=()=>seq.shift()??.5;
 assert.equal(g.phase,'initiative');
 assert.equal(g.nextPhase().ok,true);assert.equal(g.phase,'move');
 assert.equal(g.nextPhase().ok,false,'cannot skip pending movement actions');
 for(const phase of ['fire','physical','heat','end','initiative']){
  g.queue=[];
  assert.equal(g.nextPhase().ok,true);
  assert.equal(g.phase,phase);
 }
 assert.equal(g.round,2);
});

test('BMM p.10: a shutdown or unconscious unit still consumes a movement selection',()=>{
 const g=flatGame(),u=g.units[0];
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];u.shutdown=true;u.unconscious=true;
 assert.equal(g.hold(u.id).ok,true);
 assert.equal(u.moved,true);
 assert.equal(g.queue.length,0);
});


test('BMM p.11: all declared weapon attacks complete before phase consciousness checks',()=>{
 const g=flatGame(),t=g.units[2],observed=[];
 g.rng=()=>0;g.phase='fire';
 g.hit=(victim,damage)=>{
  g.wound(victim,1);
  observed.push(victim.unconscious);
  return {location:'CT',damage,hits:[]};
 };
 const shot={index:0,target:t.id,weapon:{...g.units[0].weapons[0],ammo:null,rack:0},
  preview:{targetNumber:2,side:'front',cover:false,underwaterCover:false},
  bin:null,aim:null,heatMode:false};
 g.declarations=[{id:0,shots:[shot]},{id:1,shots:[shot]}];
 g.resolveFire();
 assert.deepEqual(observed,[false,false]);
 assert.equal(t.pilotWounds,2);
 assert.equal(t.unconscious,true);
 assert.equal(g.deferConsciousness,false);
 assert.equal(g.resolution.length,2);
});

test('BMM p.12: physical attacks also complete before unconsciousness is checked',()=>{
 const g=flatGame(),t=g.units[2],observed=[];
 g.rng=()=>0;g.phase='physical';
 g.hit=(victim,damage)=>{
  g.wound(victim,1);
  observed.push(victim.unconscious);
  return {location:'CT',damage,hits:[]};
 };
 const strike={target:t.id,type:'punch',targetNumber:2,damage:5,side:'front',table:'punch'};
 g.physicalDeclarations=[{id:0,...strike},{id:1,...strike}];
 g.resolvePhysical();
 assert.deepEqual(observed,[false,false]);
 assert.equal(t.pilotWounds,2);
 assert.equal(t.unconscious,true);
 assert.equal(g.deferConsciousness,false);
});

test('BMM p.11: phase consciousness rolls occur before required piloting rolls',()=>{
 const g=flatGame(),target=g.units[2],order=[],original=g.consciousness.bind(g);
 g.rng=()=>0;g.phase='fire';
 g.consciousness=u=>{
  if(u===target)order.push('consciousness');
  return original(u);
 };
 g.fall=u=>{if(u===target){order.push('fall');u.prone=true;}};
 g.hit=(victim,damage)=>{
  order.push('attack');
  g.wound(victim,1);
  victim.psrs.push({modifier:0,reason:'Damage'});
  return {location:'CT',damage,hits:[]};
 };
 const shot={index:0,target:target.id,weapon:{...g.units[0].weapons[0],ammo:null,rack:0},
  preview:{targetNumber:2,side:'front',cover:false,underwaterCover:false},
  bin:null,aim:null,heatMode:false};
 g.declarations=[{id:0,shots:[shot]},{id:1,shots:[shot]}];
 g.resolveFire();
 assert.deepEqual(order.slice(0,4),['attack','attack','consciousness','fall']);
 assert.equal(g.deferConsciousness,false);
});

test('BMM p.9: injuries outside attack resolution retain immediate consciousness checks',()=>{
 const g=flatGame(),u=g.units[2];g.rng=()=>0;
 g.wound(u,1);
 assert.equal(u.pilotWounds,1);
 assert.equal(u.unconscious,true);
 assert.equal(u.consciousChecks,0);
});

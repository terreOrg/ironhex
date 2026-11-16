import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game,defaultMechWarriorSkills,locationNameForMech} from '../dist/engine.js';
import {construct,example,isBattleMechConfiguration,QUAD_LEG_LOCATIONS,quadStructuralLayout} from '../dist/construction.js';
import {recordSheet} from '../dist/record-sheet.js';
import {normalizedCriticalDamage,applyCriticalDamage,captureCriticalDamage,damagedComponents} from '../dist/component-damage.js';

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

test('BMM p.6: all 36 dice combinations obey inclusive target checks for TN -3 through 15',()=>{
 const g=flatGame(),targets=Array.from({length:19},(_,i)=>i-3);
 let comparisons=0;
 for(let first=1;first<=6;first++)for(let second=1;second<=6;second++)
  for(const target of targets){
   const values=[(first-.5)/6,(second-.5)/6];
   g.rng=()=>values.shift();
   const total=g.roll('Exhaustive target number',target);
   assert.equal(total,first+second);
   assert.equal(g.phaseRolls.at(-1).result,
    first+second>=target?'Успех':'Неудача',
    'dice '+first+','+second+' target '+target);
   comparisons++;
  }
 assert.equal(comparisons,684);
});

test('BMM p.5: the Mech abbreviation includes both biped and quad BattleMechs',()=>{
  for(const type of ['Biped','Quad'])
    assert.equal(isBattleMechConfiguration(type),true,type);
  for(const type of ['Tripod','Vehicle','Aero','','quad',null,undefined])
    assert.equal(isBattleMechConfiguration(type),false,String(type));
});

test('BMM p.5: quad designs never silently use biped-only construction',()=>{
  const biped=construct({...example,config:'Biped'});
  assert.deepEqual(biped.errors,[]);
  assert.equal(biped.unit.config,'Biped');
  const implicit=construct(example);
  assert.deepEqual(implicit.errors,[]);
  assert.equal(implicit.unit.config,'Biped');
  const quad=construct({...example,config:'Quad'});
  assert(quad.errors.some(error=>error.includes('Четырёхногие')),
    'Quad construction must explicitly remain unsupported: '+quad.errors.join('; '));
  const other=construct({...example,config:'Tripod'});
  assert(other.errors.some(error=>error.includes('Конфигурация')),
    'A non-BattleMech must never be relabelled as a biped');
});

test('BMM p.5 and p.33: all quad limbs are legs with six-slot actuator sections',()=>{
 const expected={LA:'Left Front Leg',RA:'Right Front Leg',LL:'Left Rear Leg',RL:'Right Rear Leg'};
 assert.deepEqual(QUAD_LEG_LOCATIONS,expected);
 for(let ton=20;ton<=100;ton+=5){
  const plan=quadStructuralLayout(ton);
  assert.equal(plan.config,'Quad');
  assert.deepEqual(plan.legLocations,expected);
  for(const loc of Object.keys(expected)){
   assert.equal(plan.structure[loc],plan.structure.LL,'Each quad leg has the same internal structure at '+ton+' t');
   assert.deepEqual(plan.slots[loc],['hip','upper','lower','foot',null,null],
    'Front legs may not inherit 12 biped-arm slots');
  }
  assert.equal(plan.slots.CT.length,12);
  assert.equal(plan.slots.LT.length,12);
  assert.equal(plan.slots.RT.length,12);
  assert.equal(plan.slots.HD.length,6);
 }
 const quad55=quadStructuralLayout(55);
 assert.equal(quad55.structure.LA,13);
 assert.equal(quad55.structure.RA,13);
 assert.equal(construct(example).unit.structure.LA,9,'Biped arms are distinct from quad front legs');
 for(const invalid of [15,22,101,55.5,NaN])
  assert.throws(()=>quadStructuralLayout(invalid),/quad_tonnage/);
});

test('BMM p.5 quad layout is inspectable but cannot enter unsupported battles',()=>{
 const result=construct({...example,config:'Quad'});
 assert(result.errors.length>0);
 assert.equal(result.unit,undefined);
 assert.equal(result.quadLayout.config,'Quad');
 assert.equal(result.quadLayout.slots.LA.length,6);
 assert.equal(result.quadLayout.structure.LA,result.quadLayout.structure.LL);
 assert.equal(construct(example).unit.config,'Biped');
});

test('BMM p.5: audit-only Quad construction uses four true leg systems',()=>{
 const auditFixture={...example,name:'Quad topology audit',config:'Quad',
  jump:0,sinks:10,equipment:[],removeActuators:undefined};
 const blocked=construct(auditFixture);
 assert(blocked.errors.length>0);
 assert.equal(blocked.unit,undefined,'Public constructor defaults to fail-closed');
 const built=construct(auditFixture,{auditQuad:true});
 assert.deepEqual(built.errors,[],built.errors.join('; '));
 const u=built.unit;
 assert.equal(u.config,'Quad');
 assert.equal(u.structure.LA,13,'The 55 ton front leg has leg, not arm structure');
 for(const leg of ['LA','RA','LL','RL']){
  assert.deepEqual(u.slots[leg],['hip','upper','lower','foot',null,null]);
  assert.equal(u.crit[leg].length,6);
  assert.equal(u.maxStructure[leg],13);
 }
 const illegal=construct({...auditFixture,removeActuators:['LA']},{auditQuad:true});
 assert(illegal.errors.some(x=>x.includes('Quad leg actuators')));
 const weaponInLeg=construct({...auditFixture,equipment:[{type:'Medium Laser',location:'RA',slot:5}]},
  {auditQuad:true});
 assert.deepEqual(weaponInLeg.errors,[],weaponInLeg.errors.join('; '));
 assert.equal(weaponInLeg.unit.weapons[0].location,'RA');
 const hatchet=construct({...auditFixture,equipment:[{type:'hatchet',location:'LA',slot:5}]},{auditQuad:true});
 assert(hatchet.errors.some(x=>x.includes('Топор')));
 assert.equal(construct(auditFixture).unit,undefined,'Experiment must not change the standard default');
});

test('BMM pp. 5,19: audit-only quad jump jets fit front or rear legs, not biped arms',()=>{
 const fixture={...example,name:'Quad jump topology',config:'Quad',
  jump:1,sinks:10,equipment:[]};
 for(const leg of ['LA','RA','LL','RL']){
  const config={...fixture,equipment:[{type:'jump',location:leg,slot:5}]};
  const q=construct(config,{auditQuad:true});
  assert.deepEqual(q.errors,[],leg+': '+q.errors.join('; '));
  assert.equal(q.unit.slots[leg][4],'jump');
  assert.equal(q.unit.jump,1);
  const blocked=construct(config);
  assert(blocked.errors.length>0);
  assert.equal(blocked.unit,undefined);
 }
 const biped=construct({...fixture,config:'Biped',equipment:[
  {type:'jump',location:'LA',slot:5}]});
 assert(biped.errors.some(x=>x.includes('Прыжковые двигатели')),
  'A biped arm must not become a leg for jump-jet placement');
});

test('BMM p.5 quad front legs cannot split a biped arm/torso weapon',()=>{
 const fixture={...example,name:'Quad split topology',config:'Quad',
  jump:0,sinks:10,equipment:[{type:'AC/20',location:'LT',slot:1,
   splitLocation:'LA',splitCount:4}]};
 const result=construct(fixture,{auditQuad:true});
 assert(result.errors.some(x=>x.includes('Quad leg cannot split critical slots')),
  'Front leg must not be treated as an arm for split critical slots');
 assert.equal(construct(fixture).unit,undefined);
});

test('BMM p.5: quad diagnostic record sheet shows four legs, not biped arms',()=>{
 const fixture={...example,name:'Quad sheet audit',config:'Quad',
  jump:0,sinks:10,equipment:[]};
 const result=construct(fixture,{auditQuad:true});
 assert.deepEqual(result.errors,[]);
 const u={...result.unit,id:0,team:0,variant:'QUAD-AUDIT',
  gunnery:4,piloting:5,pilotWounds:0,unconscious:false,dead:false,
  shutdown:false,heat:0,pendingHeat:0,sinksLost:0};
 const html=recordSheet(u);
 for(const label of ['Правая передняя нога','Левая передняя нога',
  'Правая задняя нога','Левая задняя нога'])
  assert(html.includes(label),'Quad sheet misses leg location: '+label);
 assert(html.includes('Quad (диагностическая схема)'));
 assert(!html.includes('Правая рука / нога'));
 assert(!html.includes('Левая рука / нога'));
 assert(html.includes('M244 82 L295 82'));
 const biped=construct(example);
 assert.deepEqual(biped.errors,[]);
 const b={...u,...biped.unit};
 assert(recordSheet(b).includes('Правая рука / нога'));
 assert(!recordSheet(b).includes('Quad (диагностическая схема)'));
});

test('BMM pp.5,45: quad front/rear leg criticals preserve their six physical slots',()=>{
 const config={...example,name:'Quad critical persistence',config:'Quad',
  jump:1,sinks:10,equipment:[
   {type:'jump',location:'RA',slot:5},
   {type:'Medium Laser',location:'RA',slot:6}
  ]};
 const standard=construct(config);
 assert(standard.errors.length>0,'A quad remains unsupported in ordinary combat');
 assert.equal(standard.unit,undefined);
 const built=construct(config,{auditQuad:true});
 assert.deepEqual(built.errors,[],built.errors.join('; '));
 const unit=built.unit;
 for(const leg of ['LA','RA','LL','RL']){
  assert.deepEqual(Object.keys(unit.actuators[leg]).sort(),['foot','hip','lower','upper']);
  assert(unit.slots[leg].length===6);
  assert(unit.crit[leg].length===6);
 }
 assert.deepEqual(unit.slots.RA,
  ['hip','upper','lower','foot','jump','w:0']);
 // The server's ordinary path must continue rejecting the unsupported type.
 assert.throws(()=>normalizedCriticalDamage(config,{RA:[0]}),/invalid_component_config/);
 const malformed={RA:[5,0,4,0,6,100,-1,1.2,'3'],LA:[0,1,2,3,5]};
 const sanitized=normalizedCriticalDamage(config,malformed,{auditQuad:true});
 assert.deepEqual(sanitized,{LA:[0,1,2,3],RA:[0,4,5]});
 applyCriticalDamage(unit,sanitized);
 assert.equal(unit.actuators.RA.hip,true);
 assert.equal(unit.actuators.LA.hip,true);
 assert.equal(unit.actuators.LA.foot,true);
 assert.equal(unit.actuators.RL.hip,false);
 assert.equal(unit.jumpLost,1);
 assert.equal(unit.weapons[0].destroyed,true);
 assert.deepEqual(captureCriticalDamage(unit),sanitized);
 const repairs=damagedComponents(config,sanitized,{auditQuad:true});
 assert(repairs.some(item=>item.location==='RA'&&item.slot===1&&
  item.kind==='service'&&item.serviceCost>0));
 assert(repairs.some(item=>item.location==='RA'&&item.slot===5&&
  item.kind==='system'));
 assert(repairs.some(item=>item.location==='RA'&&item.slot===6&&
  item.kind==='weapon'));
 assert.deepEqual(damagedComponents(config,sanitized),[],
  'Unimplemented quad maintenance is not exposed in the public economy');
});

test('BMM pp.5,33: combat hit labels use quad front-leg names and distinct biped arms',()=>{
 const config={...example,name:'Quad hit topology',config:'Quad',
  jump:0,sinks:10,equipment:[]};
 const built=construct(config,{auditQuad:true});
 assert.deepEqual(built.errors,[]);
 const game=flatGame(),target=game.units[0];
 Object.assign(target,built.unit);
 assert.equal(target.config,'Quad');
 for(const [location,label] of [
  ['LA','Левая передняя нога'],['RA','Правая передняя нога'],
  ['LL','Левая задняя нога'],['RL','Правая задняя нога']
 ])assert.equal(locationNameForMech(target,location),label);
 const hits=[];
 game.damage=(unit,location,amount,options)=>{
  hits.push({location,amount});
  return [];
 };
 // Printed p.33 Front/Rear column, roll 4 -> right front leg, roll 11 -> left front leg.
 for(const [first,second,expected,label] of [
  [2,2,'RA','Правая передняя нога'],
  [5,6,'LA','Левая передняя нога']
 ]){
  const dice=[(first-.5)/6,(second-.5)/6];
  game.rng=()=>dice.shift();
  const result=game.hit(target,5,'front');
  assert.equal(result.location,expected);
  assert.equal(hits.at(-1).location,expected);
  assert(game.phaseRolls.at(-1).result.includes(label));
 }
 target.config='Biped';
 assert.equal(locationNameForMech(target,'RA'),'Правая рука');
 assert.equal(locationNameForMech(target,'LA'),'Левая рука');
});

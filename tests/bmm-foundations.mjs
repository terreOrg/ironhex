import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game,defaultMechWarriorSkills,locationNameForMech,quadLateralDirections,DIRS,mechLegLocation,partialCoverObscures,QUAD_PUNCH_LOCATIONS,QUAD_KICK_LOCATIONS,quadProneFireBonus,quadImmobileDueToLegLoss,BUILDING_ENTRY,buildingMovementPSRModifier,buildingImpactSide} from '../dist/engine.js';
import {construct,example,isBattleMechConfiguration,QUAD_LEG_LOCATIONS,quadStructuralLayout} from '../dist/construction.js';
import {recordSheet} from '../dist/record-sheet.js';
import {normalizedCriticalDamage,applyCriticalDamage,captureCriticalDamage,damagedComponents} from '../dist/component-damage.js';
import {validateTacticalOrder} from '../apps/api/src/server-combat.mjs';

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

test('BMM p.6: quad leg critical capacities and armor limits cover 20-100 tons',()=>{
 // Independent expected standard internal-structure leg sequence, in 5-ton increments.
 const legStructure=[4,6,7,8,10,11,12,13,14,15,15,16,17,18,19,20,21];
 const legs=['LA','RA','LL','RL'];
 for(let step=0;step<legStructure.length;step++){
  const mass=20+5*step,layout=quadStructuralLayout(mass);
  for(const leg of legs){
   assert.equal(layout.structure[leg],legStructure[step],
    mass+' ton '+leg+' leg structure');
   assert.equal(layout.slots[leg].length,6,mass+' ton '+leg+' slot count');
  }
 }
 const base={...example,name:'Quad armor boundaries',config:'Quad',
  jump:0,sinks:10,equipment:[]};
 for(const leg of legs){
  const limit=2*quadStructuralLayout(base.tonnage).structure[leg];
  const legal={...base,armor:{...base.armor,[leg]:limit}};
  const valid=construct(legal,{auditQuad:true});
  assert.deepEqual(valid.errors,[],leg+' legal armor '+limit+': '+valid.errors.join('; '));
  const exceeded={...base,armor:{...base.armor,[leg]:limit+1}};
  const invalid=construct(exceeded,{auditQuad:true});
  assert(invalid.errors.some(error=>error.includes(leg)&&error.includes('брони')),
   leg+' must reject >'+limit+' armor');
  const outOfRange=construct({...base,equipment:[
   {type:'Medium Laser',location:leg,slot:7}
  ]},{auditQuad:true});
  assert(outOfRange.errors.some(error=>error.includes(leg)&&error.includes('слот')),
   leg+' must never accept a seventh critical slot');
 }
});

test('BMM p.15: intact quad can shift into each side hex for terrain cost + 1 MP',()=>{
 const config={...example,name:'Quad lateral shift',config:'Quad',
  jump:0,sinks:10,equipment:[]};
 const built=construct(config,{auditQuad:true});
 assert.deepEqual(built.errors,[]);
 const g=flatGame(),u=g.units[0];
 Object.assign(u,built.unit);
 for(const other of g.units.slice(1))other.dead=true;
 u.q=0;u.r=0;u.facing=0;u.spent=0;u.moveMode='stand';u.prone=false;
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 assert.equal(quadLateralDirections(u,'walk').length,4);
 assert.equal(quadLateralDirections(u,'run').length,2);
 const destinations=g.reachable(u,'walk');
 for(const [dir,kind] of [[1,'forward'],[5,'forward'],[2,'backward'],[4,'backward']]){
  const [q,r]=DIRS[dir];
  const p=destinations.find(dest=>dest.q===q&&dest.r===r);
  assert(p,'Quad cannot shift to dir '+dir);
  assert.equal(p.cost,2,'Lateral shift must cost base 1 MP plus 1 MP');
  assert.equal(p.facing,0,'A lateral shift may not rotate the chassis');
  assert.equal(p.path.at(-1).lateral,kind);
 }
 const moved=g.move(u.id,...DIRS[1],'walk');
 assert(moved.ok,moved.error);
 assert.equal(u.facing,0);
 assert.equal(u.spent,2);
});

test('BMM p.15: rearward quad shifts are walking-only and cannot change level',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},
   {auditQuad:true});
 assert.deepEqual(built.errors,[]);
 const g=flatGame(),u=g.units[0];
 Object.assign(u,built.unit);for(const other of g.units.slice(1))other.dead=true;
 u.q=0;u.r=0;u.facing=0;u.moveMode='stand';u.spent=0;
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 assert(quadLateralDirections(u,'run').every(x=>!x.backward));
 assert(quadLateralDirections(u,'evade').every(x=>!x.backward));
 assert(g.reachable(u,'run').every(dest=>dest.path.every(p=>p.lateral!=='backward')));
 const uphill=g.tile(...DIRS[2]);
 uphill.height=1;uphill.surface=1;
 const targets=g.reachable(u,'walk');
 for(const dest of targets){
  let prev={q:u.q,r:u.r};
  for(const step of dest.path){
   if(step.lateral==='backward')
    assert.equal(g.tile(step.q,step.r).height,g.tile(prev.q,prev.r).height,
      'Walking backwards laterally may not change levels');
   prev=step;
  }
 }
 const heavy=g.tile(...DIRS[1]);
 heavy.type='heavy';heavy.height=0;heavy.surface=0;
 const side= g.reachable(u,'walk').find(x=>x.q===DIRS[1][0]&&x.r===DIRS[1][1]);
 assert(side);
 assert.equal(side.cost,4,'Heavy woods terrain 3 + lateral shift 1');
 assert.equal(side.facing,0);
 assert.equal(side.path.at(-1).lateral,'forward');
});

test('BMM p.15: destroyed quad leg disables all lateral shifts; bipeds never gain them',()=>{
 const g=flatGame(),u=g.units[0];
 const config={...example,config:'Quad',jump:0,sinks:10,equipment:[]};
 const built=construct(config,{auditQuad:true});
 assert.deepEqual(built.errors,[]);
 Object.assign(u,built.unit);for(const other of g.units.slice(1))other.dead=true;
 u.q=0;u.r=0;u.facing=0;u.moveMode='stand';u.spent=0;
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 for(const leg of ['LA','RA','LL','RL']){
  u.structure[leg]=0;
  assert.deepEqual(quadLateralDirections(u,'walk'),[],leg);
  assert(g.reachable(u,'walk').every(dest=>
    dest.path.every(step=>!step.lateral)),leg);
  u.structure[leg]=u.maxStructure[leg];
 }
 u.config='Biped';
 assert.deepEqual(quadLateralDirections(u,'walk'),[]);
 assert(g.reachable(u,'walk').every(dest=>dest.path.every(step=>!step.lateral)));
});

test('BMM p.15: explicit lateral order preserves Quad facing, validates all four direction names',()=>{
 const design=construct({...example,name:'Quad explicit shift',config:'Quad',
   jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(design.errors,[]);
 const createGame=()=>{
  const g=flatGame(),u=g.units[0];
  Object.assign(u,structuredClone(design.unit));
  for(const other of g.units.slice(1))other.dead=true;
  u.q=0;u.r=0;u.facing=0;u.spent=0;u.moveMode='stand';
  g.phase='move';g.queue=[u.team];g.activeTeam=u.team;g.actingId=null;
  return {g,u};
 };
 for(const [direction,offset,mode] of [
  ['shift-left-forward',1,'walk'],
  ['shift-right-forward',5,'run'],
  ['shift-left-backward',2,'walk'],
  ['shift-right-backward',4,'walk']
 ]){
  const {g,u}=createGame(),[q,r]=DIRS[offset];
  const order={type:'move',version:1,id:0,q,r,mode,lateral:direction};
  assert.equal(validateTacticalOrder(order).lateral,direction);
  const out=g.move(u.id,q,r,mode,{lateral:direction});
  assert(out.ok,direction+': '+out.error);
  assert.equal(out.to.q,q);assert.equal(out.to.r,r);
  assert.equal(u.facing,0,direction+' must retain facing');
  assert.equal(u.spent,2,direction+' must cost exactly 2 MP on clear level terrain');
 }
 const {g,u}=createGame();
 assert.equal(g.move(u.id,...DIRS[2],'run',{lateral:'shift-left-backward'}).ok,false,
  'Rearward shift must not use running MP');
 assert.equal(g.move(u.id,...DIRS[1],'walk',{lateral:'shift-right-forward'}).ok,false,
  'Shift direction may not be spoofed with an adjacent destination');
 assert.equal(g.move(u.id,0,0,'walk',{lateral:'shift-left-forward'}).ok,false,
  'A lateral move may not stand still');
 u.structure.LA=0;
 assert.equal(g.move(u.id,...DIRS[1],'walk',{lateral:'shift-left-forward'}).ok,false,
  'An injured quad must not use lateral shifts');
 u.structure.LA=u.maxStructure.LA;u.config='Biped';
 assert.equal(g.move(u.id,...DIRS[1],'walk',{lateral:'shift-left-forward'}).ok,false,
  'Biped must never use explicit Quad-only movement');
 assert.throws(()=>validateTacticalOrder({type:'move',version:1,id:0,
   q:1,r:-1,mode:'walk',lateral:'teleport'}),/invalid_command/);
});

test('BMM p.15: explicit lateral shift respects elevation, heavy terrain and occupancy',()=>{
 const design=construct({...example,name:'Quad explicit terrain',config:'Quad',
  jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(design.errors,[]);
 const make=()=>{
  const g=flatGame(),u=g.units[0];
  Object.assign(u,structuredClone(design.unit));
  for(const other of g.units.slice(1))other.dead=true;
  u.q=0;u.r=0;u.facing=0;u.spent=0;u.moveMode='stand';
  g.phase='move';g.queue=[u.team];g.activeTeam=u.team;g.actingId=null;
  return {g,u};
 };
 const terrain=make(),dest=terrain.g.tile(...DIRS[1]);
 dest.type='heavy';
 const shift=terrain.g.move(0,...DIRS[1],'walk',{lateral:'shift-left-forward'});
 assert(shift.ok,shift.error);
 assert.equal(terrain.u.spent,4,'Heavy woods 3 MP + lateral surcharge 1');
 const blocked=make();blocked.g.tile(...DIRS[2]).height=1;
 assert.equal(blocked.g.move(0,...DIRS[2],'walk',
  {lateral:'shift-left-backward'}).ok,false,'No backward change in elevation');
 const climbed=make();climbed.g.tile(...DIRS[1]).height=1;
 const ascent=climbed.g.move(0,...DIRS[1],'walk',{lateral:'shift-left-forward'});
 assert(ascent.ok,ascent.error);
 assert.equal(climbed.u.spent,3,'Forward-side ascent costs terrain 1 + height 1 + shift 1');
 const occupied=make();occupied.g.units[1].dead=false;
 occupied.g.units[1].q=DIRS[1][0];occupied.g.units[1].r=DIRS[1][1];
 assert.equal(occupied.g.move(0,...DIRS[1],'walk',
  {lateral:'shift-left-forward'}).ok,false,'Cannot end a shift in occupied hex');
});

test('BMM p.19: intact Quad stands without a PSR, spends 2 MP and 1 heat, chooses facing',()=>{
 const design=construct({...example,name:'Quad standing',config:'Quad',
  jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(design.errors,[]);
 const create=()=>{
  const g=flatGame(),u=g.units[0];
  Object.assign(u,structuredClone(design.unit));
  for(const other of g.units.slice(1))other.dead=true;
  g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
  u.prone=true;u.facing=0;u.spent=0;u.standAttempts=0;u.moveMode='stand';
  g.phaseRolls=[];return {g,u};
 };
 const {g,u}=create();
 assert.equal(validateTacticalOrder({type:'stand',version:1,id:0,facing:4}).facing,4);
 assert.throws(()=>validateTacticalOrder({type:'stand',version:1,id:0,facing:6}),/invalid_command/);
 assert.equal(g.stand(0,-1).ok,false,'Invalid facing must not be accepted');
 assert.equal(u.prone,true);
 const result=g.stand(0,4);
 assert(result.ok,result.error);
 assert.equal(u.prone,false);
 assert.equal(u.facing,4,'Choosing new facing when standing is free');
 assert.equal(u.spent,2,'Standing is 2 MP');
 assert.equal(u.pendingHeat,1,'Standing always generates 1 heat');
 assert.equal(u.standAttempts,1);
 assert.equal(g.phaseRolls.length,0,'Intact quad has no standing PSR');
 const biped=create();
 biped.u.config='Biped';
 const legacy=biped.g.stand(0);
 assert(legacy.ok,legacy.error);
 assert(biped.g.phaseRolls.some(x=>x.kind.includes('Подъём')),
  'Biped standing must still make a PSR');
});

test('BMM pp.19,44: leg loss changes Quad standing attempts and roll requirement',()=>{
 const design=construct({...example,name:'Quad damaged standing',config:'Quad',
  jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(design.errors,[]);
 const create=()=>{
  const g=flatGame(),u=g.units[0];
  Object.assign(u,structuredClone(design.unit));
  for(const other of g.units.slice(1))other.dead=true;
  g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
  u.prone=true;u.spent=0;u.standAttempts=0;u.moveMode='stand';
  g.phaseRolls=[];g.rng=()=>.99;return {g,u};
 };
 const one=create();one.u.structure.LA=0;
 assert(one.g.stand(0).ok);
 assert(one.g.phaseRolls.some(x=>x.kind.includes('Подъём')),
  'With one destroyed leg, a Quad must make a standing PSR');
 const two=create();
 two.u.structure.LA=0;two.u.structure.RA=0;
 two.u.standAttempts=1;
 assert.equal(two.g.stand(0).ok,false,'With only two legs, one attempt per turn');
 two.u.standAttempts=0;
 assert(two.g.stand(0).ok,'Two-leg Quad may attempt one running stand');
 assert.equal(two.u.moveMode,'run');
 assert.equal(two.u.spent,2);
 assert(two.g.phaseRolls.some(x=>x.kind.includes('Подъём')));
 const three=create();
 three.u.structure.LA=0;three.u.structure.RA=0;three.u.structure.LL=0;
 assert.equal(three.g.stand(0).ok,false,'Three destroyed legs prevent standing');
});

test('BMM pp.44,53: Quad PSR avoids biped lost-leg penalties and uses -2 only for fall avoidance',()=>{
 const design=construct({...example,name:'Quad PSR audit',config:'Quad',
  jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(design.errors,[]);
 const g=flatGame(),u=g.units[0];
 Object.assign(u,design.unit);
 assert.equal(g.psrMod(u),0);
 assert.equal(g.psrMod(u,true),-2,'Intact quad has -2 only on fall avoidance');
 u.actuators.LA.upper=true;
 assert.equal(g.psrMod(u),1,'Front leg actuator contributes to PSR');
 assert.equal(g.psrMod(u,true),-1);
 u.structure.RL=0;
 assert.equal(g.psrMod(u),1,'First lost quad leg does not receive biped +5');
 assert.equal(g.psrMod(u,true),1,'First lost quad leg loses -2 fall bonus');
 u.actuators.LA.upper=false;
 assert.equal(g.psrMod(u),0);
 u.structure.RA=0;
 assert.equal(g.psrMod(u),5,'Two lost quad legs act as a biped with one leg lost');
 u.structure.LA=0;
 assert.equal(g.psrMod(u),10,'Three lost quad legs act as a biped with no legs');
 const b=flatGame(),biped=b.units[0];
 assert.equal(b.psrMod(biped),0);
 assert.equal(b.psrMod(biped,true),0,'Biped PSR modifiers stay unchanged');
});

test('BMM pp.19,44,53: standing PSR does not include intact-quad fall modifier',()=>{
 const design=construct({...example,name:'Quad stand PSR',config:'Quad',
  jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(design.errors,[]);
 const g=flatGame(),u=g.units[0];
 Object.assign(u,design.unit);
 for(const other of g.units.slice(1))other.dead=true;
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 u.prone=true;u.spent=0;u.moveMode='stand';u.standAttempts=0;
 u.structure.LL=0;g.rng=()=>.99;
 const result=g.stand(0);
 assert(result.ok,result.error);
 const roll=g.phaseRolls.find(x=>x.kind.includes('Подъём'));
 assert(roll,'Standing on three quad legs must require a PSR');
 assert.equal(roll.target,u.piloting,'First lost quad leg is not biped +5 penalty');
});

test('BMM p.44: losing a single Quad leg reduces walking MP by one but preserves running',()=>{
 const fixture=construct({...example,name:'Quad leg-loss speed',config:'Quad',
  jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(fixture.errors,[]);
 const g=flatGame(),u=g.units[0];
 Object.assign(u,fixture.unit);
 for(const other of g.units.slice(1))other.dead=true;
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 u.q=0;u.r=0;u.moveMode='stand';u.spent=0;u.prone=false;
 assert.equal(g.mp(u,'walk'),5);
 assert.equal(g.mp(u,'run'),8);
 for(const leg of ['LA','RA','LL','RL']){
  u.structure[leg]=0;
  assert.equal(g.mp(u,'walk'),4,'One lost '+leg+' costs -1 walking MP');
  assert.equal(g.mp(u,'run'),6,'One lost '+leg+' still permits running');
  assert(g.reachable(u,'run').length>0,'A single lost '+leg+' must not disable running');
  u.structure[leg]=u.maxStructure[leg];
 }
 u.structure.LA=0;u.structure.RL=0;
 assert.equal(g.mp(u,'walk'),1,'Two lost quad legs = one lost biped leg');
 assert.equal(g.mp(u,'run'),0);
 assert.deepEqual(g.reachable(u,'run'),[]);
 u.structure.RA=0;
 assert.equal(g.mp(u,'walk'),0,'Three lost quad legs = immobile on ground');
 assert.equal(g.mp(u,'run'),0);
 const b=flatGame(),biped=b.units[0];
 biped.structure.LL=0;
 assert.equal(b.mp(biped,'walk'),1);
 assert.equal(b.mp(biped,'run'),0,'Biped one-leg running prohibition remains');
});

test('BMM p.19: a failed two-leg Quad stand remains prone and cannot retry this turn',()=>{
 const design=construct({...example,name:'Quad failed stand',config:'Quad',
  jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(design.errors,[]);
 const g=flatGame(),u=g.units[0];
 Object.assign(u,design.unit);
 for(const other of g.units.slice(1))other.dead=true;
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 u.prone=true;u.facing=0;u.spent=0;u.pendingHeat=0;
 u.moveMode='stand';u.standAttempts=0;
 u.structure.LA=0;u.structure.RA=0;
 let fallCount=0;
 g.fall=actor=>{assert.equal(actor,u);actor.prone=true;fallCount++;};
 g.rng=()=>0; // roll 2, below the standing PSR target
 const result=g.stand(0,5);
 assert(result.ok,result.error);
 assert.equal(fallCount,1,'Failed PSR causes another fall');
 assert.equal(u.prone,true,'A failed stand does not make the quad upright');
 assert.equal(u.facing,0,'Chosen facing applies only after successful stand');
 assert.equal(u.standAttempts,1);
 assert.equal(u.spent,2);
 assert.equal(u.pendingHeat,1);
 assert.equal(u.moveMode,'run');
 const roll=g.phaseRolls.find(x=>x.kind.includes('Подъём'));
 assert(roll);assert.equal(roll.result,'Неудача');
 assert.equal(g.stand(0).ok,false,
  'Two-legged quad gets exactly one attempt per movement phase');
});

test('BMM pp.16,19: Quad with exactly one available MP uses a single minimum stand',()=>{
 const design=construct({...example,name:'Quad min stand',config:'Quad',walk:1,
  jump:0,sinks:10,equipment:Array.from({length:8},(_,i)=>(
   {type:'sink',location:'LT',slot:i+1}))},{auditQuad:true});
 // 55t x 1 engine rating 55 is valid; the default armor/equipment still fits.
 assert.deepEqual(design.errors,[],design.errors.join('; '));
 const create=()=>{
  const g=flatGame(),u=g.units[0];
  Object.assign(u,structuredClone(design.unit));
  for(const enemy of g.units.slice(1))enemy.dead=true;
  g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
  u.prone=true;u.spent=0;u.moveMode='stand';u.standAttempts=0;u.facing=0;
  return {g,u};
 };
 const good=create();
 // One walking MP, two running MP normally: reduce running with heat to one.
 good.u.heat=5;
 assert.equal(good.g.mp(good.u,'walk'),0);
 assert.equal(good.g.mp(good.u,'run'),0);
 // The minimum rule cannot override zero MP.
 assert.equal(good.g.stand(0,3,{minimum:true}).ok,false);
 const basic=create();
 assert.equal(basic.g.mp(basic.u,'walk'),1);
 assert.equal(basic.g.mp(basic.u,'run'),2);
 assert.equal(basic.g.stand(0,3,{minimum:true}).ok,false,
  'Minimum stand must not replace ordinary standing with 2 MP');
 // Losing two legs forces 1 Walking MP and no running (p.44).
 const damaged=create();
 damaged.u.structure.LA=0;damaged.u.structure.RL=0;
 assert.equal(damaged.g.mp(damaged.u,'walk'),1);
 assert.equal(damaged.g.mp(damaged.u,'run'),0);
 assert.equal(validateTacticalOrder({type:'stand',version:1,id:0,
  facing:3,minimum:true}).minimum,true);
 damaged.g.rng=()=>.99;
 const out=damaged.g.stand(0,3,{minimum:true});
 assert(out.ok,out.error);
 assert.equal(damaged.u.spent,1,'Minimum standing spends one available MP');
 assert.equal(damaged.u.moveMode,'run','Minimum movement is always running');
 assert.equal(damaged.u.pendingHeat,1);
 assert.equal(damaged.u.facing,3);
 assert(damaged.g.phaseRolls.some(x=>x.kind.includes('Подъём')));
 assert.equal(damaged.g.stand(0,2,{minimum:true}).ok,false,
  'A single minimum stand cannot be retried');
 assert.throws(()=>validateTacticalOrder({type:'stand',version:1,id:0,
  minimum:'true'}),/invalid_command/);
});

test('BMM p.19: standing orders are rejected outside the Movement Phase',()=>{
 const design=construct({...example,name:'Quad phase stand',config:'Quad',
  jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(design.errors,[]);
 const g=flatGame(),u=g.units[0];
 Object.assign(u,design.unit);
 u.prone=true;u.spent=0;u.standAttempts=0;
 for(const phase of ['initiative','fire','physical','heat']){
  g.phase=phase;g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
  assert.equal(g.stand(0).ok,false,'No standing during '+phase);
  assert.equal(u.prone,true);assert.equal(u.spent,0);
 }
});

test('BMM p.19: declared walk/run controls Quad standing budget and later movement heat',()=>{
 const built=construct({...example,name:'Quad declared stand',config:'Quad',
  jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[]);
 const fresh=()=>{
  const g=flatGame(),u=g.units[0];
  Object.assign(u,structuredClone(built.unit));
  for(const other of g.units.slice(1))other.dead=true;
  g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
  u.prone=true;u.spent=0;u.standAttempts=0;u.moveMode='stand';
  return {g,u};
 };
 const walker=fresh();
 const order=validateTacticalOrder({type:'stand',version:1,id:0,mode:'walk'});
 assert.equal(order.mode,'walk');
 assert(walker.g.stand(0,null,{mode:'walk'}).ok);
 assert.equal(walker.u.moveMode,'walk');
 assert.equal(walker.u.spent,2);
 walker.g.hold(0);
 assert.equal(walker.u.pendingHeat,2,'Standing 1 heat + walking 1 heat');
 const runner=fresh();
 assert(runner.g.stand(0,null,{mode:'run'}).ok);
 assert.equal(runner.u.moveMode,'run');
 runner.g.hold(0);
 assert.equal(runner.u.pendingHeat,3,'Standing 1 heat + running 2 heat');
 const committed=fresh();
 committed.u.moveMode='walk';
 assert.equal(committed.g.stand(0,null,{mode:'run'}).ok,false,
  'Already selected Walking MP cannot change to Running MP mid-phase');
 const jumper=fresh();
 jumper.u.moveMode='jump';
 assert.equal(jumper.g.stand(0).ok,false,
  'No stand in a Movement Phase that has already used jump movement');
 const restricted=fresh();
 restricted.u.structure.LA=0;restricted.u.structure.RA=0;
 assert.equal(restricted.g.stand(0,null,{mode:'walk'}).ok,false,
  'Two surviving legs must always treat standing as running');
 assert.throws(()=>validateTacticalOrder({
  type:'stand',version:1,id:0,mode:'jump'}),/invalid_command/);
});

test('BMM p.5 Quad torso cannot twist or flip its front legs as arms',()=>{
 const g=flatGame(),u=g.units[0];
 g.phase='fire';g.activeTeam=u.team;
 u.config='Quad';u.prone=false;u.twist=0;u.flip=false;
 for(const value of [-1,1]){
  const result=g.twist(u.id,value);
  assert.equal(result.ok,false,'Quad must not twist '+value);
  assert.equal(u.twist,0);
 }
 assert.equal(g.flipArms(u.id,true).ok,false);
 assert.equal(u.flip,false);
 assert.equal(g.twist(u.id,0).ok,false,'A Quad cannot invoke torso twist without a quirk');
 u.config='Biped';
 assert.equal(g.twist(u.id,1).ok,true,'Biped retains torso twist');
 assert.equal(u.twist,1);
 u.twist=0;
 assert.equal(g.twist(u.id,0.5).ok,false,'Fractional twist must be rejected');
});

test('BMM pp.25,30,83: extended torso twist explicitly grants only normal quad twist',()=>{
 const g=flatGame(),u=g.units[0];
 g.phase='fire';g.activeTeam=u.team;u.prone=false;u.config='Quad';u.twist=0;
 assert.equal(g.twist(u.id,1).ok,false,'no quirk means no quad twist');
 u.quirks={extendedTorsoTwist:true};
 for(const value of [-1,0,1]){assert.equal(g.twist(u.id,value).ok,true,String(value));}
 for(const value of [-2,2,0.5,NaN,Infinity])assert.equal(g.twist(u.id,value).ok,false,String(value));
 u.quirks={extendedTorsoTwist:false};
 assert.equal(g.twist(u.id,-1).ok,false);
 u.config='Biped';u.quirks={extendedTorsoTwist:true};
 for(const value of [-2,2])assert.equal(g.twist(u.id,value).ok,true,String(value));
 assert.equal(g.twist(u.id,3).ok,false);
 u.quirks={};
 assert.equal(g.twist(u.id,2).ok,false,'standard biped limit remains one hexside');
});

test('BMM p.30: quad front and rear leg firing arcs ignore torso twist',()=>{
 const g=flatGame(),u=g.units[0],target=g.units[1];
 u.config='Quad';u.quirks={extendedTorsoTwist:true};u.facing=0;u.twist=0;
 target.q=u.q+2;target.r=u.r;
 const locations=['LA','RA','LL','RL','CT','LT','RT','HD'];
 const baseline=Object.fromEntries(locations.map(location=>[location,g.arc(u,target,{location,rear:false})]));
 u.twist=1;
 for(const location of ['LA','RA','LL','RL'])assert.equal(g.arc(u,target,{location,rear:false}),baseline[location],location);
 // A torso mount must still respond to a twist where the target crosses an arc boundary.
 let changed=false;
 for(const delta of [[2,0],[0,2],[-2,0],[0,-2],[2,-2],[-2,2]]){
  target.q=u.q+delta[0];target.r=u.r+delta[1];
  u.twist=0;const before=g.arc(u,target,{location:'CT',rear:false});
  u.twist=1;if(before!==g.arc(u,target,{location:'CT',rear:false}))changed=true;
 }
 assert.equal(changed,true,'torso arc changes under twist');
});

test('BMM pp.24-25: all quad leg weapons obey forward/rear arcs, never biped arm side arcs',()=>{
 const g=flatGame(),u=g.units[0];u.q=0;u.r=0;u.facing=0;u.twist=0;
 const rays=DIRS.map(([q,r])=>({q,r}));
 const at=degrees=>rays.find(p=>Math.abs(g.relative(u,p)-degrees)<.001);
 // Choose true side-only rays, not the +/-120 degree boundary shared
 // by the rulebook's adjacent rear-arc hexside coverage.
 const front=at(0),sideL={q:1,r:-2},sideR={q:-1,r:2},rear=rays.find(p=>
  Math.abs(Math.abs(g.relative(u,p))-180)<.001);
 assert(front&&sideL&&sideR&&rear,'All four firing regions have valid target hexes');
 assert.equal(Math.round(g.relative(u,sideL)),90);
 assert.equal(Math.round(g.relative(u,sideR)),-90);
 u.config='Quad';u.quirks={extendedTorsoTwist:true};
 for(const loc of ['LA','RA','LL','RL']){
  const gun={location:loc,rear:false},reverse={location:loc,rear:true};
  assert.equal(g.arc(u,front,gun),true,'quad '+loc+' forward');
  for(const side of [sideL,sideR])
   assert.equal(g.arc(u,side,gun),false,'quad '+loc+' no side firing');
  assert.equal(g.arc(u,rear,gun),false,'quad '+loc+' no standard rear firing');
  assert.equal(g.arc(u,rear,reverse),true,'quad '+loc+' rear-mounted gun');
  assert.equal(g.arc(u,front,reverse),false,'quad '+loc+' rear mount not forward');
  for(const side of [sideL,sideR])
   assert.equal(g.arc(u,side,reverse),false,'quad '+loc+' rear mount no side');
 }
 g.phase='fire';g.activeTeam=u.team;
 assert.equal(g.twist(u.id,1).ok,true);
 assert.equal(g.arc(u,sideL,{location:'CT',rear:false}),true,
  'Twisted quad torso gains the shifted forward arc');
 for(const loc of ['LA','RA','LL','RL']){
  assert.equal(g.arc(u,sideL,{location:loc,rear:false}),false,
   'Quad leg '+loc+' does not gain torso-twisted side coverage');
  assert.equal(g.arc(u,front,{location:loc,rear:false}),true);
 }
 u.config='Biped';u.twist=0;u.quirks={};
 assert.equal(g.arc(u,sideL,{location:'LA',rear:false}),true,
  'Biped left arm retains its side arc');
 assert.equal(g.arc(u,sideR,{location:'RA',rear:false}),true,
  'Biped right arm retains its side arc');
 assert.equal(g.arc(u,sideL,{location:'LL',rear:false}),false,
  'Biped leg cannot use biped arm side arc');
 assert.equal(g.arc(u,sideR,{location:'RL',rear:false}),false);
});

test('BMM p.26: partial cover protects all four quad legs and not biped arms',()=>{
 const quad={config:'Quad'},biped={config:'Biped'};
 for(const loc of ['LA','RA','LL','RL']){
  assert.equal(mechLegLocation(quad,loc),true,loc);
  assert.equal(partialCoverObscures(quad,loc),true,'Quad '+loc+' is behind cover');
  assert.equal(partialCoverObscures(quad,loc,true),false,
   'Submerged attacker sees only exposed Quad leg '+loc);
 }
 for(const loc of ['HD','CT','LT','RT']){
  assert.equal(mechLegLocation(quad,loc),false);
  assert.equal(partialCoverObscures(quad,loc),false);
  assert.equal(partialCoverObscures(quad,loc,true),true);
 }
 for(const loc of ['LA','RA']){
  assert.equal(mechLegLocation(biped,loc),false);
  assert.equal(partialCoverObscures(biped,loc),false);
  assert.equal(partialCoverObscures(biped,loc,true),true);
 }
 for(const loc of ['LL','RL'])assert.equal(partialCoverObscures(biped,loc),true);
});

test('BMM p.26: quad normal cover and submerged-water cover suppress opposite locations',()=>{
 const g=flatGame(),target=g.units[0];target.config='Quad';
 const seen=[];g.damage=(u,loc,amount)=>{seen.push({loc,amount});return [];};
 function choose(sum){
  const first=sum<=7?1:sum-6,second=sum-first;
  const dice=[(first-.5)/6,(second-.5)/6];
  g.rng=()=>dice.shift()??.5;g.phaseRolls=[];
 }
 // These are controlled existing location-table results. Quad-specific
 // location TABLES remain a separate unverified bmm-req-087.
 const results=[['RA',3],['RL',5],['LL',9],['LA',10]];
 for(const [loc,sum] of results){
  choose(sum);const hidden=g.hit(target,5,'front','normal',null,true,false);
  assert.equal(hidden.location,loc);assert.equal(hidden.damage,0);
  assert.deepEqual(hidden.hits,[]);
  choose(sum);const exposed=g.hit(target,5,'front','normal',null,true,true);
  assert.equal(exposed.location,loc);assert.equal(exposed.damage,5);
  assert.equal(seen.at(-1).loc,loc);
 }
 choose(7);const blockedCenter=g.hit(target,5,'front','normal',null,true,true);
 assert.equal(blockedCenter.location,'CT');
 assert.equal(blockedCenter.damage,0,'Underwater shooting hits cover above exposed legs');
 const biped=g.units[1];biped.config='Biped';
 choose(3);const visibleArm=g.hit(biped,5,'front','normal',null,true,false);
 assert.equal(visibleArm.location,'RA');
 assert.equal(visibleArm.damage,5,'Biped arm is not covered as a leg');
});

test('BMM pp.33,38-39: Quad hit, punch and kick locations match every table row',()=>{
 const g=flatGame(),u=g.units[0];u.config='Quad';
 const normal={
  left:['LT','LL','LA','LA','LL','LT','CT','RT','RA','RL','HD'],
  front:['CT','RA','RA','RL','RT','CT','LT','LL','LA','LA','HD'],
  rear:['CT','RA','RA','RL','RT','CT','LT','LL','LA','LA','HD'],
  right:['RT','RL','RA','RA','RL','RT','CT','LT','LA','LL','HD']
 };
 const punch={
  left:['LT','LT','CT','LA','LL','HD'],
  front:['LA','LT','CT','RT','RA','HD'],
  rear:['LL','LT','CT','RT','RL','HD'],
  right:['RT','RT','CT','RA','RL','HD']
 };
 const kick={
  left:['LA','LA','LA','LL','LL','LL'],
  front:['RA','RA','RA','LA','LA','LA'],
  rear:['RL','RL','RL','LL','LL','LL'],
  right:['RA','RA','RA','RL','RL','RL']
 };
 assert.deepEqual(QUAD_PUNCH_LOCATIONS,punch);
 assert.deepEqual(QUAD_KICK_LOCATIONS,kick);
 const observed=[];
 g.damage=(unit,loc,amount)=>{observed.push({loc,amount});return [];};
 const die=(face)=>{g.rng=()=>((face-.5)/6);g.phaseRolls=[];};
 const sum=(roll)=>{
  const first=roll<=7?1:roll-6,second=roll-first;
  const ds=[(first-.5)/6,(second-.5)/6];
  g.rng=()=>ds.shift()??.5;g.phaseRolls=[];
 };
 let checked=0;
 for(const side of ['left','front','rear','right']){
  for(let r=2;r<=12;r++){
   sum(r);
   const result=g.hit(u,5,side,'normal');
   assert.equal(result.location,normal[side][r-2],side+' normal '+r);
   checked++;
  }
  for(let face=1;face<=6;face++){
   die(face);
   assert.equal(g.hit(u,5,side,'punch').location,punch[side][face-1],
    side+' punch '+face);
   die(face);
   assert.equal(g.hit(u,5,side,'kick').location,kick[side][face-1],
    side+' kick '+face);
   checked+=2;
  }
 }
 assert.equal(checked,92);
 assert.equal(observed.length,92);
 u.config='Biped';
 die(5);assert.equal(g.hit(u,5,'left','punch').location,'LA',
  'Biped left punch table stays unchanged');
 die(5);assert.equal(g.hit(u,5,'right','punch').location,'RA',
  'Biped right punch table stays unchanged');
 die(1);assert.equal(g.hit(u,5,'front','kick').location,'RL',
  'Biped front kick table stays unchanged');
 die(6);assert.equal(g.hit(u,5,'rear','kick').location,'LL',
  'Biped rear kick table stays unchanged');
});

test('BMM p.38: a quad may kick front or rear with the correct leg pair and +1 rear TN',()=>{
 const design=construct({...example,name:'Quad kick audit',config:'Quad',jump:0,sinks:10,equipment:[]},
  {auditQuad:true});
 assert.deepEqual(design.errors,[],design.errors.join('; '));
 const g=flatGame(),u=g.units[0],target=g.units[2];
 Object.assign(u,design.unit);
 g.phase='physical';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 u.q=0;u.r=0;u.facing=0;u.prone=false;u.moveMode='stand';
 u.firedLocations=[];target.prone=false;target.dead=false;target.q=1;target.r=0;
 const front=g.physicalPreview(u.id,target.id,'kick','LA');
 assert.equal(front.legal,true,front.reason);
 assert.equal(front.damage,11);
 assert.equal(front.table,'kick');
 assert.equal(g.physicalPreview(u.id,target.id,'kick','RA').legal,true);
 assert.equal(g.physicalPreview(u.id,target.id,'kick','RL').legal,false,
  'A rear leg cannot make a forward kick');
 target.q=-1;target.r=0;
 const rear=g.physicalPreview(u.id,target.id,'kick','RL');
 assert.equal(rear.legal,true,rear.reason);
 assert.equal(rear.damage,11);
 assert.equal(rear.targetNumber,front.targetNumber+1,'Rear Quad kick has +1 TN');
 assert.equal(g.physicalPreview(u.id,target.id,'kick','LL').legal,true);
 assert.equal(g.physicalPreview(u.id,target.id,'kick','LA').legal,false,
  'A front leg cannot kick into the rear arc');
 for(const type of ['punch','push','club','hatchet']){
  assert.equal(g.physicalPreview(u.id,target.id,type,'RA').legal,false,
   'Quad has no biped arms for '+type);
 }
 u.actuators.LL.hip=true;
 assert.equal(g.physicalPreview(u.id,target.id,'kick','RL').legal,false,
  'Both rear hips must be intact, even when kicking with the other rear leg');
 u.actuators.LL.hip=false;u.actuators.LA.hip=true;
 assert.equal(g.physicalPreview(u.id,target.id,'kick','RL').legal,true,
  'Rear kick remains legal when a front hip is damaged');
 target.q=1;target.r=0;
 assert.equal(g.physicalPreview(u.id,target.id,'kick','RA').legal,false,
  'Both front hips must be intact');
 u.actuators.LA.hip=false;u.firedLocations=['RA'];
 assert.equal(g.physicalPreview(u.id,target.id,'kick','RA').legal,false,
  'A Quad leg cannot kick after firing its own leg-mounted weapon');
 assert.equal(g.physicalPreview(u.id,target.id,'kick','LA').legal,true,
  'The other intact front leg remains eligible');
 u.config='Biped';u.firedLocations=[];
 assert.equal(g.physicalPreview(u.id,target.id,'kick','LA').legal,false,
  'Biped arms cannot be used as kicking legs');
});

test('BMM pp.45,65: quad side torso destruction or flooding affects front leg only',()=>{
 const fixture=construct({...example,name:'Quad torso coupling',config:'Quad',
  jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(fixture.errors,[],fixture.errors.join('; '));
 for(const [side,front,rear] of [['LT','LA','LL'],['RT','RA','RL']]){
  const built=flatGame(),u=built.units[0];
  Object.assign(u,structuredClone(fixture.unit));
  const oldRear=u.structure[rear],oldArmor=u.armor[rear];
  built.destroyLocation(u,side);
  assert.equal(u.structure[side],0);
  assert.equal(u.structure[front],0,'Destroyed '+side+' removes corresponding front leg');
  assert.equal(u.armor[front],0);
  assert(u.crit[front].every(Boolean),'All front leg critical slots are destroyed');
  assert.equal(u.structure[rear],oldRear,'Rear leg survives '+side+' destruction');
  assert.equal(u.armor[rear],oldArmor,'Rear leg armor survives torso destruction');
  const flooded=flatGame(),v=flooded.units[0];
  Object.assign(v,structuredClone(fixture.unit));
  assert.equal(flooded.breachLocation(v,side),true);
  assert.equal(flooded.isBreached(v,front),true,
   'Flooded '+side+' disables corresponding front leg');
  assert.equal(flooded.isBreached(v,rear),false,
   'Rear leg is not disabled by side torso flooding');
  assert.equal(v.structure[front],v.maxStructure[front],
   'Flooding makes front leg nonfunctional without destroying its structure');
 }
 const biped=flatGame(),b=biped.units[0];
 b.config='Biped';biped.destroyLocation(b,'LT');
 assert.equal(b.structure.LA,0,'Biped still loses corresponding arm');
});

test('BMM p.30: intact prone Quad fires all four leg-mounted weapons without +2',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[],built.errors.join('; '));
 const g=flatGame(),u=g.units[0],target=g.units[2];
 Object.assign(u,structuredClone(built.unit));
 u.q=0;u.r=0;u.facing=0;u.moveMode='stand';u.prone=false;u.brace='LA';u.heat=0;
 target.q=2;target.r=0;target.prone=false;
 assert.equal(quadProneFireBonus(u),true);
 for(const leg of ['LA','RA','LL','RL']){
  u.weapons=[{name:'Medium Laser',heat:3,damage:5,min:0,ranges:[3,6,9],
   ammo:null,location:leg,rear:false,destroyed:false}];
  const standing=g.preview(u.id,target.id,0);
  assert.equal(standing.legal,true,'Standing '+leg+' '+standing.reason);
  u.prone=true;
  const prone=g.preview(u.id,target.id,0);
  assert.equal(prone.legal,true,'Prone '+leg+' '+prone.reason);
  assert.equal(prone.mods.prone,0,'Quad '+leg+' has no prone penalty');
  assert.equal(prone.targetNumber,standing.targetNumber,
   'Prone Quad '+leg+' must have same TN as standing');
  u.prone=false;
 }
 u.prone=true;u.weapons=[{name:'Medium Laser',heat:3,damage:5,min:0,ranges:[3,6,9],
  ammo:null,location:'RA',rear:false,destroyed:false}];
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 const declared=g.declareFire(u.id,[{index:0,target:target.id}]);
 assert.equal(declared.ok,true,declared.error);
 assert.equal(g.declarations.length,1);
 assert.equal(g.declarations[0].shots[0].preview.mods.prone,0);
});

test('BMM pp.30,45,48: hip damage and leg loss revoke quad prone-fire bonuses',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[],built.errors.join('; '));
 const g=flatGame(),u=g.units[0],target=g.units[2];
 Object.assign(u,structuredClone(built.unit));
 u.q=0;u.r=0;u.facing=0;u.prone=true;u.moveMode='stand';u.heat=0;
 target.q=2;target.r=0;
 u.weapons=[{name:'Medium Laser',heat:3,damage:5,min:0,ranges:[3,6,9],
  ammo:null,location:'CT',rear:false,destroyed:false}];
 const baseline=g.preview(u.id,target.id,0);
 assert.equal(baseline.legal,true,baseline.reason);
 assert.equal(baseline.mods.prone,0);
 for(const leg of ['LA','RA','LL','RL']){
  u.actuators[leg].hip=true;
  assert.equal(quadProneFireBonus(u),false,leg+' damaged hip');
  const restricted=g.preview(u.id,target.id,0);
  assert.equal(restricted.legal,true,restricted.reason);
  assert.equal(restricted.mods.prone,2);
  assert.equal(restricted.targetNumber,baseline.targetNumber+2);
  u.weapons[0].location=leg;
  assert.equal(g.preview(u.id,target.id,0).legal,false,
   'Leg-mounted prone gun unavailable with damaged '+leg+' hip');
  u.weapons[0].location='CT';
  u.actuators[leg].hip=false;
  u.crit[leg][0]=true;
  assert.equal(quadProneFireBonus(u),false,'Restored hip crit slot must be recognized');
  u.crit[leg][0]=false;
  u.structure[leg]=0;
  assert.equal(quadProneFireBonus(u),false,'Destroyed '+leg+' revokes bonus');
  assert.equal(g.preview(u.id,target.id,0).mods.prone,2);
  u.structure[leg]=u.maxStructure[leg];
  u.breached.push(leg);
  assert.equal(quadProneFireBonus(u),false,'Flooded '+leg+' is not functional');
  u.breached.pop();
 }
 assert.equal(quadProneFireBonus(u),true,'Restored undamaged four legs regain bonus');
 u.config='Biped';
 assert.equal(quadProneFireBonus(u),false);
 assert.equal(g.preview(u.id,target.id,0).mods.prone,2,
  'Biped retains normal prone firing penalty');
});

test('BMM p.48: criticals in all four quad hips trigger PSRs and reduce walking MP',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[],built.errors.join('; '));
 const g=flatGame(),u=g.units[0];
 Object.assign(u,structuredClone(built.unit));
 u.q=0;u.r=0;u.prone=false;u.moveMode='stand';u.heat=0;
 assert.equal(g.mp(u,'walk'),5);
 assert.equal(g.mp(u,'run'),8);
 assert.equal(g.mobile(u),true);
 const expectedWalk=[3,3,3,0],expectedRun=[5,5,5,0];
 const locations=['LA','RA','LL','RL'];
 for(let i=0;i<locations.length;i++){
  const leg=locations[i];
  const seq=[.5,.5,0]; // 2D6=8 (one critical), then slot 1 (hip)
  g.rng=()=>seq.shift()??.5;
  g.phaseRolls=[];
  const prior=u.psrs.length;
  g.criticalHit(u,leg);
  assert.equal(u.crit[leg][0],true,'Hip critical slot '+leg);
  assert.equal(u.actuators[leg].hip,true,'Hip actuator state '+leg);
  assert.equal(u.psrs.length,prior+1,'PSR for '+leg+' hip critical');
  assert.equal(u.psrs.at(-1).reason,'Актуатор '+leg);
  assert.equal(g.mp(u,'walk'),expectedWalk[i],'Walk after '+(i+1)+' hip criticals');
  assert.equal(g.mp(u,'run'),expectedRun[i],'Run after '+(i+1)+' hip criticals');
  assert.equal(quadProneFireBonus(u),false);
  assert.equal(g.mobile(u),true,'Even four destroyed hips do not make the Quad immobile');
 }
 assert.equal(g.mp(u,'walk'),0);
 assert.equal(g.mp(u,'run'),0);
});

test('BMM p.48: biped retains hip PSR behavior after Quad critical-hit integration',()=>{
 const g=flatGame(),u=g.units[0];
 u.config='Biped';u.psrs=[];u.actuators.LL.hip=false;
 const seq=[.5,.5,0];
 g.rng=()=>seq.shift()??.5;g.phaseRolls=[];
 g.criticalHit(u,'LL');
 assert.equal(u.actuators.LL.hip,true);
 assert.equal(u.psrs.at(-1).reason,'Актуатор LL');
 assert.equal(g.mp(u,'walk'),Math.ceil(u.walk/2));
});

test('BMM p.45: each quad leg loss causes one immediate fall and ends movement',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[],built.errors.join('; '));
 for(const leg of ['LA','RA','LL','RL']){
  const g=flatGame(),u=g.units[0];
  Object.assign(u,structuredClone(built.unit));
  u.q=0;u.r=0;u.prone=false;u.moved=false;u.falling=false;
  g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
  let fallCount=0;
  g.fall=actor=>{assert.equal(actor,u);fallCount++;actor.prone=true;};
  g.destroyLocation(u,leg);
  assert.equal(fallCount,1,leg+' must fall immediately');
  assert.equal(u.prone,true);
  assert.equal(u.moveEndedByLegLoss,true);
  assert.equal(u.structure[leg],0);
  assert.equal(g.mp(u,'walk'),4,'First leg loss subtracts 1 walking MP');
  assert.equal(g.reachable(u,'walk').length,0,'No more movement in same turn');
  assert.equal(g.stand(u.id).ok,false,'Cannot recover in the same Movement Phase');
  g.destroyLocation(u,leg);
  assert.equal(fallCount,1,'Repeating destruction is idempotent for '+leg);
  assert.deepEqual(u.destroyedSections.filter(l=>l===leg),[leg]);
  g.endPhase();
  assert.equal(u.moveEndedByLegLoss,false,'New turn clears the movement block');
 }
});

test('BMM p.45: prone quad leg loss does not cause an extra fall',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[]);
 const g=flatGame(),u=g.units[0];
 Object.assign(u,structuredClone(built.unit));
 u.q=0;u.r=0;u.prone=true;
 let calls=0;g.fall=()=>{calls++};
 g.destroyLocation(u,'LA');
 assert.equal(calls,0);
 assert.equal(g.mp(u,'walk'),4);
 assert.equal(u.moveEndedByLegLoss,true);
});

test('BMM p.45: side torso destroying quad front leg triggers real falling damage once',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[]);
 const g=flatGame(),u=g.units[0];
 Object.assign(u,structuredClone(built.unit));
 u.q=0;u.r=0;u.facing=0;u.prone=false;u.dead=false;
 g.rng=()=>.5;
 g.destroyLocation(u,'LT');
 assert.equal(u.structure.LA,0);
 assert.equal(u.structure.LL,u.maxStructure.LL,'Rear leg survives side torso loss');
 assert.equal(u.prone,true);
 assert.equal(g.log.filter(line=>String(line).includes('упал:')).length,1,
  'Exactly one real fall for recursively destroyed front leg');
 assert.equal(g.mp(u,'walk'),4);
});

test('BMM pp.45,48: only loss of all four quad legs makes a zero-MP quad immobile',()=>{
 const g=flatGame(),t=g.units[2],u=g.units[0];
 u.q=0;u.r=0;u.facing=0;
 t.q=2;t.r=0;t.config='Quad';t.moveMode='stand';
 t.distanceMoved=0;t.skidded=false;t.prone=false;t.dead=false;
 u.weapons=[{name:'Medium Laser',heat:3,damage:5,min:0,
  ranges:[3,6,9],ammo:null,location:'CT',rear:false,destroyed:false}];
 assert.equal(quadImmobileDueToLegLoss(t),false);
 assert.equal(g.targetMovementModifier(t),0);
 for(const leg of ['LA','RA','LL']){
  t.structure[leg]=0;
  assert.equal(quadImmobileDueToLegLoss(t),false,leg);
  assert.equal(g.targetMovementModifier(t),0,'Three lost legs not immobile');
 }
 assert.equal(g.preview(u.id,t.id,0,{aim:'CT'}).legal,false,
  'Cannot aim at a Quad with only three destroyed legs');
 t.structure.RL=0;
 assert.equal(quadImmobileDueToLegLoss(t),true);
 assert.equal(g.mobile(t),true,'An operational immobile Quad can still attack');
 assert.equal(g.targetMovementModifier(t),-4,'Immobile target to-hit modifier');
 const aimed=g.preview(u.id,t.id,0,{aim:'CT'});
 assert.equal(aimed.legal,true,aimed.reason);
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 assert.equal(g.declareFire(u.id,[{index:0,target:t.id,aim:'CT'}]).ok,true,
  'Aim declaration must respect the same immobility check as preview');
 for(const leg of ['LA','RA','LL','RL'])t.structure[leg]=t.maxStructure[leg];
 for(const leg of ['LA','RA','LL','RL'])t.actuators[leg].hip=true;
 assert.equal(g.mp(t,'walk'),0,'Four hip hits leave zero walking MP');
 assert.equal(quadImmobileDueToLegLoss(t),false,
  'Four hip hits are not equivalent to four destroyed legs');
 assert.equal(g.targetMovementModifier(t),0);
 assert.equal(g.preview(u.id,t.id,0,{aim:'CT'}).legal,false);
 t.config='Biped';
 assert.equal(quadImmobileDueToLegLoss(t),false);
 t.structure.LL=0;t.structure.RL=0;
 assert.equal(quadImmobileDueToLegLoss(t),false,'Biped all-leg loss is not immobile');
});

test('BMM p.45: a Quad with one missing leg must make the +5 landing PSR',()=>{
 const base=construct({...example,config:'Quad',jump:1,sinks:10,
  equipment:[{type:'jump',location:'CT',slot:11}]},{auditQuad:true});
 assert.deepEqual(base.errors,[],base.errors.join('; '));
 const make=()=>{
  const g=flatGame(),u=g.units[0];
  Object.assign(u,structuredClone(base.unit));
  u.q=0;u.r=0;u.facing=0;u.prone=false;u.proneAtStart=false;
  u.spent=0;u.moveMode='stand';u.moved=false;u.moveEndedByLegLoss=false;
  for(const other of g.units.slice(1))other.dead=true;
  g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
  return {g,u};
 };
 const intact=make();
 intact.g.rng=()=>.5;
 assert.equal(intact.g.move(0,1,0,'jump').ok,true);
 assert.equal(intact.u.prone,false,'Intact quad does not roll simply for jumping');
 const lost=make();
 lost.u.structure.LA=0;lost.g.rng=()=>.5; // 2D6=8: succeeds at 5, fails at 10
 assert.equal(lost.g.move(0,1,0,'jump').ok,true);
 assert.equal(lost.u.prone,true,'Loss of a front leg forces the +5 landing check');
 assert(lost.g.phaseRolls.some(x=>x.kind?.includes('Посадка')&&x.target===10),
  'The landing roll must use piloting 5 + 5');
 const second=make();
 second.u.structure.LA=0;second.u.structure.RA=0;
 second.g.rng=()=>.5;
 assert.equal(second.g.move(0,1,0,'jump').ok,true);
 assert.equal(second.u.prone,true,'Two lost legs still trigger a landing check');
 assert(second.g.phaseRolls.some(x=>x.kind?.includes('Посадка')&&x.target===10),
  'Two lost legs already add +5 through ordinary PSR modifiers, not +10');
 const rear=make();
 rear.u.structure.RL=0;rear.g.rng=()=>.5;
 assert.equal(rear.g.move(0,1,0,'jump').ok,true);
 assert.equal(rear.u.prone,true,'The same rule also applies to missing rear legs');
});

test('BMM p.53: exact Quad -2 fall-avoidance PSR target depends on four surviving legs',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[],built.errors.join('; '));
 const g=flatGame(),u=g.units[0];
 Object.assign(u,structuredClone(built.unit));
 u.piloting=5;u.prone=false;u.unconscious=false;u.dead=false;
 let falls=0;
 g.fall=(mech,levels,target)=>{assert.equal(mech,u);falls++;u.prone=true;};
 const attempt=(total,expectedTN,expectedSuccess)=>{
  const a=Math.max(1,total-6),b=total-a,dice=[(a-.5)/6,(b-.5)/6];
  g.rng=()=>dice.shift()??.5;
  g.phaseRolls=[];u.prone=false;
  const result=g.psr(u,0,'Quad fall avoidance',true);
  assert.equal(g.phaseRolls.at(-1).target,expectedTN,'PSR TN');
  assert.equal(result,expectedSuccess,'Roll '+total+' for TN '+expectedTN);
 };
 attempt(2,3,false);
 attempt(3,3,true);
 u.structure.RL=0;
 attempt(4,5,false);
 attempt(5,5,true);
 u.structure.RL=u.maxStructure.RL;
 u.actuators.LA.hip=true;
 attempt(4,5,false); // hip +2 cancels intact Quad -2
 attempt(5,5,true);
 u.actuators.LA.hip=false;
 u.config='Biped';
 attempt(4,5,false);
 attempt(5,5,true);
 assert.equal(falls,4,'Failure count follows exact modified TNs');
});

test('BMM p.53: deferred Quad end-phase PSRs also apply -2, never to standing rolls',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[]);
 const g=flatGame(),u=g.units[0];
 Object.assign(u,structuredClone(built.unit));
 for(const other of g.units.slice(1))other.dead=true;
 u.piloting=5;u.dead=false;u.prone=false;u.unconscious=false;u.psrs=[];
 let fell=0;g.fall=actor=>{assert.equal(actor,u);fell++;actor.prone=true;};
 const roll=(a,b)=>{
  const d=[(a-.5)/6,(b-.5)/6];g.rng=()=>d.shift()??.5;
 };
 u.psrs.push({modifier:0,reason:'Terrain'});
 roll(1,2);g.phaseRolls=[];g.endPSR();
 assert.equal(g.phaseRolls.at(-1).target,3,'Intact Quad end-phase fall TN is 5-2');
 assert.equal(fell,0);
 u.structure.LA=0;u.psrs.push({modifier:0,reason:'Terrain'});
 roll(1,2);g.phaseRolls=[];g.endPSR();
 assert.equal(g.phaseRolls.at(-1).target,5,'No -2 when one leg is destroyed');
 assert.equal(fell,1);
 assert.deepEqual(u.psrs,[]);
});

test('BMM p.67: Quad lateral collision strikes its actual left/right side',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[],built.errors.join('; '));
 const cases=[
  ['shift-left-forward',1,'left'],['shift-left-backward',2,'left'],
  ['shift-right-forward',-1,'right'],['shift-right-backward',-2,'right']
 ];
 for(const [action,offset,expected] of cases){
  const g=flatGame(),u=g.units[0];
  Object.assign(u,structuredClone(built.unit));
  u.q=0;u.r=0;u.facing=0;u.spent=0;u.moveMode='stand';u.moved=false;
  for(const other of g.units.slice(1))other.dead=true;
  g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
  const d=DIRS[(offset+6)%6],q=d[0],r=d[1];
  const tile=g.tile(q,r);tile.building={type:'medium',cf:31};
  const packets=[];g.packets=(mech,damage,side)=>{
   assert.equal(mech,u);packets.push({damage,side});
  };
  g.rng=()=>.01; // 2D6=2: fails Medium building PSR of 6
  const moved=g.move(u.id,q,r,'walk',{lateral:action});
  assert.equal(moved.ok,true,action+': '+moved.error);
  assert.equal(u.facing,0,'Lateral movement retains facing');
  assert.equal(u.spent,4,'1 base + 2 Medium building + 1 lateral MP');
  assert.deepEqual(packets,[{damage:4,side:expected}],
   'Collision on '+action+' takes damage on the '+expected+' side');
  assert.equal(tile.building.cf,25,'Building always loses ceil(55/10)=6 CF');
  assert.equal(u.prone,false,'Failed entry PSR does not cause a fall');
  assert(g.phaseRolls.some(x=>x.kind?.includes('Вход в здание')&&x.target===6),
   'Medium entry PSR is piloting 5 + 1 building type');
 }
});

test('BMM p.67: building-entry PSR modifiers, damage and jump restriction',()=>{
 assert.deepEqual(BUILDING_ENTRY,{
  light:{mp:1,psr:0},medium:{mp:2,psr:1},
  heavy:{mp:3,psr:2},hardened:{mp:4,psr:5}
 });
 for(const [hexes,want] of [[1,0],[2,0],[3,1],[4,1],[5,2],[6,2],
  [7,3],[9,3],[10,4],[17,4],[18,5],[24,5],[25,6],[30,6]])
  assert.equal(buildingMovementPSRModifier(hexes),want);
 for(const invalid of [0,-1,NaN])
  assert.throws(()=>buildingMovementPSRModifier(invalid));
 for(let facing=0;facing<6;facing++){
  const to=(offset)=>{
   const d=DIRS[(facing+offset+6)%6];return {q:d[0],r:d[1]};
  };
  for(const offset of [0,1,2,3,4,5]){
   const expected=offset===0?'front':offset===3?'rear':offset<=2?'left':'right';
   assert.equal(buildingImpactSide(facing,{q:0,r:0},to(offset)),expected);
  }
 }
 const built=construct({...example,config:'Quad',jump:1,sinks:10,
  equipment:[{type:'jump',location:'CT',slot:11}]},{auditQuad:true});
 assert.deepEqual(built.errors,[],built.errors.join('; '));
 const g=flatGame(),u=g.units[0];
 Object.assign(u,structuredClone(built.unit));u.q=0;u.r=0;u.facing=0;
 for(const other of g.units.slice(1))other.dead=true;
 g.phase='move';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 const tile=g.tile(1,0);tile.building={type:'light',cf:10};
 assert.equal(g.reachable(u,'jump').some(p=>p.q===1&&p.r===0),false,
  'Cannot jump directly into an occupied building interior');
 let called=false;g.packets=()=>{called=true;};
 g.rng=()=>.99;const moved=g.move(u.id,1,0,'walk');
 assert.equal(moved.ok,true);
 assert.equal(tile.building.cf,4);
 assert.equal(called,false,'Successful building-entry PSR avoids mech damage');
 assert.equal(u.prone,false);
 assert(g.phaseRolls.some(x=>x.kind?.includes('Вход в здание')&&x.target===5));
});

test('BMM p.83: Quad three-point Directional Torso Mount rotates 360 degrees and persists',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[]);
 const g=flatGame(),u=g.units[0],target=g.units[2];
 Object.assign(u,structuredClone(built.unit));
 u.q=0;u.r=0;u.facing=0;u.prone=false;u.twist=0;
 u.weapons=[{name:'Medium Laser',heat:3,damage:5,min:0,ranges:[3,6,9],
  ammo:null,location:'CT',rear:false,destroyed:false}];
 u.directionalTorsoMounts=[{location:'CT',weaponIndices:[0],points:3,facing:0,locked:false}];
 target.q=-2;target.r=0;
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 assert.equal(g.arc(u,target,u.weapons[0]),false,'Default turret points forward');
 for(const bearing of [1,2,3,4,5,0]){
  assert.equal(g.setDirectionalTorsoMount(u.id,0,bearing).ok,true,
   'Quad turret may rotate to each of six facings');
  assert.equal(u.directionalTorsoMounts[0].facing,bearing);
 }
 assert.equal(g.setDirectionalTorsoMount(u.id,0,3).ok,true);
 assert.equal(g.arc(u,target,u.weapons[0]),true,'Rear target in 3-point turret arc');
 g.endPhase();
 assert.equal(u.directionalTorsoMounts[0].facing,3,
  'Directional mount facing persists beyond End Phase');
 assert.equal(g.arc(u,target,u.weapons[0]),true);
 for(const illegal of [-1,6,1.5,NaN])
  assert.equal(g.setDirectionalTorsoMount(u.id,0,illegal).ok,false);
});

test('BMM p.83: torso hits lock directional mount on 9+, never on 8',()=>{
 const built=construct({...example,config:'Quad',jump:0,sinks:10,equipment:[]},{auditQuad:true});
 assert.deepEqual(built.errors,[]);
 const g=flatGame(),u=g.units[0];Object.assign(u,structuredClone(built.unit));
 u.q=0;u.r=0;u.facing=0;u.prone=false;
 u.directionalTorsoMounts=[{location:'CT',weaponIndices:[],points:3,facing:3,locked:false}];
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 g.rng=()=>.5;g.phaseRolls=[]; // 2D6=8
 g.damage(u,'CT',1);
 assert.equal(u.directionalTorsoMounts[0].locked,false);
 g.rng=()=>.75;g.phaseRolls=[]; // 2D6=10
 g.damage(u,'CT',1);
 assert.equal(u.directionalTorsoMounts[0].locked,true);
 assert.equal(u.directionalTorsoMounts[0].facing,3);
 assert.equal(g.setDirectionalTorsoMount(u.id,0,0).ok,false,
  'Damaged mount stays permanently locked in its last facing');
 assert.equal(g.phaseRolls.some(x=>x.kind?.includes('Повреждение турели')),true);
});

test('BMM p.83: two-point mount only faces forward or rear; no quirk implies no turret',()=>{
 const g=flatGame(),u=g.units[0];
 g.phase='fire';g.activeTeam=u.team;g.queue=[u.team];g.actingId=null;
 u.config='Quad';u.prone=false;u.directionalTorsoMounts=[];
 assert.equal(g.setDirectionalTorsoMount(u.id,0,3).ok,false);
 u.directionalTorsoMounts=[{location:'CT',weaponIndices:[],points:2,facing:0,locked:false}];
 assert.equal(g.setDirectionalTorsoMount(u.id,0,3).ok,true);
 for(const dir of [1,2,4,5])assert.equal(g.setDirectionalTorsoMount(u.id,0,dir).ok,false);
 assert.equal(g.setDirectionalTorsoMount(u.id,0,0).ok,true);
 u.config='Biped';u.directionalTorsoMounts[0].points=3;
 assert.equal(g.setDirectionalTorsoMount(u.id,0,3).ok,false,
  'Full 360 degree three-point turret is restricted to Quads');
 u.directionalTorsoMounts[0].points=2;
 assert.equal(g.setDirectionalTorsoMount(u.id,0,3).ok,true,
  'Two-point version is available to bipeds');
});

test('BMM p.83: Quad 3-point turret quirk constructs and validates actual torso weapon',()=>{
 const config={...example,config:'Quad',jump:0,sinks:10,
  equipment:[{type:'Medium Laser',location:'CT',slot:11}],
  quirks:{extendedTorsoTwist:true,directionalTorsoMounts:[
   {location:'CT',points:3,facing:0,weaponIndices:[0]}]}};
 assert(construct(config).errors.length>0,'Ordinary public Quad construction still fails closed');
 const built=construct(config,{auditQuad:true});
 assert.deepEqual(built.errors,[],built.errors.join('; '));
 const u=built.unit;
 assert.equal(u.quirks.extendedTorsoTwist,true);
 assert.deepEqual(u.directionalTorsoMounts,[{location:'CT',points:3,
  facing:0,weaponIndices:[0],locked:false}]);
 assert.equal(u.weapons[0].location,'CT');
 const wrong=[
  {...config.quirks,directionalTorsoMounts:[{location:'CT',points:3,facing:6,weaponIndices:[0]}]},
  {...config.quirks,directionalTorsoMounts:[{location:'CT',points:3,facing:0,weaponIndices:[1]}]},
  {...config.quirks,directionalTorsoMounts:[{location:'LT',points:3,facing:0,weaponIndices:[0]}]},
  {...config.quirks,directionalTorsoMounts:[{location:'CT',points:2,facing:1,weaponIndices:[0]}]},
  {...config.quirks,directionalTorsoMounts:[{location:'CT',points:3,facing:0,weaponIndices:[0,0]}]},
  {...config.quirks,unknown:true},'extendedTorsoTwist',[]
 ];
 for(const quirks of wrong){
  const error=construct({...config,quirks},{auditQuad:true});
  assert(error.errors.length>0,'Illegal quirk input must be rejected');
 }
 const biped={...config,config:'Biped'};
 assert(construct(biped).errors.some(x=>x.includes('направленная установка')),
  'Three-point turret is Quad only');
});

test('BMM p.83: tactical server validates 360-degree turret rotation command',()=>{
 const command=validateTacticalOrder({type:'turret',version:1,id:0,mount:0,facing:5});
 assert.equal(command.facing,5);
 for(const value of [-1,6,0.5,NaN])
  assert.throws(()=>validateTacticalOrder({
   type:'turret',version:1,id:0,mount:0,facing:value}),/invalid_command/);
 assert.throws(()=>validateTacticalOrder({
  type:'turret',version:1,id:0,mount:4,facing:0}),/invalid_command/);
 const ext=validateTacticalOrder({type:'twist',version:1,id:0,twist:2});
 assert.equal(ext.twist,2,'Server accepts BMM Extended Torso Twist before engine limit check');
});

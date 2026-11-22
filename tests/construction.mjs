import assert from 'node:assert/strict';
import {test} from 'node:test';
import {construct,example} from '../dist/construction.js';
import {WEAPON_NAMES,WEAPON_SPECS} from '../dist/equipment.js';
import {Game} from '../dist/engine.js';
const r=construct(example);assert.deepEqual(r.errors,[]);assert.equal(r.total,55);assert.equal(r.rating,275);assert.equal(r.unit.weapons[1].ammo,24);
const c=()=>structuredClone(example);
let d=c();d.tonnage=50;assert(construct(d).errors.some(e=>e.includes('массы')));
d=c();d.equipment[0].slot=1;assert(construct(d).errors.some(e=>e.includes('заняты')));
d=c();d.armor.HD=10;assert(construct(d).errors.some(e=>e.includes('HD')));
d=c();d.jump=6;assert(construct(d).errors.length);
d=c();d.equipment.pop();assert(construct(d).errors.some(e=>e.includes('теплоотводов')));
d=c();d.equipment.push({type:'ammo',location:'LT',slot:3,weapon:99,mass:1});assert(construct(d).errors.some(e=>e.includes('ссылаться')));
d=c();d.tonnage=100;d.walk=3;d.jump=0;d.sinks=10;d.equipment=[{type:'AC/20',location:'RA',slot:5,splitLocation:'RT',splitSlot:1,splitCount:8},{type:'ammo',location:'LT',slot:1,weapon:0,mass:1},{type:'hatchet',location:'LA',slot:5}];assert.deepEqual(construct(d).errors,[]);assert.equal(construct(d).unit.hatchets.length,1);assert.equal(construct(d).unit.slots.RT[1],'w:0');
assert.deepEqual(construct(d).unit.weapons[0].locations,['RA','RT']);d.equipment[0].splitLocation='LL';assert(construct(d).errors.some(e=>e.includes('AC/20')));d.equipment[0].splitLocation='RT';d.equipment[0].type='AC/10';assert(construct(d).errors.some(e=>e.includes('только для AC/20')));
console.log('9 construction checks passed');

const caseCfg={name:'CASE verification',tonnage:100,walk:3,jump:0,sinks:10,
 armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},rear:{CT:0,LT:0,RT:0},
 equipment:[{type:'LRM 10',location:'RT',slot:1},
 {type:'ammo',location:'RT',slot:3,weapon:0,mass:1},
 {type:'case',location:'RT',slot:4}]};
const protectedMech=construct(caseCfg);
assert.deepEqual(protectedMech.errors,[]);
assert.equal(protectedMech.weights.case,0.5);
assert.equal(protectedMech.unit.slots.RT[3],'case');
const unprotectedCfg=structuredClone(caseCfg);unprotectedCfg.equipment.pop();
assert.equal(protectedMech.total-construct(unprotectedCfg).total,0.5);
for(const location of ['LA','RA','LL','RL','HD']){
 const invalid=structuredClone(caseCfg);invalid.equipment[2].location=location;
 assert(construct(invalid).errors.length>0,'CASE forbidden in '+location);
}
const duplicateCASE=structuredClone(caseCfg);
duplicateCASE.equipment.push({type:'case',location:'RT',slot:5});
assert(construct(duplicateCASE).errors.some(e=>e.includes('не более одной')));
console.log('CASE construction, mass and locations verified');

const case2Config=structuredClone(caseCfg);
case2Config.equipment[2]={type:'case2',location:'RT',slot:4};
const case2Mech=construct(case2Config);
assert.deepEqual(case2Mech.errors,[]);
assert.equal(case2Mech.unit.slots.RT[3],'case2');
assert.equal(case2Mech.weights.case,1);
assert.equal(case2Mech.total-construct(unprotectedCfg).total,1);
for(const [location,slot] of [['LA',5],['LL',5],['HD',4]]){
 const candidate=structuredClone(case2Config);
 candidate.equipment[2]={type:'case2',location,slot};
 const result=construct(candidate);
 assert.deepEqual(result.errors,[],'CASE II legal in '+location);
 assert.equal(result.unit.slots[location][slot-1],'case2');
}
let incompatible=structuredClone(case2Config);
incompatible.equipment.push({type:'case',location:'RT',slot:5});
assert(construct(incompatible).errors.some(e=>e.includes('не более одной')));
incompatible=structuredClone(caseCfg);
incompatible.equipment.push({type:'case2',location:'RT',slot:5});
assert(construct(incompatible).errors.some(e=>e.includes('не более одной')));
console.log('CASE II installation, weight and CASE compatibility verified');



// Every weapon listed in the shared equipment registry must be constructible
// and immediately usable in the combat engine. This is an integration contract,
// not a substitute for weapon-specific rulebook conformance tests.
let integrated=0;
for(const name of WEAPON_NAMES){
 const spec=WEAPON_SPECS[name],split=spec.slots>8;
 const cfg={
  name:'Weapon Integration',tonnage:100,walk:3,jump:0,sinks:10,
  armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
  rear:{CT:0,LT:0,RT:0},
  equipment:[
   {type:name,location:'RA',slot:5,
    ...(split?{splitLocation:'RT',splitSlot:1,splitCount:6}:{})},
   ...(spec.roundsPerTon?[{type:'ammo',location:'LT',slot:1,weapon:0,mass:1}]:[])
  ]
 };
 const design=construct(cfg);
 assert.deepEqual(design.errors,[],name);
 assert.equal(design.unit.weapons[0].damage,spec.damage,name);
 assert.equal(design.unit.weapons[0].heat,spec.heat,name);
 assert.equal(design.unit.weapons[0].toHit,spec.accuracyModifier,name);
 const battle=new Game({rng:()=>.99});
 for(const tile of battle.tiles)
  Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 const attacker=battle.units[0],target=battle.units[2];
 Object.assign(attacker,design.unit,{q:0,r:0,facing:0});
 Object.assign(target,{q:2,r:0});
 const preview=battle.preview(0,2,0);
 assert.equal(preview.legal,true,name+': '+preview.reason);
 assert.equal(preview.mods.weapon,spec.accuracyModifier,name);
 const ammunition=attacker.weapons[0].ammo;
 battle.phase='fire';battle.activeTeam=attacker.team;
 battle.queue=[attacker.team];battle.actingId=null;
 const declaration=battle.declareFire(0,[{index:0,target:2}]);
 assert.equal(declaration.ok,true,name+': '+declaration.error);
 const resolution=battle.resolveFire();
 assert.equal(resolution.length,1,name);
 assert.equal(resolution[0].shots[0].hit,true,name);
 assert.equal(resolution[0].shots[0].damage>0,true,name);
 assert.equal(attacker.pendingHeat,spec.heat,name);
 if(spec.roundsPerTon)
  assert.equal(attacker.weapons[0].ammo,ammunition-1,name);
 else assert.equal(attacker.weapons[0].ammo,null,name);
 integrated++;
}
console.log(integrated+' registered weapons passed construction-to-combat integration');

const defaultTechBase=construct(example);
assert.deepEqual(defaultTechBase.errors,[]);
assert.equal(defaultTechBase.unit.techBase,'Inner Sphere');
const rejectedClan=construct({...example,techBase:'Clan'});
assert(rejectedClan.errors.some(e=>e.includes('Клановая технология')),
 'Do not silently create a Clan mech using Inner Sphere construction data');
console.log('Clan tech-base construction safety gate verified');

// CAT3500D Construction p.49–54: source-backed rejection and explicit feedback
// form one contract in the engine, API and MechLab. No temporary "invalid but
// accepted" designs may be saved or used in a battle.
{
 const cfg=c();cfg.armor.HD=10;
 const result=construct(cfg);
 assert(result.errors.some(x=>x.includes('HD')));
 assert(result.diagnostics.some(x=>x.code==='armor_limit'&&
   x.field==='armor.HD'&&x.page===52));
}
{
 const cfg=c();cfg.tonnage=45;cfg.walk=10;
 const result=construct(cfg);
 assert(result.errors.some(x=>x.includes('Рейтинг двигателя')));
 assert(result.diagnostics.some(x=>x.code==='engine_rating'&&
   x.field==='walk'&&x.page===51));
}
{
 const cfg=c();cfg.equipment[0].rear=true; // PPC in right arm
 const result=construct(cfg);
 assert(result.errors.some(x=>x.includes('заднюю арку')));
 assert(result.diagnostics.some(x=>x.code==='weapon_arc'&&x.page===54));
}
{
 const cfg=c();cfg.equipment.push(
  {type:'ammo',location:'LT',slot:3,weapon:1,mass:-1});
 const result=construct(cfg);
 assert(result.errors.some(x=>x.includes('Бункер')));
 assert(Number.isFinite(result.total),'invalid ammo cannot subtract tonnage');
 assert.equal(result.weights.ammo,2,'invalid bin cannot add phantom shots or mass');
 assert(result.diagnostics.some(x=>x.code==='ammunition'&&x.page===54));
}
{
 const cfg=c();cfg.removeHandActuators=['LA'];
 const result=construct(cfg);
 assert.deepEqual(result.errors,[]);
 assert.equal(result.unit.slots.LA[2],'lower');
 assert.equal(result.unit.slots.LA[3],null,
  'AGoAC permits removing the hand while keeping lower-arm actuator');
}
{
 const cfg=c();cfg.removeActuators=['LA'];
 cfg.removeHandActuators=['LA'];
 const result=construct(cfg);
 assert.deepEqual(result.errors,[]);
 assert.equal(result.unit.slots.LA[2],null);
 assert.equal(result.unit.slots.LA[3],null);
}
{
 const cfg=c();cfg.removeHandActuators=['CT'];
 const result=construct(cfg);
 assert(result.errors.some(x=>x.includes('Актуаторы кисти')));
 assert(result.diagnostics.some(x=>x.code==='actuators'));
}
{
 const cfg=c();cfg.tonnage=100;cfg.walk=3;cfg.jump=0;cfg.sinks=10;
 cfg.equipment=[{type:'Machine Gun',location:'RA',slot:5},
  {type:'ammo',location:'LT',slot:1,weapon:0,mass:0.5}];
 const result=construct(cfg);
 assert.deepEqual(result.errors,[],'AGoAC p.54 MG may use half-ton bins');
 assert.equal(result.unit.bins[0].shots,100);
}
console.log('AGoAC Ch12 user-visible rule/page diagnostics and illegal design gates verified');

{
 const cfg=c();cfg.tonnage=100;cfg.walk=3;cfg.jump=0;cfg.sinks=10;
 cfg.equipment=[
  {type:'AC/2',location:'RA',slot:5},
  {type:'AC/2',location:'LA',slot:5},
  {type:'ammo',location:'LT',slot:1,weapon:0,mass:1}
 ];
 let design=construct(cfg);
 assert.deepEqual(design.errors,[],
  'printed stock BattleMechs may share one compatible magazine between matching guns');
 assert(design.unit.weapons.every(w=>w.ammo===45));
 cfg.equipment.push({type:'ammo',location:'LT',slot:2,weapon:1,mass:1});
 design=construct(cfg);
 assert.deepEqual(design.errors,[],
  'two compatible magazines must form one correctly counted shared pool');
 assert(design.unit.weapons.every(w=>w.ammo===90));
}

const running=construct(example);
assert.equal(running.unit.run,8,'CAT3500D p.51: walk 5 -> run 8');
{
 const design=structuredClone(example);design.tonnage=100;design.walk=3;
 design.jump=0;design.sinks=10;design.equipment=[];
 const result=construct(design);
 assert.equal(result.unit.run,5,'CAT3500D p.51: walk 3 -> run 5');
 assert.equal(result.unit.tonnage,100);
 assert(result.remaining>=0,'unallocated tonnage is counted as wasted');
}
console.log('AGoAC Ch12 running MP and remaining design tonnage checked');

// The construction textbook's explicit ammunition minimum is required for
// user-created MechLab designs. Legacy source MTFs remain loadable intact
// in the locked Chapter 11 printed scenarios (not a custom-design loophole).
{
 const cfg={name:'Two AC2 design',tonnage:100,walk:3,jump:0,sinks:10,
  armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
  rear:{CT:0,LT:0,RT:0},
  equipment:[
   {type:'AC/2',location:'RA',slot:5},
   {type:'AC/2',location:'LA',slot:5},
   {type:'ammo',location:'LT',slot:1,weapon:0,mass:1}
  ]
 };
 assert.deepEqual(construct(cfg).errors,[],
  'trusted printed MTF import must preserve canonical shared-ammo behavior');
 const strict=construct(cfg,{strictAgoac:true});
 assert(strict.errors.some(e=>e.includes('не менее 2 т')||
   e.includes('требуется не менее 2 т')),'AGoAC p.54 at least one ton per weapon');
 assert(strict.diagnostics.some(d=>d.code==='ammunition'&&d.page===54));
 cfg.equipment.push({type:'ammo',location:'LT',slot:2,weapon:1,mass:1});
 const valid=construct(cfg,{strictAgoac:true});
 assert.deepEqual(valid.errors,[],'shared magazine storage remains legal if minimum met');
 assert(valid.unit.weapons.every(w=>w.ammo===90));
}
{
 const cfg={name:'Two MG design',tonnage:100,walk:3,jump:0,sinks:10,
  armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
  rear:{CT:0,LT:0,RT:0},
  equipment:[
   {type:'Machine Gun',location:'RA',slot:5},
   {type:'Machine Gun',location:'LA',slot:5},
   {type:'ammo',location:'LT',slot:1,weapon:0,mass:0.5}
  ]
 };
 assert(construct(cfg,{strictAgoac:true}).errors.some(e=>e.includes('требуется не менее 1 т')),
  'two machine guns require a total of one ton');
 cfg.equipment.push({type:'ammo',location:'LT',slot:2,weapon:1,mass:0.5});
 assert.deepEqual(construct(cfg,{strictAgoac:true}).errors,[],
  'two half-ton bins satisfy both machine guns');
}
console.log('AGoAC Ch12 strict custom-only ammunition minima verified');

test('AGoAC Ch12 running MP and remaining design tonnage checked',()=>{
 const original=construct(example);
 assert.deepEqual(original.errors,[]);
 assert.equal(original.unit.run,8,'walk=5 must result in running=8');
 const design=structuredClone(example);
 Object.assign(design,{tonnage:100,walk:3,jump:0,sinks:10,equipment:[]});
 const result=construct(design);
 assert.deepEqual(result.errors,[]);
 assert.equal(result.unit.run,5,'walk=3 must result in running=5');
 assert(result.remaining>=0);
});

test('AGoAC Ch12 strict custom-only ammunition minima verified',()=>{
 const config={name:'Two AC/2',tonnage:100,walk:3,jump:0,sinks:10,
  armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
  rear:{CT:0,LT:0,RT:0},
  equipment:[{type:'AC/2',location:'RA',slot:5},
   {type:'AC/2',location:'LA',slot:5},
   {type:'ammo',location:'LT',slot:1,weapon:0,mass:1}]};
 assert.deepEqual(construct(config).errors,[],
  'pinned printed MTF sources may reuse shared bins without a custom-design gate');
 const blocked=construct(config,{strictAgoac:true});
 assert(blocked.errors.some(msg=>msg.includes('не менее 2 т')),
  'custom two-AC2 design requires two tons');
 assert(blocked.diagnostics.some(d=>d.code==='ammunition'&&d.step===7&&d.page===54));
 config.equipment.push({type:'ammo',location:'LT',slot:2,weapon:1,mass:1});
 assert.deepEqual(construct(config,{strictAgoac:true}).errors,[]);
});

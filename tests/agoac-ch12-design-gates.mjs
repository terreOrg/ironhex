import {test} from 'node:test';
import assert from 'node:assert/strict';
import {construct,LOCS} from '../dist/construction.js';

// Independent CAT3500D (2018) printed p.50 table: CT, side torso, arms, legs.
// Do not derive the expected values from the engine under test.
const printedStructure=[
 [6,5,3,4],[8,6,4,6],[10,7,5,7],[11,8,6,8],
 [12,10,6,10],[14,11,7,11],[16,12,8,12],
 [18,13,9,13],[20,14,10,14],[21,15,10,15],
 [22,15,11,15],[23,16,12,16],[25,17,13,17],
 [27,18,14,18],[29,19,15,19],[30,20,16,20],[31,21,17,21]
];
const blank=(tonnage=55,walk=3)=>({
 name:'Source-verified custom',tonnage,walk,jump:0,sinks:10,
 armor:Object.fromEntries(LOCS.map(loc=>[loc,0])),
 rear:{CT:0,LT:0,RT:0},
 // All 10 free heat sinks still need legal external slots above integral
 // engine capacity (CAT3500D p.53); reserve from RT slot 12 downward.
 equipment:Array.from({length:Math.max(0,10-Math.floor(tonnage*walk/25))},
  (_,i)=>({type:'sink',location:'RT',slot:12-i}))
});
const ok=c=>{const built=construct(c,{strictAgoac:true});
 assert.deepEqual(built.errors,[],'Expected a legal standard biped');
 return built;
};

test('CAT3500D p.49-50: chassis tonnage 20 through 100 in increments of five, structure ten percent',()=>{
 for(let ton=20;ton<=100;ton+=5){
  const r=ok(blank(ton));
  assert.equal(r.weights.structure,ton/10,ton+' ton structure');
  assert.equal(r.unit.tonnage,ton);
 }
 for(const invalid of [15,19,22,55.5,101,105]){
  const r=construct(blank(invalid),{strictAgoac:true});
  assert(r.errors.some(x=>x.includes('Масса:')),String(invalid));
  assert(r.diagnostics.some(x=>x.field==='tonnage'&&x.page===49));
 }
});

test('CAT3500D p.50: all seventeen internal-structure rows are fixed per chassis section',()=>{
 for(let i=0;i<printedStructure.length;i++){
  const ton=20+5*i,r=ok(blank(ton)),[ct,side,arm,leg]=printedStructure[i];
  assert.deepEqual(r.unit.structure,{HD:3,CT:ct,LT:side,RT:side,
   LA:arm,RA:arm,LL:leg,RL:leg},'printed structure row '+ton);
  assert.deepEqual(r.unit.maxStructure,r.unit.structure);
 }
});

test('CAT3500D p.49: preassigned systems reserve exact printed critical slots',()=>{
 const r=ok(blank(55,5)).unit.slots;
 assert.deepEqual(r.HD,['life','sensors','cockpit',null,'sensors','life']);
 assert.deepEqual(r.CT,['engine','engine','engine','gyro','gyro','gyro','gyro',
  'engine','engine','engine',null,null]);
 for(const loc of ['LT','RT'])assert.deepEqual(r[loc],Array(12).fill(null));
 for(const loc of ['LA','RA'])assert.deepEqual(r[loc],
  ['shoulder','upper','lower','hand',...Array(8).fill(null)]);
 for(const loc of ['LL','RL'])assert.deepEqual(r[loc],
  ['hip','upper','lower','foot',null,null]);
});

test('CAT3500D p.49: multi-slot weapons occupy adjacent free slots with no overlap',()=>{
 const c=blank(55,5);
 c.equipment=[{type:'PPC',location:'RA',slot:5}];
 const r=ok(c);
 assert.deepEqual(r.unit.slots.RA.slice(4,7),['w:0','w:0','w:0']);
 c.equipment.push({type:'Medium Laser',location:'RA',slot:6});
 assert(construct(c).errors.some(x=>x.includes('RA 6:')));
 c.equipment[1].slot=8;
 assert.deepEqual(ok(c).unit.slots.RA.slice(4,8),['w:0','w:0','w:0','w:1']);
 c.equipment[1].slot=13;
 assert(construct(c).errors.some(x=>x.includes('RA 13:')));
});

test('CAT3500D pp.49-51: hand/lower-arm removals preserve mandatory upper actuators',()=>{
 const hand=blank();hand.removeHandActuators=['LA'];
 const h=ok(hand).unit.slots;
 assert.deepEqual(h.LA.slice(0,4),['shoulder','upper','lower',null]);
 assert.deepEqual(h.RA.slice(0,4),['shoulder','upper','lower','hand']);
 const lower=blank();lower.removeActuators=['RA'];
 const l=ok(lower).unit.slots;
 assert.deepEqual(l.RA.slice(0,4),['shoulder','upper',null,null]);
 for(const key of ['removeActuators','removeHandActuators']){
  for(const malformed of [true,'RA',['LA','LA'],['CT'],[null]]){
   const c=blank();c[key]=malformed;
   const r=construct(c,{strictAgoac:true});
   assert(r.errors.some(x=>x.includes('Актуаторы')),key+' '+JSON.stringify(malformed));
   assert(r.diagnostics.some(d=>d.code==='actuators'&&d.field===key));
  }
 }
 for(const equipment of [null,{},[null],[17],['PPC']]){
  const c=blank();c.equipment=equipment;
  const r=construct(c);
  assert(r.errors.some(x=>x.includes('Список оборудования')),JSON.stringify(equipment));
  assert(r.diagnostics.some(d=>d.field==='equipment'));
 }
});

test('CAT3500D pp.51-52: fusion rating and printed engine mass boundaries',()=>{
 for(const [ton,walk,mass] of [[20,1,.5],[65,4,13.5],
  [55,5,15.5],[100,4,52.5]]){
  const r=ok(blank(ton,walk));
  assert.equal(r.rating,ton*walk);
  assert.equal(r.weights.engine,mass,'engine rating '+r.rating);
 }
 const illegal=construct(blank(100,5));
 assert(illegal.errors.some(x=>x.includes('Рейтинг двигателя')));
 assert(illegal.diagnostics.some(d=>d.field==='walk'&&d.page===51));
});

test('CAT3500D p.51: running is ceil walking times 1.5, independent of jumping',()=>{
 for(const walk of [1,2,3,4,5,6]){
  const noJump=ok(blank(55,walk));assert.equal(noJump.unit.run,Math.ceil(walk*1.5));
 }
 const jump=blank(55,5);jump.jump=2;
 jump.equipment=[{type:'jump',location:'LT',slot:1},{type:'jump',location:'RT',slot:1}];
 assert.equal(ok(jump).unit.run,8);
});

test('CAT3500D p.51: per-jet mass is 0.5/1/2 tons across published tonnage bands',()=>{
 for(const [ton,mass] of [[55,.5],[60,1],[85,1],[90,2],[100,2]]){
  const c=blank(ton);c.jump=1;c.equipment.push({type:'jump',location:'LT',slot:1});
  const r=ok(c);
  assert.equal(r.weights.jump,mass,String(ton));
  assert.equal(r.unit.jump,1);
 }
 for(const invalid of [-1,4,1.5]){
  const c=blank(55);c.jump=invalid;
  assert(construct(c).errors.some(x=>x.includes('Прыжок:')));
 }
});

test('CAT3500D p.51: each jump jet requires one torso/leg critical slot and equal Jump MP',()=>{
 for(const location of ['CT','LT','RT','LL','RL']){
  const slot=location==='CT'?11:['LL','RL'].includes(location)?5:1;
  const c=blank(55,5);c.jump=1;c.equipment=[{type:'jump',location,slot}];
  assert.equal(ok(c).unit.slots[location][slot-1],'jump');
 }
 for(const location of ['HD','LA','RA']){
  const c=blank(55,5);c.jump=1;c.equipment=[{type:'jump',location,slot:location==='HD'?4:5}];
  assert(construct(c).errors.some(x=>x.includes('только торс/ноги')));
 }
 const short=blank(55,5);short.jump=2;
 short.equipment=[{type:'jump',location:'LT',slot:1}];
 assert(construct(short).errors.some(x=>x.includes('Разместите 2')));
 const tooMany=blank(55,5);tooMany.jump=0;
 tooMany.equipment=[{type:'jump',location:'LT',slot:1}];
 assert(construct(tooMany).errors.some(x=>x.includes('Разместите 0')));
});

test('CAT3500D p.52: gyro mass steps and four mandatory center-torso critical slots',()=>{
 for(const [ton,walk,gyro] of [[20,5,1],[20,6,2],[55,5,3],[100,4,4]]){
  const r=ok(blank(ton,walk));
  assert.equal(r.weights.gyro,gyro,'gyro mass at rating '+ton*walk);
  assert.deepEqual(r.unit.slots.CT.slice(3,7),Array(4).fill('gyro'));
 }
});

test('CAT3500D p.52: three-ton cockpit reserves the printed head slot',()=>{
 for(const ton of [20,55,100]){
  const r=ok(blank(ton));
  assert.equal(r.weights.cockpit,3);
  assert.equal(r.unit.slots.HD[2],'cockpit');
  assert.deepEqual(r.unit.slots.HD.filter(x=>x==='sensors'),['sensors','sensors']);
  assert.deepEqual(r.unit.slots.HD.filter(x=>x==='life'),['life','life']);
 }
});

test('CAT3500D p.52: armor enforces nine head points and twice section structure',()=>{
 const legal=blank(55,5);
 legal.armor.HD=9;legal.armor.CT=20;legal.rear.CT=12;
 ok(legal);
 const badHead=structuredClone(legal);badHead.armor.HD=10;
 const h=construct(badHead,{strictAgoac:true});
 assert(h.errors.some(x=>x.includes('HD: превышен предел брони')));
 assert(h.diagnostics.some(d=>d.field==='armor.HD'&&d.page===52));
 const badTorso=structuredClone(legal);badTorso.rear.CT=13;
 const t=construct(badTorso,{strictAgoac:true});
 assert(t.errors.some(x=>x.includes('CT: превышен предел брони')));
 assert(t.diagnostics.some(d=>d.field==='armor.CT'&&d.page===52));
});

test('CAT3500D p.53: standard armor rounds up to eight points per half-ton',()=>{
 for(const [points,tons] of [[0,0],[1,.5],[8,.5],[9,1],[16,1],[17,1.5]]){
  const c=blank(55,5);
  c.armor.LA=Math.min(16,points);
  c.armor.RA=Math.max(0,points-16);
  assert.equal(ok(c).weights.armor,tons,points+' armor points');
 }
});

test('CAT3500D p.53: ten free sinks and integral capacity floor engine rating over twenty-five',()=>{
 for(const [ton,walk] of [[20,1],[55,5],[100,4]]){
  const rating=ton*walk,capacity=Math.floor(rating/25);
  const free=ok(blank(ton,walk));
  assert.equal(free.weights.sinks,0);
  assert.equal(free.unit.slots.RT.filter(x=>x==='sink').length,Math.max(0,10-capacity));
  const c=blank(ton,walk);c.sinks=12;
  const external=Math.max(0,12-capacity);
  c.equipment=Array.from({length:external},(_,i)=>({type:'sink',location:'RT',slot:12-i}));
  const r=ok(c);
  assert.equal(r.weights.sinks,2);
  assert.equal(r.unit.slots.RT.filter(x=>x==='sink').length,external);
 }
});

test('CAT3500D p.53: each nonintegral heat sink occupies a separate open critical slot',()=>{
 const c=blank(20,1),r=ok(c);
 assert.equal(r.unit.slots.RT.filter(x=>x==='sink').length,10);
 const missing=structuredClone(c);missing.equipment.pop();
 assert(construct(missing,{strictAgoac:true}).errors.some(x=>x.includes('10 внешних теплоотводов')));
 const occupied=structuredClone(c);occupied.equipment[1].slot=occupied.equipment[0].slot;
 assert(construct(occupied,{strictAgoac:true}).errors.some(x=>x.includes('RT 12:')));
});

test('CAT3500D p.54: standard PPC and medium laser preserve printed mass and contiguous slot sizes',()=>{
 const c=blank(55,5);
 c.equipment=[{type:'PPC',location:'RA',slot:5},{type:'Medium Laser',location:'LT',slot:1}];
 const r=ok(c);
 assert.equal(r.weights.weapons,8);
 assert.deepEqual(r.unit.slots.RA.slice(4,7),['w:0','w:0','w:0']);
 assert.equal(r.unit.slots.LT[0],'w:1');
 const unknown=blank(55,5);unknown.equipment=[{type:'Not a weapon',location:'LT',slot:1}];
 assert(construct(unknown,{strictAgoac:true}).errors.some(x=>x.includes('Неизвестное оборудование')));
});

test('CAT3500D p.49: invalid equipment locations reject with diagnostics instead of throwing',()=>{
 for(const location of ['__proto__','constructor','toString','',null,17]){
  for(const type of ['jump','sink','case2','Medium Laser']){
   const c=blank(55,5);
   if(type==='jump')c.jump=1;
   c.equipment=[{type,location,slot:1}];
   const r=construct(c,{strictAgoac:true});
   assert(r.errors.length>0,JSON.stringify({type,location}));
   assert.equal(r.diagnostics.length,r.errors.length);
  }
 }
});

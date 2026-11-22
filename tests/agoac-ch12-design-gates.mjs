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

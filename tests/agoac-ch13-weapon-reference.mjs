import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WEAPON_SPECS,FIXED_COMPONENTS} from '../packages/engine/equipment.js';
import {BASE_WEAPONS,BASE_SYSTEMS,BASE_RULEBOOK,outOfBookEquipment,equipmentRulebook} from '../packages/engine/rulebook.js';
import {construct,example} from '../packages/engine/construction.js';
import {Game} from '../dist/engine.js';

// Independent visual transcription of the official CAT3500D printed p.55 table.
// Do not construct these expectations from production weapon configuration.
const printed = {
 "Large Laser": [
  8,
  8,
  0,
  5,
  10,
  15,
  5,
  2,
  0,
  0
 ],
 "Medium Laser": [
  3,
  5,
  0,
  3,
  6,
  9,
  1,
  1,
  0,
  0
 ],
 "Small Laser": [
  1,
  3,
  0,
  1,
  2,
  3,
  0.5,
  1,
  0,
  0
 ],
 "Flamer": [
  3,
  2,
  0,
  1,
  2,
  3,
  1,
  1,
  0,
  0
 ],
 "PPC": [
  10,
  10,
  3,
  6,
  12,
  18,
  7,
  3,
  0,
  0
 ],
 "AC/2": [
  1,
  2,
  4,
  8,
  16,
  24,
  6,
  1,
  45,
  0
 ],
 "AC/5": [
  1,
  5,
  3,
  6,
  12,
  18,
  8,
  4,
  20,
  0
 ],
 "AC/10": [
  3,
  10,
  0,
  5,
  10,
  15,
  12,
  7,
  10,
  0
 ],
 "AC/20": [
  7,
  20,
  0,
  3,
  6,
  9,
  14,
  10,
  5,
  0
 ],
 "Machine Gun": [
  0,
  2,
  0,
  1,
  2,
  3,
  0.5,
  1,
  200,
  0
 ],
 "LRM 5": [
  2,
  1,
  6,
  7,
  14,
  21,
  2,
  1,
  24,
  5
 ],
 "LRM 10": [
  4,
  1,
  6,
  7,
  14,
  21,
  5,
  2,
  12,
  10
 ],
 "LRM 15": [
  5,
  1,
  6,
  7,
  14,
  21,
  7,
  3,
  8,
  15
 ],
 "LRM 20": [
  6,
  1,
  6,
  7,
  14,
  21,
  10,
  5,
  6,
  20
 ],
 "SRM 2": [
  2,
  2,
  0,
  3,
  6,
  9,
  1,
  1,
  50,
  2
 ],
 "SRM 4": [
  3,
  2,
  0,
  3,
  6,
  9,
  2,
  1,
  25,
  4
 ],
 "SRM 6": [
  4,
  2,
  0,
  3,
  6,
  9,
  3,
  2,
  15,
  6
 ]
};
const row=name=>{
 const w=WEAPON_SPECS[name];
 assert(w,'Missing base weapon '+name);
 return [w.heat,w.damage,w.minimum,...w.ranges,w.tons,w.slots,w.roundsPerTon,w.rack];
};
const assertSourceRows=names=>{
 for(const name of names){
  assert.deepEqual(row(name),printed[name],name+' must match independent p.55 row');
  assert.deepEqual(equipmentRulebook(name),
   {status:'verified_base',book:BASE_RULEBOOK.title,page:55});
 }
};
const packet=name=>{
 const game=new Game({rng:()=>.99});
 return game.fireAmounts({weapon:WEAPON_SPECS[name]},true);
};

test('CAT3500D pp.55–56: reference chapter has exactly seventeen independently transcribed base weapons',()=>{
 assert.equal(BASE_RULEBOOK.id,'agoac-2018');
 assert.equal(BASE_RULEBOOK.tablePage,55);
 assert.equal(Object.keys(printed).length,17);
 assert.deepEqual([...BASE_WEAPONS].sort(),Object.keys(printed).sort());
 assertSourceRows(BASE_WEAPONS);
 assert.deepEqual([...BASE_SYSTEMS].sort(),['ammo','hatchet','jump','sink']);
 assert.equal(FIXED_COMPONENTS.sink.tons,1);
 assert.equal(FIXED_COMPONENTS.sink.slots,1);
 for(const type of ['ER PPC','ER Large Laser','Clan ER PPC','Large Pulse Laser','case2']){
  assert.deepEqual(outOfBookEquipment({equipment:[{type}]}),[type],type);
  assert.equal(equipmentRulebook(type).status,'requires_supplement');
 }
});

test('CAT3500D pp.55–56: all autocannon calibers match their source table and direct-fire packets',()=>{
 for(const name of ['AC/2','AC/5','AC/10','AC/20']){
  assertSourceRows([name]);
  assert.deepEqual(packet(name),[WEAPON_SPECS[name].damage],name);
  assert(WEAPON_SPECS[name].roundsPerTon>0);
 }
 assert.equal(WEAPON_SPECS['AC/2'].minimum,4);
 assert.equal(WEAPON_SPECS['AC/5'].minimum,3);
 assert.equal(WEAPON_SPECS['AC/20'].slots,10);
});

test('CAT3500D pp.55–56: flamers retain their printed direct-fire stats without inventing infantry rules',()=>{
 assertSourceRows(['Flamer']);
 assert.deepEqual(packet('Flamer'),[2]);
 assert.equal(WEAPON_SPECS.Flamer.heat,3);
 assert.equal(WEAPON_SPECS.Flamer.roundsPerTon,0);
});

test('CAT3500D pp.55–56: three laser sizes match mass, heat, range and damage without ammunition',()=>{
 for(const name of ['Small Laser','Medium Laser','Large Laser']){
  assertSourceRows([name]);
  assert.equal(WEAPON_SPECS[name].roundsPerTon,0);
  assert.deepEqual(packet(name),[WEAPON_SPECS[name].damage]);
 }
});

test('CAT3500D pp.55–56: machine gun preserves its zero heat, two damage and 200-shot capacity',()=>{
 assertSourceRows(['Machine Gun']);
 assert.deepEqual(packet('Machine Gun'),[2]);
 assert.equal(WEAPON_SPECS['Machine Gun'].heat,0);
 assert.equal(WEAPON_SPECS['Machine Gun'].roundsPerTon,200);
 assert.equal(WEAPON_SPECS['Machine Gun'].tons,.5);
});

test('CAT3500D p.56: missile launcher family uses exact rack groups and finite ammunition',()=>{
 const names=[...BASE_WEAPONS].filter(name=>/^(LRM|SRM) [0-9]+$/.test(name));
 assert.equal(names.length,7);
 assertSourceRows(names);
 for(const name of names){
  const w=WEAPON_SPECS[name];
  assert(w.rack>0);
  assert(w.roundsPerTon>0);
  assert.equal(w.mechanic,'ammo_weapon');
 }
});

test('CAT3500D pp.55–56: LRM family has six-hex minimum and five-point cluster packets',()=>{
 for(const rack of [5,10,15,20]){
  const name='LRM '+rack;
  assertSourceRows([name]);
  assert.equal(WEAPON_SPECS[name].minimum,6);
  assert.deepEqual(packet(name),Array(rack/5).fill(5));
 }
});

test('CAT3500D pp.55–56: SRM family has no minimum and applies two damage per missile',()=>{
 for(const rack of [2,4,6]){
  const name='SRM '+rack;
  assertSourceRows([name]);
  assert.equal(WEAPON_SPECS[name].minimum,0);
  assert.deepEqual(packet(name),Array(rack).fill(2));
 }
});

test('CAT3500D pp.55–56: PPC keeps ten heat, ten damage and three-hex minimum',()=>{
 assertSourceRows(['PPC']);
 assert.deepEqual(packet('PPC'),[10]);
 assert.equal(WEAPON_SPECS.PPC.minimum,3);
 assert.equal(WEAPON_SPECS.PPC.heat,10);
});

test('CAT3500D pp.55–56: Hatchet is a basic physical weapon with chassis-based criticals',()=>{
 assert(BASE_SYSTEMS.includes('hatchet'));
 assert(!outOfBookEquipment({equipment:[{type:'hatchet'}]}).length);
 const cfg=structuredClone(example);
 cfg.equipment[0]={type:'hatchet',location:'RA',slot:5};
 // The original PPC is gone: LRM 10 is now weapon index 0, not index 1.
 // Preserve the two magazines for the surviving launcher, rather than
 // intentionally constructing an ammo-reference error in a hatchet test.
 for(const item of cfg.equipment)if(item.type==='ammo')item.weapon=0;
 const made=construct(cfg,{strictAgoac:true});
 assert.deepEqual(made.errors,[],made.errors.join('; '));
 assert.equal(made.unit.hatchets.length,1);
 assert.equal(made.unit.hatchets[0].location,'RA');
 assert.equal(made.unit.hatchets[0].slots,Math.ceil(cfg.tonnage/15));
 assert.equal(made.unit.slots.RA.slice(4,8).every(x=>x==='hatchet'),true);
});

test('CAT3500D p.56: complete final chapter retains individually sourced and executable verification links',()=>{
 const audit=JSON.parse(readFileSync(new URL('../rules/agoac-audit.json',import.meta.url),'utf8'));
 const topic=audit.topics.find(t=>t.id==='agoac-equipment');
 assert.deepEqual(topic.pages,[56]);
 assert.equal(topic.status,'verified');
 assert(topic.audit?.sourceChecked&&topic.audit?.edgeCasesChecked&&topic.audit?.inventoryComplete);
 const children=audit.requirements.filter(r=>r.topicId==='agoac-equipment');
 assert.equal(children.length,10);
 assert.deepEqual([...topic.audit.requirementIds].sort(),children.map(r=>r.id).sort());
 for(const child of children){
  assert.equal(child.status,'verified',child.id);
  assert.deepEqual(child.pages,[56],child.id);
  assert(child.audit?.sourceChecked&&child.audit?.edgeCasesChecked,child.id);
  assert(child.audit?.mainQualityGate?.conclusion==='success',child.id);
  assert(child.evidence.some(e=>e.file==='tests/agoac-ch13-weapon-reference.mjs'),child.id);
  for(const entry of child.evidence){
   const content=readFileSync(new URL('../'+entry.file,import.meta.url),'utf8');
   assert(content.includes("test('"+entry.test+"'"),child.id+': missing '+entry.test);
  }
 }
 assert.equal(audit.topics.length,13);
 assert(audit.topics.every(t=>t.status==='verified'));
 assert.equal(audit.currentTopicId,null);
 assert.equal(audit.requirements.filter(r=>r.status!=='verified').length,0);
 assert(audit.note.includes('Not an exhaustive paragraph-by-paragraph'), 'Do not overstate the inventory');
});

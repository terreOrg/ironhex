import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WEAPON_SPECS} from '../packages/engine/equipment.js';
import {BASE_RULEBOOK,BASE_WEAPONS,isBaseWeapon,outOfBookEquipment,
  equipmentRulebook} from '../packages/engine/rulebook.js';
import {EQUIPMENT_CATALOG,MECH_OFFERS} from '../apps/api/src/market.mjs';
import {validateDesign} from '../apps/api/src/hangar.mjs';
import {construct,example} from '../packages/engine/construction.js';

// Independent transcription of A Game of Armored Combat (2018), p.55
// Weapons and Equipment Table. Do NOT derive these expected values from
// the production component registry: differences must fail CI.
const page55={
  'Large Laser':       [8,8,0,5,10,15,5,2,0,0],
  'Medium Laser':      [3,5,0,3,6,9,1,1,0,0],
  'Small Laser':       [1,3,0,1,2,3,.5,1,0,0],
  Flamer:              [3,2,0,1,2,3,1,1,0,0],
  PPC:                [10,10,3,6,12,18,7,3,0,0],
  'AC/2':              [1,2,4,8,16,24,6,1,45,0],
  'AC/5':              [1,5,3,6,12,18,8,4,20,0],
  'AC/10':             [3,10,0,5,10,15,12,7,10,0],
  'AC/20':             [7,20,0,3,6,9,14,10,5,0],
  'Machine Gun':       [0,2,0,1,2,3,.5,1,200,0],
  'LRM 5':             [2,1,6,7,14,21,2,1,24,5],
  'LRM 10':            [4,1,6,7,14,21,5,2,12,10],
  'LRM 15':            [5,1,6,7,14,21,7,3,8,15],
  'LRM 20':            [6,1,6,7,14,21,10,5,6,20],
  'SRM 2':             [2,2,0,3,6,9,1,1,50,2],
  'SRM 4':             [3,2,0,3,6,9,2,1,25,4],
  'SRM 6':             [4,2,0,3,6,9,3,2,15,6]
};

test('A Game of Armored Combat page-55 specifications are identical to combat data',()=>{
  assert.equal(BASE_RULEBOOK.id,'agoac-2018');
  assert.equal(BASE_RULEBOOK.tablePage,55);
  assert.deepEqual([...BASE_WEAPONS].sort(),Object.keys(page55).sort());
  for(const [name,row] of Object.entries(page55)){
    const s=WEAPON_SPECS[name];
    assert(s,name);
    assert.deepEqual([s.heat,s.damage,s.minimum,...s.ranges,
      s.tons,s.slots,s.roundsPerTon,s.rack],row,name);
    const card=EQUIPMENT_CATALOG.find(item=>item.sku==='weapon:'+name);
    assert(card,'Only fully implemented book components should be sold');
    assert.equal(card.rulebook.book,BASE_RULEBOOK.title);
    assert.equal(card.rulebook.page,55);
    assert.equal(card.rulebook.status,'verified_base');
  }
  assert.equal(EQUIPMENT_CATALOG.filter(x=>x.kind==='weapon').length,17);
});
test('Non-box technologies remain defined for future books but cannot enter base contracts',()=>{
  for(const name of ['ER PPC','ER Large Laser','Clan ER PPC',
    'Large Pulse Laser','Clan Large Pulse Laser']){
    assert(WEAPON_SPECS[name],'Supplemental engine data is preserved');
    assert.equal(isBaseWeapon(name),false);
    assert.equal(equipmentRulebook(name).status,'requires_supplement');
    assert(!EQUIPMENT_CATALOG.some(item=>item.sku==='weapon:'+name));
    const config=structuredClone(example);
    config.equipment[0].type=name;
    assert.deepEqual(construct(config).errors,[],
      'Standalone engine retains previously supported equipment');
    assert.deepEqual(outOfBookEquipment(config),[name]);
    assert.throws(()=>validateDesign({config}),
      error=>error.code==='unsupported_rulebook_equipment',
      'Server must reject unsupported book-level designs');
  }
  for(const offer of MECH_OFFERS)
    assert.deepEqual(outOfBookEquipment(offer.config),[],offer.name);
  assert(!EQUIPMENT_CATALOG.some(item=>item.sku==='system:double-sink'));
  assert(!EQUIPMENT_CATALOG.some(item=>item.sku==='system:xl-engine'));
  assert(!EQUIPMENT_CATALOG.some(item=>item.sku==='system:ecm'));
});
test('Box construction: engine weight, integral sinks, jump mass and armor',()=>{
  const built=construct(example);
  assert.deepEqual(built.errors,[]);
  assert.equal(built.rating,275);
  assert.equal(built.weights.engine,15.5,
    '2018 AGoAC engine table: rating 275 -> 15.5 t');
  assert.equal(built.weights.structure,5.5);
  assert.equal(built.weights.gyro,3);
  assert.equal(built.weights.cockpit,3);
  assert.equal(built.weights.sinks,2,
    'Only sinks beyond the fusion engine free ten weigh extra');
  assert.equal(built.weights.jump,2.5,
    '55-ton BattleMech: 0.5 t per Jump MP');
  assert.equal(built.unit.slots.CT[10],'sink',
    '275-rated engine holds eleven integral heat sinks, leaving one exposed');
  assert.equal(built.unit.weapons.find(w=>w.name==='PPC').min,3);
});

test('CAT3500D p.55: supplementary CASE and CASE II never pass as base AGoAC',()=>{
 for(const type of ['case','case2']){
  const cfg={name:'Base box only',tonnage:100,walk:3,jump:0,sinks:10,
   armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
   rear:{CT:0,LT:0,RT:0},equipment:[{type,location:'RT',slot:1}]};
  assert.deepEqual(construct(cfg).errors,[],
   'Supplemental technology still works under its own future rulebook');
  assert.deepEqual(outOfBookEquipment(cfg),[type]);
  assert.throws(()=>validateDesign({config:cfg}),error=>
   error.status===422&&error.code==='unsupported_rulebook_equipment'&&
   error.details?.length===1&&error.details[0].field==='equipment.0.type'&&
   error.details[0].step===7&&error.details[0].page===55&&
   error.details[0].message.includes(type));
 }
 assert.deepEqual(outOfBookEquipment({equipment:[
  {type:'hatchet'},{type:'sink'},{type:'ammo'},{type:'jump'}]}),[],
  'Hatchet and Heat Sink are printed on p.55');
});

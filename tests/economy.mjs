import assert from 'node:assert/strict';
import {test} from 'node:test';
import {construct} from '../packages/engine/construction.js';
import {MECH_OFFERS,EQUIPMENT_CATALOG,weaponCounts,weaponName} from '../apps/api/src/market.mjs';
import {CATALOG,CONTRACTS,contractById,contractPayout,repairQuote} from '../apps/api/src/economy.mjs';

test('Contracts have unique, server-owned terms and nonzero risk payouts',()=>{
  assert.equal(CONTRACTS.length,3);
  assert.equal(new Set(CONTRACTS.map(c=>c.id)).size,3);
  assert(CONTRACTS[0].enemyGunnery>CONTRACTS[2].enemyGunnery);
  assert.equal(contractPayout('intercept','victory'),56000);
  assert.equal(contractPayout('intercept','draw'),28000);
  assert.equal(contractPayout('intercept','defeat'),11200);
  assert.equal(contractById('counterfeit'),undefined);
});
test('Repair quotes consume owned supplies and keep wreck salvage fee',()=>{
  const mech={id:'m',chassis:'Griffin',armor_damage:13,structure_damage:8,wrecked:true};
  const quote=repairQuote(mech,{armor_patch:1,structure_kit:1});
  assert.equal(quote.creditCost,3*125+3*650+8000);
  assert.equal(quote.armorPatches,1);
  assert.equal(quote.structureKits,1);
  assert.equal(quote.needsRepair,true);
  const full=repairQuote(mech,{armor_patch:2,structure_kit:2});
  assert.equal(full.creditCost,8000);
  assert.equal(repairQuote({...mech,armor_damage:0,structure_damage:0,wrecked:false}).needsRepair,false);
});
test('Supply catalog prices remain fixed and positive',()=>{
  assert.deepEqual(CATALOG.map(p=>p.sku),['armor_patch','structure_kit']);
  assert(CATALOG.every(item=>item.price>0&&Number.isSafeInteger(item.price)));
});

test('Dealer offers stay under construction limits and have unique fixed prices',()=>{
  assert(MECH_OFFERS.length>=3);
  assert.equal(new Set(MECH_OFFERS.map(x=>x.id)).size,MECH_OFFERS.length);
  for(const offer of MECH_OFFERS){
    assert.deepEqual(construct(offer.config).errors,[],offer.id);
    assert(Number.isInteger(offer.price)&&offer.price>0);
  }
});
test('All equipment SKUs map to controlled inventory keys',()=>{
  assert(EQUIPMENT_CATALOG.length>=15);
  assert.equal(weaponName('weapon:Medium Laser'),'Medium Laser');
  assert.equal(weaponName('weapon:PPC-synthetic'),null);
  assert.equal(weaponCounts({equipment:[{type:'PPC'},{type:'PPC'},{type:'jump'}]}).get('PPC'),2);
});

test('Ammo packs are server-owned, listed only for supported firearms',()=>{
  const ammo=EQUIPMENT_CATALOG.filter(x=>x.kind==='ammo');
  assert(ammo.length>=10);
  assert(ammo.every(x=>x.sku.startsWith('ammo:')&&x.rounds>0&&x.price>0));
  assert(ammo.some(x=>x.sku==='ammo:LRM 20'));
  assert(!ammo.some(x=>x.sku==='ammo:PPC'));
  assert(!EQUIPMENT_CATALOG.some(x=>x.sku==='weapon:ER PPC'));
});

test('Physical equipment is purchasable only where combat mechanics already exist',()=>{
  const systems=EQUIPMENT_CATALOG.filter(x=>x.kind==='system');
  assert.deepEqual(systems.map(x=>x.sku).sort(),
    ['system:hatchet','system:jump','system:sink']);
  assert(systems.every(x=>Number.isSafeInteger(x.price)&&x.price>0));
  assert(!EQUIPMENT_CATALOG.some(x=>x.sku==='system:ecm'));
});

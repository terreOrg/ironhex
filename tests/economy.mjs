import assert from 'node:assert/strict';
import {test} from 'node:test';
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

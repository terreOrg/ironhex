import {test} from 'node:test';
import assert from 'node:assert/strict';
import {construct,example,EQUIPMENT} from '../packages/engine/construction.js';
import {Game} from '../packages/engine/engine.js';
import {WEAPON_NAMES,WEAPON_SPECS,AMMO_PACKS,ammoPack,
  ammoBinsFor,normalizedAmmoState,FIXED_COMPONENTS} from '../packages/engine/equipment.js';
import {EQUIPMENT_CATALOG} from '../apps/api/src/market.mjs';

test('The single component registry supplies construction AND market stats',()=>{
  assert.deepEqual(EQUIPMENT,WEAPON_NAMES);
  const bySku=new Map(EQUIPMENT_CATALOG.map(item=>[item.sku,item]));
  assert.equal(bySku.size,WEAPON_NAMES.length+
    Object.keys(AMMO_PACKS).length+Object.keys(FIXED_COMPONENTS).length);
  for(const name of WEAPON_NAMES){
    const spec=WEAPON_SPECS[name],product=bySku.get(spec.id);
    assert(product,'Missing market entry for engine weapon '+name);
    assert.equal(product.price,spec.price);
    assert.equal(product.damage,spec.damage);
    assert.equal(product.heat,spec.heat);
    assert.deepEqual(product.ranges,spec.ranges);
    assert.equal(spec.supported,true);
    if(spec.roundsPerTon){
      const pack=ammoPack(name);
      assert(pack,'No reload product for '+name);
      assert.equal(pack.rounds,spec.roundsPerTon);
      assert.equal(bySku.get(pack.sku).kind,'ammo');
      assert.equal(bySku.get(pack.sku).price,pack.price);
    }else assert.equal(ammoPack(name),null);
  }
  assert.equal(FIXED_COMPONENTS.jump.sold,true);
  assert.equal(bySku.get('system:jump').price,FIXED_COMPONENTS.jump.price);
  assert.equal(FIXED_COMPONENTS.sink.sold,true);
  assert.equal(bySku.get('system:sink').price,FIXED_COMPONENTS.sink.price);
  assert.equal(FIXED_COMPONENTS.hatchet.sold,true);
  assert.equal(bySku.get('system:hatchet').price,FIXED_COMPONENTS.hatchet.price);
  assert.equal(bySku.has('weapon:ER PPC'),false,
    'Advanced technology is not for sale until a combat mechanic exists');
});
test('A purchased magazine stays empty until explicitly reloaded',()=>{
  const built=construct(example);
  assert.deepEqual(built.errors,[]);
  const bins=ammoBinsFor(example);
  assert(bins.length>=2);
  const first=bins[0];
  assert.equal(first.weapon,'LRM 10');
  assert.equal(first.capacity,12);
  const full=normalizedAmmoState(example);
  assert.equal(full[first.key],12);
  const depleted=normalizedAmmoState(example,{[first.key]:0,
    'RT:100':999,'../../fake':123});
  assert.equal(depleted[first.key],0);
  assert.equal(Object.hasOwn(depleted,'RT:100'),false);
  assert.equal(Object.hasOwn(depleted,'../../fake'),false);
  const clamped=normalizedAmmoState(example,{[first.key]:99999});
  assert.equal(clamped[first.key],12);
  const game=new Game({rng:()=>.5});
  Object.assign(game.units[0],built.unit);
  for(const bin of game.units[0].bins)
    bin.shots=depleted[bin.location+':'+(bin.slot+1)]??bin.shots;
  game.syncAmmo(game.units[0]);
  const lrm=game.units[0].weapons.find(w=>w.name==='LRM 10');
  assert.equal(lrm.ammo,12,'The second ammo bin remains intact');
  for(const bin of game.units[0].bins)bin.shots=0;
  game.syncAmmo(game.units[0]);
  assert.equal(lrm.ammo,0,'Empty bins must not silently refill on launch');
  assert.equal(game.units[0].weapons.find(w=>w.name==='PPC').ammo,null);
});

test('Paid jump jets, heat sinks and hatchets are used by movement/heat/melee',()=>{
  const baseline=structuredClone(example);
  const stripped=structuredClone(example);
  stripped.equipment=stripped.equipment.filter(e=>!['LRM 10','ammo'].includes(e.type));
  const oneJet=stripped.equipment.findIndex(e=>e.type==='jump');
  assert(oneJet>=0);
  stripped.equipment.splice(oneJet,1);
  stripped.jump--;
  const result=construct(stripped);
  assert.deepEqual(result.errors,[]);
  const game=new Game({rng:()=>.5});
  Object.assign(game.units[0],result.unit);
  assert.equal(game.mp(game.units[0],'jump'),stripped.jump);
  // Free critical slot and mass from the removed missile system allow
  // installing a real melee weapon which the Game rules then recognize.
  const withHatchet=structuredClone(stripped);
  withHatchet.equipment.push({type:'hatchet',location:'LA',slot:5});
  const built=construct(withHatchet);
  assert.deepEqual(built.errors,[]);
  assert.equal(built.unit.hatchets.length,1);
  Object.assign(game.units[0],built.unit);
  const defender=game.units[2];
  game.units[0].q=0;game.units[0].r=0;game.units[0].facing=0;
  defender.q=1;defender.r=0;
  const attack=game.physicalPreview(0,2,'hatchet','LA');
  assert.equal(attack.legal,true,attack.reason);
  assert(attack.damage>0);
  const cold=new Game({rng:()=>.5}),warm=new Game({rng:()=>.5});
  cold.units[0].heat=12;warm.units[0].heat=12;
  cold.units[0].sinks=11;warm.units[0].sinks=10;
  cold.heatPhase();warm.heatPhase();
  assert(cold.units[0].heat<=warm.units[0].heat,
    'An extra single heat sink must cool at least as well as the baseline');
});

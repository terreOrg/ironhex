import {test} from 'node:test';
import assert from 'node:assert/strict';
import {construct,example,EQUIPMENT} from '../packages/engine/construction.js';
import {Game} from '../packages/engine/engine.js';
import {WEAPON_NAMES,WEAPON_SPECS,AMMO_PACKS,ammoPack,
  ammoBinsFor,normalizedAmmoState,FIXED_COMPONENTS} from '../packages/engine/equipment.js';
import {EQUIPMENT_CATALOG} from '../apps/api/src/market.mjs';
import {applyCriticalDamage,captureCriticalDamage,damagedComponents,
  normalizedCriticalDamage} from '../packages/engine/component-damage.js';

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
  assert.equal(bySku.has('weapon:ER PPC'),true,
    'Inner Sphere ER PPC has full direct-fire combat mechanics');
  assert.equal(bySku.has('weapon:Clan ER PPC'),false,
    'Unimplemented Clan tech must not be available');
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

test('Damage to individual critical slots survives serialization and disables weapons',()=>{
  const constructed=construct(example);
  assert.deepEqual(constructed.errors,[]);
  const u=constructed.unit;
  u.crit.RA[4]=true; // PPC is a multi-slot weapon, all slots refer to w:0
  u.crit.CT[10]=true; // Single heat sink
  u.crit.RT[4]=true; // LRM 10 ammunition magazine
  const persisted=captureCriticalDamage(u);
  assert.deepEqual(persisted,{CT:[10],RT:[4],RA:[4]});
  assert.deepEqual(normalizedCriticalDamage(example,
    {...persisted,HD:[999,-1,1.5],HACK:[0]}),persisted);
  const failures=damagedComponents(example,persisted);
  assert.equal(failures.length,3);
  assert(failures.some(p=>p.kind==='weapon'&&p.name==='PPC'&&
    p.sku==='PPC'&&p.slots.length===3));
  assert(failures.some(p=>p.kind==='ammo'&&p.sku==='ammo:LRM 10'));
  assert(failures.some(p=>p.kind==='system'&&p.sku==='system:sink'));
  const game=new Game({rng:()=>.5});
  Object.assign(game.units[0],construct(example).unit);
  applyCriticalDamage(game.units[0],persisted);
  game.syncAmmo(game.units[0]);
  const damaged=game.units[0];
  assert.equal(damaged.weapons[0].destroyed,true);
  assert.equal(damaged.sinksLost,1);
  assert.equal(damaged.bins.find(b=>b.location==='RT'&&b.slot===4).destroyed,true);
  assert.equal(damaged.weapons[1].ammo,12,
    'Only the other intact LRM magazine may supply shots');
  const repaired=structuredClone(persisted);
  repaired.RA=[];delete repaired.RA;
  const restored=new Game({rng:()=>.5});
  Object.assign(restored.units[0],construct(example).unit);
  applyCriticalDamage(restored.units[0],repaired);
  assert.equal(restored.units[0].weapons[0].destroyed,false);
});
test('Persistent core damage changes heat and mobility, without hidden client state',()=>{
  const valid=normalizedCriticalDamage(example,{CT:[0,1],LL:[0]});
  const unit=new Game({rng:()=>.5}).units[0];
  Object.assign(unit,construct(example).unit);
  applyCriticalDamage(unit,valid);
  assert.equal(unit.engineHits,2);
  assert.equal(unit.actuators.LL.hip,true);
  const battle=new Game({rng:()=>.5});
  Object.assign(battle.units[0],construct(example).unit);
  applyCriticalDamage(battle.units[0],valid);
  assert(battle.mp(battle.units[0])<example.walk);
  const remaining=damagedComponents(example,valid);
  assert(remaining.filter(part=>part.name==='Двигатель').length===2);
  assert(remaining.some(part=>part.name==='Тазобедренный актуатор'&&
    part.serviceCost>0));
});
test('Inner Sphere ER direct-fire weapons use verified damage, heat and ranges',()=>{
  const checks=[
    ['ER Small Laser',2,3,2,4,5,.5,1],
    ['ER Medium Laser',5,5,4,8,12,1,1],
    ['ER Large Laser',12,8,7,14,19,5,2],
    ['ER PPC',15,10,7,14,23,7,3]
  ];
  for(const [name,heat,damage,short,medium,long,tons,slots] of checks){
    const spec=WEAPON_SPECS[name];
    assert(spec&&spec.supported,name);
    assert.equal(spec.heat,heat);
    assert.equal(spec.damage,damage);
    assert.equal(spec.minimum,0);
    assert.deepEqual(spec.ranges,[short,medium,long]);
    assert.equal(spec.tons,tons);
    assert.equal(spec.slots,slots);
    assert.equal(spec.roundsPerTon,0);
    assert.equal(spec.introYear,3037);
    const copied=structuredClone(example);
    copied.equipment[0].type=name;
    assert.deepEqual(construct(copied).errors,[],name);
    const built=construct(copied).unit;
    assert.equal(built.weapons[0].heat,heat);
    assert.equal(built.weapons[0].damage,damage);
    assert.deepEqual(built.weapons[0].ranges,[short,medium,long]);
  }
});

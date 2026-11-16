// Real PostgreSQL integration for the NPC dealer and weapon warehouse.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {example} from '../packages/engine/construction.js';
const base='http://127.0.0.1:3000';
const suffix=randomBytes(6).toString('hex');
async function req(path,{method='GET',cookie,body,origin=true}={}){
  const headers={};
  if(cookie)headers.Cookie=cookie;
  if(method!=='GET'){
    headers['Content-Type']='application/json';
    if(origin)headers.Origin=base;
  }
  const r=await fetch(base+path,{method,headers,
    body:method==='GET'?undefined:JSON.stringify(body||{})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
}
async function account(prefix){
  const r=await req('/api/v1/auth/register',{method:'POST',
    body:{handle:prefix+suffix,email:prefix+suffix+'@example.invalid',
      password:'Dealer-Integration-2026!'}});
  assert.equal(r.status,201,JSON.stringify(r.data));
  return {cookie:r.cookie.split(';')[0]};
}
const one=await account('MarketA'),other=await account('MarketB');
const original=await req('/api/v1/economy',{cookie:one.cookie});
assert.equal(original.status,200);
assert.equal(original.data.balance,150000);
assert(original.data.mechOffers.length>=6);
const offer=original.data.mechOffers.find(x=>x.id==='mm-grf-1m');
assert(offer,'Griffin GRF-1M must be imported from MegaMek Data');
assert(original.data.catalog.some(c=>c.sku==='weapon:Medium Laser'));
assert.equal((await req('/api/v1/economy/mechs/purchase',{
  method:'POST',body:{offerId:'mm-grf-1m'}})).status,401);
assert.equal((await req('/api/v1/economy/mechs/purchase',{
  method:'POST',cookie:one.cookie,origin:false,
  body:{offerId:'mm-grf-1m'}})).status,403);
assert.equal((await req('/api/v1/economy/mechs/purchase',{
  method:'POST',cookie:one.cookie,
  body:{offerId:'mm-grf-1m',price:1}})).status,422);
assert.equal((await req('/api/v1/economy/mechs/purchase',{
  method:'POST',cookie:one.cookie,body:{offerId:'not-listed'}})).status,422);
const prototype=await req('/api/v1/hangar',{method:'POST',
  cookie:one.cookie,body:{config:example}});
assert.equal(prototype.status,201);
assert.equal(prototype.data.item.marketOwned,false);
assert.equal((await req('/api/v1/operations',{method:'POST',cookie:one.cookie,
  body:{title:'Бесплатный контракт',mechIds:[prototype.data.item.id]}})).status,409);
const weapon=await req('/api/v1/economy/purchase',{method:'POST',
  cookie:one.cookie,body:{sku:'weapon:Medium Laser',quantity:1}});
assert.equal(weapon.status,200,JSON.stringify(weapon.data));
assert.equal(weapon.data.item.spent,2500);
const bought=await req('/api/v1/economy/mechs/purchase',{method:'POST',
  cookie:one.cookie,body:{offerId:'mm-grf-1m'}});
assert.equal(bought.status,201,JSON.stringify(bought.data));
assert.equal(bought.data.item.spent,offer.price);
const mechId=bought.data.item.id;
let wallet=await req('/api/v1/economy',{cookie:one.cookie});
assert.equal(wallet.data.balance,150000-2500-offer.price);
assert.equal(wallet.data.equipmentStock['Medium Laser'],1);
assert.equal((await req('/api/v1/economy',{cookie:other.cookie}))
  .data.equipmentStock['Medium Laser']||0,0);
assert.equal((await req('/api/v1/hangar',{cookie:one.cookie}))
  .data.items.find(m=>m.id===mechId).marketOwned,true);
const boughtItem=(await req('/api/v1/hangar',{cookie:one.cookie})).data.items.find(x=>x.id===mechId);
const purchasedConfig=structuredClone(boughtItem.state.config);
assert.equal(purchasedConfig.name,'Griffin GRF-1M');
assert.equal(purchasedConfig.walk,5);
assert.equal(purchasedConfig.jump,5);
assert(purchasedConfig.equipment.some(e=>e.type==='LRM 20'),
  'Purchased Griffin must have its real MTF armament');
const modified=structuredClone(purchasedConfig);
modified.equipment=modified.equipment.filter(e=>e.type!=='LRM 20'&&e.type!=='ammo');
modified.equipment.push({type:'Medium Laser',location:'LA',slot:5});
let changed=await req('/api/v1/hangar/'+mechId,{method:'PATCH',
  cookie:one.cookie,body:{config:modified}});
assert.equal(changed.status,200,JSON.stringify(changed.data));
wallet=await req('/api/v1/economy',{cookie:one.cookie});
assert.equal(wallet.data.equipmentStock['Medium Laser'],0,'Weapon must leave warehouse');
assert.equal((await req('/api/v1/hangar/'+mechId,{method:'PATCH',
  cookie:other.cookie,body:{config:modified}})).status,404);
const missing=structuredClone(modified);
missing.equipment[missing.equipment.length-1].type='Small Laser';
const shortage=await req('/api/v1/hangar/'+mechId,{method:'PATCH',
  cookie:one.cookie,body:{config:missing}});
assert.equal(shortage.status,409,JSON.stringify(shortage.data));
assert.equal(shortage.data.error,'insufficient_equipment');
const altered=structuredClone(modified);
altered.armor.CT-=1;
const locked=await req('/api/v1/hangar/'+mechId,{method:'PATCH',
  cookie:one.cookie,body:{config:altered}});
assert.equal(locked.status,409,JSON.stringify(locked.data));
assert.equal(locked.data.error,'factory_frame_locked');
changed=await req('/api/v1/hangar/'+mechId,{method:'PATCH',
  cookie:one.cookie,body:{config:purchasedConfig}});
assert.equal(changed.status,200,JSON.stringify(changed.data));
wallet=await req('/api/v1/economy',{cookie:one.cookie});
assert.equal(wallet.data.equipmentStock['Medium Laser'],1,
  'Uninstalled laser should return to warehouse without duplication');
assert.equal(wallet.data.balance,150000-2500-offer.price,
  'Refitting inventory alone should not create new money');
const license=await req('/api/v1/operations',{method:'POST',
  cookie:one.cookie,body:{title:'Оплаченный контракт',mechIds:[mechId]}});
assert.equal(license.status,201,JSON.stringify(license.data));
assert.equal((await req('/api/v1/hangar/'+mechId,{method:'PATCH',
  cookie:one.cookie,body:{config:modified}})).status,409,
  'Cannot refit an assigned mech while the mission is open');
console.log('Market integration passed: dealer ownership, licensed operations, inventory refit, locked frame, no free equipment, tenant isolation');

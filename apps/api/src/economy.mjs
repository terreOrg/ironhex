import {randomUUID} from 'node:crypto';
import {AuthError} from './auth.mjs';
import {ammoBinsFor,normalizedAmmoState,AMMO_PACKS} from '../../../packages/engine/equipment.js';
import {construct} from '../../../packages/engine/construction.js';
import {damagedComponents,normalizedCriticalDamage} from
  '../../../packages/engine/component-damage.js';
import {MECH_OFFERS,showMechOffer,EQUIPMENT_CATALOG,REFERENCE_EQUIPMENT_CATALOG,
  searchMechCatalog,getMechDetails,searchReferenceEquipment,getReferenceEquipmentDetails} from './market.mjs';

export const CONTRACTS=[
  {id:'patrol',name:'Приграничный патруль',victory:32000,enemyGunnery:4},
  {id:'intercept',name:'Перехват рейдеров',victory:56000,enemyGunnery:3},
  {id:'assault',name:'Штурм укреплений',victory:92000,enemyGunnery:2}
];
export const CATALOG=[
  {sku:'armor_patch',name:'Комплект бронепластин',price:900,restore:10},
  {sku:'structure_kit',name:'Ремкомплект конструкции',price:2500,restore:5}
];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const contractById=id=>CONTRACTS.find(c=>c.id===id);
export function contractPayout(id,result){
  const victory=(contractById(id)||CONTRACTS[0]).victory;
  return result==='victory'?victory:result==='draw'?Math.floor(victory/2):Math.floor(victory/5);
}
export function repairQuote(mech,stock={}){
  const armor=Number(mech.armor_damage||0),structure=Number(mech.structure_damage||0);
  const armorPatches=Math.min(Math.ceil(armor/10),stock.armor_patch||0);
  const structureKits=Math.min(Math.ceil(structure/5),stock.structure_kit||0);
  return {mechId:mech.id,chassis:mech.chassis,armorDamage:armor,
    structureDamage:structure,wrecked:!!mech.wrecked,
    armorPatches,structureKits,
    needsRepair:!!mech.wrecked||armor>0||structure>0,
    creditCost:Math.max(0,armor-10*armorPatches)*125+
      Math.max(0,structure-5*structureKits)*650+(mech.wrecked?8000:0)};
}
async function inTransaction(pool,action){
  const c=await pool.connect();
  try{await c.query('BEGIN');const result=await action(c);await c.query('COMMIT');return result;}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
// Wallet row serializes all purchases and payouts for one commander.
export async function ensureWallet(client,owner){
  const added=await client.query('INSERT INTO commander_wallets(commander_id,balance) '+
    'VALUES($1,150000) ON CONFLICT DO NOTHING RETURNING commander_id',[owner]);
  if(added.rows.length)
    await client.query('INSERT INTO credit_ledger(commander_id,change_amount,reason,reference_key) '+
      'VALUES($1,150000,$2,$3)',[owner,'Стартовый капитал','opening:'+owner]);
  const r=await client.query('SELECT balance FROM commander_wallets WHERE commander_id=$1 FOR UPDATE',[owner]);
  return Number(r.rows[0].balance);
}
export async function changeCredits(client,owner,amount,reason,reference){
  if(!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>100000000)
    throw Error('invalid_credit_change');
  await ensureWallet(client,owner);
  const inserted=await client.query('INSERT INTO credit_ledger '+
    '(commander_id,change_amount,reason,reference_key) '+
    'VALUES($1,$2,$3,$4) ON CONFLICT(reference_key) DO NOTHING RETURNING id',
    [owner,amount,reason,reference]);
  if(!inserted.rows.length)return false;
  const updated=await client.query('UPDATE commander_wallets SET balance=balance+$2 '+
    'WHERE commander_id=$1 AND balance+$2>=0 RETURNING balance',[owner,amount]);
  if(!updated.rows.length)throw new AuthError(409,'insufficient_credits');
  return true;
}
async function stockFor(client,owner){
  const r=await client.query('SELECT sku,quantity FROM commander_supplies WHERE commander_id=$1',[owner]);
  return Object.fromEntries(r.rows.map(row=>[row.sku,row.quantity]));
}
export function createEconomyStore(pool){
  return {
    browseMechs(options){return searchMechCatalog(options);},
    mechDetails(path){return getMechDetails(path);},
    equipmentDetails(sku){return getReferenceEquipmentDetails(sku);},
    browseEquipment(options){return searchReferenceEquipment(options);},
    summary(owner){
      return inTransaction(pool,async c=>{
        const balance=await ensureWallet(c,owner);
        const stock=await stockFor(c,owner);
        const equipped=await c.query(
          'SELECT equipment_type,quantity FROM commander_equipment WHERE commander_id=$1',[owner]);
        const equipmentStock=Object.fromEntries(
          equipped.rows.map(row=>[row.equipment_type,row.quantity]));
        const mechs=await c.query('SELECT id,chassis,armor_damage,structure_damage,wrecked,market_owned,state,ammo_state,critical_damage '+
          'FROM hangar_mechs WHERE commander_id=$1 ORDER BY created_at DESC',[owner]);
        const ledger=await c.query('SELECT change_amount,reason,created_at FROM credit_ledger '+
          'WHERE commander_id=$1 ORDER BY id DESC LIMIT 20',[owner]);
        return {balance,stock,equipmentStock,contracts:CONTRACTS,
          catalog:[...CATALOG.map(item=>({...item,kind:'supply'})),...EQUIPMENT_CATALOG],
          referenceEquipmentCount:REFERENCE_EQUIPMENT_CATALOG.length,
          mechOffers:MECH_OFFERS.map(showMechOffer),
          repairs:mechs.rows.map(m=>repairQuote(m,stock)),
          components:mechs.rows.flatMap(m=>m.state?.config?
            damagedComponents(m.state.config,m.critical_damage).map(part=>({
              ...part,mechId:m.id,chassis:m.chassis,
              licensed:!!m.market_owned,
              requiredStock:part.sku?(equipmentStock[part.sku]||0):null
            })):[]),
          magazines:mechs.rows.flatMap(mech=>
            ammoBinsFor(mech.state?.config).map(bin=>{
              const levels=normalizedAmmoState(mech.state.config,mech.ammo_state);
              return {mechId:mech.id,chassis:mech.chassis,
                location:bin.location,slot:bin.slot+1,weapon:bin.weapon,
                rounds:levels[bin.key],capacity:bin.capacity,
                reloadSku:'ammo:'+bin.weapon,licensed:!!mech.market_owned,
                damaged:!!(mech.wrecked||mech.armor_damage||mech.structure_damage||
                  normalizedCriticalDamage(mech.state.config,mech.critical_damage)
                    [bin.location]?.includes(bin.slot))};
            })),
          ledger:ledger.rows.map(e=>({amount:Number(e.change_amount),
            reason:e.reason,createdAt:e.created_at}))};
      });
    },
    purchase(owner,body){
      if(!body||typeof body!=='object'||Array.isArray(body)||
         Object.keys(body).some(k=>!['sku','quantity'].includes(k))||
         !Number.isInteger(body.quantity)||body.quantity<1||body.quantity>10)
        throw new AuthError(422,'invalid_purchase');
      const item=[...CATALOG,...EQUIPMENT_CATALOG].find(c=>c.sku===body.sku);
      if(!item)throw new AuthError(422,'invalid_purchase');
      return inTransaction(pool,async c=>{
        await changeCredits(c,owner,-item.price*body.quantity,
          'Закупка: '+item.name,'supply:'+randomUUID());
        const isWeapon=['weapon','ammo','system'].includes(item.kind);
        const result=isWeapon?await c.query(
          'INSERT INTO commander_equipment(commander_id,equipment_type,quantity) '+
          'VALUES($1,$2,$3) ON CONFLICT(commander_id,equipment_type) DO UPDATE SET '+
          'quantity=commander_equipment.quantity+EXCLUDED.quantity RETURNING quantity',
          [owner,item.kind==='weapon'?item.name:item.sku,body.quantity]):await c.query(
          'INSERT INTO commander_supplies(commander_id,sku,quantity) '+
          'VALUES($1,$2,$3) ON CONFLICT(commander_id,sku) DO UPDATE SET '+
          'quantity=commander_supplies.quantity+EXCLUDED.quantity RETURNING quantity',
          [owner,item.sku,body.quantity]);
        return {sku:item.sku,quantity:result.rows[0].quantity,spent:item.price*body.quantity};
      });
    },
    buyMech(owner,body){
      if(!body||typeof body!=='object'||Array.isArray(body)||
         Object.keys(body).length!==1||typeof body.offerId!=='string')
        throw new AuthError(422,'invalid_mech_offer');
      const offer=MECH_OFFERS.find(item=>item.id===body.offerId);
      if(!offer)throw new AuthError(422,'invalid_mech_offer');
      return inTransaction(pool,async c=>{
        await ensureWallet(c,owner);
        const count=await c.query('SELECT count(*)::int AS count FROM hangar_mechs WHERE commander_id=$1',[owner]);
        if(count.rows[0].count>=50)throw new AuthError(409,'hangar_full');
        await changeCredits(c,owner,-offer.price,
          'Покупка меха: '+offer.name,'mech-purchase:'+randomUUID());
        const newMech=await c.query(
          'INSERT INTO hangar_mechs(commander_id,chassis,state,market_owned) '+
          'VALUES($1,$2,$3::jsonb,true) RETURNING id,chassis',
          [owner,offer.name,JSON.stringify({version:1,config:offer.config})]);
        return {id:newMech.rows[0].id,chassis:newMech.rows[0].chassis,spent:offer.price};
      });
    },
    reload(owner,body){
      if(!body||typeof body!=='object'||Array.isArray(body)||
         Object.keys(body).length!==3||!UUID.test(body.mechId)||
         !['HD','CT','LT','RT','LA','RA','LL','RL'].includes(body.location)||
         !Number.isInteger(body.slot)||body.slot<1||body.slot>12)
        throw new AuthError(422,'invalid_reload');
      return inTransaction(pool,async c=>{
        // Lock commander first to follow operation creation ordering, then mech.
        await c.query('SELECT id FROM commanders WHERE id=$1 FOR UPDATE',[owner]);
        const r=await c.query('SELECT id,chassis,state,ammo_state,critical_damage,wrecked,armor_damage,structure_damage,market_owned '+
          'FROM hangar_mechs WHERE id=$1 AND commander_id=$2 FOR UPDATE',[body.mechId,owner]);
        if(!r.rows.length)throw new AuthError(404,'mech_not_found');
        const mech=r.rows[0];
        if(!mech.market_owned)throw new AuthError(409,'prototype_not_licensed');
        if(mech.wrecked||mech.armor_damage||mech.structure_damage)
          throw new AuthError(409,'mech_needs_repair');
        const active=await c.query(
          "SELECT 1 FROM combat_operations WHERE commander_id=$1 "+
          "AND status IN ('draft','active') AND roster @> $2::jsonb LIMIT 1",
          [owner,JSON.stringify([{mechId:body.mechId}])]);
        if(active.rows.length)throw new AuthError(409,'mech_assigned_operation');
        if(construct(mech.state.config).errors.length)throw new AuthError(409,'invalid_design');
        const bin=ammoBinsFor(mech.state.config).find(e=>
          e.location===body.location&&e.slot===body.slot-1);
        if(!bin||!AMMO_PACKS[bin.weapon])
          throw new AuthError(422,'invalid_reload');
        const levels=normalizedAmmoState(mech.state.config,mech.ammo_state);
        if(levels[bin.key]>=bin.capacity)throw new AuthError(409,'magazine_full');
        if(normalizedCriticalDamage(mech.state.config,mech.critical_damage)
          [bin.location]?.includes(bin.slot))
          throw new AuthError(409,'magazine_damaged');
        const sku='ammo:'+bin.weapon;
        const spent=await c.query('UPDATE commander_equipment '+
          'SET quantity=quantity-1 WHERE commander_id=$1 AND equipment_type=$2 '+
          'AND quantity>0 RETURNING quantity',[owner,sku]);
        if(!spent.rows.length)throw new AuthError(409,'insufficient_ammo');
        levels[bin.key]=bin.capacity;
        await c.query('UPDATE hangar_mechs SET ammo_state=$3::jsonb '+
          'WHERE id=$1 AND commander_id=$2',
          [body.mechId,owner,JSON.stringify(levels)]);
        return {mechId:body.mechId,location:bin.location,
          slot:body.slot,weapon:bin.weapon,rounds:bin.capacity,spent:0};
      });
    },
    repairComponent(owner,body){
      if(!body||typeof body!=='object'||Array.isArray(body)||
         Object.keys(body).length!==2||typeof body.mechId!=='string'||
         !UUID.test(body.mechId)||typeof body.partId!=='string'||
         body.partId.length>80)
        throw new AuthError(422,'invalid_component_repair');
      return inTransaction(pool,async c=>{
        await c.query('SELECT id FROM commanders WHERE id=$1 FOR UPDATE',[owner]);
        const selected=await c.query(
          'SELECT id,chassis,state,critical_damage,ammo_state,market_owned '+
          'FROM hangar_mechs WHERE id=$1 AND commander_id=$2 FOR UPDATE',
          [body.mechId,owner]);
        if(!selected.rows.length)throw new AuthError(404,'mech_not_found');
        const mech=selected.rows[0];
        if(!mech.market_owned)throw new AuthError(409,'prototype_not_licensed');
        const pending=await c.query(
          "SELECT 1 FROM combat_operations WHERE commander_id=$1 "+
          "AND status IN ('draft','active') AND roster @> $2::jsonb LIMIT 1",
          [owner,JSON.stringify([{mechId:body.mechId}])]);
        if(pending.rows.length)throw new AuthError(409,'mech_assigned_operation');
        const config=mech.state?.config;
        if(!config||construct(config).errors.length)
          throw new AuthError(409,'invalid_design');
        const failure=damagedComponents(config,mech.critical_damage)
          .find(item=>item.id===body.partId);
        if(!failure)throw new AuthError(409,'component_not_damaged');
        if(failure.sku){
          const consumed=await c.query(
            'UPDATE commander_equipment SET quantity=quantity-1 '+
            'WHERE commander_id=$1 AND equipment_type=$2 AND quantity>0 RETURNING quantity',
            [owner,failure.sku]);
          if(!consumed.rows.length)throw new AuthError(409,'insufficient_equipment');
        }else if(failure.serviceCost){
          await changeCredits(c,owner,-failure.serviceCost,
            'Восстановление: '+failure.name+' / '+mech.chassis,
            'component-repair:'+randomUUID());
        }else throw new AuthError(422,'unsupported_component_repair');
        const state=normalizedCriticalDamage(config,mech.critical_damage);
        for(const {location,slot} of failure.slots){
          state[location]=(state[location]||[]).filter(i=>i!==slot-1);
          if(!state[location].length)delete state[location];
        }
        const ammo=normalizedAmmoState(config,mech.ammo_state);
        if(failure.kind==='ammo'){
          const bin=ammoBinsFor(config).find(b=>
            b.location===failure.location&&b.slot===failure.slot-1);
          if(!bin)throw new AuthError(409,'invalid_magazine');
          ammo[bin.key]=bin.capacity;
        }
        await c.query(
          'UPDATE hangar_mechs SET critical_damage=$3::jsonb,ammo_state=$4::jsonb '+
          'WHERE id=$1 AND commander_id=$2',
          [body.mechId,owner,JSON.stringify(state),JSON.stringify(ammo)]);
        return {mechId:body.mechId,partId:failure.id,name:failure.name,
          sku:failure.sku,spent:failure.serviceCost,remaining:
            damagedComponents(config,state).length};
      });
    },
    repair(owner,body){
      if(!body||typeof body!=='object'||Array.isArray(body)||
         Object.keys(body).length!==1||typeof body.mechId!=='string'||!UUID.test(body.mechId))
        throw new AuthError(422,'invalid_repair');
      return inTransaction(pool,async c=>{
        await ensureWallet(c,owner);
        const rows=await c.query('SELECT id,chassis,armor_damage,structure_damage,wrecked '+
          'FROM hangar_mechs WHERE id=$1 AND commander_id=$2 FOR UPDATE',[body.mechId,owner]);
        if(!rows.rows.length)throw new AuthError(404,'mech_not_found');
        const quote=repairQuote(rows.rows[0],await stockFor(c,owner));
        if(!quote.needsRepair)throw new AuthError(409,'mech_undamaged');
        if(quote.creditCost)
          await changeCredits(c,owner,-quote.creditCost,'Ремонт: '+rows.rows[0].chassis,
            'repair:'+randomUUID());
        for(const [sku,used] of [['armor_patch',quote.armorPatches],
                                  ['structure_kit',quote.structureKits]]){
          if(used)await c.query('UPDATE commander_supplies SET quantity=quantity-$3 '+
            'WHERE commander_id=$1 AND sku=$2 AND quantity>=$3',[owner,sku,used]);
        }
        await c.query('UPDATE hangar_mechs SET armor_damage=0,structure_damage=0,wrecked=false '+
          'WHERE id=$1 AND commander_id=$2',[body.mechId,owner]);
        return {mechId:body.mechId,spent:quote.creditCost,
          armorPatches:quote.armorPatches,structureKits:quote.structureKits};
      });
    }
  };
}

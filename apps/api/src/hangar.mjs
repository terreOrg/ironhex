import { construct } from '../../../packages/engine/construction.js';
import {weaponCounts} from './market.mjs';
import {ammoBinsFor,normalizedAmmoState,systemCounts} from '../../../packages/engine/equipment.js';
import {normalizedCriticalDamage,damagedComponents} from
  '../../../packages/engine/component-damage.js';
import {outOfBookEquipment} from '../../../packages/engine/rulebook.js';
import { AuthError } from './auth.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowed = new Set(['name','tonnage','walk','jump','sinks','armor','rear','equipment','removeActuators']);

export function validateDesign(input) {
  const c = input?.config;
  if (!c || typeof c !== 'object' || Array.isArray(c) ||
      !Object.keys(c).every(key=>allowed.has(key)) ||
      typeof c.name !== 'string' || c.name.trim().length < 1 || c.name.trim().length > 30 ||
      !Array.isArray(c.equipment) || c.equipment.length > 80 ||
      c.equipment.some(e=>!e||typeof e!=='object'||Array.isArray(e)) ||
      !c.armor || typeof c.armor !== 'object' || Array.isArray(c.armor) ||
      !c.rear || typeof c.rear !== 'object' || Array.isArray(c.rear) ||
      (c.removeActuators && (!Array.isArray(c.removeActuators) ||
         c.removeActuators.length > 2 || c.removeActuators.some(l=>!['LA','RA'].includes(l))))) {
    throw new AuthError(422,'invalid_design');
  }
  if (JSON.stringify(c).length > 6400) throw new AuthError(422,'invalid_design');
  let result;
  try { result = construct(c); }
  catch { throw new AuthError(422,'invalid_design'); }
  if (result.errors.length || !Number.isFinite(result.total) ||
      !Number.isFinite(result.remaining) || result.remaining < -0.001) {
    throw new AuthError(422,'invalid_design');
  }
  if(outOfBookEquipment(c).length)
    throw new AuthError(422,'unsupported_rulebook_equipment');
  const callsign = input.callsign == null || input.callsign === '' ? null : input.callsign;
  if (callsign != null && (typeof callsign !== 'string' ||
      callsign.trim().length > 40 || callsign.trim().length < 1 ||
      /[\u0000-\u001f\u007f]/.test(callsign))) {
    throw new AuthError(422,'invalid_callsign');
  }
  return {
    chassis:c.name.trim(),
    callsign:callsign?.trim() || null,
    state:{version:1,config:structuredClone(c)}
  };
}

function serialize(row) {
  return {id:row.id, chassis:row.chassis, callsign:row.callsign,
    state:row.state, createdAt:row.created_at,
    armorDamage:row.armor_damage||0,structureDamage:row.structure_damage||0,
    wrecked:!!row.wrecked,marketOwned:!!row.market_owned,
    ammoState:row.ammo_state||{},criticalDamage:row.critical_damage||{},
    brokenComponents:row.state?.config?
      damagedComponents(row.state.config,row.critical_damage):[]};
}

export function createHangarStore(pool) {
  return {
    async list(commanderId) {
      const result=await pool.query(
        'SELECT id,chassis,callsign,state,created_at,armor_damage,structure_damage,wrecked,market_owned,ammo_state,critical_damage FROM hangar_mechs ' +
        'WHERE commander_id=$1 ORDER BY created_at DESC LIMIT 100',
        [commanderId]
      );
      return result.rows.map(serialize);
    },
    async create(commanderId,input) {
      const design=validateDesign(input);
      const result=await pool.query(
        'INSERT INTO hangar_mechs(commander_id,chassis,callsign,state,market_owned) ' +
        'SELECT $1,$2,$3,$4::jsonb,false WHERE ' +
        '(SELECT count(*) FROM hangar_mechs WHERE commander_id=$1) < 50 ' +
        'RETURNING id,chassis,callsign,state,created_at,armor_damage,structure_damage,wrecked,market_owned,ammo_state,critical_damage',
        [commanderId,design.chassis,design.callsign,JSON.stringify(design.state)]
      );
      if (!result.rows.length) throw new AuthError(409,'hangar_full');
      return serialize(result.rows[0]);
    },
    async update(commanderId,id,input) {
      if (!UUID.test(id))throw new AuthError(404,'mech_not_found');
      const design=validateDesign(input);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query('SELECT id FROM commanders WHERE id=$1 FOR UPDATE',[commanderId]);
        const result=await client.query(
          'SELECT * FROM hangar_mechs WHERE id=$1 AND commander_id=$2 FOR UPDATE',
          [id,commanderId]);
        if(!result.rows.length)throw new AuthError(404,'mech_not_found');
        const row=result.rows[0];
        // Active mission rosters are snapshots and cannot be refitted mid-sortie.
        const active=await client.query(
          "SELECT 1 FROM combat_operations WHERE commander_id=$1 " +
          "AND status IN ('draft','active') AND roster @> $2::jsonb LIMIT 1",
          [commanderId,JSON.stringify([{mechId:id}])]);
        if(active.rows.length)throw new AuthError(409,'mech_assigned_operation');
        if(row.market_owned){
          if(row.wrecked||row.armor_damage||row.structure_damage)
            throw new AuthError(409,'mech_needs_repair');
          if(Object.keys(normalizedCriticalDamage(row.state.config,row.critical_damage)).length)
            throw new AuthError(409,'mech_needs_component_repair');
          const old=row.state.config,now=design.state.config;
          const same=(l,r)=>JSON.stringify(l)===JSON.stringify(r);
          for(const key of ['tonnage','walk','armor','rear']){
            if(!same(old[key],now[key]))
              throw new AuthError(409,'factory_frame_locked');
          }
          if(!same([...(old.removeActuators||[])].sort(),
                   [...(now.removeActuators||[])].sort()))
            throw new AuthError(409,'factory_frame_locked');
          // The shared combat registry models jump MP, cooling and hatchet
          // attacks. Count those real systems alongside weapons so refits
          // must spend/return owned components, never conjure them for free.
          const previous=new Map([...weaponCounts(old),...systemCounts(old)]);
          const next=new Map([...weaponCounts(now),...systemCounts(now)]);
          for(const name of new Set([...previous.keys(),...next.keys()])){
            const delta=(next.get(name)||0)-(previous.get(name)||0);
            if(delta>0){
              const updated=await client.query(
                'UPDATE commander_equipment SET quantity=quantity-$3 '+
                'WHERE commander_id=$1 AND equipment_type=$2 AND quantity>=$3 RETURNING quantity',
                [commanderId,name,delta]);
              if(!updated.rows.length)throw new AuthError(409,'insufficient_equipment');
            }else if(delta<0){
              await client.query(
                'INSERT INTO commander_equipment(commander_id,equipment_type,quantity) '+
                'VALUES($1,$2,$3) ON CONFLICT(commander_id,equipment_type) '+
                'DO UPDATE SET quantity=commander_equipment.quantity+EXCLUDED.quantity',
                [commanderId,name,-delta]);
            }
          }
        }
        const before=ammoBinsFor(row.state.config);
        const after=ammoBinsFor(design.state.config);
        const previous=normalizedAmmoState(row.state.config,row.ammo_state);
        const existing=new Map(before.map(bin=>[bin.key,bin]));
        const levels={};
        for(const bin of after){
          const prior=existing.get(bin.key);
          if(prior?.weapon===bin.weapon&&prior.capacity===bin.capacity){
            levels[bin.key]=previous[bin.key];
          }else{
            if(row.market_owned){
              const spent=await client.query('UPDATE commander_equipment '+
                'SET quantity=quantity-1 WHERE commander_id=$1 AND equipment_type=$2 '+
                'AND quantity>0 RETURNING quantity',
                [commanderId,'ammo:'+bin.weapon]);
              if(!spent.rows.length)throw new AuthError(409,'insufficient_ammo');
            }
            levels[bin.key]=bin.capacity;
          }
        }
        const changed=await client.query(
          'UPDATE hangar_mechs SET chassis=$3,callsign=$4,state=$5::jsonb,ammo_state=$6::jsonb '+
          'WHERE id=$1 AND commander_id=$2 '+
          'RETURNING id,chassis,callsign,state,created_at,armor_damage,structure_damage,wrecked,market_owned,ammo_state,critical_damage',
          [id,commanderId,design.chassis,design.callsign,
            JSON.stringify(design.state),JSON.stringify(levels)]);
        await client.query('COMMIT');
        return serialize(changed.rows[0]);
      }catch(error){
        await client.query('ROLLBACK');throw error;
      }finally{client.release();}
    },
    async remove(commanderId,id) {
      if (!UUID.test(id)) throw new AuthError(404,'mech_not_found');
      const result=await pool.query(
        'DELETE FROM hangar_mechs WHERE id=$1 AND commander_id=$2 RETURNING id',
        [id,commanderId]
      );
      if (!result.rows.length) throw new AuthError(404,'mech_not_found');
    }
  };
}

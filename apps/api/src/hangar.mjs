import { construct } from '../../../packages/engine/construction.js';
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
    state:row.state, createdAt:row.created_at};
}

export function createHangarStore(pool) {
  return {
    async list(commanderId) {
      const result=await pool.query(
        'SELECT id,chassis,callsign,state,created_at FROM hangar_mechs ' +
        'WHERE commander_id=$1 ORDER BY created_at DESC LIMIT 100',
        [commanderId]
      );
      return result.rows.map(serialize);
    },
    async create(commanderId,input) {
      const design=validateDesign(input);
      const result=await pool.query(
        'INSERT INTO hangar_mechs(commander_id,chassis,callsign,state) ' +
        'SELECT $1,$2,$3,$4::jsonb WHERE ' +
        '(SELECT count(*) FROM hangar_mechs WHERE commander_id=$1) < 50 ' +
        'RETURNING id,chassis,callsign,state,created_at',
        [commanderId,design.chassis,design.callsign,JSON.stringify(design.state)]
      );
      if (!result.rows.length) throw new AuthError(409,'hangar_full');
      return serialize(result.rows[0]);
    },
    async update(commanderId,id,input) {
      if (!UUID.test(id)) throw new AuthError(404,'mech_not_found');
      const design=validateDesign(input);
      const result=await pool.query(
        'UPDATE hangar_mechs SET chassis=$3,callsign=$4,state=$5::jsonb ' +
        'WHERE id=$1 AND commander_id=$2 ' +
        'RETURNING id,chassis,callsign,state,created_at',
        [id,commanderId,design.chassis,design.callsign,JSON.stringify(design.state)]
      );
      if (!result.rows.length) throw new AuthError(404,'mech_not_found');
      return serialize(result.rows[0]);
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

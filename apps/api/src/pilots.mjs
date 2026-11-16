import {AuthError} from './auth.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FACTIONS=new Set([
  'mercenary','independent','federated_suns','draconis_combine',
  'lyran_commonwealth','capellan_confederation','free_worlds_league','clan'
]);
const EDIT_FIELDS=new Set(['fullName','callsign','faction','portrait']);
export function validatePilot(input) {
  if (!input || typeof input!=='object' || Array.isArray(input) ||
      !Object.keys(input).every(key=>EDIT_FIELDS.has(key)))
    throw new AuthError(422,'invalid_pilot');
  const {fullName,callsign,faction='mercenary',portrait=1}=input;
  if(typeof fullName!=='string'||typeof callsign!=='string' ||
     fullName.trim().length<2||fullName.trim().length>60 ||
     callsign.trim().length<2||callsign.trim().length>28 ||
     /[\u0000-\u001f\u007f<>]/.test(fullName+callsign) ||
     !FACTIONS.has(faction)||!Number.isInteger(portrait)||portrait<1||portrait>8)
    throw new AuthError(422,'invalid_pilot');
  return {fullName:fullName.trim(),callsign:callsign.trim(),faction,portrait};
}
function clean(row) {
  return {
    id:row.id,fullName:row.full_name,callsign:row.callsign,
    faction:row.faction,portrait:row.portrait,rank:row.rank,
    gunnery:row.gunnery,piloting:row.piloting,experience:row.experience,
    battles:row.battles,wins:row.wins,losses:row.losses,kills:row.kills,
    wounds:row.wounds,assignedMechId:row.assigned_mech_id||null,
    assignedChassis:row.assigned_chassis||null,createdAt:row.created_at
  };
}
const SELECT='SELECT p.*,m.id AS assigned_mech_id,m.chassis AS assigned_chassis '+
  'FROM mechwarrior_pilots p LEFT JOIN hangar_mechs m ON m.pilot_id=p.id '+
  'AND m.commander_id=$1 WHERE p.commander_id=$1 ';
export function createPilotStore(pool) {
  return {
    async list(owner) {
      const result=await pool.query(SELECT+'ORDER BY p.created_at,p.id LIMIT 50',[owner]);
      return result.rows.map(clean);
    },
    async create(owner,input) {
      const {fullName,callsign,faction,portrait}=validatePilot(input);
      const result=await pool.query(
        'INSERT INTO mechwarrior_pilots(commander_id,full_name,callsign,faction,portrait) '+
        'SELECT $1,$2,$3,$4,$5 WHERE (SELECT count(*) FROM mechwarrior_pilots '+
        'WHERE commander_id=$1) < 24 RETURNING id',
        [owner,fullName,callsign,faction,portrait]
      );
      if(!result.rows.length) throw new AuthError(409,'roster_full');
      return this.get(owner,result.rows[0].id);
    },
    async get(owner,id) {
      if(!UUID.test(id||'')) throw new AuthError(404,'pilot_not_found');
      const result=await pool.query(SELECT+'AND p.id=$2',[owner,id]);
      if(!result.rows.length) throw new AuthError(404,'pilot_not_found');
      return clean(result.rows[0]);
    },
    async update(owner,id,input) {
      if(!UUID.test(id||'')) throw new AuthError(404,'pilot_not_found');
      const {fullName,callsign,faction,portrait}=validatePilot(input);
      const result=await pool.query(
        'UPDATE mechwarrior_pilots SET full_name=$3,callsign=$4,faction=$5,portrait=$6 '+
        'WHERE commander_id=$1 AND id=$2 RETURNING id',
        [owner,id,fullName,callsign,faction,portrait]
      );
      if(!result.rows.length) throw new AuthError(404,'pilot_not_found');
      return this.get(owner,id);
    },
    async remove(owner,id) {
      if(!UUID.test(id||'')) throw new AuthError(404,'pilot_not_found');
      const result=await pool.query(
        'DELETE FROM mechwarrior_pilots WHERE commander_id=$1 AND id=$2 RETURNING id',
        [owner,id]
      );
      if(!result.rows.length) throw new AuthError(404,'pilot_not_found');
      return {ok:true};
    },
    async history(owner,id) {
      await this.get(owner,id);
      const result=await pool.query(
        'SELECT id,mech_chassis,result,xp_awarded,kills,created_at '+
        'FROM pilot_battle_history WHERE commander_id=$1 AND pilot_id=$2 '+
        'ORDER BY created_at DESC,id DESC LIMIT 50',[owner,id]
      );
      return result.rows.map(row=>({
        id:String(row.id),mechChassis:row.mech_chassis,result:row.result,
        experience:row.xp_awarded,kills:row.kills,createdAt:row.created_at
      }));
    },
    async assign(owner,mechId,pilotId) {
      if(!UUID.test(mechId||'')||(pilotId!==null&&!UUID.test(pilotId||'')))
        throw new AuthError(422,'invalid_assignment');
      try {
        const result=await pool.query(
          'UPDATE hangar_mechs m SET pilot_id=$3::uuid '+
          'WHERE m.commander_id=$1 AND m.id=$2 AND '+
          '($3::uuid IS NULL OR EXISTS(SELECT 1 FROM mechwarrior_pilots p '+
          'WHERE p.id=$3::uuid AND p.commander_id=$1)) RETURNING m.id',
          [owner,mechId,pilotId]
        );
        if(!result.rows.length) throw new AuthError(404,'assignment_not_found');
        return {ok:true,mechId,pilotId};
      }catch(error) {
        if(error.code==='23505') throw new AuthError(409,'pilot_already_assigned');
        throw error;
      }
    }
  };
}

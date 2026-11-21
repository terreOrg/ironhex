import {AuthError} from './auth.mjs';
import {newScenarioRoomGame,captureScenarioRoomGame,restoreScenarioRoomGame,
 applyScenarioRoomSetup,applyScenarioRoomOrder,publicScenarioRoomGame,
 assertScenario3SourceMap} from
 './scenario-room-match.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE=/^[a-zA-Z0-9_-]{3,24}$/;
const ROLES=Object.freeze(['attacker','command','recon']);
const COLUMN={attacker:'attacker_id',command:'command_id',recon:'recon_id'};
const FLAG={attacker:'accepted_attacker',command:'accepted_command',recon:'accepted_recon'};
const ROOM_SQL=[
 'SELECT r.*, a.handle AS attacker_handle,',
 'c.handle AS command_handle, n.handle AS recon_handle',
 'FROM agoac_scenario_rooms r',
 'JOIN commanders a ON a.id=r.attacker_id',
 'JOIN commanders c ON c.id=r.command_id',
 'JOIN commanders n ON n.id=r.recon_id'
].join(' ');
const roomId=id=>{
 if(typeof id!=='string'||!UUID.test(id))throw new AuthError(404,'scenario_room_not_found');
 return id;
};
export function validateScenarioRoomInvite(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).length!==1||!input.roles||
  typeof input.roles!=='object'||Array.isArray(input.roles)||
  Object.keys(input.roles).length!==3||
  Object.keys(input.roles).some(k=>!ROLES.includes(k)))
  throw new AuthError(422,'invalid_scenario_room');
 const roles={};
 for(const key of ROLES){
  const value=input.roles[key];
  if(typeof value!=='string'||!HANDLE.test(value.trim()))
   throw new AuthError(422,'invalid_scenario_room');
  roles[key]=value.trim().toLowerCase();
 }
 if(new Set(Object.values(roles)).size!==3)
  throw new AuthError(422,'scenario_players_must_be_distinct');
 return roles;
}
export function scenarioRoleForUser(row,userId){
 if(!row||typeof userId!=='string'||!UUID.test(userId))return null;
 return ROLES.find(k=>row[COLUMN[k]]===userId)||null;
}
function publicRoom(row,viewer){
 const role=scenarioRoleForUser(row,viewer);
 if(!role)throw new AuthError(404,'scenario_room_not_found');
 return {id:row.id,scenarioId:'divide-and-conquer',status:row.status,version:row.version,
  yourRole:role,isHost:row.created_by===viewer,
  roles:Object.fromEntries(ROLES.map(k=>[k,{
   handle:row[k+'_handle'],accepted:row[FLAG[k]]===true
  }])),createdAt:row.created_at};
}
async function tx(pool,operation){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const value=await operation(client);
  await client.query('COMMIT');
  return value;
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();}
}
export function createScenarioRoomStore(pool){
 const read=async(db,id)=>{const r=await db.query(ROOM_SQL+' WHERE r.id=$1',[id]);return r.rows[0];};
 async function changed(actor,id,action){
  roomId(id);
  return tx(pool,async client=>{
   const result=await client.query('SELECT * FROM agoac_scenario_rooms WHERE id=$1 FOR UPDATE',[id]);
   const row=result.rows[0],role=scenarioRoleForUser(row,actor);
   if(!role)throw new AuthError(404,'scenario_room_not_found');
   if(action==='accept'){
    if(row.status==='ready'&&row[FLAG[role]])return publicRoom(await read(client,id),actor);
    if(row.status!=='inviting')throw new AuthError(409,'scenario_room_closed');
    if(!row[FLAG[role]]){
     const ready=ROLES.every(k=>k===role||row[FLAG[k]]===true);
     await client.query('UPDATE agoac_scenario_rooms SET '+FLAG[role]+
      '=true,status=$2,version=version+1 WHERE id=$1',[id,ready?'ready':'inviting']);
    }
   }else{
    if(action==='cancel'&&row.created_by!==actor)
     throw new AuthError(403,'scenario_not_host');
    if(action==='decline'&&row.created_by===actor)
     throw new AuthError(409,'scenario_room_closed');
    if(action==='decline'&&row.status!=='inviting'||
       action==='cancel'&&!['inviting','ready'].includes(row.status))
     throw new AuthError(409,'scenario_room_closed');
    await client.query("UPDATE agoac_scenario_rooms SET status='cancelled',version=version+1 WHERE id=$1",[id]);
   }
   return publicRoom(await read(client,id),actor);
  });
 }
 async function updateBattle(actor,id,input,kind){
  roomId(id);
  if(!input||typeof input!=='object'||Array.isArray(input)||
   Object.keys(input).length!==2||
   !Object.hasOwn(input,'version')||!Object.hasOwn(input,'action')||
   !Number.isInteger(input.version)||input.version<0||
   !input.action||typeof input.action!=='object'||Array.isArray(input.action))
   throw new AuthError(422,'invalid_scenario_command');
  return tx(pool,async client=>{
   const locked=await client.query(
    'SELECT * FROM agoac_scenario_rooms WHERE id=$1 FOR UPDATE',[id]);
   const row=locked.rows[0],role=scenarioRoleForUser(row,actor);
   if(!role)throw new AuthError(404,'scenario_room_not_found');
   if(row.status!=='active'||!row.battle_state)
    throw new AuthError(409,'scenario_match_not_active');
   if(row.version!==input.version)
    throw new AuthError(409,'stale_scenario_version');
   const {game,rng}=restoreScenarioRoomGame(row.battle_state);
   const effect=kind==='setup'?
    applyScenarioRoomSetup(game,role,input.action):
    applyScenarioRoomOrder(game,role,input.action);
   const saved=captureScenarioRoomGame(game,rng);
   await client.query('UPDATE agoac_scenario_rooms SET '+
    'status=$2,battle_state=$3::jsonb,version=version+1 WHERE id=$1',
    [id,game.winner!==null?'finished':'active',JSON.stringify(saved)]);
   return {item:publicRoom(await read(client,id),actor),
    game:publicScenarioRoomGame(saved),effect};
  });
 }
 return {
  async create(actor,input){
   if(!UUID.test(actor||''))throw new AuthError(401,'unauthorized');
   const roles=validateScenarioRoomInvite(input);
   return tx(pool,async client=>{
    const mine=await client.query('SELECT id,handle FROM commanders WHERE id=$1 FOR UPDATE',[actor]);
    if(!mine.rows.length)throw new AuthError(401,'unauthorized');
    if(!Object.values(roles).includes(mine.rows[0].handle.toLowerCase()))
     throw new AuthError(422,'scenario_owner_must_participate');
    const found=await client.query(
     'SELECT id,handle FROM commanders WHERE lower(handle)=ANY($1::text[])',
     [Object.values(roles)]);
    if(found.rows.length!==3)throw new AuthError(422,'scenario_player_not_found');
    const ids=Object.fromEntries(ROLES.map(k=>[k,
     found.rows.find(x=>x.handle.toLowerCase()===roles[k])?.id]));
    if(ROLES.some(k=>!UUID.test(ids[k]||''))||new Set(Object.values(ids)).size!==3)
     throw new AuthError(422,'scenario_players_must_be_distinct');
    const open=await client.query("SELECT count(*)::int AS total FROM agoac_scenario_rooms "+
     "WHERE created_by=$1 AND status IN ('inviting','ready','active')",[actor]);
    if(Number(open.rows[0]?.total)>=10)throw new AuthError(409,'scenario_room_limit');
    const inserted=await client.query(
     'INSERT INTO agoac_scenario_rooms '+
     '(created_by,attacker_id,command_id,recon_id,'+
     'accepted_attacker,accepted_command,accepted_recon) '+
     'VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
     [actor,ids.attacker,ids.command,ids.recon,
      ...ROLES.map(k=>ids[k]===actor)]);
    return publicRoom(await read(client,inserted.rows[0].id),actor);
   });
  },
  async list(actor){
   if(!UUID.test(actor||''))throw new AuthError(401,'unauthorized');
   const result=await pool.query(ROOM_SQL+
    ' WHERE r.attacker_id=$1 OR r.command_id=$1 OR r.recon_id=$1 '+
    'ORDER BY r.created_at DESC,r.id DESC LIMIT 100',[actor]);
   return result.rows.map(row=>publicRoom(row,actor));
  },
  async get(actor,id){
   roomId(id);
   const row=await read(pool,id);
   if(!row)throw new AuthError(404,'scenario_room_not_found');
   return publicRoom(row,actor);
  },
  accept:(actor,id)=>changed(actor,id,'accept'),
  decline:(actor,id)=>changed(actor,id,'decline'),
  cancel:(actor,id)=>changed(actor,id,'cancel'),
  async start(actor,id,input){
   roomId(id);
   if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['version','shortened'].includes(k))||
    !Number.isInteger(input.version)||input.version<0||
    (input.shortened!==undefined&&typeof input.shortened!=='boolean'))
    throw new AuthError(422,'invalid_scenario_match');
   return tx(pool,async client=>{
    const locked=await client.query(
     'SELECT * FROM agoac_scenario_rooms WHERE id=$1 FOR UPDATE',[id]);
    const row=locked.rows[0],seat=scenarioRoleForUser(row,actor);
    if(!seat)throw new AuthError(404,'scenario_room_not_found');
    if(row.created_by!==actor)throw new AuthError(403,'scenario_not_host');
    if(row.status!=='ready'||!ROLES.every(k=>row[FLAG[k]]))
     throw new AuthError(409,'scenario_room_not_ready');
    if(row.version!==input.version)throw new AuthError(409,'stale_scenario_version');
    const session=newScenarioRoomGame({shortened:input.shortened??false});
    const saved=captureScenarioRoomGame(session.game,session.rng);
    await client.query(
     "UPDATE agoac_scenario_rooms SET status='active',battle_state=$2::jsonb,version=version+1 WHERE id=$1",
     [id,JSON.stringify(saved)]);
    return {item:publicRoom(await read(client,id),actor),
     game:publicScenarioRoomGame(saved)};
   });
  },
  async snapshot(actor,id){
   roomId(id);
   const row=await read(pool,id);
   const seat=scenarioRoleForUser(row,actor);
   if(!seat)throw new AuthError(404,'scenario_room_not_found');
   if(!row.battle_state)throw new AuthError(409,'scenario_match_not_started');
   assertScenario3SourceMap(row.battle_state.game);
   return {item:publicRoom(row,actor),
    game:publicScenarioRoomGame(row.battle_state)};
  },
  async setup(actor,id,input){
   return updateBattle(actor,id,input,'setup');
  },
  async command(actor,id,input){
   return updateBattle(actor,id,input,'command');
  }
 };
}

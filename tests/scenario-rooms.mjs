import assert from 'node:assert/strict';
import {once} from 'node:events';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {AuthError} from '../apps/api/src/auth.mjs';
import {validateScenarioRoomInvite,scenarioRoleForUser} from '../apps/api/src/scenario-rooms.mjs';
import {createHttpServer} from '../apps/api/src/http.mjs';
const users={
 attacker:'11111111-1111-4111-8111-111111111111',
 command:'22222222-2222-4222-8222-222222222222',
 recon:'33333333-3333-4333-8333-333333333333'
};
const roomId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('CAT3500D p.48: three distinct server identities for attacker, command and recon',()=>{
 assert.deepEqual(validateScenarioRoomInvite({roles:{
  attacker:'ATTACK_One',command:'Command_One',recon:'Recon_One'}}),
  {attacker:'attack_one',command:'command_one',recon:'recon_one'});
 for(const input of [null,{},[],{roles:{attacker:'a',command:'commander',recon:'recon'}},
  {roles:{attacker:'foo',command:'FOO',recon:'bar'}},
  {roles:{attacker:'foo',command:'bar',recon:'baz',admin:'x'}},
  {roles:{attacker:'foo',command:'bar',recon:'baz'},owner:'spoof'}])
  assert.throws(()=>validateScenarioRoomInvite(input),AuthError);
 const row={attacker_id:users.attacker,command_id:users.command,recon_id:users.recon};
 for(const [role,id]of Object.entries(users))
  assert.equal(scenarioRoleForUser(row,id),role);
 assert.equal(scenarioRoleForUser(row,'44444444-4444-4444-8444-444444444444'),null);
 assert.equal(scenarioRoleForUser(null,users.command),null);
 const ddl=readFileSync(new URL('../apps/api/src/db.mjs',import.meta.url),'utf8');
 assert(ddl.includes('agoac_scenario_rooms'));
 assert(ddl.includes('attacker_id<>command_id AND attacker_id<>recon_id AND command_id<>recon_id'));
 assert(ddl.includes('created_by IN (attacker_id,command_id,recon_id)'));
});

test('CAT3500D p.48: invite and acceptance API use authenticated sessions, never a forged actor',async()=>{
 const tokens={a:'a'.repeat(64),b:'b'.repeat(64),c:'c'.repeat(64)};
 const accounts=new Map([[tokens.a,{id:users.attacker,emailVerified:true}],
  [tokens.b,{id:users.command,emailVerified:true}],
  [tokens.c,{id:users.recon,emailVerified:true}]]);
 const calls=[],room={id:roomId,status:'inviting',yourRole:'attacker'};
 const stub={
  async create(actor,body){calls.push(['create',actor,body]);return room;},
  async list(actor){calls.push(['list',actor]);return [];},
  async get(actor,id){calls.push(['get',actor,id]);return room;},
  async accept(actor,id){calls.push(['accept',actor,id]);return {...room,status:'ready'};},
  async decline(actor,id){calls.push(['decline',actor,id]);return {...room,status:'cancelled'};},
  async cancel(actor,id){calls.push(['cancel',actor,id]);return {...room,status:'cancelled'};}
 };
 const api=createHttpServer({
  authStore:{currentUser:async token=>accounts.get(token)||null},
  scenarioRoomStore:stub
 });
 api.listen(0,'127.0.0.1');await once(api,'listening');
 const base='http://127.0.0.1:'+api.address().port;
 const cookie=k=>({Cookie:'ironhex_session='+tokens[k]});
 const send=(k,path,body,origin=base)=>fetch(base+path,{
  method:'POST',headers:{...cookie(k),Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify(body)
 });
 try{
  assert.equal((await fetch(base+'/api/v1/scenario-rooms')).status,401);
  assert.equal((await send('a','/api/v1/scenario-rooms',{roles:{}},'https://bad.example')).status,403);
  assert.equal(calls.length,0);
  const input={roles:{attacker:'attacker_one',command:'command_one',recon:'recon_one'}};
  assert.equal((await send('a','/api/v1/scenario-rooms',input)).status,201);
  assert.deepEqual(calls[0],['create',users.attacker,input]);
  assert.equal((await fetch(base+'/api/v1/scenario-rooms/'+roomId,{headers:cookie('c')})).status,200);
  assert.deepEqual(calls.at(-1),['get',users.recon,roomId]);
  assert.equal((await send('b','/api/v1/scenario-rooms/'+roomId+'/accept',{actor:users.attacker})).status,422);
  assert.equal((await send('b','/api/v1/scenario-rooms/'+roomId+'/accept',{})).status,200);
  assert.deepEqual(calls.at(-1),['accept',users.command,roomId]);
  assert.equal((await send('c','/api/v1/scenario-rooms/'+roomId+'/decline',{})).status,200);
  assert.deepEqual(calls.at(-1),['decline',users.recon,roomId]);
  const caps=await (await fetch(base+'/api/v1/capabilities')).json();
  assert.equal(caps.modes.multiplayer,false,'invitations do not yet mean remote combat works');
  assert.equal(caps.features.scenarioRoomInvites,true);
 }finally{await new Promise(resolve=>api.close(resolve));}
});


function mockPgRoomStore(outstanding=0){
 const handles=new Map([
  ['attacker_one',users.attacker],
  ['command_one',users.command],
  ['recon_one',users.recon],
  ['outsider','44444444-4444-4444-8444-444444444444']
 ]);
 let room=null;
 const query=async(sql,args=[])=>{
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
  if(sql.startsWith('SELECT id,handle FROM commanders WHERE id=$1')){
   const handle=[...handles].find(([,id])=>id===args[0])?.[0];
   return {rows:handle?[{id:args[0],handle}]:[]};
  }
  if(sql.startsWith('SELECT id,handle FROM commanders WHERE lower(handle)=')){
   return {rows:[...handles].filter(([handle])=>args[0].includes(handle))
    .map(([handle,id])=>({id,handle}))};
  }
  if(sql.startsWith('SELECT count(*)::int AS total FROM agoac_scenario_rooms'))
   return {rows:[{total:outstanding+(room&&['inviting','ready','active'].includes(room.status)?1:0)}]};
  if(sql.startsWith('INSERT INTO agoac_scenario_rooms')){
   room={id:roomId,created_by:args[0],
    attacker_id:args[1],command_id:args[2],recon_id:args[3],
    accepted_attacker:args[4],accepted_command:args[5],accepted_recon:args[6],
    status:'inviting',version:0,created_at:'2026-11-21T00:00:00Z'};
   return {rows:[{id:roomId}]};
  }
  if(sql.startsWith('SELECT * FROM agoac_scenario_rooms WHERE id=$1 FOR UPDATE'))
   return {rows:room&&room.id===args[0]?[{...room}]:[]};
  if(sql.startsWith('SELECT r.*, a.handle AS attacker_handle')){
   const matches=room&&(sql.includes('WHERE r.id=$1')?args[0]===roomId:
    [room.attacker_id,room.command_id,room.recon_id].includes(args[0]));
   return {rows:matches?[{...room,attacker_handle:'attacker_one',
    command_handle:'command_one',recon_handle:'recon_one'}]:[]};
  }
  if(sql.startsWith('UPDATE agoac_scenario_rooms SET accepted_')){
   const column=/SET (accepted_\w+)=true/.exec(sql)?.[1];
   assert(column,'safe fixed role column');
   room[column]=true;room.status=args[1];room.version++;
   return {rows:[]};
  }
  if(sql.startsWith("UPDATE agoac_scenario_rooms SET status='cancelled'")){
   room.status='cancelled';room.version++;
   return {rows:[]};
  }
  throw Error('Unhandled fake Postgres query: '+sql);
 };
 return {
  pool:{query,connect:async()=>({query,release(){}})},
  room:()=>room
 };
}
test('CAT3500D p.48: PostgreSQL room transitions require three distinct consenting accounts',async()=>{
 const {createScenarioRoomStore}=await import('../apps/api/src/scenario-rooms.mjs');
 const db=mockPgRoomStore(),store=createScenarioRoomStore(db.pool);
 const invitation={roles:{
  attacker:'attacker_one',command:'command_one',recon:'recon_one'
 }};
 const created=await store.create(users.attacker,invitation);
 assert.equal(created.status,'inviting');
 assert.equal(created.yourRole,'attacker');
 assert.deepEqual(Object.values(created.roles).map(r=>r.accepted),[true,false,false]);
 assert.equal(created.version,0);
 assert.equal((await store.list(users.command)).length,1);
 assert.equal((await store.list('44444444-4444-4444-8444-444444444444')).length,0);
 await assert.rejects(()=>store.get('44444444-4444-4444-8444-444444444444',roomId),
  e=>e instanceof AuthError&&e.status===404);
 await assert.rejects(()=>store.accept('44444444-4444-4444-8444-444444444444',roomId),
  e=>e instanceof AuthError&&e.status===404);
 const second=await store.accept(users.command,roomId);
 assert.equal(second.status,'inviting');
 assert.equal(second.roles.command.accepted,true);
 assert.equal(second.version,1);
 const ready=await store.accept(users.recon,roomId);
 assert.equal(ready.status,'ready');
 assert.equal(ready.version,2);
 assert(Object.values(ready.roles).every(v=>v.accepted));
 assert.equal((await store.accept(users.recon,roomId)).version,2,
  'retry of accepted room is idempotent');
 await assert.rejects(()=>store.decline(users.command,roomId),
  e=>e instanceof AuthError&&e.status===409);
 await assert.rejects(()=>store.cancel(users.command,roomId),
  e=>e instanceof AuthError&&e.status===403);
 const closed=await store.cancel(users.attacker,roomId);
 assert.equal(closed.status,'cancelled');
 assert.equal(closed.version,3);
 await assert.rejects(()=>store.accept(users.command,roomId),
  e=>e instanceof AuthError&&e.status===409);
 const another=mockPgRoomStore();
 const otherStore=createScenarioRoomStore(another.pool);
 await assert.rejects(()=>otherStore.create('44444444-4444-4444-8444-444444444444',invitation),
  e=>e instanceof AuthError&&e.code==='scenario_owner_must_participate');
 const declined=await otherStore.create(users.attacker,invitation);
 assert.equal(declined.status,'inviting');
 assert.equal((await otherStore.decline(users.recon,roomId)).status,'cancelled');
 await assert.rejects(()=>otherStore.accept(users.command,roomId),AuthError);
 const full=createScenarioRoomStore(mockPgRoomStore(10).pool);
 await assert.rejects(()=>full.create(users.attacker,invitation),
  e=>e instanceof AuthError&&e.code==='scenario_room_limit');
});

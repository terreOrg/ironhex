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

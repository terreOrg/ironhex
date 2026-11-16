// End-to-end server-owned operations against a real PostgreSQL instance.
// Run by the isolated Container Smoke workflow, never against production data.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {example} from '../packages/engine/construction.js';

const base='http://127.0.0.1:3000';
const suffix=randomBytes(6).toString('hex');
async function req(path,{method='GET',body,cookie,origin=true}={}){
  const headers={};
  if(method!=='GET'){
    headers['Content-Type']='application/json';
    if(origin)headers.Origin=base;
  }
  if(cookie)headers.Cookie=cookie;
  const response=await fetch(base+path,{
    method,headers,body:method==='GET'?undefined:JSON.stringify(body??{})
  });
  const data=await response.json().catch(()=>({}));
  return {status:response.status,data,cookie:response.headers.get('set-cookie')};
}
async function account(prefix){
  const registered=await req('/api/v1/auth/register',{method:'POST',body:{
    handle:prefix+suffix,email:prefix+suffix+'@example.invalid',
    password:'Server-Battle-Integration-2026!'
  }});
  assert.equal(registered.status,201,JSON.stringify(registered.data));
  return {id:registered.data.user.id,cookie:registered.cookie.split(';')[0]};
}

const owner=await account('OpA'),other=await account('OpB');
assert.equal((await req('/api/v1/operations')).status,401);
assert.equal((await req('/api/v1/operations',{method:'POST',body:{mechIds:[]}})).status,401);
assert.equal((await req('/api/v1/operations',{method:'POST',cookie:owner.cookie,
  origin:false,body:{title:'Патруль',mechIds:[]}})).status,403);

const invalid=await req('/api/v1/operations',{
  method:'POST',cookie:owner.cookie,body:{title:'Патруль',mechIds:['bad']}
});
assert.equal(invalid.status,422);
const outsiderMech=await req('/api/v1/hangar',{method:'POST',
  cookie:other.cookie,body:{config:example}});
assert.equal(outsiderMech.status,201);
assert.equal((await req('/api/v1/operations',{method:'POST',
  cookie:owner.cookie,body:{title:'Чужой мех',mechIds:[outsiderMech.data.item.id]}
})).status,422,'A commander cannot use another account’s hangar');

const saved=await req('/api/v1/hangar',{method:'POST',cookie:owner.cookie,
  body:{config:example,callsign:'Peregrine'}});
assert.equal(saved.status,201,JSON.stringify(saved.data));
const mechId=saved.data.item.id;
const registered=await req('/api/v1/pilots',{method:'POST',cookie:owner.cookie,
  body:{fullName:'Dana Vos',callsign:'Vega',faction:'mercenary',portrait:4}});
assert.equal(registered.status,201,JSON.stringify(registered.data));
const pilotId=registered.data.item.id;
const assignment=await req('/api/v1/hangar/'+mechId+'/pilot',{
  method:'PUT',cookie:owner.cookie,body:{pilotId}
});
assert.equal(assignment.status,200);
const create=await req('/api/v1/operations',{method:'POST',cookie:owner.cookie,
  body:{title:'Патруль северной границы',mechIds:[mechId]}});
assert.equal(create.status,201,JSON.stringify(create.data));
const op=create.data.item;
const id=op.id;
assert.equal(op.status,'draft');
assert.equal(op.version,0);
assert.equal(op.roster.length,1);
assert.equal(op.roster[0].pilot.id,pilotId);
assert.equal(op.roster[0].pilot.gunnery,4);
assert.equal(op.roster[0].chassis,example.name);
assert.equal(JSON.stringify(op).includes('rngState'),false,
  'Private randomness must not be returned');
assert.equal((await req('/api/v1/operations',{cookie:other.cookie})).data.items.length,0);
assert.equal((await req('/api/v1/operations/'+id,{cookie:other.cookie})).status,404);
assert.equal((await req('/api/v1/operations/'+id+'/launch',
  {method:'POST',cookie:other.cookie})).status,404);
assert.equal((await req('/api/v1/operations/'+id+'/advance',
  {method:'POST',cookie:other.cookie})).status,404);
assert.equal((await req('/api/v1/operations/'+id+'/launch',
  {method:'POST',cookie:owner.cookie,origin:false})).status,403);
assert.equal((await req('/api/v1/operations/'+id+'/advance',
  {method:'POST',cookie:owner.cookie})).status,409);

let state=await req('/api/v1/operations/'+id+'/launch',{
  method:'POST',cookie:owner.cookie
});
assert.equal(state.status,200,JSON.stringify(state.data));
state=state.data.item;
assert.equal(state.status,'active');
assert.equal(state.version,1);
assert.equal(state.state.round,1);
assert.equal(state.state.units.length,4);
assert.equal(state.state.units[0].name,example.name);
assert.equal((await req('/api/v1/operations/'+id+'/launch',
  {method:'POST',cookie:owner.cookie})).status,409);
assert.equal((await req('/api/v1/operations/'+id+'/advance',
  {method:'POST',cookie:owner.cookie,body:{winner:0,experience:9999}})).status,422);

let rounds=0;
while(state.status==='active'&&rounds++<14){
  const previous=state.version;
  const res=await req('/api/v1/operations/'+id+'/advance',{
    method:'POST',cookie:owner.cookie
  });
  assert.equal(res.status,200,'Advance response: '+JSON.stringify(res.data));
  state=res.data.item;
  assert.equal(state.version,previous+1);
  assert(state.state?.round>=1);
  assert.equal(JSON.stringify(state).includes('rngState'),false);
}
assert.equal(state.status,'completed','Operation should end or draw within 12 rounds');
assert(['victory','defeat','draw'].includes(state.report.result));
assert(state.report.log.length>0);
assert.equal(state.report.rewards.length,1);
assert.equal(state.report.rewards[0].pilotId,pilotId);
assert(state.report.rewards[0].experience>0);
assert.equal(state.report.equipmentNote.includes('пока'),true);
const persisted=await req('/api/v1/operations/'+id,{cookie:owner.cookie});
assert.equal(persisted.status,200);
assert.deepEqual(persisted.data.item.report,state.report);
assert.equal((await req('/api/v1/operations/'+id+'/advance',{
  method:'POST',cookie:owner.cookie
})).status,409,'A settled battle cannot grant rewards a second time');

const pilot=await req('/api/v1/pilots/'+pilotId,{cookie:owner.cookie});
assert.equal(pilot.data.item.battles,1);
assert.equal(pilot.data.item.experience,state.report.rewards[0].experience);
const history=await req('/api/v1/pilots/'+pilotId+'/history',{cookie:owner.cookie});
assert.equal(history.data.items.length,1);
assert.equal(history.data.items[0].experience,state.report.rewards[0].experience);
assert.equal(history.data.items[0].mechChassis,example.name);

const extra=await req('/api/v1/operations',{method:'POST',cookie:owner.cookie,
  body:{title:'Отменённая операция',mechIds:[mechId]}});
assert.equal(extra.status,201);
const aborted=await req('/api/v1/operations/'+extra.data.item.id+'/abandon',{
  method:'POST',cookie:owner.cookie
});
assert.equal(aborted.status,200);
assert.equal(aborted.data.item.status,'abandoned');
assert.equal((await req('/api/v1/operations/'+extra.data.item.id+'/launch',{
  method:'POST',cookie:owner.cookie
})).status,409);
assert.equal((await req('/api/v1/pilots/'+pilotId,{cookie:owner.cookie}))
  .data.item.battles,1,'Abandoning an operation must not grant XP');

console.log('Server operations passed: owner isolation, frozen roster, replay-safe rounds, validated result, rewards once, persistence and abort');

import {createPilotStore,validatePilot} from '../apps/api/src/pilots.mjs';
import {AuthError} from '../apps/api/src/auth.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createHttpServer, isLocalPeer } from '../apps/api/src/http.mjs';

let server,origin;
before(async()=>{
  server = createHttpServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(async()=>{
  if (server?.listening) await new Promise(resolve=>server.close(resolve));
});

test('API health is available with database probe',async()=>{
  const response=await fetch(origin+'/api/health');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    status:'ok',service:'ironhex-api',database:'ok'
  });
});
test('API chassis catalog comes from shared engine',async()=>{
  const response=await fetch(origin+'/api/v1/catalog/chassis');
  assert.equal(response.status,200);
  const {items}=await response.json();
  assert.equal(items.length,4);
  assert(items.every(mech=>mech.name&&mech.variant&&mech.weapons.length));
});
test('API describes incomplete server-side features accurately',async()=>{
  const r=await fetch(origin+'/api/v1/capabilities');
  const d=await r.json();
  assert.equal(d.features.market,false);
  assert.equal(d.features.accounts,false);
  assert.equal(d.combatAuthority,'browser');
});
test('API refuses mutations before authentication exists',async()=>{
  const r=await fetch(origin+'/api/v1/catalog/chassis',{method:'POST'});
  assert.equal(r.status,405);
  assert.equal(r.headers.get('allow'),'GET, HEAD');
});
test('API reports unavailable database without exposing secrets',async()=>{
  const broken=createHttpServer({probeDatabase:async()=>{throw Error('db password secret');}});
  broken.listen(0,'127.0.0.1');
  await once(broken,'listening');
  try {
    const r=await fetch('http://127.0.0.1:'+broken.address().port+'/api/health');
    assert.equal(r.status,503);
    assert(!JSON.stringify(await r.json()).includes('password'));
  } finally { await new Promise(resolve=>broken.close(resolve)); }
});

test('CSRF rejects cross-site account mutations before touching auth storage',async()=>{
  const authenticated=createHttpServer({authStore:{
    register:async()=>{throw Error('unexpected registration');},
    currentUser:async()=>null
  }});
  authenticated.listen(0,'127.0.0.1');
  await once(authenticated,'listening');
  const url='http://127.0.0.1:'+authenticated.address().port;
  try {
    const r=await fetch(url+'/api/v1/auth/register',{
      method:'POST',headers:{
        Origin:'https://evil.example','Content-Type':'application/json'
      },body:'{}'
    });
    assert.equal(r.status,403);
    assert.deepEqual(await r.json(),{error:'invalid_origin'});
    const me=await fetch(url+'/api/v1/auth/me');
    assert.deepEqual(await me.json(),{authenticated:false,user:null});
    const hanging=await fetch(url+'/api/v1/hangar');
    assert.equal(hanging.status,401);
  } finally {
    await new Promise(resolve=>authenticated.close(resolve));
  }
});

test('secure cookie mode requires an explicit HTTPS origin',()=>{
  assert.throws(()=>createHttpServer({secureCookies:true}),/HTTPS public origin/);
  assert.throws(()=>createHttpServer({secureCookies:true,publicOrigin:'http://example.com'}),/HTTPS public origin/);
  assert.doesNotThrow(()=>createHttpServer({secureCookies:true,publicOrigin:'https://example.com'}));
});
test('configured HTTPS origin accepts proxy traffic but rejects HTTP and cross-site mutations',async()=>{
  const originServer=createHttpServer({publicOrigin:'https://example.com',secureCookies:true,authStore:{
    register:async()=>({user:{id:'test'},token:'a'.repeat(64)})
  }});
  originServer.listen(0,'127.0.0.1');await once(originServer,'listening');
  try{
    const base='http://127.0.0.1:'+originServer.address().port;
    const send=(origin,extra={})=>fetch(base+'/api/v1/auth/register',{method:'POST',
      headers:{Origin:origin,'Content-Type':'application/json',...extra},body:'{}'});
    assert.equal((await send('http://example.com')).status,403);
    assert.equal((await send('https://example.com',{'Sec-Fetch-Site':'cross-site'})).status,403);
    const accepted=await send('https://example.com');
    assert.equal(accepted.status,201);assert.match(accepted.headers.get('set-cookie'),/Secure/);
  }finally{await new Promise(resolve=>originServer.close(resolve));}
});

test('local peer check accepts loopback and mapped loopback only',()=>{
  for(const ip of ['127.0.0.1','::1','::ffff:127.0.0.1','::ffff:7f00:1'])
    assert.equal(isLocalPeer(ip),true,ip);
  for(const ip of ['127.0.0.2','192.168.0.1','::ffff:192.168.0.1','::ffff:7f00:2','::','localhost','',undefined])
    assert.equal(isLocalPeer(ip),false,String(ip));
});

const pilotCode=code=>error=>error instanceof AuthError&&error.code===code;
const pilotId='11111111-1111-4111-8111-111111111111';
const mechId='22222222-2222-4222-8222-222222222222';
const pilotInput={fullName:' Mara Voss ',callsign:' Raven '};
test('pilot validation refuses client-controlled statistics and invalid profile values',()=>{
  assert.deepEqual(validatePilot(pilotInput),{fullName:'Mara Voss',callsign:'Raven',faction:'mercenary',portrait:1});
  for(const value of [null,[],{},'pilot',{...pilotInput,gunnery:0},
    {...pilotInput,experience:1000},{...pilotInput,fullName:'<tag>'},
    {...pilotInput,callsign:'a'},{...pilotInput,portrait:9},
    {...pilotInput,portrait:1.5},{...pilotInput,faction:'unknown'},
    {...pilotInput,fullName:'a'.repeat(61)},{...pilotInput,callsign:'a'.repeat(29)}]){
    assert.throws(()=>validatePilot(value),pilotCode('invalid_pilot'));
  }
});
test('pilot CRUD and history restrict SQL to owner and serialize only public fields',async()=>{
  const row={id:pilotId,full_name:'Mara Voss',callsign:'Raven',faction:'mercenary',portrait:1,
    rank:'cadet',gunnery:4,piloting:5,experience:0,battles:0,wins:0,losses:0,kills:0,wounds:0,
    assigned_mech_id:null,assigned_chassis:null,created_at:'2026-01-01',commander_id:'private'};
  const calls=[];
  const pool={async query(sql,params){
    calls.push({sql,params});assert.equal(params[0],'owner','Owner key is mandatory');
    if(sql.startsWith('SELECT p.*'))return {rows:[row]};
    if(sql.startsWith('INSERT')||sql.startsWith('UPDATE')||sql.startsWith('DELETE'))return {rows:[{id:pilotId}]};
    if(sql.startsWith('SELECT id,mech_chassis'))return {rows:[{id:7,mech_chassis:'Atlas',result:'win',xp_awarded:2,kills:1,created_at:'2026-01-02'}]};
    throw Error('Unexpected query');
  }};
  const store=createPilotStore(pool);
  const list=await store.list('owner');
  assert.equal(list.length,1);assert.equal(list[0].callsign,'Raven');assert.equal(list[0].assignedMechId,null);
  assert(!Object.hasOwn(list[0],'commander_id'));
  assert.deepEqual(await store.get('owner',pilotId),list[0]);
  assert.deepEqual(await store.create('owner',pilotInput),list[0]);
  assert.deepEqual(await store.update('owner',pilotId,pilotInput),list[0]);
  assert.deepEqual(await store.history('owner',pilotId),[{id:'7',mechChassis:'Atlas',result:'win',experience:2,kills:1,createdAt:'2026-01-02'}]);
  assert.deepEqual(await store.remove('owner',pilotId),{ok:true});
  assert(calls.filter(x=>x.sql.startsWith('SELECT p.*')).every(x=>x.sql.includes('p.commander_id=$1')));
  assert.deepEqual(calls.find(x=>x.sql.startsWith('INSERT')).params,['owner','Mara Voss','Raven','mercenary',1]);
  assert(calls.find(x=>x.sql.startsWith('UPDATE')).sql.includes('WHERE commander_id=$1 AND id=$2'));
  assert(calls.find(x=>x.sql.startsWith('DELETE')).sql.includes('WHERE commander_id=$1 AND id=$2'));
});
test('pilot repository rejects invalid, missing and cross-owner records and full roster',async()=>{
  let queries=0;
  const store=createPilotStore({async query(){queries++;return {rows:[]};}});
  for(const method of ['get','remove','update','history'])
    await assert.rejects(store[method]('owner','not-a-uuid',pilotInput),pilotCode('pilot_not_found'));
  assert.equal(queries,0);
  for(const method of ['get','remove','update','history'])
    await assert.rejects(store[method]('owner',pilotId,pilotInput),pilotCode('pilot_not_found'));
  await assert.rejects(store.create('owner',pilotInput),pilotCode('roster_full'));
});
test('pilot assignment checks ownership, permits unassignment and maps uniqueness failures',async()=>{
  let mode='ok',queries=0;
  const store=createPilotStore({async query(sql,params){
    queries++;assert.match(sql,/m.commander_id=\$1 AND m.id=\$2/);
    assert.match(sql,/p.id=\$3::uuid AND p.commander_id=\$1/);
    assert.deepEqual(params.slice(0,2),['owner',mechId]);
    if(mode==='duplicate')throw Object.assign(Error('unique'),{code:'23505'});
    if(mode==='unexpected')throw Error('database unavailable');
    return {rows:mode==='missing'?[]:[{id:mechId}]};
  }});
  await assert.rejects(store.assign('owner','bad',pilotId),pilotCode('invalid_assignment'));
  await assert.rejects(store.assign('owner',mechId,'bad'),pilotCode('invalid_assignment'));
  assert.equal(queries,0);
  assert.deepEqual(await store.assign('owner',mechId,pilotId),{ok:true,mechId,pilotId});
  assert.deepEqual(await store.assign('owner',mechId,null),{ok:true,mechId,pilotId:null});
  mode='missing';await assert.rejects(store.assign('owner',mechId,pilotId),pilotCode('assignment_not_found'));
  mode='duplicate';await assert.rejects(store.assign('owner',mechId,pilotId),pilotCode('pilot_already_assigned'));
  mode='unexpected';await assert.rejects(store.assign('owner',mechId,pilotId),/database unavailable/);
});

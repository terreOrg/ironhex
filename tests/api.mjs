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

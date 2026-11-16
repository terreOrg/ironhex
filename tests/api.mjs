import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createHttpServer } from '../apps/api/src/http.mjs';

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

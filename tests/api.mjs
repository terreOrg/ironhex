import {Game} from '../packages/engine/engine.js';
import {runTacticalOrder,publicSnapshot,validateTacticalOrder} from '../apps/api/src/server-combat.mjs';
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

test('API persists mandatory phase choice, rejects forged decisions and redacts private RNG replay',()=>{
 let draws=0;
 const g=new Game({rng:()=>{draws++;return .99;}}),[t,b,a,other]=g.units;
 for(const tile of g.tiles)Object.assign(tile,{type:'plain',height:0,depth:0,surface:0});
 Object.assign(a,{q:-1,r:0,facing:0});Object.assign(t,{q:0,r:0});
 Object.assign(b,{q:1,r:0,facing:1,moveMode:'walk',spent:0});
 other.dead=true;g.phase='physical';g.initiativeWinner=0;g.queue=[];g.activeTeam=null;
 const push=g.physicalPreview(a.id,t.id,'push','LA');assert(push.legal,push.reason);
 g.physicalDeclarations=[{id:a.id,target:t.id,type:'push',limb:'LA',...push}];
 const effect=runTacticalOrder(g,{type:'next',version:1});
 assert.equal(effect.result.pending,true);assert.equal(draws,4);
 const stored=JSON.parse(JSON.stringify(g,(k,v)=>['map','rng'].includes(k)?undefined:v));
 const snapshot=publicSnapshot({game:stored});
 assert(!Object.hasOwn(snapshot,'_resolutionReplay'));assert.equal(snapshot.pendingChoice.kind,'domino');
 assert.throws(()=>runTacticalOrder(g,{type:'next',version:2,choice:{key:'fake',option:'decline'}}),AuthError);
 assert.throws(()=>runTacticalOrder(g,{type:'hold',id:0,version:2}),AuthError);
 assert.throws(()=>validateTacticalOrder({type:'next',version:2,choice:{key:snapshot.pendingChoice.key,option:'back',dice:[6,6]}}),AuthError);
 assert.equal(draws,4);
 const restored=new Game({rng:()=>{draws++;return .99;}});
 Object.assign(restored,stored);restored.rebuildMap();
 const back=snapshot.pendingChoice.options.find(o=>o.id==='back');
 const done=runTacticalOrder(restored,{type:'next',version:2,choice:{key:snapshot.pendingChoice.key,option:'back'}});
 assert.equal(done.result.ok,true);assert.equal(draws,6);assert.equal(restored.phase,'heat');
 assert.deepEqual([restored.unit(b.id).q,restored.unit(b.id).r],[back.q,back.r]);
 const finalState=JSON.parse(JSON.stringify(restored,(k,v)=>['map','rng'].includes(k)?undefined:v));
 assert.equal(publicSnapshot({game:finalState}).pendingChoice,null);
 assert(!Object.hasOwn(publicSnapshot({game:finalState}),'_resolutionReplay'));
});

test('API rejects minimum-entry mode for ordinary on-map movement',()=>{
 const g=new Game();g.phase='move';g.activeTeam=0;g.queue=[0];
 const u=g.units[0],target=g.reachable(u,'walk').find(t=>t.q!==u.q||t.r!==u.r);
 assert(target);const before=JSON.stringify(u);
 assert.throws(()=>runTacticalOrder(g,{type:'move',id:0,q:target.q,r:target.r,mode:'minimum',version:1}),
  e=>e instanceof AuthError&&e.status===422);
 assert.equal(JSON.stringify(u),before);
});

test('API validates optional walking or running mode for voluntary prone orders',()=>{
 assert.doesNotThrow(()=>validateTacticalOrder({type:'drop',id:0,version:1}));
 assert.doesNotThrow(()=>validateTacticalOrder({type:'drop',id:0,version:1,mode:'run'}));
 assert.throws(()=>validateTacticalOrder({type:'drop',id:0,version:1,mode:'jump'}),AuthError);
});

test('API movement choice pauses with active queue and resumes original authenticated order',()=>{
 const g=new Game(),u=g.units[0],ally=g.units[1];
 g.phase='move';g.queue=[0,1,0,1];g.activeTeam=0;
 for(const t of g.tiles)Object.assign(t,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(u,{q:0,r:0,facing:0,walk:5,moveStart:{q:0,r:0}});
 Object.assign(ally,{q:1,r:0,facing:1,walk:4});
 for(const v of g.units.filter(v=>v.team!==u.team))v.dead=true;
 g.tile(1,0).type='rubble';
 let draws=0;g.rng=()=>{draws++;return draws<=2?0:.5;};
 const before=JSON.stringify(g.units);
 const pending=runTacticalOrder(g,{type:'move',version:1,id:u.id,q:2,r:0,mode:'walk'});
 assert.equal(pending.result.pending,true);assert.equal(JSON.stringify(g.units),before);
 const saved=draws,p=g.pendingChoice;
 assert.equal(publicSnapshot({game:JSON.parse(JSON.stringify(g))})._resolutionReplay,undefined);
 assert.throws(()=>runTacticalOrder(g,{type:'hold',version:2,id:u.id}),AuthError);
 const completed=runTacticalOrder(g,{type:'next',version:2,choice:{key:p.key,option:'forward'}});
 assert.equal(completed.type,'move');assert.equal(completed.id,u.id);
 assert.equal(completed.result.pending,undefined);assert.equal(draws,saved);
 assert.deepEqual(completed.result.to,{q:1,r:0});
 assert.equal(g.pendingChoice,null);
});

test('API resumes an AI-created movement choice without accepting client AI commands',()=>{
 class RouteAI extends Game{
  aiMove(id){const r=this.move(id,2,-1,'walk');if(r.ok)this.hold(id);return r;}
 }
 const g=new RouteAI({rng:()=>.5}),[player,human,ai,ally]=g.units;
 g.phase='move';g.activeTeam=0;g.queue=[0,1,0,1];
 for(const hex of g.tiles)Object.assign(hex,{type:'plain',depth:0,height:0,surface:0});
 Object.assign(ai,{q:0,r:0,facing:0,walk:6,moveStart:{q:0,r:0}});
 Object.assign(ally,{q:1,r:0,facing:0,walk:4});
 Object.assign(human,{q:2,r:0,facing:1,walk:4});Object.assign(player,{q:-4,r:0});
 g.tile(1,0).type='rubble';g.tile(1,-1).height=g.tile(1,-1).surface=4;
 let draws=0;g.rng=()=>{draws++;return draws<=2?0:.5;};
 // aiSelection picks the first red unit, not the friendly blockage.
 const completed=runTacticalOrder(g,{type:'hold',id:player.id,version:1});
 assert.equal(completed.type,'hold');assert.equal(completed.ai.length,0);
 assert.equal(g.pendingChoice?.unitId,human.id);
 assert.equal(g.unit(player.id).moved,true);assert.equal(g.unit(ai.id).moved,false);
 assert.throws(()=>runTacticalOrder(g,{type:'ai-move',id:ai.id,version:2}),AuthError);
 const p=g.pendingChoice,saved=draws;
 const fx=runTacticalOrder(g,{type:'next',version:2,choice:{key:p.key,option:'forward'}});
 assert.equal(fx.type,'ai-move');assert.equal(fx.id,ai.id);assert.equal(draws,saved);
 assert.equal(g.pendingChoice,null);assert.equal(g.unit(ai.id).moved,true);
 assert.equal(g.activeTeam,0);
});

test('API rejects a minimum movement order during weapon declaration',()=>{
 const g=new Game(),u=g.units[0];g.phase='fire';g.queue=[0,1];g.activeTeam=0;
 Object.assign(u,{q:0,r:0,facing:0,walk:5});
 const before=JSON.stringify(u);
 assert.throws(()=>runTacticalOrder(g,{type:'minimum',id:u.id,version:1}),AuthError);
 assert.equal(JSON.stringify(u),before);
});

test('API permits optional friendly reactor orders at End Phase without a movement selection',()=>{
 const g=new Game(),u=g.units[0];g.phase='end';g.activeTeam=null;g.queue=[];
 const result=runTacticalOrder(g,{type:'shutdown',id:u.id,version:1});
 assert.equal(result.result.ok,true);assert.equal(u.shutdownNext,true);
 assert.equal(u.shutdown,false);assert.equal(g.phase,'end');
 assert.throws(()=>runTacticalOrder(g,{type:'shutdown',id:2,version:2}),AuthError);
 assert.throws(()=>runTacticalOrder(g,{type:'hold',id:u.id,version:2}),AuthError);
 assert(runTacticalOrder(g,{type:'next',version:2}).result.ok);
 assert.equal(g.unit(u.id).shutdown,true);
});

test('API End Phase recovery choice is resumable and does not expose replay journal',()=>{
 const g=new Game(),u=g.units[0];g.phase='end';g.queue=[];g.activeTeam=null;
 Object.assign(u,{unconscious:true,wasUnconscious:true,pilotWounds:1});
 let draws=0;g.rng=()=>{draws++;return .5;};
 const r=runTacticalOrder(g,{type:'next',version:1});
 assert(r.result.pending);assert.equal(g.pendingChoice.kind,'recovered-reactor');assert.equal(draws,2);
 const snapshot=publicSnapshot({game:JSON.parse(JSON.stringify(g))});
 assert.equal(snapshot._resolutionReplay,undefined);assert.equal(snapshot.pendingChoice.kind,'recovered-reactor');
 assert.throws(()=>runTacticalOrder(g,{type:'shutdown',id:u.id,version:2}),AuthError);
 const p=g.pendingChoice,done=runTacticalOrder(g,{type:'next',version:2,choice:{key:p.key,option:'shutdown'}});
 assert(done.result.ok&&!done.result.pending);assert.equal(draws,2);
 assert.equal(g.unit(u.id).shutdown,true);assert.equal(g.unit(u.id).unconscious,false);
});

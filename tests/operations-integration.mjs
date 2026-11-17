// End-to-end server-owned operations against a real PostgreSQL instance.
// Run by the isolated Container Smoke workflow, never against production data.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {example,construct} from '../packages/engine/construction.js';
import {Game} from '../packages/engine/engine.js';
import {createPool} from '../apps/api/src/db.mjs';

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
assert.equal((await req('/api/v1/economy')).status,401);
assert.equal((await req('/api/v1/economy/purchase',{
  method:'POST',cookie:owner.cookie,origin:false,
  body:{sku:'armor_patch',quantity:1}})).status,403);
assert.equal((await req('/api/v1/economy/purchase',{
  method:'POST',cookie:owner.cookie,
  body:{sku:'armor_patch',quantity:0}})).status,422);
const initialWallet=await req('/api/v1/economy',{cookie:owner.cookie});
assert.equal(initialWallet.status,200);
assert.equal(initialWallet.data.balance,150000);
assert.equal(initialWallet.data.ledger.length,1);
assert.equal(initialWallet.data.ledger[0].amount,150000);
assert.equal((await req('/api/v1/economy',{cookie:other.cookie})).data.balance,150000);
const purchased=await req('/api/v1/economy/purchase',{
  method:'POST',cookie:owner.cookie,body:{sku:'armor_patch',quantity:1}});
assert.equal(purchased.status,200,JSON.stringify(purchased.data));
assert.equal(purchased.data.item.spent,900);
assert.equal((await req('/api/v1/economy',{cookie:owner.cookie})).data.balance,149100);
assert.equal((await req('/api/v1/economy',{cookie:other.cookie})).data.stock.armor_patch||0,0);
assert.equal((await req('/api/v1/economy/repair',{method:'POST',
  cookie:owner.cookie,body:{mechId:'not-a-mech'}})).status,422);
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

const saved=await req('/api/v1/economy/mechs/purchase',{method:'POST',cookie:owner.cookie,
  body:{offerId:'mm-grf-1m'}});
assert.equal(saved.status,201,JSON.stringify(saved.data));
const mechId=saved.data.item.id;
assert.equal(saved.data.item.spent,54000);
const licensed=await req('/api/v1/hangar',{cookie:owner.cookie});
assert.equal(licensed.data.items.find(m=>m.id===mechId).marketOwned,true);
const afterProcurement=await req('/api/v1/economy',{cookie:owner.cookie});
assert.equal(afterProcurement.data.balance,95100);
const registered=await req('/api/v1/pilots',{method:'POST',cookie:owner.cookie,
  body:{fullName:'Dana Vos',callsign:'Vega',faction:'mercenary',portrait:4}});
assert.equal(registered.status,201,JSON.stringify(registered.data));
const pilotId=registered.data.item.id;
const assignment=await req('/api/v1/hangar/'+mechId+'/pilot',{
  method:'PUT',cookie:owner.cookie,body:{pilotId}
});
assert.equal(assignment.status,200);
const create=await req('/api/v1/operations',{method:'POST',cookie:owner.cookie,
  body:{title:'Патруль северной границы',mechIds:[mechId],contractId:'intercept'}});
assert.equal(create.status,201,JSON.stringify(create.data));
const op=create.data.item;
const id=op.id;
assert.equal(op.status,'draft');
assert.equal(op.contractId,'intercept');
assert.equal(op.version,0);
assert.equal(op.roster.length,1);
assert.equal(op.roster[0].pilot.id,pilotId);
assert.equal(op.roster[0].pilot.fullName,'Dana Vos');
assert.equal(op.roster[0].pilot.gunnery,4);
assert.equal(op.roster[0].chassis,'Griffin GRF-1M');
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
assert.equal(state.state.units[0].name,'Griffin GRF-1M');
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
assert.equal(state.report.creditReward, state.report.result==='victory'?56000:
  state.report.result==='draw'?28000:11200);
const afterMissionWallet=await req('/api/v1/economy',{cookie:owner.cookie});
assert.equal(afterMissionWallet.status,200);
assert.equal(afterMissionWallet.data.balance,95100+state.report.creditReward);
assert.equal(afterMissionWallet.data.ledger[0].amount,state.report.creditReward);
const quote=afterMissionWallet.data.repairs.find(item=>item.mechId===mechId);
assert(quote);
assert.equal(quote.armorDamage,state.report.rewards[0].armorLost);
assert.equal(quote.structureDamage,state.report.rewards[0].structureLost);
assert.equal(quote.wrecked,state.report.rewards[0].destroyed);
assert.equal((await req('/api/v1/economy/repair',{
  method:'POST',cookie:other.cookie,body:{mechId}})).status,404,
  'Rival commanders must not repair another hangar');
assert.match(state.report.equipmentNote,/Боеприпасы списаны/);
const magazinesInReport=state.report.rewards[0].ammoUsed;
assert(Array.isArray(magazinesInReport));
assert(magazinesInReport.length>=1);
assert(magazinesInReport.every(bin=>Number.isInteger(bin.used)&&
  bin.remaining>=0&&bin.remaining<=bin.capacity));
const persistedMechAfterFight=(await req('/api/v1/hangar',{cookie:owner.cookie}))
  .data.items.find(m=>m.id===mechId);
for(const bin of magazinesInReport){
  const key=bin.location+':'+bin.slot;
  assert.equal(persistedMechAfterFight.ammoState[key],bin.remaining,
    'Combat-resolved ammunition must be saved on the owned mech');
}
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
assert.equal(history.data.items[0].mechChassis,'Griffin GRF-1M');

if(quote.needsRepair){
  const blocked=await req('/api/v1/operations',{method:'POST',cookie:owner.cookie,
    body:{title:'Без ремонта',mechIds:[mechId]}});
  assert.equal(blocked.status,409,'Damaged mechs cannot start contracts');
  const paid=await req('/api/v1/economy/repair',{method:'POST',
    cookie:owner.cookie,body:{mechId}});
  assert.equal(paid.status,200,JSON.stringify(paid.data));
  assert.equal(paid.data.item.spent,quote.creditCost);
  const fixed=await req('/api/v1/economy',{cookie:owner.cookie});
  assert.equal(fixed.data.balance,95100+state.report.creditReward-quote.creditCost);
  assert.equal(fixed.data.repairs.find(m=>m.mechId===mechId).needsRepair,false);
  assert.equal((await req('/api/v1/economy/repair',{method:'POST',cookie:owner.cookie,
    body:{mechId}})).status,409,'Repairs must not debit twice');
}
// The original combat test may legitimately destroy a cockpit or 3 engine
// criticals. Verify that paid HULL repairs do not silently fix these faults.
const postHull=(await req('/api/v1/hangar',{cookie:owner.cookie}))
  .data.items.find(m=>m.id===mechId);
assert.deepEqual(postHull.criticalDamage,state.report.rewards[0].criticalDamage,
  'Hull repairs must never erase critical equipment damage');
// For subsequent unrelated mission-protocol tests, reset the disposable CI
// fixture directly. No production endpoint offers this free recovery.
const cleanFixtureDb=createPool();
try{
  await cleanFixtureDb.query(
    "UPDATE hangar_mechs SET critical_damage='{}'::jsonb WHERE id=$1",
    [mechId]);
}finally{await cleanFixtureDb.end();}
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


// Interactive 3D uses the same PostgreSQL operation record, but the browser
// cannot advance automatic rounds or forge enemy/hidden state.
const interactiveCreated=await req('/api/v1/operations',{
  method:'POST',cookie:owner.cookie,body:{
    title:'Тактическая операция 3D',mechIds:[mechId],mode:'interactive'
  }
});
assert.equal(interactiveCreated.status,201,JSON.stringify(interactiveCreated.data));
const interactiveId=interactiveCreated.data.item.id;
assert.equal(interactiveCreated.data.item.controlMode,'interactive');
assert.equal(interactiveCreated.data.item.deploymentMode,'scenario');
assert.equal((await req('/api/v1/operations/'+interactiveId+'/snapshot',
  {cookie:other.cookie})).status,404,'A rival cannot view private game state');
assert.equal((await req('/api/v1/operations/'+interactiveId+'/command',{
  method:'POST',cookie:other.cookie,body:{type:'next',version:1}
})).status,404);
assert.equal((await req('/api/v1/operations/'+interactiveId+'/snapshot',
  {cookie:owner.cookie})).status,200);
const interactiveStarted=await req('/api/v1/operations/'+interactiveId+'/launch',{
  method:'POST',cookie:owner.cookie
});
assert.equal(interactiveStarted.status,200);
assert.equal(interactiveStarted.data.item.status,'active');
assert.equal((await req('/api/v1/operations/'+interactiveId+'/advance',{
  method:'POST',cookie:owner.cookie
})).status,409,'An interactive battle cannot use automatic round reward endpoint');

async function tactical(body,origin=true){
  return req('/api/v1/operations/'+interactiveId+'/command',{
    method:'POST',cookie:owner.cookie,origin,body
  });
}
assert.equal((await tactical({type:'next',version:1,winner:0})).status,422);
assert.equal((await tactical({type:'hold',id:2,version:1})).status,422);
assert.equal((await tactical({type:'next',version:1},false)).status,403);
assert.equal((await tactical({type:'next',version:999})).status,409);
let snapshot=await req('/api/v1/operations/'+interactiveId+'/snapshot',{
  cookie:owner.cookie
});
assert.equal(snapshot.status,200);
assert.equal(snapshot.data.item.version,1);
assert.equal(snapshot.data.item.game.phase,'initiative');
assert.equal(JSON.stringify(snapshot.data).includes('rngState'),false,
  'Random generator state must never be returned to the client');
assert.equal(snapshot.data.item.game.units[0].name,'Griffin GRF-1M');
assert.equal(snapshot.data.item.game.units[0].pilotName,'Dana Vos');

let command=await tactical({type:'next',version:1});
assert.equal(command.status,200,JSON.stringify(command.data));
assert.equal(command.data.item.version,2);
assert.equal(command.data.item.game.phase,'move');
assert.equal(command.data.item.effect.type,'next');
assert.equal((await tactical({type:'next',version:1})).status,409,
  'Outdated concurrent commands must not override later state');
assert.equal((await tactical({type:'next',version:2})).status,409,
  'A phase cannot complete before the commander submits all orders');

let game=command.data.item.game;
let version=2;
let moves=0;
while(game.phase==='move'&&game.queue.length&&moves++<12){
  assert.equal(game.activeTeam,0,'Opponent should act on the server, not in the client');
  const id=game.units.find(u=>u.team===0&&!u.dead&&!u.moved)?.id;
  assert.notEqual(id,undefined);
  const turn=await tactical({type:'hold',id,version});
  assert.equal(turn.status,200,'Interactive movement order rejected: '+JSON.stringify(turn.data));
  version=turn.data.item.version;
  game=turn.data.item.game;
}
assert(moves>0&&moves<12);
assert.equal(game.queue.length,0);
command=await tactical({type:'next',version});
assert.equal(command.status,200,JSON.stringify(command.data));
version=command.data.item.version;
assert.equal(command.data.item.game.phase,'fire');
const persistedInteractive=await req('/api/v1/operations/'+interactiveId+'/snapshot',{
  cookie:owner.cookie
});
assert.equal(persistedInteractive.data.item.version,version);
assert.equal(persistedInteractive.data.item.game.phase,'fire');
assert.equal(JSON.stringify(persistedInteractive.data).includes('rngState'),false);
assert.equal((await req('/api/v1/operations/'+interactiveId+'/abandon',{
  method:'POST',cookie:owner.cookie
})).status,200);
assert.equal((await tactical({type:'next',version})).status,409);
const stillOwner=await req('/api/v1/pilots/'+pilotId,{cookie:owner.cookie});
assert.equal(stillOwner.data.item.battles,1,
  'Abandoning interactive battle must not issue additional rewards');
console.log('Interactive 3D protocol passed: private snapshots, enemy order rejection, version conflicts, server AI, phase persistence and abort');

// AGoAC p.6: standard deployment is stored on the draft, not client state.
const standardInput={title:'AGoAC deployment',mechIds:[mechId],mode:'interactive'};
for(const deploymentMode of [null,'forged',true]){
  const invalid=await req('/api/v1/operations',{method:'POST',cookie:owner.cookie,
    body:{...standardInput,deploymentMode}});
  assert.equal(invalid.status,422);
}
const standardCreated=await req('/api/v1/operations',{method:'POST',cookie:owner.cookie,
  body:{...standardInput,deploymentMode:'standard'}});
assert.equal(standardCreated.status,201,JSON.stringify(standardCreated.data));
const standardId=standardCreated.data.item.id;
const standardPath='/api/v1/operations/'+standardId;
const readStandard=()=>req(standardPath+'/snapshot',{cookie:owner.cookie});
const standardCommand=body=>req(standardPath+'/command',{method:'POST',cookie:owner.cookie,body});
assert.equal(standardCreated.data.item.deploymentMode,'standard');
assert.equal((await req(standardPath+'/launch',{method:'POST',cookie:owner.cookie})).status,200);
let standard=(await readStandard()).data.item;
assert.equal(standard.deploymentMode,'standard');
assert.equal(standard.game.phase,'setup');
assert(standard.game.units.filter(u=>!u.dead).every(u=>u.deployed===false));
let setup=await standardCommand({type:'next',version:standard.version});
assert.equal(setup.status,200,JSON.stringify(setup.data));
standard=setup.data.item;
if(standard.game.pendingChoice){
  const pending=standard.game.pendingChoice;
  assert.equal(pending.kind,'deployment-edge');
  assert.deepEqual((await readStandard()).data.item.game.pendingChoice,pending);
  assert.equal((await standardCommand({type:'next',version:standard.version,
    choice:{key:pending.key,option:'forged'}})).status,422);
  setup=await standardCommand({type:'next',version:standard.version,
    choice:{key:pending.key,option:pending.options[0].id}});
  assert.equal(setup.status,200,JSON.stringify(setup.data));
  standard=setup.data.item;
}
assert.equal(standard.game.phase,'initiative');
assert.equal((standard.game.deployment.edges[0]+3)%6,standard.game.deployment.edges[1]);
assert.equal(Object.hasOwn(standard.game,'_resolutionReplay'),false);
setup=await standardCommand({type:'next',version:standard.version});
assert.equal(setup.status,200,JSON.stringify(setup.data));
standard=setup.data.item;
assert.equal(standard.game.phase,'move');
assert.equal(standard.game.activeTeam,0);
assert.equal((await standardCommand({type:'hold',id:0,version:standard.version})).status,422);
const referee=new Game();
Object.assign(referee,structuredClone(standard.game));referee.rebuildMap();
const entry=referee.reachable(referee.units[0],'walk')[0];
assert(entry,'available walk entry on the standard map');
setup=await standardCommand({type:'move',id:0,q:entry.q,r:entry.r,mode:'walk',version:standard.version});
assert.equal(setup.status,200,JSON.stringify(setup.data));
standard=setup.data.item;
assert.equal(standard.effect.result.entry,true);
assert.equal(standard.game.units[0].deployed,true);
assert.deepEqual([standard.game.units[0].q,standard.game.units[0].r,standard.game.units[0].spent],
  [entry.q,entry.r,entry.cost]);
assert.equal((await readStandard()).data.item.game.units[0].deployed,true);
setup=await standardCommand({type:'hold',id:0,version:standard.version});
assert.equal(setup.status,200,JSON.stringify(setup.data));
standard=setup.data.item;
assert(standard.game.units.filter(u=>!u.dead).every(u=>u.deployed===true));
assert.equal(standard.game.queue.length,0);
setup=await standardCommand({type:'next',version:standard.version});
assert.equal(setup.status,200,JSON.stringify(setup.data));
assert.equal(setup.data.item.game.phase,'fire');
assert.equal((await req(standardPath+'/abandon',{method:'POST',cookie:owner.cookie})).status,200);
console.log('AGoAC p.6 standard server deployment passed: draft selection, persisted edges, entry and phase transition');

// Test a real reload transaction against a guaranteed depleted magazine.
// The isolated test database is the only place we manipulate the starting
// ammo fixture directly; game clients have no such mutation endpoint.
const reloadBin=magazinesInReport[0],key=reloadBin.location+':'+reloadBin.slot;
const pool=createPool();
try{
  const current=(await pool.query('SELECT ammo_state FROM hangar_mechs WHERE id=$1',[mechId]))
    .rows[0].ammo_state||{};
  current[key]=0;
  await pool.query('UPDATE hangar_mechs SET ammo_state=$2::jsonb WHERE id=$1',
    [mechId,JSON.stringify(current)]);
}finally{await pool.end();}
const reloadBody={mechId,location:reloadBin.location,slot:reloadBin.slot};
const shopBefore=await req('/api/v1/economy',{cookie:owner.cookie});
assert.equal(shopBefore.data.magazines.find(m=>m.mechId===mechId&&
  m.location===reloadBody.location&&m.slot===reloadBody.slot).rounds,0);
assert.equal((await req('/api/v1/economy/reload',{method:'POST',cookie:other.cookie,
  body:reloadBody})).status,404);
assert.equal((await req('/api/v1/economy/reload',{method:'POST',cookie:owner.cookie,
  origin:false,body:reloadBody})).status,403);
assert.equal((await req('/api/v1/economy/reload',{method:'POST',cookie:owner.cookie,
  body:{...reloadBody,rounds:999}})).status,422);
assert.equal((await req('/api/v1/economy/reload',{method:'POST',cookie:owner.cookie,
  body:reloadBody})).status,409,'Reload must consume an owned pack');
const ammoSku='ammo:'+reloadBin.weapon;
const ammoOffer=shopBefore.data.catalog.find(x=>x.sku===ammoSku);
assert(ammoOffer,'Every operational magazine must have a purchasable refill');
const newPack=await req('/api/v1/economy/purchase',{method:'POST',cookie:owner.cookie,
  body:{sku:ammoSku,quantity:1}});
assert.equal(newPack.status,200,JSON.stringify(newPack.data));
assert.equal(newPack.data.item.spent,ammoOffer.price);
const loaded=await req('/api/v1/economy/reload',{method:'POST',cookie:owner.cookie,
  body:reloadBody});
assert.equal(loaded.status,200,JSON.stringify(loaded.data));
assert.equal(loaded.data.item.rounds,reloadBin.capacity);
const finalShop=await req('/api/v1/economy',{cookie:owner.cookie});
assert.equal(finalShop.data.equipmentStock[ammoSku],0);
assert.equal(finalShop.data.balance,shopBefore.data.balance-ammoOffer.price);
assert.equal(finalShop.data.magazines.find(m=>m.mechId===mechId&&
  m.location===reloadBody.location&&m.slot===reloadBody.slot).rounds,
  reloadBin.capacity);
assert.equal((await req('/api/v1/economy/reload',{method:'POST',cookie:owner.cookie,
  body:reloadBody})).status,409,'Reload cannot consume another pack twice');
console.log('Ammo logistics passed: combat magazine persistence, isolated storage, owner-only pack purchases, one-time reload');

// Critical-damage fixture only in disposable CI PostgreSQL. These mutations
// are not available to browsers; the combat engine records the same slots.
const criticalDB=createPool();
let criticalConfig,weaponIndex,damageFixture,brokenAmmo,brokenWeapon;
try{
  const row=(await criticalDB.query(
    'SELECT state,ammo_state FROM hangar_mechs WHERE id=$1',[mechId])).rows[0];
  criticalConfig=row.state.config;
  const unit=construct(criticalConfig).unit;
  const physicalSlots=Object.entries(unit.slots)
    .flatMap(([location,slots])=>slots.map((value,index)=>({
      location,slot:index+1,value
    })));
  const weaponSlot=physicalSlots.find(s=>s.value?.startsWith('w:'));
  const ammoSlot=physicalSlots.find(s=>s.value?.startsWith('ammo:'));
  assert(weaponSlot&&ammoSlot,'Imported mech needs real weapon and magazine criticals');
  weaponIndex=Number(weaponSlot.value.slice(2));
  damageFixture={};
  for(const entry of [{location:'CT',slot:1},weaponSlot,ammoSlot]){
    (damageFixture[entry.location]??=[]).push(entry.slot-1);
  }
  const previous=structuredClone(row.ammo_state||{});
  previous[ammoSlot.location+':'+ammoSlot.slot]=0;
  await criticalDB.query(
    'UPDATE hangar_mechs SET critical_damage=$2::jsonb,ammo_state=$3::jsonb '+
    'WHERE id=$1',
    [mechId,JSON.stringify(damageFixture),JSON.stringify(previous)]);
  brokenAmmo=ammoSlot;
  brokenWeapon=weaponSlot;
}finally{await criticalDB.end();}
const failures=(await req('/api/v1/economy',{cookie:owner.cookie})).data;
const broken=failures.components.filter(part=>part.mechId===mechId);
assert.equal(broken.length,3,'Engine + weapon + ammo bin are physically damaged');
const weaponPart=broken.find(part=>part.kind==='weapon');
const ammoPart=broken.find(part=>part.kind==='ammo');
const enginePart=broken.find(part=>part.name==='Двигатель');
assert(weaponPart&&ammoPart&&enginePart);
assert.equal(enginePart.serviceCost,6000);
assert.equal(weaponPart.requiredStock,0);
assert.equal(failures.magazines.find(m=>m.mechId===mechId&&
  m.location===brokenAmmo.location&&m.slot===brokenAmmo.slot).damaged,true);
assert.equal((await req('/api/v1/economy/reload',{
  method:'POST',cookie:owner.cookie,
  body:{mechId,location:brokenAmmo.location,slot:brokenAmmo.slot}
})).data.error,'magazine_damaged',
  'A destroyed magazine may not be reloaded without replacing the bin');
assert.equal((await req('/api/v1/hangar/'+mechId,{
  method:'PATCH',cookie:owner.cookie,body:{config:criticalConfig}
})).data.error,'mech_needs_component_repair',
  'Refits must not return broken weapons to the working warehouse');

const damagedMission=await req('/api/v1/operations',{
  method:'POST',cookie:owner.cookie,
  body:{title:'Проверка повреждённого меха',mechIds:[mechId],
    mode:'interactive'}
});
assert.equal(damagedMission.status,201,JSON.stringify(damagedMission.data));
const damagedStarted=await req('/api/v1/operations/'+damagedMission.data.item.id+
  '/launch',{method:'POST',cookie:owner.cookie});
assert.equal(damagedStarted.status,200,JSON.stringify(damagedStarted.data));
const battleDb=createPool();
try{
  const row=(await battleDb.query(
    'SELECT battle_state FROM combat_operations WHERE id=$1',
    [damagedMission.data.item.id])).rows[0];
  const mech=row.battle_state.game.units[0];
  assert.equal(mech.engineHits,1);
  assert.equal(mech.weapons[weaponIndex].destroyed,true);
  assert.equal(mech.bins.find(b=>b.location===brokenAmmo.location&&
    b.slot===brokenAmmo.slot-1).destroyed,true);
}finally{await battleDb.end();}
assert.equal((await req('/api/v1/economy/components/repair',{
  method:'POST',cookie:owner.cookie,
  body:{mechId,partId:enginePart.id}
})).data.error,'mech_assigned_operation');
assert.equal((await req('/api/v1/operations/'+damagedMission.data.item.id+
  '/abandon',{method:'POST',cookie:owner.cookie})).status,200);

const requestRepair=partId=>req('/api/v1/economy/components/repair',{
  method:'POST',cookie:owner.cookie,body:{mechId,partId}
});
assert.equal((await req('/api/v1/economy/components/repair',{
  method:'POST',cookie:other.cookie,
  body:{mechId,partId:weaponPart.id}
})).status,404,'No cross-account equipment repairs');
assert.equal((await req('/api/v1/economy/components/repair',{
  method:'POST',cookie:owner.cookie,origin:false,
  body:{mechId,partId:weaponPart.id}
})).status,403);
assert.equal((await req('/api/v1/economy/components/repair',{
  method:'POST',cookie:owner.cookie,
  body:{mechId,partId:weaponPart.id,price:0}
})).status,422);
assert.equal((await requestRepair(weaponPart.id)).status,409,
  'A destroyed weapon must be replaced from owned stock');

for(const part of [weaponPart,ammoPart]){
  const offer=failures.catalog.find(x=>x.sku===
    (part.kind==='weapon'?'weapon:'+part.sku:part.sku));
  assert(offer);
  const bought=await req('/api/v1/economy/purchase',{
    method:'POST',cookie:owner.cookie,body:{sku:offer.sku,quantity:1}
  });
  assert.equal(bought.status,200,JSON.stringify(bought.data));
  const fixed=await requestRepair(part.id);
  assert.equal(fixed.status,200,JSON.stringify(fixed.data));
  assert.equal(fixed.data.item.sku,part.sku);
  assert.equal((await requestRepair(part.id)).status,409,
    'Repairing an already replaced component must not consume a second item');
}
const beforeEngine=(await req('/api/v1/economy',{cookie:owner.cookie})).data.balance;
const engineFixed=await requestRepair(enginePart.id);
assert.equal(engineFixed.status,200,JSON.stringify(engineFixed.data));
assert.equal(engineFixed.data.item.spent,6000);
const afterEngine=(await req('/api/v1/economy',{cookie:owner.cookie})).data;
assert.equal(afterEngine.balance,beforeEngine-6000);
assert.equal(afterEngine.components.filter(part=>part.mechId===mechId).length,0);
assert.equal(afterEngine.magazines.find(m=>m.mechId===mechId&&
  m.location===brokenAmmo.location&&m.slot===brokenAmmo.slot).rounds,
  failures.magazines.find(m=>m.mechId===mechId&&
    m.location===brokenAmmo.location&&m.slot===brokenAmmo.slot).capacity);
const restoredMech=(await req('/api/v1/hangar',{cookie:owner.cookie}))
  .data.items.find(item=>item.id===mechId);
assert.deepEqual(restoredMech.criticalDamage,{});
console.log('Component damage passed: per-slot battle persistence, critical engine effects, damaged inventory isolation, spare-parts replacement and paid core service');

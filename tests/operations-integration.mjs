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
assert.equal(snapshot.data.item.game.units[0].name,example.name);

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

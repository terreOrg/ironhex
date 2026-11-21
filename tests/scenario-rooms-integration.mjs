// Real API + PostgreSQL smoke in isolated CI containers, never production.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPool} from '../apps/api/src/db.mjs';
const base='http://127.0.0.1:3000',suffix=randomBytes(5).toString('hex');
const pool=createPool(),password='Ch11-PG-Integration-2026!';
async function req(path,{method='GET',body,cookie,origin=true}={}){
 const headers={};
 if(method!=='GET'){headers['Content-Type']='application/json';if(origin)headers.Origin=base;}
 if(cookie)headers.Cookie=cookie;
 const res=await fetch(base+path,{method,headers,
  body:method==='GET'?undefined:JSON.stringify(body??{})});
 return {status:res.status,data:await res.json().catch(()=>({})),
  cookie:res.headers.get('set-cookie')};
}
function checked(res,status,label){
 assert.equal(res.status,status,label+': '+JSON.stringify(res.data));return res.data;
}
async function account(prefix){
 const handle=prefix+suffix;
 const data=await req('/api/v1/auth/register',{method:'POST',
  body:{handle,email:handle.toLowerCase()+'@example.invalid',password}});
 checked(data,201,'register '+prefix);
 assert.match(data.cookie??'',/HttpOnly/);
 return {handle,id:data.data.user.id,cookie:data.cookie.split(';')[0]};
}
try{
 const attacker=await account('Attack'),command=await account('Command'),
  recon=await account('Recon');
 const accounts={attacker,command,recon};
 assert.equal(new Set(Object.values(accounts).map(x=>x.id)).size,3);
 for(const shortened of [false,true]){
  const tag=shortened?'shortened':'full';
  const created=checked(await req('/api/v1/scenario-rooms',{
   method:'POST',cookie:attacker.cookie,body:{roles:{
    attacker:attacker.handle,command:command.handle,recon:recon.handle}}
  }),201,tag+' create');
  const id=created.item.id,route='/api/v1/scenario-rooms/'+id;
  assert.equal(created.item.version,0);
  checked(await req(route+'/accept',{method:'POST',cookie:command.cookie}),200,
   tag+' command accepts');
  const accepted=checked(await req(route+'/accept',{
   method:'POST',cookie:recon.cookie}),200,tag+' recon accepts');
  assert.equal(accepted.item.status,'ready');
  assert.equal(accepted.item.version,2);
  assert.equal((await req(route+'/start',{
   method:'POST',cookie:command.cookie,body:{version:2,shortened}
  })).status,403,'Nonhost cannot start');
  const started=checked(await req(route+'/start',{
   method:'POST',cookie:attacker.cookie,body:{version:2,shortened}
  }),200,tag+' start');
  assert.equal(started.item.version,3);
  const winner=started.game.scenario.sideRollWinner;
  assert([0,1].includes(winner));
  const winnerRole=winner===0?'attacker':'command';
  const action={version:3,action:{type:'select-side',
   role:winner===0?'attacker':'defender'}};
  const denied=await req(route+'/setup',{method:'POST',
   cookie:recon.cookie,body:action});
  assert.equal(denied.status,403);
  assert.equal(denied.data.error,'wrong_side_choice_controller');
  assert.equal((await req(route,{cookie:attacker.cookie})).data.item.version,3);
  const chosen=checked(await req(route+'/setup',{method:'POST',
   cookie:accounts[winnerRole].cookie,body:action}),200,tag+' select side');
  assert.equal(chosen.item.version,4);
  assert.deepEqual(chosen.game.setupMap.sheets.map(s=>s.name),
   ['Desert #2','Grassland #3']);
  assert.deepEqual(chosen.game.setupMap.sheets.map(s=>s.side),['west','east']);
  assert.equal(chosen.game.tiles.length,544);
  for(const [index,name] of ['Desert #2','Grassland #3'].entries()){
   const tiles=chosen.game.tiles.filter(t=>t.sheet===index);
   assert.equal(tiles.length,272);
   assert(tiles.every(t=>t.printedSheet===name));
  }
  assert.equal(chosen.game.units.filter(u=>!u.notFielded).length,shortened?7:10);
  assert.equal((await req(route+'/setup',{method:'POST',
   cookie:accounts[winnerRole].cookie,body:action})).status,409);
  for(const [role,seat]of Object.entries(accounts)){
   const response=checked(await req(route+'/snapshot',{cookie:seat.cookie}),
    200,tag+' '+role+' snapshot');
   assert.equal(response.item.yourRole,role);
   assert.equal(response.item.version,4);
   assert.deepEqual(response.game.setupMap.sheets.map(s=>s.name),
    ['Desert #2','Grassland #3']);
   assert(!JSON.stringify(response).includes('rngState'));
  }
  const row=(await pool.query('SELECT version,battle_state FROM agoac_scenario_rooms WHERE id=$1',
   [id])).rows[0];
  assert.equal(row.version,4);
  const saved=row.battle_state;
  assert(Number.isInteger(saved.rngState));
  const corrupt=structuredClone(saved);
  corrupt.game.setupMap.sheets[0].name='Desert #3';
  await pool.query('UPDATE agoac_scenario_rooms SET battle_state=$2::jsonb WHERE id=$1',
   [id,JSON.stringify(corrupt)]);
  const badGet=await req(route+'/snapshot',{cookie:attacker.cookie});
  assert.equal(badGet.status,409);
  assert.equal(badGet.data.error,'scenario_source_map_mismatch');
  const badMutation=await req(route+'/setup',{method:'POST',cookie:attacker.cookie,
   body:{version:4,action:{type:'place-terrain',q:0,r:0,terrainType:'depth1',
    footprint:[{q:0,r:0},{q:1,r:0}]}}});
  assert.equal(badMutation.status,409);
  assert.equal(badMutation.data.error,'scenario_source_map_mismatch');
  assert.equal((await pool.query('SELECT version FROM agoac_scenario_rooms WHERE id=$1',
   [id])).rows[0].version,4);
  await pool.query('UPDATE agoac_scenario_rooms SET battle_state=$2::jsonb WHERE id=$1',
   [id,JSON.stringify(saved)]);
  checked(await req(route+'/snapshot',{cookie:attacker.cookie}),200,
   tag+' valid map restored');
 }
 console.log('AGoAC Ch11: real PostgreSQL and three-session full/shortened room lifecycle passed');
}finally{await pool.end();}

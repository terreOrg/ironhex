// Run inside the API image, against a real PostgreSQL-backed API and schema.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

const base='http://127.0.0.1:3000';
const origin=base;
const suffix=randomBytes(5).toString('hex');
const handle='Test'+suffix;
const email='ci-'+suffix+'@example.invalid';
const password='CI-Integration-Probe-42!';
async function request(path,{method='GET',body,cookie,withOrigin=true}={}) {
  const headers={};
  if (method!=='GET') {
    headers['Content-Type']='application/json';
    if (withOrigin) headers.Origin=origin;
  }
  if (cookie) headers.Cookie=cookie;
  const response=await fetch(base+path,{
    method,headers,body:method==='GET'?undefined:JSON.stringify(body||{})
  });
  const data=await response.json();
  return {status:response.status,data,cookie:response.headers.get('set-cookie')};
}
const meAnon=await request('/api/v1/auth/me');
assert.equal(meAnon.status,200);
assert.equal(meAnon.data.authenticated,false);
assert.equal((await request('/api/v1/hangar')).status,401);

const input={handle,email,password};
assert.equal((await request('/api/v1/auth/register',{
  method:'POST',body:input,withOrigin:false
})).status,403,'Cross-site registration must be blocked');

const created=await request('/api/v1/auth/register',{method:'POST',body:input});
assert.equal(created.status,201,JSON.stringify(created.data));
assert.equal(created.data.user.handle,handle);
assert.equal(created.data.user.email,email);
assert(!JSON.stringify(created.data).includes(password));
assert.match(created.cookie,/HttpOnly/);
assert.match(created.cookie,/SameSite=Strict/);
const firstCookie=created.cookie.split(';')[0];
assert.equal((await request('/api/v1/auth/register',{method:'POST',body:input})).status,409);
const who=await request('/api/v1/auth/me',{cookie:firstCookie});
assert.equal(who.data.authenticated,true);
assert.equal(who.data.user.handle,handle);
const hangar=await request('/api/v1/hangar',{cookie:firstCookie});
assert.equal(hangar.status,200);
assert.deepEqual(hangar.data.items,[]);
assert.equal((await request('/api/v1/auth/login',{
  method:'POST',body:{identity:email,password:'wrong-password'}
})).status,401);
const logged=await request('/api/v1/auth/login',{
  method:'POST',body:{identity:handle.toUpperCase(),password}
});
assert.equal(logged.status,200,JSON.stringify(logged.data));
assert.equal(logged.data.user.id,created.data.user.id);
const loggedCookie=logged.cookie.split(';')[0];
assert.notEqual(firstCookie,loggedCookie,'Every login creates a distinct session');
const blocked=await request('/api/v1/auth/logout',{
  method:'POST',body:{},cookie:loggedCookie,withOrigin:false
});
assert.equal(blocked.status,403);
const logout=await request('/api/v1/auth/logout',{
  method:'POST',body:{},cookie:loggedCookie
});
assert.equal(logout.status,200);
assert.match(logout.cookie,/Max-Age=0/);
assert.equal((await request('/api/v1/auth/me',{cookie:loggedCookie})).data.authenticated,false);
assert.equal((await request('/api/v1/auth/me',{cookie:firstCookie})).data.authenticated,true);

const {example}=await import('../packages/engine/construction.js');
const design={config:example,callsign:'Scout-01'};
const noAuth=await request('/api/v1/hangar',{method:'POST',body:design});
assert.equal(noAuth.status,401,'Anonymous users cannot save a mech');
const badCsrf=await request('/api/v1/hangar',{
  method:'POST',body:design,cookie:firstCookie,withOrigin:false
});
assert.equal(badCsrf.status,403,'Cross-origin saves are forbidden');
const invalid=await request('/api/v1/hangar',{
  method:'POST',body:{config:{...example,tonnage:0}},cookie:firstCookie
});
assert.equal(invalid.status,422,'Server validates mech designs');
const stored=await request('/api/v1/hangar',{
  method:'POST',body:design,cookie:firstCookie
});
assert.equal(stored.status,201,JSON.stringify(stored.data));
const mechId=stored.data.item.id;
assert.equal(stored.data.item.chassis,example.name);
assert.equal(stored.data.item.callsign,'Scout-01');
const listed=await request('/api/v1/hangar',{cookie:firstCookie});
assert.equal(listed.data.items.length,1);
assert.equal(listed.data.items[0].id,mechId);
assert.equal(listed.data.items[0].state.config.name,example.name);
const other=await request('/api/v1/auth/register',{method:'POST',body:{
  handle:'Other'+suffix,email:'other-'+suffix+'@example.invalid',password
}});
assert.equal(other.status,201);
const otherCookie=other.cookie.split(';')[0];
assert.deepEqual((await request('/api/v1/hangar',{cookie:otherCookie})).data.items,[],
  'Hangars are private to each account');
assert.equal((await request('/api/v1/hangar/'+mechId,{
  method:'PATCH',cookie:otherCookie,body:design
})).status,404,'Other commanders cannot modify a mech');
assert.equal((await request('/api/v1/hangar/'+mechId,{
  method:'DELETE',cookie:otherCookie
})).status,404,'Other commanders cannot delete a mech');
const edited=await request('/api/v1/hangar/'+mechId,{
  method:'PATCH',body:{config:{...example,name:'Refitted Griffin'},callsign:'Lead'},cookie:firstCookie
});
assert.equal(edited.status,200,JSON.stringify(edited.data));
assert.equal(edited.data.item.chassis,'Refitted Griffin');
assert.equal((await request('/api/v1/hangar',{cookie:firstCookie})).data.items[0].callsign,'Lead');

const unauthPilot=await request('/api/v1/pilots');
assert.equal(unauthPilot.status,401);
const pilotInput={fullName:'Mara Voss',callsign:'Raven',faction:'mercenary',portrait:3};
const badPilot=await request('/api/v1/pilots',{
  method:'POST',cookie:firstCookie,body:{...pilotInput,gunnery:0,experience:999999}
});
assert.equal(badPilot.status,422,'Client must not assign free experience or skills');
assert.equal((await request('/api/v1/pilots',{
  method:'POST',body:pilotInput,cookie:firstCookie,withOrigin:false
})).status,403,'Pilot creation requires same-origin request');
const createdPilot=await request('/api/v1/pilots',{
  method:'POST',body:pilotInput,cookie:firstCookie
});
assert.equal(createdPilot.status,201,JSON.stringify(createdPilot.data));
const pilotId=createdPilot.data.item.id;
assert.equal(createdPilot.data.item.gunnery,4);
assert.equal(createdPilot.data.item.piloting,5);
assert.equal(createdPilot.data.item.experience,0);
assert.equal(createdPilot.data.item.callsign,'Raven');
assert.equal(createdPilot.data.item.assignedMechId,null);
assert.equal((await request('/api/v1/pilots',{cookie:otherCookie})).data.items.length,0);
assert.equal((await request('/api/v1/pilots/'+pilotId,{cookie:otherCookie})).status,404);
assert.equal((await request('/api/v1/pilots/'+pilotId+'/history',{cookie:otherCookie})).status,404);
assert.equal((await request('/api/v1/pilots/'+pilotId,{
  method:'PATCH',cookie:otherCookie,body:pilotInput
})).status,404);
assert.equal((await request('/api/v1/pilots/'+pilotId,{
  method:'DELETE',cookie:otherCookie
})).status,404);
assert.equal((await request('/api/v1/hangar/'+mechId+'/pilot',{
  method:'PUT',cookie:otherCookie,body:{pilotId}
})).status,404);
assert.equal((await request('/api/v1/hangar/'+mechId+'/pilot',{
  method:'PUT',cookie:firstCookie,body:{pilotId:'not-a-uuid'}
})).status,422);
assert.equal((await request('/api/v1/hangar/'+mechId+'/pilot',{
  method:'PUT',cookie:firstCookie,body:{pilotId},withOrigin:false
})).status,403);
const assignment=await request('/api/v1/hangar/'+mechId+'/pilot',{
  method:'PUT',cookie:firstCookie,body:{pilotId}
});
assert.equal(assignment.status,200,JSON.stringify(assignment.data));
const roster=await request('/api/v1/pilots',{cookie:firstCookie});
assert.equal(roster.data.items.length,1);
assert.equal(roster.data.items[0].assignedMechId,mechId);
const events=await request('/api/v1/pilots/'+pilotId+'/history',{cookie:firstCookie});
assert.equal(events.status,200);
assert.deepEqual(events.data.items,[],'No rewards until battle result is server authoritative');
const changedPilot=await request('/api/v1/pilots/'+pilotId,{
  method:'PATCH',cookie:firstCookie,body:{...pilotInput,callsign:'Night Raven',portrait:7}
});
assert.equal(changedPilot.status,200);
assert.equal(changedPilot.data.item.callsign,'Night Raven');
assert.equal(changedPilot.data.item.portrait,7);
const otherPilot=await request('/api/v1/pilots',{method:'POST',cookie:otherCookie,body:{
  ...pilotInput,callsign:'Enemy'
}});
assert.equal(otherPilot.status,201);
assert.equal((await request('/api/v1/hangar/'+mechId+'/pilot',{
  method:'PUT',cookie:firstCookie,body:{pilotId:otherPilot.data.item.id}
})).status,404,'Cannot assign a rival commander’s pilot');
const secondMech=await request('/api/v1/hangar',{method:'POST',cookie:firstCookie,body:design});
assert.equal(secondMech.status,201);
assert.equal((await request('/api/v1/hangar/'+secondMech.data.item.id+'/pilot',{
  method:'PUT',cookie:firstCookie,body:{pilotId}
})).status,409,'Pilot cannot crew two mechs simultaneously');
assert.equal((await request('/api/v1/hangar/'+mechId+'/pilot',{
  method:'PUT',cookie:firstCookie,body:{pilotId:null}
})).status,200);
assert.equal((await request('/api/v1/hangar/'+secondMech.data.item.id+'/pilot',{
  method:'PUT',cookie:firstCookie,body:{pilotId}
})).status,200);
assert.equal((await request('/api/v1/pilots/'+pilotId,{
  method:'DELETE',cookie:firstCookie
})).status,200);
assert.equal((await request('/api/v1/pilots',{cookie:firstCookie})).data.items.length,0);
assert.equal((await request('/api/v1/hangar/'+secondMech.data.item.id+'/pilot',{
  method:'PUT',cookie:firstCookie,body:{pilotId:null}
})).status,200);
assert.equal((await request('/api/v1/hangar/'+secondMech.data.item.id,{
  method:'DELETE',cookie:firstCookie
})).status,200);

const removed=await request('/api/v1/hangar/'+mechId,{
  method:'DELETE',cookie:firstCookie
});
assert.equal(removed.status,200);
assert.deepEqual((await request('/api/v1/hangar',{cookie:firstCookie})).data.items,[]);
assert.equal((await request('/api/v1/hangar/'+mechId,{
  method:'DELETE',cookie:firstCookie
})).status,404);

console.log('Real PostgreSQL auth and private hangar integration passed: register, login, owner isolation, save/edit/delete, validation, CSRF');

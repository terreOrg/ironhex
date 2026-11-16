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
console.log('Real PostgreSQL auth integration passed: register, login, session, logout, CSRF, hangar');

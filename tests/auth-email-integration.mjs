import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createPool} from '../apps/api/src/db.mjs';
import {createAuthStore} from '../apps/api/src/auth.mjs';
import {createAccountFlows} from '../apps/api/src/account-flows.mjs';
import {createHttpServer} from '../apps/api/src/http.mjs';
import {createBrevoMailer} from '../apps/api/src/mail.mjs';
import {once} from 'node:events';

const sent=[];
const fakeMailer={
  enabled:true,
  async send({to,purpose,token}) {sent.push({to,purpose,token});return true;}
};
const pool=createPool();
const authStore=createAuthStore(pool,{requireVerifiedEmail:true});
const accountFlows=createAccountFlows(pool,{mailer:fakeMailer});
const server=createHttpServer({authStore,accountFlows});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
async function request(path,{method='GET',body,cookie,origin=base}={}) {
  const headers={};
  if(method!=='GET') {
    headers.Origin=origin;
    headers['Content-Type']='application/json';
  }
  if(cookie) headers.Cookie=cookie;
  const response=await fetch(base+path,{method,headers,body:method==='GET'?undefined:JSON.stringify(body||{})});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
}
const suffix=randomBytes(6).toString('hex');
const handle='Verify'+suffix;
const email='verify-'+suffix+'@example.invalid';
const firstPassword='First-Secret-Pass-2026!';
const secondPassword='Second-Secret-Pass-2026!';
try {
  const registered=await request('/api/v1/auth/register',{method:'POST',body:{handle,email,password:firstPassword}});
  assert.equal(registered.status,201,JSON.stringify(registered.body));
  assert.equal(registered.body.user.emailVerified,false);
  assert.equal(registered.body.user.emailVerificationRequired,true);
  assert.equal(sent.length,1);
  assert.equal(sent[0].purpose,'verify');
  assert.equal(sent[0].to,email);
  const cookie=registered.cookie.split(';')[0];
  assert.equal((await request('/api/v1/hangar',{cookie})).status,403);
  const extra=await request('/api/v1/auth/resend-verification',{method:'POST',cookie});
  assert.equal(extra.status,200);
  assert.equal(sent.length,2);
  assert.notEqual(sent[0].token,sent[1].token);
  assert.equal((await request('/api/v1/auth/verify-email',{
    method:'POST',body:{token:sent[0].token}
  })).status,400);
  const verified=await request('/api/v1/auth/verify-email',{
    method:'POST',body:{token:sent[1].token}
  });
  assert.equal(verified.status,200,JSON.stringify(verified.body));
  assert.equal((await request('/api/v1/auth/verify-email',{
    method:'POST',body:{token:sent[1].token}
  })).status,400);
  const me=await request('/api/v1/auth/me',{cookie});
  assert.equal(me.body.user.emailVerified,true);
  assert.equal((await request('/api/v1/hangar',{cookie})).status,200);
  const unknown=await request('/api/v1/auth/request-reset',{
    method:'POST',body:{email:'missing-'+suffix+'@example.invalid'}
  });
  const resetReq=await request('/api/v1/auth/request-reset',{
    method:'POST',body:{email}
  });
  assert.deepEqual(unknown.body,resetReq.body);
  assert.equal(resetReq.status,200);
  assert.equal(sent.at(-1).purpose,'reset');
  const token=sent.at(-1).token;
  assert.equal((await request('/api/v1/auth/reset-password',{
    method:'POST',origin:'https://attacker.example',body:{token,password:secondPassword}
  })).status,403);
  assert.equal((await request('/api/v1/auth/reset-password',{
    method:'POST',body:{token:'f'.repeat(64),password:secondPassword}
  })).status,400);
  const changed=await request('/api/v1/auth/reset-password',{
    method:'POST',body:{token,password:secondPassword}
  });
  assert.equal(changed.status,200,JSON.stringify(changed.body));
  assert.match(changed.cookie,/Max-Age=0/);
  assert.equal((await request('/api/v1/auth/reset-password',{
    method:'POST',body:{token,password:secondPassword}
  })).status,400);
  assert.equal((await request('/api/v1/auth/me',{cookie})).body.authenticated,false);
  assert.equal((await request('/api/v1/auth/login',{
    method:'POST',body:{identity:email,password:firstPassword}
  })).status,401);
  const login=await request('/api/v1/auth/login',{
    method:'POST',body:{identity:email,password:secondPassword}
  });
  assert.equal(login.status,200);
  assert.equal(login.body.user.emailVerified,true);
  const calls=[];
  const mailer=createBrevoMailer({
    apiKey:'test-key',
    sender:'verified@example.invalid',
    publicOrigin:'https://ironhex.krbox.top',
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      return {ok:true,status:201};
    }
  });
  await mailer.send({to:email,purpose:'verify',token:'a'.repeat(64)});
  assert.equal(calls[0].url,'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[0].options.headers['api-key'],'test-key');
  const payload=JSON.parse(calls[0].options.body);
  assert.equal(payload.to[0].email,email);
  assert.match(payload.textContent,/#verify=/);
  assert.throws(()=>createBrevoMailer({
    apiKey:'test-key',sender:'verified@example.invalid',
    publicOrigin:'http://ironhex.lan'
  }),/HTTPS/);
  console.log('PostgreSQL email verification, reset, session revocation, Brevo request validated');
} finally {
  await new Promise(resolve=>server.close(resolve));
  await pool.end();
}

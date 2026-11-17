import {createAccountFlows} from '../apps/api/src/account-flows.mjs';
import {validEmailAddress} from '../apps/api/src/email-address.mjs';
import {createBrevoMailer} from '../apps/api/src/mail.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  AuthError, validateRegistration, validateIdentity, hashPassword,
  verifyPassword, makeSessionCookie, extractSession, tokenHash
} from '../apps/api/src/auth.mjs';

test('validates account fields and enforces strong passwords',()=>{
  const x=validateRegistration({
    handle:' Atlas_01 ',email:' Atlas@Example.COM ',password:'example long private pass!'
  });
  assert.equal(x.handle,'Atlas_01');
  assert.equal(x.email,'atlas@example.com');
  assert.equal(validateIdentity(' HELLO@example.com '),'hello@example.com');
  for(const item of [
    {handle:'x',email:'valid@example.com',password:'long long password'},
    {handle:'valid',email:'not-an-email',password:'long long password'},
    {handle:'valid',email:'valid@example.com',password:'short'}
  ]) assert.throws(()=>validateRegistration(item),AuthError);
});

test('passwords are salted and protected using scrypt',async()=>{
  const a=await hashPassword('example long private pass!');
  const b=await hashPassword('example long private pass!');
  assert.notEqual(a,b,'Unique salts are required');
  assert(a.startsWith('scrypt$16384$'));
  assert.equal(await verifyPassword('example long private pass!',a),true);
  assert.equal(await verifyPassword('wrong password',a),false);
  assert.equal(await verifyPassword('password','corrupt'),false);
});

test('random session cookies are HttpOnly and SameSite Strict',()=>{
  const token='a'.repeat(64);
  const cookie=makeSessionCookie(token,{secure:true});
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/Secure/);
  assert.equal(extractSession(cookie),token);
  assert.equal(extractSession('ironhex_session=wrong'),null);
  assert.equal(tokenHash(token).length,64);
  assert.match(makeSessionCookie('',{clear:true}),/Max-Age=0/);
});

test('email validation preserves existing boundaries without backtracking',()=>{
  const valid={maxLocalLength:64,minSuffixLength:2};
  for(const address of ['a@example.com','a@b.c.de','a'.repeat(64)+'@example.com'])
    assert.equal(validEmailAddress(address,valid),true,address);
  for(const address of ['a'.repeat(65)+'@example.com','a@b.c','a@@example.com','a b@example.com','a@example','@example.com','a@.com','a@b.'+' '.repeat(100000)])
    assert.equal(validEmailAddress(address,valid),false,address.slice(0,80));
  assert.equal(validEmailAddress(null),false);
  assert.equal(validEmailAddress('a@b.c'),true);
});
test('Brevo validates sender and HTTPS origin and delivers an encoded verification link',async()=>{
  const calls=[];
  const options={apiKey:'test-only',sender:'service@example.com',publicOrigin:'https://example.com',
    fetchImpl:async(url,config)=>{calls.push({url,config});return {ok:true};}};
  assert.throws(()=>createBrevoMailer({...options,sender:'a@b'}),/verified sender/);
  assert.throws(()=>createBrevoMailer({...options,publicOrigin:'http://example.com'}),/HTTPS/);
  assert.equal(createBrevoMailer().enabled,false);
  const mailer=createBrevoMailer(options);
  assert.equal(await mailer.send({to:'pilot@example.com',purpose:'verify',token:'a&b'}),true);
  const payload=JSON.parse(calls[0].config.body);
  assert.match(payload.textContent,/https:\/\/example\.com\/#verify=a%26b/);
  await assert.rejects(createBrevoMailer({...options,fetchImpl:async()=>({ok:false})}).send({to:'pilot@example.com',purpose:'reset',token:'x'}),/mail_delivery_failed/);
});

function scriptedQueries(steps){
  const remaining=[...steps];
  const query=async(sql,params=[])=>{
    const step=remaining.shift();
    assert.ok(step,'Unexpected SQL: '+sql);
    assert.match(sql,step.sql);
    if(step.check)await step.check(params);
    if(step.error)throw step.error;
    return {rows:step.rows||[]};
  };
  let releases=0,connections=0;
  const pool={query,async connect(){connections++;return {query,release(){releases++;}};}};
  return {pool,done(expectedConnections=0){
    assert.equal(remaining.length,0,'Every expected query was executed');
    assert.equal(connections,expectedConnections);
    assert.equal(releases,expectedConnections);
  }};
}
const authCode=code=>error=>error instanceof AuthError&&error.code===code;
test('verification links persist only token digests, replace older links and use the expiry',async()=>{
  let digest;
  const steps=scriptedQueries([
    {sql:/^SELECT email,email_verified_at/,rows:[{email:'pilot@example.com'}],check:p=>assert.deepEqual(p,['owner'])},
    {sql:/^DELETE FROM commander_action_tokens WHERE commander_id/,check:p=>assert.deepEqual(p,['owner','verify'])},
    {sql:/^INSERT INTO commander_action_tokens/,check:p=>{[digest]=p;assert.deepEqual(p.slice(1),['owner','verify',86400]);assert.match(digest,/^[0-9a-f]{64}$/);}}
  ]);
  const flows=createAccountFlows(steps.pool,{mailer:{enabled:true,async send(message){
    assert.equal(message.to,'pilot@example.com');assert.equal(message.purpose,'verify');
    assert.equal(tokenHash(message.token),digest);assert.notEqual(message.token,digest);
  }}});
  assert.equal(flows.emailAvailable,true);
  assert.deepEqual(await flows.sendVerification('owner'),{ok:true});steps.done();
});
test('failed verification delivery revokes the token and exposes a controlled error',async()=>{
  let digest;
  const steps=scriptedQueries([
    {sql:/^SELECT email,email_verified_at/,rows:[{email:'pilot@example.com'}]},
    {sql:/^DELETE FROM commander_action_tokens WHERE commander_id/},
    {sql:/^INSERT INTO commander_action_tokens/,check:p=>{[digest]=p;}},
    {sql:/^DELETE FROM commander_action_tokens WHERE token_hash/,check:p=>assert.deepEqual(p,[digest])}
  ]);
  const flows=createAccountFlows(steps.pool,{mailer:{enabled:true,async send(){throw new Error('provider unavailable');}}});
  await assert.rejects(flows.sendVerification('owner'),authCode('mail_unavailable'));steps.done();
});
test('verification refuses missing accounts, skips verified accounts and checks mail availability',async()=>{
  const steps=scriptedQueries([
    {sql:/^SELECT email,email_verified_at/,rows:[]},
    {sql:/^SELECT email,email_verified_at/,rows:[{email:'pilot@example.com',email_verified_at:'2026-01-01'}]},
    {sql:/^SELECT email,email_verified_at/,rows:[{email:'pilot@example.com'}]}
  ]);
  const flows=createAccountFlows(steps.pool,{mailer:{enabled:false}});
  assert.equal(flows.emailAvailable,false);
  await assert.rejects(flows.sendVerification('missing'),authCode('unauthorized'));
  assert.deepEqual(await flows.sendVerification('verified'),{ok:true,alreadyVerified:true});
  await assert.rejects(flows.sendVerification('owner'),authCode('mail_unavailable'));
  await assert.rejects(flows.requestReset('pilot@example.com'),authCode('mail_unavailable'));
  steps.done();
});
test('password recovery is non-enumerating and normalizes account identity',async()=>{
  let digest;
  const steps=scriptedQueries([
    {sql:/^SELECT commander_id,email/,rows:[],check:p=>assert.deepEqual(p,['missing@example.com'])},
    {sql:/^SELECT commander_id,email/,rows:[{commander_id:'owner',email:'pilot@example.com'}],check:p=>assert.deepEqual(p,['pilot@example.com'])},
    {sql:/^DELETE FROM commander_action_tokens WHERE commander_id/,check:p=>assert.deepEqual(p,['owner','reset'])},
    {sql:/^INSERT INTO commander_action_tokens/,check:p=>{[digest]=p;assert.deepEqual(p.slice(1),['owner','reset',1800]);}}
  ]);
  let messages=0;
  const flows=createAccountFlows(steps.pool,{mailer:{enabled:true,async send(message){
    messages++;assert.equal(message.purpose,'reset');assert.equal(tokenHash(message.token),digest);
  }}});
  await assert.rejects(flows.requestReset(null),authCode('invalid_email'));
  await assert.rejects(flows.requestReset('a'.repeat(255)),authCode('invalid_email'));
  assert.deepEqual(await flows.requestReset(' MISSING@example.com '),{ok:true});assert.equal(messages,0);
  assert.deepEqual(await flows.requestReset(' PILOT@example.com '),{ok:true});assert.equal(messages,1);
  steps.done();
});
test('verification consumes the matching unexpired token and rolls back invalid or failed actions',async()=>{
  const token='a'.repeat(64);
  const consume={sql:/^DELETE FROM commander_action_tokens WHERE token_hash=.*expires_at>now\(\) RETURNING commander_id/,check:p=>assert.deepEqual(p,[tokenHash(token),'verify'])};
  const steps=scriptedQueries([
    {sql:/^BEGIN$/},{...consume,rows:[{commander_id:'owner'}]},
    {sql:/^UPDATE commander_credentials SET email_verified_at=now\(\)/,check:p=>assert.deepEqual(p,['owner'])},{sql:/^COMMIT$/},
    {sql:/^BEGIN$/},{...consume,rows:[]},{sql:/^ROLLBACK$/},
    {sql:/^BEGIN$/},{...consume,rows:[{commander_id:'owner'}]},
    {sql:/^UPDATE commander_credentials/,error:Error('update failed')},{sql:/^ROLLBACK$/}
  ]);
  const flows=createAccountFlows(steps.pool,{mailer:{enabled:true}});
  await assert.rejects(flows.verifyEmail('bad'),authCode('invalid_token'));
  assert.deepEqual(await flows.verifyEmail(token),{ok:true});
  await assert.rejects(flows.verifyEmail(token),authCode('invalid_token'));
  await assert.rejects(flows.verifyEmail(token),/update failed/);
  steps.done(3);
});
test('password reset hashes the new password and revokes all sessions and tokens transactionally',async()=>{
  const token='b'.repeat(64),password='long private password';
  const steps=scriptedQueries([
    {sql:/^BEGIN$/},
    {sql:/^DELETE FROM commander_action_tokens WHERE token_hash=/,rows:[{commander_id:'owner'}],
      check:p=>assert.deepEqual(p,[tokenHash(token),'reset'])},
    {sql:/^UPDATE commander_credentials SET password_hash=/,check:async p=>{
      assert.equal(p[0],'owner');assert.notEqual(p[1],password);assert.equal(await verifyPassword(password,p[1]),true);
    }},
    {sql:/^DELETE FROM commander_sessions/,check:p=>assert.deepEqual(p,['owner'])},
    {sql:/^DELETE FROM commander_action_tokens WHERE commander_id/,check:p=>assert.deepEqual(p,['owner'])},
    {sql:/^COMMIT$/}
  ]);
  const flows=createAccountFlows(steps.pool,{mailer:{enabled:true}});
  assert.throws(()=>flows.resetPassword(token,'short'),authCode('weak_password'));
  assert.deepEqual(await flows.resetPassword(token,password),{ok:true});
  steps.done(1);
});

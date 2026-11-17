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

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

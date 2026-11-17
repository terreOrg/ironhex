import { validEmailAddress } from './email-address.mjs';
import { createHash, randomBytes, scrypt as callbackScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(callbackScrypt);
const COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_TTL = 60 * 60 * 24 * 7;
const fakeSalt = Buffer.alloc(16).toString('hex');

export class AuthError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < 12 ||
      password.length > 128 || Buffer.byteLength(password,'utf8') > 256) {
    throw new AuthError(400,'weak_password');
  }
  return password;
}

export function validateRegistration({ handle, email, password } = {}) {
  if (typeof handle !== 'string' || !/^[a-zA-Z0-9_-]{3,24}$/.test(handle.trim())) {
    throw new AuthError(400, 'invalid_handle');
  }
  if (typeof email !== 'string' || email.length > 254 ||
      !validEmailAddress(email.trim(),{maxLocalLength:64,minSuffixLength:2})) {
    throw new AuthError(400, 'invalid_email');
  }
  validateNewPassword(password);
  return { handle: handle.trim(), email: email.trim().toLowerCase(), password };
}

export function validateIdentity(identity) {
  if (typeof identity !== 'string' || !identity.trim() || identity.length > 254) {
    throw new AuthError(400, 'invalid_credentials');
  }
  return identity.trim().toLowerCase();
}

async function derive(password, saltHex) {
  return scrypt(password, Buffer.from(saltHex, 'hex'), 64, COST);
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return 'scrypt$16384$' + salt + '$' + hash.toString('hex');
}

export async function verifyPassword(password, encoded) {
  const fields = typeof encoded === 'string' ? encoded.split('$') : [];
  const valid = fields.length === 4 && fields[0] === 'scrypt' &&
    fields[1] === '16384' && /^[0-9a-f]{32}$/.test(fields[2] || '') &&
    /^[0-9a-f]{128}$/.test(fields[3] || '');
  const received = await derive(password, valid ? fields[2] : fakeSalt);
  const expected = valid ? Buffer.from(fields[3], 'hex') : Buffer.alloc(64);
  return valid && timingSafeEqual(received, expected);
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function makeSessionCookie(token, { secure = false, clear = false } = {}) {
  return 'ironhex_session=' + (clear ? '' : token) +
    '; Path=/api/; HttpOnly; SameSite=Strict' +
    (secure ? '; Secure' : '') +
    '; Max-Age=' + (clear ? 0 : SESSION_TTL);
}

export function extractSession(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  const item = cookieHeader.split(';').map(s => s.trim())
    .find(s => s.startsWith('ironhex_session='));
  const token = item?.slice('ironhex_session='.length);
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

function publicUser(row, requireVerifiedEmail = false) {
  return {
    id: row.id,
    handle: row.handle,
    email: row.email,
    emailVerified: !!row.email_verified_at,
    emailVerificationRequired: !!requireVerifiedEmail,
    createdAt: row.created_at
  };
}

export function createAuthStore(pool,{requireVerifiedEmail=false}={}) {
  async function createSession(id) {
    const token = randomBytes(32).toString('hex');
    await pool.query(
      'INSERT INTO commander_sessions (token_hash, commander_id, expires_at) VALUES ($1,$2,now() + interval \'7 days\')',
      [tokenHash(token), id]
    );
    return token;
  }

  return {
    async register(input) {
      const {handle, email, password} = validateRegistration(input);
      const encoded = await hashPassword(password);
      const client = await pool.connect();
      let user;
      try {
        await client.query('BEGIN');
        const commander = await client.query(
          'INSERT INTO commanders(handle) VALUES ($1) RETURNING id,handle,created_at',
          [handle]
        );
        const row = commander.rows[0];
        await client.query(
          'INSERT INTO commander_credentials(commander_id,email,email_normalized,password_hash) VALUES($1,$2,$3,$4)',
          [row.id, email, email, encoded]
        );
        await client.query('COMMIT');
        user = publicUser({...row,email,email_verified_at:null},requireVerifiedEmail);
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') throw new AuthError(409, 'account_exists');
        throw error;
      } finally {
        client.release();
      }
      const token = await createSession(user.id);
      return {user,token};
    },

    async login({identity, password} = {}) {
      const key = validateIdentity(identity);
      if (typeof password !== 'string' || password.length > 128 ||
          Buffer.byteLength(password, 'utf8') > 256) {
        throw new AuthError(401, 'invalid_credentials');
      }
      const result = await pool.query(
        'SELECT c.id,c.handle,c.created_at,a.email,a.email_verified_at,a.password_hash FROM commander_credentials a ' +
        'JOIN commanders c ON c.id=a.commander_id ' +
        'WHERE lower(c.handle)=$1 OR a.email_normalized=$1 LIMIT 1', [key]
      );
      const row = result.rows[0];
      if (!(await verifyPassword(password, row?.password_hash))) {
        throw new AuthError(401, 'invalid_credentials');
      }
      const token = await createSession(row.id);
      return {user:publicUser(row,requireVerifiedEmail),token};
    },

    async currentUser(token) {
      if (!token) return null;
      const result = await pool.query(
        'SELECT c.id,c.handle,c.created_at,a.email,a.email_verified_at FROM commander_sessions s ' +
        'JOIN commanders c ON c.id=s.commander_id ' +
        'JOIN commander_credentials a ON a.commander_id=c.id ' +
        'WHERE s.token_hash=$1 AND s.expires_at>now()',
        [tokenHash(token)]
      );
      return result.rows.length ? publicUser(result.rows[0],requireVerifiedEmail) : null;
    },

    async logout(token) {
      if (token) await pool.query('DELETE FROM commander_sessions WHERE token_hash=$1',[tokenHash(token)]);
    },

    async hangar(commanderId) {
      const result = await pool.query(
        'SELECT id,chassis,callsign,state,created_at FROM hangar_mechs ' +
        'WHERE commander_id=$1 ORDER BY created_at DESC LIMIT 100',
        [commanderId]
      );
      return result.rows.map(r => ({
        id:r.id, chassis:r.chassis, callsign:r.callsign,
        state:r.state, createdAt:r.created_at
      }));
    }
  };
}

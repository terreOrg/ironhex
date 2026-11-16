import { createServer } from 'node:http';
import { AuthError, extractSession, makeSessionCookie } from './auth.mjs';
import { Game } from '../../../packages/engine/engine.js';

const units = new Game({ rng: () => 0.5 }).units.map(u => ({
  id: u.id, name: u.name, variant: u.variant, tonnage: u.tonnage,
  movement: {walk: u.walk, jump: u.jump},
  weapons: u.weapons.map(w => ({
    name: w.name, location: w.location, damage: w.damage,
    heat: w.heat, ranges: [...w.ranges]
  }))
}));

function json(res, status, body, head = false, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...headers
  });
  res.end(head ? undefined : JSON.stringify(body));
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw new AuthError(415, 'json_required');
  }
  if (Number(req.headers['content-length'] || 0) > 8192) {
    throw new AuthError(413, 'body_too_large');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw new AuthError(413, 'body_too_large');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('object expected');
    return parsed;
  } catch {
    throw new AuthError(400, 'invalid_json');
  }
}

function sameOrigin(req, allowedOrigin) {
  const expected = allowedOrigin || ('http://' + req.headers.host);
  return !!req.headers.origin && req.headers.origin === expected &&
    req.headers['sec-fetch-site'] !== 'cross-site';
}

function createLimiter(max, windowMs) {
  const keys = new Map();
  return {
    blocked(key) {
      const record = keys.get(key);
      if (!record || record.until < Date.now()) { keys.delete(key); return false; }
      return record.count >= max;
    },
    fail(key) {
      const now = Date.now();
      const old = keys.get(key);
      const item = !old || old.until < now ?
        {count:0,until:now+windowMs} : old;
      item.count++;
      keys.set(key,item);
      // Keep memory bounded if a client tries very many distinct identities.
      if (keys.size > 10000) keys.delete(keys.keys().next().value);
    },
    clear(key) { keys.delete(key); }
  };
}

/**
 * Only same-origin JSON POSTs are accepted for authentication.
 * Mutation APIs for market, C-Bills and combat stay disabled.
 */
export function createHttpServer({
  probeDatabase = async () => {},
  authStore = null,
  hangarStore = null,
  publicOrigin = null,
  secureCookies = false
} = {}) {
  const loginLimiter = createLimiter(8, 15 * 60_000);
  const registerLimiter = createLimiter(12, 60 * 60_000);

  return createServer(async (req,res) => {
    const method = req.method;
    const head = method === 'HEAD';
    let path;
    try { path = new URL(req.url,'http://localhost').pathname; }
    catch { return json(res,400,{error:'bad_request'}); }

    try {
      if (path === '/api/health' && (method === 'GET' || head)) {
        try {
          await probeDatabase();
          return json(res,200,{status:'ok',service:'ironhex-api',database:'ok'},head);
        } catch {
          return json(res,503,{status:'unavailable',service:'ironhex-api'},head);
        }
      }
      if (path === '/api/v1/catalog/chassis' && (method === 'GET' || head)) {
        return json(res,200,{items:units},head);
      }
      if (path === '/api/v1/capabilities' && (method === 'GET' || head)) {
        return json(res,200,{
          apiVersion:1,
          modes:{ai:true,hotseat:true,multiplayer:false},
          features:{database:true,accounts:!!authStore,hangar:!!authStore,
            campaigns:false,market:false},
          combatAuthority:'browser'
        },head);
      }

      if (path.startsWith('/api/v1/auth/') || path === '/api/v1/hangar' || path.startsWith('/api/v1/hangar/')) {
        if (!authStore) return json(res,503,{error:'auth_unavailable'},head);

        if (path === '/api/v1/auth/me' && (method === 'GET' || head)) {
          const user = await authStore.currentUser(extractSession(req.headers.cookie));
          return json(res,200,{authenticated:!!user,user},head);
        }
        if (path === '/api/v1/hangar' || path.startsWith('/api/v1/hangar/')) {
          const user = await authStore.currentUser(extractSession(req.headers.cookie));
          if (!user) return json(res,401,{error:'unauthorized'},head);
          if (!hangarStore) {
            if (path === '/api/v1/hangar' && (method === 'GET' || head))
              return json(res,200,{items:await authStore.hangar(user.id)},head);
            return json(res,503,{error:'hangar_unavailable'},head);
          }
          if (path === '/api/v1/hangar' && (method === 'GET' || head))
            return json(res,200,{items:await hangarStore.list(user.id)},head);
          const id = path.startsWith('/api/v1/hangar/') ?
            path.slice('/api/v1/hangar/'.length) : null;
          if ((path === '/api/v1/hangar' && method === 'POST') ||
              (id && ['PATCH','DELETE'].includes(method))) {
            if (!sameOrigin(req,publicOrigin)) throw new AuthError(403,'invalid_origin');
            if (method === 'DELETE') {
              await hangarStore.remove(user.id,id);
              return json(res,200,{ok:true});
            }
            const body = await readJson(req);
            const item=method === 'POST' ?
              await hangarStore.create(user.id,body) :
              await hangarStore.update(user.id,id,body);
            return json(res,method === 'POST' ? 201 : 200,{item});
          }
        }

        if (['/api/v1/auth/register','/api/v1/auth/login','/api/v1/auth/logout'].includes(path) &&
            method === 'POST') {
          if (!sameOrigin(req,publicOrigin)) throw new AuthError(403,'invalid_origin');
          // A writable API endpoint must never run cross-site or accept form submissions.
          const body = await readJson(req);
          if (path === '/api/v1/auth/logout') {
            await authStore.logout(extractSession(req.headers.cookie));
            return json(res,200,{ok:true},false,{
              'Set-Cookie':makeSessionCookie('',{secure:secureCookies,clear:true})
            });
          }
          if (path === '/api/v1/auth/register') {
            const key = 'register:' + req.socket.remoteAddress;
            if (registerLimiter.blocked(key)) throw new AuthError(429,'rate_limited');
            registerLimiter.fail(key);
            const {user,token} = await authStore.register(body);
            return json(res,201,{authenticated:true,user},false,{
              'Set-Cookie':makeSessionCookie(token,{secure:secureCookies})
            });
          }
          const key = 'login:' + String(body.identity || '').trim().toLowerCase();
          if (loginLimiter.blocked(key)) throw new AuthError(429,'rate_limited');
          try {
            const {user,token} = await authStore.login(body);
            loginLimiter.clear(key);
            return json(res,200,{authenticated:true,user},false,{
              'Set-Cookie':makeSessionCookie(token,{secure:secureCookies})
            });
          } catch(error) {
            if (error instanceof AuthError && error.status === 401) loginLimiter.fail(key);
            throw error;
          }
        }
      }

      if (method !== 'GET' && !head) {
        return json(res,405,{error:'method_not_allowed'},false,{Allow:'GET, HEAD'});
      }
      return json(res,404,{error:'not_found'},head);
    } catch(error) {
      if (error instanceof AuthError) {
        return json(res,error.status,{error:error.code},head);
      }
      // Do not send database errors, SQL or password fields to clients.
      console.error('Ironhex API request failed',error?.code || error?.name || 'unknown');
      return json(res,500,{error:'internal_error'},head);
    }
  });
}

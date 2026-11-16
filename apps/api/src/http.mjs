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
 * Mutations require a valid commander session, same-origin request and JSON payload.
 * Financial state and tactical outcomes are always calculated by the server.
 */
export function createHttpServer({
  probeDatabase = async () => {},
  authStore = null,
  hangarStore = null,
  pilotStore = null,
  operationStore = null,
  economyStore = null,
  accountFlows = null,
  publicOrigin = null,
  secureCookies = false
} = {}) {
  const loginLimiter = createLimiter(8, 15 * 60_000);
  const registerLimiter = createLimiter(12, 60 * 60_000);
  const emailLimiter = createLimiter(6, 60 * 60_000);

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
          features:{database:true,accounts:!!authStore,hangar:!!authStore,pilots:!!pilotStore, emailDelivery:!!accountFlows?.emailAvailable,
            operations:!!operationStore,campaigns:!!economyStore,market:!!economyStore,economy:!!economyStore,repairs:!!economyStore},
          combatAuthority:'browser',operationsAuthority:operationStore?'server':'unavailable'
        },head);
      }

      if (path.startsWith('/api/v1/auth/') || path === '/api/v1/hangar' || path.startsWith('/api/v1/hangar/') || path === '/api/v1/pilots' || path.startsWith('/api/v1/pilots/') || path === '/api/v1/operations' || path.startsWith('/api/v1/operations/') || path === '/api/v1/economy' || path.startsWith('/api/v1/economy/')) {
        if (!authStore) return json(res,503,{error:'auth_unavailable'},head);

        if (path === '/api/v1/auth/me' && (method === 'GET' || head)) {
          const user = await authStore.currentUser(extractSession(req.headers.cookie));
          return json(res,200,{authenticated:!!user,user},head);
        }
        if(path === '/api/v1/economy' || path.startsWith('/api/v1/economy/')){
          const user=await authStore.currentUser(extractSession(req.headers.cookie));
          if(!user)return json(res,401,{error:'unauthorized'},head);
          if(user.emailVerificationRequired&&!user.emailVerified)
            return json(res,403,{error:'email_unverified'},head);
          if(!economyStore)return json(res,503,{error:'economy_unavailable'},head);
          if(path==='/api/v1/economy'&&(method==='GET'||head))
            return json(res,200,await economyStore.summary(user.id),head);
          if(path==='/api/v1/economy/mechs'&&(method==='GET'||head)){
            const url=new URL(req.url,'http://localhost');
            const query=url.searchParams.get('query')||'';
            const page=url.searchParams.get('page')||1;
            const availableOnly=url.searchParams.get('available')==='1';
            const get=k=>url.searchParams.get(k)||'';
            return json(res,200,economyStore.browseMechs({
              query,page,limit:36,availableOnly,
              tonnageMin:get('tonnageMin'),tonnageMax:get('tonnageMax'),
              weightClass:get('weightClass'),eraMin:get('eraMin'),
              eraMax:get('eraMax'),priceMax:get('priceMax'),
              role:get('role'),weapon:get('weapon'),sort:get('sort')
            }),head);
          }
          if(path==='/api/v1/economy/mechs/detail'&&(method==='GET'||head)){
            const url=new URL(req.url,'http://localhost');
            const sourcePath=url.searchParams.get('path')||'';
            const item=economyStore.mechDetails(sourcePath);
            return item?json(res,200,{item},head):json(res,404,{error:'mech_not_found'},head);
          }
          if(path==='/api/v1/economy/mechs/purchase'&&method==='POST'){
            if(!sameOrigin(req,publicOrigin))throw new AuthError(403,'invalid_origin');
            return json(res,201,{item:await economyStore.buyMech(user.id,await readJson(req))},head);
          }
          if(method==='POST'&&['/api/v1/economy/purchase','/api/v1/economy/repair'].includes(path)){
            if(!sameOrigin(req,publicOrigin))throw new AuthError(403,'invalid_origin');
            const input=await readJson(req);
            const item=path.endsWith('/purchase')?
              await economyStore.purchase(user.id,input):
              await economyStore.repair(user.id,input);
            return json(res,200,{item},head);
          }
          return json(res,404,{error:'not_found'},head);
        }
        if(path === '/api/v1/operations' || path.startsWith('/api/v1/operations/')){
          const user=await authStore.currentUser(extractSession(req.headers.cookie));
          if(!user) return json(res,401,{error:'unauthorized'},head);
          if(user.emailVerificationRequired && !user.emailVerified)
            return json(res,403,{error:'email_unverified'},head);
          if(!operationStore) return json(res,503,{error:'operations_unavailable'},head);
          if(path==='/api/v1/operations' && (method==='GET'||head))
            return json(res,200,{items:await operationStore.list(user.id)},head);
          if(path==='/api/v1/operations' && method==='POST'){
            if(!sameOrigin(req,publicOrigin)) throw new AuthError(403,'invalid_origin');
            return json(res,201,{item:await operationStore.create(user.id,await readJson(req))});
          }
          const match=/^\/api\/v1\/operations\/([^/]+)(?:\/(launch|advance|abandon|snapshot|command))?$/.exec(path);
          if(match){
            const [,id,command]=match;
            if(!command&&(method==='GET'||head))
              return json(res,200,{item:await operationStore.get(user.id,id)},head);
            if(command==='snapshot'&&(method==='GET'||head))
              return json(res,200,{item:await operationStore.snapshot(user.id,id)},head);
            if(command&&method==='POST'&&command!=='snapshot'){
              if(!sameOrigin(req,publicOrigin)) throw new AuthError(403,'invalid_origin');
              const body=await readJson(req);
              if(command==='command')
                return json(res,200,{item:await operationStore.command(user.id,id,body)},head);
              if(Object.keys(body).length)throw new AuthError(422,'invalid_operation');
              return json(res,200,{item:await operationStore[command](user.id,id)},head);
            }
          }
          return json(res,404,{error:'not_found'},head);
        }
        if (path === '/api/v1/pilots' || path.startsWith('/api/v1/pilots/')) {
          const user=await authStore.currentUser(extractSession(req.headers.cookie));
          if(!user) return json(res,401,{error:'unauthorized'},head);
          if(user.emailVerificationRequired && !user.emailVerified)
            return json(res,403,{error:'email_unverified'},head);
          if(!pilotStore) return json(res,503,{error:'pilots_unavailable'},head);
          if(path==='/api/v1/pilots' && (method==='GET'||head))
            return json(res,200,{items:await pilotStore.list(user.id)},head);
          if(path==='/api/v1/pilots' && method==='POST') {
            if(!sameOrigin(req,publicOrigin)) throw new AuthError(403,'invalid_origin');
            return json(res,201,{item:await pilotStore.create(user.id,await readJson(req))});
          }
          const match=/^\/api\/v1\/pilots\/([^/]+)(\/history)?$/.exec(path);
          if(match) {
            const [,id,history]=match;
            if(history && (method==='GET'||head))
              return json(res,200,{items:await pilotStore.history(user.id,id)},head);
            if(!history && (method==='GET'||head))
              return json(res,200,{item:await pilotStore.get(user.id,id)},head);
            if(!history && (method==='PATCH'||method==='DELETE')) {
              if(!sameOrigin(req,publicOrigin)) throw new AuthError(403,'invalid_origin');
              if(method==='DELETE')
                return json(res,200,await pilotStore.remove(user.id,id));
              return json(res,200,{item:await pilotStore.update(user.id,id,await readJson(req))});
            }
          }
          return json(res,404,{error:'not_found'},head);
        }
        if(pilotStore && /^\/api\/v1\/hangar\/[^/]+\/pilot$/.test(path)) {
          const user=await authStore.currentUser(extractSession(req.headers.cookie));
          if(!user) return json(res,401,{error:'unauthorized'},head);
          if(user.emailVerificationRequired && !user.emailVerified)
            return json(res,403,{error:'email_unverified'},head);
          if(method!=='PUT') return json(res,405,{error:'method_not_allowed'});
          if(!sameOrigin(req,publicOrigin)) throw new AuthError(403,'invalid_origin');
          const body=await readJson(req);
          if(!Object.hasOwn(body,'pilotId')||Object.keys(body).length!==1)
            throw new AuthError(422,'invalid_assignment');
          return json(res,200,await pilotStore.assign(
            user.id,path.split('/')[4],body.pilotId
          ));
        }
        if (path === '/api/v1/hangar' || path.startsWith('/api/v1/hangar/')) {
          const user = await authStore.currentUser(extractSession(req.headers.cookie));
          if (!user) return json(res,401,{error:'unauthorized'},head);
          if (user.emailVerificationRequired && !user.emailVerified)
            return json(res,403,{error:'email_unverified'},head);
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

        if (['/api/v1/auth/register','/api/v1/auth/login','/api/v1/auth/logout',
          '/api/v1/auth/resend-verification','/api/v1/auth/verify-email',
          '/api/v1/auth/request-reset','/api/v1/auth/reset-password'].includes(path) &&
            method === 'POST') {
          if (!sameOrigin(req,publicOrigin)) throw new AuthError(403,'invalid_origin');
          // A writable API endpoint must never run cross-site or accept form submissions.
          const body = await readJson(req);
          if (['/api/v1/auth/resend-verification','/api/v1/auth/verify-email',
                '/api/v1/auth/request-reset','/api/v1/auth/reset-password'].includes(path)) {
            if (!accountFlows?.emailAvailable) throw new AuthError(503,'mail_unavailable');
            const key = 'mail:' + req.socket.remoteAddress + ':' + path;
            if (emailLimiter.blocked(key)) throw new AuthError(429,'rate_limited');
            emailLimiter.fail(key);
            if (path === '/api/v1/auth/resend-verification') {
              const user = await authStore.currentUser(extractSession(req.headers.cookie));
              if (!user) throw new AuthError(401,'unauthorized');
              return json(res,200,await accountFlows.sendVerification(user.id));
            }
            if (path === '/api/v1/auth/verify-email')
              return json(res,200,await accountFlows.verifyEmail(body.token));
            if (path === '/api/v1/auth/request-reset')
              return json(res,200,await accountFlows.requestReset(body.email));
            const result = await accountFlows.resetPassword(body.token,body.password);
            return json(res,200,result,false,{
              'Set-Cookie':makeSessionCookie('',{secure:secureCookies,clear:true})
            });
          }
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
            // Registration remains usable if Brevo temporarily fails; resend is available.
            if (accountFlows?.emailAvailable) {
              try {await accountFlows.sendVerification(user.id);}
              catch {console.warn('Ironhex verification mail delivery failed');}
            }
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

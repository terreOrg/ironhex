import { createPool, initializeDatabase } from './db.mjs';
import { createAuthStore } from './auth.mjs';
import { createHangarStore } from './hangar.mjs';
import { createPilotStore } from './pilots.mjs';
import { createOperationStore } from './operations.mjs';
import { createBrevoMailer } from './mail.mjs';
import { createAccountFlows } from './account-flows.mjs';
import { createHttpServer } from './http.mjs';

const pool = createPool();
await initializeDatabase(pool);

const port = Number(process.env.PORT || 3000);
const mailer = createBrevoMailer({
  apiKey:process.env.IRONHEX_BREVO_API_KEY || '',
  sender:process.env.IRONHEX_EMAIL_FROM || '',
  publicOrigin:process.env.IRONHEX_PUBLIC_ORIGIN || ''
});
const requireVerifiedEmail = process.env.IRONHEX_REQUIRE_VERIFIED_EMAIL === 'true';
if (requireVerifiedEmail && !mailer.enabled)
  throw Error('IRONHEX_REQUIRE_VERIFIED_EMAIL requires configured Brevo delivery');
const server = createHttpServer({
  probeDatabase: async()=>{ await pool.query('SELECT 1'); },
  authStore: createAuthStore(pool,{requireVerifiedEmail}),
  accountFlows: createAccountFlows(pool,{mailer}),
  hangarStore: createHangarStore(pool),
  pilotStore: createPilotStore(pool),
  operationStore: createOperationStore(pool),
  publicOrigin: process.env.IRONHEX_PUBLIC_ORIGIN || null,
  secureCookies: process.env.IRONHEX_AUTH_COOKIE_SECURE === 'true'
});
server.listen(port,'0.0.0.0',()=>{
  console.log('Ironhex API listening on port '+port);
});

async function stop() {
  server.close();
  await pool.end();
}
process.once('SIGTERM',()=>void stop());
process.once('SIGINT',()=>void stop());

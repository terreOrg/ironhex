import { createPool, initializeDatabase } from './db.mjs';
import { createAuthStore } from './auth.mjs';
import { createHttpServer } from './http.mjs';

const pool = createPool();
await initializeDatabase(pool);

const port = Number(process.env.PORT || 3000);
const server = createHttpServer({
  probeDatabase: async()=>{ await pool.query('SELECT 1'); },
  authStore: createAuthStore(pool),
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

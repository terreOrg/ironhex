import { createPool, initializeDatabase } from './db.mjs';
import { createHttpServer } from './http.mjs';

const pool = createPool();
await initializeDatabase(pool);

const port = Number(process.env.PORT || 3000);
const server = createHttpServer({probeDatabase:async()=>{
  await pool.query('SELECT 1');
}});
server.listen(port,'0.0.0.0',()=>{
  console.log('Ironhex API listening on port '+port);
});

async function stop() {
  server.close();
  await pool.end();
}
process.once('SIGTERM',()=>void stop());
process.once('SIGINT',()=>void stop());

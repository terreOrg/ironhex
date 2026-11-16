import { createServer } from 'node:http';
import { Game } from '../../../packages/engine/engine.js';

const units = new Game({ rng: () => 0.5 }).units.map(u => ({
  id: u.id,
  name: u.name,
  variant: u.variant,
  tonnage: u.tonnage,
  movement: {walk: u.walk, jump: u.jump},
  weapons: u.weapons.map(w => ({
    name: w.name, location: w.location, damage: w.damage,
    heat: w.heat, ranges: [...w.ranges]
  }))
}));

function json(res,status,body,head=false) {
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY'
  });
  res.end(head ? undefined : JSON.stringify(body));
}

/**
 * The API has deliberately read-only routes until authentication and an
 * authoritative turn service are implemented. Never expose unrestricted
 * inventory or balance mutations before that trust boundary exists.
 */
export function createHttpServer({probeDatabase=async()=>{}}={}) {
  return createServer(async (req,res)=>{
    const head=req.method==='HEAD';
    if (req.method!=='GET'&&!head) {
      res.setHeader('Allow','GET, HEAD');
      return json(res,405,{error:'method_not_allowed'});
    }
    let path;
    try { path=new URL(req.url,'http://localhost').pathname; }
    catch { return json(res,400,{error:'bad_request'},head); }
    if (path==='/api/health') {
      try {
        await probeDatabase();
        return json(res,200,{status:'ok',service:'ironhex-api',database:'ok'},head);
      } catch {
        return json(res,503,{status:'unavailable',service:'ironhex-api'},head);
      }
    }
    if (path==='/api/v1/catalog/chassis') {
      return json(res,200,{items:units},head);
    }
    if (path==='/api/v1/capabilities') {
      return json(res,200,{
        apiVersion:1,
        modes:{ai:true,hotseat:true,multiplayer:false},
        features:{database:true,accounts:false,hangar:false,campaigns:false,market:false},
        combatAuthority:'browser'
      },head);
    }
    return json(res,404,{error:'not_found'},head);
  });
}

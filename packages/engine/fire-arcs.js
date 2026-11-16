import {distance} from './engine.js';
export function firingArcTiles(game,u,indices){
 const tiles=new Map();if(!u||u.dead)return tiles;
 for(const index of indices){const w=u.weapons[index];if(!w||w.destroyed||!u.structure[w.location]||w.ammo===0)continue;
 const depth=game.tile(u.q,u.r).depth,sub=depth>=(u.prone||['LL','RL'].includes(w.location)?1:2);
 if(sub&&w.ammo!==null)continue;
 if(u.prone&&(['LL','RL'].includes(w.location)||w.location===(u.brace||'LA')||!u.structure[u.brace||'LA']))continue;
 const ranges=w.ranges.map(n=>sub?Math.floor(n/2):n);
 for(const t of game.tiles){const d=distance(u,t);if(!d||d>ranges[2]||!game.arc(u,t,w))continue;const band=d<=ranges[0]?0:d<=ranges[1]?1:2,k=t.q+','+t.r;if(!tiles.has(k)||band<tiles.get(k))tiles.set(k,band);}
 }return tiles;
}

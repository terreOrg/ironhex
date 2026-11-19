import {distance,UNDERWATER_RANGES,mechLegLocation,quadProneFireBonus} from './engine.js';
export function firingArcTiles(game,u,indices){
 const tiles=new Map();if(!u||u.dead)return tiles;
 for(const index of indices){const w=u.weapons[index];if(!w||w.destroyed||!u.structure[w.location]||w.ammo===0)continue;
 const depth=game.tile(u.q,u.r).depth,sub=depth>=(u.prone||mechLegLocation(u,w.location)?1:2);
 if(sub&&(!game.tacticalOptions?.underwaterFire||!UNDERWATER_RANGES[w.name]))continue;
 if(u.prone){
  const brace=u.brace||'LA',leg=mechLegLocation(u,w.location)||w.locations?.some(l=>mechLegLocation(u,l));
  if(u.config==='Quad'?!quadProneFireBonus(u)&&leg:(!u.structure.LA||!u.structure.RA||leg||w.location===brace||w.locations?.includes(brace)))continue;
 }
 const ranges=sub?UNDERWATER_RANGES[w.name]:w.ranges;
 for(const t of game.tiles){const d=distance(u,t);if(!d||d>ranges[2]||!game.arc(u,t,w))continue;const band=d<=ranges[0]?0:d<=ranges[1]?1:2,k=t.q+','+t.r;if(!tiles.has(k)||band<tiles.get(k))tiles.set(k,band);}
 }return tiles;
}

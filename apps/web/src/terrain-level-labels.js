// Printed AGoAC labels; presentation only, never rules-engine authority.
export function hexElevationMark(tile){
 if(!tile||typeof tile!=='object')return null;
 const depth=Number.isInteger(tile.depth)&&tile.depth>0?tile.depth:0;
 const surface=Number.isInteger(tile.surface)?tile.surface:
  Number.isInteger(tile.height)?tile.height+depth:0;
 if(depth){
  const lines=surface===0?[]:[surface>0?'LEVEL '+surface:'SUBLEVEL '+(-surface)];
  lines.push('DEPTH '+depth);
  return {type:'depth',lines};
 }
 const level=Number.isInteger(tile.height)?tile.height:surface;
 if(level===0)return null;
 return {type:level>0?'level':'sublevel',
  lines:[level>0?'LEVEL '+level:'SUBLEVEL '+(-level)]};
}

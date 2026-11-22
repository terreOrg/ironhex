// Exact four counter contours transcribed from CAT3500D Scenario 3 p.47
// original printed figure (PDF page 49). Official v8.01 p.5 replaces
// ONLY the west mapsheet name with Desert #2. The published 2-hex
// pieces may be rotated; the two 3-hex triangular contours may not.
export const AGOAC_SCENARIO3_FIGURE=Object.freeze([
 Object.freeze({sheet:0,shape:'pair',printedHexes:Object.freeze(['0711','0712'])}),
 Object.freeze({sheet:0,shape:'triangle',printedHexes:Object.freeze(['1213','1114','1214'])}),
 Object.freeze({sheet:1,shape:'pair',printedHexes:Object.freeze(['0908','1009'])}),
 Object.freeze({sheet:1,shape:'triangle',printedHexes:Object.freeze(['0310','0311','0411'])})
]);
export function agoacScenario3FigureTiles(game,index){
 const entry=AGOAC_SCENARIO3_FIGURE[index];
 if(!entry||!Array.isArray(game?.tiles))return [];
 const source=entry.printedHexes.map(hex=>game.tiles.find(t=>
  t.sheet===entry.sheet&&t.printedHex===hex));
 if(source.some(tile=>!tile))return [];
 const orientation=game.setupMap?.sheets?.[entry.sheet]?.rotation;
 if(orientation!==3)return source;
 // The odd-row source grid has staggered columns. Reversing each printed
 // row/column alone is not a geometric 180-degree hex rotation: it can
 // split a three-hex triangle. Preserve the source's *axial* contour,
 // rotate its relative offsets, and translate onto the reversed sheet.
 // The anchor keeps its publisher number while the other printed labels
 // may differ by one column in a rotated digital representation.
 const original=(hex)=>{
  const col=Number(hex.slice(0,2))-1;
  const row=Number(hex.slice(2,4))-1;
  const r=row-8;
  return {q:entry.sheet*16+col-16-Math.floor(r/2),r};
 };
 const first=original(entry.printedHexes[0]),anchor=source[0];
 const rotated=entry.printedHexes.map(hex=>{
  const cell=original(hex);
  return game.tiles.find(t=>t.sheet===entry.sheet&&
   t.q===anchor.q-(cell.q-first.q)&&
   t.r===anchor.r-(cell.r-first.r));
 });
 return rotated.every(Boolean)?rotated:[];
}
export function matchesAgoacScenario3Figure(game,index,{q,r,hexes}={}){
 const entry=AGOAC_SCENARIO3_FIGURE[index];
 const canonical=agoacScenario3FigureTiles(game,index);
 if(!entry||canonical.length!==entry.printedHexes.length||
  !Array.isArray(hexes)||hexes.length!==canonical.length||
  canonical[0].q!==q||canonical[0].r!==r||
  !hexes.some(h=>h.q===q&&h.r===r))return false;
 if(entry.shape==='pair')return true;
 return new Set(hexes.map(h=>h.q+','+h.r)).size===3&&
  canonical.every(h=>hexes.some(t=>h.q===t.q&&h.r===t.r));
}

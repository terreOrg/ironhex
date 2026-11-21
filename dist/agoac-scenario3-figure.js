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
 return entry.printedHexes.map(hex=>game.tiles.find(t=>
  t.sheet===entry.sheet&&t.printedHex===hex)).filter(Boolean);
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

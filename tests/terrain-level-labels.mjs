import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hexElevationMark} from '../apps/web/src/terrain-level-labels.js';

test('AGoAC printed map: Level 0 unmarked; raised terrain marked LEVEL',()=>{
 assert.equal(hexElevationMark({height:0,depth:0,surface:0,type:'plain'}),null);
 assert.deepEqual(hexElevationMark({height:2,depth:0,surface:2,type:'woods'}),
  {type:'level',lines:['LEVEL 2']});
 assert.deepEqual(hexElevationMark({height:7,depth:0,type:'rough'}),
  {type:'level',lines:['LEVEL 7']});
});
test('AGoAC printed map: dry negative sublevel stays distinct from water',()=>{
 assert.deepEqual(hexElevationMark({height:-1,surface:-1,depth:0,type:'plain'}),
  {type:'sublevel',lines:['SUBLEVEL 1']});
 assert.deepEqual(hexElevationMark({height:-2,surface:-2,depth:0,overlayTerrain:{terrainType:'sublevel2'}}),
  {type:'sublevel',lines:['SUBLEVEL 2']});
});
test('AGoAC printed map: water depth is below surface, not absolute elevation',()=>{
 assert.deepEqual(hexElevationMark({height:-2,surface:0,depth:2,type:'water'}),
  {type:'depth',lines:['DEPTH 2']});
 assert.deepEqual(hexElevationMark({height:1,surface:3,depth:2,type:'water'}),
  {type:'depth',lines:['LEVEL 3','DEPTH 2']});
 assert.deepEqual(hexElevationMark({height:-3,depth:2,type:'water'}),
  {type:'depth',lines:['SUBLEVEL 1','DEPTH 2']});
 assert.equal(hexElevationMark(null),null);
});

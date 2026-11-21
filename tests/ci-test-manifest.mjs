import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {listUnitTestFiles} from '../scripts/unit-test-paths.mjs';

test('CI and SonarQube use the same complete unit manifest including signed rooms',()=>{
 const files=listUnitTestFiles();
 for(const path of ['tests/scenario-match.mjs','tests/scenario-command.mjs',
  'tests/scenario-rooms.mjs','tests/terrain-level-labels.mjs']){
  assert(files.includes(path),'missing required source-linked test '+path);
 }
 assert(!files.some(path=>/browser|integration/.test(path)),
  'unit manifest excludes browser and standalone DB integration suites');
 for(const path of ['../.github/workflows/ci.yml','../.github/workflows/sonarqube.yml']){
  const text=readFileSync(new URL(path,import.meta.url),'utf8');
  assert(text.includes('unit_list=$(node scripts/unit-test-paths.mjs)'),
   path+' must use the canonical package test manifest');
  assert(text.includes('"${unit_files[@]}"'),
   path+' must use the validated list in unit tests');
 }
});

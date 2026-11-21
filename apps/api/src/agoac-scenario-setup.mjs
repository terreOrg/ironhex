import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {importMtf} from './mtf.mjs';
import {AGOAC_PRINTED_SCENARIOS} from '../../../packages/engine/engine.js';
import {outOfBookEquipment} from '../../../packages/engine/rulebook.js';

// The manifest and source MTFs are bundled in the repository; no live
// outbound request or silently substituted demo chassis is allowed.
const root=fileURLToPath(new URL('../../../data/megamek/scenarios/',import.meta.url));
const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
export const AGOAC_PINNED_RECORD_SOURCE=Object.freeze({
 revision:manifest.sourceRevision,license:manifest.licenseId,
 repository:manifest.sourceRepository
});
export function loadAgoacPrintedDesigns(scenarioId){
 const scenario=AGOAC_PRINTED_SCENARIOS[scenarioId];
 if(!scenario)throw Error('unknown_agoac_scenario');
 const unique=[...new Set([...scenario.attacker,...scenario.defender].map(u=>u.variant))];
 const designs={};
 for(const variant of unique){
  const entry=manifest.records.find(r=>r.variant===variant);
  if(!entry||!/^[-A-Za-z0-9]+\.mtf$/.test(entry.file))
   throw Error('missing_printed_record_'+variant);
  const body=readFileSync(join(root,entry.file),'utf8');
  const source=importMtf(body,{sourcePath:entry.sourcePath});
  if(source.model!==variant||outOfBookEquipment(source.config).length)
   throw Error('unsupported_printed_record_'+variant);
  designs[variant]=source.config;
 }
 return designs;
}
export function prepareAgoacPrintedScenario(game,scenarioId,{rotations=[0,0]}={}){
 if(!game?.scenario||game.scenario.id!==scenarioId||
  ![0,1].includes(game.scenario.defenderTeam))
  throw Error('select_printed_scenario_sides_first');
 const map=game.configurePrintedScenarioMap({rotations});
 if(!map.ok)throw Error('printed_map:'+map.error);
 const records=game.configurePrintedScenarioForces({
  designs:loadAgoacPrintedDesigns(scenarioId)});
 if(!records.ok)throw Error('printed_records:'+records.error);
 return {map,records};
}

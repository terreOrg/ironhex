import {AGOAC_PRINTED_SCENARIOS,AGOAC_SCENARIO_VARIATIONS} from './engine.js';
import {AGOAC_BOARD_SOURCE} from './agoac-boards.js';
import {outOfBookEquipment} from './rulebook.js';
import {importMtf} from './agoac-mtf.js';

let bundlePromise=null;
async function pinnedBundle(readCatalog){
 if(readCatalog)return readCatalog();
 bundlePromise??=fetch('agoac-records.json',{credentials:'same-origin'})
  .then(response=>{if(!response.ok)throw Error('agoac_records_http_'+response.status);return response.json();})
  .catch(error=>{bundlePromise=null;throw error;});
 return bundlePromise;
}
// Only data from the pinned revision is accepted, with the original
// MTF importer and the same equipment validator as on the server.
export async function loadAgoacBrowserDesigns(id,{variation=null,readCatalog=null}={}){
 const original=AGOAC_PRINTED_SCENARIOS[id];
 if(!original)throw Error('unknown_agoac_scenario');
 if(variation!==null&&!(id==='divide-and-conquer'&&variation==='shortened'||
   id==='final-exam'&&variation==='alternate-forces'))
  throw Error('unsupported_printed_scenario_variation');
 const variants=AGOAC_SCENARIO_VARIATIONS['final-exam'].alternateForces;
 const scenario=variation==='shortened'?AGOAC_SCENARIO_VARIATIONS[id].shortened:
  variation==='alternate-forces'?{
   defender:original.defender.map((unit,i)=>({...unit,variant:variants.defender[i]})),
   attacker:original.attacker.map((unit,i)=>({...unit,variant:variants.attacker[i]}))}:original;
 const bundle=await pinnedBundle(readCatalog);
 if(bundle?.sourceRevision!==AGOAC_BOARD_SOURCE.revision||
   bundle.licenseId!=='CC-BY-NC-SA-4.0'||!Array.isArray(bundle.records))
  throw Error('agoac_record_revision_or_license_mismatch');
 const designs={};
 for(const variant of new Set([...scenario.defender,...scenario.attacker].map(u=>u.variant))){
  const entry=bundle.records.find(record=>record.variant===variant);
  if(!entry||typeof entry.raw!=='string'||entry.raw.length>500000||
   typeof entry.sourcePath!=='string'||!entry.sourcePath.startsWith('data/mekfiles/'))
   throw Error('missing_printed_record_'+variant);
  const parsed=importMtf(entry.raw,{sourcePath:entry.sourcePath});
  if(parsed.model!==variant||outOfBookEquipment(parsed.config).length)
   throw Error('unsupported_printed_record_'+variant);
  designs[variant]=parsed.config;
 }
 return designs;
}

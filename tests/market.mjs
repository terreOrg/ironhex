import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {construct} from '../packages/engine/construction.js';
import {MECH_OFFERS,rejectedMtf,sourceManifest,totalMtfRecords,searchMechCatalog,getMechDetails,mechWeightClass} from '../apps/api/src/market.mjs';
import {importMtf} from '../apps/api/src/mtf.mjs';
import {validateDesign} from '../apps/api/src/hangar.mjs';
const base=fileURLToPath(new URL('../data/megamek/meks/',import.meta.url));

test('MegaMek importer admits only verified, distinct Standard Inner Sphere designs',()=>{
  assert(MECH_OFFERS.length>=6,
    'Supported variants: '+MECH_OFFERS.length+'; rejected: '+JSON.stringify(rejectedMtf));
  assert.equal(MECH_OFFERS.length,new Set(MECH_OFFERS.map(x=>x.id)).size);
  const kinds=new Set(MECH_OFFERS.map(x=>x.tonnage<=35?'light':
    x.tonnage<=55?'medium':x.tonnage<=75?'heavy':'assault'));
  assert(kinds.has('light')&&kinds.has('medium')&&kinds.has('heavy'),
    'Market should include multiple size classes: '+[...kinds]);
  assert.equal(sourceManifest.licenseId,'CC-BY-NC-SA-4.0');
  assert.equal(sourceManifest.entries.length,14);
  for(const offer of MECH_OFFERS){
    assert(offer.sourceUrl.startsWith('https://github.com/MegaMek/mm-data/blob/'));
    const {unit,errors}=construct(offer.config);
    assert.deepEqual(errors,[],offer.id);
    assert.equal(unit.name,offer.name);
    assert.equal(unit.tonnage,offer.tonnage);
    assert.equal(unit.walk,offer.config.walk);
    assert.equal(unit.jump,offer.config.jump);
    assert.deepEqual(unit.maxArmor,offer.config.armor);
    assert.deepEqual(unit.maxRear,offer.config.rear);
    assert(unit.weapons.length>0);
    assert(Number.isSafeInteger(offer.price)&&offer.price>0);
  }
});
test('Griffin GRF-1M imports its LRM-20 and real armor/jump values',()=>{
  const griffin=MECH_OFFERS.find(x=>x.id==='mm-grf-1m');
  assert(griffin,'Griffin absent: '+JSON.stringify(rejectedMtf));
  const {config}=griffin;
  assert.equal(config.tonnage,55);
  assert.equal(config.walk,5);
  assert.equal(config.jump,5);
  assert.equal(config.sinks,12);
  assert.equal(config.armor.HD,9);
  assert.equal(config.rear.CT,7);
  assert(config.equipment.some(x=>x.type==='LRM 20'&&x.location==='RT'));
  const units=construct(config).unit;
  assert(units.weapons.some(w=>w.name==='LRM 20'&&w.ammo===18));
});
test('Unsupported submarine torpedoes are rejected rather than replaced',()=>{
  const entry=sourceManifest.entries.find(x=>x.file.includes('Javelin'));
  assert(entry);
  const raw=readFileSync(join(base,entry.file),'utf8');
  assert.throws(()=>importMtf(raw,{sourcePath:entry.sourcePath}),/unsupported_mtf/);
  assert(rejectedMtf.some(x=>x.file===entry.file));
});
test('Shared BattleTech ammunition is a single pool for identical weapons',()=>{
  const atlas=MECH_OFFERS.find(x=>x.id==='mm-as7-a');
  if(!atlas)return; // Unsupported variants remain explicitly excluded.
  const unit=construct(atlas.config).unit;
  const missiles=unit.weapons.filter(w=>w.name==='SRM 6');
  assert.equal(missiles.length,5);
  assert(missiles.every(w=>w.shared===missiles[0].shared));
  assert(missiles.every(w=>w.ammo===missiles[0].ammo));
});

test('MegaMek reference index includes all 4,305 MTF entries with safe pagination',()=>{
  assert.equal(totalMtfRecords,4305);
  const first=searchMechCatalog({query:'Atlas',page:1,limit:12});
  assert.equal(first.total,4305);
  assert(first.matches>12);
  assert.equal(first.items.length,12);
  assert(first.items.every(item=>item.sourceUrl?.startsWith('https://github.com/MegaMek/mm-data/blob/')));
  assert(first.items.every(item=>typeof item.available==='boolean'));
  const supported=searchMechCatalog({availableOnly:true,limit:60});
  assert.equal(supported.matches,MECH_OFFERS.length);
  assert(supported.items.every(item=>item.available&&item.offerId&&item.price>0));
  const empty=searchMechCatalog({query:'no-such-mech-type-99111'});
  assert.equal(empty.matches,0);
  assert.deepEqual(empty.items,[]);
});

test('Technical dossier returns verified engine data without synthetic statistics',()=>{
  const griffin=MECH_OFFERS.find(x=>x.id==='mm-grf-1m');
  assert(griffin,'Expected pinned Griffin variant');
  const sheet=getMechDetails(griffin.sourcePath);
  assert.equal(sheet.name,griffin.name);
  assert.equal(sheet.available,true);
  assert.equal(sheet.tonnage,55);
  assert.equal(sheet.engineRating,275);
  assert.deepEqual(sheet.movement,{walk:5,run:8,jump:5});
  assert.equal(sheet.heatSinks,12);
  assert(sheet.armor.some(x=>x.location==='CT'&&x.rear===7&&x.structure>0));
  assert(sheet.weapons.some(w=>w.name==='LRM 20'&&w.location==='RT'));
  assert(sheet.equipment.some(e=>e.type==='ammo'&&e.weapon==='LRM 20'));
  assert(sheet.criticalSlots.RT.some(slot=>slot==='LRM 20'));
  assert.equal(sheet.sourceLicense,'CC-BY-NC-SA-4.0');
  assert.equal(getMechDetails('../secrets.json'),null,
    'Detail endpoint must never interpret paths outside the trusted index');
  const archive=searchMechCatalog({page:1,limit:60}).items.find(x=>!x.available);
  assert(archive);
  const unavailable=getMechDetails(archive.sourcePath);
  assert.equal(unavailable.available,false);
  assert.equal(unavailable.tonnage,undefined,
    'Unimported MTF variants must not be assigned imaginary tonnage');
  assert(unavailable.note.includes('не включён'));
});
test('Filters combine server-side before pagination and do not guess unknown mass',()=>{
  assert.equal(mechWeightClass(35),'light');
  assert.equal(mechWeightClass(55),'medium');
  assert.equal(mechWeightClass(75),'heavy');
  assert.equal(mechWeightClass(100),'assault');
  const medium=searchMechCatalog({weightClass:'medium',tonnageMin:50,
    tonnageMax:55,availableOnly:true,sort:'tonnage'});
  assert(medium.matches>0);
  assert(medium.items.every(x=>x.available&&x.weightClass==='medium'&&
    x.tonnage>=50&&x.tonnage<=55));
  const noMass=searchMechCatalog({tonnageMin:99,tonnageMax:100,limit:60});
  assert(noMass.items.every(x=>x.available),
    'Rows without parsed tonnage must not leak into a mass-filtered search');
  const names=searchMechCatalog({query:'GRF-1M',tonnageMin:55,tonnageMax:55});
  assert(names.items.some(x=>x.offerId==='mm-grf-1m'));
  assert.equal(searchMechCatalog({query:'GRF-1M',tonnageMax:40}).matches,0);
  assert.equal(searchMechCatalog({priceMax:0}).matches,0);
  const withYear=MECH_OFFERS.find(x=>x.era);
  assert(withYear);
  assert(searchMechCatalog({eraMin:withYear.era,eraMax:withYear.era,
    availableOnly:true}).items.every(x=>x.era===withYear.era));
  const sorted=searchMechCatalog({availableOnly:true,sort:'price',limit:60}).items;
  assert.deepEqual(sorted.map(x=>x.price),sorted.map(x=>x.price).sort((a,b)=>a-b));
  assert.equal(searchMechCatalog({availableOnly:true,limit:2,page:2}).items.length,2);
});

test('BMM p.5: MTF importer distinguishes unsupported quads from non-BattleMechs',()=>{
  const entry=sourceManifest.entries.find(x=>x.file.includes('Griffin'));
  assert(entry);
  const raw=readFileSync(join(base,entry.file),'utf8');
  assert.match(raw,/^Config:Biped$/m);
  assert.throws(()=>importMtf(raw.replace(/^Config:Biped$/m,'Config:Quad')),
    /unsupported_mtf:quad_not_implemented/);
  assert.throws(()=>importMtf(raw.replace(/^Config:Biped$/m,'Config:Vehicle')),
    /unsupported_mtf:not_battlemech/);
});

test('BMM p.5: hangar accepts explicit biped MTF designs but rejects unsupported quads',()=>{
  const griffin=MECH_OFFERS.find(x=>x.id==='mm-grf-1m');
  assert(griffin);
  assert.equal(griffin.config.config,'Biped');
  assert.doesNotThrow(()=>validateDesign({config:griffin.config}));
  assert.throws(()=>validateDesign({config:{...griffin.config,config:'Quad'}}),
    /invalid_design|Четырёхногие|unsupported/);
});

test('MTF parsing handles long property whitespace with unchanged construction',()=>{
  const entry=sourceManifest.entries.find(x=>x.file.includes('Griffin'));
  const raw=readFileSync(join(base,entry.file),'utf8');
  const expected=importMtf(raw);
  assert.deepEqual(importMtf(raw.replace(/^Config:Biped$/m,'Config:'+' '.repeat(100000)+'Biped')),expected);
  assert.throws(()=>importMtf(raw.replace(/^Config:Biped$/m,'Config:   \nConfig:Biped')),/unsupported_mtf:missing_config/);
});

test('AGoAC Ch12 server validation returns actionable source-linked refusal reasons',()=>{
 const base=structuredClone(MECH_OFFERS.find(o=>o.id==='mm-grf-1m').config);
 const tooMuch=structuredClone(base);
 tooMuch.armor.HD=10;
 let rejected;
 try{validateDesign({config:tooMuch});}catch(error){rejected=error;}
 assert(rejected);
 assert.equal(rejected.status,422);
 assert.equal(rejected.code,'invalid_design');
 assert(rejected.details?.some(d=>d.code==='armor_limit'&&
  d.field==='armor.HD'&&d.page===52&&d.message.includes('HD')));
 const handOnly=structuredClone(base);
 handOnly.removeHandActuators=['LA'];
 assert.deepEqual(validateDesign({config:handOnly}).state.config.removeHandActuators,['LA']);
 const badHand=structuredClone(base);
 badHand.removeHandActuators=['CT'];
 assert.throws(()=>validateDesign({config:badHand}),/invalid_design/);
});
test('AGoAC Ch12 MechLab exposes engine and server construction feedback in UI',()=>{
 const source=readFileSync(new URL('../apps/web/src/mechlab.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../apps/web/src/mechlab.html',import.meta.url),'utf8');
 assert(source.includes('r.diagnostics'),'UI must show rule-specific reasons');
 assert(source.includes('d.page'),'UI must cite printed rulebook page');
 assert(source.includes("setAttribute('aria-invalid','true')"),
  'bad design field must be marked invalid');
 assert(source.includes("['launch','save-hangar','save-copy']"),
  'invalid design must block battle and both save paths');
 assert(source.includes('data.details'),'server reasons must be displayed on save rejection');
 assert(html.includes('removeHandLA')&&html.includes('removeHandRA'),
  'hand actuator removal must be independently selectable');
});

test('AGoAC p.54 MechLab source-derived record sheet displays all construction locations',()=>{
 const ui=readFileSync(new URL('../apps/web/src/mechlab.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../apps/web/src/mechlab.html',import.meta.url),'utf8');
 assert(ui.includes('function renderDesignRecord(result,diagnostics)'));
 assert(ui.includes('const u=result.unit;'),'record must use canonical constructor result');
 assert(ui.includes('Object.entries(u.slots)'),'every critical location present');
 assert(ui.includes("u.walk+'/'+u.run+'/'+u.jump"),'running MP must be source-derived');
 assert(ui.includes('result.remaining'),'unused mass recorded from engine');
 assert(ui.includes('diagnostics.length'),'failed design remains a draft');
 assert(html.includes('id="design-record"')&&html.includes('id="design-sheet"'));
});

test('CAT3500D p.54 authenticated custom designs reject insufficient ammo with explicit rule reason',()=>{
 const cfg={name:'Custom stock',tonnage:100,walk:3,jump:0,sinks:10,
  armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
  rear:{CT:0,LT:0,RT:0},
  equipment:[{type:'AC/2',location:'LA',slot:5},
   {type:'AC/2',location:'RA',slot:5},
   {type:'ammo',location:'LT',slot:1,weapon:0,mass:1}]};
 assert.throws(()=>validateDesign({config:cfg}),error=>
  error.status===422&&error.code==='invalid_design'&&
  error.details.some(d=>d.code==='ammunition'&&d.step===7&&d.page===54&&
   d.message.includes('не менее 2 т')),'server must reject even direct POST/PATCH');
 cfg.equipment.push({type:'ammo',location:'LT',slot:2,weapon:1,mass:1});
 assert.doesNotThrow(()=>validateDesign({config:cfg}));
});

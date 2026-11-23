import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {construct,designSubmissionDiagnostics} from '../packages/engine/construction.js';
import {Game} from '../dist/engine.js';
import {MECH_OFFERS,rejectedMtf,sourceManifest,totalMtfRecords,totalArchiveRecords,archivedTechnicalRecords,archiveComplete,
  searchMechCatalog,getMechDetails,mechWeightClass,searchReferenceEquipment,
  getReferenceEquipmentDetails} from '../apps/api/src/market.mjs';
import {importMtf} from '../apps/api/src/mtf.mjs';
import {parseMegaMekUnit} from '../apps/api/src/mm-archive.mjs';
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
  assert.equal(first.total,totalArchiveRecords);
  assert(totalArchiveRecords>=4305);
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
  if(unavailable.referenceComplete){
    assert.equal(typeof unavailable.sourceRaw,'string');
    assert(unavailable.sourceRaw.length>100);
    assert.equal(typeof unavailable.sourceFields,'object');
    assert(unavailable.note.includes('импортирована'));
    if(unavailable.tonnage!=null)
      assert(Number.isFinite(unavailable.tonnage));
  }else{
    assert.equal(unavailable.tonnage,undefined,
      'Never invent tonnage for files without a source record');
  }
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
  assert(noMass.items.every(x=>x.tonnage>=99&&x.tonnage<=100),
    'All mass-filtered rows must have source-derived mass, ready or not');
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
 assert(ui.includes('u.bins.map')&&ui.includes('b.mass')&&ui.includes('b.shots'),
  'technical sheet shows each individual ammo bin, tonnage and shots');
 assert(ui.includes('Бункеры боеприпасов'),
  'ammo bins have their own record-sheet table');
 assert(ui.includes("w.rear?'Назад':'Вперёд'"),
  'printed p.54: every weapon reports its forward or rearward installation');
 assert(ui.includes("if(!s)return 'Roll Again'"),
  'printed p.49/54: empty critical slots show Roll Again on the technical sheet');
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

test('CAT3500D p.55: saved-browser and engine custom setup both fail closed on unsupported components',()=>{
 const app=readFileSync(new URL('../apps/web/src/app.js',import.meta.url),'utf8');
 const engine=readFileSync(new URL('../packages/engine/engine.js',import.meta.url),'utf8');
 assert(app.includes("outOfBookEquipment(d.config).length"),
  'browser battle launch must revalidate localStorage, not trust MechLab state');
 assert(engine.includes("outOfBookEquipment(custom.config).length"),
  'direct engine custom setup must not bypass the box rulebook');
 assert(engine.includes("construct(custom.config,{strictAgoac:true})"),
  'engine user-created forces must enforce book ammo minimum');
 assert(engine.includes("construct(design);"),
  'printed source MTFs are intentionally imported without custom-only restrictions');
});


test('CAT3500D p.54: authenticated hangar accepts ammo before guns and locates invalid references',()=>{
 const cfg={name:'Ammo order',tonnage:100,walk:3,jump:0,sinks:10,
  armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
  rear:{CT:0,LT:0,RT:0},
  equipment:[
   {type:'ammo',location:'LT',slot:1,weapon:0,mass:1},
   {type:'AC/5',location:'RA',slot:5},
   {type:'ammo',location:'LT',slot:2,weapon:1,mass:1},
   {type:'AC/5',location:'LA',slot:5}
  ]};
 assert.doesNotThrow(()=>validateDesign({config:cfg}),
  'legal designs cannot depend on which UI row was entered first');
 const bad=structuredClone(cfg);
 bad.equipment[0].weapon=8;
 assert.throws(()=>validateDesign({config:bad}),error=>
  error.status===422&&error.code==='invalid_design'&&
  error.details.some(d=>d.field==='equipment.0.weapon'&&
   d.code==='ammunition'&&d.page===54));
 const badMass=structuredClone(cfg);
 badMass.equipment[2].mass=0.5;
 assert.throws(()=>validateDesign({config:badMass}),error=>
  error.status===422&&error.code==='invalid_design'&&
  error.details.some(d=>d.field==='equipment.2.mass'&&
   d.code==='ammunition'&&d.page===54));
});


test('CAT3500D p.55: Hangar preserves explicit unsupported-equipment error despite strict engine guard',()=>{
 const config={name:'Out-of-box',tonnage:100,walk:3,jump:0,sinks:10,
  armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
  rear:{CT:0,LT:0,RT:0},
  equipment:[{type:'ER PPC',location:'RA',slot:5}]};
 assert.throws(()=>validateDesign({config}),e=>
  e.status===422&&e.code==='unsupported_rulebook_equipment'&&
  e.details.some(d=>d.field==='equipment.0.type'&&d.page===55&&
    d.code==='not_in_box_rulebook'));
 const source=readFileSync(new URL('../apps/web/src/mechlab.js',import.meta.url),'utf8');
 assert(source.includes('construct(c,{strictAgoac:true})'));
 assert(!source.includes('notInBook'),
  'client must consume one canonical constructor diagnostic, not duplicate it');
});


test('CAT3500D p.55: MechLab constructor and Hangar API return identical unknown/advanced gear reasons',()=>{
 const config={name:'Unsupported component parity',tonnage:100,walk:3,jump:0,sinks:10,
  armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
  rear:{CT:0,LT:0,RT:0},
  equipment:[{type:'ER PPC',location:'RA',slot:5},
   {type:'__proto__',location:'LA',slot:5}]};
 const constructed=construct(config,{strictAgoac:true});
 const sorted=details=>details.filter(d=>d.code==='not_in_box_rulebook')
  .sort((a,b)=>a.field.localeCompare(b.field));
 const expected=sorted(constructed.diagnostics);
 assert.deepEqual(expected.map(d=>d.field),['equipment.0.type','equipment.1.type']);
 assert(expected.every(d=>d.page===55&&d.step===7&&
  d.message.includes('отсутствует в таблице A Game of Armored Combat')));
 assert.throws(()=>validateDesign({config}),error=>
  error.status===422&&error.code==='unsupported_rulebook_equipment'&&
  JSON.stringify(sorted(error.details))===JSON.stringify(expected),
  'authenticated Hangar must reuse the constructor reasons shown by MechLab');
 const unknown=structuredClone(config);
 unknown.equipment.shift();
 const direct=construct(unknown,{strictAgoac:true});
 assert(direct.errors.some(e=>e.includes('Неизвестное оборудование')));
 assert.deepEqual(direct.diagnostics.filter(d=>d.code==='not_in_box_rulebook')
  .map(d=>d.field),['equipment.0.type']);
});


test('CAT3500D pp.49,54: submission metadata, Hangar and MechLab share typed rejection reasons',()=>{
 const baseDesign={name:'Metadata validation',tonnage:100,walk:3,jump:0,sinks:10,
  armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
  rear:{CT:0,LT:0,RT:0},equipment:[]};
 const cases=[
  ['empty name',c=>{c.name='';},'name','name_required'],
  ['long name',c=>{c.name='x'.repeat(31);},'name','name_too_long'],
  ['unknown key',c=>{c.specialEngine=true;},'config','unknown_design_field'],
  ['too many rows',c=>{c.equipment=Array.from({length:81},()=>({type:'sink',location:'RT',slot:1}));},
   'equipment','equipment_rows'],
  ['missing rear map',c=>{delete c.rear;},'rear','armor_shape'],
  ['illegal actuator selector',c=>{c.removeActuators=['CT'];},'removeActuators','actuators']
 ];
 for(const [name,mutate,field,code] of cases){
  const c=structuredClone(baseDesign);mutate(c);
  const expected=designSubmissionDiagnostics(c);
  assert(expected.some(d=>d.field===field&&d.code===code),name);
  assert.throws(()=>validateDesign({config:c}),error=>
   error.status===422&&error.code==='invalid_design'&&
   JSON.stringify(error.details)===JSON.stringify(expected),
   name+' must have exactly the same structured reasons as the client');
 }
 const file=readFileSync(new URL('../apps/web/src/mechlab.js',import.meta.url),'utf8');
 assert(file.includes('designSubmissionDiagnostics(c)'),
  'editor must add the canonical submission diagnostics');
 const launch=readFileSync(new URL('../apps/web/src/app.js',import.meta.url),'utf8');
 assert(launch.includes('designSubmissionDiagnostics(d.config).length'),
  'battle launch must also block invalid metadata');
});

test('CAT3500D p.54: missing ammo points at affected gun, not a generic equipment row',()=>{
 const c={name:'Two autocannons',tonnage:100,walk:3,jump:0,sinks:10,
  armor:{HD:9,CT:0,LT:0,RT:0,LA:0,RA:0,LL:0,RL:0},
  rear:{CT:0,LT:0,RT:0},
  equipment:[{type:'AC/2',location:'RA',slot:5},
             {type:'AC/2',location:'LA',slot:5},
             {type:'ammo',location:'LT',slot:1,weapon:0,mass:1}]};
 const r=construct(c,{strictAgoac:true});
 assert(r.diagnostics.some(d=>d.code==='ammunition'&&d.field==='equipment.0.type'&&
  d.message.includes('не менее 2 т')));
 assert.throws(()=>validateDesign({config:c}),error=>
  error.status===422&&error.details.some(d=>d.field==='equipment.0.type'&&
  d.code==='ammunition'&&d.page===54));
});


test('CAT3500D p.54: pinned COM-3A single shared SRM magazine survives source import and actual fire',()=>{
 const raw=readFileSync(new URL('../data/megamek/scenarios/COM-3A.mtf',import.meta.url),'utf8');
 const printed=importMtf(raw,{sourcePath:'data/megamek/scenarios/COM-3A.mtf'});
 const loaded=construct(printed.config);
 assert.deepEqual(loaded.errors,[]);
 const weapons=loaded.unit.weapons.map((w,i)=>w.name==='SRM 6'?i:-1)
  .filter(index=>index>=0);
 assert.equal(weapons.length,2,'actual source record contains two SRM-6 launchers');
 assert.equal(loaded.unit.bins.length,1,'actual source record has one SRM-6 ammo slot');
 assert.equal(loaded.unit.bins[0].shots,15);
 assert(weapons.every(i=>loaded.unit.weapons[i].ammo===15));
 const userDesign=construct(printed.config,{strictAgoac:true});
 assert(userDesign.errors.some(e=>e.includes('SRM 6: требуется не менее 2 т')),
  'new MechLab designs must follow p.54 even when legacy printed MTF import is allowed');
 const game=new Game({rng:()=>.99});
 for(const hex of game.tiles)Object.assign(hex,{type:'plain',height:0,depth:0,surface:0});
 const attacker=game.units[0],target=game.units[2];
 Object.assign(attacker,loaded.unit,{q:0,r:0,facing:0,twist:0,flip:false});
 Object.assign(target,{q:2,r:0});
 game.phase='fire';game.activeTeam=attacker.team;game.queue=[attacker.team];game.actingId=null;
 const result=game.declareFire(0,weapons.map(index=>({index,target:2})));
 assert.equal(result.ok,true,result.error);
 const shots=game.resolveFire();
 assert.equal(shots.length,2);
 assert.equal(attacker.bins[0].shots,13);
 assert(weapons.every(i=>attacker.weapons[i].ammo===13),
  'both source launchers read one actually depleted 15-round magazine');
});

test('CAT3500D p.52: strict engine, Hangar and custom battle block malformed armor fields',()=>{
 const source=structuredClone(MECH_OFFERS.find(o=>o.id==='mm-grf-1m').config);
 const cases=[
  ['armor','CT',[],'armor_points'],
  ['armor','CT','','armor_points'],
  ['armor','CT',false,'armor_points'],
  ['armor','CT','20','armor_points'],
  ['armor','CT',2.5,'armor_points'],
  ['rear','LT',{},'armor_points'],
  ['rear','CT',false,'armor_points'],
  ['armor','UNKNOWN',2,'armor_location'],
  ['rear','HD',1,'armor_location']
 ];
 for(const [section,loc,value,code] of cases){
  const config=structuredClone(source);
  config[section][loc]=value;
  const field=section+'.'+loc;
  const diagnostics=designSubmissionDiagnostics(config);
  assert(diagnostics.some(d=>d.field===field&&d.code===code&&d.step===5&&d.page===52),
   field+' '+JSON.stringify(value));
  const direct=construct(config,{strictAgoac:true});
  assert(direct.errors.length>0,'strict engine must reject '+field);
  assert(direct.diagnostics.some(d=>d.field===field&&d.code===code&&d.page===52));
  assert.throws(()=>validateDesign({config}),e=>e.status===422&&
   e.code==='invalid_design'&&e.details.some(d=>d.field===field&&d.code===code));
  const g=new Game();
  const refused=g.configureSetupForces({slots:['custom',null,2,3],
   custom:{config},approvals:[true,true]});
  assert.equal(refused.ok,false,'custom battle must reject '+field);
  assert.match(refused.error||refused.reason||'',/брон|секци|числом/i);
 }
 const trusted=structuredClone(source);
 trusted.armor.CT=[];
 assert.equal(construct(trusted).errors.length,0,
  'intentional non-strict source MTF import remains unchanged');
});


test('MegaMek complete pinned archive retains 11,248 lossless unit records',()=>{
 assert.equal(archiveComplete,true,'The exact pinned source archive must be bundled');
 assert.equal(totalMtfRecords,4305);
 assert.equal(totalArchiveRecords,11248);
 assert.equal(archivedTechnicalRecords,11248);
 const all=searchMechCatalog({query:'',limit:60});
 assert.equal(all.total,11248);
 assert.equal(all.archived,11248);
 assert.equal(all.archiveComplete,true);
 assert(all.items.every(item=>item.referenceComplete));
 const vehicle=searchMechCatalog({query:'AC/2 Carrier',limit:60}).items.find(x=>
  x.kind==='vehicles');
 assert(vehicle,'Vehicle BLK must be indexed, not only MTF Mechs');
 const dossier=getMechDetails(vehicle.sourcePath);
 assert.equal(dossier.sourceFormat,'blk');
 assert.equal(dossier.movement.walk,null,'Vehicle motion must not be labelled Walking MP');
 assert.equal(dossier.movement.run,null,'Do not invent Running MP for a tank');
 assert.equal(dossier.movement.cruise,3,'Keep actual MegaMek BLK cruising MP');
 assert.equal(dossier.available,false);
 assert.equal(dossier.referenceComplete,true);
 assert(dossier.sourceRaw.includes('<UnitType>'));
 assert(dossier.sourceFields['unitType'.toLowerCase()]);
 assert(Array.isArray(dossier.sourceSections['Front Equipment']));
 assert(dossier.sourceEquipment.some(x=>x.name.includes('Autocannon')));
 assert.equal(dossier.price,undefined,'No invented shop price for source-only entries');
 assert.equal(getMechDetails('../secrets.json'),null);
});

test('All source MTF BattleMechs provide their original machine-readable technical fields',()=>{
 const source=readFileSync(join(base,sourceManifest.entries.find(x=>x.file.includes('Griffin')).file),'utf8');
 const parsed=parseMegaMekUnit(source,sourceManifest.entries.find(x=>x.file.includes('Griffin')).sourcePath);
 assert.equal(parsed.kind,'meks');
 assert.equal(parsed.format,'mtf');
 assert.equal(parsed.tonnage,55);
 assert.equal(parsed.movement.walk,5);
 assert.equal(parsed.movement.jump,5);
 assert(parsed.sections['Right Torso'].length>=12);
 assert(parsed.raw.includes('Config:Biped'));
 assert.throws(()=>parseMegaMekUnit(source,'../secrets.mtf'),/Invalid pinned MegaMek path/);
 assert.throws(()=>parseMegaMekUnit(source,'data/mekfiles/meks/a.mtf/../b.mtf'),/Invalid pinned/);
});

test('Equipment search returns all source component names but only canonical base parts are eligible',()=>{
 const laser=searchReferenceEquipment({query:'Laser',group:'laser',limit:20});
 assert(laser.total>35);
 assert(laser.matches>3);
 const exact=searchReferenceEquipment({query:'Medium Laser',group:'laser',limit:60});
 const baseItem=exact.items.find(x=>x.sku==='weapon:Medium Laser');
 assert(baseItem&&baseItem.eligible,'Canonical component must be searchable by its full name');
 const imageClass=getReferenceEquipmentDetails('weapon:Small Laser').group;
 assert.equal(imageClass,getReferenceEquipmentDetails('weapon:Large Laser').group,
  'All laser variants intentionally share the same artwork class');
 const excluded=getReferenceEquipmentDetails('weapon:ER PPC');
 assert(excluded&&!excluded.eligible);
 const sources=searchReferenceEquipment({query:'Autocannon',limit:60});
 assert(sources.items.some(x=>x.kind==='source'&&!x.eligible));
 const unit=sources.items.find(x=>x.kind==='source');
 const detail=getReferenceEquipmentDetails(unit.sku);
 assert.equal(detail.source,'MegaMek/mm-data technical unit records');
 assert(detail.unitCount>0&&detail.examples.length>0);
 assert.equal(getReferenceEquipmentDetails('../market-data'),null);
});

test('Reference equipment never interprets armor numbers as component records',()=>{
 const items=searchReferenceEquipment({query:'12',limit:60}).items;
 assert(!items.some(x=>x.kind==='source'&&x.name==='12'),
   'BLK armor arrays must remain source fields, not purchasable components');
});

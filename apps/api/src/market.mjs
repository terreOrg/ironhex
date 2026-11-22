import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {EQUIPMENT,construct,LOCS} from '../../../packages/engine/construction.js';
import {importMtf} from './mtf.mjs';
import {loadMegaMekArchive,parseMegaMekUnit} from './mm-archive.mjs';
import {outOfBookEquipment} from '../../../packages/engine/rulebook.js';

// Pinned, locally bundled MegaMek Data snapshot; the live game never
// makes an outbound HTTP request when a player opens the market.
const base=fileURLToPath(new URL('../../../data/megamek/',import.meta.url));
export const sourceManifest=JSON.parse(readFileSync(join(base,'manifest.json'),'utf8'));
export const rejectedMtf=[];
export const MECH_OFFERS=[];
for(const entry of sourceManifest.entries){
  try{
    const content=readFileSync(join(base,'meks',entry.file),'utf8');
    const offer=importMtf(content,{sourcePath:entry.sourcePath});
    if(outOfBookEquipment(offer.config).length)
      throw new Error('requires_supplemental_rules');
    if(MECH_OFFERS.some(item=>item.id===offer.id))
      throw new Error('duplicate_variant');
    offer.sourceUrl=sourceManifest.sourceRepository+'/blob/'+
      sourceManifest.sourceRevision+'/'+entry.sourcePath.split('/').map(encodeURIComponent).join('/');
    MECH_OFFERS.push(offer);
  }catch(error){
    rejectedMtf.push({file:entry.file,reason:String(error.message||error)});
  }
}
MECH_OFFERS.sort((a,b)=>a.tonnage-b.tonnage||a.name.localeCompare(b.name));

const fullIndex=JSON.parse(readFileSync(join(base,'full-index.json'),'utf8'));
const offersByPath=new Map(MECH_OFFERS.map(offer=>[offer.sourcePath,offer]));
// The exact upstream reference archive retains every original MTF/BLK file.
// Models that cannot enter combat remain searchable and viewable as source
// dossiers; only explicit MECH_OFFERS may be purchased.
const unitArchive=loadMegaMekArchive(base);
const pinnedByPath=new Map(sourceManifest.entries.map(entry=>[
 entry.sourcePath,parseMegaMekUnit(
  readFileSync(join(base,'meks',entry.file),'utf8'),entry.sourcePath)
]));
const referenceByPath=unitArchive?.records||pinnedByPath;
const indexNames=new Map(fullIndex.items.map(item=>[item.path,item.name]));
const referenceItems=unitArchive?
 [...referenceByPath.values()].map(item=>({
  path:item.sourcePath,name:indexNames.get(item.sourcePath)||item.name,kind:item.kind
 })):
 fullIndex.items.map(item=>({...item,kind:'meks'}));
const byPath=new Map(referenceItems.map(item=>[item.path,item]));
export const totalMtfRecords=fullIndex.count;
export const totalArchiveRecords=referenceItems.length;
export const archivedTechnicalRecords=referenceByPath.size;
export const archiveComplete=!!unitArchive;
export const WEIGHT_CLASSES=['light','medium','heavy','assault'];
export function mechWeightClass(tonnage){
  return tonnage<=35?'light':tonnage<=55?'medium':tonnage<=75?'heavy':'assault';
}
function indexWeightClass(item,offer){
  if(item.kind&&item.kind!=='meks')return null;
  if(offer)return mechWeightClass(offer.tonnage);
  const source=referenceByPath.get(item.path);
  if(source?.tonnage!==null&&source?.tonnage>=20&&source?.tonnage<=100)
    return mechWeightClass(source.tonnage);
  // Archive folders are categorized only where the source itself states
  // the weight class. Never infer exact mass from a chassis name.
  const match=item.path.match(/\/(Light|Medium|Heavy|Assault)\//i);
  return match?match[1].toLowerCase():null;
}
function sourceLink(item){
  return 'https://github.com/'+fullIndex.repository+'/blob/'+fullIndex.revision+'/'+
    item.path.split('/').map(encodeURIComponent).join('/');
}
const safeInteger=value=>{
  if(value===null||value===undefined||value==='')return null;
  const number=Number(value);
  return Number.isSafeInteger(number)?number:null;
};
function matchesFilters(item,offer,f){
  const cls=indexWeightClass(item,offer),source=referenceByPath.get(item.path);
  const tonnage=offer?.tonnage??source?.tonnage??null;
  const era=offer?.era??source?.era??null;
  const role=offer?.role??source?.role??null;
  const equipped=offer?.config.equipment.map(x=>x.type)||source?.weapons||[];
  if(f.availableOnly&&!offer)return false;
  if(f.weightClass&&cls!==f.weightClass)return false;
  if(f.tonnageMin!==null&&(tonnage===null||tonnage<f.tonnageMin))return false;
  if(f.tonnageMax!==null&&(tonnage===null||tonnage>f.tonnageMax))return false;
  if(f.eraMin!==null&&(era===null||era<f.eraMin))return false;
  if(f.eraMax!==null&&(era===null||era>f.eraMax))return false;
  if(f.priceMax!==null&&(!offer||offer.price>f.priceMax))return false;
  if(f.role&&(!role||role.toLowerCase()!==f.role))return false;
  if(f.weapon&&!equipped.some(x=>x.toLowerCase().includes(f.weapon)))return false;
  return true;
}
export function searchMechCatalog({
  query='',page=1,limit=36,availableOnly=false,
  tonnageMin,tonnageMax,weightClass='',eraMin,eraMax,priceMax,
  role='',weapon='',sort='name'
}={}){
  const q=String(query).trim().toLowerCase().slice(0,100);
  const p=Math.max(1,Math.min(10000,safeInteger(page)||1));
  const size=Math.max(1,Math.min(60,safeInteger(limit)||36));
  const f={
    availableOnly:availableOnly===true,
    tonnageMin:safeInteger(tonnageMin),tonnageMax:safeInteger(tonnageMax),
    weightClass:WEIGHT_CLASSES.includes(weightClass)?weightClass:'',
    eraMin:safeInteger(eraMin),eraMax:safeInteger(eraMax),
    priceMax:safeInteger(priceMax),
    role:String(role).toLowerCase().slice(0,35),
    weapon:String(weapon).toLowerCase().slice(0,35)
  };
  const ordering=['name','tonnage','year','price'].includes(sort)?sort:'name';
  const matched=referenceItems.filter(item=>
    (!q||item.name.toLowerCase().includes(q))&&
    matchesFilters(item,offersByPath.get(item.path),f));
  // Filter BEFORE paging so the page count and sorting stay consistent.
  if(ordering==='name')matched.sort((a,b)=>a.name.localeCompare(b.name));
  else{
    const field=ordering==='tonnage'?'tonnage':ordering==='year'?'era':'price';
    matched.sort((a,b)=>{
      const av=(offersByPath.get(a.path)||referenceByPath.get(a.path))?.[field]??Number.POSITIVE_INFINITY;
      const bv=(offersByPath.get(b.path)||referenceByPath.get(b.path))?.[field]??Number.POSITIVE_INFINITY;
      return av-bv||a.name.localeCompare(b.name);
    });
  }
  const pageItems=matched.slice((p-1)*size,p*size).map(item=>{
    const offer=offersByPath.get(item.path),source=referenceByPath.get(item.path);
    return {name:item.name,sourcePath:item.path,sourceUrl:sourceLink(item),
      kind:item.kind||'meks',referenceComplete:!!source,
      ...(source?.tonnage!==null&&source?.tonnage!==undefined?{tonnage:source.tonnage}:{}),
      ...(source?.era?{era:source.era}:{}),
      ...(source?.role?{role:source.role}:{}),
      sourceLicense:fullIndex.license,available:!!offer,
      weightClass:indexWeightClass(item,offer),
      ...(offer?{offerId:offer.id,price:offer.price,tonnage:offer.tonnage,
        description:offer.description,era:offer.era,role:offer.role}:{}),
      status:offer?'ready':'not_yet_supported'};
  });
  return {total:referenceItems.length,archiveComplete,archived:referenceByPath.size,
    available:MECH_OFFERS.length,
    matches:matched.length,page:p,limit:size,pages:Math.ceil(matched.length/size),
    items:pageItems,sourceRevision:fullIndex.revision};
}
export function getMechDetails(sourcePath){
  // Only look up paths present in the pinned index, never read caller paths
  // directly from disk.
  const item=byPath.get(sourcePath);
  if(!item)return null;
  const offer=offersByPath.get(item.path);
  const source=referenceByPath.get(item.path);
  const baseDetail={
    name:item.name,sourcePath:item.path,sourceUrl:sourceLink(item),
    sourceLicense:fullIndex.license,available:!!offer,
    kind:item.kind||'meks',referenceComplete:!!source,
    weightClass:indexWeightClass(item,offer),
    ...(source?{
      sourceFormat:source.format,sourceTechBase:source.techBase,
      sourceConfig:source.config,tonnage:source.tonnage,era:source.era,
      role:source.role,movement:source.movement,engine:source.engine,
      heatSinks:source.heatSinks,sourceEquipment:source.equipmentRows,
      sourceFields:source.fields,sourceSections:source.sections,
      sourceRaw:source.raw
    }:{})
  };
  if(!offer){
    return {...baseDetail,
      note:source?'Полная исходная техническая запись импортирована. В бою и покупке модель пока не поддерживается.':
        'Исходный файл пока не включён в локальный архив. Оригинал доступен по ссылке MegaMek Data.'};
  }
  const result=construct(offer.config);
  if(result.errors.length||!result.unit)throw new Error('Invalid bundled mech: '+offer.id);
  const {unit}=result;
  const config=offer.config;
  return {...baseDetail,offerId:offer.id,price:offer.price,era:offer.era,
    role:offer.role,tonnage:offer.tonnage,techBase:'Inner Sphere',
    engineRating:offer.tonnage*config.walk,
    movement:{walk:config.walk,run:Math.ceil(config.walk*1.5),jump:config.jump},
    heatSinks:config.sinks,
    armor:LOCS.map(loc=>({
      location:loc,front:config.armor[loc],
      rear:config.rear[loc]??null,
      structure:unit.maxStructure[loc]
    })),
    weights:result.weights,
    remainingTonnage:result.remaining,
    equipment:config.equipment.map(e=>({
      type:e.type,location:e.location,slot:e.slot,
      ...(e.rear?{rear:true}:{}),...(e.type==='ammo'?{mass:e.mass??1,
        weapon:unit.weapons[e.weapon]?.name||null}:{})
    })),
    weapons:unit.weapons.map(w=>({name:w.name,location:w.location,
      ...(w.locations?{locations:w.locations}:{}),rear:w.rear,
      damage:w.damage,heat:w.heat,minimum:w.min,range:w.ranges,
      ammo:w.ammo,rack:w.rack})),
    criticalSlots:Object.fromEntries(Object.entries(unit.slots).map(([loc,slots])=>
      [loc,slots.map(s=>{
        if(s===null)return null;
        if(s.startsWith('w:'))return unit.weapons[Number(s.slice(2))]?.name||s;
        if(s.startsWith('ammo:'))return 'Боезапас '+(unit.weapons[Number(s.split(':')[1])]?.name||'');
        return s;
      })]))
  };
}

if(MECH_OFFERS.length<4)
  throw new Error('Not enough MegaMek mechs supported: '+JSON.stringify(rejectedMtf));
export const showMechOffer=offer=>({
  id:offer.id,name:offer.name,sourcePath:offer.sourcePath,price:offer.price,description:offer.description,
  tonnage:offer.config.tonnage,era:offer.era,role:offer.role,
  sourceUrl:offer.sourceUrl,sourceLicense:sourceManifest.licenseId,
  weapons:offer.config.equipment.filter(e=>EQUIPMENT.includes(e.type)).map(e=>e.type)
});

// Merchandise is generated from the *same* rules definitions as combat.
export {WEAPON_SPECS} from '../../../packages/engine/equipment.js';
import {WEAPON_SPECS,WEAPON_NAMES,AMMO_PACKS,SYSTEM_ITEMS,FIXED_COMPONENTS} from '../../../packages/engine/equipment.js';
import {BASE_WEAPONS,BASE_RULEBOOK,equipmentRulebook,isBaseWeapon} from '../../../packages/engine/rulebook.js';
export const EQUIPMENT_CATALOG=[
  ...BASE_WEAPONS.map(name=>{
    const item=WEAPON_SPECS[name];
    return {sku:item.id,name:item.name,price:item.price,kind:'weapon',
      tons:item.tons,slots:item.slots,heat:item.heat,damage:item.damage,
      ranges:item.ranges,roundsPerTon:item.roundsPerTon,
      introYear:item.introYear,techBase:item.techBase,accuracyModifier:item.accuracyModifier,
      rulebook:equipmentRulebook(name)};
  }),
  ...Object.values(AMMO_PACKS).filter(pack=>isBaseWeapon(pack.weapon)).map(pack=>({...pack,rulebook:{status:'verified_base',book:BASE_RULEBOOK.title,page:55}})),
  ...SYSTEM_ITEMS.map(item=>({...item,rulebook:item.type==='case'||item.type==='case2'?
    {status:'verified_supplement',book:'BattleMech Manual',page:item.type==='case2'?119:118}:
    {status:'verified_base',book:BASE_RULEBOOK.title,page:item.type==='hatchet'?55:53}}))
];
export const weaponName=sku=>typeof sku==='string'&&sku.startsWith('weapon:')&&
  Object.hasOwn(WEAPON_SPECS,sku.slice(7))?sku.slice(7):null;
export function weaponCounts(config){
  const result=new Map();
  for(const item of config.equipment||[]){
    if(!Object.hasOwn(WEAPON_SPECS,item.type))continue;
    result.set(item.type,(result.get(item.type)||0)+1);
  }
  return result;
}


// Reference-only entries are NOT implicitly sold or legal for AGoAC combat.
export const REFERENCE_EQUIPMENT_CATALOG=[
 ...WEAPON_NAMES.map(name=>{
  const item=WEAPON_SPECS[name];
  return {sku:item.id,name,kind:'weapon',group:name.includes('Laser')?'laser':
   name.includes('PPC')?'ppc':/^(LRM|SRM)/.test(name)?'missile':
   name==='Machine Gun'?'machinegun':name==='Flamer'?'flamer':'ballistic',
   source:'IronHex equipment registry',eligible:BASE_WEAPONS.includes(name),
   heat:item.heat,damage:item.damage,minimum:item.minimum,ranges:item.ranges,
   mass:item.tons,slots:item.slots,roundsPerTon:item.roundsPerTon,
   accuracyModifier:item.accuracyModifier,techBase:item.techBase,
   price:item.price,era:item.introYear,rulebook:equipmentRulebook(name)};
 }),
 ...Object.values(AMMO_PACKS).map(x=>({sku:x.sku,name:x.name,kind:'ammo',
   group:'ammo',source:'IronHex equipment registry',
   eligible:isBaseWeapon(x.weapon),weapon:x.weapon,shots:x.rounds,
   mass:x.tons,price:x.price})),
 ...Object.entries(FIXED_COMPONENTS).map(([type,x])=>({
   sku:'system:'+type,name:x.name,kind:'system',
   group:type==='hatchet'?'hatchet':type==='sink'?'cooling':type,
   source:'IronHex equipment registry',eligible:['jump','sink','hatchet'].includes(type),
   mass:x.tons??null,slots:x.slots??null,price:x.price,
   rulebook:type.startsWith('case')?'Supplemental BattleTech':'AGoAC'
 }))
];
function equipmentGroup(name){
 const s=name.toLowerCase();
 if(/laser|flamer|beam/.test(s))return 'laser';
 if(/\bppc\b|particle/.test(s))return 'ppc';
 if(/\blrm\b|\bsrm\b|missile|rocket|streak|mrm/.test(s))return 'missile';
 if(/machine gun|\bmg\b/.test(s))return 'machinegun';
 if(/autocannon|ac\/?\d|gauss|rifle|cannon|lb-?x|ultra ac/.test(s))return 'ballistic';
 if(/hatchet|axe|sword|claw/.test(s))return 'hatchet';
 if(/ammo|ammunition|rounds/.test(s))return 'ammo';
 if(/heat sink|radiator/.test(s))return 'cooling';
 return 'system';
}
const sourceEquipment=new Map();
for(const source of referenceByPath.values()){
 const seen=new Set();
 for(const {name} of source.equipmentRows){
  if(!name||name==='-Empty-'||seen.has(name))continue;
  seen.add(name);
  let entry=sourceEquipment.get(name);
  if(!entry){
   const code=createHash('sha256').update(name).digest('hex').slice(0,24);
   entry={sku:'source:'+code,name,kind:'source',group:equipmentGroup(name),
     source:'MegaMek/mm-data technical unit records',eligible:false,
     unitCount:0,examples:[]};
   sourceEquipment.set(name,entry);
  }
  entry.unitCount++;
  if(entry.examples.length<3)entry.examples.push(source.sourcePath);
 }
}
REFERENCE_EQUIPMENT_CATALOG.push(...sourceEquipment.values());
const referenceEquipmentBySku=new Map(REFERENCE_EQUIPMENT_CATALOG.map(x=>[x.sku,x]));
export function searchReferenceEquipment({query='',page=1,limit=36,group=''}={}){
 const q=String(query).trim().toLowerCase().slice(0,120);
 const p=Math.max(1,Math.min(10000,safeInteger(page)||1));
 const size=Math.max(1,Math.min(60,safeInteger(limit)||36));
 const items=REFERENCE_EQUIPMENT_CATALOG.filter(item=>
  (!q||item.name.toLowerCase().includes(q))&&
  (!group||item.group===group)).sort((a,b)=>a.name.localeCompare(b.name));
 return {total:REFERENCE_EQUIPMENT_CATALOG.length,
  archived:sourceEquipment.size,matches:items.length,page:p,limit:size,
  pages:Math.ceil(items.length/size),
  items:items.slice((p-1)*size,p*size).map(x=>({
   sku:x.sku,name:x.name,group:x.group,source:x.source,kind:x.kind,
   eligible:x.eligible,unitCount:x.unitCount??null
  }))};
}
export function getReferenceEquipmentDetails(sku){
 return typeof sku==='string'&&sku.length<140?
  referenceEquipmentBySku.get(sku)||null:null;
}

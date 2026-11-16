import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {EQUIPMENT,construct,LOCS} from '../../../packages/engine/construction.js';
import {importMtf} from './mtf.mjs';

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
const byPath=new Map(fullIndex.items.map(item=>[item.path,item]));
export const totalMtfRecords=fullIndex.count;
export const WEIGHT_CLASSES=['light','medium','heavy','assault'];
export function mechWeightClass(tonnage){
  return tonnage<=35?'light':tonnage<=55?'medium':tonnage<=75?'heavy':'assault';
}
function indexWeightClass(item,offer){
  if(offer)return mechWeightClass(offer.tonnage);
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
  const cls=indexWeightClass(item,offer);
  if(f.availableOnly&&!offer)return false;
  if(f.weightClass&&cls!==f.weightClass)return false;
  if(f.tonnageMin!==null&&(!offer||offer.tonnage<f.tonnageMin))return false;
  if(f.tonnageMax!==null&&(!offer||offer.tonnage>f.tonnageMax))return false;
  if(f.eraMin!==null&&(!offer||!offer.era||offer.era<f.eraMin))return false;
  if(f.eraMax!==null&&(!offer||!offer.era||offer.era>f.eraMax))return false;
  if(f.priceMax!==null&&(!offer||offer.price>f.priceMax))return false;
  if(f.role&&(!offer||offer.role?.toLowerCase()!==f.role))return false;
  if(f.weapon&&(!offer||!offer.config.equipment.some(e=>
    e.type.toLowerCase().includes(f.weapon)&&EQUIPMENT.includes(e.type))))return false;
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
  const matched=fullIndex.items.filter(item=>
    (!q||item.name.toLowerCase().includes(q))&&
    matchesFilters(item,offersByPath.get(item.path),f));
  // Filter BEFORE paging so the page count and sorting stay consistent.
  if(ordering==='name')matched.sort((a,b)=>a.name.localeCompare(b.name));
  else{
    const field=ordering==='tonnage'?'tonnage':ordering==='year'?'era':'price';
    matched.sort((a,b)=>{
      const av=offersByPath.get(a.path)?.[field]??Number.POSITIVE_INFINITY;
      const bv=offersByPath.get(b.path)?.[field]??Number.POSITIVE_INFINITY;
      return av-bv||a.name.localeCompare(b.name);
    });
  }
  const pageItems=matched.slice((p-1)*size,p*size).map(item=>{
    const offer=offersByPath.get(item.path);
    return {name:item.name,sourcePath:item.path,sourceUrl:sourceLink(item),
      sourceLicense:fullIndex.license,available:!!offer,
      weightClass:indexWeightClass(item,offer),
      ...(offer?{offerId:offer.id,price:offer.price,tonnage:offer.tonnage,
        description:offer.description,era:offer.era,role:offer.role}:{}),
      status:offer?'ready':'not_yet_supported'};
  });
  return {total:fullIndex.count,available:MECH_OFFERS.length,
    matches:matched.length,page:p,limit:size,pages:Math.ceil(matched.length/size),
    items:pageItems,sourceRevision:fullIndex.revision};
}
export function getMechDetails(sourcePath){
  // Only look up paths present in the pinned index, never read caller paths
  // directly from disk.
  const item=byPath.get(sourcePath);
  if(!item)return null;
  const offer=offersByPath.get(item.path);
  const baseDetail={
    name:item.name,sourcePath:item.path,sourceUrl:sourceLink(item),
    sourceLicense:fullIndex.license,available:!!offer,
    weightClass:indexWeightClass(item,offer)
  };
  if(!offer){
    return {...baseDetail,
      note:'Для этой модификации полный MTF ещё не включён в движок IronHex. '+
        'Исходная карточка доступна по ссылке MegaMek Data; параметры не подменяются похожим мехом.'};
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
import {WEAPON_SPECS,WEAPON_NAMES,AMMO_PACKS,SYSTEM_ITEMS} from '../../../packages/engine/equipment.js';
export const EQUIPMENT_CATALOG=[
  ...WEAPON_NAMES.map(name=>{
    const item=WEAPON_SPECS[name];
    return {sku:item.id,name:item.name,price:item.price,kind:'weapon',
      tons:item.tons,slots:item.slots,heat:item.heat,damage:item.damage,
      ranges:item.ranges,roundsPerTon:item.roundsPerTon,
      introYear:item.introYear,techBase:item.techBase,accuracyModifier:item.accuracyModifier};
  }),
  ...Object.values(AMMO_PACKS).map(pack=>({...pack})),
  ...SYSTEM_ITEMS.map(item=>({...item}))
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

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {EQUIPMENT} from '../../../packages/engine/construction.js';
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
export const totalMtfRecords=fullIndex.count;
export function searchMechCatalog({query='',page=1,limit=36,availableOnly=false}={}){
  const q=String(query).trim().toLocaleLowerCase().slice(0,100);
  const p=Math.max(1,Math.min(10000,Number(page)||1));
  const size=Math.max(1,Math.min(60,Number(limit)||36));
  const matched=fullIndex.items.filter(item=>
    (!q||item.name.toLocaleLowerCase().includes(q))&&
    (!availableOnly||offersByPath.has(item.path)));
  const pageItems=matched.slice((p-1)*size,p*size).map(item=>{
    const offer=offersByPath.get(item.path);
    return {name:item.name,sourceUrl:fullIndex.repository?
      'https://github.com/'+fullIndex.repository+'/blob/'+fullIndex.revision+'/'+
        item.path.split('/').map(encodeURIComponent).join('/') : null,
      sourceLicense:fullIndex.license,available:!!offer,
      ...(offer?{offerId:offer.id,price:offer.price,
        tonnage:offer.tonnage,description:offer.description,
        era:offer.era,role:offer.role}:{}),
      status:offer?'ready':'not_yet_supported'};
  });
  return {total:fullIndex.count,available:MECH_OFFERS.length,
    matches:matched.length,page:p,limit:size,pages:Math.ceil(matched.length/size),
    items:pageItems,sourceRevision:fullIndex.revision};
}

if(MECH_OFFERS.length<4)
  throw new Error('Not enough MegaMek mechs supported: '+JSON.stringify(rejectedMtf));
export const showMechOffer=offer=>({
  id:offer.id,name:offer.name,price:offer.price,description:offer.description,
  tonnage:offer.config.tonnage,era:offer.era,role:offer.role,
  sourceUrl:offer.sourceUrl,sourceLicense:sourceManifest.licenseId,
  weapons:offer.config.equipment.filter(e=>EQUIPMENT.includes(e.type)).map(e=>e.type)
});

// Weapon purchases are pegged to existing IronHex game balance costs,
// not to (unavailable) authoritative currency valuations in MTF.
const PRICES={
  'Large Laser':6000,'Medium Laser':2500,'Small Laser':1100,Flamer:900,
  PPC:9500,'AC/2':3500,'AC/5':5500,'AC/10':9500,'AC/20':14500,
  'Machine Gun':900,'LRM 5':2200,'LRM 10':4500,'LRM 15':6700,
  'LRM 20':8700,'SRM 2':1500,'SRM 4':2500,'SRM 6':3600
};
if(EQUIPMENT.some(name=>!PRICES[name]))throw new Error('Missing equipment price');
export const EQUIPMENT_CATALOG=EQUIPMENT.map(name=>({
  sku:'weapon:'+name,name,price:PRICES[name],kind:'weapon'
}));
export const weaponName=sku=>typeof sku==='string'&&sku.startsWith('weapon:')&&
  EQUIPMENT.includes(sku.slice(7))?sku.slice(7):null;
export function weaponCounts(config){
  const result=new Map();
  for(const item of config.equipment||[]){
    if(!EQUIPMENT.includes(item.type))continue;
    result.set(item.type,(result.get(item.type)||0)+1);
  }
  return result;
}

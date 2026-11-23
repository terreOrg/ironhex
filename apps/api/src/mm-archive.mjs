import {existsSync,readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';

// Archive is a pinned, immutable mirror of original MegaMek/mm-data unit files.
// It is a REFERENCE catalogue, never a licence to use unsupported designs in battle.
export const MM_DATA_REVISION='5ee1b15ff2877611db4b0ffa864a57d0b9f72938';
export const MM_DATA_LICENSE='CC-BY-NC-SA-4.0';
const ROOT='data/mekfiles/';
const SUPPORTED=/\.(?:mtf|blk)$/i;
const MECH_LOCS=new Set(['Head','Center Torso','Left Torso','Right Torso',
 'Left Arm','Right Arm','Left Leg','Right Leg']);
const strip=(s,max=100000)=>String(s??'').trim().slice(0,max);
const finiteNumber=(x)=>{
 if(x===null||x===undefined||!String(x).trim())return null;
 const v=Number(String(x).trim());
 return Number.isFinite(v)&&v>=0?v:null;
};
const intValue=x=>{
 const n=finiteNumber(x);
 return n!==null&&Number.isSafeInteger(n)?n:null;
};
const arrayOfLines=value=>String(value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);

// Parsing is intentionally lossless: every source character remains in raw.
// The extracted fields/sections only help search and render; malformed/unknown
// equipment is preserved in its original form, never guessed or substituted.
export function parseMegaMekUnit(raw,sourcePath){
 if(typeof raw!=='string'||raw.length>2_000_000)throw Error('Invalid raw unit record');
 if(typeof sourcePath!=='string'||!sourcePath.startsWith(ROOT)||
  sourcePath.includes('..')||sourcePath.includes('\\')||!SUPPORTED.test(sourcePath))
  throw Error('Invalid pinned MegaMek path');
 const type=sourcePath.toLowerCase().endsWith('.mtf')?'mtf':'blk';
 const kind=sourcePath.slice(ROOT.length).split('/')[0]||'unknown';
 const fallback=sourcePath.split('/').at(-1).replace(/\.(?:mtf|blk)$/i,'');
 const fields=Object.create(null),sections=Object.create(null);
 if(type==='mtf'){
  let location=null;
  for(const line of raw.replace(/\r/g,'').split('\n')){
   // A bounded key and first separator avoid quadratic regex backtracking.
   const colon=line.indexOf(':');
   const keyText=colon>0&&colon<=100?line.slice(0,colon):null;
   if(keyText!==null&&!keyText.includes('#')){
    const key=keyText.trim(),val=line.slice(colon+1).trim();
    if(MECH_LOCS.has(key)&&!val){location=key;sections[key]=[];continue}
    if(val&&!Object.hasOwn(fields,key.toLowerCase()))fields[key.toLowerCase()]=val;
   }
   if(location&&(!line.trim()||(/^([^:#]+):/.test(line)&&!MECH_LOCS.has(line.split(':')[0]))))location=null;
   else if(location)sections[location].push(line.trim());
  }
 }else{
  // MegaMek BLK uses XML-like tagged records rather than a valid XML DOM.
  // Tags with unusual names such as <mul id:> must not crash the importer.
  // Scan each opening tag and find its exact closing delimiter literally.
  // The old nested-whitespace regex could backtrack super-linearly.
  const openingTag=/<([^<>/\r\n]{1,100})>/g;
  let match;
  while((match=openingTag.exec(raw))!==null){
   const close='</'+match[1]+'>';
   const end=raw.indexOf(close,openingTag.lastIndex);
   if(end<0)continue;
   const key=strip(match[1],100);
   const value=strip(raw.slice(openingTag.lastIndex,end),500000);
   openingTag.lastIndex=end+close.length;
   if(!Object.hasOwn(fields,key.toLowerCase()))fields[key.toLowerCase()]=value;
   if(/equipment|armor|critical|transport|bay|weapon/i.test(key))
    sections[key]=arrayOfLines(value);
  }
 }
 const get=(...names)=>names.map(k=>fields[k.toLowerCase()]).find(x=>x!==undefined);
 const name=type==='mtf'?
  [get('chassis'),get('model')].filter(Boolean).join(' ').trim()||fallback:
  strip(get('name','chassis')||fallback,150);
 const tonnage=finiteNumber(get('mass','tonnage','weight'));
 const era=intValue(get('era','year'));
 const role=strip(get('role'),80)||null;
 const techBase=strip(get('techbase','type','tech_base'),120)||null;
 const config=strip(get('config','unitType','motion_type'),120)||null;
 const walk=intValue(get('walk mp'));
 const cruise=intValue(get('cruiseMP'));
 const jump=intValue(get('jump mp','jumpMP'));
 const engine=strip(get('engine','engine_type'),150)||null;
 const heatSinks=strip(get('heat sinks','heatSinks'),80)||null;
 const weaponItems=[];
 for(const [location,slots] of Object.entries(sections)){
  // BLK armor and cargo capacity tables are not equipment definitions.
  if(type==='blk'&&!/equipment|weapons/i.test(location))continue;
  for(const item of slots){
   if(!item||/^(?:-Empty-|Fusion Engine|Gyro|Sensors|Life Support|Cockpit|Shoulder|Upper Arm Actuator|Lower Arm Actuator|Hand Actuator|Hip|Upper Leg Actuator|Lower Leg Actuator|Foot Actuator)$/i.test(item))continue;
   weaponItems.push({location,name:strip(item,160)});
  }
 }
 // Do not present inferred accuracy/cost/purchase status as canonical data.
 return {sourcePath,name,kind,format:type,tonnage,era,role,techBase,config,
  movement:{walk,run:walk===null?null:Math.ceil(walk*1.5),jump,cruise},
  engine,heatSinks,weapons:[...new Set(weaponItems.map(e=>e.name))],
  equipmentRows:weaponItems,fields,sections,raw};
}

export function loadMegaMekArchive(baseDir){
 const path=join(baseDir,'archive','all-units.json.gz');
 if(!existsSync(path))return null;
 const bytes=readFileSync(path);
 const data=JSON.parse(gunzipSync(bytes).toString('utf8'));
 if(data?.revision!==MM_DATA_REVISION||data.license!==MM_DATA_LICENSE||
   !Array.isArray(data.records)||data.records.length<4305)
  throw Error('Incorrect or incomplete MegaMek archive provenance');
 const records=new Map();
 for(const {path:sourcePath,raw} of data.records){
  if(records.has(sourcePath))throw Error('Duplicate MegaMek archive path '+sourcePath);
  records.set(sourcePath,parseMegaMekUnit(raw,sourcePath));
 }
 if(records.size!==data.records.length)throw Error('MegaMek archive missing units');
 return {records,count:records.size,mtfCount:data.mtfCount,kindCounts:data.kindCounts,
  revision:data.revision,license:data.license};
}

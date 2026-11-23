import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,dirname,join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {MM_DATA_REVISION,MM_DATA_LICENSE,parseMegaMekUnit} from '../apps/api/src/mm-archive.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const indexFlag=args.indexOf('--source');
if(indexFlag<0||!args[indexFlag+1])
 throw Error('Usage: node scripts/import-mm-data.mjs --source /path/to/mm-data');
const source=resolve(args[indexFlag+1]);
const location=join(source,'data','mekfiles');
const pending=[location],paths=[];
while(pending.length){
 const dir=pending.pop();
 const children=await readdir(dir,{withFileTypes:true});
 for(const ent of children){
  const path=join(dir,ent.name);
  if(ent.isSymbolicLink())throw Error('Unexpected symlink inside pinned source '+path);
  if(ent.isDirectory())pending.push(path);
  else if(ent.isFile()&&/\.(mtf|blk)$/i.test(ent.name))paths.push(path);
 }
}
// Preserve built-in UTF-16 lexicographic order explicitly.
paths.sort((a,b)=>a<b?-1:a>b?1:0);
const index=JSON.parse(await readFile(join(project,'data','megamek','full-index.json'),'utf8'));
if(index.revision!==MM_DATA_REVISION||index.count!==4305)
 throw Error('Pinned MTF index revision/count mismatch');
const records=[],kindCounts={};
for(const file of paths){
 const sourcePath=relative(source,file).split('\\').join('/');
 if(!sourcePath.startsWith('data/mekfiles/'))throw Error('Untrusted source path');
 const raw=await readFile(file,'utf8');
 // Fail closed for malformed units rather than silently omitting them.
 const parsed=parseMegaMekUnit(raw,sourcePath);
 records.push({path:sourcePath,raw});
 kindCounts[parsed.kind]=(kindCounts[parsed.kind]||0)+1;
}
const found=new Set(records.map(r=>r.path));
const missing=index.items.filter(item=>!found.has(item.path));
if(missing.length)throw Error('Incomplete archive: '+missing.length+' MTF entries absent; first '+missing[0].path);
const mtfCount=records.filter(x=>x.path.toLowerCase().endsWith('.mtf')).length;
if(mtfCount<4305)throw Error('Too few MTF units in source: '+mtfCount);
const archive={revision:MM_DATA_REVISION,repository:'MegaMek/mm-data',license:MM_DATA_LICENSE,
 count:records.length,mtfCount,kindCounts,records};
const body=gzipSync(Buffer.from(JSON.stringify(archive),'utf8'),{level:9});
const dest=join(project,'data','megamek','archive','all-units.json.gz');
await mkdir(dirname(dest),{recursive:true});
await writeFile(dest,body);
console.log(JSON.stringify({path:dest,unitCount:records.length,mtfCount,
 fromIndex:index.count,missingFromIndex:0,compressedBytes:body.length,kindCounts},null,2));

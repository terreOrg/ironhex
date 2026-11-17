import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import convert from 'v8-to-istanbul';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const root=fileURLToPath(new URL('../',import.meta.url));
const rawDir=process.argv[2];
if(!rawDir)throw Error('Usage: node tests/backend-coverage.mjs <V8 coverage directory>');
const map=libCoverage.createCoverageMap({});
const prefix='/app/apps/api/src/';
const rawFiles=(await readdir(rawDir)).filter(name=>/^coverage-.*\.json$/.test(name));
if(!rawFiles.length)throw Error('No Docker V8 coverage reports were flushed');
const apiRoot=resolve(root,'apps/api/src')+sep;
for(const name of rawFiles){
  const data=JSON.parse(await readFile(resolve(rawDir,name),'utf8'));
  if(!Array.isArray(data.result))throw Error('Malformed V8 coverage file: '+name);
  for(const script of data.result){
    if(!script.url?.startsWith('file:'))continue;
    const containerPath=fileURLToPath(script.url);
    if(!containerPath.startsWith(prefix))continue;
    const sourcePath=resolve(apiRoot,containerPath.slice(prefix.length));
    if(!sourcePath.startsWith(apiRoot)||!sourcePath.endsWith('.mjs'))continue;
    const source=await readFile(sourcePath,'utf8');
    const converter=convert(sourcePath,0,{source});
    await converter.load();
    converter.applyCoverage(script.functions);
    map.merge(converter.toIstanbul());
  }
}
for(const filename of ['index.mjs','http.mjs','db.mjs','auth.mjs','account-flows.mjs',
  'hangar.mjs','pilots.mjs','operations.mjs','economy.mjs']){
  const path=resolve(apiRoot,filename);
  if(!map.files().includes(path)||map.fileCoverageFor(path).toSummary().lines.covered===0)
    throw Error('Missing executed API coverage: '+filename);
}
const dir=resolve(root,'coverage');
await mkdir(dir,{recursive:true});
reports.create('lcovonly',{file:'backend.info',projectRoot:root})
  .execute(libReport.createContext({dir,coverageMap:map}));
// Portable Istanbul map for later merging with unit V8 coverage on another runner.
const portable={};
for(const path of map.files()){
  const key=relative(root,path).split(sep).join('/');
  portable[key]={...map.fileCoverageFor(path).toJSON(),path:key};
}
await writeFile(resolve(dir,'backend-map.json'),JSON.stringify(portable));
console.log('PostgreSQL integration coverage collected for '+map.files().length+' API modules from '+rawFiles.length+' V8 files');
for(const path of map.files()){
  const summary=map.fileCoverageFor(path).toSummary();
  console.log(relative(root,path)+': '+summary.lines.covered+'/'+summary.lines.total+' executed lines');
}

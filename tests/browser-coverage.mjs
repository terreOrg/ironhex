import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only UI modules exclusive to the browser report. Shared engine and record
// sheet already have Node LCOV records: avoid mixing incompatible branch IDs.
const webOnly=new Set(['app.js','auth-ui.js','hub.js','economy-ui.js',
  'operation-ui.js','pilot-ui.js','mechlab.js','dice.js','mech-toggle.js']);
const root=fileURLToPath(new URL('../',import.meta.url));

export async function createBrowserCoverage(){
  if(process.env.IRONHEX_BROWSER_COVERAGE!=='1')return null;
  const [{default:convert},{default:libCoverage},{default:libReport},{default:reports}]=
    await Promise.all([import('v8-to-istanbul'),import('istanbul-lib-coverage'),
      import('istanbul-lib-report'),import('istanbul-reports')]);
  const map=libCoverage.createCoverageMap({});
  return {
    async add(entries,baseURL){
      for(const entry of entries){
        const url=new URL(entry.url,baseURL);
        if(url.origin!==baseURL)continue;
        const filename=url.pathname.slice(1);
        if(!webOnly.has(filename))continue;
        const sourcePath=filename==='mech-toggle.js'?resolve(root,'packages/ui/mech-toggle',filename):resolve(root,'apps/web/src',filename);
        const source=await readFile(sourcePath,'utf8');
        if(source!==entry.source)
          throw new Error('Browser coverage source mismatch: '+filename);
        const converter=convert(sourcePath,0,{source});
        await converter.load();
        converter.applyCoverage(entry.functions);
        map.merge(converter.toIstanbul());
      }
    },
    async write(){
      // Fail if instrumentation silently produced no executed application code.
      for(const filename of ['app.js','auth-ui.js','hub.js']){
        const path=resolve(root,'apps/web/src',filename);
        if(!map.files().includes(path)||map.fileCoverageFor(path).toSummary().lines.covered===0)
          throw new Error('Missing executed browser coverage: '+filename);
      }
      const dir=resolve(root,'coverage');
      await mkdir(dir,{recursive:true});
      const context=libReport.createContext({dir,coverageMap:map});
      reports.create('lcovonly',{file:'browser.info',projectRoot:root}).execute(context);
      console.log('Browser coverage collected for '+map.files().length+' first-party UI modules');
    }
  };
}

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function canSkipSmoke(paths){
 return Array.isArray(paths)&&paths.length>0&&paths.every(p=>
  /^(?:packages\/engine\/[^/]+\.js|apps\/web\/src\/[^/]+\.(?:js|css|html)|dist\/[^/]+\.(?:js|css|html)|tests\/agoac-foundations\.mjs|rules\/[^/]+\.json|docs\/[^/]+\.md|README\.md)$/.test(p));
}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let skip=false;
 try{
  if(process.env.GITHUB_EVENT_NAME==='push'){
   const sha=process.env.GITHUB_SHA;
   const base=process.env.GITHUB_REF==='refs/heads/main'
     ?git('rev-parse',sha+'^1'):git('merge-base',sha,'refs/remotes/origin/main');
   skip=canSkipSmoke(git('diff','--no-renames','--name-only',base,sha).split('\n').filter(Boolean));
  }
 }catch(e){console.warn('Full smoke fallback:',e.message);}
 appendFileSync(process.env.GITHUB_OUTPUT,'skip_smoke='+skip+'\n');
 console.log('Skip full container smoke:',skip);
}

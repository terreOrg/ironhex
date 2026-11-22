import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const shaPattern=/^[a-f0-9]{40}$/i;
export function identicalMergeParent({parents,tree,parentTree}){
 return parents?.length===2&&shaPattern.test(parents[1])&&shaPattern.test(tree)&&tree===parentTree?parents[1]:null;
}
export function reusableRun(runs,sha,name){
 const matching=runs.filter(r=>r.name===name&&r.head_sha===sha&&r.event==='push'&&/^(audit\/agoac-|feat\/agoac-ch12-)/.test(r.head_branch));
 if(matching.some(r=>r.status!=='completed'||!['success','cancelled'].includes(r.conclusion)))return null;
 return matching.find(r=>r.conclusion==='success'&&Number.isSafeInteger(r.id))?.id??null;
}
export function matchingArtifact(artifacts,name){
 return artifacts.some(a=>a.name===name&&!a.expired&&a.size_in_bytes>0);
}
const git=(...args)=>execFileSync('/usr/bin/git',args,{encoding:'utf8',env:{...process.env,PATH:'/usr/bin:/bin'}}).trim();
async function api(path){
 const r=await fetch('https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+path,{headers:{
 Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'ironhex-coverage-plan'
 },signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('GitHub API HTTP '+r.status);
 return r.json();
}
const fallback=()=>({reuse_ci:'',reuse_browser:'',parent_sha:''});
async function plan(){
 const out=fallback();
 if(process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_REF!=='refs/heads/main')return out;
 const sha=process.env.GITHUB_SHA;
 if(!shaPattern.test(sha??''))return out;
 const parents=git('show','-s','--format=%P',sha).split(' ').filter(Boolean);
 if(parents.length!==2)return out;
 const parent=identicalMergeParent({parents,tree:git('rev-parse',sha+'^{tree}'),parentTree:git('rev-parse',parents[1]+'^{tree}')});
 if(!parent)return out;
 const runs=(await api('/actions/runs?head_sha='+parent+'&per_page=100')).workflow_runs??[];
 out.parent_sha=parent;
 for(const [key,name,prefix] of [['reuse_ci','Ironhex CI','ironhex-unit-lcov-'],['reuse_browser','Ironhex Browser E2E','ironhex-browser-lcov-']]){
  const id=reusableRun(runs,parent,name);
  if(id&&matchingArtifact((await api('/actions/runs/'+id+'/artifacts?per_page=100')).artifacts??[],prefix+parent))out[key]=String(id);
 }
 return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let out=fallback();
 try{out=await plan();}catch(e){console.warn('Full coverage fallback:',e.message);}
 appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(out).map(([k,v])=>k+'='+v+'\n').join(''));
 console.log('Coverage reuse:',JSON.stringify(out));
}

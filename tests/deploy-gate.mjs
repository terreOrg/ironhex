import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLcov,normalizeCoverageFile } from '../scripts/normalize-sonar-coverage.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { evaluateDeployment, makeWebhookRequest, requiredWorkflows } from '../scripts/deploy-gate.mjs';

const sha='a'.repeat(40);
const success=name=>({
  name,head_sha:sha,head_branch:'main',event:'push',status:'completed',conclusion:'success'
});
test('all same-commit successful workflows allow deployment',()=>{
  assert.equal(evaluateDeployment({
    sha,mainSha:sha,runs:requiredWorkflows.map(success)
  }).ready,true);
});
test('newer main head prevents stale deployment',()=>{
  assert.match(evaluateDeployment({
    sha,mainSha:'b'.repeat(40),runs:requiredWorkflows.map(success)
  }).reason,/no longer HEAD/);
});
test('missing, incomplete or failing workflows prevent deployment',()=>{
  const r=requiredWorkflows.map(success);
  assert.equal(evaluateDeployment({sha,mainSha:sha,runs:r.slice(0,-1)}).ready,false);
  assert.equal(evaluateDeployment({sha,mainSha:sha,runs:r.map((a,i)=>i? a:{...a,status:'in_progress',conclusion:null})}).ready,false);
  assert.equal(evaluateDeployment({sha,mainSha:sha,runs:r.map((a,i)=>i? a:{...a,conclusion:'failure'})}).ready,false);
});
test('manually triggered workflow cannot satisfy push gate',()=>{
  const r=requiredWorkflows.map((x,i)=>i?success(x):{...success(x),event:'workflow_dispatch'});
  assert.equal(evaluateDeployment({sha,mainSha:sha,runs:r}).ready,false);
});
test('webhook uses authenticated HMAC over exact body',()=>{
  const {body,signature}=makeWebhookRequest({sha,secret:'unit-test-key'});
  assert.equal(signature,'sha256='+createHmac('sha256','unit-test-key').update(body).digest('hex'));
  assert.equal(JSON.parse(body).ref,'refs/heads/main');
});
test('SonarQube is mandatory and must pass on the same main commit',()=>{
  assert.ok(requiredWorkflows.includes('Ironhex SonarQube'));
  const others=requiredWorkflows.filter(name=>name!=='Ironhex SonarQube').map(success);
  const sonar=success('Ironhex SonarQube');
  for (const invalid of [undefined,{...sonar,conclusion:'failure'},{...sonar,status:'in_progress',conclusion:null},{...sonar,head_sha:'b'.repeat(40)}]) {
    assert.equal(evaluateDeployment({sha,mainSha:sha,runs:invalid?[...others,invalid]:others}).ready,false);
  }
  assert.equal(evaluateDeployment({sha,mainSha:sha,runs:[...others,sonar]}).ready,true);
});

async function withCoverageFiles(run){
  const root=await mkdtemp(join(tmpdir(),'ironhex-lcov-'));
  try{
    for(const dir of ['dist','packages/engine','apps/web/src'])await mkdir(join(root,dir),{recursive:true});
    for(const path of ['dist/engine.js','packages/engine/engine.js','dist/app.js','apps/web/src/app.js'])
      await writeFile(join(root,path),'export const testValue=1;\n');
    await run(root);
  }finally{await rm(root,{recursive:true,force:true});}
}
test('LCOV maps generated engine and web records, retaining hit counts and duplicates',async()=>{
  await withCoverageFiles(async root=>{
    const entries=['TN:','SF:dist/engine.js','DA:1,5','end_of_record',
      'SF:'+join(root,'dist/app.js'),'BRDA:1,0,0,2','end_of_record',
      'SF:./dist/engine.js','DA:1,3','end_of_record',
      'SF:packages/engine/engine.js','DA:1,1','end_of_record',''];
    const result=await normalizeLcov(entries.join('\r\n'),root);
    assert.equal(result.mapped,3);
    assert.equal(result.text,entries.map(line=>line==='SF:dist/engine.js'||line==='SF:./dist/engine.js'?'SF:packages/engine/engine.js':line==='SF:'+join(root,'dist/app.js')?'SF:apps/web/src/app.js':line).join('\n'));
    const report=join(root,'report.info');
    await writeFile(report,entries.join('\n'));
    assert.equal(await normalizeCoverageFile(report,root),3);
    assert.equal(await readFile(report,'utf8'),result.text);
    assert.equal(await normalizeCoverageFile(report,root),0);
  });
});
test('LCOV fails closed for unknown, nested or stale generated sources',async()=>{
  await withCoverageFiles(async root=>{
    await assert.rejects(normalizeLcov('SF:dist/unknown.js\n',root),/Unmapped generated coverage source/);
    await assert.rejects(normalizeLcov('SF:dist/nested/app.js\n',root),/Unmapped generated coverage source/);
    await writeFile(join(root,'dist/app.js'),'stale generated contents');
    const report=join(root,'report.info');
    const input='SF:dist/engine.js\nDA:1,4\nend_of_record\nSF:dist/app.js\nDA:1,1\nend_of_record\n';
    await writeFile(report,input);
    await assert.rejects(normalizeCoverageFile(report,root),/Coverage source differs/);
    assert.equal(await readFile(report,'utf8'),input,'Do not overwrite the report on validation failure');
  });
});
test('deploy gate rejects malformed SHAs and missing signing secrets',()=>{
  assert.equal(evaluateDeployment({sha:'not-a-sha',mainSha:sha,runs:requiredWorkflows.map(success)}).ready,false);
  assert.throws(()=>makeWebhookRequest({sha}),/secret/i);
});

test('cancelled duplicates cannot veto or substitute for a completed same-SHA success',()=>{
  const runs=requiredWorkflows.map(success);
  const duplicate={...runs[0],conclusion:'cancelled'};
  const evaluate=items=>evaluateDeployment({sha,mainSha:sha,runs:items}).ready;
  assert.equal(evaluate([...runs,duplicate]),true);
  assert.equal(evaluate([duplicate,...runs]),true);
  assert.equal(evaluate([duplicate,...runs.slice(1)]),false);
  for(const conclusion of ['failure','timed_out','action_required','skipped','neutral','stale',null]){
    assert.equal(evaluate([...runs,{...duplicate,conclusion}]),false);
  }
  for(const status of ['queued','in_progress','waiting','pending']){
    assert.equal(evaluate([...runs,{...duplicate,status,conclusion:null}]),false);
  }
  for(const other of [{head_sha:'b'.repeat(40)},{head_branch:'audit/test'},{event:'pull_request'}]){
    assert.equal(evaluate([duplicate,...runs.slice(1),{...runs[0],...other}]),false);
  }
});

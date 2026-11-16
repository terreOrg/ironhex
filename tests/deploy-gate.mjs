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

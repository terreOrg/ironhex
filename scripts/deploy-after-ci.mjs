import { evaluateDeployment, makeWebhookRequest } from './deploy-gate.mjs';

const {
  GITHUB_TOKEN: token,
  GITHUB_REPOSITORY: repository,
  SOURCE_SHA: sha,
  KOMODO_WEBHOOK_URL: webhookUrl,
  KOMODO_WEBHOOK_SECRET: webhookSecret
} = process.env;

if (!token || !repository || !sha) throw Error('Missing required GitHub Actions environment');

async function github(path) {
  const r = await fetch('https://api.github.com' + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ironhex-deploy-check'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw Error('GitHub API returned HTTP ' + r.status + ' for ' + path);
  return r.json();
}

let ready = false;
let reason = 'unknown';
for (let attempt = 0; attempt < 60; attempt++) {
  const [branch, page] = await Promise.all([
    github('/repos/' + repository + '/git/ref/heads/main'),
    github('/repos/' + repository + '/actions/runs?head_sha=' + encodeURIComponent(sha) + '&per_page=100')
  ]);
  ({ready,reason} = evaluateDeployment({
    sha, mainSha: branch.object.sha, runs: page.workflow_runs || []
  }));
  if (ready || reason === 'commit is no longer HEAD of main' || reason.includes('did not pass')) break;
  if (attempt !== 59) await new Promise(resolve => setTimeout(resolve, 8000));
}
console.log('Deployment gate: ' + reason);
if (!ready) process.exit(0);

if (!webhookUrl || !webhookSecret) {
  console.log('::warning::Komodo auto-deploy is not enabled. Set KOMODO_WEBHOOK_URL and KOMODO_WEBHOOK_SECRET as GitHub Actions repository secrets.');
  process.exit(0);
}

const endpoint = new URL(webhookUrl);
if (!/^\/listener\/github\/stack\/[^/]+\/deploy\/?$/.test(endpoint.pathname)) {
  throw Error('KOMODO_WEBHOOK_URL must be the exact Komodo Stack deploy webhook URL');
}
const local = ['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname);
if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && local)) {
  throw Error('Webhook URL must use HTTPS, or HTTP with loopback host only');
}
if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
  throw Error('Webhook URL must not contain credentials, query parameters or fragment');
}

const {body, signature} = makeWebhookRequest({sha,secret:webhookSecret,repository});
const r = await fetch(endpoint, {
  method:'POST',
  headers:{
    'Content-Type':'application/json',
    'X-GitHub-Event':'push',
    'X-Hub-Signature-256':signature,
    'User-Agent':'ironhex-deploy-check'
  },
  body,
  signal: AbortSignal.timeout(20000)
});
if (!r.ok) throw Error('Komodo webhook rejected request: HTTP ' + r.status);
console.log('Komodo accepted signed deploy webhook for commit ' + sha.slice(0,12));
console.log('Deployment runs asynchronously; verify completion and health in Komodo.');

import { createHmac } from 'node:crypto';

export const requiredWorkflows = [
  'Ironhex CI',
  'Ironhex Browser E2E',
  'Ironhex Container Smoke',
  'Ironhex SonarQube'
];

export function evaluateDeployment({ sha, mainSha, runs }) {
  if (!/^[a-f0-9]{40}$/i.test(sha)) return { ready: false, reason: 'invalid commit SHA' };
  if (sha !== mainSha) return { ready: false, reason: 'commit is no longer HEAD of main' };
  for (const name of requiredWorkflows) {
    const matching = runs.filter(run =>
      run.name === name && run.head_sha === sha &&
      run.head_branch === 'main' && run.event === (name === 'Ironhex Container Smoke' ? 'workflow_dispatch' : 'push')
    );
    if (!matching.length) return { ready: false, reason: name + ' has not started' };
    // A cancelled duplicate is not a successful check, but does not invalidate
    // another completed success for the identical main push. All other
    // non-success results and unfinished runs remain blocking.
    if (matching.some(run => run.status === 'completed' &&
      !['success', 'cancelled'].includes(run.conclusion))) {
      return { ready: false, reason: name + ' did not pass' };
    }
    if (matching.some(run => run.status !== 'completed') ||
      !matching.some(run => run.status === 'completed' && run.conclusion === 'success')) {
      return { ready: false, reason: name + ' is not successful yet' };
    }
  }
  return { ready: true, reason: 'all required CI checks succeeded' };
}

export function makeWebhookRequest({ sha, secret, repository = 'terreOrg/ironhex' }) {
  if (!secret) throw Error('Missing Komodo webhook secret');
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw Error('Invalid commit SHA');
  const body = JSON.stringify({
    ref: 'refs/heads/main',
    after: sha,
    repository: { full_name: repository, default_branch: 'main' }
  });
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return { body, signature: 'sha256=' + signature };
}

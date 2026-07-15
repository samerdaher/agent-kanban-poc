import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * End-to-end API tests. Boots the built app (npm run build first) on an
 * ephemeral port with an isolated data dir and NO Anthropic key, so agent
 * execution runs in deterministic simulation mode.
 */

const PORT = 3299;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-test-'));
let server;
let cookie = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data, headers: res.headers };
}

async function waitForStatus(wid, taskId, statuses, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data } = await api('GET', `/api/workspaces/${wid}/tasks/${taskId}`);
    if (data?.task && statuses.includes(data.task.status)) return data.task;
    if (Date.now() > deadline) throw new Error(`task ${taskId} never reached ${statuses} (now: ${data?.task?.status})`);
    await sleep(400);
  }
}

before(async () => {
  const root = path.resolve(import.meta.dirname, '..');
  // spawn the next binary directly (no npx shell wrapper) in its own process
  // group, so `after` can kill the whole tree and node --test exits cleanly
  server = spawn(
    process.execPath,
    [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)],
    {
      cwd: root,
      env: {
        ...process.env,
        AGENTBOARD_DATA_DIR: DATA,
        ANTHROPIC_API_KEY: '', // force simulation mode (overrides .env)
        AGENT_EXECUTOR: 'api', // never route test runs to a local Claude subscription
        NODE_ENV: 'production',
      },
      stdio: 'ignore',
      detached: true,
    },
  );
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('server did not start');
    await sleep(300);
  }
});

after(() => {
  try {
    process.kill(-server.pid, 'SIGKILL'); // kill the whole process group
  } catch {
    server?.kill('SIGKILL');
  }
  fs.rmSync(DATA, { recursive: true, force: true });
});

let wid = '';
let webhookToken = '';

test('unauthenticated requests are rejected', async () => {
  const { status } = await api('GET', '/api/workspaces');
  assert.equal(status, 401);
});

test('signup creates account, session and seeded workspace', async () => {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', name: 'Test User', password: 'password123' }),
  });
  assert.equal(res.status, 201);
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('ab_session='));
  const data = await res.json();
  wid = data.workspaces[0].id;
  assert.ok(wid);
});

test('workspace meta exposes webhook token to members', async () => {
  const { status, data } = await api('GET', `/api/workspaces/${wid}`);
  assert.equal(status, 200);
  webhookToken = data.workspace.webhookToken;
  assert.ok(webhookToken.length > 20);
});

test('agent task runs to completion (simulation) and records a run', async () => {
  const { status, data } = await api('POST', `/api/workspaces/${wid}/tasks`, {
    title: 'Write a haiku about kanban',
    type: 'agent',
    status: 'sprint',
  });
  assert.equal(status, 201);
  const task = await waitForStatus(wid, data.task.id, ['completed']);
  assert.ok(task.output.length > 20);
  assert.ok(task.runs.length >= 1);
  assert.equal(task.runs[0].simulated, true);
});

test('definition of done is stored and outcome recorded', async () => {
  const { data } = await api('POST', `/api/workspaces/${wid}/tasks`, {
    title: 'DoD probe',
    type: 'agent',
    status: 'sprint',
    definitionOfDone: '- must exist',
  });
  const task = await waitForStatus(wid, data.task.id, ['completed']);
  assert.equal(task.definitionOfDone, '- must exist');
  assert.equal(task.runs[0].outcome, 'passed'); // simulation short-circuits to passed
});

test('askHuman: revise re-queues with correction, approve completes', async () => {
  const { data } = await api('POST', `/api/workspaces/${wid}/tasks`, {
    title: 'Needs human sign-off',
    type: 'agent',
    status: 'sprint',
    askHuman: true,
  });
  const id = data.task.id;
  let task = await waitForStatus(wid, id, ['blocked']);
  assert.equal(task.blocked.kind, 'human_question');
  assert.ok(task.pendingQuestion);

  // request changes → re-run → asks again
  const rev = await api('POST', `/api/workspaces/${wid}/tasks/${id}/answer`, {
    answer: 'Make it shorter and add a title.',
    action: 'revise',
  });
  assert.equal(rev.status, 200);
  task = await waitForStatus(wid, id, ['blocked']);
  assert.equal(task.blocked.kind, 'human_question');

  // the correction became a workspace lesson (offline fallback text)
  const lessons = await api('GET', `/api/workspaces/${wid}/lessons`);
  assert.ok(lessons.data.lessons.some((l) => l.kind === 'correction'));

  // revision context flows into the next run: it saw the previous attempt
  assert.ok(task.updates.some((u) => u.kind === 'context' && /revision mode/.test(u.text)));

  // approve → completed
  const ok = await api('POST', `/api/workspaces/${wid}/tasks/${id}/answer`, { answer: '', action: 'approve' });
  assert.equal(ok.status, 200);
  task = await waitForStatus(wid, id, ['completed']);
  assert.equal(task.status, 'completed');
});

test('revise without an answer is rejected', async () => {
  const { data } = await api('POST', `/api/workspaces/${wid}/tasks`, {
    title: 'Another sign-off task',
    type: 'agent',
    status: 'sprint',
    askHuman: true,
  });
  await waitForStatus(wid, data.task.id, ['blocked']);
  const bad = await api('POST', `/api/workspaces/${wid}/tasks/${data.task.id}/answer`, {
    answer: '',
    action: 'revise',
  });
  assert.equal(bad.status, 400);
  await api('POST', `/api/workspaces/${wid}/tasks/${data.task.id}/answer`, { answer: 'ok', action: 'approve' });
});

test('dependency gate blocks and auto-resumes', async () => {
  const human = await api('POST', `/api/workspaces/${wid}/tasks`, { title: 'Human approval', type: 'human' });
  const dep = await api('POST', `/api/workspaces/${wid}/tasks`, {
    title: 'Depends on approval',
    type: 'agent',
    status: 'sprint',
    dependencies: [human.data.task.id],
  });
  let task = await waitForStatus(wid, dep.data.task.id, ['blocked']);
  assert.equal(task.blocked.kind, 'dependency');
  await api('PATCH', `/api/workspaces/${wid}/tasks/${human.data.task.id}`, { status: 'completed' });
  task = await waitForStatus(wid, dep.data.task.id, ['completed']);
  assert.equal(task.status, 'completed');
});

test('missing resource blocks; adding it (with encrypted secret) unblocks', async () => {
  const t = await api('POST', `/api/workspaces/${wid}/tasks`, {
    title: 'Needs a credential',
    type: 'agent',
    status: 'sprint',
    requirements: ['test-api-key'],
  });
  let task = await waitForStatus(wid, t.data.task.id, ['blocked']);
  assert.equal(task.blocked.kind, 'missing_resource');
  const res = await api('POST', `/api/workspaces/${wid}/resources`, {
    name: 'test-api-key',
    kind: 'credential',
    secret: 'super-secret-value',
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.resource.hasSecret, true);
  task = await waitForStatus(wid, t.data.task.id, ['completed']);
  assert.equal(task.status, 'completed');
});

test('inbound webhook creates a task that runs immediately', async () => {
  cookieless: {
    const res = await fetch(`${BASE}/api/webhooks/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${webhookToken}` },
      body: JSON.stringify({ title: 'Created by CI system', description: 'from webhook' }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    const task = await waitForStatus(wid, data.task.id, ['completed']);
    assert.ok(task.updates.some((u) => u.actor === 'webhook'));
    break cookieless;
  }
});

test('webhook auth is enforced', async () => {
  const bad = await fetch(`${BASE}/api/webhooks/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
    body: JSON.stringify({ title: 'nope' }),
  });
  assert.equal(bad.status, 403);
  const none = await fetch(`${BASE}/api/webhooks/task-ready`, { method: 'POST' });
  assert.equal(none.status, 401);
});

test('re-run with instructions builds on the previous output', async () => {
  const { data } = await api('POST', `/api/workspaces/${wid}/tasks`, {
    title: 'Rerun probe',
    type: 'agent',
    status: 'sprint',
  });
  const id = data.task.id;
  let task = await waitForStatus(wid, id, ['completed']);
  assert.equal(task.runs.length, 1);

  const rr = await api('POST', `/api/workspaces/${wid}/tasks/${id}/rerun`, {
    instructions: 'Add a summary section at the top.',
  });
  assert.equal(rr.status, 200);
  task = await waitForStatus(wid, id, ['completed']);
  assert.ok(task.runs.length >= 2);
  assert.ok(task.updates.some((u) => u.kind === 'answer' && u.text.startsWith('Re-run requested:')));
  assert.ok(task.updates.some((u) => u.kind === 'context' && /revision mode/.test(u.text)));

  // instructions without text are rejected; human tasks cannot re-run
  const bad = await api('POST', `/api/workspaces/${wid}/tasks/${id}/rerun`, { instructions: '' });
  assert.equal(bad.status, 400);
  const human = await api('POST', `/api/workspaces/${wid}/tasks`, { title: 'Human rerun probe', type: 'human' });
  const noHuman = await api('POST', `/api/workspaces/${wid}/tasks/${human.data.task.id}/rerun`, {
    instructions: 'x',
  });
  assert.equal(noHuman.status, 400);
});

test('archive and delete lifecycle', async () => {
  const t = await api('POST', `/api/workspaces/${wid}/tasks`, { title: 'To archive', type: 'human' });
  const id = t.data.task.id;
  const arch = await api('PATCH', `/api/workspaces/${wid}/tasks/${id}`, { status: 'archived' });
  assert.equal(arch.data.task.status, 'archived');
  const del = await api('DELETE', `/api/workspaces/${wid}/tasks/${id}`);
  assert.equal(del.status, 200);
  const gone = await api('GET', `/api/workspaces/${wid}/tasks/${id}`);
  assert.equal(gone.status, 404);
});

test('stats aggregate runs for the workspace', async () => {
  const { status, data } = await api('GET', `/api/workspaces/${wid}/stats`);
  assert.equal(status, 200);
  assert.ok(data.stats.runs >= 3);
  assert.equal(typeof data.stats.costUsd, 'number');
});

test('lessons can be taught and deleted by humans', async () => {
  const add = await api('POST', `/api/workspaces/${wid}/lessons`, { text: 'Always include a summary line.' });
  assert.equal(add.status, 201);
  const del = await api('DELETE', `/api/workspaces/${wid}/lessons/${add.data.lesson.id}`);
  assert.equal(del.status, 200);
});

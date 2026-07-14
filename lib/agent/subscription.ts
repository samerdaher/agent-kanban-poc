import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { RunUsage } from './claude';

/**
 * Subscription executor: runs task work through headless Claude Code
 * (`claude -p`) authenticated with the machine's claude.ai OAuth login
 * (Pro/Max), so runs draw on the subscription instead of API credits.
 * File deliverables are generated locally with LibreOffice (soffice)
 * instead of the API code-execution container.
 */

export interface CliResult {
  text: string;
  usage: RunUsage;
  model: string;
}

const TEXT_TIMEOUT_MS = Number(process.env.SUBSCRIPTION_TEXT_TIMEOUT_MS || 420000);
const FILE_TIMEOUT_MS = Number(process.env.SUBSCRIPTION_FILE_TIMEOUT_MS || 600000);

export function subscriptionAvailable(): boolean {
  try {
    return fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'));
  } catch {
    return false;
  }
}

export function sofficeAvailable(): boolean {
  return ['/usr/bin/soffice', '/usr/local/bin/soffice'].some((p) => fs.existsSync(p));
}

function runCli(args: string[], opts: { cwd?: string; timeoutMs: number }): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // force claude.ai OAuth auth — an API key in the env would win and bill credits
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    const child = spawn('claude', args, {
      cwd: opts.cwd || process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      reject(new Error('subscription run timed out'));
    }, opts.timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error(String(j.result || 'claude CLI error').slice(0, 300)));
        const u = (j.usage || {}) as Record<string, number>;
        resolve({
          text: String(j.result ?? ''),
          usage: {
            input: Number(u.input_tokens || 0),
            output: Number(u.output_tokens || 0),
            cacheRead: Number(u.cache_read_input_tokens || 0),
            cacheWrite: Number(u.cache_creation_input_tokens || 0),
          },
          model: typeof j.modelUsage === 'object' && j.modelUsage
            ? `subscription:${Object.keys(j.modelUsage)[0] || 'claude-code'}`
            : 'subscription:claude-code',
        });
      } catch {
        reject(new Error(`claude CLI exited ${code}: ${(err || out).slice(0, 300)}`));
      }
    });
  });
}

/** Pure text completion on the subscription (no tools). */
export function subscriptionText(system: string, prompt: string): Promise<CliResult> {
  return runCli(
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--append-system-prompt',
      system,
      '--disallowedTools',
      'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit',
    ],
    { timeoutMs: TEXT_TIMEOUT_MS },
  );
}

/**
 * File deliverable on the subscription: headless Claude Code works inside the
 * task's files directory with a restricted toolset (file tools + LibreOffice
 * / python for conversions) and must leave the finished document there.
 */
export async function subscriptionFileTask(
  system: string,
  prompt: string,
  workdir: string,
): Promise<CliResult & { files: string[] }> {
  fs.mkdirSync(workdir, { recursive: true });
  const before = new Set(fs.readdirSync(workdir));
  const res = await runCli(
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--append-system-prompt',
      system,
      '--allowedTools',
      'Read,Write,Edit,Glob,Bash(soffice *),Bash(libreoffice *),Bash(python3 *),Bash(ls *),Bash(file *),Bash(unzip *)',
    ],
    { cwd: workdir, timeoutMs: FILE_TIMEOUT_MS },
  );
  const files = fs
    .readdirSync(workdir)
    .filter((f) => /\.(pptx|xlsx|docx|pdf)$/i.test(f) && !before.has(f));
  return { ...res, files };
}

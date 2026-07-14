import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db';

/**
 * Credential vault: resource secret values are encrypted at rest with
 * AES-256-GCM. The key comes from AGENTBOARD_SECRET_KEY (64 hex chars) or is
 * generated once into data/vault.key (0600, gitignored).
 */

const KEY_FILE = path.join(DATA_DIR, 'vault.key');

const g = globalThis as unknown as { __agentboardVaultKey?: Buffer };

function vaultKey(): Buffer {
  if (g.__agentboardVaultKey) return g.__agentboardVaultKey;
  const env = process.env.AGENTBOARD_SECRET_KEY;
  if (env) {
    const key = Buffer.from(env, 'hex');
    if (key.length !== 32) throw new Error('AGENTBOARD_SECRET_KEY must be 64 hex characters (32 bytes)');
    g.__agentboardVaultKey = key;
    return key;
  }
  try {
    const key = fs.readFileSync(KEY_FILE);
    if (key.length === 32) {
      g.__agentboardVaultKey = key;
      return key;
    }
  } catch {
    /* no key file yet */
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  g.__agentboardVaultKey = key;
  return key;
}

/** Returns base64(iv | authTag | ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(enc: string): string {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

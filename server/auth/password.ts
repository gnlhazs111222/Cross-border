import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';

const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [kind, salt, hash] = encoded.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const candidate = await derive(password, salt); const stored = Buffer.from(hash, 'hex');
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newSessionToken = () => randomBytes(32).toString('base64url');

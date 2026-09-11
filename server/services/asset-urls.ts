import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { ServerConfig } from '../config';
import { sniffAssetType } from './assets';

/**
 * Downloads the image URLs a supplier sheet lists, with the guard rails that make server-side
 * fetching safe: https only, host allow list, private/loopback addresses refused after DNS
 * resolution, bounded redirects, size and timeout limits. Failures are reported per URL and never
 * block the rest of the import.
 */

export type UrlDownload = { url: string; ok: true; bytes: Buffer; mimeType: string; fileName: string } | { url: string; ok: false; reason: string };

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
const isPrivateAddress = (address: string) => isIP(address) === 6
  ? /^(::1|fc|fd|fe80)/i.test(address)
  : PRIVATE_V4.some(pattern => pattern.test(address));

function fileNameFor(url: string, mimeType: string, index: number): string {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'application/pdf' ? 'pdf' : 'jpg';
  const tail = new URL(url).pathname.split('/').pop()?.replace(/[^A-Za-z0-9._-]/g, '') ?? '';
  return tail.toLowerCase().endsWith(`.${extension}`) ? tail : `downloaded-${index + 1}.${extension}`;
}

async function validateHop(url: string, config: ServerConfig, allowed: string[]): Promise<{ ok: true; target: URL } | { ok: false; reason: string }> {
  let target: URL;
  try { target = new URL(url); } catch { return { ok: false, reason: 'invalid_url' }; }
  const localFixture = config.ASSET_URL_ALLOW_LOOPBACK && target.protocol === 'http:';
  if (target.protocol !== 'https:' && !localFixture) return { ok: false, reason: 'https_required' };
  const host = target.hostname.toLowerCase();
  if (!allowed.some(entry => host === entry || host.endsWith(`.${entry}`))) return { ok: false, reason: 'host_not_allowed' };
  if (config.ASSET_URL_ALLOW_LOOPBACK) return { ok: true, target };
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map(entry => entry.address);
  if (!addresses.length) return { ok: false, reason: 'dns_failed' };
  if (addresses.some(isPrivateAddress)) return { ok: false, reason: 'private_address_blocked' };
  return { ok: true, target };
}

/**
 * Redirects are followed manually so every hop is validated again: with automatic following an
 * allowed host could bounce the request to an arbitrary address and bypass both guard rails.
 */
async function fetchOnce(url: string, config: ServerConfig, allowed: string[]): Promise<UrlDownload> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const check = await validateHop(current, config, allowed);
    if (!check.ok) return { url, ok: false, reason: check.reason };
    const response = await fetch(check.target, { redirect: 'manual', signal: AbortSignal.timeout(config.ASSET_URL_TIMEOUT_MS), headers: { accept: 'image/*,application/pdf' } })
      .catch(() => null);
    if (!response) return { url, ok: false, reason: 'request_failed' };
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return { url, ok: false, reason: 'redirect_without_location' };
      current = new URL(location, check.target).toString();
      continue;
    }
    if (!response.ok) return { url, ok: false, reason: `http_${response.status}` };
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared && declared > config.ASSET_URL_MAX_BYTES) return { url, ok: false, reason: 'too_large' };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > config.ASSET_URL_MAX_BYTES) return { url, ok: false, reason: 'too_large' };
    const sniffed = sniffAssetType(buffer);
    if (!sniffed) return { url, ok: false, reason: 'unsupported_type' };
    return { url, ok: true, bytes: buffer, mimeType: sniffed.mimeType, fileName: fileNameFor(url, sniffed.mimeType, 0) };
  }
  return { url, ok: false, reason: 'too_many_redirects' };
}

export async function downloadAssetUrls(config: ServerConfig, urls: string[]): Promise<UrlDownload[]> {
  const allowed = config.ASSET_URL_ALLOWED_HOSTS.split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean);
  const results: UrlDownload[] = [];
  for (const url of urls.slice(0, config.ASSET_URL_MAX_PER_IMPORT)) results.push(await fetchOnce(url, config, allowed));
  return results;
}

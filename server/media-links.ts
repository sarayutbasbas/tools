export type MediaPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'website';
export const platformNames: Record<MediaPlatform, string> = {
  youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', website: 'วิดีโอ',
};

export function isPublicAddress(address: string): boolean {
  if (address.includes(':')) {
    return /^[23][0-9a-f]{3}:/i.test(address) && !/^2002:|^2001:(?:0{0,3}[0-9a-f]{1,2}|0?db8):|^3fff:/i.test(address);
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

// Both UI and API accept public HTTP(S) links; yt-dlp detects supported media.
export function parseMediaLink(value: unknown): { url: string; platform: MediaPlatform } | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  const match = value.match(/https?:\/\/[^\s<>]+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const address = host.replace(/^\[|\]$/g, '');
    if (address.includes(':') || /^[\d.]+$/.test(address)) {
      if (!isPublicAddress(address)) return null;
    } else if (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)) return null;
    let platform: MediaPlatform = 'website';
    if (/(?:^|\.)youtube\.com$/.test(host) || host === 'youtu.be') platform = 'youtube';
    else if (/(?:^|\.)tiktok\.com$/.test(host)) platform = 'tiktok';
    else if (/(?:^|\.)instagram\.com$/.test(host)) platform = 'instagram';
    else if (/(?:^|\.)(?:facebook\.com|fb\.watch)$/.test(host)) platform = 'facebook';
    url.hash = '';
    return { url: url.href, platform };
  } catch { return null; }
}

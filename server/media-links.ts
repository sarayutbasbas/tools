export type MediaPlatform = 'youtube' | 'tiktok' | 'instagram';

export const platformNames: Record<MediaPlatform, string> = {
  youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram',
};

// Shared by the browser and API so both accept the same links and share text.
export function parseMediaLink(value: unknown): { url: string; platform: MediaPlatform } | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/https?:\/\/[^\s<>]+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let platform: MediaPlatform;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
      platform = 'youtube';
    } else if (['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(host)) {
      if (!['vm.tiktok.com', 'vt.tiktok.com'].includes(host) && !/^\/(?:@[^/]+\/video\/\d+|t\/[^/]+|player\/v1\/\d+)/.test(url.pathname)) return null;
      platform = 'tiktok';
    } else if (['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(host)) {
      if (!/^\/(?:p|reel|reels|tv)\/[^/]+|^\/share\/(?:reel|p)\/[^/]+/.test(url.pathname)) return null;
      platform = 'instagram';
    } else return null;
    url.hash = '';
    return { url: url.href, platform };
  } catch { return null; }
}

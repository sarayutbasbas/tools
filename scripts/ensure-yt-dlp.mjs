import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === 'win32';
const destination = join(root, '.toolbox-bin', isWindows ? 'yt-dlp.exe' : 'yt-dlp');
const force = process.argv.includes('--force');

const asset = process.platform === 'darwin'
  ? 'yt-dlp_macos'
  : process.platform === 'win32'
    ? 'yt-dlp.exe'
    : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';

try {
  if (!force && (await stat(destination)).size > 1_000_000) {
    console.log(`yt-dlp ready: ${destination}`);
    process.exit(0);
  }
} catch { /* Download below. */ }

await mkdir(dirname(destination), { recursive: true });
const temporaryPath = `${destination}.download`;
const response = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, { redirect: 'follow' });
if (!response.ok || !response.body) throw new Error(`Unable to download yt-dlp (${response.status})`);

await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryPath));
if (!isWindows) await chmod(temporaryPath, 0o755);
await rm(destination, { force: true });
await rename(temporaryPath, destination);
console.log(`yt-dlp installed: ${destination}`);

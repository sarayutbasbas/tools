import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'public/brand/toolbox-home-icon-master.png');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const icons = [
  [180, 'apple-touch-icon.png'],
  [192, 'brand/toolbox-app-192.png'],
  [512, 'brand/toolbox-app-512.png'],
];

// Resize the opaque Home Screen artwork without changing the original browser logo.
// iOS supplies its own rounded-corner mask, so these files stay square and opaque.
for (const [size, relativePath] of icons) {
  const output = join(root, 'public', relativePath);
  await mkdir(dirname(output), { recursive: true });
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', source,
    '-vf', `scale=${size}:${size}:flags=lanczos,format=rgb24`,
    '-frames:v', '1', '-update', '1', output,
  ], { stdio: 'inherit' });
  console.log(`Created ${relativePath} (${size}x${size})`);
}

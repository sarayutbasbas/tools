import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { registerYoutubeRoutes } from './youtube.js';
import { registerVideoCompressionRoutes } from './video-compression.js';
import { registerPdfRoutes } from './pdf.js';

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(express.json({ limit: '32kb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ffmpeg: existsSync('/opt/homebrew/bin/ffmpeg') ? 'available' : 'system' });
});

registerYoutubeRoutes(app);
registerVideoCompressionRoutes(app);
registerPdfRoutes(app);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่คาดคิด';
  res.status(400).json({ error: message });
});

app.use(express.static('dist'));
app.get('/{*splat}', (_req, res) => res.sendFile(join(process.cwd(), 'dist', 'index.html')));

app.listen(port, () => {
  console.log(`Toolbox API listening on http://localhost:${port}`);
});

# Toolbox logo

Concept: a compact toolbox with a download arrow in transparent negative space. Pine green matches the existing app palette, while the bold silhouette remains recognizable in a small navigation bar.

Created with the built-in imagegen tool. The generated alpha channel is preserved. The 128px mark and 64px favicon are resized delivery assets; the original PNG is retained at full resolution.

- `toolbox-logo.png`: original transparent PNG, 1254 × 1254.
- `toolbox-mark-128.png`: navigation logo, 128 × 128.
- `toolbox-favicon-64.png`: browser favicon, 64 × 64.
- `/apple-touch-icon.png`: iPhone Home Screen icon, 180 × 180, square with an opaque porcelain background.
- `toolbox-app-192.png` and `toolbox-app-512.png`: web app manifest icons with the same opaque background.

Regenerate install icons from `toolbox-home-icon-master.png` with `node scripts/generate-app-icons.mjs` (requires FFmpeg). The browser logo remains transparent. iOS rounds the Home Screen icon itself.

The opaque Home Screen master was prepared with built-in imagegen, preserving the approved mark and removing inconsistent transparency. Prompt: "Keep the approved Toolbox silhouette, handle, download arrow and tray; clean up partial alpha and texture into a solid pine green #37624F mark on an opaque porcelain #F4F4F0 square. No transparency, shadow, border, text or redesign."

## Generation prompt

Use case: logo-brand. Create the final standalone app symbol for Toolbox, a refined media utility app for downloading and compressing video and audio. A distinctive compact toolbox silhouette cleverly integrated with a downward arrow in negative space: a broad rounded rectangular toolbox body, short substantial handle rising from its top, central simple downward arrow cut out as genuine transparent negative space, with the bottom edge reading as a file receiving tray. The toolbox should feel like a precise geometric letter T without literal lettering. Bold, beautifully balanced geometry, optical symmetry, gently softened corners, a single memorable silhouette recognizable at 24px. Flat vector-like brand mark, one solid pine green #37624F only, no shading, no texture, no gradients, no perspective, no drop shadows. Center the isolated logo in a square 1024x1024 canvas, occupying about 84 percent of width and height with consistent generous transparent margins. Entire outside background and negative-space openings must be genuinely transparent. No enclosing app-icon tile, no white background, no mockup, no presentation board, no variations, no text, no wordmark, no watermark. It should match a calm, mobile-first utility interface with warm porcelain backgrounds and IBM Plex Sans typography.

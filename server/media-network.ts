import { lookup } from 'node:dns/promises';
import { createServer, request as httpRequest, type Server, type OutgoingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { isPublicAddress, parseMediaLink } from './media-links.js';

type Resolver = (host: string) => Promise<Array<{ address: string; family: number }>>;

// Check each redirect, embed and CDN connection, then connect to the checked IP.
export async function createMediaProxy(resolve: Resolver = host => lookup(host, { all: true })): Promise<{ url: string; server: Server }> {
  const destination = async (value: string) => {
    const link = parseMediaLink(value);
    if (!link) throw new Error('Blocked media destination');
    const url = new URL(link.url);
    const addresses = await resolve(url.hostname.replace(/^\[|\]$/g, ''));
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Blocked private media destination');
    return { url, ...(addresses.find(item => item.family === 4) || addresses[0]) };
  };
  const server = createServer(async (req, res) => {
    try {
      const target = await destination(req.url || '');
      if (target.url.protocol !== 'http:') throw new Error('Use CONNECT for TLS');
      const headers: OutgoingHttpHeaders = { ...req.headers, host: target.url.host };
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      const upstream = httpRequest({ hostname: target.address, family: target.family, port: 80,
        path: target.url.pathname + target.url.search, method: req.method, headers }, response => {
        res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
      });
      upstream.setTimeout(30_000, () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on('close', () => upstream.destroy()); req.pipe(upstream);
    } catch { res.writeHead(403); res.end('Media destination is not public'); }
  });
  server.on('connect', async (req, client, head) => {
    try {
      const target = await destination(`https://${req.url || ''}/`);
      const upstream = connect({ host: target.address, family: target.family, port: 443 });
      const cleanup = () => { client.destroy(); upstream.destroy(); };
      upstream.setTimeout(30_000, cleanup); req.socket.setTimeout(30_000, cleanup);
      upstream.on('error', cleanup); client.on('error', cleanup);
      client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
    } catch { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready); });
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Media proxy did not start');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

let proxy: ReturnType<typeof createMediaProxy> | undefined;
export const mediaProxy = () => proxy ??= createMediaProxy();

import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import { createMediaProxy } from '../server/media-network.js';
import { isPublicAddress } from '../server/media-links.js';

test('public address validation blocks private, reserved and IPv4-mapped IPv6 ranges', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of ['0.0.0.0', '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '100.64.0.1',
    '169.254.169.254', '224.0.0.1', '198.18.0.1', '192.0.2.1', '203.0.113.1', '::1',
    '::ffff:8.8.8.8', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::', '3fff::1']) assert.equal(isPublicAddress(ip), false, ip);
});

test('gateway rejects HTTP and CONNECT DNS destinations in private networks, including mixed answers', async () => {
  const proxy = await createMediaProxy(async host => host === 'mixed.example.com'
    ? [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]
    : [{ address: '127.0.0.1', family: 4 }]);
  try {
    for (const host of ['private.example.com', 'mixed.example.com', '127.0.0.1']) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(proxy.url, { path: `http://${host}/video` }, res => { res.resume(); resolve(res.statusCode!); });
        req.on('error', reject); req.end();
      });
      assert.equal(status, 403);
      const tunnelStatus = await new Promise<number>((resolve, reject) => {
        const req = request(proxy.url, { method: 'CONNECT', path: `${host}:443` });
        req.on('connect', (res, socket) => { socket.destroy(); resolve(res.statusCode!); });
        req.on('error', reject); req.end();
      });
      assert.equal(tunnelStatus, 403);
    }
  } finally { proxy.server.closeAllConnections(); await new Promise<void>(resolve => proxy.server.close(() => resolve())); }
});

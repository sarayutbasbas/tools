import assert from 'node:assert/strict';
import test from 'node:test';
import { readApiJson, requireApiStream } from '../src/api-response.js';

test('gateway HTML and Vercel plain-text errors produce readable messages, never JSON syntax errors', async () => {
  for (const [status, type, text] of [[404, 'text/plain', 'The page could not be found'], [502, 'text/html', '<html>Bad gateway</html>']] as const) {
    const response = new Response(text, { status, headers: { 'Content-Type': type } });
    await assert.rejects(readApiJson(response.clone()), new RegExp(`HTTP ${status}`));
    await assert.rejects(requireApiStream(response), new RegExp(`HTTP ${status}`));
  }
});

test('preserves application error details and rejects HTML even with HTTP 200', async () => {
  await assert.rejects(readApiJson(Response.json({ error: 'คลิปนี้ต้องล็อกอิน' }, { status: 422 })), /คลิปนี้ต้องล็อกอิน/);
  await assert.rejects(requireApiStream(new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } })), /เชื่อมต่อบริการ/);
  await assert.rejects(readApiJson(new Response('{', { headers: { 'Content-Type': 'application/json' } })), /ส่งข้อมูลไม่ครบ/);
  assert.deepEqual(await readApiJson(Response.json({ ok: true })), { ok: true });
  await requireApiStream(new Response('{}\n', { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }));
});

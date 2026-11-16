import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:8787/mcp');
const client = new Client({ name: 'memo-http-verifier', version: '0.1.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
const transport = new StreamableHTTPClientTransport(url);

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content[0];
  assert.equal(item?.type, 'text');
  assert.equal(typeof item.text, 'string');
  return item.text!;
}

try {
  await client.connect(transport);
  assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['create_memo', 'get_memo', 'list_memos']);
  const initial = await client.callTool({ name: 'list_memos', arguments: {} });
  const initialCount = JSON.parse(textContent(initial)).length as number;
  assert.ok(initialCount >= 2);
  const created = await client.callTool({ name: 'create_memo', arguments: { title: 'HTTP検証', body: '後続の要求から見えるか' } });
  const createdMemo = JSON.parse(textContent(created));
  assert.match(createdMemo.id, /^memo-\d+$/);
  const detail = await client.callTool({ name: 'get_memo', arguments: { id: createdMemo.id } });
  assert.deepEqual(JSON.parse(textContent(detail)), createdMemo);
  const missing = await client.callTool({ name: 'get_memo', arguments: { id: 'memo-0' } });
  assert.equal(missing.isError, true);
  const after = await client.callTool({ name: 'list_memos', arguments: {} });
  assert.equal(JSON.parse(textContent(after)).length, initialCount + 1);

  const rejectedOrigin = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: 'https://attacker.example' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }),
  });
  assert.equal(rejectedOrigin.status, 403);

  const otherClient = new Client({ name: 'unrelated-client', version: '0.1.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  try {
    await otherClient.connect(new StreamableHTTPClientTransport(url));
    assert.equal(otherClient.getNegotiatedProtocolVersion(), '2026-07-28');
    const visible = await otherClient.callTool({ name: 'list_memos', arguments: {} });
    assert.equal(JSON.parse(textContent(visible)).length, initialCount + 1);
    const injected = await otherClient.callTool({ name: 'create_memo', arguments: { title: '第三者', body: '認証なしで作成' } });
    assert.match(JSON.parse(textContent(injected)).id, /^memo-\d+$/);
  } finally {
    await otherClient.close();
  }

  console.log(JSON.stringify({ result: 'PASS', transport: 'Streamable HTTP', endpoint: url.origin, tools: tools.tools.map((tool) => tool.name), checks: ['list', 'get', 'not-found', 'create', 'read-after-create', 'invalid-origin-403', 'other-client-read-and-create-without-auth'] }));
} finally {
  await client.close();
}

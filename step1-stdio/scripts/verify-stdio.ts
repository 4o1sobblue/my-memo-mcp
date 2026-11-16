import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const client = new Client(
  { name: "memo-verifier", version: "0.1.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
const transport = new StdioClientTransport({
  command: "node",
  args: ["--import", "tsx", "src/stdio.ts"],
});
function textContent(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const item = result.content[0];
  assert.equal(item?.type, "text");
  assert.equal(typeof item.text, "string");
  return item.text!;
}

try {
  await client.connect(transport);
  assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "create_memo",
    "get_memo",
    "list_memos",
  ]);

  const initial = await client.callTool({ name: "list_memos", arguments: {} });
  assert.equal(JSON.parse(textContent(initial)).length, 2);

  const detail = await client.callTool({
    name: "get_memo",
    arguments: { id: "memo-1" },
  });
  assert.equal(JSON.parse(textContent(detail)).title, "買い物");

  const missing = await client.callTool({
    name: "get_memo",
    arguments: { id: "missing" },
  });
  assert.equal(missing.isError, true);

  const created = await client.callTool({
    name: "create_memo",
    arguments: { title: "検証", body: "作成確認" },
  });
  assert.equal(JSON.parse(textContent(created)).id, "memo-3");

  const after = await client.callTool({ name: "list_memos", arguments: {} });
  assert.equal(JSON.parse(textContent(after)).length, 3);

  console.log(
    JSON.stringify({
      result: "PASS",
      transport: "stdio",
      tools: tools.tools.map((tool) => tool.name),
      checks: ["list", "get", "not-found", "create", "read-after-create"],
    }),
  );
} finally {
  await client.close();
}

import { createServer } from 'node:http';
import { createMcpHandler, hostHeaderValidationResponse, localhostAllowedHostnames, localhostAllowedOrigins, originValidationResponse } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMemoServer, MemoryMemoStore } from './memos.js';

const store = new MemoryMemoStore();
const mcp = createMcpHandler(() => createMemoServer(store));
const guarded = {
  async fetch(request: Request): Promise<Response> {
    const rejected = hostHeaderValidationResponse(request, localhostAllowedHostnames())
      ?? originValidationResponse(request, localhostAllowedOrigins());
    return rejected ?? mcp.fetch(request);
  },
};
const handler = toNodeHandler(guarded);
const port = Number(process.env.PORT ?? '8787');

const server = createServer((request, response) => {
  if (new URL(request.url ?? '/', `http://${request.headers.host}`).pathname !== '/mcp') {
    response.writeHead(404).end();
    return;
  }
  void handler(request, response);
});

server.listen(port, '127.0.0.1', () => {
  console.error(`My Memo MCP (unauthenticated) listening on http://127.0.0.1:${port}/mcp`);
});

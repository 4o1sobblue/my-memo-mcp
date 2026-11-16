import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse } from '@modelcontextprotocol/server';
import type { D1Database } from '@cloudflare/workers-types';
import { createMemoServer } from './memos.js';
import { D1MemoStore } from './d1-store.js';

interface Env { DB: D1Database; EXPECTED_HOSTNAME: string }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/mcp') return new Response('Not found', { status: 404 });

    const rejected = hostHeaderValidationResponse(request, [env.EXPECTED_HOSTNAME])
      ?? originValidationResponse(request, [env.EXPECTED_HOSTNAME]);
    if (rejected) return rejected;

    const handler = createMcpHandler(() => createMemoServer(new D1MemoStore(env.DB)));
    return handler.fetch(request);
  },
};

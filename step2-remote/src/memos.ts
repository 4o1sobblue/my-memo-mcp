import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

export type Memo = { id: string; title: string; body: string };

export interface MemoStore {
  list(): Promise<Memo[]>;
  get(id: string): Promise<Memo | undefined>;
  create(title: string, body: string): Promise<Memo>;
}

export class MemoryMemoStore implements MemoStore {
  private readonly memos: Memo[] = [
    { id: 'memo-1', title: '買い物', body: '牛乳とパンを買う' },
    { id: 'memo-2', title: '週末', body: '図書館で本を返す' },
  ];
  private nextId = 3;

  async list(): Promise<Memo[]> {
    return this.memos.map((memo) => ({ ...memo }));
  }

  async get(id: string): Promise<Memo | undefined> {
    const memo = this.memos.find((item) => item.id === id);
    return memo && { ...memo };
  }

  async create(title: string, body: string): Promise<Memo> {
    const memo = { id: `memo-${this.nextId++}`, title, body };
    this.memos.push(memo);
    return { ...memo };
  }
}

export function createMemoServer(store: MemoStore): McpServer {
  const server = new McpServer({ name: 'my-memo-mcp', version: '0.1.0' });

  server.registerTool(
    'list_memos',
    { description: 'メモの一覧を取得する', inputSchema: z.object({}) },
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await store.list()) }] }),
  );

  server.registerTool(
    'get_memo',
    { description: 'IDを指定してメモの詳細を取得する', inputSchema: z.object({ id: z.string().min(1) }) },
    async ({ id }) => {
      const memo = await store.get(id);
      if (!memo) return { isError: true, content: [{ type: 'text', text: `メモ ${id} は見つかりません` }] };
      return { content: [{ type: 'text', text: JSON.stringify(memo) }] };
    },
  );

  server.registerTool(
    'create_memo',
    {
      description: 'メモを新規作成する',
      inputSchema: z.object({ title: z.string().trim().min(1), body: z.string().trim().min(1) }),
    },
    async ({ title, body }) => ({
      content: [{ type: 'text', text: JSON.stringify(await store.create(title, body)) }],
    }),
  );

  return server;
}

import type { D1Database } from '@cloudflare/workers-types';
import type { Memo, MemoStore } from './memos.js';

type Row = { id: number; title: string; body: string };
const toMemo = (row: Row): Memo => ({ id: `memo-${row.id}`, title: row.title, body: row.body });

export class D1MemoStore implements MemoStore {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<Memo[]> {
    const { results } = await this.db.prepare('SELECT id, title, body FROM memos ORDER BY id').all<Row>();
    return results.map(toMemo);
  }

  async get(id: string): Promise<Memo | undefined> {
    const number = /^memo-([1-9]\d*)$/.exec(id)?.[1];
    if (!number) return undefined;
    const row = await this.db.prepare('SELECT id, title, body FROM memos WHERE id = ?').bind(Number(number)).first<Row>();
    return row ? toMemo(row) : undefined;
  }

  async create(title: string, body: string): Promise<Memo> {
    const result = await this.db.prepare('INSERT INTO memos (title, body) VALUES (?, ?)').bind(title, body).run();
    return { id: `memo-${result.meta.last_row_id}`, title, body };
  }
}

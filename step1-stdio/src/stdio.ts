import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createMemoServer, MemoryMemoStore } from './memos.js';

const store = new MemoryMemoStore();
await serveStdio(() => createMemoServer(store));

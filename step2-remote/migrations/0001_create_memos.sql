CREATE TABLE IF NOT EXISTS memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL
);

INSERT OR IGNORE INTO memos (id, title, body) VALUES
  (1, '買い物', '牛乳とパンを買う'),
  (2, '週末', '図書館で本を返す');

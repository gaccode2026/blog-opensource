export type Database = D1Database

// 获取数据库实例（从 Cloudflare Workers 环境）
export function getDB(env: CloudflareEnv) {
  return env.DB
}

let schemaInitialized = false
let schemaInitializationPromise: Promise<void> | null = null
let postsFtsRepairPromise: Promise<void> | null = null

const postsFtsTableSql = `CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title,
  content,
  content=posts,
  content_rowid=id,
  tokenize='unicode61'
)`

const postsFtsTriggerSql = [
  `CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO posts_fts(rowid, title, content)
    VALUES (new.id, new.title, new.content);
  END`,
  `CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
    UPDATE posts_fts SET title = new.title, content = new.content
    WHERE rowid = new.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
    DELETE FROM posts_fts WHERE rowid = old.id;
  END`,
]

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    html TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT '未分类',
    tags TEXT,
    status TEXT DEFAULT 'published' CHECK(status IN ('draft', 'published', 'deleted')),
    password TEXT,
    is_pinned INTEGER DEFAULT 0,
    is_hidden INTEGER DEFAULT 0,
    cover_image TEXT,
    deleted_at INTEGER,
    published_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    view_count INTEGER DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug)',
  'CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category)',
  'CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at DESC)',
  postsFtsTableSql,
  ...postsFtsTriggerSql,
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    post_count INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    prompt TEXT NOT NULL,
    temperature REAL DEFAULT 0.6,
    sort_order INTEGER DEFAULT 0,
    is_enabled INTEGER DEFAULT 1,
    is_builtin INTEGER DEFAULT 1,
    profile_id INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS ai_provider_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'custom',
    provider_name TEXT NOT NULL DEFAULT '',
    provider_type TEXT NOT NULL DEFAULT 'openai_compatible',
    provider_category TEXT NOT NULL DEFAULT '',
    api_key_url TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    temperature REAL NOT NULL DEFAULT 0.7,
    max_tokens INTEGER NOT NULL DEFAULT 2000,
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    api_key_masked TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS ai_post_generators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    prompt TEXT NOT NULL,
    provider_mode TEXT NOT NULL DEFAULT 'workers_ai',
    text_profile_id INTEGER,
    image_profile_id INTEGER,
    workers_model TEXT NOT NULL DEFAULT '',
    temperature REAL NOT NULL DEFAULT 0.7,
    max_tokens INTEGER NOT NULL DEFAULT 2000,
    aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    resolution TEXT NOT NULL DEFAULT '2k',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    is_builtin INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_used_at INTEGER,
    is_active INTEGER DEFAULT 1
  )`,
  'CREATE INDEX IF NOT EXISTS idx_api_tokens_token ON api_tokens(token)',
  `INSERT OR IGNORE INTO categories (name, slug, post_count) VALUES
    ('未分类', 'uncategorized', 0),
    ('AI工具', 'ai-tools', 0),
    ('AI', 'ai', 0)`,
  `INSERT OR IGNORE INTO site_settings (key, value) VALUES
    ('default_theme', 'editorial'),
    ('body_font', 'serif'),
    ('nav_links', '[{"label":"GitHub","url":"https://github.com/joeseesun/qiaomu-blog-opensource","openInNewTab":true},{"label":"Admin","url":"/admin","openInNewTab":false},{"label":"RSS","url":"/feed.xml","openInNewTab":false}]')`,
]

const columnMigrations = [
  'ALTER TABLE posts ADD COLUMN password TEXT',
  'ALTER TABLE posts ADD COLUMN is_pinned INTEGER DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN is_hidden INTEGER DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN deleted_at INTEGER',
  'ALTER TABLE posts ADD COLUMN cover_image TEXT',
]

const bestEffortStatements = [
  `INSERT INTO posts_fts(rowid, title, content)
   SELECT posts.id, posts.title, posts.content
   FROM posts
   WHERE NOT EXISTS (
     SELECT 1
     FROM posts_fts
     WHERE posts_fts.rowid = posts.id
   )`,
]

export function isFtsCorruptionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('sqlite_corrupt_vtab') ||
    message.includes('database disk image is malformed') ||
    message.includes('sqlite_corrupt') ||
    message.includes('posts_fts')
  )
}

export async function rebuildPostsFts(db: Database): Promise<void> {
  if (postsFtsRepairPromise) {
    await postsFtsRepairPromise
    return
  }

  postsFtsRepairPromise = (async () => {
    console.warn('Detected corrupted posts_fts virtual table, rebuilding FTS index')

    await db.prepare('DROP TRIGGER IF EXISTS posts_ai').run()
    await db.prepare('DROP TRIGGER IF EXISTS posts_au').run()
    await db.prepare('DROP TRIGGER IF EXISTS posts_ad').run()
    await db.prepare('DROP TABLE IF EXISTS posts_fts').run()

    await db.prepare(postsFtsTableSql).run()

    for (const sql of postsFtsTriggerSql) {
      await db.prepare(sql).run()
    }

    await db.prepare(
      `INSERT INTO posts_fts(rowid, title, content)
       SELECT id, title, content
       FROM posts`,
    ).run()
  })()

  try {
    await postsFtsRepairPromise
  } finally {
    postsFtsRepairPromise = null
  }
}

export async function ensureSchema(db: Database) {
  if (schemaInitialized) return
  if (schemaInitializationPromise) {
    await schemaInitializationPromise
    return
  }

  schemaInitializationPromise = (async () => {
    try {
      for (const sql of schemaStatements) {
        await db.prepare(sql).run()
      }

      for (const sql of columnMigrations) {
        try {
          await db.prepare(sql).run()
        } catch {
          // Older databases may already include these columns.
        }
      }

      for (const sql of bestEffortStatements) {
        try {
          await db.prepare(sql).run()
        } catch {
          // FTS backfill is optional for existing content.
        }
      }

      schemaInitialized = true
    } catch (error: unknown) {
      console.error('Schema initialization failed:', error)
      throw error
    } finally {
      schemaInitializationPromise = null
    }
  })()

  await schemaInitializationPromise
}

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';

const schemaFile = new URL('./schema.sql', import.meta.url);

export function openDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(schemaFile, 'utf8'));
  migrate(db);
  return db;
}

function migrate(db) {
  const foodCols = db.prepare('PRAGMA table_info(food_items)').all().map((col) => col.name);
  if (!foodCols.includes('photo')) db.exec("ALTER TABLE food_items ADD COLUMN photo TEXT NOT NULL DEFAULT ''");

  const familyCols = db.prepare('PRAGMA table_info(families)').all().map((col) => col.name);
  if (!familyCols.includes('join_token')) db.exec("ALTER TABLE families ADD COLUMN join_token TEXT NOT NULL DEFAULT ''");
  const emptyTokenFamilies = db.prepare("SELECT id FROM families WHERE join_token = ''").all();
  for (const family of emptyTokenFamilies) {
    db.prepare('UPDATE families SET join_token = ? WHERE id = ?').run(randomBytes(12).toString('base64url'), family.id);
  }
  if (!familyCols.includes('invite_code')) {
    db.exec("ALTER TABLE families ADD COLUMN invite_code TEXT NOT NULL DEFAULT ''");
    const families = db.prepare('SELECT id FROM families').all();
    for (const family of families) {
      const inviteCode = randomBytes(5).toString('hex').toUpperCase();
      db.prepare('UPDATE families SET invite_code = ?, invite_code_hash = ? WHERE id = ?')
        .run(inviteCode, createHash('sha256').update(inviteCode).digest('hex'), family.id);
    }
  }

  db.exec(`CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    device_token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`);

  const memberCols = db.prepare('PRAGMA table_info(members)').all().map((col) => col.name);
  const hasLegacyToken = memberCols.includes('device_token_hash');

  if (hasLegacyToken) {
    const legacyMembers = db.prepare('SELECT id, family_id, nickname, device_token_hash, joined_at, last_active_at FROM members').all();
    const insertDevices = db.prepare('INSERT OR IGNORE INTO devices (id, member_id, device_token_hash, created_at) VALUES (?, ?, ?, ?)');
    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      for (const m of legacyMembers) {
        if (m.device_token_hash) insertDevices.run(`dev-${m.id}`, m.id, m.device_token_hash, m.joined_at);
      }
      db.exec('DROP TABLE members');
      db.exec(`CREATE TABLE members (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        UNIQUE(family_id, nickname)
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_members_family_id ON members(family_id)');
      const reinsert = db.prepare('INSERT INTO members (id, family_id, nickname, joined_at, last_active_at) VALUES (?, ?, ?, ?, ?)');
      for (const m of legacyMembers) reinsert.run(m.id, m.family_id, m.nickname, m.joined_at, m.last_active_at);
    });
    tx();
    db.pragma('foreign_keys = ON');
  }
}

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code_hash TEXT NOT NULL UNIQUE,
  invite_code TEXT NOT NULL DEFAULT '',
  join_token TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  device_token_hash TEXT NOT NULL UNIQUE,
  joined_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  UNIQUE(family_id, nickname)
);

CREATE INDEX IF NOT EXISTS idx_members_family_id ON members(family_id);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  device_token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_member_id ON devices(member_id);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(family_id, name)
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(family_id, name)
);

CREATE TABLE IF NOT EXISTS food_items (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  quantity INTEGER NOT NULL CHECK(quantity >= 0),
  expiry_date TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id),
  note TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed')),
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_food_items_family_status ON food_items(family_id, status);
CREATE INDEX IF NOT EXISTS idx_food_items_expiry ON food_items(expiry_date);

CREATE TABLE IF NOT EXISTS food_logs (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  food_item_id TEXT NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

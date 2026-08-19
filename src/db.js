import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import Database from "better-sqlite3";

const schemaFile = new URL("./schema.sql", import.meta.url);

export function openDatabase(filename) {
  if (filename !== ":memory:")
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(schemaFile, "utf8"));
  migrate(db);
  return db;
}

function migrate(db) {
  const foodCols = db
    .prepare("PRAGMA table_info(food_items)")
    .all()
    .map((col) => col.name);
  if (!foodCols.includes("photo"))
    db.exec("ALTER TABLE food_items ADD COLUMN photo TEXT NOT NULL DEFAULT ''");
  if (!foodCols.includes("produced_date"))
    db.exec(
      "ALTER TABLE food_items ADD COLUMN produced_date TEXT NOT NULL DEFAULT ''",
    );
  if (!foodCols.includes("shelf_life"))
    db.exec("ALTER TABLE food_items ADD COLUMN shelf_life INTEGER");
  if (!foodCols.includes("shelf_life_unit"))
    db.exec(
      "ALTER TABLE food_items ADD COLUMN shelf_life_unit TEXT NOT NULL DEFAULT ''",
    );
  if (!foodCols.includes("quantity_unit"))
    db.exec(
      "ALTER TABLE food_items ADD COLUMN quantity_unit TEXT NOT NULL DEFAULT 'portion'",
    );

  const familyCols = db
    .prepare("PRAGMA table_info(families)")
    .all()
    .map((col) => col.name);
  if (!familyCols.includes("join_token"))
    db.exec(
      "ALTER TABLE families ADD COLUMN join_token TEXT NOT NULL DEFAULT ''",
    );
  const emptyTokenFamilies = db
    .prepare("SELECT id FROM families WHERE join_token = ''")
    .all();
  for (const family of emptyTokenFamilies) {
    db.prepare("UPDATE families SET join_token = ? WHERE id = ?").run(
      randomBytes(12).toString("base64url"),
      family.id,
    );
  }
  if (!familyCols.includes("invite_code")) {
    db.exec(
      "ALTER TABLE families ADD COLUMN invite_code TEXT NOT NULL DEFAULT ''",
    );
    const families = db.prepare("SELECT id FROM families").all();
    for (const family of families) {
      const inviteCode = randomBytes(5).toString("hex").toUpperCase();
      db.prepare(
        "UPDATE families SET invite_code = ?, invite_code_hash = ? WHERE id = ?",
      ).run(
        inviteCode,
        createHash("sha256").update(inviteCode).digest("hex"),
        family.id,
      );
    }
  }
  if (!familyCols.includes("creator_member_id"))
    db.exec(
      "ALTER TABLE families ADD COLUMN creator_member_id TEXT NOT NULL DEFAULT ''",
    );
  if (!familyCols.includes("creator_password_hash"))
    db.exec(
      "ALTER TABLE families ADD COLUMN creator_password_hash TEXT NOT NULL DEFAULT ''",
    );
  const familiesWithoutCreator = db
    .prepare("SELECT id FROM families WHERE creator_member_id = ''")
    .all();
  for (const family of familiesWithoutCreator) {
    const creator = db
      .prepare(
        "SELECT id FROM members WHERE family_id = ? ORDER BY joined_at, id LIMIT 1",
      )
      .get(family.id);
    if (creator)
      db
        .prepare("UPDATE families SET creator_member_id = ? WHERE id = ?")
        .run(creator.id, family.id);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    device_token_hash TEXT NOT NULL UNIQUE,
    family_id TEXT NOT NULL DEFAULT '',
    device_code TEXT NOT NULL DEFAULT '',
    deleted_at TEXT,
    created_at TEXT NOT NULL
  )`);

  const deviceCols = db
    .prepare("PRAGMA table_info(devices)")
    .all()
    .map((col) => col.name);
  if (!deviceCols.includes("family_id"))
    db.exec(
      "ALTER TABLE devices ADD COLUMN family_id TEXT NOT NULL DEFAULT ''",
    );
  if (!deviceCols.includes("device_code"))
    db.exec(
      "ALTER TABLE devices ADD COLUMN device_code TEXT NOT NULL DEFAULT ''",
    );
  if (!deviceCols.includes("deleted_at"))
    db.exec("ALTER TABLE devices ADD COLUMN deleted_at TEXT");

  const memberCols = db
    .prepare("PRAGMA table_info(members)")
    .all()
    .map((col) => col.name);
  const hasLegacyToken = memberCols.includes("device_token_hash");

  if (hasLegacyToken) {
    const legacyMembers = db
      .prepare(
        "SELECT id, family_id, nickname, device_token_hash, joined_at, last_active_at FROM members",
      )
      .all();
    const insertDevices = db.prepare(
      "INSERT OR IGNORE INTO devices (id, member_id, device_token_hash, family_id, device_code, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    db.pragma("foreign_keys = OFF");
    const tx = db.transaction(() => {
      for (const m of legacyMembers) {
        if (m.device_token_hash)
          insertDevices.run(
            `dev-${m.id}`,
            m.id,
            m.device_token_hash,
            m.family_id,
            createDeviceCode(db, m.family_id),
            m.joined_at,
          );
      }
      db.exec("DROP TABLE members");
      db.exec(`CREATE TABLE members (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        UNIQUE(family_id, nickname)
      )`);
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_members_family_id ON members(family_id)",
      );
      const reinsert = db.prepare(
        "INSERT INTO members (id, family_id, nickname, joined_at, last_active_at) VALUES (?, ?, ?, ?, ?)",
      );
      for (const m of legacyMembers)
        reinsert.run(
          m.id,
          m.family_id,
          m.nickname,
          m.joined_at,
          m.last_active_at,
        );
    });
    tx();
    db.pragma("foreign_keys = ON");
  }

  const devices = db
    .prepare(
      "SELECT d.id, d.family_id, m.family_id AS member_family_id FROM devices d JOIN members m ON m.id = d.member_id",
    )
    .all();
  const updateDeviceFamily = db.prepare(
    "UPDATE devices SET family_id = ? WHERE id = ?",
  );
  for (const device of devices)
    if (!device.family_id)
      updateDeviceFamily.run(device.member_family_id, device.id);
  const allDevices = db
    .prepare(
      "SELECT d.id, d.device_code, m.family_id FROM devices d JOIN members m ON m.id = d.member_id ORDER BY d.created_at, d.id",
    )
    .all();
  const updateDeviceCode = db.prepare(
    "UPDATE devices SET device_code = ?, family_id = ? WHERE id = ?",
  );
  const seenCodes = new Set();
  for (const device of allDevices) {
    const key = `${device.family_id}:${device.device_code}`;
    if (!device.device_code || seenCodes.has(key)) {
      updateDeviceCode.run(
        createDeviceCode(db, device.family_id),
        device.family_id,
        device.id,
      );
    }
    seenCodes.add(
      `${device.family_id}:${db.prepare("SELECT device_code FROM devices WHERE id = ?").get(device.id).device_code}`,
    );
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_family_device_code ON devices(family_id, device_code)",
  );

  const logCols = db
    .prepare("PRAGMA table_info(food_logs)")
    .all()
    .map((col) => col.name);
  if (!logCols.includes("device_id"))
    db.exec(
      "ALTER TABLE food_logs ADD COLUMN device_id TEXT REFERENCES devices(id)",
    );
  if (!logCols.includes("undone_at"))
    db.exec("ALTER TABLE food_logs ADD COLUMN undone_at TEXT");
  db.exec(`UPDATE food_logs
    SET device_id = (
      SELECT d.id FROM devices d
      WHERE d.member_id = food_logs.member_id
        AND d.created_at <= food_logs.created_at
      ORDER BY d.created_at DESC
      LIMIT 1
    )
    WHERE device_id IS NULL`);
}

function createDeviceCode(db, familyId) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let code = "";
    const bytes = randomBytes(4);
    for (let index = 0; index < 4; index += 1)
      code += alphabet[bytes[index] % alphabet.length];
    if (
      !db
        .prepare(
          "SELECT 1 FROM devices WHERE family_id = ? AND device_code = ?",
        )
        .get(familyId, code)
    )
      return code;
  }
}

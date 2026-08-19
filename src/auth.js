import { createHash, randomBytes, randomUUID } from "node:crypto";
import { seedHouseholdOptions } from "./inventory.js";

export function hashSecret(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 6 && value.length <= 128;
}

function creatorPasswordRequired(family, member, password) {
  return (
    family.creator_member_id === member.id &&
    family.creator_password_hash &&
    hashSecret(password || "") !== family.creator_password_hash
  );
}

export function createInviteCode() {
  return randomBytes(5).toString("hex").toUpperCase();
}

export function createJoinToken() {
  return randomBytes(12).toString("base64url");
}

export function createDeviceToken() {
  return randomBytes(32).toString("base64url");
}

function createDevice(db, memberId, familyId, now) {
  const deviceToken = createDeviceToken();
  const deviceId = randomUUID();
  const deviceCode = createDeviceCode(db, familyId);
  db.prepare(
    "INSERT INTO devices (id, member_id, device_token_hash, family_id, device_code, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(deviceId, memberId, hashSecret(deviceToken), familyId, deviceCode, now);
  return { deviceToken, deviceId, deviceCode };
}

function createDeviceCode(db, familyId) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    const bytes = randomBytes(4);
    let code = "";
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

export function authenticate(request, db) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const member = db
    .prepare(
      `
    SELECT m.id AS memberId, m.family_id AS familyId, m.nickname, d.id AS deviceId, d.device_code AS deviceCode
    FROM devices d JOIN members m ON m.id = d.member_id
    WHERE d.device_token_hash = ? AND d.deleted_at IS NULL
  `,
    )
    .get(hashSecret(token));
  if (!member) return null;
  db.prepare("UPDATE members SET last_active_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    member.memberId,
  );
  return member;
}

export function registerAuthRoutes(app) {
  app.post("/api/families", async (request, reply) => {
    const { name, nickname, password } = request.body || {};
    if (!validText(name, 80) || !validText(nickname, 40)) {
      return reply.code(400).send({ error: "家庭名称和你的名字是必填的" });
    }
    if (!validPassword(password))
      return reply.code(400).send({ error: "创建者密码至少需要 6 位" });
    const cleanName = name.trim();
    const cleanNick = nickname.trim();
    const now = new Date().toISOString();
    const existing = app.db
      .prepare("SELECT id FROM families WHERE name = ?")
      .get(cleanName);

    if (existing) {
      return reply.code(409).send({
        error: `家庭「${cleanName}」已存在，请通过加入链接或邀请码加入家庭`,
      });
    }

    const familyId = randomUUID();
    const memberId = randomUUID();
    const inviteCode = createInviteCode();
    const joinToken = createJoinToken();
    let deviceToken = null;
    let createdDevice = null;
    const create = app.db.transaction(() => {
      app.db
        .prepare(
          "INSERT INTO families (id, name, invite_code_hash, invite_code, join_token, creator_member_id, creator_password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          familyId,
          cleanName,
          hashSecret(inviteCode),
          inviteCode,
          joinToken,
          memberId,
          hashSecret(password),
          now,
        );
      app.db
        .prepare(
          "INSERT INTO members (id, family_id, nickname, joined_at, last_active_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(memberId, familyId, cleanNick, now, now);
      const device = createDevice(app.db, memberId, familyId, now);
      deviceToken = device.deviceToken;
      createdDevice = device;
    });
    create();
    seedHouseholdOptions(app.db, familyId, now);
    return {
      family: { id: familyId, name: cleanName },
      member: {
        id: memberId,
        nickname: cleanNick,
        deviceCode: createdDevice.deviceCode,
      },
      inviteCode,
      deviceToken,
    };
  });

  app.post("/api/families/join", async (request, reply) => {
    const { inviteCode, nickname, password } = request.body || {};
    if (!validText(inviteCode, 40) || !validText(nickname, 40)) {
      return reply.code(400).send({ error: "邀请码和你的名字是必填的" });
    }
    const family = app.db
      .prepare(
        "SELECT id, name, creator_member_id, creator_password_hash FROM families WHERE invite_code_hash = ?",
      )
      .get(hashSecret(inviteCode.trim().toUpperCase()));
    if (!family) return reply.code(404).send({ error: "邀请码无效或已失效" });
    const cleanNick = nickname.trim();
    const now = new Date().toISOString();

    let member = app.db
      .prepare(
        "SELECT id, nickname FROM members WHERE family_id = ? AND nickname = ?",
      )
      .get(family.id, cleanNick);
    if (member) {
      if (creatorPasswordRequired(family, member, password))
        return reply.code(401).send({
          error: "创建者在新设备接入时需要输入密码确认",
          creatorPasswordRequired: true,
        });
      const device = createDevice(app.db, member.id, family.id, now);
      return {
        family,
        member: {
          id: member.id,
          nickname: member.nickname,
          deviceCode: device.deviceCode,
        },
        deviceToken: device.deviceToken,
        joined: true,
      };
    }

    const memberId = randomUUID();
    app.db
      .prepare(
        "INSERT INTO members (id, family_id, nickname, joined_at, last_active_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(memberId, family.id, cleanNick, now, now);
    const device = createDevice(app.db, memberId, family.id, now);
    return {
      family,
      member: {
        id: memberId,
        nickname: cleanNick,
        deviceCode: device.deviceCode,
      },
      deviceToken: device.deviceToken,
    };
  });

  app.addHook("preHandler", async (request, reply) => {
    const isPublic =
      request.method === "POST" &&
      (request.url === "/api/families" ||
        request.url === "/api/families/join" ||
        request.url === "/api/families/join-link");
    if (
      !request.url.startsWith("/api/") ||
      request.url === "/api/health" ||
      isPublic
    )
      return;
    const member = authenticate(request, app.db);
    if (!member)
      return reply.code(401).send({ error: "Authentication required" });
    request.member = member;
  });

  app.post("/api/families/join-link", async (request, reply) => {
    const { token, nickname, password } = request.body || {};
    if (!validText(token, 64) || !validText(nickname, 40)) {
      return reply.code(400).send({ error: "链接和你的名字是必填的" });
    }
    const family = app.db
      .prepare(
        "SELECT id, name, creator_member_id, creator_password_hash FROM families WHERE join_token = ?",
      )
      .get(token.trim());
    if (!family) return reply.code(404).send({ error: "链接无效或已失效" });
    const cleanNick = nickname.trim();
    const now = new Date().toISOString();

    let member = app.db
      .prepare(
        "SELECT id, nickname FROM members WHERE family_id = ? AND nickname = ?",
      )
      .get(family.id, cleanNick);
    if (member) {
      if (creatorPasswordRequired(family, member, password))
        return reply.code(401).send({
          error: "创建者在新设备接入时需要输入密码确认",
          creatorPasswordRequired: true,
        });
      const device = createDevice(app.db, member.id, family.id, now);
      return {
        family,
        member: {
          id: member.id,
          nickname: member.nickname,
          deviceCode: device.deviceCode,
        },
        deviceToken: device.deviceToken,
        joined: true,
      };
    }

    const memberId = randomUUID();
    app.db
      .prepare(
        "INSERT INTO members (id, family_id, nickname, joined_at, last_active_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(memberId, family.id, cleanNick, now, now);
    const device = createDevice(app.db, memberId, family.id, now);
    return {
      family,
      member: {
        id: memberId,
        nickname: cleanNick,
        deviceCode: device.deviceCode,
      },
      deviceToken: device.deviceToken,
    };
  });

  app.get("/api/families/current", async (request) => {
    const family = app.db
      .prepare(
        "SELECT id, name, creator_member_id AS creatorMemberId, creator_password_hash AS creatorPasswordHash, created_at AS createdAt FROM families WHERE id = ?",
      )
      .get(request.member.familyId);
    const members = app.db
      .prepare(
        "SELECT id, nickname, joined_at AS joinedAt, last_active_at AS lastActiveAt FROM members WHERE family_id = ? ORDER BY joined_at",
      )
      .all(request.member.familyId)
      .map((member) => ({
        ...member,
        devices: app.db
          .prepare(
            "SELECT id, device_code AS deviceCode, created_at AS createdAt FROM devices WHERE member_id = ? AND deleted_at IS NULL ORDER BY created_at",
          )
          .all(member.id),
      }));
    return {
      family: {
        id: family.id,
        name: family.name,
        createdAt: family.createdAt,
        isCreator: family.creatorMemberId === request.member.memberId,
        creatorPasswordSet: Boolean(family.creatorPasswordHash),
      },
      members,
      currentMemberId: request.member.memberId,
      currentDeviceId: request.member.deviceId,
      currentDeviceCode: request.member.deviceCode,
    };
  });

  app.put("/api/families/creator-password", async (request, reply) => {
    const { password } = request.body || {};
    if (!validPassword(password))
      return reply.code(400).send({ error: "创建者密码至少需要 6 位" });
    const family = app.db
      .prepare("SELECT creator_member_id FROM families WHERE id = ?")
      .get(request.member.familyId);
    if (!family || family.creator_member_id !== request.member.memberId)
      return reply.code(403).send({ error: "只有家庭创建者可以设置密码" });
    app.db
      .prepare("UPDATE families SET creator_password_hash = ? WHERE id = ?")
      .run(hashSecret(password), request.member.familyId);
    return { ok: true };
  });

  app.get("/api/families/invite-code", async (request) => {
    const family = app.db
      .prepare("SELECT invite_code FROM families WHERE id = ?")
      .get(request.member.familyId);
    return { inviteCode: family.invite_code };
  });

  app.post("/api/families/invite-code/rotate", async (request) => {
    const inviteCode = createInviteCode();
    app.db
      .prepare(
        "UPDATE families SET invite_code = ?, invite_code_hash = ? WHERE id = ?",
      )
      .run(inviteCode, hashSecret(inviteCode), request.member.familyId);
    return { inviteCode };
  });

  app.get("/api/families/join-link", async (request) => {
    const family = app.db
      .prepare("SELECT join_token FROM families WHERE id = ?")
      .get(request.member.familyId);
    return { joinToken: family.join_token };
  });

  app.post("/api/families/join-link/rotate", async (request) => {
    const joinToken = createJoinToken();
    app.db
      .prepare("UPDATE families SET join_token = ? WHERE id = ?")
      .run(joinToken, request.member.familyId);
    return { joinToken };
  });

  app.delete("/api/devices/:id", async (request, reply) => {
    if (request.params.id === request.member.deviceId) {
      return reply.code(400).send({ error: "不能删除当前正在使用的设备" });
    }
    const result = app.db
      .prepare(
        "UPDATE devices SET deleted_at = ? WHERE id = ? AND family_id = ? AND deleted_at IS NULL",
      )
      .run(
        new Date().toISOString(),
        request.params.id,
        request.member.familyId,
      );
    if (!result.changes)
      return reply.code(404).send({ error: "设备不存在或已删除" });
    return { ok: true };
  });

  app.post("/api/families/leave", async (request) => {
    app.db
      .prepare("DELETE FROM members WHERE id = ? AND family_id = ?")
      .run(request.member.memberId, request.member.familyId);
    return { ok: true };
  });
}

function validText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

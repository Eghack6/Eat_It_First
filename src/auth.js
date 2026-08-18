import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { seedHouseholdOptions } from './inventory.js';

export function hashSecret(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createInviteCode() {
  return randomBytes(5).toString('hex').toUpperCase();
}

export function createDeviceToken() {
  return randomBytes(32).toString('base64url');
}

function createDevice(db, memberId, now) {
  const deviceToken = createDeviceToken();
  db.prepare('INSERT INTO devices (id, member_id, device_token_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), memberId, hashSecret(deviceToken), now);
  return deviceToken;
}

export function authenticate(request, db) {
  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const member = db.prepare(`
    SELECT m.id AS memberId, m.family_id AS familyId, m.nickname
    FROM devices d JOIN members m ON m.id = d.member_id
    WHERE d.device_token_hash = ?
  `).get(hashSecret(token));
  if (!member) return null;
  db.prepare('UPDATE members SET last_active_at = ? WHERE id = ?').run(new Date().toISOString(), member.memberId);
  return member;
}

export function registerAuthRoutes(app) {
  app.post('/api/families', async (request, reply) => {
    const { name, nickname } = request.body || {};
    if (!validText(name, 80) || !validText(nickname, 40)) {
      return reply.code(400).send({ error: '家庭名称和你的名字是必填的' });
    }
    const cleanName = name.trim();
    const cleanNick = nickname.trim();
    const now = new Date().toISOString();
    const existing = app.db.prepare('SELECT id FROM families WHERE name = ?').get(cleanName);

    if (existing) {
      const member = app.db.prepare('SELECT id, nickname FROM members WHERE family_id = ? AND nickname = ?').get(existing.id, cleanNick);
      if (!member) {
        return reply.code(409).send({ error: `家庭「${cleanName}」已存在，请通过邀请码加入家庭` });
      }
      const deviceToken = createDevice(app.db, member.id, now);
      const family = app.db.prepare('SELECT id, name FROM families WHERE id = ?').get(existing.id);
      return { family, member: { id: member.id, nickname: member.nickname }, inviteCode: null, deviceToken, joined: true };
    }

    const familyId = randomUUID();
    const memberId = randomUUID();
    const inviteCode = createInviteCode();
    let deviceToken = null;
    const create = app.db.transaction(() => {
      app.db.prepare('INSERT INTO families (id, name, invite_code_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(familyId, cleanName, hashSecret(inviteCode), now);
      app.db.prepare('INSERT INTO members (id, family_id, nickname, joined_at, last_active_at) VALUES (?, ?, ?, ?, ?)')
        .run(memberId, familyId, cleanNick, now, now);
      deviceToken = createDevice(app.db, memberId, now);
    });
    create();
    seedHouseholdOptions(app.db, familyId, now);
    return { family: { id: familyId, name: cleanName }, member: { id: memberId, nickname: cleanNick }, inviteCode, deviceToken };
  });

  app.post('/api/families/join', async (request, reply) => {
    const { inviteCode, nickname } = request.body || {};
    if (!validText(inviteCode, 40) || !validText(nickname, 40)) {
      return reply.code(400).send({ error: '邀请码和你的名字是必填的' });
    }
    const family = app.db.prepare('SELECT id, name FROM families WHERE invite_code_hash = ?').get(hashSecret(inviteCode.trim().toUpperCase()));
    if (!family) return reply.code(404).send({ error: '邀请码无效或已失效' });
    const cleanNick = nickname.trim();
    const now = new Date().toISOString();

    let member = app.db.prepare('SELECT id, nickname FROM members WHERE family_id = ? AND nickname = ?').get(family.id, cleanNick);
    if (member) {
      const deviceToken = createDevice(app.db, member.id, now);
      return { family, member: { id: member.id, nickname: member.nickname }, deviceToken, joined: true };
    }

    const memberId = randomUUID();
    app.db.prepare('INSERT INTO members (id, family_id, nickname, joined_at, last_active_at) VALUES (?, ?, ?, ?, ?)')
      .run(memberId, family.id, cleanNick, now, now);
    const deviceToken = createDevice(app.db, memberId, now);
    return { family, member: { id: memberId, nickname: cleanNick }, deviceToken };
  });

  app.addHook('preHandler', async (request, reply) => {
    const isPublic = request.method === 'POST' && (request.url === '/api/families' || request.url === '/api/families/join');
    if (!request.url.startsWith('/api/') || request.url === '/api/health' || isPublic) return;
    const member = authenticate(request, app.db);
    if (!member) return reply.code(401).send({ error: 'Authentication required' });
    request.member = member;
  });

  app.get('/api/families/current', async (request) => {
    const family = app.db.prepare('SELECT id, name, created_at AS createdAt FROM families WHERE id = ?').get(request.member.familyId);
    const members = app.db.prepare('SELECT id, nickname, joined_at AS joinedAt, last_active_at AS lastActiveAt FROM members WHERE family_id = ? ORDER BY joined_at').all(request.member.familyId);
    return { family, members, currentMemberId: request.member.memberId };
  });

  app.post('/api/families/invite-code/rotate', async (request) => {
    const inviteCode = createInviteCode();
    app.db.prepare('UPDATE families SET invite_code_hash = ? WHERE id = ?').run(hashSecret(inviteCode), request.member.familyId);
    return { inviteCode };
  });

  app.post('/api/families/leave', async (request) => {
    app.db.prepare('DELETE FROM members WHERE id = ? AND family_id = ?').run(request.member.memberId, request.member.familyId);
    return { ok: true };
  });
}

function validText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}
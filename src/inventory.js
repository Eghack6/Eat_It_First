import { randomUUID } from 'node:crypto';
import { getExpiryStatus } from './expiry.js';

const DEFAULT_CATEGORIES = ['蔬菜水果', '肉蛋奶', '主食调味', '零食', '饮料', '速冻食品', '罐头干货', '其他'];
const DEFAULT_LOCATIONS = ['冰箱冷藏', '冷冻室', '橱柜', '食品柜', '常温储物', '其他'];

export function seedHouseholdOptions(db, familyId, now) {
  const addCategory = db.prepare('INSERT INTO categories (id, family_id, name, is_default, created_at) VALUES (?, ?, ?, 1, ?)');
  const addLocation = db.prepare('INSERT INTO locations (id, family_id, name, is_default, created_at) VALUES (?, ?, ?, 1, ?)');
  db.transaction(() => {
    DEFAULT_CATEGORIES.forEach((name) => addCategory.run(randomUUID(), familyId, name, now));
    DEFAULT_LOCATIONS.forEach((name) => addLocation.run(randomUUID(), familyId, name, now));
  })();
}

export function registerInventoryRoutes(app) {
  app.get('/api/categories', async (request) => listOptions(app, 'categories', request.member.familyId));
  app.post('/api/categories', async (request, reply) => createOption(app, request, reply, 'categories'));
  app.patch('/api/categories/:id', async (request, reply) => updateOption(app, request, reply, 'categories'));
  app.delete('/api/categories/:id', async (request, reply) => deleteOption(app, request, reply, 'categories'));
  app.get('/api/locations', async (request) => listOptions(app, 'locations', request.member.familyId));
  app.post('/api/locations', async (request, reply) => createOption(app, request, reply, 'locations'));
  app.patch('/api/locations/:id', async (request, reply) => updateOption(app, request, reply, 'locations'));
  app.delete('/api/locations/:id', async (request, reply) => deleteOption(app, request, reply, 'locations'));

  app.get('/api/foods', async (request) => {
    const query = request.query || {};
    const clauses = ['f.family_id = ?'];
    const params = [request.member.familyId];
    if (query.includeCompleted !== 'true') clauses.push("f.status = 'active'");
    if (query.categoryId) { clauses.push('f.category_id = ?'); params.push(query.categoryId); }
    if (query.locationId) { clauses.push('f.location_id = ?'); params.push(query.locationId); }
    if (query.q) { clauses.push('LOWER(f.name) LIKE LOWER(?)'); params.push(`%${query.q}%`); }
    const rows = app.db.prepare(`SELECT f.*, c.name AS category_name, l.name AS location_name
      FROM food_items f JOIN categories c ON c.id = f.category_id JOIN locations l ON l.id = f.location_id
      WHERE ${clauses.join(' AND ')} ORDER BY f.expiry_date ASC, f.name COLLATE NOCASE ASC`).all(...params);
    return { foods: rows.map((food) => ({ ...food, category: food.category_name, location: food.location_name, expiryStatus: food.status === 'completed' ? 'completed' : getExpiryStatus(food.expiry_date) })) };
  });

  app.post('/api/foods', async (request, reply) => {
    const input = normalizeFood(request.body);
    const error = validateFood(input);
    if (error) return reply.code(400).send({ error });
    if (!belongsToActiveOption(app, 'categories', input.categoryId, request.member.familyId) || !belongsToActiveOption(app, 'locations', input.locationId, request.member.familyId)) {
      return reply.code(400).send({ error: 'Category or location is invalid' });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    app.db.transaction(() => {
      app.db.prepare(`INSERT INTO food_items (id, family_id, name, category_id, quantity, expiry_date, location_id, note, photo, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, request.member.familyId, input.name, input.categoryId, input.quantity, input.expiryDate, input.locationId, input.note, input.photo, request.member.memberId, now, now);
      addLog(app.db, request.member, id, 'created', input.quantity, now);
    })();
    return { food: getFood(app, id, request.member.familyId) };
  });

  app.patch('/api/foods/:id', async (request, reply) => {
    const food = getFood(app, request.params.id, request.member.familyId);
    if (!food) return reply.code(404).send({ error: 'Food not found' });
    const input = normalizeFood({ ...food, ...request.body });
    const error = validateFood(input);
    if (error) return reply.code(400).send({ error });
    const now = new Date().toISOString();
    app.db.transaction(() => {
      app.db.prepare(`UPDATE food_items SET name = ?, category_id = ?, quantity = ?, expiry_date = ?, location_id = ?, note = ?, photo = ?, status = ?, updated_at = ? WHERE id = ? AND family_id = ?`)
        .run(input.name, input.categoryId, input.quantity, input.expiryDate, input.locationId, input.note, input.photo, input.quantity === 0 ? 'completed' : food.status, now, food.id, request.member.familyId);
      addLog(app.db, request.member, food.id, 'edited', input.quantity - food.quantity, now);
    })();
    return { food: getFood(app, food.id, request.member.familyId) };
  });

  app.post('/api/foods/:id/consume', async (request, reply) => {
    const food = getFood(app, request.params.id, request.member.familyId);
    if (!food || food.status === 'completed') return reply.code(404).send({ error: 'Active food not found' });
    const now = new Date().toISOString();
    const result = app.db.transaction(() => {
      const current = app.db.prepare("SELECT quantity FROM food_items WHERE id = ? AND family_id = ? AND status = 'active'").get(food.id, request.member.familyId);
      if (!current || current.quantity < 1) return false;
      const nextStatus = current.quantity === 1 ? 'completed' : 'active';
      app.db.prepare('UPDATE food_items SET quantity = quantity - 1, status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, food.id);
      addLog(app.db, request.member, food.id, 'consumed', -1, now);
      return true;
    })();
    if (!result) return reply.code(409).send({ error: 'Food is already completed' });
    return { food: getFood(app, food.id, request.member.familyId) };
  });

  app.post('/api/foods/:id/complete', async (request, reply) => changeCompletion(app, request, reply, true));
  app.post('/api/foods/:id/restore', async (request, reply) => changeCompletion(app, request, reply, false));
  app.get('/api/foods/:id/logs', async (request) => logsForFood(app, request.params.id, request.member.familyId));
  app.get('/api/logs', async (request) => logsForFamily(app, request.member.familyId));
  app.post('/api/logs/:id/undo', async (request, reply) => undoConsume(app, request, reply));
}

function normalizeFood(value = {}) {
  return { name: String(value.name || '').trim(), categoryId: value.categoryId, quantity: Number(value.quantity), expiryDate: value.expiryDate, locationId: value.locationId, note: String(value.note || '').trim(), photo: String(value.photo || '').trim() };
}

function validateFood(food) {
  if (!food.name || food.name.length > 120) return 'Food name is required';
  if (!Number.isInteger(food.quantity) || food.quantity < 0 || food.quantity > 100000) return 'Quantity must be a non-negative integer';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(food.expiryDate || '')) return 'Expiry date is required';
  if (!food.categoryId || !food.locationId) return 'Category and location are required';
  return null;
}

function getFood(app, id, familyId) {
  const food = app.db.prepare(`SELECT f.*, c.name AS category, l.name AS location FROM food_items f
    JOIN categories c ON c.id = f.category_id JOIN locations l ON l.id = f.location_id WHERE f.id = ? AND f.family_id = ?`).get(id, familyId);
  if (!food) return null;
  return { ...food, expiryStatus: food.status === 'completed' ? 'completed' : getExpiryStatus(food.expiry_date) };
}

function addLog(db, member, foodId, action, quantityDelta, now) {
  db.prepare('INSERT INTO food_logs (id, family_id, food_item_id, member_id, action, quantity_delta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), member.familyId, foodId, member.memberId, action, quantityDelta, now);
}

function listOptions(app, table, familyId) {
  return { items: app.db.prepare(`SELECT id, name, is_default AS isDefault, is_disabled AS isDisabled FROM ${table} WHERE family_id = ? ORDER BY is_disabled, name COLLATE NOCASE`).all(familyId) };
}

function createOption(app, request, reply, table) {
  const name = String(request.body?.name || '').trim();
  if (!name || name.length > 50) return reply.code(400).send({ error: 'Name is required' });
  try {
    const id = randomUUID();
    app.db.prepare(`INSERT INTO ${table} (id, family_id, name, created_at) VALUES (?, ?, ?, ?)`).run(id, request.member.familyId, name, new Date().toISOString());
    return { item: app.db.prepare(`SELECT id, name, is_default AS isDefault, is_disabled AS isDisabled FROM ${table} WHERE id = ?`).get(id) };
  } catch {
    return reply.code(409).send({ error: 'An item with this name already exists' });
  }
}

function updateOption(app, request, reply, table) {
  const item = app.db.prepare(`SELECT id FROM ${table} WHERE id = ? AND family_id = ?`).get(request.params.id, request.member.familyId);
  if (!item) return reply.code(404).send({ error: 'Item not found' });
  const updates = request.body || {};
  try {
    if (typeof updates.name === 'string' && updates.name.trim()) app.db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(updates.name.trim(), item.id);
    if (typeof updates.disabled === 'boolean') app.db.prepare(`UPDATE ${table} SET is_disabled = ? WHERE id = ?`).run(updates.disabled ? 1 : 0, item.id);
  } catch {
    return reply.code(409).send({ error: 'An item with this name already exists' });
  }
  return { item: app.db.prepare(`SELECT id, name, is_default AS isDefault, is_disabled AS isDisabled FROM ${table} WHERE id = ?`).get(item.id) };
}

function deleteOption(app, request, reply, table) {
  const item = app.db.prepare(`SELECT id FROM ${table} WHERE id = ? AND family_id = ?`).get(request.params.id, request.member.familyId);
  if (!item) return reply.code(404).send({ error: 'Item not found' });
  const column = table === 'categories' ? 'category_id' : 'location_id';
  const used = app.db.prepare(`SELECT COUNT(*) AS count FROM food_items WHERE ${column} = ? AND family_id = ?`).get(item.id, request.member.familyId);
  if (used.count > 0) return reply.code(409).send({ error: '该选项正被食品使用，请先修改或删除相关食品' });
  app.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(item.id);
  return { ok: true };
}

function belongsToActiveOption(app, table, id, familyId) {
  return Boolean(app.db.prepare(`SELECT id FROM ${table} WHERE id = ? AND family_id = ? AND is_disabled = 0`).get(id, familyId));
}

function undoConsume(app, request, reply) {
  const log = app.db.prepare('SELECT * FROM food_logs WHERE id = ? AND family_id = ?').get(request.params.id, request.member.familyId);
  if (!log || log.action !== 'consumed') return reply.code(404).send({ error: 'No consumable log found' });
  const food = app.db.prepare('SELECT * FROM food_items WHERE id = ? AND family_id = ?').get(log.food_item_id, request.member.familyId);
  if (!food) return reply.code(404).send({ error: 'Food not found' });
  const now = new Date().toISOString();
  const back = Math.max(1, Math.abs(log.quantity_delta || -1));
  app.db.transaction(() => {
    app.db.prepare('UPDATE food_items SET quantity = quantity + ?, status = ?, updated_at = ? WHERE id = ?')
      .run(back, 'active', now, food.id);
    app.db.prepare('DELETE FROM food_logs WHERE id = ?').run(log.id);
    addLog(app.db, request.member, food.id, 'restored', back, now);
  })();
  return { food: getFood(app, food.id, request.member.familyId) };
}

function changeCompletion(app, request, reply, complete) {
  if (!food) return reply.code(404).send({ error: 'Food not found' });
  if (complete && food.status === 'completed') return { food };
  if (!complete && (food.status !== 'completed' || food.quantity < 1)) return reply.code(400).send({ error: 'Completed food needs a positive quantity to restore' });
  const now = new Date().toISOString();
  app.db.transaction(() => {
    app.db.prepare('UPDATE food_items SET status = ?, updated_at = ? WHERE id = ? AND family_id = ?').run(complete ? 'completed' : 'active', now, food.id, request.member.familyId);
    addLog(app.db, request.member, food.id, complete ? 'completed' : 'restored', 0, now);
  })();
  return { food: getFood(app, food.id, request.member.familyId) };
}

function logsForFood(app, foodId, familyId) {
  return { logs: app.db.prepare(`SELECT l.*, m.nickname FROM food_logs l JOIN members m ON m.id = l.member_id WHERE l.food_item_id = ? AND l.family_id = ? ORDER BY l.created_at DESC`).all(foodId, familyId) };
}

function logsForFamily(app, familyId) {
  return { logs: app.db.prepare(`SELECT l.*, f.name AS food_name, m.nickname FROM food_logs l JOIN food_items f ON f.id = l.food_item_id JOIN members m ON m.id = l.member_id WHERE l.family_id = ? ORDER BY l.created_at DESC LIMIT 100`).all(familyId) };
}

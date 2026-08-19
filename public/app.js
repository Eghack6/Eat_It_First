const appRoot = document.querySelector("#app");
const TOKEN_KEY = "eat-it-first-device-token";
const state = {
  view: "home",
  family: null,
  foods: [],
  categories: [],
  locations: [],
  logs: [],
  authMode: "create",
  joinLink: null,
  joinToken: null,
  error: "",
  filters: {},
  inviteCode: null,
  photoDataUrl: null,
  photoFileName: null,
  creatorPasswordRequired: false,
  joinLinkCreatorPasswordRequired: false,
};

const labels = {
  expired: "已过期",
  today: "今天到期",
  soon: "7 天内到期",
  normal: "保质期内",
  completed: "已完成",
};
const actions = {
  created: "添加了",
  edited: "更新了",
  consumed: "消耗了",
  restocked: "补货了",
  undone: "撤销了操作，恢复了",
  completed: "完成了",
  restored: "恢复了",
};

function token() {
  return localStorage.getItem(TOKEN_KEY);
}
async function api(path, options = {}) {
  const hasBody = Boolean(options.body);
  const response = await fetch(`./api${path}`, {
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
}
function showToast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 2400);
}
function syncDateFields() {
  document
    .querySelectorAll('.date-field input[type="date"]')
    .forEach((input) => {
      const empty = !input.value;
      input.classList.toggle("empty", empty);
      input.classList.toggle("filled", !empty);
    });
}
function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal"><p class="modal-text">${escapeHtml(message)}</p><div class="modal-actions"><button class="button ghost" data-modal-cancel>取消</button><button class="button primary" data-modal-ok>确定</button></div></div>`;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    overlay
      .querySelector("[data-modal-cancel]")
      .addEventListener("click", () => close(false));
    overlay
      .querySelector("[data-modal-ok]")
      .addEventListener("click", () => close(true));
    document.body.append(overlay);
    function close(value) {
      overlay.remove();
      resolve(value);
    }
  });
}
function showQuantityPrompt(
  message,
  { max = 100000, confirmLabel = "补货" } = {},
) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<form class="modal"><p class="modal-text">${escapeHtml(message)}</p><input class="quantity-input" name="quantity" type="number" min="1" max="${max}" step="1" value="1" required autofocus><div class="modal-actions"><button class="button ghost" type="button" data-modal-cancel>取消</button><button class="button primary">${escapeHtml(confirmLabel)}</button></div></form>`;
    const form = overlay.querySelector("form");
    const input = form.elements.quantity;
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    overlay
      .querySelector("[data-modal-cancel]")
      .addEventListener("click", () => close(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      close(Number(input.value));
    });
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}
function showFoodTemplatePicker() {
  return new Promise((resolve) => {
    const foods = [...state.foods].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<section class="modal template-modal"><div class="panel-header"><h2>选择已添加食品</h2><button class="button ghost" data-modal-cancel>取消</button></div><div class="template-list">${foods.map((food) => `<button class="template-item" data-template-food="${food.id}">${photoHtml(food)}<span class="template-copy"><strong>${escapeHtml(food.name)}</strong><span>${escapeHtml(food.category)} · ${escapeHtml(food.location)}</span></span></button>`).join("") || '<p class="subtle">暂无可复用的食品。</p>'}</div></section>`;
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    overlay
      .querySelector("[data-modal-cancel]")
      .addEventListener("click", () => close(null));
    overlay
      .querySelectorAll("[data-template-food]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          close(foods.find((food) => food.id === button.dataset.templateFood)),
        ),
      );
    document.body.append(overlay);
  });
}
function showAddCompletePrompt() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal"><p class="modal-text">食品已添加，还要继续添加吗？</p><div class="modal-actions"><button class="button ghost" data-modal-complete>完成</button><button class="button primary" data-modal-continue>继续添加</button></div></div>';
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay
      .querySelector("[data-modal-complete]")
      .addEventListener("click", () => close(false));
    overlay
      .querySelector("[data-modal-continue]")
      .addEventListener("click", () => close(true));
    document.body.append(overlay);
  });
}
function showFoodDetail(food) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<section class="modal detail-modal"><div class="detail-hero">${photoHtml(food)}<div><p class="modal-kicker">食品详情</p><h2>${escapeHtml(food.name)}</h2><p class="subtle">${escapeHtml(food.category)} · ${escapeHtml(food.location)}</p></div></div><dl class="detail-grid"><div><dt>余量</dt><dd>${escapeHtml(quantityText(food.quantity, food.quantity_unit))}</dd></div><div><dt>状态</dt><dd>${escapeHtml(food.expiryStatus === "completed" ? "已完成" : expiryLabel(food, false))}</dd></div><div><dt>生产日期</dt><dd>${food.produced_date ? escapeHtml(dateText(food.produced_date)) : "未填写"}</dd></div><div><dt>到期日期</dt><dd>${escapeHtml(dateText(food.expiry_date))}</dd></div><div><dt>保质期</dt><dd>${food.shelf_life ? `${escapeHtml(food.shelf_life)} ${food.shelf_life_unit === "day" ? "天" : food.shelf_life_unit === "month" ? "月" : "年"}` : "未填写"}</dd></div><div><dt>备注</dt><dd>${food.note ? escapeHtml(food.note) : "无"}</dd></div></dl><div class="modal-actions"><button class="button primary" data-modal-close>关闭</button></div></section>`;
  const close = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector("[data-modal-close]").addEventListener("click", close);
  document.body.append(overlay);
}
function dateText(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}
function photoUrl(food) {
  return food.photo ? `./${food.photo.replace(/^\/+/, "")}` : null;
}
function photoHtml(food) {
  const url = photoUrl(food);
  return url
    ? `<img class="food-photo" src="${escapeHtml(url)}" alt="${escapeHtml(food.name)}" loading="lazy">`
    : '<div class="food-photo empty" title="暂无照片"><span>📦</span></div>';
}

async function load() {
  const scrollContainer = document.querySelector(".main");
  const savedScrollTop = scrollContainer?.scrollTop || window.scrollY;
  const joinToken = new URLSearchParams(location.search).get("join");
  if (joinToken && !token()) {
    renderJoinLink(joinToken);
    return;
  }
  if (!token()) return renderAuth();
  try {
    const [family, foods, categories, locations, logs, join, invite] =
      await Promise.all([
        api("/families/current"),
        api("/foods?includeCompleted=true"),
        api("/categories"),
        api("/locations"),
        api("/logs"),
        api("/families/join-link"),
        api("/families/invite-code"),
      ]);
    state.family = family;
    state.foods = foods.foods;
    state.categories = categories.items;
    state.locations = locations.items;
    state.logs = logs.logs;
    state.joinToken = join.joinToken;
    state.inviteCode = invite.inviteCode;
    render();
    requestAnimationFrame(() => {
      const nextContainer = document.querySelector(".main");
      if (nextContainer) nextContainer.scrollTop = savedScrollTop;
      else window.scrollTo(0, savedScrollTop);
    });
  } catch (error) {
    localStorage.removeItem(TOKEN_KEY);
    state.error = error.message;
    renderAuth();
  }
}

function renderAuth() {
  appRoot.innerHTML = `<main class="auth-page"><section class="auth-card"><div class="eyebrow">家庭食品管理</div><h1>Eat It First</h1><p class="subtle">让家里的好食物流动起来，不浪费。</p>${state.error ? `<div class="notice">${escapeHtml(state.error)}</div>` : ""}<div class="auth-tabs"><button class="${state.authMode === "create" ? "active" : ""}" data-auth="create">创建家庭</button><button class="${state.authMode === "join" ? "active" : ""}" data-auth="join">加入家庭</button></div><form class="form" id="auth-form">${state.authMode === "create" ? '<label>家庭名称<input name="name" required placeholder="陈的家"></label>' : '<label>邀请码<input name="inviteCode" required placeholder="10 位邀请码"></label>'}<label>你的名字<input name="nickname" required placeholder="小明"></label>${state.authMode === "create" ? '<label>创建者密码<input name="password" type="password" minlength="6" required autocomplete="new-password" placeholder="至少 6 位"></label>' : state.creatorPasswordRequired ? '<label>创建者密码<input name="password" type="password" required autocomplete="current-password" placeholder="输入创建家庭时设置的密码"></label>' : ""}<button class="button primary" type="submit">${state.authMode === "create" ? "创建家庭" : "加入家庭"}</button></form><p class="subtle auth-hint">${state.authMode === "create" ? "密码只会在创建者使用新设备接入家庭时用于二次确认。" : state.creatorPasswordRequired ? "这是创建者的新设备，请输入创建家庭时设置的密码。" : "用同一个名字加入会自动归到同一身份，换设备不丢数据。"}</p></section></main>`;
  document.querySelectorAll("[data-auth]").forEach((button) =>
    button.addEventListener("click", () => {
      state.authMode = button.dataset.auth;
      state.error = "";
      state.creatorPasswordRequired = false;
      renderAuth();
    }),
  );
  document
    .querySelector("#auth-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const data = await api(
          state.authMode === "create" ? "/families" : "/families/join",
          { method: "POST", body: JSON.stringify(payload) },
        );
        localStorage.setItem(TOKEN_KEY, data.deviceToken);
        if (data.inviteCode) state.inviteCode = data.inviteCode;
        await load();
        if (data.inviteCode) showToast(`邀请码：${data.inviteCode}`);
        if (data.joined)
          showToast(`已以「${payload.nickname}」身份进入 ${data.family.name}`);
      } catch (error) {
        state.error = error.message;
        state.creatorPasswordRequired =
          error.message.includes("创建者在新设备接入");
        renderAuth();
      }
    });
}

function renderJoinLink(joinToken) {
  state.joinLink = joinToken;
  appRoot.innerHTML = `<main class="auth-page"><div class="auth-brand"><strong>Eat It First</strong><span>你的家庭粮仓管家</span></div><section class="auth-card"><h1>加入家庭</h1>${state.error ? `<div class="notice">${escapeHtml(state.error)}</div>` : ""}<form class="form" id="join-link-form"><label>&nbsp;<input name="nickname" required placeholder="昵称"></label>${state.joinLinkCreatorPasswordRequired ? '<label>创建者密码<input name="password" type="password" required autocomplete="current-password" placeholder="输入创建家庭时设置的密码"></label>' : ""}<button class="button primary" type="submit">加入家庭</button></form>${state.joinLinkCreatorPasswordRequired ? '<p class="subtle auth-hint">这是创建者的新设备，请输入创建家庭时设置的密码。</p>' : ""}</section></main>`;
  document
    .querySelector("#join-link-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const nickname = form.get("nickname");
      const password = form.get("password");
      try {
        const data = await api("/families/join-link", {
          method: "POST",
          body: JSON.stringify({ token: joinToken, nickname, password }),
        });
        localStorage.setItem(TOKEN_KEY, data.deviceToken);
        history.replaceState(
          null,
          "",
          location.pathname + location.search.replace(/[?&]join=[^&]*/, ""),
        );
        state.joinLink = null;
        await load();
        showToast(`已以「${nickname}」身份进入 ${data.family.name}`);
      } catch (error) {
        state.error = error.message;
        state.joinLinkCreatorPasswordRequired =
          error.message.includes("创建者在新设备接入");
        renderJoinLink(joinToken);
      }
    });
}

function render() {
  const active = state.foods.filter((food) => food.status === "active");
  const counts = {
    expired: active.filter((food) => food.expiryStatus === "expired").length,
    today: active.filter((food) => food.expiryStatus === "today").length,
    soon: active.filter((food) => food.expiryStatus === "soon").length,
    normal: active.filter((food) => food.expiryStatus === "normal").length,
  };
  appRoot.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><strong>Eat It First</strong><small>${escapeHtml(state.family.family.name)}</small></div><nav class="nav">${navItems()}</nav><div class="sidebar-footer"><span class="profile-identity">${escapeHtml(state.family.members.find((member) => member.id === state.family.currentMemberId)?.nickname || "")}${deviceCodeTag(state.family.currentDeviceCode)}</span><span>${active.length} 个在架食品</span></div></aside><main class="main">${state.view === "home" ? homeView(counts) : state.view === "foods" ? foodsView() : state.view === "add" ? addView() : familyView()}</main><nav class="mobile-nav">${navItems()}</nav></div>`;
  bindEvents();
}
function navItems() {
  return [
    ["home", "首页"],
    ["foods", "全部食品"],
    ["add", "添加食品"],
    ["family", "家庭"],
  ]
    .map(
      ([view, label]) =>
        `<button class="${state.view === view ? "active" : ""}" data-view="${view}">${label}</button>`,
    )
    .join("");
}
function topbar(eyebrow, title, action = true) {
  const actionHtml =
    action === true
      ? '<button class="button primary topbar-add" data-view="add">添加食品</button>'
      : action || "";
  return `<header class="topbar"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtle">${new Intl.DateTimeFormat("zh-CN", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p></div>${actionHtml}</header>`;
}
function homeView(counts) {
  const expired = state.foods
    .filter(
      (food) => food.status === "active" && food.expiryStatus === "expired",
    )
    .slice(0, 8);
  const urgent = state.foods
    .filter(
      (food) =>
        food.status === "active" &&
        ["today", "soon"].includes(food.expiryStatus),
    )
    .slice(0, 8);
  return `${topbar("今日关注", "粮食储备管理")}<section class="summary-grid"><button class="summary urgent" data-summary="expired"><span>已过期</span><b>${counts.expired}</b></button><button class="summary today" data-summary="today"><span>今天到期</span><b>${counts.today}</b></button><button class="summary soon" data-summary="soon"><span>7 天内到期</span><b>${counts.soon}</b></button><button class="summary" data-summary=""><span>在架批次</span><b>${state.foods.filter((food) => food.status === "active").length}</b></button></section><div class="home-sections">${expired.length ? `<section class="panel"><div class="panel-header"><h2>已过期</h2><span class="subtle">${expired.length} 项</span></div>${foodList(expired, false, true)}</section>` : ""}<section class="panel"><div class="panel-header"><h2>优先吃掉</h2><span class="subtle">${urgent.length} 项</span></div>${foodList(urgent)}</section></div>`;
}
function foodsView() {
  const filters = state.filters;
  let foods = state.foods;
  if (filters.status === "completed")
    foods = foods.filter((food) => food.status === "completed");
  else {
    foods = foods.filter((food) => food.status === "active");
    if (filters.status)
      foods = foods.filter((food) => food.expiryStatus === filters.status);
  }
  if (filters.categoryId)
    foods = foods.filter((food) => food.category_id === filters.categoryId);
  if (filters.locationId)
    foods = foods.filter((food) => food.location_id === filters.locationId);
  if (filters.q)
    foods = foods.filter((food) =>
      food.name.toLowerCase().includes(filters.q.toLowerCase()),
    );
  return `${topbar("库存", "全部食品")}<section class="panel"><div class="filters"><input data-filter="q" value="${escapeHtml(filters.q || "")}" placeholder="搜索食品"><select data-filter="status"><option value="">全部状态</option><option value="expired" ${filters.status === "expired" ? "selected" : ""}>已过期</option><option value="today" ${filters.status === "today" ? "selected" : ""}>今天到期</option><option value="soon" ${filters.status === "soon" ? "selected" : ""}>7 天内到期</option><option value="completed" ${filters.status === "completed" ? "selected" : ""}>已吃完</option></select><select data-filter="categoryId"><option value="">全部分类</option>${state.categories
    .filter((item) => !item.isDisabled)
    .map(
      (item) =>
        `<option value="${item.id}" ${filters.categoryId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`,
    )
    .join(
      "",
    )}</select><select data-filter="locationId"><option value="">全部位置</option>${state.locations
    .filter((item) => !item.isDisabled)
    .map(
      (item) =>
        `<option value="${item.id}" ${filters.locationId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`,
    )
    .join("")}</select></div>${foodList(foods, true)}</section>`;
}
function expiryLabel(food, relative) {
  if (!relative || food.status !== "active" || food.expiryStatus !== "normal") {
    return labels[food.expiryStatus];
  }
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const [year, month, day] = food.expiry_date.split("-").map(Number);
  const days = Math.max(
    1,
    Math.ceil((Date.UTC(year, month - 1, day) - todayUtc) / 86400000),
  );
  return days > 30 ? `约 ${Math.round(days / 30)} 个月到期` : `${days} 天到期`;
}
function quantityText(quantity, quantityUnit = "portion") {
  return quantityUnit === "percent" ? `${quantity}%` : `${quantity} 份`;
}
function actionText(log) {
  if (log.action === "consumed")
    return `消耗了 ${quantityText(Math.abs(log.quantity_delta), log.quantityUnit)}`;
  if (log.action === "restocked")
    return `补货了 ${quantityText(log.quantity_delta, log.quantityUnit)}`;
  if (log.action === "undone")
    return `撤销了操作，恢复了 ${quantityText(log.quantity_delta, log.quantityUnit)}`;
  return actions[log.action] || log.action;
}
function foodList(foods, relativeExpiry = false, expiredMode = false) {
  if (!foods.length)
    return '<div class="empty">这里还没有食品，添加一批吧。</div>';
  return `<div class="food-list">${foods.map((food) => `<article class="food-row"><button class="food-photo-button" type="button" data-food-detail="${food.id}" aria-label="查看 ${escapeHtml(food.name)} 详情">${photoHtml(food)}</button><div class="food-main"><div class="cell-name"><div class="food-name">${escapeHtml(food.name)}</div><div class="food-meta">${escapeHtml(food.category)} · ${escapeHtml(food.location)}</div></div></div><div class="food-footer"><div class="food-expiry"><span class="pill ${food.expiryStatus}">${expiryLabel(food, relativeExpiry)}</span><div class="food-meta">${dateText(food.expiry_date)}</div></div><div class="food-controls"><div class="cell-qty"><span class="pill">${quantityText(food.quantity, food.quantity_unit)}</span></div>${food.status === "active" ? (food.expiryStatus === "expired" || expiredMode ? `<button class="button danger" data-complete="${food.id}">处理</button>` : `${relativeExpiry ? `<button class="button ghost" data-restock="${food.id}" data-restock-name="${escapeHtml(food.name)}" data-restock-unit="${food.quantity_unit}">补货</button>` : ""}<button class="button secondary" data-consume="${food.id}" data-consume-name="${escapeHtml(food.name)}" data-consume-unit="${food.quantity_unit}" data-quantity="${food.quantity}">${food.quantity_unit === "percent" ? "消耗" : "吃掉 1"}</button>`) : '<span class="subtle">已完成</span>'}</div></div></article>`).join("")}</div>`;
}
function deviceCodeTag(code) {
  return code ? `<span class="device-code">${escapeHtml(code)}</span>` : "";
}
function addView() {
  const preview = state.photoDataUrl || state.photoFileName;
  return `${topbar("新批次", "添加食品", false)}<section class="panel"><div class="panel-header add-panel-header"><h2>食品信息</h2><button class="button secondary" data-select-template>选择已添加食品</button></div><form class="form" id="food-form"><div class="photo-upload"><div class="photo-picker-wrap"><label class="photo-picker"><input type="file" accept="image/*" capture="environment" data-photo-input hidden>${preview ? `<img class="photo-preview" src="${escapeHtml(preview.startsWith("data:") ? preview : `./${preview.replace(/^\/+/, "")}`)}" alt="照片预览">` : `<span class="photo-placeholder"><span class="photo-placeholder-icon">📷</span><span>拍照 / 选择照片</span></span>`}</label>${preview ? '<button class="photo-delete" type="button" data-clear-photo aria-label="移除照片" title="移除照片">×</button>' : ""}</div></div><div class="form-grid"><label>食品名称<input name="name" required placeholder="请输入食品名称"></label><label>数量<span class="shelf-life"><input name="quantity" type="number" min="0" value="1" required><select name="quantityUnit"><option value="portion">份</option><option value="percent">百分比</option></select></span></label><label>分类<select name="categoryId" required>${state.categories
    .filter((item) => !item.isDisabled)
    .map(
      (item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`,
    )
    .join(
      "",
    )}</select></label><label>存放位置<select name="locationId" required>${state.locations
    .filter((item) => !item.isDisabled)
    .map(
      (item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`,
    )
    .join(
      "",
    )}</select></label><label>生产日期（选填）<span class="date-field"><input name="producedDate" type="date"><span class="date-hint">YYYY/MM/DD</span></span></label><label>保质期（选填）<span class="shelf-life"><input name="shelfLife" type="number" min="0" step="1" placeholder="时长"><select name="shelfLifeUnit"><option value="day">天</option><option value="month" selected>月</option><option value="year">年</option></select></span></label><label>到期日期<span class="date-field"><input name="expiryDate" type="date" required><span class="date-hint">YYYY/MM/DD</span></span></label></div><label>备注<textarea name="note" placeholder="可选备注"></textarea></label><input type="hidden" name="photo" value="${escapeHtml(state.photoFileName || "")}"><div class="form-actions"><button class="button ghost" type="button" data-view="home">取消</button><button class="button primary">保存食品</button></div></form></section>`;
}
/* Legacy family view retained during the active client rollout. */
function familyViewLegacy() {
  const joinUrl = state.joinToken
    ? `${location.origin}${location.pathname}?join=${state.joinToken}`
    : "";
  return `${topbar("家庭", escapeHtml(state.family.family.name), false)}<div class="settings-grid"><section class="panel"><div class="panel-header"><h2>成员</h2></div>${state.family.members.map((member) => `<div class="member"><span class="member-identity"><b>${escapeHtml(member.nickname)}${member.id === state.family.currentMemberId ? " · 你" : ""}</b>${(member.devices || []).map((device) => `<span class="device-entry">${deviceCodeTag(device.deviceCode)}${device.id === state.family.currentDeviceId ? "" : `<button class="button danger device-delete" data-delete-device="${device.id}">删除</button>`}</span>`).join("")}</span><span class="subtle">${new Date(member.joinedAt).toLocaleDateString("zh-CN")}</span></div>`).join("")}<div class="panel-header" style="margin-top:26px"><h2>邀请码</h2><button class="button secondary" data-rotate>新邀请码</button></div><p class="subtle" style="margin:0 0 12px">对方在「加入家庭」页输入邀请码即可加入。</p><div class="join-box"><span class="join-code">${state.inviteCode ? escapeHtml(state.inviteCode) : "加载中…"}</span><button class="button ghost" data-copy="${state.inviteCode ? escapeHtml(state.inviteCode) : ""}">复制</button></div><div class="panel-header" style="margin-top:26px"><h2>加入链接</h2><button class="button secondary" data-rotate-link>新链接</button></div><p class="subtle" style="margin:0 0 12px">分享这个链接给家人，对方打开后只需输入名字就能加入，一个链接可在多台设备重复使用。</p><div class="join-box">${joinUrl ? `<span class="join-url">${escapeHtml(joinUrl)}</span><button class="button ghost" data-copy="${escapeHtml(joinUrl)}">复制</button>` : '<span class="subtle">链接加载中…</span>'}</div></section><section class="panel"><div class="panel-header collapse-header" data-toggle-group="categories"><h2>分类</h2><span class="collapse-tools"><span class="subtle collapse-count">${state.categories.length} 项</span><button class="button secondary" data-add-option="categories" data-stop-propagation>添加</button><button class="collapse-chevron">${state.expandedGroups.categories ? "收起 ▲" : "展开 ▼"}</button></span></div><div class="collapse-body${state.expandedGroups.categories ? "" : " collapsed"}">${optionList(state.categories, "categories")}</div><div class="panel-header collapse-header" data-toggle-group="locations" style="margin-top:25px"><h2>存放位置</h2><span class="collapse-tools"><span class="subtle collapse-count">${state.locations.length} 项</span><button class="button secondary" data-add-option="locations" data-stop-propagation>添加</button><button class="collapse-chevron">${state.expandedGroups.locations ? "收起 ▲" : "展开 ▼"}</button></span></div><div class="collapse-body${state.expandedGroups.locations ? "" : " collapsed"}">${optionList(state.locations, "locations")}</div></section><section class="panel"><div class="panel-header"><h2>最近动态</h2></div><div class="activity">${
    state.logs
      .slice(0, 50)
      .map(
        (log) =>
          `<div class="activity-item"><div class="activity-row"><b>${escapeHtml(log.nickname)}</b>${deviceCodeTag(log.deviceCode)} ${actionText(log)} <b>${escapeHtml(log.food_name)}</b>${log.action === "consumed" && !log.undone_at ? `<button class="button ghost undo" data-undo="${log.id}">撤销</button>` : ""}</div><small>${new Date(log.created_at).toLocaleString("zh-CN")}</small></div>`,
      )
      .join("") || '<div class="empty">暂无动态。</div>'
  }</div></section></div>`;
}
function optionList(items, table) {
  return items.length
    ? `<div class="option-list">${items.map((item) => `<div class="option-chip${item.isDisabled ? " disabled" : ""}"><span class="option-chip-name">${escapeHtml(item.name)}${item.isDefault ? '<em class="option-tag">默认</em>' : ""}${item.isDisabled ? '<em class="option-tag">已停用</em>' : ""}</span><span class="option-chip-actions"><button class="button ghost" data-disable="${table}|${item.id}|${item.isDisabled ? "false" : "true"}">${item.isDisabled ? "启用" : "停用"}</button>${item.isDefault ? "" : `<button class="button danger" data-delete-option="${table}|${item.id}">删除</button>`}</span></div>`).join("")}</div>`
    : '<p class="subtle">暂无选项，点击右上角添加。</p>';
}
function familyView() {
  const joinUrl = state.joinToken
    ? `${location.origin}${location.pathname}?join=${state.joinToken}`
    : "";
  const members = state.family.members
    .map(
      (member) =>
        `<div class="member"><span class="member-identity"><b>${escapeHtml(member.nickname)}${member.id === state.family.currentMemberId ? " · 你" : ""}</b>${(member.devices || []).map((device) => `<span class="device-entry device-code">${escapeHtml(device.deviceCode)}${state.family.family.isCreator && device.id !== state.family.currentDeviceId ? `<span class="device-separator" aria-hidden="true"></span><button class="device-delete" data-delete-device="${device.id}" aria-label="删除设备码 ${escapeHtml(device.deviceCode)}" title="删除设备">×</button>` : ""}</span>`).join("")}</span><span class="subtle">${new Date(member.joinedAt).toLocaleDateString("zh-CN")}</span></div>`,
    )
    .join("");
  const joinLink = joinUrl
    ? `<span class="join-url">${escapeHtml(joinUrl)}</span><button class="button ghost" data-copy="${escapeHtml(joinUrl)}">复制</button>`
    : '<span class="subtle">链接加载中…</span>';

  return `${topbar("家庭", escapeHtml(state.family.family.name), false)}<div class="settings-grid"><section class="panel"><div class="panel-header"><h2>成员</h2></div>${members}<div class="panel-header" style="margin-top:26px"><h2>邀请码</h2><button class="button secondary" data-rotate>新邀请码</button></div><p class="subtle" style="margin:0 0 12px">对方在「加入家庭」页输入邀请码即可加入。</p><div class="join-box"><span class="join-code">${state.inviteCode ? escapeHtml(state.inviteCode) : "加载中…"}</span><button class="button ghost" data-copy="${state.inviteCode ? escapeHtml(state.inviteCode) : ""}">复制</button></div><div class="panel-header" style="margin-top:26px"><h2>加入链接</h2><button class="button secondary" data-rotate-link>新链接</button></div><p class="subtle" style="margin:0 0 12px">分享这个链接给家人，对方打开后只需输入名字就能加入，一个链接可在多台设备重复使用。</p><div class="join-box">${joinLink}</div></section><section class="panel"><div class="panel-header"><h2>分类</h2><span class="collapse-tools"><span class="subtle collapse-count">${state.categories.length} 项</span><button class="button secondary" data-add-option="categories">添加</button></span></div>${optionList(state.categories, "categories")}<div class="panel-header" style="margin-top:25px"><h2>存放位置</h2><span class="collapse-tools"><span class="subtle collapse-count">${state.locations.length} 项</span><button class="button secondary" data-add-option="locations">添加</button></span></div>${optionList(state.locations, "locations")}</section><section class="panel"><div class="panel-header"><h2>最近动态</h2></div><div class="activity">${
    state.logs
      .slice(0, 50)
      .map(
        (log) =>
          `<div class="activity-item"><div class="activity-row"><b>${escapeHtml(log.nickname)}</b>${deviceCodeTag(log.deviceCode)} ${actions[log.action] || log.action} <b>${escapeHtml(log.food_name)}</b>${log.action === "consumed" && !log.undone_at ? `<button class="button ghost undo" data-undo="${log.id}">撤销</button>` : ""}</div><small>${new Date(log.created_at).toLocaleString("zh-CN")}</small></div>`,
      )
      .join("") || '<div class="empty">暂无动态。</div>'
  }</div></section></div>`;
}
function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      render();
    }),
  );
  document.querySelectorAll("[data-summary]").forEach((button) =>
    button.addEventListener("click", () => {
      state.filters.status = button.dataset.summary || "";
      state.view = "foods";
      render();
    }),
  );
  document.querySelectorAll("[data-food-detail]").forEach((button) =>
    button.addEventListener("click", () => {
      const food = state.foods.find(
        (item) => item.id === button.dataset.foodDetail,
      );
      if (food) showFoodDetail(food);
    }),
  );
  document.querySelectorAll("[data-complete]").forEach((button) =>
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api(`/foods/${button.dataset.complete}/complete`, {
          method: "POST",
        });
        await load();
        showToast("已处理整批食品");
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    }),
  );
  document.querySelectorAll("[data-consume]").forEach((button) =>
    button.addEventListener("click", async () => {
      const isPercent = button.dataset.consumeUnit === "percent";
      const quantity = isPercent
        ? await showQuantityPrompt(`消耗「${button.dataset.consumeName}」`, {
            max: Number(button.dataset.quantity),
            confirmLabel: "消耗",
          })
        : 1;
      if (!quantity) return;
      button.disabled = true;
      try {
        await api(`/foods/${button.dataset.consume}/consume`, {
          method: "POST",
          body: JSON.stringify({ quantity }),
        });
        await load();
        showToast("已更新");
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    }),
  );
  document.querySelectorAll("[data-restock]").forEach((button) =>
    button.addEventListener("click", async () => {
      const quantity = await showQuantityPrompt(
        `为「${button.dataset.restockName}」补货${button.dataset.restockUnit === "percent" ? "（百分比）" : ""}`,
        { max: button.dataset.restockUnit === "percent" ? 100 : 100000 },
      );
      if (!quantity) return;
      button.disabled = true;
      try {
        await api(`/foods/${button.dataset.restock}/restock`, {
          method: "POST",
          body: JSON.stringify({ quantity }),
        });
        await load();
        showToast(
          `已补货 ${quantityText(quantity, button.dataset.restockUnit)}`,
        );
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    }),
  );
  const foodForm = document.querySelector("#food-form");
  const renderAddFormPreservingValues = () => {
    if (!foodForm) return render();
    const values = Object.fromEntries(new FormData(foodForm));
    render();
    const updatedForm = document.querySelector("#food-form");
    if (!updatedForm) return;
    Object.entries(values).forEach(([name, value]) => {
      const field = updatedForm.elements.namedItem(name);
      if (field) field.value = value;
    });
    syncDateFields();
  };
  if (foodForm)
    foodForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(foodForm));
        if (payload.expiryDate)
          payload.expiryDate = payload.expiryDate.replace(/\//g, "-");
        if (state.photoDataUrl && !state.photoFileName) {
          const up = await api("/photos", {
            method: "POST",
            body: JSON.stringify({ data: state.photoDataUrl }),
          });
          payload.photo = up.url;
        }
        await api("/foods", { method: "POST", body: JSON.stringify(payload) });
        state.photoDataUrl = null;
        state.photoFileName = null;
        await load();
        if (await showAddCompletePrompt()) {
          state.view = "add";
          render();
        } else {
          state.view = "foods";
          render();
        }
      } catch (error) {
        showToast(error.message);
      }
    });
  const quantityInput = foodForm?.elements.quantity;
  const quantityUnitInput = foodForm?.elements.quantityUnit;
  const syncQuantityLimit = () => {
    if (!quantityInput || !quantityUnitInput) return;
    const isPercent = quantityUnitInput.value === "percent";
    quantityInput.max = isPercent ? "100" : "100000";
    if (isPercent) quantityInput.value = "100";
  };
  if (quantityUnitInput)
    quantityUnitInput.addEventListener("change", syncQuantityLimit);
  if (quantityInput)
    quantityInput.addEventListener("input", () => {
      if (
        quantityUnitInput?.value === "percent" &&
        Number(quantityInput.value) > 100
      )
        quantityInput.value = "100";
    });
  syncQuantityLimit();
  const photoInput = document.querySelector("[data-photo-input]");
  if (photoInput)
    photoInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const compressed = await compressImage(file);
      state.photoDataUrl = compressed;
      renderAddFormPreservingValues();
    });
  document.querySelectorAll('.date-field input[type="date"]').forEach((input) =>
    input.addEventListener("click", () => {
      try {
        input.showPicker();
      } catch (error) {}
    }),
  );
  document
    .querySelectorAll('.date-field input[type="date"]')
    .forEach((input) => input.addEventListener("change", syncDateFields));
  const producedInput = document.querySelector('input[name="producedDate"]');
  const shelfLifeInput = document.querySelector('input[name="shelfLife"]');
  const shelfLifeUnit = document.querySelector('select[name="shelfLifeUnit"]');
  const calcExpiry = () => {
    const producedValue = producedInput?.value;
    const shelfValue = shelfLifeInput?.value;
    const expiryDate = document.querySelector('input[name="expiryDate"]');
    if (!expiryDate) return;
    expiryDate.readOnly = Boolean(producedValue);
    if (!producedValue) {
      syncDateFields();
      return;
    }
    if (!shelfValue) {
      expiryDate.value = "";
      syncDateFields();
      return;
    }
    const produced = new Date(`${producedValue}T12:00:00`);
    const amount = Number(shelfValue);
    if (!Number.isFinite(amount) || amount < 0) return;
    const unit = shelfLifeUnit?.value || "day";
    if (unit === "day") produced.setDate(produced.getDate() + amount);
    else if (unit === "month") produced.setMonth(produced.getMonth() + amount);
    else if (unit === "year")
      produced.setFullYear(produced.getFullYear() + amount);
    const pad = (n) => String(n).padStart(2, "0");
    expiryDate.value = `${produced.getFullYear()}-${pad(produced.getMonth() + 1)}-${pad(produced.getDate())}`;
    syncDateFields();
  };
  if (producedInput && shelfLifeInput)
    [producedInput, shelfLifeInput, shelfLifeUnit].forEach((input) =>
      input.addEventListener("change", calcExpiry),
    );
  syncDateFields();
  document.querySelectorAll("[data-clear-photo]").forEach((button) =>
    button.addEventListener("click", () => {
      state.photoDataUrl = null;
      state.photoFileName = null;
      renderAddFormPreservingValues();
    }),
  );
  document.querySelectorAll("[data-select-template]").forEach((button) =>
    button.addEventListener("click", async () => {
      const template = await showFoodTemplatePicker();
      if (!template) return;
      state.photoDataUrl = null;
      state.photoFileName = template.photo || null;
      render();
      const form = document.querySelector("#food-form");
      if (!form) return;
      form.elements.name.value = template.name;
      form.elements.quantity.value = template.quantity;
      form.elements.quantityUnit.value = template.quantity_unit || "portion";
      form.elements.categoryId.value = template.category_id;
      form.elements.locationId.value = template.location_id;
      form.elements.producedDate.value = "";
      form.elements.shelfLife.value = template.shelf_life ?? "";
      form.elements.shelfLifeUnit.value = template.shelf_life_unit || "month";
      form.elements.expiryDate.value = "";
      form.elements.note.value = template.note || "";
      form.elements.photo.value = state.photoFileName || "";
      syncDateFields();
    }),
  );
  document.querySelectorAll("[data-filter]").forEach((input) =>
    input.addEventListener("change", () => {
      state.filters[input.dataset.filter] =
        input.type === "checkbox" ? input.checked : input.value;
      render();
    }),
  );
  document.querySelectorAll("[data-rotate]").forEach((button) =>
    button.addEventListener("click", async () => {
      const data = await api("/families/invite-code/rotate", {
        method: "POST",
      });
      state.inviteCode = data.inviteCode;
      render();
    }),
  );
  document.querySelectorAll("[data-rotate-link]").forEach((button) =>
    button.addEventListener("click", async () => {
      const data = await api("/families/join-link/rotate", { method: "POST" });
      state.joinToken = data.joinToken;
      render();
      showToast("已生成新链接");
    }),
  );
  document.querySelectorAll("[data-delete-device]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (
        !(await showConfirm(
          "删除后该设备将立即无法继续访问家庭数据，确定删除？",
        ))
      )
        return;
      button.disabled = true;
      try {
        await api(`/devices/${button.dataset.deleteDevice}`, {
          method: "DELETE",
        });
        await load();
        showToast("设备已删除");
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    }),
  );
  document.querySelectorAll("[data-undo]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!(await showConfirm("确定撤销这次消耗？"))) return;
      button.disabled = true;
      try {
        await api(`/logs/${button.dataset.undo}/undo`, { method: "POST" });
        await load();
        showToast("已撤销");
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    }),
  );
  document
    .querySelectorAll("[data-copy]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        navigator.clipboard
          ?.writeText(button.dataset.copy)
          .then(() => showToast("邀请码已复制")),
      ),
    );
  document.querySelectorAll("[data-add-option]").forEach((button) =>
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const name = prompt(
        `新${button.dataset.addOption === "categories" ? "分类" : "存放位置"}名称`,
      );
      if (!name) return;
      try {
        await api(`/${button.dataset.addOption}`, {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        await load();
        state.view = "family";
        render();
      } catch (error) {
        showToast(error.message);
      }
    }),
  );
  document.querySelectorAll("[data-disable]").forEach((button) =>
    button.addEventListener("click", async () => {
      const [table, id, disabled] = button.dataset.disable.split("|");
      await api(`/${table}/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled: disabled === "true" }),
      });
      await load();
      state.view = "family";
      render();
    }),
  );
  document.querySelectorAll("[data-delete-option]").forEach((button) =>
    button.addEventListener("click", async () => {
      const [table, id] = button.dataset.deleteOption.split("|");
      if (!(await showConfirm("确定删除该选项？"))) return;
      try {
        await api(`/${table}/${id}`, { method: "DELETE" });
        await load();
        state.view = "family";
        render();
        showToast("已删除");
      } catch (error) {
        showToast(error.message);
      }
    }),
  );
}

function compressImage(file, maxWidth = 1280, quality = 0.8) {
  if (file.type === "image/gif") return readFileAsDataUrl(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取图片"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("无法解析图片"));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取图片"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

load();

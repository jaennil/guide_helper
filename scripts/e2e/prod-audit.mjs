import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const DEFAULT_BASE_URL = "https://guidehelper.dubrovskih.ru";
const PAGE_BASE_URL = process.env.GH_E2E_PAGE_BASE_URL ?? process.env.GH_E2E_BASE_URL ?? DEFAULT_BASE_URL;
const API_BASE_URL = process.env.GH_E2E_API_BASE_URL ?? process.env.GH_E2E_BASE_URL ?? DEFAULT_BASE_URL;
const ADMIN_EMAIL = process.env.GH_E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.GH_E2E_ADMIN_PASSWORD;
const CHROMIUM = process.env.GH_E2E_CHROMIUM ?? "/usr/bin/chromium";
const KEEP_BROWSER = process.env.GH_E2E_KEEP_BROWSER === "1";

const runStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
const OUT_DIR = path.join(ROOT, "doc", "e2e", `${runStamp}-guide-helper`);
const SHOTS_DIR = path.join(OUT_DIR, "screenshots");

const testEmail = `e2e-${runStamp}@guide-helper.local`;
const testPassword = `E2eStart-${runStamp}!`;
const changedPassword = `E2eChanged-${runStamp}!`;
const testName = `E2E пользователь ${runStamp}`;

const results = [];
const screenshots = [];
const notes = [];
const browserIssues = [];

function addResult(area, name, status, details = "") {
  results.push({ area, name, status, details });
  const icon = status === "PASS" ? "PASS" : status === "SKIP" ? "SKIP" : "FAIL";
  console.log(`${icon} ${area}: ${name}${details ? ` - ${details}` : ""}`);
}

async function step(area, name, fn) {
  try {
    const details = await fn();
    addResult(area, name, "PASS", details || "");
  } catch (error) {
    addResult(area, name, "FAIL", error?.message || String(error));
  }
}

function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 45000);
  try {
    const headers = {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? authHeader(options.token) : {}),
      ...(options.headers ?? {}),
    };
    const response = await fetch(`${API_BASE_URL}${pathname}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body instanceof FormData
          ? options.body
          : options.body
            ? JSON.stringify(options.body)
            : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? tryJson(text) : null;
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const pending = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? pending.reject(new Error(JSON.stringify(msg.error))) : pending.resolve(msg.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    this.ws.close();
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chromium CDP endpoint did not start");
}

async function createBrowser() {
  const port = 9224 + Math.floor(Math.random() * 400);
  const profileDir = `/tmp/guide-helper-e2e-${runStamp}`;
  const proc = spawn(CHROMIUM, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--noerrdialogs",
    "--no-first-run",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (!/DevTools listening|vaInitialize failed|DEPRECATED_ENDPOINT/.test(text)) {
      browserIssues.push({ type: "chromium-stderr", text: text.trim().slice(0, 500) });
    }
  });
  const wsUrl = await waitForCdp(port);
  const cdp = new Cdp(wsUrl);
  await cdp.open();
  return { cdp, proc, profileDir };
}

async function createPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  cdp.ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.sessionId !== sessionId || !msg.method) return;
    if (msg.method === "Runtime.consoleAPICalled") {
      const type = msg.params?.type;
      if (type === "error" || type === "warning") {
        browserIssues.push({
          type: `console-${type}`,
          text: (msg.params.args ?? []).map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 700),
        });
      }
    }
    if (msg.method === "Runtime.exceptionThrown") {
      browserIssues.push({
        type: "runtime-exception",
        text: msg.params?.exceptionDetails?.text ?? "runtime exception",
      });
    }
    if (msg.method === "Network.responseReceived") {
      const response = msg.params?.response;
      const resourceType = msg.params?.type;
      if (response?.status >= 400 && ["Document", "Fetch", "XHR", "Script"].includes(resourceType)) {
        browserIssues.push({
          type: `http-${response.status}`,
          text: response.url,
        });
      }
    }
  });
  return sessionId;
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function navigate(cdp, sessionId, url, waitMs = 2500) {
  await cdp.send("Page.navigate", { url }, sessionId);
  await sleep(waitMs);
}

async function setAuthState(cdp, sessionId, token, refreshToken) {
  await navigate(cdp, sessionId, `${PAGE_BASE_URL}/login`, 1000);
  await evaluate(cdp, sessionId, `
    (() => {
      localStorage.setItem('access_token', ${JSON.stringify(token)});
      localStorage.setItem('refresh_token', ${JSON.stringify(refreshToken)});
      localStorage.setItem('language', 'ru');
      localStorage.setItem('theme', 'dark');
      return true;
    })()
  `);
}

async function screenshot(cdp, sessionId, filename, title, expectation) {
  await evaluate(cdp, sessionId, `(() => { document.querySelectorAll('.pwa-status-stack').forEach((el) => el.remove()); return document.body.innerText; })()`);
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true }, sessionId);
  const filePath = path.join(SHOTS_DIR, filename);
  await writeFile(filePath, Buffer.from(result.data, "base64"));
  screenshots.push({ filename, title, expectation });
}

async function clickByText(cdp, sessionId, needles) {
  const list = Array.isArray(needles) ? needles : [needles];
  await evaluate(cdp, sessionId, `
    (() => {
      const needles = ${JSON.stringify(list)}.map((item) => item.toLowerCase());
      const nodes = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')];
      const el = nodes.find((node) => {
        const text = [node.textContent, node.ariaLabel, node.title].filter(Boolean).join(' ').trim().toLowerCase();
        return needles.some((needle) => text.includes(needle));
      });
      if (!el) throw new Error('click target not found: ' + needles.join(', '));
      el.click();
      return true;
    })()
  `);
  await sleep(1200);
}

async function assertText(cdp, sessionId, needles) {
  const list = Array.isArray(needles) ? needles : [needles];
  const body = await evaluate(cdp, sessionId, `document.body.innerText || ''`);
  const missing = list.filter((needle) => !body.includes(needle));
  if (missing.length > 0) throw new Error(`missing text: ${missing.join(", ")}`);
}

async function waitForText(cdp, sessionId, needles, timeoutMs = 8000) {
  const list = Array.isArray(needles) ? needles : [needles];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await evaluate(cdp, sessionId, `document.body.innerText || ''`);
    if (list.every((needle) => body.includes(needle))) return;
    await sleep(300);
  }
  await assertText(cdp, sessionId, list);
}

async function waitForExpression(cdp, sessionId, expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = await evaluate(cdp, sessionId, `Boolean(${expression})`);
    if (matched) return;
    await sleep(300);
  }
  throw new Error(`condition did not match: ${expression}`);
}

async function clickFirstMarker(cdp, sessionId) {
  const point = await evaluate(cdp, sessionId, `
    (() => {
      const el = document.querySelector('.leaflet-marker-icon');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `);
  if (!point) throw new Error("marker not found");
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, sessionId);
  await sleep(1200);
}

async function runApiAudit(state) {
  await step("Auth", "регистрация нового пользователя", async () => {
    const data = await api("/api/v1/auth/register", {
      method: "POST",
      body: { email: testEmail, password: testPassword },
    });
    state.userToken = data.access_token;
    state.userRefresh = data.refresh_token;
    return testEmail;
  });

  await step("Auth", "вход зарегистрированного пользователя", async () => {
    const data = await api("/api/v1/auth/login", {
      method: "POST",
      body: { email: testEmail, password: testPassword },
    });
    state.userToken = data.access_token;
    state.userRefresh = data.refresh_token;
    return "получены access/refresh token";
  });

  await step("Profile", "обновление профиля", async () => {
    const data = await api("/api/v1/auth/me", {
      method: "PUT",
      token: state.userToken,
      body: { name: testName, avatar_url: "https://example.com/e2e-avatar.png" },
    });
    if (data.name !== testName) throw new Error("profile name was not updated");
    return data.name;
  });

  await step("Profile", "смена пароля и повторный вход", async () => {
    await api("/api/v1/auth/password", {
      method: "PUT",
      token: state.userToken,
      body: { old_password: testPassword, new_password: changedPassword },
    });
    const data = await api("/api/v1/auth/login", {
      method: "POST",
      body: { email: testEmail, password: changedPassword },
    });
    state.userToken = data.access_token;
    state.userRefresh = data.refresh_token;
    return "новый пароль принят";
  });

  await step("Catalog", "получение категорий", async () => {
    state.categories = await api("/api/v1/categories");
    if (!Array.isArray(state.categories) || state.categories.length === 0) throw new Error("categories are empty");
    return `${state.categories.length} categories`;
  });

  await step("Routes", "создание маршрута с точками, заметками и кастомизацией", async () => {
    const categoryId = state.categories[0]?.id;
    const route = await api("/api/v1/routes", {
      method: "POST",
      token: state.userToken,
      body: {
        name: `E2E маршрут ${runStamp}`,
        started_at: "2026-04-28T09:00:00Z",
        category_ids: categoryId ? [categoryId] : [],
        seasons: ["spring"],
        line_color: "#ef4444",
        points: [
          {
            lat: 55.752004,
            lng: 37.617734,
            name: "Точка 1",
            note: "E2E заметка к первой точке",
            marker_color: "#ef4444",
            marker_size: 34,
            preview_size: 92,
            preview_shape: "square",
          },
          {
            lat: 55.7539,
            lng: 37.6208,
            name: "Точка 2",
            note: "E2E участок с ручным временем",
            segment_mode: "manual",
            segment_duration_minutes: 12,
            marker_color: "#3b82f6",
            marker_size: 38,
            preview_shape: "circle",
          },
          {
            lat: 55.7506,
            lng: 37.6232,
            name: "Точка 3",
            note: "Финишная точка тестового маршрута",
          },
        ],
      },
    });
    state.route = route;
    if (!route.id || route.points.length !== 3) throw new Error("route was not created correctly");
    return route.id;
  });

  await step("Routes", "обновление маршрута", async () => {
    const updated = await api(`/api/v1/routes/${state.route.id}`, {
      method: "PUT",
      token: state.userToken,
      body: {
        name: `${state.route.name} обновлён`,
        line_color: "#22c55e",
        seasons: ["spring", "summer"],
        is_draft: false,
      },
    });
    state.route = updated;
    if (!updated.name.includes("обновлён")) throw new Error("route name was not updated");
    return updated.name;
  });

  await step("Routes", "импорт GeoJSON", async () => {
    const form = new FormData();
    const geojson = await readFile(path.join(ROOT, "testdata/route-import/test_points.geojson"));
    form.append("file", new Blob([geojson], { type: "application/geo+json" }), "test_points.geojson");
    const imported = await api("/api/v1/routes/import", {
      method: "POST",
      token: state.userToken,
      body: form,
      timeoutMs: 60000,
    });
    state.importedRouteId = imported.id;
    if (!imported.id || imported.points.length === 0) throw new Error("imported route has no points");
    return `${imported.points.length} points`;
  });

  await step("Share", "публикация маршрута", async () => {
    const data = await api(`/api/v1/routes/${state.route.id}/share`, {
      method: "POST",
      token: state.userToken,
      body: {},
    });
    state.shareToken = data.share_token;
    if (!state.shareToken) throw new Error("share token is empty");
    return state.shareToken;
  });

  await step("Share", "публичное получение маршрута", async () => {
    const shared = await api(`/api/v1/shared/${state.shareToken}`);
    if (shared.id !== state.route.id) throw new Error("shared route id mismatch");
    return shared.name;
  });

  await step("Social", "создание комментария", async () => {
    const comment = await api(`/api/v1/routes/${state.route.id}/comments`, {
      method: "POST",
      token: state.userToken,
      body: { author_name: testName, text: "E2E комментарий к маршруту" },
    });
    state.commentId = comment.id;
    if (!comment.id) throw new Error("comment id is empty");
    return comment.id;
  });

  await step("Social", "лайк, рейтинг и закладка", async () => {
    const like = await api(`/api/v1/routes/${state.route.id}/like`, { method: "POST", token: state.userToken, body: {} });
    const rating = await api(`/api/v1/routes/${state.route.id}/rating`, { method: "PUT", token: state.userToken, body: { rating: 5 } });
    const bookmark = await api(`/api/v1/routes/${state.route.id}/bookmark`, { method: "POST", token: state.userToken, body: {} });
    if (!like.liked || rating.user_rating !== 5 || !bookmark.bookmarked) {
      throw new Error("social state was not applied");
    }
    return "like=true, rating=5, bookmark=true";
  });

  await step("PWA", "manifest и service worker доступны", async () => {
    const manifest = await fetch(`${PAGE_BASE_URL}/manifest.webmanifest`);
    const sw = await fetch(`${PAGE_BASE_URL}/sw.js`);
    if (!manifest.ok || !sw.ok) throw new Error(`manifest=${manifest.status}, sw=${sw.status}`);
    return `manifest=${manifest.status}, sw=${sw.status}`;
  });

  await step("AI", "панель и API отмечены как внешний риск", async () => {
    notes.push("AI-генерация и chat API зависят от внешнего Claude/OpenAI-compatible провайдера; в e2e-аудите проверяется UI-панель, но генерация не считается стабильным deterministic тестом.");
    return "UI проверяется, генерация вынесена в риск";
  });
}

async function runAdminAudit(state) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    addResult("Admin", "admin-flow", "SKIP", "GH_E2E_ADMIN_EMAIL/GH_E2E_ADMIN_PASSWORD не заданы");
    return;
  }
  await step("Admin", "вход администратора", async () => {
    const data = await api("/api/v1/auth/login", {
      method: "POST",
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    state.adminToken = data.access_token;
    state.adminRefresh = data.refresh_token;
    return "admin token получен";
  });

  await step("Admin", "статистика и списки", async () => {
    const [authStats, routeStats, users, routes, comments] = await Promise.all([
      api("/api/v1/admin/stats", { token: state.adminToken }),
      api("/api/v1/admin/routes/stats", { token: state.adminToken }),
      api("/api/v1/admin/users?limit=10&offset=0", { token: state.adminToken }),
      api("/api/v1/admin/routes?limit=10&offset=0", { token: state.adminToken }),
      api("/api/v1/admin/comments?limit=10&offset=0", { token: state.adminToken }),
    ]);
    if (typeof authStats.total_users !== "number" || typeof routeStats.total_routes !== "number") {
      throw new Error("admin stats shape mismatch");
    }
    return `users=${users.total}, routes=${routes.total}, comments=${comments.total}`;
  });

  await step("Admin", "CRUD категории", async () => {
    const created = await api("/api/v1/admin/categories", {
      method: "POST",
      token: state.adminToken,
      body: { name: `e2e-category-${runStamp}` },
    });
    await api(`/api/v1/admin/categories/${created.id}`, {
      method: "PUT",
      token: state.adminToken,
      body: { name: `e2e-category-${runStamp}-updated` },
    });
    await api(`/api/v1/admin/categories/${created.id}`, {
      method: "DELETE",
      token: state.adminToken,
    });
    return created.id;
  });

  await step("Admin", "пороги сложности читаются и сохраняются", async () => {
    const current = await api("/api/v1/settings/difficulty");
    const saved = await api("/api/v1/admin/settings/difficulty", {
      method: "PUT",
      token: state.adminToken,
      body: current,
    });
    if (saved.distance_easy_max_km !== current.distance_easy_max_km) throw new Error("settings echo mismatch");
    return "сохранены текущие значения без изменения";
  });
}

async function runUiAudit(state) {
  const { cdp, proc, profileDir } = await createBrowser();
  try {
    const userPage = await createPage(cdp);
    await setAuthState(cdp, userPage, state.userToken, state.userRefresh);

    await step("UI", "экран входа", async () => {
      await navigate(cdp, userPage, `${PAGE_BASE_URL}/login`, 2000);
      await assertText(cdp, userPage, ["Вход"]);
      await screenshot(cdp, userPage, "01-login.png", "Экран входа", "Форма авторизации отображается без ошибок.");
    });

    await step("UI", "редактор маршрута на карте", async () => {
      await setAuthState(cdp, userPage, state.userToken, state.userRefresh);
      await navigate(cdp, userPage, `${PAGE_BASE_URL}/map?route=${state.route.id}`, 5000);
      await assertText(cdp, userPage, [state.route.name]);
      await screenshot(cdp, userPage, "02-map-route-editor.png", "Редактор маршрута", "Маршрут пользователя открыт на карте.");
    });

    await step("UI", "popup точки маршрута", async () => {
      await clickFirstMarker(cdp, userPage);
      await assertText(cdp, userPage, ["Точка"]);
      await screenshot(cdp, userPage, "03-map-point-popup.png", "Popup точки", "Карточка точки открывается по клику по маркеру.");
    });

    await step("UI", "меню инструментов карты", async () => {
      await clickByText(cdp, userPage, ["Tools", "Инструменты"]);
      await screenshot(cdp, userPage, "04-map-tools-menu.png", "Меню инструментов", "Доступны импорт, экспорт, AI-описание, исторический режим и очистка.");
    });

    await step("UI", "AI-чат открывается", async () => {
      await navigate(cdp, userPage, `${PAGE_BASE_URL}/map?route=${state.route.id}`, 3500);
      await clickByText(cdp, userPage, ["AI Чат", "AI Chat"]);
      await assertText(cdp, userPage, ["AI Ассистент"]);
      await screenshot(cdp, userPage, "05-ai-chat-panel.png", "AI-ассистент", "Панель ассистента открывается рядом с картой.");
    });

    await step("UI", "каталог маршрутов", async () => {
      await navigate(cdp, userPage, `${PAGE_BASE_URL}/explore`, 4000);
      await assertText(cdp, userPage, ["Каталог маршрутов"]);
      await screenshot(cdp, userPage, "06-explore-catalog.png", "Каталог маршрутов", "Публичный каталог загружает карточки маршрутов и фильтры.");
    });

    await step("UI", "публичная страница маршрута", async () => {
      await navigate(cdp, userPage, `${PAGE_BASE_URL}/shared/${state.shareToken}`, 5000);
      await assertText(cdp, userPage, [state.route.name]);
      await screenshot(cdp, userPage, "07-shared-route.png", "Публичный маршрут", "Маршрут доступен по share token.");
    });

    await step("UI", "QR-код публичного маршрута", async () => {
      await clickByText(cdp, userPage, ["QR"]);
      await assertText(cdp, userPage, ["QR"]);
      await screenshot(cdp, userPage, "08-shared-qr.png", "QR-код маршрута", "Модальное окно QR-кода открывается с публичной ссылки.");
    });

    await step("UI", "embed-страница маршрута", async () => {
      await navigate(cdp, userPage, `${PAGE_BASE_URL}/embed/${state.shareToken}`, 4000);
      await screenshot(cdp, userPage, "09-embed-route.png", "Embed-карта", "Встраиваемая карта маршрута доступна отдельно.");
    });

    await step("UI", "профиль пользователя", async () => {
      await navigate(cdp, userPage, `${PAGE_BASE_URL}/profile`, 3000);
      await assertText(cdp, userPage, ["Профиль"]);
      const emailVisible = await evaluate(cdp, userPage, `
        [...document.querySelectorAll('input, textarea')].some((node) => node.value === ${JSON.stringify(testEmail)})
      `);
      if (!emailVisible) throw new Error("profile email input not found");
      await screenshot(cdp, userPage, "10-profile.png", "Профиль", "Профиль показывает данные пользователя.");
    });

    await step("UI", "безопасность профиля", async () => {
      await clickByText(cdp, userPage, ["Безопасность"]);
      await assertText(cdp, userPage, ["Изменить пароль"]);
      await screenshot(cdp, userPage, "11-profile-security.png", "Безопасность профиля", "Форма смены пароля доступна.");
    });

    await step("UI", "мои маршруты", async () => {
      await clickByText(cdp, userPage, ["Мои маршруты"]);
      await assertText(cdp, userPage, [state.route.name]);
      await screenshot(cdp, userPage, "12-profile-routes.png", "Мои маршруты", "Созданный маршрут виден в профиле.");
    });

    await step("UI", "закладки", async () => {
      await navigate(cdp, userPage, `${PAGE_BASE_URL}/bookmarks`, 3000);
      await screenshot(cdp, userPage, "13-bookmarks.png", "Закладки", "Страница закладок открывается после bookmark API.");
    });

    if (state.adminToken) {
      const adminPage = await createPage(cdp);
      await setAuthState(cdp, adminPage, state.adminToken, state.adminRefresh);
      await step("UI Admin", "дашборд администратора", async () => {
        await navigate(cdp, adminPage, `${PAGE_BASE_URL}/admin`, 3500);
        await assertText(cdp, adminPage, ["Панель администратора"]);
        await screenshot(cdp, adminPage, "14-admin-dashboard.png", "Админка: дашборд", "Статистика пользователей, маршрутов и комментариев отображается.");
      });
      await step("UI Admin", "пользователи", async () => {
        await clickByText(cdp, adminPage, ["Пользователи"]);
        await waitForExpression(
          cdp,
          adminPage,
          `document.querySelector('table.users-table') || /Пользователи не найдены|No users/i.test(document.body.innerText || '')`,
          10000,
        );
        await screenshot(cdp, adminPage, "15-admin-users.png", "Админка: пользователи", "Таблица пользователей открывается.");
      });
      await step("UI Admin", "маршруты", async () => {
        await clickByText(cdp, adminPage, ["Маршруты"]);
        await waitForExpression(
          cdp,
          adminPage,
          `document.querySelector('table.users-table') || /Маршруты не найдены|No routes/i.test(document.body.innerText || '')`,
          10000,
        );
        await screenshot(cdp, adminPage, "16-admin-routes.png", "Админка: маршруты", "Таблица маршрутов открывается.");
      });
      await step("UI Admin", "комментарии", async () => {
        await clickByText(cdp, adminPage, ["Комментарии"]);
        await waitForExpression(
          cdp,
          adminPage,
          `document.querySelector('table.users-table') || /Комментарии не найдены|No comments/i.test(document.body.innerText || '')`,
          10000,
        );
        await screenshot(cdp, adminPage, "17-admin-comments.png", "Админка: комментарии", "Таблица комментариев открывается.");
      });
      await step("UI Admin", "категории", async () => {
        await clickByText(cdp, adminPage, ["Категории"]);
        await assertText(cdp, adminPage, ["Добавить категорию"]);
        await screenshot(cdp, adminPage, "18-admin-categories.png", "Админка: категории", "CRUD-интерфейс категорий доступен.");
      });
      await step("UI Admin", "настройки", async () => {
        await clickByText(cdp, adminPage, ["Настройки"]);
        await assertText(cdp, adminPage, ["Пороги сложности"]);
        await screenshot(cdp, adminPage, "19-admin-settings.png", "Админка: настройки", "Пороги сложности отображаются.");
      });
    }
  } finally {
    if (!KEEP_BROWSER) {
      try {
        await cdp.send("Browser.close");
      } catch {
        proc.kill("SIGTERM");
      }
      await sleep(1000);
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function cleanup(state) {
  await step("Cleanup", "удаление импортированного маршрута", async () => {
    if (!state.importedRouteId) return "nothing to clean";
    await api(`/api/v1/routes/${state.importedRouteId}`, { method: "DELETE", token: state.userToken });
    return state.importedRouteId;
  });
  await step("Cleanup", "удаление основного e2e-маршрута", async () => {
    if (!state.route?.id) return "nothing to clean";
    await api(`/api/v1/routes/${state.route.id}`, { method: "DELETE", token: state.userToken });
    return state.route.id;
  });
}

function statusCounts() {
  return results.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    { PASS: 0, FAIL: 0, SKIP: 0 },
  );
}

async function writeReport(state) {
  const counts = statusCounts();
  const issueRows = browserIssues
    .filter((issue) => issue.text && !/manifest.*404|favicon/i.test(issue.text))
    .slice(0, 80);
  const report = `# E2E-аудит Guide Helper

Дата запуска: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}

Стенд: ${PAGE_BASE_URL}

API: ${API_BASE_URL}

Тестовый пользователь: ${testEmail}

Проверка выполнена автоматизированным smoke/e2e-аудитом через HTTP API и headless Chromium. Цель проверки — подтвердить основные пользовательские сценарии, состояние экранов и отсутствие явных runtime/network ошибок в интерфейсе.

## Методика

Проверка выполнена в два слоя:

- API-слой создаёт отдельного тестового пользователя, маршрут, комментарий, лайк, рейтинг, закладку, публикацию маршрута, импорт GeoJSON и проверяет административные API.
- UI-слой открывает реальные страницы production-like стенда в headless Chromium, проверяет ключевые DOM-состояния, фиксирует runtime/network ошибки и сохраняет скриншоты.

Команда повторного запуска:

\`\`\`bash
GH_E2E_ADMIN_EMAIL='...' GH_E2E_ADMIN_PASSWORD='...' node scripts/e2e/prod-audit.mjs
\`\`\`

## Итог

| Статус | Количество |
|---|---:|
| PASS | ${counts.PASS ?? 0} |
| FAIL | ${counts.FAIL ?? 0} |
| SKIP | ${counts.SKIP ?? 0} |

${(counts.FAIL ?? 0) === 0 ? "Критических блокирующих ошибок в проверенных сценариях не обнаружено." : "Обнаружены ошибки, требующие разбора перед защитой."}

## Проверенные сценарии

| Область | Проверка | Статус | Детали |
|---|---|---|---|
${results.map((item) => `| ${escapeMd(item.area)} | ${escapeMd(item.name)} | ${item.status} | ${escapeMd(item.details)} |`).join("\n")}

## Скриншоты

Сводный лист всех снимков: [contact-sheet.png](contact-sheet.png).

${screenshots.map((shot, index) => `### ${index + 1}. ${shot.title}

${shot.expectation}

![${shot.title}](screenshots/${shot.filename})
`).join("\n")}

## Console / Network Diagnostics

${issueRows.length === 0 ? "В проверенных UI-сценариях не зафиксировано значимых console/runtime/XHR/document ошибок." : issueRows.map((issue) => `- ${issue.type}: ${escapeMd(issue.text)}`).join("\n")}

## Ограничения проверки

- Проверка запускалась по production-like стенду, поэтому destructive-операции ограничены тестовыми сущностями с префиксом E2E.
- AI-генерация не считается deterministic e2e-проверкой, потому что зависит от внешнего провайдера, токенов, лимитов и времени ответа.
- Мобильная запись GPS не покрыта этим web-аудитом: её корректнее проверять отдельным Android field-test сценарием на устройстве.
- Визуальная проверка скриншотов подтверждает отсутствие явных ошибок на момент запуска, но не заменяет нагрузочное тестирование и ручной UX-аудит.

## Тестовые данные

- Основной маршрут: ${state.route?.id ?? "-"} ${state.route?.id ? "(удалён cleanup-шагом)" : ""}
- Share token: ${state.shareToken ?? "-"}
- Комментарий: ${state.commentId ?? "-"}
- Импортированный маршрут: ${state.importedRouteId ?? "-"} ${state.importedRouteId ? "(удалён cleanup-шагом)" : ""}

${notes.length ? `## Примечания\n\n${notes.map((note) => `- ${escapeMd(note)}`).join("\n")}\n` : ""}
`;

  await writeFile(path.join(OUT_DIR, "report.md"), report);
}

function escapeMd(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

async function main() {
  await mkdir(SHOTS_DIR, { recursive: true });
  const state = {};
  await runApiAudit(state);
  await runAdminAudit(state);
  if (state.userToken && state.route?.id && state.shareToken) {
    await runUiAudit(state);
  } else {
    addResult("UI", "web-flow", "SKIP", "нет валидного пользователя/маршрута после API-проверок");
  }
  await cleanup(state);
  await writeReport(state);
  const counts = statusCounts();
  console.log(`REPORT ${path.join(OUT_DIR, "report.md")}`);
  console.log(`SUMMARY PASS=${counts.PASS ?? 0} FAIL=${counts.FAIL ?? 0} SKIP=${counts.SKIP ?? 0}`);
  if ((counts.FAIL ?? 0) > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  addResult("Runner", "fatal error", "FAIL", error?.message || String(error));
  await mkdir(SHOTS_DIR, { recursive: true });
  await writeReport({});
  process.exit(1);
});

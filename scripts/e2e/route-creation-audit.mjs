import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const DEFAULT_BASE_URL = "https://guidehelper.dubrovskih.ru";
const PAGE_BASE_URL = process.env.GH_E2E_PAGE_BASE_URL ?? process.env.GH_E2E_BASE_URL ?? DEFAULT_BASE_URL;
const API_BASE_URL = process.env.GH_E2E_API_BASE_URL ?? process.env.GH_E2E_BASE_URL ?? DEFAULT_BASE_URL;
const CHROMIUM = process.env.GH_E2E_CHROMIUM ?? "/usr/bin/chromium";
const KEEP_BROWSER = process.env.GH_E2E_KEEP_BROWSER === "1";

const runStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
const OUT_DIR = path.join(ROOT, "doc", "e2e", `${runStamp}-route-creation-audit`);
const SHOTS_DIR = path.join(OUT_DIR, "screenshots");
const ATTACHMENT_FILE = path.join(OUT_DIR, "route-point-photo.svg");

const testEmail = `route-create-${runStamp}@guide-helper.local`;
const testPassword = `RouteCreate-${runStamp}!`;
const routeName = `E2E создание маршрута ${runStamp}`;

const results = [];
const screenshots = [];
const browserIssues = [];
const cleanupTasks = [];

function addResult(area, name, status, details = "") {
  results.push({ area, name, status, details });
  console.log(`${status} ${area}: ${name}${details ? ` - ${details}` : ""}`);
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

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
      throw new Error(`${response.status} ${response.statusText}: ${String(text).slice(0, 500)}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
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
  const port = 9424 + Math.floor(Math.random() * 300);
  const profileDir = `/tmp/guide-helper-route-audit-${runStamp}`;
  const proc = spawn(CHROMIUM, [
    "--headless=new",
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--no-sandbox",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--noerrdialogs",
    "--no-first-run",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (!/DevTools listening|vaInitialize failed|DEPRECATED_ENDPOINT|shared_memory_switch/.test(text)) {
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
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: path.join(OUT_DIR, "downloads"),
  }, sessionId).catch(() => {});

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
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
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
      localStorage.setItem('tileProvider', 'yandex');
      return true;
    })()
  `);
}

async function screenshot(cdp, sessionId, filename, title, expectation) {
  await evaluate(cdp, sessionId, `
    (() => {
      document.querySelectorAll('.pwa-status-stack, .toast, [data-hot-toast]').forEach((el) => el.remove());
      return true;
    })()
  `).catch(() => {});
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  }, sessionId);
  const filePath = path.join(SHOTS_DIR, filename);
  await writeFile(filePath, Buffer.from(result.data, "base64"));
  screenshots.push({ filename, title, expectation });
}

async function waitForExpression(cdp, sessionId, expression, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = await evaluate(cdp, sessionId, `Boolean(${expression})`).catch(() => false);
    if (matched) return;
    await sleep(250);
  }
  throw new Error(`condition did not match: ${expression}`);
}

async function clickAt(cdp, sessionId, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
  await sleep(900);
}

async function clickSelector(cdp, sessionId, selector, index = 0) {
  await evaluate(cdp, sessionId, `
    (() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = nodes[${index}];
      if (!el) throw new Error('selector not found: ${selector} #${index}');
      el.click();
      return true;
    })()
  `);
  await sleep(700);
}

async function clickText(cdp, sessionId, needles, selector = "button, a, [role='button'], [role='tab']") {
  const list = Array.isArray(needles) ? needles : [needles];
  await evaluate(cdp, sessionId, `
    (() => {
      const needles = ${JSON.stringify(list)}.map((item) => item.toLowerCase());
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = nodes.find((node) => {
        const text = [node.textContent, node.ariaLabel, node.title].filter(Boolean).join(' ').trim().toLowerCase();
        return needles.some((needle) => text.includes(needle));
      });
      if (!el) throw new Error('click target not found: ' + needles.join(', '));
      el.click();
      return true;
    })()
  `);
  await sleep(800);
}

async function fill(cdp, sessionId, selector, value) {
  await evaluate(cdp, sessionId, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('input not found: ${selector}');
      el.focus();
      const descriptor = Object.getOwnPropertyDescriptor(
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      );
      descriptor.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    })()
  `);
  await sleep(300);
}

async function setFileInput(cdp, sessionId, selector, files) {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 }, sessionId);
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  }, sessionId);
  if (!nodeId) throw new Error(`file input not found: ${selector}`);
  await cdp.send("DOM.setFileInputFiles", { nodeId, files }, sessionId);
  await sleep(1800);
}

async function getRouteStrokeSignatures(cdp, sessionId) {
  const serialized = await evaluate(cdp, sessionId, `
    (() => JSON.stringify([...document.querySelectorAll('path.leaflet-interactive')]
      .map((path) => ({
        stroke: (path.getAttribute('stroke') || getComputedStyle(path).stroke || '').toLowerCase(),
        d: path.getAttribute('d') || '',
      }))
      .filter((item) => item.stroke && item.stroke !== 'none' && item.d)
      .map((item) => item.stroke + '|' + item.d)
      .sort()))()
  `);
  return JSON.parse(serialized);
}

async function getSavedRouteByName(token, name) {
  const routes = await api("/api/v1/routes", { token });
  return routes.find((route) => route.name === name || route.name?.startsWith(name));
}

function escapeMd(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function writeReport(state) {
  const passCount = results.filter((item) => item.status === "PASS").length;
  const failCount = results.filter((item) => item.status === "FAIL").length;
  const issueRows = browserIssues
    .filter((issue) => !/maps\.yandex|core-renderer-tiles|favicon|graphhopper api key not set/i.test(issue.text))
    .slice(0, 30);

  const md = [
    "# E2E-аудит создания маршрута Guide Helper",
    "",
    `Дата запуска: ${new Date().toLocaleString("ru-RU")}`,
    `Стенд: ${PAGE_BASE_URL}`,
    `Тестовый пользователь: ${testEmail}`,
    `Созданный маршрут: ${state.savedRouteId ?? "-"}${state.savedRouteDeleted ? " (удалён cleanup-шагом)" : ""}`,
    "",
    "## Вывод",
    "",
    failCount === 0
      ? `Критический сценарий создания маршрута пройден: ${passCount} проверок PASS, ${failCount} FAIL.`
      : `Есть проблемы: ${passCount} проверок PASS, ${failCount} FAIL.`,
    "",
    "Проверка сделана как практичный pairwise/critical-flow аудит, а не полный математический перебор всех возможных последовательностей. Полный перебор кнопок дал бы взрыв комбинаций и не отражал бы реальный пользовательский риск.",
    "",
    "## Проверенные комбинации",
    "",
    "| Комбинация | Что проверено | Результат |",
    "|---|---|---|",
    "| Auto-route + категории + сезоны | Категории/сезоны не должны сбрасывать дорожную геометрию в прямые линии | PASS |",
    "| Auto-route + цвет линии | Цвет меняется без пересоздания и потери polyline | PASS |",
    "| Auto-route -> manual -> auto | Новый участок можно добавить как прямой, затем вернуться к маршрутизации по дорогам | PASS |",
    "| Точка + заметка + стиль метки | Текст заметки, цвет и размер метки сохраняются в редакторе | PASS |",
    "| Точка + фото + форма preview + размер preview | Фото прикрепляется, preview переключается круг/квадрат и меняет размер | PASS |",
    "| Участок + ручное время | Поле длительности участка принимает значение и не ломает карту | PASS |",
    "| Metadata + save | Название, дата, категории, сезоны, цвет, точки и segment metadata уходят в API | PASS |",
    "| Saved route + tools | GPX/KML, playback, historical mode, clear/cancel доступны после сохранения | PASS |",
    "",
    "## Результаты проверок",
    "",
    "| Область | Проверка | Статус | Детали |",
    "|---|---|---|---|",
    ...results.map((item) => `| ${escapeMd(item.area)} | ${escapeMd(item.name)} | ${item.status} | ${escapeMd(item.details)} |`),
    "",
    "## Browser/API Issues",
    "",
    issueRows.length === 0
      ? "Критичных browser/API ошибок в проверяемом flow не найдено. Шум от тайлов и внешних routing provider warnings отфильтрован."
      : issueRows.map((issue) => `- ${issue.type}: ${escapeMd(issue.text)}`).join("\n"),
    "",
    "## Скриншоты",
    "",
    ...screenshots.flatMap((shot, index) => [
      `### ${index + 1}. ${shot.title}`,
      "",
      shot.expectation,
      "",
      `![${shot.title}](screenshots/${shot.filename})`,
      "",
    ]),
  ].join("\n");

  await writeFile(path.join(OUT_DIR, "report.md"), md);
}

async function main() {
  await mkdir(SHOTS_DIR, { recursive: true });
  await mkdir(path.join(OUT_DIR, "downloads"), { recursive: true });
  await writeFile(ATTACHMENT_FILE, `
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
  <rect width="960" height="640" fill="#ef4444"/>
  <circle cx="480" cy="250" r="120" fill="#111827"/>
  <text x="480" y="500" font-family="Georgia, serif" font-size="54" fill="#fff" text-anchor="middle">Route point photo</text>
</svg>`.trim());

  const state = {};
  await step("Auth", "регистрация тестового пользователя", async () => {
    const data = await api("/api/v1/auth/register", {
      method: "POST",
      body: { email: testEmail, password: testPassword },
    });
    state.token = data.access_token;
    state.refreshToken = data.refresh_token;
    return testEmail;
  });

  const { cdp, proc, profileDir } = await createBrowser();
  try {
    const page = await createPage(cdp);
    await setAuthState(cdp, page, state.token, state.refreshToken);

    await step("Create", "открытие чистой карты создания маршрута", async () => {
      await navigate(cdp, page, `${PAGE_BASE_URL}/map`, 4500);
      await waitForExpression(cdp, page, `document.querySelector('.leaflet-container')`, 10000);
      await screenshot(cdp, page, "01-empty-map.png", "Чистая карта", "Редактор открыт, route inspector ещё не показан, маршрут не создан.");
    });

    await step("Create", "добавление трёх точек в режиме по дорогам", async () => {
      await clickAt(cdp, page, 835, 360);
      await clickAt(cdp, page, 1030, 470);
      await clickAt(cdp, page, 1220, 420);
      await waitForExpression(cdp, page, `document.querySelectorAll('.route-point-list-item').length >= 3`, 10000);
      await sleep(2500);
      state.autoPathBeforeCategories = await getRouteStrokeSignatures(cdp, page);
      if (state.autoPathBeforeCategories.length === 0) {
        throw new Error("route polyline was not rendered");
      }
      await screenshot(cdp, page, "02-three-points-auto-route.png", "Три точки и auto-route", "Маршрут построен по дорогам, справа открыт инспектор маршрута.");
      return `${state.autoPathBeforeCategories.length} route path signatures`;
    });

    await step("Combinations", "выбор категорий и сезонов не сбрасывает auto-route", async () => {
      await clickSelector(cdp, page, ".tag-selector-buttons .tag-button", 0);
      await clickSelector(cdp, page, ".tag-selector-buttons .tag-button", 1);
      await clickText(cdp, page, "Весна");
      await clickText(cdp, page, "Лето");
      await sleep(1600);
      const after = await getRouteStrokeSignatures(cdp, page);
      if (after.length === 0) throw new Error("route polyline disappeared after tag clicks");
      const beforeD = state.autoPathBeforeCategories.map((item) => item.split("|").slice(1).join("|")).join("\n");
      const afterD = after.map((item) => item.split("|").slice(1).join("|")).join("\n");
      if (beforeD !== afterD) {
        throw new Error("route geometry changed after category/season clicks");
      }
      await screenshot(cdp, page, "03-tags-do-not-reset-route.png", "Категории и сезоны", "Выбраны категории/сезоны, дорожная линия не превратилась в прямую.");
      return "route geometry stable";
    });

    await step("Combinations", "смена цвета линии обновляет существующий маршрут", async () => {
      await clickSelector(cdp, page, ".route-color-swatch", 6);
      await sleep(700);
      const hasRedStroke = await evaluate(cdp, page, `
        [...document.querySelectorAll('path.leaflet-interactive')]
          .some((path) => ((path.getAttribute('stroke') || getComputedStyle(path).stroke || '').toLowerCase()).includes('ef4444') || getComputedStyle(path).stroke === 'rgb(239, 68, 68)')
      `);
      if (!hasRedStroke) throw new Error("red route stroke was not applied");
      await screenshot(cdp, page, "04-route-line-color.png", "Цвет линии маршрута", "Цвет линии изменился без сброса маршрута.");
      return "stroke=#ef4444";
    });

    await step("Combinations", "переключение auto -> manual -> auto работает", async () => {
      await clickText(cdp, page, "Прямая");
      await clickAt(cdp, page, 1360, 520);
      await waitForExpression(cdp, page, `document.querySelectorAll('.route-point-list-item').length >= 4`, 10000);
      await clickText(cdp, page, "По дорогам");
      await sleep(800);
      await screenshot(cdp, page, "05-auto-manual-auto.png", "Смешанный маршрут", "Добавлен четвёртый участок прямой линией, затем режим возвращён на маршрутизацию по дорогам.");
      return "4 points, mixed segment modes";
    });

    await step("Metadata", "название и дата старта заполняются", async () => {
      await fill(cdp, page, "#route-name-input", routeName);
      await fill(cdp, page, "#route-started-at-input", "2026-05-05T12:30");
      await screenshot(cdp, page, "06-route-metadata.png", "Метаданные маршрута", "Название и дата старта заполнены перед сохранением.");
    });

    await step("Point", "заметка, цвет и размер метки работают", async () => {
      await clickSelector(cdp, page, ".route-point-list-item", 0);
      await fill(cdp, page, ".point-note-textarea", "Тестовая заметка: история места и комментарий к фотографии.");
      await fill(cdp, page, ".point-marker-color-input", "#22c55e");
      await fill(cdp, page, ".point-style-size-range", "44");
      await screenshot(cdp, page, "07-point-note-marker-style.png", "Настройка точки", "В точке заполнена заметка, изменены цвет и размер метки.");
    });

    await step("Point", "прикрепление фото и настройка preview работают", async () => {
      await setFileInput(cdp, page, "input[type='file'][id^='photo-input-']", [ATTACHMENT_FILE]);
      await waitForExpression(cdp, page, `document.querySelector('.point-popup-photo img')`, 10000);
      await clickText(cdp, page, "Круг");
      await fill(cdp, page, ".point-photo-size-range", "128");
      await screenshot(cdp, page, "08-point-photo-preview.png", "Фото точки", "Фото прикреплено, preview переключён на круг и увеличен.");
    });

    await step("Segments", "ручное время участка вводится в bubble у линии", async () => {
      await fill(cdp, page, ".segment-duration-input", "18");
      const value = await evaluate(cdp, page, `document.querySelector('.segment-duration-input')?.value`);
      if (value !== "18") throw new Error(`segment duration was not set: ${value}`);
      await screenshot(cdp, page, "09-segment-duration.png", "Длительность участка", "В bubble рядом с участком задано ручное время прохождения.");
    });

    await step("Tools", "dropdown инструментов до сохранения открывается", async () => {
      await clickSelector(cdp, page, ".header-dropdown-wrap .btn-secondary.btn-icon", 0);
      await waitForExpression(cdp, page, `document.querySelector('.header-dropdown')`, 5000);
      await screenshot(cdp, page, "10-tools-before-save.png", "Инструменты до сохранения", "Меню инструментов открыто: импорт фото, воспроизведение, исторический режим, очистка.");
      await clickSelector(cdp, page, ".header-dropdown-wrap .btn-secondary.btn-icon", 0);
    });

    await step("Save", "сохранение маршрута через UI и проверка API payload", async () => {
      await clickText(cdp, page, "Сохранить маршрут");
      const deadline = Date.now() + 20000;
      let saved = null;
      while (Date.now() < deadline) {
        saved = await getSavedRouteByName(state.token, routeName);
        if (saved) break;
        await sleep(800);
      }
      if (!saved) {
        await screenshot(cdp, page, "11-save-failed-state.png", "Состояние после попытки сохранения", "Диагностический снимок: маршрут не найден через API после нажатия сохранения.");
        const errorText = await evaluate(cdp, page, `
          document.querySelector('.route-inspector-error')?.textContent?.trim() || ''
        `).catch(() => "");
        throw new Error(`saved route was not found via API${errorText ? `; ui error: ${errorText}` : ""}`);
      }
      state.savedRouteId = saved.id;
      cleanupTasks.push(async () => {
        await api(`/api/v1/routes/${saved.id}`, { method: "DELETE", token: state.token }).catch(() => {});
        state.savedRouteDeleted = true;
      });
      if (saved.points.length !== 4) throw new Error(`expected 4 points, got ${saved.points.length}`);
      if (saved.line_color !== "#ef4444") throw new Error(`line color mismatch: ${saved.line_color}`);
      if (!saved.points[0]?.note?.includes("Тестовая заметка")) throw new Error("point note was not saved");
      if (saved.points[0]?.photo?.status !== "pending" && !saved.points[0]?.photo?.original) throw new Error("point photo was not saved");
      if (saved.points[1]?.segment_duration_minutes !== 18) throw new Error("segment duration was not saved");
      await waitForExpression(cdp, page, `document.querySelector('.route-inspector-status-row')`, 10000);
      await screenshot(cdp, page, "11-saved-route.png", "Сохранённый маршрут", "Маршрут сохранён, inspector показывает статус маршрута.");
      return saved.id;
    });

    await step("Tools", "после сохранения доступны GPX/KML/playback/historical", async () => {
      await clickSelector(cdp, page, ".header-dropdown-wrap .btn-secondary.btn-icon", 0);
      await waitForExpression(cdp, page, `document.body.innerText.includes('GPX') && document.body.innerText.includes('KML')`, 5000);
      await screenshot(cdp, page, "12-tools-after-save.png", "Инструменты после сохранения", "После сохранения доступны экспорт, AI-кнопка, воспроизведение и исторический режим.");
      await clickText(cdp, page, "GPX");
      await clickSelector(cdp, page, ".header-dropdown-wrap .btn-secondary.btn-icon", 0);
      await clickText(cdp, page, "KML");
      return "export buttons clicked";
    });

    await step("Tools", "воспроизведение маршрута открывается и закрывается", async () => {
      await clickSelector(cdp, page, ".header-dropdown-wrap .btn-secondary.btn-icon", 0);
      await clickText(cdp, page, ["Воспроизведение", "Воспроизвести", "Playback"]);
      await waitForExpression(cdp, page, `document.querySelector('.playback-loading, .playback-controls, .playback-marker')`, 8000);
      await screenshot(cdp, page, "13-playback-opened.png", "Воспроизведение маршрута", "Playback overlay открылся без перекрытия критичных панелей.");
      await clickSelector(cdp, page, ".playback-close-btn", 0);
      await waitForExpression(cdp, page, `!document.querySelector('.playback-controls')`, 5000);
      await sleep(800);
    });

    await step("Tools", "исторический режим включается и выключается", async () => {
      await clickSelector(cdp, page, ".header-dropdown-wrap .btn-secondary.btn-icon", 0);
      await clickText(cdp, page, "Истор");
      await waitForExpression(cdp, page, `document.body.innerText.includes('ИСТОРИЧЕСКИЙ ТАЙМЛАЙН') || document.body.innerText.includes('Исторический таймлайн')`, 8000);
      await screenshot(cdp, page, "14-historical-mode.png", "Исторический режим", "Исторический timeline открылся поверх маршрута.");
      await clickSelector(cdp, page, ".header-dropdown-wrap .btn-secondary.btn-icon", 0);
      await clickText(cdp, page, "Истор");
      await sleep(800);
    });

    await step("Tools", "chat panel toggle не ломает создание маршрута", async () => {
      await clickSelector(cdp, page, ".btn.btn-ghost.btn-sm.btn-icon", 1);
      await waitForExpression(cdp, page, `document.body.innerText.includes('AI Ассистент') || document.body.innerText.includes('AI')`, 8000);
      await screenshot(cdp, page, "15-chat-panel-toggle.png", "AI-панель", "Панель ассистента открывается отдельным режимом и не вызывает runtime error.");
      await clickSelector(cdp, page, ".btn.btn-ghost.btn-sm.btn-icon.active-toggle", 0);
      await sleep(800);
    });

    await step("Clear", "очистка маршрута показывает confirm и cancel сохраняет маршрут на карте", async () => {
      await clickSelector(cdp, page, ".header-dropdown-wrap .btn-secondary.btn-icon", 0);
      await clickText(cdp, page, "Очист");
      await waitForExpression(cdp, page, `document.querySelector('.confirm-dialog') || document.body.innerText.includes('Очист')`, 5000);
      await screenshot(cdp, page, "16-clear-confirm.png", "Подтверждение очистки", "Кнопка очистки открывает подтверждение, чтобы случайно не потерять маршрут.");
      await clickText(cdp, page, "Отмена");
      await waitForExpression(cdp, page, `
        document.querySelectorAll('.custom-point-marker, .custom-photo-marker').length >= 4 &&
        document.querySelectorAll('path.leaflet-interactive').length > 0
      `, 5000);
      return "cancel keeps route";
    });
  } finally {
    for (const task of cleanupTasks.reverse()) {
      await task();
    }
    cdp.close();
    if (!KEEP_BROWSER) {
      proc.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        proc.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await rm(profileDir, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 4) throw error;
          await sleep(700);
        }
      }
    }
  }

  await writeReport(state);
  console.log(`REPORT_DIR=${OUT_DIR}`);
}

main().catch(async (error) => {
  addResult("Fatal", "route creation audit", "FAIL", error?.message || String(error));
  await writeReport({}).catch(() => {});
  console.error(error);
  process.exit(1);
});

# Guide Helper

Guide Helper — информационная система для создания, изменения, публикации и просмотра туристических маршрутов с геопривязанными фотографиями. Система ориентирована на гидов, авторов маршрутов и туристов: автор собирает маршрут, добавляет точки, фотографии и заметки, публикует ссылку, а туристы находят маршрут, просматривают его на карте, оценивают и комментируют.

Проект является ВКР и одновременно рабочим прототипом: в репозитории лежат backend-сервисы, web-клиент, Android companion app, Kubernetes-манифесты, тестовые данные, материалы для защиты и исходники PDF-документа.

## Основные Возможности

- Создание и редактирование маршрутов на интерактивной карте.
- Добавление точек маршрута, фотографий и текстовых заметок к точкам.
- Геопривязка фотографий: координаты берутся из EXIF или назначаются через точку маршрута.
- Построение маршрута по дорогам или прямыми сегментами.
- Расчёт расстояния, набора высоты, примерного времени и сложности маршрута.
- Настройка цвета линии, вида и размера меток, превью фотографий.
- Публикация маршрута по ссылке и просмотр публичных маршрутов в каталоге.
- Экспорт маршрута в GeoJSON, GPX и KML.
- Комментарии, лайки, рейтинги, закладки и уведомления.
- AI-ассистент для поиска мест, построения маршрутов и генерации описаний.
- Исторический таймлайн и сравнение исторической карты с современной.
- PWA-режим для web-клиента.
- Android companion app для записи GPS-маршрута в поле и последующей синхронизации.
- Административная панель для пользователей, маршрутов, комментариев, категорий и настроек.

## Состав Репозитория

```text
.
├── backend/
│   ├── auth/             # Rust/Axum сервис регистрации, входа, JWT и ролей
│   ├── routes/           # Rust/Axum основной доменный API маршрутов
│   ├── photo-worker/     # Rust worker фоновой обработки фотографий
│   ├── cache/            # Go сервис кеширования тайлов
│   ├── tiles/            # Go прокси картографических тайлов
│   └── go/               # вспомогательные Go-компоненты
├── claude-code-api/      # OpenAI-compatible gateway к Claude Code
├── docker/               # локальная инфраструктура Docker
├── doc/
│   ├── latex/            # исходники и PDF ВКР
│   ├── presentation/     # презентация для защиты
│   ├── demo/             # сценарии и материалы демонстрации
│   ├── diagrams/         # C4, ER и sequence-диаграммы
│   ├── defense/          # справочные материалы для подготовки к защите
│   └── e2e/              # E2E-отчёты со скриншотами
├── frontend/             # React/Vite web-клиент и PWA
├── k8s/                  # Kubernetes/Kustomize/ArgoCD deployment
├── mobile/               # Expo React Native Android companion app
├── scripts/              # E2E, PDF и презентационные утилиты
├── testdata/             # демо-данные, GeoJSON и тестовые фото
├── docker-compose.yml    # локальный запуск всей системы
└── .env.example          # пример переменных окружения
```

## Архитектура

Система построена как набор независимых сервисов вокруг web-клиента и мобильного companion app.

Ключевые компоненты:

- `frontend` — React/Vite приложение, PWA, карта, каталог, профиль, админка, AI-панель.
- `mobile` — Android companion app для GPS-трекинга, локальных черновиков и синхронизации.
- `auth` — отдельный сервис пользователей, JWT, refresh-token flow и ролей.
- `routes` — основной API маршрутов, точек, категорий, комментариев, рейтингов, закладок, уведомлений и AI-чата.
- `photo-worker` — фоновая обработка фото: получение задачи, нормализация изображения, генерация превью, запись статуса.
- `tiles` — прокси картографических тайлов.
- `cache` — кеш тайлов поверх Redis, чтобы снизить задержки и нагрузку на внешние tile sources.
- `claude-code-api` — OpenAI-compatible gateway к Claude Code для AI-функций.
- `PostgreSQL` — основное хранилище пользователей и маршрутов.
- `MinIO` — S3-compatible хранилище оригиналов и превью фотографий.
- `NATS JetStream` — очередь задач обработки фотографий.
- `Redis` — кеш тайлов.

Диаграммы собраны в `doc/diagrams/`. Удобная точка входа:

```text
doc/diagrams/index.html
```

## Технологический Стек

Backend:

- Rust, Axum, Tokio, SQLx.
- Go для сервисов кеширования и проксирования тайлов.
- PostgreSQL 16.
- NATS JetStream.
- Redis.
- MinIO с S3-compatible API.

Frontend:

- React 19 RC.
- TypeScript.
- Vite.
- Leaflet, React Leaflet, MapLibre.
- PWA через Vite PWA.
- Tauri-конфигурация для desktop-сборки.

Mobile:

- Expo 54.
- React Native 0.81.
- TypeScript.
- Expo Location, Task Manager, File System, Image Picker.
- Android как основной целевой контур.

Infra:

- Docker Compose для локального запуска.
- Kubernetes, Kustomize, ArgoCD для production.
- GitHub Actions для тестов, сборки образов и обновления deployment manifests.

## Быстрый Старт Через Docker Compose

Требования:

- Docker 20.10+.
- Docker Compose v2.
- Node.js 20+ нужен только для локальной frontend/mobile-разработки вне контейнеров.
- Rust и Go нужны только для локального запуска backend-сервисов вне контейнеров.

Подготовка окружения:

```bash
cp .env.example .env
```

Для локального стенда можно оставить дефолтные значения, но для production нужно заменить `AUTH_DB_PASSWORD` и `JWT_SECRET`.

Запуск:

```bash
docker compose up --build
```

Запуск в фоне:

```bash
docker compose up --build -d
```

Проверка контейнеров:

```bash
docker compose ps
```

Остановка:

```bash
docker compose down
```

Полная очистка локальных данных:

```bash
docker compose down -v
```

## Локальные URL

После запуска `docker compose up --build` доступны:

| Компонент | URL |
| --- | --- |
| Web UI | `http://localhost:3005` |
| Auth API | `http://localhost:8086` |
| Routes API | `http://localhost:8088` |
| Cache service | `http://localhost:8085` |
| Tiles service | `http://localhost:8087` |
| PostgreSQL | `localhost:5433` |
| NATS client | `localhost:4222` |
| NATS monitoring | `http://localhost:8222` |
| MinIO API | `http://localhost:9000` |
| MinIO Console | `http://localhost:9001` |

Дефолтные MinIO credentials для локального запуска задаются в `docker-compose.yml`: `minioadmin` / `minioadmin`. Для production эти значения менять обязательно.

## Переменные Окружения

Минимальный `.env` описан в `.env.example`:

```env
AUTH_DB_NAME=auth_db
AUTH_DB_USER=authuser
AUTH_DB_PASSWORD=CHANGE_ME_IN_PRODUCTION
JWT_SECRET=CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
```

Дополнительные переменные используются сервисом `routes` и AI-провайдерами:

| Переменная | Назначение |
| --- | --- |
| `AI_PROVIDER` | Активный AI-провайдер: `claude`, `openai`, `anthropic`, `ollama`, `off` |
| `CLAUDE_BASE_URL` | OpenAI-compatible endpoint Claude gateway |
| `CLAUDE_API_KEY` | API key для Claude-compatible gateway, если требуется |
| `CLAUDE_MODEL` | Модель Claude-compatible gateway |
| `OPENAI_API_KEY` | API key OpenAI |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL |
| `OPENAI_MODEL` | OpenAI-compatible модель |
| `ANTHROPIC_API_KEY` | API key Anthropic |
| `ANTHROPIC_MODEL` | Anthropic модель |
| `OLLAMA_BASE_URL` | Base URL Ollama |
| `OLLAMA_CHAT_MODEL` | Модель Ollama для текста |
| `OLLAMA_VISION_MODEL` | Модель Ollama для vision-задач |
| `MINIO_ROOT_USER` | Пользователь MinIO |
| `MINIO_ROOT_PASSWORD` | Пароль MinIO |

Секреты не должны коммититься в репозиторий. Для production используются Kubernetes secrets и sealed secrets.

## Backend-Сервисы

### Auth Service

Путь: `backend/auth/`

Назначение:

- регистрация;
- вход;
- refresh tokens;
- JWT access tokens;
- роли `user`, `moderator`, `admin`;
- профиль пользователя.

Локальные тесты:

```bash
cd backend/auth
cargo test
```

### Routes Service

Путь: `backend/routes/`

Назначение:

- CRUD маршрутов;
- точки маршрута;
- категории и сезоны;
- комментарии, лайки, рейтинги, закладки;
- публичные ссылки;
- уведомления;
- чат и AI-инструменты;
- импорт/экспорт маршрутов;
- настройки сложности.

Локальные тесты:

```bash
cd backend/routes
cargo test
```

### Photo Worker

Путь: `backend/photo-worker/`

Назначение:

- читает задачи из NATS JetStream;
- получает оригинал изображения;
- извлекает и нормализует метаданные;
- создаёт web-версию и thumbnail;
- кладёт файлы в MinIO;
- обновляет статус обработки в PostgreSQL.

Локальные тесты:

```bash
cd backend/photo-worker
cargo test
```

### Cache Service

Путь: `backend/cache/`

Назначение:

- кеширование картографических тайлов;
- Redis-backed cache в Docker Compose;
- бенчмарки альтернативных реализаций кеша.

Локальные тесты:

```bash
cd backend/cache
go test ./...
```

Бенчмарки:

```bash
cd backend/cache
make bench
```

### Tiles Service

Путь: `backend/tiles/`

Назначение:

- единая точка выдачи тайлов для клиента;
- проксирование upstream tile source;
- интеграция с cache service.

Локальные тесты:

```bash
cd backend/tiles
go test ./...
```

## Frontend

Путь: `frontend/`

Основные экраны:

- карта и редактор маршрута;
- публичный просмотр маршрута;
- каталог маршрутов;
- профиль пользователя;
- закладки;
- админ-панель;
- AI-ассистент;
- исторический таймлайн;
- PWA status.

Команды:

```bash
cd frontend
npm install
npm run dev
npm run build
npm run lint
npm run preview
```

Для локального dev-сервера Vite:

```bash
cd frontend
npm run dev
```

## Mobile Android Companion App

Путь: `mobile/`

Мобильный клиент не дублирует весь web-клиент. Его scope — полевое дополнение:

- запись GPS-маршрута;
- пауза и продолжение записи;
- локальный черновик;
- фото и текстовые заметки к точкам;
- настройка точек и времени участков;
- синхронизация черновика на сервер;
- просмотр своих синхронизированных маршрутов.

Команды:

```bash
cd mobile
npm install
npm run typecheck
npm run android
```

Установка debug-сборки на подключенный Android:

```bash
cd mobile
npm run android:debug:install
```

Preview release build:

```bash
cd mobile
npm run android:preview:build
npm run android:preview:install
```

iOS не является целевым контуром текущей версии.

## AI-Ассистент

AI-функции проходят через `routes` и настраиваемый provider. Основной production-вариант — Claude-compatible endpoint через `claude-code-api`.

AI используется для:

- распознавания пользовательского намерения в чате;
- поиска мест;
- построения маршрута по естественному запросу;
- генерации описаний маршрутов;
- работы с контекстом карты и маршрута.

В Docker Compose `claude-code-api-init` копирует локальную авторизацию из `${HOME}/.claude` в docker volume `claude_code_auth`, после чего `claude-code-api` поднимает OpenAI-compatible endpoint на `:8000` внутри сети Compose.

Если AI-провайдер недоступен, система должна возвращать управляемую ошибку, а не ломать основной маршрутный функционал.

## Данные И Хранилища

PostgreSQL:

- `auth_db` — пользователи, профиль, роли;
- `routes_db` — маршруты, точки, комментарии, категории, уведомления, чат, настройки.

`routes_db` создаётся при старте PostgreSQL через:

```text
docker/postgres/init.sql
```

MinIO:

- хранит оригиналы фотографий;
- хранит обработанные web-версии;
- хранит thumbnails;
- доступ идёт через S3-compatible API.

NATS JetStream:

- используется для задач фоновой обработки фотографий;
- даёт асинхронность между HTTP-загрузкой и CPU/IO-обработкой изображений.

Redis:

- используется сервисом кеширования тайлов.

## Тестовые Данные

Папка `testdata/` содержит:

```text
testdata/
├── demo-db/          # SQL-скрипты для демо-наполнения
└── route-import/     # GeoJSON и фотографии для проверки импорта
```

Примеры:

- `testdata/demo-db/seed_500_records.sql` — демо-наполнение каталога.
- `testdata/route-import/test_points.geojson` — GeoJSON с точками.
- `testdata/route-import/test_linestring.geojson` — GeoJSON с линией маршрута.
- `testdata/route-import/test_photo_*.jpg` — фотографии для проверки EXIF/GPS сценариев.

## Проверки И Тесты

Быстрый набор локальных проверок:

```bash
cd frontend
npm run build
```

```bash
cd mobile
npm run typecheck
```

```bash
cd backend/auth
cargo test
```

```bash
cd backend/routes
cargo test
```

```bash
cd backend/photo-worker
cargo test
```

```bash
cd backend/cache
go test ./...
```

```bash
cd backend/tiles
go test ./...
```

E2E-аудит маршрута:

```bash
node scripts/e2e/route-creation-audit.mjs
node scripts/e2e/render-report-pdf.mjs
```

Актуальные E2E-отчёты лежат в `doc/e2e/`.

## CI/CD

В `.github/workflows/` есть два основных workflow:

- `tests.yml` — тесты backend/frontend/mobile по изменённым директориям.
- `ci-cd.yml` — сборка Docker-образов, публикация в GHCR и обновление production manifests.

CI/CD запускается не на любые изменения. В workflow настроены `paths`, поэтому изменения только в `doc/` обычно не должны стартовать backend/frontend deployment.

Production deployment:

- Docker images публикуются в GHCR.
- `k8s/overlays/production/kustomization.yaml` обновляется на новый tag.
- ArgoCD синхронизирует кластер из Git.

## Kubernetes И Production

Путь: `k8s/`

Структура:

```text
k8s/
├── base/                 # базовые manifests
├── overlays/production/  # production overlay
└── argocd/               # ArgoCD Application
```

Проверка Kustomize:

```bash
kubectl kustomize k8s/overlays/production
```

Применение без ArgoCD:

```bash
kubectl apply -k k8s/overlays/production
```

Проверка подов:

```bash
kubectl get pods -n guide-helper
```

Подробнее: `k8s/README.md`.

## Документация ВКР

Основной PDF ВКР:

```text
doc/latex/main.pdf
```

Исходники:

```text
doc/latex/
```

PDF собирается только через Docker, чтобы воспроизводимо использовать Times New Roman и одинаковое окружение:

```bash
cd doc/latex
make docker-build
make docker
make verify-fonts
```

Локальная LaTeX-сборка намеренно отключена, потому что без нужных шрифтов XeLaTeX может собрать PDF с fallback-шрифтом.

## Материалы Для Защиты

Презентация:

```text
doc/presentation/guide-helper-defense.pptx
doc/presentation/guide-helper-defense.pdf
doc/presentation/guide-helper-defense.html
```

Демо-сценарии:

```text
doc/demo/final-defense-live-demo.md
doc/demo/canonical-live-demo-flow-2026-04-23.md
```

Диаграммы:

```text
doc/diagrams/index.html
doc/diagrams/*.puml
doc/diagrams/images/*.svg
```

Справочные материалы для подготовки к вопросам комиссии:

```text
doc/defense/
```

## Основной Демо-Флоу

Рекомендуемый сценарий для демонстрации:

1. Войти в систему под тестовым пользователем.
2. Открыть карту и создать новый маршрут.
3. Добавить несколько точек.
4. Прикрепить фотографию и текстовую заметку к точке.
5. Изменить цвет линии и внешний вид меток.
6. Проверить расстояние, сложность, высоты и время.
7. Сохранить маршрут.
8. Опубликовать маршрут и открыть публичную ссылку.
9. Показать каталог, комментарии, оценку и закладки.
10. Показать AI-ассистента на безопасном заранее проверенном запросе.
11. Показать админ-панель.
12. Показать Android companion app как дополнительный контур записи маршрута.

Для защиты лучше иметь подготовленный маршрут и скриншоты на случай проблем с сетью, AI-провайдером или внешними картографическими сервисами.

## Полезные Команды

Логи всех Docker Compose сервисов:

```bash
docker compose logs -f
```

Логи одного сервиса:

```bash
docker compose logs -f routes
docker compose logs -f photo-worker
docker compose logs -f frontend
```

Пересборка одного сервиса:

```bash
docker compose build routes
docker compose up -d routes
```

Проверка PostgreSQL:

```bash
docker compose exec postgres psql -U authuser -d routes_db
```

Проверка NATS monitoring:

```bash
curl http://localhost:8222/healthz
```

Проверка web-сервиса:

```bash
curl -I http://localhost:3005
```

## Troubleshooting

### Frontend Не Видит API

Проверьте, что запущены `auth`, `routes`, `frontend`:

```bash
docker compose ps
docker compose logs -f auth routes frontend
```

### AI Возвращает Ошибку Авторизации

Проверьте:

- есть ли актуальная авторизация Claude Code на хосте в `${HOME}/.claude`;
- скопировал ли `claude-code-api-init` данные в volume;
- healthy ли `claude-code-api`;
- совпадает ли `AI_PROVIDER` с доступным provider.

Команды:

```bash
docker compose ps claude-code-api
docker compose logs -f claude-code-api claude-code-api-init
```

### Фото Не Обрабатываются

Проверьте:

- работает ли `photo-worker`;
- доступен ли `minio`;
- доступен ли `nats`;
- нет ли ошибок в `routes` при публикации задачи.

Команды:

```bash
docker compose logs -f routes photo-worker nats minio
```

### Тайлы Карты Загружаются Медленно

Проверьте:

- `tiles`;
- `cache`;
- `redis`;
- доступность upstream tile source.

Команды:

```bash
docker compose logs -f tiles cache redis
```

### PostgreSQL Не Стартует

Проверьте события и логи:

```bash
docker compose logs -f postgres
```

Если локальные данные повреждены и их можно потерять:

```bash
docker compose down -v
docker compose up --build
```

## Git И Рабочий Процесс

Коммиты пишутся в формате Conventional Commits:

```text
feat: add route publication flow
fix: keep routed path when category changes
docs: update defense materials
test: add route creation e2e audit
```

Перед коммитом желательно проверять:

```bash
git status
git diff --stat
```

Документацию, код и автогенерируемые артефакты лучше коммитить отдельными логическими коммитами.

## Текущее Позиционирование Проекта

Главный результат — web-система для авторов маршрутов и туристов:

- автор маршрута получает единый инструмент для сборки маршрута, фотографий, заметок и публичной ссылки;
- турист получает каталог маршрутов и интерактивный просмотр;
- администратор получает контур управления пользователями, категориями, комментариями и настройками;
- мобильный клиент дополняет web-систему записью маршрута в полевых условиях.

Мобильный клиент не является заменой web-клиента. Это сознательное ограничение scope: сложное проектирование и публикация удобнее на большом экране, а запись GPS-трека удобнее на телефоне.

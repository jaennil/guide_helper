# Сервис аутентификации

Микросервис аутентификации на Rust с поддержкой JWT токенов, построенный с использованием Axum, SQLx и PostgreSQL.

## Возможности

- Регистрация пользователей с email и паролем
- Вход пользователей с проверкой учетных данных
- Аутентификация на основе JWT (access и refresh токены)
- Хеширование паролей с помощью Argon2
- База данных PostgreSQL с миграциями SQLx
- Поддержка Docker и Docker Compose
- Endpoint для проверки здоровья сервиса

## Технологический стек

- **Фреймворк**: Axum 0.8
- **База данных**: PostgreSQL 16 с SQLx
- **Аутентификация**: JWT (jsonwebtoken), хеширование паролей Argon2
- **Runtime**: Tokio async runtime
- **Валидация**: validator для проверки входных данных
- **Логирование**: tracing и tracing-subscriber

## Требования

- Rust 1.91.0 или новее
- Docker и Docker Compose (для контейнеризованного развертывания)
- PostgreSQL 16 (если запускаете локально без Docker)

## Конфигурация

Создайте файл `.env` в корне проекта:

```env
DB_NAME=auth_db
DB_USER=authuser
DB_PASSWORD=authpass123
JWT_SECRET=ваш_секретный_ключ_измените_в_продакшене
```

### Переменные окружения

| Переменная | Описание | По умолчанию |
|-----------|----------|--------------|
| `DATABASE_URL` | Строка подключения PostgreSQL | `postgres://user:password@localhost:5432/auth_db` |
| `DATABASE_MAX_CONNECTIONS` | Максимальный размер пула подключений к БД | `5` |
| `JWT_SECRET` | Секретный ключ для подписи JWT | Обязательно |
| `JWT_ACCESS_TOKEN_MINUTES` | Время жизни access токена в минутах | `15` |
| `JWT_REFRESH_TOKEN_DAYS` | Время жизни refresh токена в днях | `7` |

## Запуск с Docker Compose

1. Запустите сервисы:
```bash
docker compose up -d
```

2. Проверьте статус сервисов:
```bash
docker compose ps
```

3. Просмотр логов:
```bash
docker compose logs -f
```

API будет доступен по адресу `http://localhost:8080`.

## Локальный запуск

1. Установите зависимости и соберите проект:
```bash
cargo build --release
```

2. Настройте базу данных:
```bash
# Убедитесь, что PostgreSQL запущен
# Миграции выполнятся автоматически при запуске
```

3. Запустите сервис:
```bash
DATABASE_URL="postgres://authuser:authpass123@localhost:5432/auth_db" \
JWT_SECRET="ваш_секретный_ключ" \
./target/release/auth
```

## API Endpoints

### Проверка здоровья
```http
GET /healthz
```

**Ответ:**
```
OK
```

### Регистрация пользователя
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123"
}
```

**Ответ (200 OK):**
```json
{
  "access_token": "eyJ0eXAiOiJKV1Q...",
  "refresh_token": "eyJ0eXAiOiJKV1Q...",
  "token_type": "Bearer"
}
```

**Ответы с ошибками:**
- `400 Bad Request`: Неверный формат email или пароля
- `409 Conflict`: Пользователь с таким email уже существует

### Вход
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123"
}
```

**Ответ (200 OK):**
```json
{
  "access_token": "eyJ0eXAiOiJKV1Q...",
  "refresh_token": "eyJ0eXAiOiJKV1Q...",
  "token_type": "Bearer"
}
```

**Ответы с ошибками:**
- `401 Unauthorized`: Неверные учетные данные

### Обновление токена
```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refresh_token": "eyJ0eXAiOiJKV1Q..."
}
```

**Ответ (200 OK):**
```json
{
  "access_token": "eyJ0eXAiOiJKV1Q...",
  "token_type": "Bearer"
}
```

**Ответы с ошибками:**
- `401 Unauthorized`: Недействительный или просроченный токен

## Тестирование

Запуск unit тестов:
```bash
cargo test
```

## Разработка

### Миграции базы данных

Миграции находятся в директории `migrations/` и выполняются автоматически при запуске приложения с использованием SQLx.

Создание новой миграции:
```bash
sqlx migrate add <название_миграции>
```

### Структура проекта

```
.
├── src/
│   ├── config/          # Загрузка конфигурации
│   ├── delivery/        # HTTP обработчики и маршруты
│   ├── domain/          # Доменные модели
│   ├── repository/      # Слой базы данных
│   ├── usecase/         # Бизнес-логика
│   └── main.rs          # Точка входа приложения
├── migrations/          # Миграции базы данных
├── Dockerfile           # Определение образа контейнера
├── docker-compose.yml   # Конфигурация Docker Compose
└── Cargo.toml          # Зависимости Rust
```

## Заметки о безопасности

- Пароли хешируются с помощью Argon2 перед сохранением
- JWT токены подписываются алгоритмом HS256
- Измените `JWT_SECRET` в продакшене
- Используйте надежные учетные данные базы данных в продакшене
- Access токены истекают через 15 минут по умолчанию
- Refresh токены истекают через 7 дней по умолчанию

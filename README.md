# Guide Helper

## Требования

- Docker 20.10+
- Docker Compose 2.0+

## Быстрый старт

### Запуск всех сервисов

```bash
docker-compose up -d
```

После запуска приложение будет доступно по адресам:

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8080
- **API Health Check**: http://localhost:8080/api/v1/heathz
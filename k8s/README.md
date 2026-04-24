# Kubernetes Deployment Guide

Этот проект использует Kustomize для управления манифестами и ArgoCD для автоматического деплоя.

## Структура

```
k8s/
├── base/                           # Базовые манифесты для всех окружений
│   ├── postgres/                   # PostgreSQL база данных
│   ├── auth/                       # Auth сервис (Rust)
│   ├── cache/                      # Cache сервис (Go)
│   ├── frontend/                   # Frontend (React + Nginx)
│   └── kustomization.yaml
├── overlays/
│   └── production/                 # Production конфигурация
│       ├── secrets/                # Секреты (не в git)
│       ├── ingress.yaml            # Ingress правила
│       └── kustomization.yaml      # Production настройки
└── argocd/
    └── application.yaml            # ArgoCD Application
```

## Шаг 1: Настройка секретов

```bash
cd k8s/overlays/production/secrets

# Создать секретные файлы из примеров
cp postgres-user.txt.example postgres-user.txt
cp postgres-password.txt.example postgres-password.txt
cp postgres-db.txt.example postgres-db.txt
cp jwt-secret.txt.example jwt-secret.txt

# Отредактировать каждый файл с реальными значениями
# Или сгенерировать JWT secret:
openssl rand -base64 48 > jwt-secret.txt
```

Для AI-переключения у `routes` есть отдельные опциональные секреты:

- `openai-secret` c ключом `api-key` для OpenAI.
- `anthropic-secret` c ключом `api-key` для прямого Anthropic/Claude API.
- `claude-secret` c ключом `api-key` для Claude через OpenAI-совместимый proxy.
- `unleash-secret` c ключом `api-token` для клиентского токена Unleash.

Если этих секретов нет, соответствующий провайдер считается недоступным, а `routes` честно возвращает `503` вместо попытки ходить с фиктивным ключом.

## Шаг 2: Проверка манифестов

```bash
# Проверить что Kustomize генерирует корректные манифесты
kubectl kustomize k8s/overlays/production

# Или применить напрямую (без ArgoCD)
kubectl apply -k k8s/overlays/production
```

## Шаг 3: Деплой через ArgoCD

```bash
# Применить ArgoCD Application
kubectl apply -f k8s/argocd/application.yaml

# Проверить статус
kubectl get application -n argocd guide-helper

# Открыть ArgoCD UI
kubectl port-forward -n argocd svc/argocd-server 8080:443

# Получить пароль для входа
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d
```

## CI/CD Pipeline

При пуше в `main` ветку:

1. GitHub Actions собирает Docker образы
2. Пушит в ghcr.io с тегами:
   - `main-<commit-sha>`
   - `latest`
3. Обновляет image tags в `k8s/overlays/production/kustomization.yaml`
4. Коммитит изменения
5. ArgoCD видит изменения и автоматически применяет их в кластер

## Проверка работы

```bash
# Проверить поды
kubectl get pods -n guide-helper

# Проверить сервисы
kubectl get svc -n guide-helper

# Проверить ingress
kubectl get ingress -n guide-helper

# Логи
kubectl logs -f deployment/auth -n guide-helper
kubectl logs -f deployment/cache -n guide-helper
kubectl logs -f deployment/frontend -n guide-helper

# Port-forward для тестирования
kubectl port-forward -n guide-helper svc/frontend 3005:80

# Тестировать API
curl http://localhost:3005/api/v1/healthz
curl -X POST http://localhost:3005/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

## Важные замечания

1. **Secrets не в git**: Файлы `k8s/overlays/production/secrets/*.txt` в .gitignore
2. **Обновление образов**: GitHub Actions автоматически обновляет image tags
3. **ArgoCD auto-sync**: Включен автоматический sync с GitHub
4. **Replicas**: Количество реплик задаётся deployment-манифестами и может отличаться по сервисам
5. **Ingress**: Настроен для `guide-helper.local`, измените на реальный домен в production

## AI provider switch

`routes` поддерживает четыре режима AI-чата:

- `openai`
- `ollama`
- `claude`
- `off`

Статический fallback задаётся через `AI_PROVIDER` в `k8s/base/routes/configmap.yaml`.
Сейчас production fallback настроен на `claude`, а `CLAUDE_BASE_URL` указывает на внешний `claude-code-api` endpoint.

Для динамического переключения используется Unleash feature flag `ai-provider`.
Рекомендуемый вариант настройки:

1. Создать в Unleash feature flag `ai-provider`.
2. В production держать ровно один активный variant со 100% весом: `openai`, `ollama`, `claude` или `off`.
3. Для variant payload можно не задавать ничего и использовать имя варианта, либо передать строку в `payload.value` или `payload.provider`.
4. Выдать `routes` клиентский Unleash token и положить его в secret `unleash-secret`.

Важно: для Rust SDK нужен именно Unleash client token. Admin API token для `/api/admin` сюда не подходит.

## Troubleshooting

### Pods не запускаются

```bash
# Проверить события
kubectl get events -n guide-helper --sort-by='.lastTimestamp'

# Описание пода
kubectl describe pod <pod-name> -n guide-helper
```

### Проблемы с секретами

```bash
# Проверить что секреты созданы
kubectl get secrets -n guide-helper

# Посмотреть содержимое
kubectl get secret postgres-secret -n guide-helper -o yaml
```

### ArgoCD не синхронизируется

```bash
# Проверить статус application
kubectl describe application guide-helper -n argocd

# Принудительная синхронизация через UI или CLI
argocd app sync guide-helper
```

# E2E-аудит Guide Helper

Дата запуска: 30.04.2026, 15:18:35

Стенд: https://guidehelper.dubrovskih.ru

API: https://guidehelper.dubrovskih.ru

Тестовый пользователь: e2e-20260430T121731@guide-helper.local

Проверка выполнена автоматизированным smoke/e2e-аудитом через HTTP API и headless Chromium. Цель проверки — подтвердить основные пользовательские сценарии, состояние экранов и отсутствие явных runtime/network ошибок в интерфейсе.

## Методика

Проверка выполнена в два слоя:

- API-слой создаёт отдельного тестового пользователя, маршрут, комментарий, лайк, рейтинг, закладку, публикацию маршрута, импорт GeoJSON и проверяет административные API.
- UI-слой открывает реальные страницы production-like стенда в headless Chromium, проверяет ключевые DOM-состояния, фиксирует runtime/network ошибки и сохраняет скриншоты.

Команда повторного запуска:

```bash
GH_E2E_ADMIN_EMAIL='...' GH_E2E_ADMIN_PASSWORD='...' node scripts/e2e/prod-audit.mjs
```

## Итог

| Статус | Количество |
|---|---:|
| PASS | 39 |
| FAIL | 0 |
| SKIP | 0 |

Критических блокирующих ошибок в проверенных сценариях не обнаружено.

## Проверенные сценарии

| Область | Проверка | Статус | Детали |
|---|---|---|---|
| Auth | регистрация нового пользователя | PASS | e2e-20260430T121731@guide-helper.local |
| Auth | вход зарегистрированного пользователя | PASS | получены access/refresh token |
| Profile | обновление профиля | PASS | E2E пользователь 20260430T121731 |
| Profile | смена пароля и повторный вход | PASS | новый пароль принят |
| Catalog | получение категорий | PASS | 5 categories |
| Routes | создание маршрута с точками, заметками и кастомизацией | PASS | 26061511-1389-4c55-98ce-5042df4fb9c5 |
| Routes | обновление маршрута | PASS | E2E маршрут 20260430T121731 обновлён |
| Routes | импорт GeoJSON | PASS | 4 points |
| Share | публикация маршрута | PASS | 92efe266-9339-44b3-81fc-e330150e70e1 |
| Share | публичное получение маршрута | PASS | E2E маршрут 20260430T121731 обновлён |
| Social | создание комментария | PASS | 3a08db62-926d-4f8d-b00d-77ef7e59fb01 |
| Social | лайк, рейтинг и закладка | PASS | like=true, rating=5, bookmark=true |
| PWA | manifest и service worker доступны | PASS | manifest=200, sw=200 |
| AI | панель и API отмечены как внешний риск | PASS | UI проверяется, генерация вынесена в риск |
| Admin | вход администратора | PASS | admin token получен |
| Admin | статистика и списки | PASS | users=62, routes=181, comments=167 |
| Admin | CRUD категории | PASS | 80ebdf1b-f2ce-46c1-a429-5f370bdd2dc1 |
| Admin | пороги сложности читаются и сохраняются | PASS | сохранены текущие значения без изменения |
| UI | экран входа | PASS |  |
| UI | редактор маршрута на карте | PASS |  |
| UI | popup точки маршрута | PASS |  |
| UI | меню инструментов карты | PASS |  |
| UI | AI-чат открывается | PASS |  |
| UI | каталог маршрутов | PASS |  |
| UI | публичная страница маршрута | PASS |  |
| UI | QR-код публичного маршрута | PASS |  |
| UI | embed-страница маршрута | PASS |  |
| UI | профиль пользователя | PASS |  |
| UI | безопасность профиля | PASS |  |
| UI | мои маршруты | PASS |  |
| UI | закладки | PASS |  |
| UI Admin | дашборд администратора | PASS |  |
| UI Admin | пользователи | PASS |  |
| UI Admin | маршруты | PASS |  |
| UI Admin | комментарии | PASS |  |
| UI Admin | категории | PASS |  |
| UI Admin | настройки | PASS |  |
| Cleanup | удаление импортированного маршрута | PASS | 44b1f2a1-a0f7-46bc-b132-09a16891a6d6 |
| Cleanup | удаление основного e2e-маршрута | PASS | 26061511-1389-4c55-98ce-5042df4fb9c5 |

## Скриншоты

Сводный лист всех снимков: [contact-sheet.png](contact-sheet.png).

### 1. Экран входа

Форма авторизации отображается без ошибок.

![Экран входа](screenshots/01-login.png)

### 2. Редактор маршрута

Маршрут пользователя открыт на карте.

![Редактор маршрута](screenshots/02-map-route-editor.png)

### 3. Popup точки

Карточка точки открывается по клику по маркеру.

![Popup точки](screenshots/03-map-point-popup.png)

### 4. Меню инструментов

Доступны импорт, экспорт, AI-описание, исторический режим и очистка.

![Меню инструментов](screenshots/04-map-tools-menu.png)

### 5. AI-ассистент

Панель ассистента открывается рядом с картой.

![AI-ассистент](screenshots/05-ai-chat-panel.png)

### 6. Каталог маршрутов

Публичный каталог загружает карточки маршрутов и фильтры.

![Каталог маршрутов](screenshots/06-explore-catalog.png)

### 7. Публичный маршрут

Маршрут доступен по share token.

![Публичный маршрут](screenshots/07-shared-route.png)

### 8. QR-код маршрута

Модальное окно QR-кода открывается с публичной ссылки.

![QR-код маршрута](screenshots/08-shared-qr.png)

### 9. Embed-карта

Встраиваемая карта маршрута доступна отдельно.

![Embed-карта](screenshots/09-embed-route.png)

### 10. Профиль

Профиль показывает данные пользователя.

![Профиль](screenshots/10-profile.png)

### 11. Безопасность профиля

Форма смены пароля доступна.

![Безопасность профиля](screenshots/11-profile-security.png)

### 12. Мои маршруты

Созданный маршрут виден в профиле.

![Мои маршруты](screenshots/12-profile-routes.png)

### 13. Закладки

Страница закладок открывается после bookmark API.

![Закладки](screenshots/13-bookmarks.png)

### 14. Админка: дашборд

Статистика пользователей, маршрутов и комментариев отображается.

![Админка: дашборд](screenshots/14-admin-dashboard.png)

### 15. Админка: пользователи

Таблица пользователей открывается.

![Админка: пользователи](screenshots/15-admin-users.png)

### 16. Админка: маршруты

Таблица маршрутов открывается.

![Админка: маршруты](screenshots/16-admin-routes.png)

### 17. Админка: комментарии

Таблица комментариев открывается.

![Админка: комментарии](screenshots/17-admin-comments.png)

### 18. Админка: категории

CRUD-интерфейс категорий доступен.

![Админка: категории](screenshots/18-admin-categories.png)

### 19. Админка: настройки

Пороги сложности отображаются.

![Админка: настройки](screenshots/19-admin-settings.png)


## Console / Network Diagnostics

- chromium-stderr: [1162601:1162680:0430/151738.055226:ERROR:google_apis/gcm/engine/registration_request.cc:291] Registration response error message: PHONE_REGISTRATION_ERROR
- console-warning: [routing] GraphHopper API key not set, falling back to OSRM
- console-warning: [routing] GraphHopper API key not set, falling back to OSRM
- chromium-stderr: [1162601:1162680:0430/151801.346966:ERROR:google_apis/gcm/engine/registration_request.cc:291] Registration response error message: QUOTA_EXCEEDED

## Ограничения проверки

- Проверка запускалась по production-like стенду, поэтому destructive-операции ограничены тестовыми сущностями с префиксом E2E.
- AI-генерация не считается deterministic e2e-проверкой, потому что зависит от внешнего провайдера, токенов, лимитов и времени ответа.
- Мобильная запись GPS не покрыта этим web-аудитом: её корректнее проверять отдельным Android field-test сценарием на устройстве.
- Визуальная проверка скриншотов подтверждает отсутствие явных ошибок на момент запуска, но не заменяет нагрузочное тестирование и ручной UX-аудит.

## Тестовые данные

- Основной маршрут: 26061511-1389-4c55-98ce-5042df4fb9c5 (удалён cleanup-шагом)
- Share token: 92efe266-9339-44b3-81fc-e330150e70e1
- Комментарий: 3a08db62-926d-4f8d-b00d-77ef7e59fb01
- Импортированный маршрут: 44b1f2a1-a0f7-46bc-b132-09a16891a6d6 (удалён cleanup-шагом)

## Примечания

- AI-генерация и chat API зависят от внешнего Claude/OpenAI-compatible провайдера; в e2e-аудите проверяется UI-панель, но генерация не считается стабильным deterministic тестом.


# Guide Helper Mobile

Мобильный клиент для записи туристического маршрута в духе Strava/Runna, но с сохранением результата в текущую модель `Guide Helper`.

Что уже есть:
- запись GPS-трека в foreground;
- попытка background-tracking через `expo-location` + `expo-task-manager`;
- локальное хранение активной сессии и фоновых точек в файловой системе приложения;
- расчёт дистанции, длительности, средней и пиковой скорости;
- карта с текущим треком, если для Android задан `Google Maps API key`;
- логин/регистрация в существующий backend;
- выгрузка записанного трека как обычного маршрута в `/api/v1/routes`;
- локальная очередь выгрузки: маршрут можно сохранить без сети или до авторизации и синхронизировать позже.

Ограничения текущего MVP:
- background tracking на iOS и Android требует development build, в Expo Go он ограничен;
- пока нет фото/заметок по точкам и offline tile cache;
- на Android без `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` карта заменяется fallback-блоком, чтобы приложение не падало в development build;
- трек сохраняется как последовательность `manual`-сегментов, без map matching.

## Запуск

```bash
cd mobile
npm install
npm run start
```

Если нужен физический фоновой трекинг:

```bash
cd mobile
npx expo run:android
# или
npx expo run:ios
```

По умолчанию API направлен в `https://guidehelper.dubrovskih.ru`.
Для переопределения и для включения Android-карты можно задать:

```bash
EXPO_PUBLIC_API_BASE_URL=https://your-api.example.com npm run start
# для Android native map:
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your-google-maps-key npx expo run:android
```

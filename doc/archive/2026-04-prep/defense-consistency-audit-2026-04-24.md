# Defense Consistency Audit

Дата: `2026-04-24`

Назначение: зафиксировать, какие документы являются источником истины для защиты, и какие файлы в `doc/` относятся к более ранним этапам и могут содержать устаревшие формулировки или числа.

## 1. Канонические Значения На Текущий Момент

- Тема:
  `Разработка информационной системы для создания и публикации туристических маршрутов с геопривязанными фотографиями`
- Текущий PDF ВКР:
  `doc/latex/main.pdf`
- Объём PDF:
  `90 страниц`
- Число источников:
  `51`
- Статус функциональных требований:
  `37 из 37`
- Позиционирование mobile:
  `Android companion app как дополнительный полевой клиент`

## 2. Источники Истины Для Защиты

Эти файлы использовать как основные:

- `doc/latex/main.pdf`
- `doc/presentation/guide-helper-defense.pdf`
- `doc/presentation/speaker-notes.md`
- `doc/archive/2026-04-prep/system-passport-2026-04-21.md`
- `doc/archive/2026-04-prep/defense-quick-cheatsheet-2026-04-23.md`
- `doc/demo/canonical-live-demo-flow-2026-04-23.md`
- `doc/demo/defense-narrative-2026-04-23.md`
- `doc/practice/prediploma-checklist-2026-04-21.md`
- `doc/archive/2026-04-prep/internal-normocontrol-checklist-2026-04-23.md`

## 3. Файлы, Которые Могут Быть Историческими Или Черновыми

Эти документы не обязательно ошибочны, но они относятся к более ранним этапам и не должны использоваться как главный ориентир без сверки с каноническими материалами:

- `doc/archive/2026-04-prep/issues.md`
- `doc/archive/project-drafts/theme.md`
- `doc/archive/project-drafts/описание_проекта.md`
- `doc/practice/practic2.md`
- `doc/archive/2026-04-prep/transcript.txt`

## 4. Найденные Расхождения

### Исправлено В Ходе Аудита

- В `doc/practice/practic2.md` были устаревшие значения:
  - `86 страниц` -> заменено на `90 страниц`
  - `50 источников` -> заменено на `51 источник`

### Помечено Как Историческое

- `doc/archive/2026-04-prep/issues.md` теперь явно помечен как снимок на `2026-04-08`, а не как текущий status-file.
- `doc/archive/project-drafts/theme.md` и `doc/archive/project-drafts/описание_проекта.md` помечены как ранние документы согласования/проектирования с более широким scope.

## 5. Практический Вывод

Перед защитой и предзащитой не нужно ориентироваться на весь каталог `doc/` как на единый актуальный массив.

Рациональный набор для подготовки:

1. `doc/latex/main.pdf`
2. `doc/presentation/guide-helper-defense.pdf`
3. `doc/archive/2026-04-prep/defense-quick-cheatsheet-2026-04-23.md`
4. `doc/demo/canonical-live-demo-flow-2026-04-23.md`
5. `doc/archive/2026-04-prep/internal-normocontrol-checklist-2026-04-23.md`

Именно эти файлы должны быть в голове и на руках в первую очередь.

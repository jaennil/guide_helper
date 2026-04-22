# Защитная Презентация Guide Helper

Файлы:
- `guide-helper-defense.html` — основной слайд-дек для показа в браузере
- `guide-helper-defense.pdf` — печатная/export-версия
- `export_pdf.sh` — экспорт HTML-дека в PDF через Chromium

## Быстрый запуск

Открыть HTML в браузере:

```bash
xdg-open /home/jaennil/dev/uni/guide_helper/doc/presentation/guide-helper-defense.html
```

Навигация:
- `←` / `→`
- `PageUp` / `PageDown`
- `Home` / `End`

## Экспорт В PDF

```bash
cd /home/jaennil/dev/uni/guide_helper/doc/presentation
bash export_pdf.sh
```

## Источники Визуальных Материалов

- `doc/latex/images/mockups/` — актуальные интерфейсы
- `doc/latex/images/c4-context.png` — контекстная диаграмма
- `doc/latex/images/c4-container.png` — контейнерная диаграмма
- `doc/latex/images/er-diagram.png` — ER-диаграмма
- `doc/latex/images/sequence-photo.png` — последовательность обработки фото

## Ограничение

Это не `pptx`, а HTML/PDF-версия презентации. Если понадобится отправка именно в PowerPoint или Google Slides, этот дек уже можно переносить 1:1 без перепридумывания структуры и текста.

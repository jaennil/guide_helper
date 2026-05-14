# Защитная презентация Guide Helper

Файлы:
- `guide-helper-defense.pptx` — основной файл презентации по шаблону Московского Политеха;
- `guide-helper-defense.pdf` — PDF-экспорт презентации для просмотра без PowerPoint/LibreOffice;
- `speaker-notes.md` / `speaker-notes.html` — сценарий доклада и короткие ответы по фактическим 13 слайдам;
- `Шаблон_Презентации_ВЕБ_брендбука_Политеха_для_вкр_ВЕБ_2.pptx` — исходный шаблон Политеха;
- `assets/` — подготовленные изображения для слайдов;
- `../../scripts/build_defense_pptx_from_template.py` — генератор PPTX из шаблона.

`guide-helper-defense.html` оставлен как черновой/резервный HTML-вариант, но
основным артефактом для защиты является PPTX.

## Быстрый просмотр

```bash
xdg-open /home/jaennil/dev/uni/guide_helper/doc/presentation/guide-helper-defense.pdf
```

## Пересборка PPTX

```bash
cd /home/jaennil/dev/uni/guide_helper
python3 scripts/build_defense_pptx_from_template.py
libreoffice --headless --convert-to pdf --outdir doc/presentation doc/presentation/guide-helper-defense.pptx
```

## Источники визуальных материалов

- `doc/latex/images/mockups/` — актуальные интерфейсы
- `doc/diagrams/images/` — архитектурные SVG-диаграммы
- `doc/presentation/assets/` — изображения, специально адаптированные под слайды
- `doc/e2e/20260505T151706-route-creation-audit/screenshots/` — скриншоты E2E-сценария создания маршрута

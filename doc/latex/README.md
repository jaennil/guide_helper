# LaTeX build

Обычная локальная сборка:

```bash
make
```

Воспроизводимая сборка в Docker с XeLaTeX, biber, `biblatex-gost` и Times New Roman:

```bash
make docker-build
make docker
```

`docker-build` собирает образ `guide-helper-latex`.
`docker` запускает сборку `main.pdf` в контейнере с монтированием текущей директории.

В Docker используется пакет `ttf-mscorefonts-installer`, который устанавливает Microsoft Core Fonts по EULA во время сборки образа. Шрифты не коммитятся в репозиторий.

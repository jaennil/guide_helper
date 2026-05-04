# LaTeX build

Сборка выполняется только в Docker, чтобы PDF воспроизводимо собирался с Times New Roman:

```bash
make docker-build
make docker
```

Команда `make` также запускает Docker-сборку:

```bash
make
```

`docker-build` собирает образ `guide-helper-latex`.
`docker` запускает сборку `main.pdf` в контейнере с монтированием текущей директории.

Локальная LaTeX-сборка отключена намеренно: на рабочей машине может не быть Times New Roman, и тогда XeLaTeX возьмёт fallback-шрифт. Проверка шрифта:

```bash
make verify-fonts
```

В Docker используется пакет `ttf-mscorefonts-installer`, который устанавливает Microsoft Core Fonts по EULA во время сборки образа. Шрифты не коммитятся в репозиторий.

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Включаем contrib/non-free: ttf-mscorefonts-installer ставит Microsoft Core Fonts,
# включая Times New Roman. Сами шрифты не хранятся в репозитории.
RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      cabextract \
      fontconfig \
      fonts-liberation2 \
      make \
      xfonts-utils \
    && echo 'ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true' | debconf-set-selections \
    && apt-get install -y --no-install-recommends \
      biber \
      latexmk \
      texlive-bibtex-extra \
      texlive-fonts-recommended \
      texlive-lang-cyrillic \
      texlive-latex-extra \
      texlive-pictures \
      texlive-xetex \
      ttf-mscorefonts-installer \
    && fc-cache -f \
    && fc-match 'Times New Roman' \
    && rm -rf /var/lib/apt/lists/*

RUN fc-match 'Times New Roman' | grep -q 'Times_New_Roman' \
    && fc-match 'Liberation Sans' | grep -q 'LiberationSans'

WORKDIR /work

CMD ["make"]

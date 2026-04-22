#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEMO_DIR="$ROOT_DIR/doc/demo"
BUILD_DIR="$DEMO_DIR/build"
SCENE_DIR="$BUILD_DIR/scenes"
OUTPUT="$DEMO_DIR/guide-helper-defense-demo.mp4"
FONT="$(fc-match 'DejaVu Sans' -f '%{file}\n' | head -n 1)"

WIDTH=1920
HEIGHT=1080
FPS=30

mkdir -p "$SCENE_DIR"
rm -f "$SCENE_DIR"/*.mp4 "$BUILD_DIR/scenes.txt"

write_text_file() {
  local path="$1"
  local text="$2"
  printf '%s\n' "$text" > "$path"
}

title_scene() {
  local outfile="$1"
  local duration="$2"
  local title="$3"
  local subtitle="$4"
  local accent="$5"
  local stem
  local title_file
  local subtitle_file

  stem="$(basename "${outfile%.mp4}")"
  title_file="$BUILD_DIR/${stem}-title.txt"
  subtitle_file="$BUILD_DIR/${stem}-subtitle.txt"

  write_text_file "$title_file" "$title"
  write_text_file "$subtitle_file" "$subtitle"

  ffmpeg -y \
    -f lavfi -i "color=c=0x0b1020:s=${WIDTH}x${HEIGHT}:d=${duration}" \
    -vf "drawbox=x=88:y=96:w=1744:h=888:color=0x121a31@0.96:t=fill,\
drawbox=x=88:y=96:w=18:h=888:color=${accent}:t=fill,\
drawtext=fontfile=${FONT}:textfile='${title_file}':fontsize=70:fontcolor=white:x=144:y=248,\
drawtext=fontfile=${FONT}:textfile='${subtitle_file}':fontsize=30:fontcolor=0xcbd5e1:x=148:y=380,\
drawtext=fontfile=${FONT}:text='guidehelper.dubrovskih.ru':fontsize=28:fontcolor=0x93c5fd:x=148:y=842,\
fade=t=in:st=0:d=0.8,fade=t=out:st=$(awk "BEGIN {print ${duration}-0.8}"):d=0.8" \
    -r "$FPS" -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -movflags +faststart \
    "$outfile"
}

image_scene() {
  local outfile="$1"
  local image="$2"
  local duration="$3"
  local label="$4"
  local stem
  local label_file
  local footer_file

  stem="$(basename "${outfile%.mp4}")"
  label_file="$BUILD_DIR/${stem}-label.txt"
  footer_file="$BUILD_DIR/${stem}-footer.txt"

  write_text_file "$label_file" "$label"
  write_text_file "$footer_file" "Guide Helper · актуальный экран системы"

  ffmpeg -y \
    -loop 1 -t "$duration" -i "$image" \
    -vf "scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,\
pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x0b1020,\
drawbox=x=40:y=40:w=1620:h=86:color=0x10182ddc:t=fill,\
drawtext=fontfile=${FONT}:textfile='${label_file}':fontsize=28:fontcolor=white:x=68:y=68,\
drawbox=x=56:y=964:w=620:h=64:color=0x10182dd0:t=fill,\
drawtext=fontfile=${FONT}:textfile='${footer_file}':fontsize=24:fontcolor=0xcbd5e1:x=84:y=985,\
fade=t=in:st=0:d=0.8,fade=t=out:st=$(awk "BEGIN {print ${duration}-0.8}"):d=0.8" \
    -r "$FPS" -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -movflags +faststart \
    "$outfile"
}

title_scene \
  "$SCENE_DIR/00-title.mp4" \
  8 \
  "Guide Helper" \
  "Создание и публикация туристических маршрутов с геопривязанными фотографиями" \
  "0x3b82f6"

title_scene \
  "$SCENE_DIR/01-problem.mp4" \
  10 \
  "Проблема" \
  "Маршрут, фотографии и пояснения обычно разрознены. Guide Helper собирает это в одном интерфейсе." \
  "0xf59e0b"

image_scene \
  "$SCENE_DIR/02-route-editor.mp4" \
  "$ROOT_DIR/doc/latex/images/mockups/map-editor.png" \
  36 \
  "1. Роль гида: редактор маршрута, точки, авто-построение и аналитика"

image_scene \
  "$SCENE_DIR/03-shared-route.mp4" \
  "$ROOT_DIR/doc/latex/images/mockups/shared-route.png" \
  32 \
  "2. Роль туриста: просмотр маршрута по ссылке, фото, комментарии и рейтинг"

image_scene \
  "$SCENE_DIR/04-catalog.mp4" \
  "$ROOT_DIR/doc/latex/images/mockups/explore.png" \
  16 \
  "3. Каталог маршрутов: поиск, фильтры, подбор под сезон и категорию"

image_scene \
  "$SCENE_DIR/05-profile.mp4" \
  "$ROOT_DIR/doc/latex/images/mockups/profile.png" \
  18 \
  "4. Профиль автора: управление маршрутами, экспорт, повторное использование"

image_scene \
  "$SCENE_DIR/06-context.mp4" \
  "$ROOT_DIR/doc/latex/images/c4-context.png" \
  12 \
  "5. Контекст системы: пользователь, администратор и внешние сервисы"

image_scene \
  "$SCENE_DIR/07-container.mp4" \
  "$ROOT_DIR/doc/latex/images/c4-container.png" \
  20 \
  "6. Архитектура: frontend, auth, routes, photo worker, AI proxy и инфраструктура"

title_scene \
  "$SCENE_DIR/08-outro.mp4" \
  8 \
  "Результат" \
  "Guide Helper покрывает полный жизненный цикл маршрута: создание, публикацию, просмотр и повторное использование." \
  "0x22c55e"

for scene in \
  "$SCENE_DIR/00-title.mp4" \
  "$SCENE_DIR/01-problem.mp4" \
  "$SCENE_DIR/02-route-editor.mp4" \
  "$SCENE_DIR/03-shared-route.mp4" \
  "$SCENE_DIR/04-catalog.mp4" \
  "$SCENE_DIR/05-profile.mp4" \
  "$SCENE_DIR/06-context.mp4" \
  "$SCENE_DIR/07-container.mp4" \
  "$SCENE_DIR/08-outro.mp4"
do
  printf "file '%s'\n" "$scene" >> "$BUILD_DIR/scenes.txt"
done

ffmpeg -y \
  -f concat -safe 0 -i "$BUILD_DIR/scenes.txt" \
  -c copy "$OUTPUT"

echo "Built $OUTPUT"

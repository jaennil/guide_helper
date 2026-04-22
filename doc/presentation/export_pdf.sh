#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT_HTML="${SCRIPT_DIR}/guide-helper-defense.html"
OUTPUT_PDF="${SCRIPT_DIR}/guide-helper-defense.pdf"

/usr/bin/chromium \
  --headless=new \
  --disable-gpu \
  --allow-file-access-from-files \
  --run-all-compositor-stages-before-draw \
  --virtual-time-budget=3000 \
  --print-to-pdf="${OUTPUT_PDF}" \
  --print-to-pdf-no-header \
  "file://${INPUT_HTML}"

echo "Exported to ${OUTPUT_PDF}"

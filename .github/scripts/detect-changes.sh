#!/usr/bin/env bash

set -euo pipefail

event_name="${GITHUB_EVENT_NAME:-}"
head_sha="${GITHUB_SHA:-HEAD}"
compare_base=""
compare_head="${head_sha}"

case "${event_name}" in
  pull_request)
    compare_base="${GITHUB_BASE_SHA:-}"
    compare_head="${GITHUB_HEAD_SHA:-${head_sha}}"
    ;;
  push)
    compare_base="${GITHUB_EVENT_BEFORE:-}"
    ;;
esac

zero_sha="0000000000000000000000000000000000000000"

if [[ -n "${compare_base}" && "${compare_base}" != "${zero_sha}" ]] && \
  git rev-parse --verify "${compare_base}^{commit}" >/dev/null 2>&1; then
  changed_files="$(git diff --name-only "${compare_base}" "${compare_head}")"
else
  changed_files="$(git ls-tree -r --name-only "${compare_head}")"
fi

echo "Changed files for detection:" >&2
if [[ -n "${changed_files}" ]]; then
  printf '%s\n' "${changed_files}" >&2
else
  echo "(none)" >&2
fi

has_match() {
  local pattern="$1"

  if [[ -n "${changed_files}" ]] && printf '%s\n' "${changed_files}" | grep -E -q -- "${pattern}"; then
    echo "true"
    return
  fi

  echo "false"
}

for mapping in "$@"; do
  key="${mapping%%=*}"
  pattern="${mapping#*=}"
  value="$(has_match "${pattern}")"

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "${key}" "${value}" >> "${GITHUB_OUTPUT}"
  fi

  printf '%s=%s\n' "${key}" "${value}" >&2
done

export const DEFAULT_ROUTE_LINE_COLOR = "#3388ff";

export const ROUTE_LINE_COLOR_PRESETS = [
  "#3388ff",
  "#2563eb",
  "#14b8a6",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#111827",
];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeRouteLineColor(color?: string | null) {
  if (typeof color !== "string") {
    return DEFAULT_ROUTE_LINE_COLOR;
  }

  const trimmed = color.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed : DEFAULT_ROUTE_LINE_COLOR;
}

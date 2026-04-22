import type { PhotoData } from "../api/routes";

export type RouteMode = "auto" | "manual";
export type PhotoPreviewShape = "square" | "circle";

export interface RoutePoint {
  id: number;
  position: [number, number];
  name?: string;
  note?: string;
  markerColor?: string;
  markerSize?: number;
  previewSize?: number;
  previewShape?: PhotoPreviewShape;
  photo?: PhotoData;
}

export interface RouteSegment {
  fromIndex: number;
  toIndex: number;
  mode: RouteMode;
  durationMinutes?: number;
}

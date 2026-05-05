import React, { useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { TranslationKey } from "../i18n";
import { GeoSearchControl } from "./GeoSearchControl";
import { LeafletAttributionPrefix } from "./LeafletAttributionPrefix";
import { PointPopup } from "./RoutePointInspector";
import {
  ManualRoutes,
  RoutingControl,
  SegmentDurationMarkers,
} from "./RouteSegmentLayers";
import { buildSegmentsForAppendedPoints } from "../utils/routeEditorData";
import {
  DEFAULT_POINT_MARKER_SIZE,
  createColoredMarkerIcon,
  createMarkerIcon,
  getPhotoSrc,
} from "../utils/routePointStyles";
import type { OverlayRoute, RouteMode, RoutePoint, RouteSegment } from "../types/routeMap";
import type { RoutingEngineId } from "../utils/routingEngines";

const HistoricalMapOverlay = React.lazy(() =>
  import("./HistoricalMapOverlay").then((module) => ({ default: module.HistoricalMapOverlay })),
);
const RoutePlayback = React.lazy(() =>
  import("./RoutePlayback").then((module) => ({ default: module.RoutePlayback })),
);

function MapRefCapture({ mapRef }: { mapRef: MutableRefObject<L.Map | null> }) {
  const map = useMapEvents({});
  mapRef.current = map;
  return null;
}

function BaseTileLayer({ url, attribution }: { url: string; attribution: string }) {
  const map = useMapEvents({});
  const layerRef = useRef<L.TileLayer | null>(null);

  React.useEffect(() => {
    if (!layerRef.current) {
      layerRef.current = L.tileLayer(url, { attribution, zIndex: 0 }).addTo(map);
    } else {
      layerRef.current.setUrl(url);
    }
  }, [url, attribution, map]);

  React.useEffect(() => {
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map]);

  return null;
}

function MapClickHandler({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (event) => {
      const { lat, lng } = event.latlng;
      onMapClick(lat, lng);
    },
  });
  return null;
}

interface RouteMapCanvasProps {
  mapRef: MutableRefObject<L.Map | null>;
  tileUrl: string;
  tileAttribution: string;
  onMapClick: (lat: number, lng: number) => void;
  historicalMode: boolean;
  historicalYear: number;
  historicalOpacity: number;
  historicalCompareMode: boolean;
  historicalComparePosition: number;
  onHistoricalOverlayBusyChange: (busy: boolean) => void;
  routePoints: RoutePoint[];
  routeSegments: RouteSegment[];
  routeMode: RouteMode;
  routeLineColor: string;
  routingEngine: RoutingEngineId;
  selectedCategoryNames: string[];
  onSegmentDurationChange: (segment: RouteSegment, durationMinutes: number | undefined) => void;
  chatPreviewPoints: RoutePoint[];
  chatPreviewColor: string;
  onSelectPoint: (pointId: number) => void;
  onPointDrag: (pointId: number, lat: number, lng: number) => void;
  overlayRoutes: OverlayRoute[];
  playbackActive: boolean;
  onClosePlayback: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export function RouteMapCanvas({
  mapRef,
  tileUrl,
  tileAttribution,
  onMapClick,
  historicalMode,
  historicalYear,
  historicalOpacity,
  historicalCompareMode,
  historicalComparePosition,
  onHistoricalOverlayBusyChange,
  routePoints,
  routeSegments,
  routeMode,
  routeLineColor,
  routingEngine,
  selectedCategoryNames,
  onSegmentDurationChange,
  chatPreviewPoints,
  chatPreviewColor,
  onSelectPoint,
  onPointDrag,
  overlayRoutes,
  playbackActive,
  onClosePlayback,
  t,
}: RouteMapCanvasProps) {
  const waypoints = useMemo(
    () => routePoints.map((point) => L.latLng(point.position[0], point.position[1])),
    [routePoints],
  );
  const chatPreviewWaypoints = useMemo(
    () => chatPreviewPoints.map((point) => L.latLng(point.position[0], point.position[1])),
    [chatPreviewPoints],
  );
  const chatPreviewSegments = useMemo(
    () => buildSegmentsForAppendedPoints(0, chatPreviewPoints.length, routeMode),
    [chatPreviewPoints.length, routeMode],
  );

  return (
    <MapContainer
      center={[55.7518, 37.6178]}
      zoom={15}
      style={{ height: "100vh", width: "100%" }}
    >
      <LeafletAttributionPrefix />
      <BaseTileLayer url={tileUrl} attribution={tileAttribution} />
      <MapRefCapture mapRef={mapRef} />
      <MapClickHandler onMapClick={onMapClick} />
      <GeoSearchControl />
      {historicalMode && (
        <React.Suspense fallback={null}>
          <HistoricalMapOverlay
            year={historicalYear}
            opacity={historicalOpacity}
            comparePosition={historicalCompareMode ? historicalComparePosition : null}
            onBusyChange={onHistoricalOverlayBusyChange}
          />
        </React.Suspense>
      )}
      <RoutingControl
        waypoints={waypoints}
        routeSegments={routeSegments}
        color={routeLineColor}
        engineId={routingEngine}
        categoryNames={selectedCategoryNames}
      />
      <ManualRoutes
        waypoints={waypoints}
        routeSegments={routeSegments}
        color={routeLineColor}
        categoryNames={selectedCategoryNames}
      />
      <SegmentDurationMarkers
        waypoints={waypoints}
        routeSegments={routeSegments}
        editable
        onDurationChange={onSegmentDurationChange}
      />
      {chatPreviewPoints.length >= 2 && (
        <>
          <RoutingControl
            waypoints={chatPreviewWaypoints}
            routeSegments={chatPreviewSegments}
            color={chatPreviewColor}
            engineId={routingEngine}
            categoryNames={[]}
          />
          <ManualRoutes
            waypoints={chatPreviewWaypoints}
            routeSegments={chatPreviewSegments}
            color={chatPreviewColor}
            categoryNames={[]}
          />
        </>
      )}
      {chatPreviewPoints.map((point, index) => (
        <Marker
          key={`chat-preview-${index}-${point.position[0]}-${point.position[1]}`}
          position={point.position}
          icon={createColoredMarkerIcon(
            chatPreviewColor,
            undefined,
            undefined,
            undefined,
            chatPreviewColor,
            DEFAULT_POINT_MARKER_SIZE,
          )}
        >
          <Popup>
            <div className="point-popup">
              <div className="point-popup-header">
                <strong>{point.name?.trim() || t("map.point", { index: index + 1 })}</strong>
              </div>
              <div className="point-popup-coords">
                {t("map.coordinates")} {point.position[0].toFixed(6)},{" "}
                {point.position[1].toFixed(6)}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
      {routePoints.map((point, index) => (
        <Marker
          key={`${point.id}-${point.photo ? "photo" : "no-photo"}-${point.previewSize ?? "default"}-${point.previewShape ?? "default"}-${point.markerColor ?? "default"}-${point.markerSize ?? "default"}`}
          position={point.position}
          icon={createMarkerIcon(point.photo, point.previewSize, point.previewShape, point.markerColor, point.markerSize)}
          draggable={true}
          eventHandlers={{
            click: () => {
              onSelectPoint(point.id);
            },
            dragend: (event) => {
              const { lat, lng } = event.target.getLatLng();
              onPointDrag(point.id, lat, lng);
            },
          }}
        >
          {!playbackActive && !historicalMode && (
            <Popup>
              <PointPopup point={point} index={index} onEdit={onSelectPoint} />
            </Popup>
          )}
        </Marker>
      ))}
      {overlayRoutes.map((overlay) => {
        const overlayWaypoints = overlay.points.map((point) =>
          L.latLng(point.position[0], point.position[1])
        );
        return (
          <React.Fragment key={overlay.id}>
            <RoutingControl
              waypoints={overlayWaypoints}
              routeSegments={overlay.segments}
              color={overlay.color}
              engineId={routingEngine}
              categoryNames={[]}
            />
            <ManualRoutes
              waypoints={overlayWaypoints}
              routeSegments={overlay.segments}
              color={overlay.color}
              categoryNames={[]}
            />
            <SegmentDurationMarkers
              waypoints={overlayWaypoints}
              routeSegments={overlay.segments}
            />
            {overlay.points.map((point, index) => (
              <Marker
                key={`overlay-${overlay.id}-${index}-${point.previewSize ?? "default"}-${point.previewShape ?? "default"}-${point.markerColor ?? "default"}-${point.markerSize ?? "default"}`}
                position={point.position}
                icon={createColoredMarkerIcon(overlay.color, point.photo, point.previewSize, point.previewShape, point.markerColor, point.markerSize)}
              >
                {!playbackActive && !historicalMode && (
                  <Popup>
                    <div className="point-popup">
                      <div className="point-popup-header">
                        <strong>{overlay.name} — {t("map.point", { index: index + 1 })}</strong>
                      </div>
                      {point.name && <div className="point-popup-name">{point.name}</div>}
                      <div className="point-popup-coords">
                        {t("map.coordinates")} {point.position[0].toFixed(6)},{" "}
                        {point.position[1].toFixed(6)}
                      </div>
                      {point.note?.trim() && (
                        <div className="point-popup-note-text">{point.note}</div>
                      )}
                      {getPhotoSrc(point.photo) && (
                        <div className="point-popup-photo">
                          <img
                            src={point.photo?.original || getPhotoSrc(point.photo)}
                            alt={`${overlay.name} point ${index + 1}`}
                          />
                        </div>
                      )}
                    </div>
                  </Popup>
                )}
              </Marker>
            ))}
          </React.Fragment>
        );
      })}
      {playbackActive && routePoints.length >= 2 && (
        <React.Suspense fallback={null}>
          <RoutePlayback
            points={routePoints}
            segments={routeSegments}
            onClose={onClosePlayback}
          />
        </React.Suspense>
      )}
    </MapContainer>
  );
}

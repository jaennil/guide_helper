import { useCallback, useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
import { filterByDate } from '@openhistoricalmap/maplibre-gl-dates';

const OHM_STYLE_URL = 'https://www.openhistoricalmap.org/map-styles/main/main.json';

interface HistoricalMapOverlayProps {
  year: number;
  opacity: number;
  comparePosition?: number | null;
  onBusyChange?: (busy: boolean) => void;
}

export function HistoricalMapOverlay({
  year,
  opacity,
  comparePosition = null,
  onBusyChange,
}: HistoricalMapOverlayProps) {
  const map = useMap();
  const layerRef = useRef<L.MaplibreGL | null>(null);
  const glMapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const renderTokenRef = useRef(0);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestYearRef = useRef(year);
  const opacityRef = useRef(opacity);
  const comparePositionRef = useRef<number | null>(comparePosition);

  const applyCompareClipPath = useCallback(() => {
    if (!layerRef.current) {
      return;
    }

    const overlayContainer = layerRef.current.getContainer();
    const mapContainer = map.getContainer();

    if (!overlayContainer || !mapContainer) {
      return;
    }

    const splitPosition = comparePositionRef.current;

    if (splitPosition == null) {
      overlayContainer.style.clipPath = 'inset(0 0 0 0)';
      (overlayContainer.style as CSSStyleDeclaration & { webkitClipPath?: string }).webkitClipPath = 'inset(0 0 0 0)';
      return;
    }

    const overlayRect = overlayContainer.getBoundingClientRect();
    const mapRect = mapContainer.getBoundingClientRect();
    const splitX = mapRect.left + (mapRect.width * splitPosition) / 100;
    const topInset = Math.max(0, mapRect.top - overlayRect.top);
    const bottomInset = Math.max(0, overlayRect.bottom - mapRect.bottom);
    const leftInset = Math.max(0, mapRect.left - overlayRect.left);
    const rightInset = Math.max(0, overlayRect.right - splitX);
    const clipPath = `inset(${topInset}px ${rightInset}px ${bottomInset}px ${leftInset}px)`;

    overlayContainer.style.clipPath = clipPath;
    (overlayContainer.style as CSSStyleDeclaration & { webkitClipPath?: string }).webkitClipPath = clipPath;
  }, [map]);

  useEffect(() => {
    latestYearRef.current = year;
  }, [year]);

  useEffect(() => {
    opacityRef.current = opacity;
  }, [opacity]);

  useEffect(() => {
    comparePositionRef.current = comparePosition;
    applyCompareClipPath();
  }, [applyCompareClipPath, comparePosition]);

  // Create the MapLibre GL layer
  useEffect(() => {
    console.log('[historical] creating OHM overlay');

    const glOptions: L.LeafletMaplibreGLOptions & { pane: string } = {
      style: OHM_STYLE_URL,
      interactive: false,
      pane: 'overlayPane',
    };
    const gl = L.maplibreGL(glOptions);
    gl.addTo(map);
    layerRef.current = gl;

    const container = gl.getContainer();
    if (container) {
      // Keep in tilePane but set high z-index so it renders above base tiles
      container.style.zIndex = '500';
      container.style.opacity = String(opacityRef.current);
      container.style.pointerEvents = 'none';
      container.style.transition = 'opacity 160ms ease, clip-path 160ms ease';
      requestAnimationFrame(applyCompareClipPath);
      console.log('[historical] GL container configured, z-index=500');
    }

    const glMap = gl.getMaplibreMap();
    glMapRef.current = glMap;

    glMap.on('load', () => {
      console.log('[historical] MapLibre loaded');
      readyRef.current = true;
      renderTokenRef.current += 1;
      const renderToken = renderTokenRef.current;
      const markReady = () => {
        if (renderTokenRef.current !== renderToken) {
          return;
        }
        onBusyChange?.(false);
      };
      onBusyChange?.(true);
      glMap.once('idle', markReady);
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = setTimeout(markReady, 1200);
      filterByDate(glMap, String(latestYearRef.current));
      glMap.resize();
      glMap.triggerRepaint();
      requestAnimationFrame(applyCompareClipPath);
      console.log('[historical] date filter applied:', latestYearRef.current);
    });

    glMap.on('error', (e: maplibregl.ErrorEvent) => {
      console.error('[historical] MapLibre error:', e.error?.message || e);
    });

    // Force resize after map settles
    const resizeTimer = setInterval(() => {
      if (glMap.loaded()) {
        glMap.resize();
        glMap.triggerRepaint();
      }
    }, 2000);

    return () => {
      readyRef.current = false;
      clearInterval(resizeTimer);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
      onBusyChange?.(false);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
        glMapRef.current = null;
      }
    };
  }, [applyCompareClipPath, map, onBusyChange]);

  // Year filter
  useEffect(() => {
    if (!readyRef.current || !glMapRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (glMapRef.current && readyRef.current) {
        renderTokenRef.current += 1;
        const renderToken = renderTokenRef.current;
        const markReady = () => {
          if (renderTokenRef.current !== renderToken) {
            return;
          }
          onBusyChange?.(false);
        };
        console.log('[historical] filtering by year', year);
        onBusyChange?.(true);
        glMapRef.current.once('idle', markReady);
        if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
        settleTimeoutRef.current = setTimeout(markReady, 1200);
        filterByDate(glMapRef.current, String(year));
        glMapRef.current.resize();
        glMapRef.current.triggerRepaint();
        requestAnimationFrame(applyCompareClipPath);
      }
    }, 200);
  }, [applyCompareClipPath, onBusyChange, year]);

  // Opacity
  useEffect(() => {
    if (layerRef.current) {
      const c = layerRef.current.getContainer();
      if (c) c.style.opacity = String(opacity);
    }
  }, [opacity]);

  useEffect(() => {
    const syncClipPath = () => {
      requestAnimationFrame(applyCompareClipPath);
    };

    map.on('move', syncClipPath);
    map.on('zoom', syncClipPath);
    map.on('resize', syncClipPath);
    window.addEventListener('resize', syncClipPath);

    return () => {
      map.off('move', syncClipPath);
      map.off('zoom', syncClipPath);
      map.off('resize', syncClipPath);
      window.removeEventListener('resize', syncClipPath);
    };
  }, [applyCompareClipPath, map]);

  return null;
}

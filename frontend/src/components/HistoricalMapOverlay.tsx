import { useEffect, useRef } from 'react';
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
}

export function HistoricalMapOverlay({ year, opacity }: HistoricalMapOverlayProps) {
  const map = useMap();
  const layerRef = useRef<L.MaplibreGL | null>(null);
  const glMapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Create the MapLibre GL layer
  useEffect(() => {
    console.log('[historical] creating OHM overlay');

    const gl = L.maplibreGL({
      style: OHM_STYLE_URL,
      interactive: false,
      pane: 'overlayPane',
    } as any);
    gl.addTo(map);
    layerRef.current = gl;

    const container = gl.getContainer();
    if (container) {
      // Move from tilePane to overlayPane so it's not destroyed on tile switch
      const overlayPane = map.getPane('overlayPane');
      if (overlayPane && container.parentElement !== overlayPane) {
        overlayPane.appendChild(container);
        console.log('[historical] moved GL layer to overlayPane');
      }
      container.style.opacity = String(opacity);
      container.style.pointerEvents = 'none';
    }

    const glMap = gl.getMaplibreMap();
    glMapRef.current = glMap;

    glMap.on('load', () => {
      console.log('[historical] MapLibre loaded');
      readyRef.current = true;
      filterByDate(glMap, String(year));
      glMap.resize();
      glMap.triggerRepaint();
      console.log('[historical] date filter applied:', year);
    });

    glMap.on('error', (e: any) => {
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
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
        glMapRef.current = null;
      }
    };
  }, [map]);

  // Year filter
  useEffect(() => {
    if (!readyRef.current || !glMapRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (glMapRef.current && readyRef.current) {
        console.log('[historical] filtering by year', year);
        filterByDate(glMapRef.current, String(year));
        glMapRef.current.triggerRepaint();
      }
    }, 200);
  }, [year]);

  // Opacity
  useEffect(() => {
    if (layerRef.current) {
      const c = layerRef.current.getContainer();
      if (c) c.style.opacity = String(opacity);
    }
  }, [opacity]);

  return null;
}

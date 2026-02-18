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
  const yearRef = useRef(year);
  const readyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Create/destroy the MapLibre GL layer
  useEffect(() => {
    console.log('[historical] creating OHM overlay layer');
    const gl = L.maplibreGL({
      style: OHM_STYLE_URL,
      interactive: false,
    });

    gl.addTo(map);
    layerRef.current = gl;

    const glMap = gl.getMaplibreMap();
    glMapRef.current = glMap;

    // Use 'load' event — fires after style AND all sources/tiles are ready.
    // 'styledata' fires too early (before sources are loaded).
    glMap.once('load', () => {
      const layers = glMap.getStyle().layers;
      console.log(`[historical] OHM map loaded, ${layers.length} layers, applying year ${yearRef.current}`);
      readyRef.current = true;
      filterByDate(glMap, String(yearRef.current));
      console.log('[historical] initial date filter applied');
    });

    glMap.on('error', (e) => {
      console.error('[historical] MapLibre error:', e.error?.message || e);
    });

    return () => {
      readyRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (layerRef.current) {
        console.log('[historical] removing OHM overlay layer');
        map.removeLayer(layerRef.current);
        layerRef.current = null;
        glMapRef.current = null;
      }
    };
  }, [map]);

  // Update date filter when year changes (debounced to avoid flooding setFilter calls)
  useEffect(() => {
    yearRef.current = year;
    if (!readyRef.current || !glMapRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (glMapRef.current && readyRef.current) {
        console.log('[historical] filtering by year', year);
        filterByDate(glMapRef.current, String(year));
      }
    }, 150);
  }, [year]);

  // Update opacity
  useEffect(() => {
    if (layerRef.current) {
      const container = layerRef.current.getContainer();
      if (container) {
        container.style.opacity = String(opacity);
        console.log('[historical] opacity set to', opacity);
      }
    }
  }, [opacity]);

  return null;
}

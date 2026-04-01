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

    // Apply vintage style to the GL container
    const container = gl.getContainer();
    if (container) {
      container.style.filter = 'sepia(0.4) saturate(0.7) contrast(1.1)';
      container.style.mixBlendMode = 'multiply';
    }

    const glMap = gl.getMaplibreMap();
    glMapRef.current = glMap;

    const applyFilter = () => {
      if (readyRef.current) return;
      const style = glMap.getStyle();
      if (!style?.layers?.length) return;
      console.log(`[historical] OHM ready, ${style.layers.length} layers, applying year ${yearRef.current}`);
      readyRef.current = true;
      filterByDate(glMap, String(yearRef.current));
      console.log('[historical] initial date filter applied');
    };

    glMap.once('load', applyFilter);
    glMap.on('styledata', () => {
      setTimeout(applyFilter, 500);
    });
    const fallbackInterval = setInterval(() => {
      if (glMap.isStyleLoaded()) {
        applyFilter();
        clearInterval(fallbackInterval);
      }
    }, 1000);

    glMap.on('error', (e: any) => {
      console.error('[historical] MapLibre error:', e.error?.message || e);
    });

    return () => {
      readyRef.current = false;
      clearInterval(fallbackInterval);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (layerRef.current) {
        console.log('[historical] removing OHM overlay layer');
        map.removeLayer(layerRef.current);
        layerRef.current = null;
        glMapRef.current = null;
      }
    };
  }, [map]);

  // Update date filter when year changes
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

  // Update opacity on the GL container
  useEffect(() => {
    const applyOpacity = () => {
      const glContainer = document.querySelector('.leaflet-gl-layer') as HTMLElement | null;
      if (glContainer) {
        glContainer.style.opacity = String(opacity);
        console.log('[historical] opacity set to', opacity);
      }
    };
    applyOpacity();
    // Also re-apply after a short delay (in case container was recreated)
    const timer = setTimeout(applyOpacity, 200);
    return () => clearTimeout(timer);
  }, [opacity]);

  return null;
}

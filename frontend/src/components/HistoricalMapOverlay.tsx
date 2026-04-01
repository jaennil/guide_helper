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

  useEffect(() => {
    console.log('[historical] creating OHM overlay layer');

    // Use overlayPane instead of tilePane to avoid conflicts with TileLayer key remounts
    const gl = L.maplibreGL({
      style: OHM_STYLE_URL,
      interactive: false,
      pane: 'overlayPane',
    });

    gl.addTo(map);
    layerRef.current = gl;

    // Apply vintage CSS filter
    const container = gl.getContainer();
    if (container) {
      container.style.filter = 'sepia(0.5) saturate(0.6) brightness(0.9)';
      container.style.opacity = String(opacity);
      container.style.pointerEvents = 'none';
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

      // Force a resize+render after filter
      setTimeout(() => {
        glMap.resize();
        glMap.triggerRepaint();
      }, 100);
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

    // Force resize after a delay to ensure the GL map fills the container
    setTimeout(() => {
      glMap.resize();
    }, 500);

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

  // Update date filter
  useEffect(() => {
    yearRef.current = year;
    if (!readyRef.current || !glMapRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (glMapRef.current && readyRef.current) {
        console.log('[historical] filtering by year', year);
        filterByDate(glMapRef.current, String(year));
        glMapRef.current.triggerRepaint();
      }
    }, 150);
  }, [year]);

  // Update opacity via layerRef (more reliable than DOM query)
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

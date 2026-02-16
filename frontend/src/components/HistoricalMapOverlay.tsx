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

  // Create/destroy the MapLibre GL layer
  useEffect(() => {
    const gl = L.maplibreGL({
      style: OHM_STYLE_URL,
      interactive: false,
    });

    gl.addTo(map);
    layerRef.current = gl;

    // Wait for the MapLibre map to load, then apply date filter
    const glMap = gl.getMaplibreMap();
    glMapRef.current = glMap;

    glMap.once('styledata', () => {
      console.log('[historical] OHM style loaded, filtering by year', yearRef.current);
      filterByDate(glMap, String(yearRef.current));
    });

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
        glMapRef.current = null;
      }
    };
  }, [map]);

  // Update date filter when year changes
  useEffect(() => {
    yearRef.current = year;
    if (glMapRef.current && glMapRef.current.isStyleLoaded()) {
      console.log('[historical] filtering by year', year);
      filterByDate(glMapRef.current, String(year));
    }
  }, [year]);

  // Update opacity
  useEffect(() => {
    if (layerRef.current) {
      const container = layerRef.current.getContainer();
      if (container) {
        container.style.opacity = String(opacity);
      }
    }
  }, [opacity]);

  return null;
}

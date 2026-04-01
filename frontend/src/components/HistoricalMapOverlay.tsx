import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const STADIA_API_KEY = import.meta.env.VITE_STADIA_API_KEY || '';

// Stamen Watercolor — художественный стиль «старинной акварельной карты»
function getWatercolorUrl(): string {
  return `https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg${STADIA_API_KEY ? `?api_key=${STADIA_API_KEY}` : ''}`;
}

// Stamen Toner Labels — подписи в стиле старой печатной карты (поверх watercolor)
function getTonerLabelsUrl(): string {
  return `https://tiles.stadiamaps.com/tiles/stamen_toner_labels/{z}/{x}/{y}.png${STADIA_API_KEY ? `?api_key=${STADIA_API_KEY}` : ''}`;
}

interface HistoricalMapOverlayProps {
  year: number;
  opacity: number;
}

export function HistoricalMapOverlay({ year: _year, opacity }: HistoricalMapOverlayProps) {
  void _year; // year prop reserved for future OHM date filtering
  const map = useMap();
  const watercolorRef = useRef<L.TileLayer | null>(null);
  const labelsRef = useRef<L.TileLayer | null>(null);

  // Create tile layers
  useEffect(() => {
    console.log('[historical] creating watercolor overlay');

    const watercolor = L.tileLayer(getWatercolorUrl(), {
      attribution: '&copy; <a href="https://stamen.com">Stamen Design</a> | <a href="https://stadiamaps.com">Stadia Maps</a>',
      opacity: opacity,
      maxZoom: 18,
    });
    watercolor.addTo(map);
    watercolorRef.current = watercolor;

    const labels = L.tileLayer(getTonerLabelsUrl(), {
      attribution: '',
      opacity: Math.min(opacity + 0.1, 1),
      maxZoom: 18,
    });
    labels.addTo(map);
    labelsRef.current = labels;

    return () => {
      console.log('[historical] removing watercolor overlay');
      if (watercolorRef.current) {
        map.removeLayer(watercolorRef.current);
        watercolorRef.current = null;
      }
      if (labelsRef.current) {
        map.removeLayer(labelsRef.current);
        labelsRef.current = null;
      }
    };
  }, [map]);

  // Update opacity
  useEffect(() => {
    if (watercolorRef.current) {
      watercolorRef.current.setOpacity(opacity);
    }
    if (labelsRef.current) {
      labelsRef.current.setOpacity(Math.min(opacity + 0.1, 1));
    }
    console.log('[historical] opacity set to', opacity);
  }, [opacity]);

  return null;
}

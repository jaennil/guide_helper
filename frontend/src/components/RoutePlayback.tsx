import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useLanguage } from '../context/LanguageContext';
import { getPhotoSrc, type RoutePoint, type RouteSegment } from '../pages/MapPage';
import {
  fetchDetailedPath,
  pathCumulativeDistances,
  interpolatePosition,
} from '../utils/routePath';
import { formatDistance, formatDuration } from '../utils/geo';
import './RoutePlayback.css';

interface RoutePlaybackProps {
  points: RoutePoint[];
  segments: RouteSegment[];
  onClose: () => void;
}

const SPEED_OPTIONS = [1, 2, 4, 8];

export function RoutePlayback({ points, segments, onClose }: RoutePlaybackProps) {
  const map = useMap();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [followCamera, setFollowCamera] = useState(true);

  // Photo card state
  const [activePhoto, setActivePhoto] = useState<{
    src: string;
    label: string;
  } | null>(null);
  const [photoHiding, setPhotoHiding] = useState(false);

  // Path data refs (stable across renders)
  const fullPathRef = useRef<[number, number][]>([]);
  const cumDistRef = useRef<number[]>([]);
  const pointIndicesRef = useRef<number[]>([]);

  // Leaflet layer refs
  const markerRef = useRef<L.Marker | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const remainingRef = useRef<L.Polyline | null>(null);

  // Animation refs
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const progressRef = useRef<number>(0);
  const playingRef = useRef<boolean>(false);
  const speedRef = useRef<number>(1);
  const followCameraRef = useRef<boolean>(true);

  // Photo tracking
  const shownPhotosRef = useRef<Set<number>>(new Set());
  const photoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync refs with state
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    followCameraRef.current = followCamera;
  }, [followCamera]);

  // ── Create Leaflet layers ──
  useEffect(() => {
    const markerIcon = L.divIcon({
      className: 'playback-marker',
      html: `
        <div class="playback-marker-pulse"></div>
        <div class="playback-marker-dot"></div>
        <div class="playback-marker-arrow" id="playback-arrow"></div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    const marker = L.marker([0, 0], { icon: markerIcon, zIndexOffset: 1000 }).addTo(map);
    markerRef.current = marker;

    const trail = L.polyline([], {
      color: '#4fc3f7',
      weight: 5,
      opacity: 0.9,
    }).addTo(map);
    trailRef.current = trail;

    const remaining = L.polyline([], {
      color: '#90a4ae',
      weight: 3,
      opacity: 0.4,
      dashArray: '8,6',
    }).addTo(map);
    remainingRef.current = remaining;

    return () => {
      map.removeLayer(marker);
      map.removeLayer(trail);
      map.removeLayer(remaining);
      markerRef.current = null;
      trailRef.current = null;
      remainingRef.current = null;
    };
  }, [map]);

  // ── Fetch detailed path ──
  useEffect(() => {
    let cancelled = false;

    async function loadPath() {
      setLoading(true);
      console.log('[playback] fetching detailed path...');

      try {
        const result = await fetchDetailedPath(points, segments);
        if (cancelled) return;

        fullPathRef.current = result.fullPath;
        pointIndicesRef.current = result.pointIndices;
        cumDistRef.current = pathCumulativeDistances(result.fullPath);

        console.log(`[playback] path ready: ${result.fullPath.length} points, total ${formatDistance(cumDistRef.current[cumDistRef.current.length - 1] || 0)}`);

        // Set initial positions
        if (result.fullPath.length > 0) {
          const start = result.fullPath[0];
          markerRef.current?.setLatLng(start);
          remainingRef.current?.setLatLngs(result.fullPath.map(p => L.latLng(p[0], p[1])));
          map.panTo(start, { animate: true });
        }

        setLoading(false);
        setPlaying(true);
      } catch (err) {
        console.error('[playback] failed to load path:', err);
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPath();

    return () => {
      cancelled = true;
    };
  }, [points, segments, map]);

  // ── Update visuals for a given progress value ──
  const updateVisuals = useCallback((prog: number) => {
    const path = fullPathRef.current;
    const cumDist = cumDistRef.current;
    if (path.length === 0) return;

    const { position, heading } = interpolatePosition(path, cumDist, prog);

    // Update marker position
    markerRef.current?.setLatLng(position);

    // Update arrow rotation
    const container = markerRef.current?.getElement();
    const arrow = container?.querySelector('#playback-arrow') as HTMLElement | null;
    if (arrow) {
      arrow.style.transform = `translate(-50%, -100%) rotate(${heading + 90}deg)`;
    }

    // Find the path index corresponding to this progress
    const totalDist = cumDist[cumDist.length - 1];
    const targetDist = prog * totalDist;
    let splitIdx = 0;
    for (let i = 1; i < cumDist.length; i++) {
      if (cumDist[i] >= targetDist) {
        splitIdx = i;
        break;
      }
      splitIdx = i;
    }

    // Update trail (path from start up to current position)
    const trailCoords = path.slice(0, splitIdx + 1).map(p => L.latLng(p[0], p[1]));
    trailCoords.push(L.latLng(position[0], position[1]));
    trailRef.current?.setLatLngs(trailCoords);

    // Update remaining path
    const remainCoords: L.LatLng[] = [L.latLng(position[0], position[1])];
    for (let i = splitIdx + 1; i < path.length; i++) {
      remainCoords.push(L.latLng(path[i][0], path[i][1]));
    }
    remainingRef.current?.setLatLngs(remainCoords);

    // Follow camera
    if (followCameraRef.current) {
      const bounds = map.getBounds();
      const latLng = L.latLng(position[0], position[1]);
      if (!bounds.contains(latLng)) {
        map.panTo(latLng, { animate: true, duration: 0.3 });
      }
    }

    // Check if we're passing a photo point
    checkPhotoPoints(prog);
  }, [map]);

  // ── Check photo points ──
  const checkPhotoPoints = useCallback((prog: number) => {
    const path = fullPathRef.current;
    const cumDist = cumDistRef.current;
    const pointIdxs = pointIndicesRef.current;
    if (path.length === 0 || cumDist.length === 0) return;

    const totalDist = cumDist[cumDist.length - 1];
    const currentDist = prog * totalDist;

    points.forEach((point, i) => {
      if (!point.photo || shownPhotosRef.current.has(i)) return;

      const pathIdx = pointIdxs[i];
      if (pathIdx === undefined) return;

      const pointDist = cumDist[pathIdx] || 0;
      // Trigger when we get close enough (within 1% of total distance)
      const threshold = totalDist * 0.01;

      if (currentDist >= pointDist - threshold && currentDist <= pointDist + threshold) {
        shownPhotosRef.current.add(i);

        const src = getPhotoSrc(point.photo);
        if (src) {
          console.log(`[playback] showing photo for point ${i}`);
          setPhotoHiding(false);
          setActivePhoto({
            src: point.photo?.original || src,
            label: t('playback.point', { index: i + 1 }),
          });

          // Clear previous timer
          if (photoTimerRef.current) clearTimeout(photoTimerRef.current);

          // Hide after 3 seconds
          photoTimerRef.current = setTimeout(() => {
            setPhotoHiding(true);
            setTimeout(() => {
              setActivePhoto(null);
              setPhotoHiding(false);
            }, 300);
          }, 3000);
        }
      }
    });
  }, [points, t]);

  // ── Animation loop ──
  useEffect(() => {
    if (loading) return;

    const animate = (time: number) => {
      if (!playingRef.current) {
        lastTimeRef.current = time;
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
      }

      const deltaMs = time - lastTimeRef.current;
      lastTimeRef.current = time;

      // Determine increment based on total path distance
      const totalDist = cumDistRef.current[cumDistRef.current.length - 1] || 1;
      // Base speed: ~50m per second at 1x
      const baseMetersPerSecond = 50;
      const metersThisFrame = baseMetersPerSecond * speedRef.current * (deltaMs / 1000);
      const progressIncrement = metersThisFrame / (totalDist * 1000);

      const newProgress = Math.min(1, progressRef.current + progressIncrement);
      progressRef.current = newProgress;
      setProgress(newProgress);
      updateVisuals(newProgress);

      if (newProgress >= 1) {
        playingRef.current = false;
        setPlaying(false);
        console.log('[playback] reached end of route');
        return;
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [loading, updateVisuals]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (photoTimerRef.current) clearTimeout(photoTimerRef.current);
    };
  }, []);

  // ── Control handlers ──
  const handlePlayPause = () => {
    if (progress >= 1) {
      // Restart from beginning
      progressRef.current = 0;
      setProgress(0);
      shownPhotosRef.current.clear();
      lastTimeRef.current = 0;
    }
    setPlaying(!playing);
  };

  const handleRewind = () => {
    const newProg = Math.max(0, progressRef.current - 0.1);
    progressRef.current = newProg;
    setProgress(newProg);
    updateVisuals(newProg);
  };

  const handleForward = () => {
    const newProg = Math.min(1, progressRef.current + 0.1);
    progressRef.current = newProg;
    setProgress(newProg);
    updateVisuals(newProg);
  };

  const handleSpeedCycle = () => {
    const currentIdx = SPEED_OPTIONS.indexOf(speed);
    const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
    setSpeed(SPEED_OPTIONS[nextIdx]);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newProg = Math.max(0, Math.min(1, x / rect.width));
    progressRef.current = newProg;
    setProgress(newProg);
    updateVisuals(newProg);
    // Reset shown photos if rewinding
    if (newProg < progressRef.current) {
      shownPhotosRef.current.clear();
    }
  };

  const handleClose = () => {
    setPlaying(false);
    if (photoTimerRef.current) clearTimeout(photoTimerRef.current);
    onClose();
  };

  // ── Compute stats ──
  const totalDistKm = cumDistRef.current[cumDistRef.current.length - 1] || 0;
  const travelledKm = totalDistKm * progress;
  const walkingTimeMin = (travelledKm / 5) * 60; // 5 km/h estimate

  // ── Loading state ──
  if (loading) {
    return (
      <div className="playback-loading">
        <div className="playback-loading-spinner" />
        <span>{t('playback.loading')}</span>
      </div>
    );
  }

  return (
    <>
      {/* Photo card */}
      {activePhoto && (
        <div className={`playback-photo-card${photoHiding ? ' hiding' : ''}`}>
          <img src={activePhoto.src} alt={activePhoto.label} />
          <div className="playback-photo-card-label">{activePhoto.label}</div>
        </div>
      )}

      {/* Controls */}
      <div className="playback-controls">
        <div className="playback-controls-row">
          <button
            className="playback-btn playback-btn-play"
            onClick={handlePlayPause}
            title={playing ? t('playback.pause') : t('playback.play')}
          >
            {playing ? '\u23F8' : '\u25B6'}
          </button>
          <button
            className="playback-btn"
            onClick={handleRewind}
            title={t('playback.rewind')}
          >
            \u23EA
          </button>
          <button
            className="playback-btn"
            onClick={handleForward}
            title={t('playback.forward')}
          >
            \u23E9
          </button>
          <button
            className="playback-btn playback-speed-btn"
            onClick={handleSpeedCycle}
            title={t('playback.speed')}
          >
            {speed}x
          </button>

          <div
            className="playback-progress-container"
            onClick={handleProgressClick}
          >
            <div
              className="playback-progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          <button
            className={`playback-btn${followCamera ? ' active' : ''}`}
            onClick={() => setFollowCamera(!followCamera)}
            title={t('playback.follow')}
          >
            {'\uD83D\uDCCD'}
          </button>
          <button
            className="playback-btn playback-close-btn"
            onClick={handleClose}
            title={t('playback.stop')}
          >
            \u2715
          </button>
        </div>

        <div className="playback-stats">
          <span className="playback-stat">
            <span className="playback-stat-icon">{'\uD83D\uDCCF'}</span>
            {t('playback.distance', { value: formatDistance(travelledKm) })}
          </span>
          <span className="playback-stat">
            <span className="playback-stat-icon">{'\u23F1'}</span>
            {t('playback.elapsed', { value: formatDuration(walkingTimeMin) })}
          </span>
        </div>
      </div>
    </>
  );
}

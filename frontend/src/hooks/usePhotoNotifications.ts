import { useEffect, useRef } from 'react';

interface PhotoNotificationOptions {
  routeId: string;
  enabled: boolean;
  onPhotoUpdate: (points: any[]) => void;
}

export function usePhotoNotifications({ routeId, enabled, onPhotoUpdate }: PhotoNotificationOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPhotoUpdateRef = useRef(onPhotoUpdate);
  onPhotoUpdateRef.current = onPhotoUpdate;

  useEffect(() => {
    if (!enabled || !routeId) {
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
      console.log('[ws] no access token, skipping WS connection');
      return;
    }

    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/api/v1/routes/${routeId}/ws?token=${encodeURIComponent(token)}`;
      console.log('[ws] connecting to', url);

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[ws] connected for route', routeId);
      };

      ws.onmessage = (event) => {
        console.log('[ws] received message');
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'photo_update' && data.points) {
            console.log('[ws] photo update received, updating points');
            onPhotoUpdateRef.current(data.points);
          }
        } catch (e) {
          console.error('[ws] failed to parse message:', e);
        }
      };

      ws.onclose = (event) => {
        console.log('[ws] disconnected, code:', event.code);
        wsRef.current = null;
        if (mounted && enabled) {
          console.log('[ws] reconnecting in 5s');
          reconnectTimerRef.current = setTimeout(connect, 5000);
        }
      };

      ws.onerror = (event) => {
        console.error('[ws] error:', event);
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [routeId, enabled]);
}

import type { LatLngExpression } from 'leaflet';
import 'react-leaflet'
import 'leaflet-routing-machine';

// Восстанавливаем дефолтные иконки, которые ломает Vite/React
delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Расширяем типы Leaflet для leaflet-routing-machine
declare module 'leaflet' {
  namespace Routing {
    interface OSRMv1Options {
      serviceUrl?: string;
      profile?: string;
    }

    interface OSRMv1 {
      new (options?: OSRMv1Options): any;
    }

    interface RoutingControlOptions {
      waypoints: LatLng[];
      routeWhileDragging?: boolean;
      addWaypoints?: boolean;
      draggableWaypoints?: boolean;
      fitSelectedRoutes?: boolean;
      showAlternatives?: boolean;
      router?: any;
    }

    class Control extends L.Control {
      constructor(options: RoutingControlOptions);
    }

    function control(options: RoutingControlOptions): Control;
    function osrmv1(options?: OSRMv1Options): any;
  }
}
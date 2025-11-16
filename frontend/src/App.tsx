import { useState, useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
  Polyline,
} from "react-leaflet";
import L from "leaflet";
import "leaflet-routing-machine";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import "./App.css";

type RouteMode = "auto" | "manual";

interface RoutePoint {
  id: number;
  position: [number, number];
}

interface RouteSegment {
  fromIndex: number;
  toIndex: number;
  mode: RouteMode;
}

function MapClickHandler({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      const { lat, lng } = e.latlng;
      onMapClick(lat, lng);
    },
  });
  return null;
}

interface RoutingControlData {
  control: L.Routing.Control;
  fromIndex: number;
  toIndex: number;
}

function RoutingControl({
  waypoints,
  routeSegments,
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
}) {
  const map = useMapEvents({});
  const routingControlsRef = useRef<Map<string, RoutingControlData>>(new Map());

  useEffect(() => {
    // Если точек меньше двух, удаляем все маршруты
    if (waypoints.length < 2) {
      routingControlsRef.current.forEach((data) => {
        map.removeControl(data.control);
      });
      routingControlsRef.current.clear();
      return;
    }

    // Создаем маршруты для всех сегментов в режиме auto
    routeSegments.forEach((segment) => {
      if (segment.mode === "auto") {
        const key = `${segment.fromIndex}-${segment.toIndex}`;

        // Если маршрут уже существует, пропускаем
        if (routingControlsRef.current.has(key)) {
          return;
        }

        const fromPoint = waypoints[segment.fromIndex];
        const toPoint = waypoints[segment.toIndex];

        if (fromPoint && toPoint) {
          // Создаем новый маршрут между точками
          const routingControl = L.Routing.control({
            waypoints: [fromPoint, toPoint],
            routeWhileDragging: false,
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: false,
            showAlternatives: false,
            router: L.Routing.osrmv1({
              serviceUrl: "https://router.project-osrm.org/route/v1",
              profile: "foot", // Пеший режим
            }),
          }).addTo(map);

          routingControlsRef.current.set(key, {
            control: routingControl,
            fromIndex: segment.fromIndex,
            toIndex: segment.toIndex,
          });

          // Скрываем панель управления маршрутизацией с небольшой задержкой
          setTimeout(() => {
            const container = map.getContainer();
            const routingContainers = container.querySelectorAll(
              ".leaflet-routing-container"
            );
            routingContainers.forEach((container) => {
              (container as HTMLElement).style.display = "none";
            });
          }, 100);
        }
      }
    });

    // Удаляем маршруты, которых больше нет в routeSegments
    routingControlsRef.current.forEach((data, key) => {
      const exists = routeSegments.some(
        (segment) =>
          segment.mode === "auto" &&
          segment.fromIndex === data.fromIndex &&
          segment.toIndex === data.toIndex
      );
      if (!exists) {
        map.removeControl(data.control);
        routingControlsRef.current.delete(key);
      }
    });
  }, [waypoints, routeSegments, map]);

  // Скрываем панели управления при каждом обновлении
  useEffect(() => {
    const container = map.getContainer();
    const routingContainers = container.querySelectorAll(
      ".leaflet-routing-container"
    );
    routingContainers.forEach((container) => {
      (container as HTMLElement).style.display = "none";
    });
  }, [routeSegments, map]);

  // Очистка только при размонтировании компонента
  useEffect(() => {
    return () => {
      routingControlsRef.current.forEach((data) => {
        try {
          map.removeControl(data.control);
        } catch (e) {
          // Игнорируем ошибки при удалении
        }
      });
      routingControlsRef.current.clear();
    };
  }, [map]);

  return null;
}

function ManualRoutes({
  waypoints,
  routeSegments,
}: {
  waypoints: L.LatLng[];
  routeSegments: RouteSegment[];
}) {
  // Создаем линии только для сегментов в режиме manual
  const routes: [number, number][][] = [];
  routeSegments.forEach((segment) => {
    if (segment.mode === "manual") {
      const fromPoint = waypoints[segment.fromIndex];
      const toPoint = waypoints[segment.toIndex];
      if (fromPoint && toPoint) {
        routes.push([
          [fromPoint.lat, fromPoint.lng],
          [toPoint.lat, toPoint.lng],
        ]);
      }
    }
  });

  return (
    <>
      {routes.map((route, index) => (
        <Polyline
          key={index}
          positions={route}
          color="#3388ff"
          weight={4}
          opacity={0.7}
        />
      ))}
    </>
  );
}

function App() {
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [routeMode, setRouteMode] = useState<RouteMode>("auto");
  const pointIdRef = useRef(0);

  const handleMapClick = (lat: number, lng: number) => {
    const newPoint: RoutePoint = {
      id: pointIdRef.current++,
      position: [lat, lng],
    };
    setRoutePoints((prev) => {
      const newPoints = [...prev, newPoint];

      // Если есть хотя бы одна предыдущая точка, создаем сегмент маршрута
      if (prev.length > 0) {
        const newSegment: RouteSegment = {
          fromIndex: prev.length - 1,
          toIndex: newPoints.length - 1,
          mode: routeMode,
        };
        setRouteSegments((prevSegments) => [...prevSegments, newSegment]);
      }

      return newPoints;
    });
  };

  const waypoints = routePoints.map((point) =>
    L.latLng(point.position[0], point.position[1])
  );

  return (
    <div className="App">
      <div className="mode-switcher">
        <label>
          <input
            type="radio"
            name="routeMode"
            value="auto"
            checked={routeMode === "auto"}
            onChange={(e) => setRouteMode(e.target.value as RouteMode)}
          />
          Auto (маршрут по дорогам)
        </label>
        <label>
          <input
            type="radio"
            name="routeMode"
            value="manual"
            checked={routeMode === "manual"}
            onChange={(e) => setRouteMode(e.target.value as RouteMode)}
          />
          Manual (прямая линия)
        </label>
      </div>
      <MapContainer
        center={[55.7518, 37.6178]}
        zoom={15}
        style={{ height: "100vh", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapClickHandler onMapClick={handleMapClick} />
        <RoutingControl waypoints={waypoints} routeSegments={routeSegments} />
        <ManualRoutes waypoints={waypoints} routeSegments={routeSegments} />
        {routePoints.map((point, index) => (
          <Marker key={point.id} position={point.position}>
            <Popup>
              Точка {index + 1}
              <br />
              Координаты: {point.position[0].toFixed(6)},{" "}
              {point.position[1].toFixed(6)}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export default App;

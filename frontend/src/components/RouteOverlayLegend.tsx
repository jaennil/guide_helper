interface RouteOverlayLegendProps {
  routes: Array<{
    id: string;
    name: string;
    color: string;
  }>;
}

export function RouteOverlayLegend({ routes }: RouteOverlayLegendProps) {
  if (routes.length === 0) {
    return null;
  }

  return (
    <div className="overlay-legend">
      {routes.map((route) => (
        <div key={route.id} className="overlay-legend-item">
          <span
            className="overlay-legend-color"
            style={{ backgroundColor: route.color }}
          />
          <span className="overlay-legend-name">{route.name}</span>
        </div>
      ))}
    </div>
  );
}

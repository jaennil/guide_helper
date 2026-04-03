import { useEffect } from "react";
import { useMap } from "react-leaflet";

export function LeafletAttributionPrefix() {
  const map = useMap();

  useEffect(() => {
    const control = map.attributionControl;
    if (!control) {
      return;
    }

    const originalPrefix =
      typeof control.options.prefix === "string" ? control.options.prefix : false;
    control.setPrefix(false);

    return () => {
      control.setPrefix(originalPrefix);
    };
  }, [map]);

  return null;
}

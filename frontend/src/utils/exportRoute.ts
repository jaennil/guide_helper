interface ExportPoint {
  lat: number;
  lng: number;
  name?: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateGpx(routeName: string, points: ExportPoint[]): string {
  const wpts = points
    .map((p, i) => {
      const name = p.name || `Point ${i + 1}`;
      return `  <wpt lat="${p.lat}" lon="${p.lng}">\n    <name>${escapeXml(name)}</name>\n  </wpt>`;
    })
    .join('\n');

  const trkpts = points
    .map((p) => `      <trkpt lat="${p.lat}" lon="${p.lng}" />`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Guide Helper"
     xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(routeName)}</name>
  </metadata>
${wpts}
  <trk>
    <name>${escapeXml(routeName)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export function generateKml(routeName: string, points: ExportPoint[]): string {
  const placemarks = points
    .map((p, i) => {
      const name = p.name || `Point ${i + 1}`;
      return `    <Placemark>
      <name>${escapeXml(name)}</name>
      <Point>
        <coordinates>${p.lng},${p.lat},0</coordinates>
      </Point>
    </Placemark>`;
    })
    .join('\n');

  const coords = points.map((p) => `${p.lng},${p.lat},0`).join(' ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(routeName)}</name>
    <Placemark>
      <name>${escapeXml(routeName)}</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>
${placemarks}
  </Document>
</kml>`;
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportAsGpx(routeName: string, points: ExportPoint[]) {
  const gpx = generateGpx(routeName, points);
  const filename = `${routeName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_')}.gpx`;
  downloadFile(gpx, filename, 'application/gpx+xml');
}

export function exportAsKml(routeName: string, points: ExportPoint[]) {
  const kml = generateKml(routeName, points);
  const filename = `${routeName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_')}.kml`;
  downloadFile(kml, filename, 'application/vnd.google-earth.kml+xml');
}

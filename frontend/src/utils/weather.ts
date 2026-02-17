import type { GeoPoint } from "./geo";

export interface CurrentWeather {
  temperature: number;
  humidity: number;
  weathercode: number;
  windspeed: number;
}

export interface DailyForecast {
  date: string;
  weathercode: number;
  tempMax: number;
  tempMin: number;
}

export interface WeatherData {
  current: CurrentWeather;
  daily: DailyForecast[];
}

/** Map WMO weathercode to i18n key suffix */
export function getWeatherDescription(code: number): string {
  if (code === 0) return "clear";
  if (code <= 3) return "partlyCloudy";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain";
  if (code <= 86) return "snow";
  if (code >= 95) return "thunderstorm";
  return "cloudy";
}

/** Map WMO weathercode to unicode weather icon */
export function getWeatherIcon(code: number): string {
  if (code === 0) return "\u2600\uFE0F";
  if (code <= 2) return "\u26C5";
  if (code === 3) return "\u2601\uFE0F";
  if (code <= 48) return "\uD83C\uDF2B\uFE0F";
  if (code <= 57) return "\uD83C\uDF26\uFE0F";
  if (code <= 67) return "\uD83C\uDF27\uFE0F";
  if (code <= 77) return "\u2744\uFE0F";
  if (code <= 82) return "\uD83C\uDF27\uFE0F";
  if (code <= 86) return "\u2744\uFE0F";
  if (code >= 95) return "\u26C8\uFE0F";
  return "\u2601\uFE0F";
}

/** Fetch weather for route centroid from Open-Meteo Forecast API */
export async function fetchWeather(points: GeoPoint[]): Promise<WeatherData> {
  if (points.length === 0) {
    throw new Error("No points provided");
  }

  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat.toFixed(6)}&longitude=${lng.toFixed(6)}` +
    `&current=temperature_2m,relative_humidity_2m,weathercode,windspeed_10m` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=3`;

  console.log(`[weather] fetching weather for centroid ${lat.toFixed(4)}, ${lng.toFixed(4)}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Weather API error: ${res.status}`);
  }

  const data = await res.json();
  console.log("[weather] received data:", data);

  const current: CurrentWeather = {
    temperature: data.current.temperature_2m,
    humidity: data.current.relative_humidity_2m,
    weathercode: data.current.weathercode,
    windspeed: data.current.windspeed_10m,
  };

  const daily: DailyForecast[] = data.daily.time.map(
    (date: string, i: number) => ({
      date,
      weathercode: data.daily.weathercode[i],
      tempMax: data.daily.temperature_2m_max[i],
      tempMin: data.daily.temperature_2m_min[i],
    })
  );

  return { current, daily };
}

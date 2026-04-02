// ============================================================
// Weather Data Client — NOAA GFS Ensemble via Open-Meteo
// Fetches probabilistic temperature forecasts for Kalshi
// weather bracket trading.
//
// Open-Meteo provides free GFS ensemble data (31 members)
// without an API key. Each ensemble member is an independent
// weather simulation — we use the spread to compute
// probability distributions for temperature brackets.
// ============================================================

// Cities Kalshi typically offers weather markets for
// Format: { name, lat, lon, kalshiPrefix }
export const KALSHI_CITIES = [
  { name: "New York", lat: 40.7128, lon: -74.006, prefix: "KXHIGHNY" },
  { name: "Chicago", lat: 41.8781, lon: -87.6298, prefix: "KXHIGHCHI" },
  { name: "Los Angeles", lat: 34.0522, lon: -118.2437, prefix: "KXHIGHLA" },
  { name: "Miami", lat: 25.7617, lon: -80.1918, prefix: "KXHIGHMIA" },
  { name: "Austin", lat: 30.2672, lon: -97.7431, prefix: "KXHIGHAUS" },
  { name: "Denver", lat: 39.7392, lon: -104.9903, prefix: "KXHIGHDEN" },
  { name: "Atlanta", lat: 33.749, lon: -84.388, prefix: "KXHIGHATL" },
  { name: "Phoenix", lat: 33.4484, lon: -112.074, prefix: "KXHIGHPHX" },
  { name: "Seattle", lat: 47.6062, lon: -122.3321, prefix: "KXHIGHSEA" },
  { name: "Philadelphia", lat: 39.9526, lon: -75.1652, prefix: "KXHIGHPHI" },
] as const;

export type CityConfig = (typeof KALSHI_CITIES)[number];

export interface EnsembleForecast {
  city: CityConfig;
  date: string; // YYYY-MM-DD
  // All 31 ensemble member high-temp predictions (°F)
  highTemps: number[];
  // Derived stats
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
}

export interface BracketProbability {
  bracketLow: number; // e.g., 75
  bracketHigh: number; // e.g., 79
  label: string; // e.g., "75°F to 79°F"
  probability: number; // 0-1, from ensemble
  ensembleHits: number; // how many members fall in this bracket
  totalMembers: number;
}

// Fetch GFS ensemble forecast from Open-Meteo (free, no API key)
export async function fetchEnsembleForecast(
  city: CityConfig,
  targetDate: string
): Promise<EnsembleForecast> {
  // Open-Meteo ensemble API provides all 31 GFS members
  const url = new URL("https://ensemble-api.open-meteo.com/v1/ensemble");
  url.searchParams.set("latitude", city.lat.toString());
  url.searchParams.set("longitude", city.lon.toString());
  url.searchParams.set("daily", "temperature_2m_max");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("models", "gfs_seamless");
  url.searchParams.set("start_date", targetDate);
  url.searchParams.set("end_date", targetDate);

  console.log(`  Fetching ensemble for ${city.name} on ${targetDate}...`);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();

  // Extract all ensemble member high temps
  // The API returns temperature_2m_max_member0 through temperature_2m_max_member30
  const highTemps: number[] = [];
  const daily = data.daily || {};

  for (let i = 0; i <= 30; i++) {
    const key = `temperature_2m_max_member${i}`;
    if (daily[key] && daily[key][0] != null) {
      highTemps.push(daily[key][0]);
    }
  }

  if (highTemps.length === 0) {
    throw new Error(`No ensemble data for ${city.name} on ${targetDate}`);
  }

  // Compute stats
  const sorted = [...highTemps].sort((a, b) => a - b);
  const mean = highTemps.reduce((a, b) => a + b, 0) / highTemps.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance =
    highTemps.reduce((sum, t) => sum + (t - mean) ** 2, 0) / highTemps.length;
  const stdDev = Math.sqrt(variance);

  return {
    city,
    date: targetDate,
    highTemps: sorted,
    mean: Math.round(mean * 10) / 10,
    median: Math.round(median * 10) / 10,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stdDev: Math.round(stdDev * 10) / 10,
  };
}

// Compute probability for each temperature bracket from ensemble
// Kalshi brackets are typically 5°F wide: 60-64, 65-69, 70-74, etc.
export function computeBracketProbabilities(
  forecast: EnsembleForecast,
  brackets: { low: number; high: number }[]
): BracketProbability[] {
  const total = forecast.highTemps.length;

  return brackets.map(({ low, high }) => {
    // Count how many ensemble members fall in this bracket
    // Kalshi uses "High temperature X°F to Y°F" — inclusive on both ends
    const hits = forecast.highTemps.filter((t) => t >= low && t <= high).length;
    const probability = hits / total;

    return {
      bracketLow: low,
      bracketHigh: high,
      label: `${low}°F to ${high}°F`,
      probability,
      ensembleHits: hits,
      totalMembers: total,
    };
  });
}

// Generate standard 5°F brackets covering the likely range
export function generateBrackets(
  forecast: EnsembleForecast,
  width: number = 5
): { low: number; high: number }[] {
  // Start from well below min to well above max
  const rangeMin = Math.floor((forecast.min - 15) / width) * width;
  const rangeMax = Math.ceil((forecast.max + 15) / width) * width;

  const brackets: { low: number; high: number }[] = [];
  for (let low = rangeMin; low < rangeMax; low += width) {
    brackets.push({ low, high: low + width - 1 });
  }
  return brackets;
}

// Fetch forecasts for all Kalshi cities
export async function fetchAllCityForecasts(
  targetDate: string
): Promise<EnsembleForecast[]> {
  const forecasts: EnsembleForecast[] = [];

  for (const city of KALSHI_CITIES) {
    try {
      const forecast = await fetchEnsembleForecast(city, targetDate);
      forecasts.push(forecast);
      // Rate limit — be nice to free API
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(
        `  Failed for ${city.name}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return forecasts;
}

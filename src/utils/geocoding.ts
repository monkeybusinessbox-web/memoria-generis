export interface GeoPoint {
  lat: number;
  lng: number;
}

const KNOWN_PLACES: Record<string, GeoPoint> = {
  москва: { lat: 55.7558, lng: 37.6173 },
  'санкт-петербург': { lat: 59.9343, lng: 30.3351 },
  петербург: { lat: 59.9343, lng: 30.3351 },
  ленинград: { lat: 59.9343, lng: 30.3351 },
  петроград: { lat: 59.9343, lng: 30.3351 },
  кострома: { lat: 57.7679, lng: 40.9269 },
  ярославль: { lat: 57.6261, lng: 39.8845 },
  'нижний новгород': { lat: 56.3269, lng: 44.0059 },
  горький: { lat: 56.3269, lng: 44.0059 },
  томск: { lat: 56.4846, lng: 84.9476 },
  тверь: { lat: 56.8587, lng: 35.9176 },
  калинин: { lat: 56.8587, lng: 35.9176 },
  казань: { lat: 55.7961, lng: 49.1064 },
  'петропавловск-камчатский': { lat: 53.0242, lng: 158.6435 },
  воронеж: { lat: 51.6608, lng: 39.2003 },
  'воронежский фронт': { lat: 51.6608, lng: 39.2003 },
  екатеринбург: { lat: 56.8389, lng: 60.6057 },
  свердловск: { lat: 56.8389, lng: 60.6057 },
  новосибирск: { lat: 55.0084, lng: 82.9357 },
  самара: { lat: 53.1959, lng: 50.1002 },
  куйбышев: { lat: 53.1959, lng: 50.1002 },
  саратов: { lat: 51.5336, lng: 46.0343 },
  пермь: { lat: 58.0105, lng: 56.2502 },
  омск: { lat: 54.9885, lng: 73.3242 },
  челябинск: { lat: 55.1644, lng: 61.4368 },
  уфа: { lat: 54.7388, lng: 55.9721 },
  волгоград: { lat: 48.708, lng: 44.5133 },
  сталинград: { lat: 48.708, lng: 44.5133 },
  царицын: { lat: 48.708, lng: 44.5133 },
  'ростов-на-дону': { lat: 47.2357, lng: 39.7015 },
  краснодар: { lat: 45.0355, lng: 38.9753 },
  сочи: { lat: 43.5855, lng: 39.7231 },
  архангельск: { lat: 64.5399, lng: 40.5158 },
  мурманск: { lat: 68.9585, lng: 33.0827 },
  владивосток: { lat: 43.1155, lng: 131.8855 },
  иркутск: { lat: 52.2869, lng: 104.305 },
  красноярск: { lat: 56.0153, lng: 92.8932 },
  владимир: { lat: 56.1291, lng: 40.4066 },
  суздаль: { lat: 56.4193, lng: 40.4494 },
  псков: { lat: 57.8193, lng: 28.3318 },
  новгород: { lat: 58.5213, lng: 31.271 },
  'великий новгород': { lat: 58.5213, lng: 31.271 },
  смоленск: { lat: 54.7818, lng: 32.0401 },
  тула: { lat: 54.1931, lng: 37.6173 },
  рязань: { lat: 54.6296, lng: 39.7425 },
  калуга: { lat: 54.5138, lng: 36.2612 },
  орёл: { lat: 52.9676, lng: 36.0695 },
  курск: { lat: 51.7304, lng: 36.1926 },
  вологда: { lat: 59.2205, lng: 39.8915 },
  оренбург: { lat: 51.7682, lng: 55.0968 },
  астрахань: { lat: 46.3476, lng: 48.0302 },
  калининград: { lat: 54.7104, lng: 20.4522 },
  кёнигсберг: { lat: 54.7104, lng: 20.4522 },
  киев: { lat: 50.4501, lng: 30.5234 },
  харьков: { lat: 49.9935, lng: 36.2304 },
  одесса: { lat: 46.4825, lng: 30.7233 },
  львов: { lat: 49.8397, lng: 24.0297 },
  минск: { lat: 53.9006, lng: 27.559 },
  гродно: { lat: 53.6694, lng: 23.8131 },
  рига: { lat: 56.9496, lng: 24.1052 },
  таллин: { lat: 59.437, lng: 24.7536 },
  вильнюс: { lat: 54.6872, lng: 25.2797 },
  тбилиси: { lat: 41.7151, lng: 44.8271 },
  тифлис: { lat: 41.7151, lng: 44.8271 },
  ереван: { lat: 40.1872, lng: 44.5152 },
  баку: { lat: 40.4093, lng: 49.8671 },
  алматы: { lat: 43.222, lng: 76.8512 },
  ташкент: { lat: 41.2995, lng: 69.2401 },
  варшава: { lat: 52.2297, lng: 21.0122 },
  прага: { lat: 50.0755, lng: 14.4378 },
  берлин: { lat: 52.52, lng: 13.405 },
  мюнхен: { lat: 48.1351, lng: 11.582 },
  вена: { lat: 48.2082, lng: 16.3738 },
  париж: { lat: 48.8566, lng: 2.3522 },
  ницца: { lat: 43.7102, lng: 7.262 },
  лондон: { lat: 51.5072, lng: -0.1276 },
  рим: { lat: 41.9028, lng: 12.4964 },
  мадрид: { lat: 40.4168, lng: -3.7038 },
  стамбул: { lat: 41.0082, lng: 28.9784 },
  харбин: { lat: 45.8038, lng: 126.535 },
  токио: { lat: 35.6762, lng: 139.6503 },
  'нью-йорк': { lat: 40.7128, lng: -74.006 },
  'сан-франциско': { lat: 37.7749, lng: -122.4194 },
  чикаго: { lat: 41.8781, lng: -87.6298 },
  торонто: { lat: 43.6532, lng: -79.3832 },
  тельавив: { lat: 32.0853, lng: 34.7818 },
  'тель-авив': { lat: 32.0853, lng: 34.7818 },
  иерусалим: { lat: 31.7683, lng: 35.2137 },
};

export function normalizePlaceName(raw: string): string {
  return raw.trim().toLowerCase().replace(/ё/g, 'е');
}

export function resolvePlaceCoords(
  rawPlace: string,
  customPlaceCoords?: Record<string, GeoPoint>
): GeoPoint | null {
  const norm = normalizePlaceName(rawPlace);
  if (!norm) return null;

  if (customPlaceCoords && customPlaceCoords[norm]) {
    return customPlaceCoords[norm];
  }
  if (KNOWN_PLACES[norm]) {
    return KNOWN_PLACES[norm];
  }

  // Try matching city before comma (e.g. "Ярославль, Казанский собор" -> "ярославль")
  const parts = norm.split(/[,;()]/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (customPlaceCoords && customPlaceCoords[part]) return customPlaceCoords[part];
    if (KNOWN_PLACES[part]) return KNOWN_PLACES[part];
  }

  // Substring match against known cities
  for (const [key, coords] of Object.entries(KNOWN_PLACES)) {
    if (norm.includes(key)) {
      return coords;
    }
  }
  return null;
}

export function formatCoordsDisplay(coords: GeoPoint): string {
  return `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
}

function parseDmsPart(part: string): { value: number; hemi: 'N' | 'S' | 'E' | 'W' | null } | null {
  const trimmed = part.trim();
  if (!trimmed) return null;

  let hemi: 'N' | 'S' | 'E' | 'W' | null = null;
  if (/(?:[nN]|с\.?\s*ш\.?)/i.test(trimmed)) hemi = 'N';
  else if (/(?:[sS]|ю\.?\s*ш\.?)/i.test(trimmed)) hemi = 'S';
  else if (/(?:[eE]|в\.?\s*д\.?)/i.test(trimmed)) hemi = 'E';
  else if (/(?:[wW]|з\.?\s*д\.?)/i.test(trimmed)) hemi = 'W';

  const sign = trimmed.startsWith('-') ? -1 : 1;
  const nums = trimmed.match(/\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length === 0 || nums.length > 3) return null;

  const deg = parseFloat(nums[0].replace(',', '.'));
  const min = nums[1] ? parseFloat(nums[1].replace(',', '.')) : 0;
  const sec = nums[2] ? parseFloat(nums[2].replace(',', '.')) : 0;
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  if (min >= 60 || sec >= 60) return null;

  let value = sign * (Math.abs(deg) + min / 60 + sec / 3600);
  if (hemi === 'S' || hemi === 'W') {
    value = -Math.abs(value);
  }
  return { value, hemi };
}

/**
 * Parses coordinate strings in common formats:
 * - Decimal: "55.7558, 37.6173", "55.7558 37.6173", "55,7558; 37,6173"
 * - DMS / DDM: "55°45'21\"N 37°37'02\"E", "55° 45′ 21″ с.ш., 37° 37′ 02″ в.д."
 */
export function parseCoordinatesInput(raw: string): GeoPoint | null {
  const input = raw.trim();
  if (!input) return null;

  // 1. Fast decimal pair check: two signed numbers separated by comma/semicolon/whitespace
  const decMatch = input.match(
    /^\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*[,;\s/]+\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*$/
  );
  if (decMatch) {
    const lat = parseFloat(decMatch[1].replace(',', '.'));
    const lng = parseFloat(decMatch[2].replace(',', '.'));
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      return { lat, lng };
    }
    return null;
  }

  // 2. DMS / hemisphere-annotated formats: split into two parts
  const twoPartsMatch = input.match(
    /^\s*([^,;]+?(?:[NSEWnsew]|с\.?\s*ш\.?|ю\.?\s*ш\.?|в\.?\s*д\.?|з\.?\s*д\.?|["″'′°]))\s*[,;\s/]+\s*(.+)\s*$/
  );
  let parts: string[] = [];
  if (twoPartsMatch) {
    parts = [twoPartsMatch[1], twoPartsMatch[2]];
  } else {
    parts = input.split(/[;/]+/).map((s) => s.trim()).filter(Boolean);
  }

  if (parts.length !== 2) return null;

  const p1 = parseDmsPart(parts[0]);
  const p2 = parseDmsPart(parts[1]);
  if (!p1 || !p2) return null;

  let lat = p1.value;
  let lng = p2.value;
  if ((p1.hemi === 'E' || p1.hemi === 'W') && (p2.hemi === 'N' || p2.hemi === 'S')) {
    lat = p2.value;
    lng = p1.value;
  }

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

export async function lookupPlaceOnlineNominatim(placeName: string): Promise<GeoPoint | null> {
  const fullQuery = placeName.trim();
  const shortQuery = placeName.split(/[,;]/)[0]?.trim() || fullQuery;
  const queries =
    fullQuery && shortQuery && fullQuery !== shortQuery ? [fullQuery, shortQuery] : [fullQuery];

  for (const query of queries) {
    if (!query) continue;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&q=${encodeURIComponent(
          query
        )}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as Array<{ lat: string; lon: string }>;
      if (data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function reverseLookupPlaceNominatim(
  coords: GeoPoint
): Promise<{ label: string; displayName: string } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        coords.lat
      )}&lon=${encodeURIComponent(coords.lng)}&zoom=12&accept-language=ru`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      name?: string;
      address?: Record<string, string>;
    };
    const addr = data.address || {};
    const locality =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.hamlet ||
      addr.settlement ||
      addr.municipality ||
      addr.county ||
      data.name ||
      '';
    const region = addr.state || addr.region || addr.province || addr.country || '';
    const label = [locality, region && region !== locality ? region : '']
      .filter(Boolean)
      .join(', ');
    const displayName = data.display_name || label;
    if (!label && !displayName) return null;
    return {
      label: label || displayName,
      displayName,
    };
  } catch {
    return null;
  }
}

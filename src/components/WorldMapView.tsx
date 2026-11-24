import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  MapPin,
  Navigation,
  Pencil,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { Person, TreeDocument } from '../types/genealogy';
import {
  EVENT_TYPE_LABELS,
  formatFullName,
  formatGenealogyDate,
  getPersonInitials,
  getPrimaryPhotoObj,
  parseGenealogyDate,
} from '../utils/dateUtils';
import {
  GeoPoint,
  formatCoordsDisplay,
  lookupPlaceOnlineNominatim,
  normalizePlaceName,
  parseCoordinatesInput,
  resolvePlaceCoords,
  reverseLookupPlaceNominatim,
} from '../utils/geocoding';
import { computeLineageColors } from '../utils/lineageColors';

interface WorldMapViewProps {
  tree: TreeDocument;
  onSelectPersonInTree: (personId: string) => void;
  onSavePlaceCoords: (placeKey: string, coords: GeoPoint) => void;
  onUpdatePlaceAddress: (oldPlace: string, newPlace: string, newCoords?: GeoPoint | null) => void;
}

interface PersonPlaceStop {
  person: Person;
  place: string;
  year: number | null;
  sortKey: number;
  dateLabel: string;
  eventLabel: string;
  coords: GeoPoint | null;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a gentle curved arc in projected Mercator coordinates so arrows align 100% accurately
 * at every latitude and zoom level without Mercator aspect distortion.
 */
function buildCurvedRouteAndArrow(
  from: GeoPoint,
  to: GeoPoint
): {
  arcPoints: [number, number][];
  arrowLatLng: [number, number];
  arrowAngleDeg: number;
} {
  const p1 = L.CRS.EPSG3857.project(L.latLng(from.lat, from.lng));
  const p2 = L.CRS.EPSG3857.project(L.latLng(to.lat, to.lng));

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;

  // Gentle perpendicular bow (~10% of distance) in Mercator metric space
  const bow = Math.min(len * 0.12, 260000);
  const nx = -dy / len;
  const ny = dx / len;
  const ctrl = L.point((p1.x + p2.x) / 2 + nx * bow, (p1.y + p2.y) / 2 + ny * bow);

  const arcPoints: [number, number][] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const omt = 1 - t;
    const mx = omt * omt * p1.x + 2 * omt * t * ctrl.x + t * t * p2.x;
    const my = omt * omt * p1.y + 2 * omt * t * ctrl.y + t * t * p2.y;
    const ll = L.CRS.EPSG3857.unproject(L.point(mx, my));
    arcPoints.push([ll.lat, ll.lng]);
  }

  // Evaluate incoming tangent right before arrival (t = 0.96) so the arrow points straight into the destination city
  const t = 0.96;
  const omt = 1 - t;
  const tanX = 2 * omt * (ctrl.x - p1.x) + 2 * t * (p2.x - ctrl.x);
  const tanY = -(2 * omt * (ctrl.y - p1.y) + 2 * t * (p2.y - ctrl.y));
  const arrowAngleDeg = (Math.atan2(tanY, tanX) * 180) / Math.PI;

  return {
    arcPoints,
    arrowLatLng: [to.lat, to.lng],
    arrowAngleDeg,
  };
}

export function WorldMapView({
  tree,
  onSelectPersonInTree,
  onSavePlaceCoords,
  onUpdatePlaceAddress,
}: WorldMapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const [selectedPersonId, setSelectedPersonId] = useState<string>('all');
  const [filterByYear, setFilterByYear] = useState<boolean>(false);
  const [activeYear, setActiveYear] = useState<number>(1950);
  const [pickingPlace, setPickingPlace] = useState<string | null>(null);
  const [resolvingPlace, setResolvingPlace] = useState<string | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState<boolean>(false);
  const [placesListOpen, setPlacesListOpen] = useState<boolean>(false);

  // Coordinate search & geotagging state
  const [coordQuery, setCoordQuery] = useState('');
  const [coordError, setCoordError] = useState<string | null>(null);
  const [searchedGeo, setSearchedGeo] = useState<{
    coords: GeoPoint;
    label: string;
    displayName: string;
    isLoading: boolean;
  } | null>(null);
  const [bindTargetPlace, setBindTargetPlace] = useState<string>('');
  const [coordBindSuccess, setCoordBindSuccess] = useState<string | null>(null);

  // Place address / coordinate correction editor state
  const [editingPlace, setEditingPlace] = useState<string | null>(null);
  const [editAddressInput, setEditAddressInput] = useState('');
  const [editCoordsInput, setEditCoordsInput] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSearchingAddr, setEditSearchingAddr] = useState(false);

  const lineage = useMemo(() => computeLineageColors(tree), [tree]);
  const personList = useMemo(
    () =>
      Object.values(tree.persons).sort((a, b) =>
        formatFullName(a).localeCompare(formatFullName(b), 'ru')
      ),
    [tree.persons]
  );

  const { personStops, unmappedPlaces, allPlaces, minYear, maxYear } = useMemo(() => {
    const stopsByPerson: Record<string, PersonPlaceStop[]> = {};
    const missingSet = new Set<string>();
    const placeMetaMap = new Map<
      string,
      { name: string; norm: string; coords: GeoPoint | null; isCustom: boolean; count: number }
    >();
    const registerPlace = (raw: string, coords: GeoPoint | null) => {
      const name = raw.trim();
      const norm = normalizePlaceName(name);
      if (!norm) return;
      const existing = placeMetaMap.get(norm);
      if (existing) {
        existing.count += 1;
      } else {
        placeMetaMap.set(norm, {
          name,
          norm,
          coords,
          isCustom: Boolean(tree.placeCoords && tree.placeCoords[norm]),
          count: 1,
        });
      }
      if (!coords) missingSet.add(name);
    };
    let minY = 2100;
    let maxY = 1700;

    for (const person of personList) {
      const stops: PersonPlaceStop[] = [];

      if (person.birthPlace?.trim()) {
        const parsed = parseGenealogyDate(person.birthDate);
        if (parsed.year) {
          minY = Math.min(minY, parsed.year);
          maxY = Math.max(maxY, parsed.year);
        }
        const coords = resolvePlaceCoords(person.birthPlace, tree.placeCoords);
        registerPlace(person.birthPlace, coords);
        stops.push({
          person,
          place: person.birthPlace.trim(),
          year: parsed.year,
          sortKey: parsed.sortKey === Number.MAX_SAFE_INTEGER ? 0 : parsed.sortKey,
          dateLabel: formatGenealogyDate(person.birthDate) || 'Рождение',
          eventLabel: 'Рождение',
          coords,
        });
      }

      for (const ev of person.events) {
        if (!ev.place?.trim()) continue;
        const parsed = parseGenealogyDate(ev.date);
        if (parsed.year) {
          minY = Math.min(minY, parsed.year);
          maxY = Math.max(maxY, parsed.year);
        }
        const coords = resolvePlaceCoords(ev.place, tree.placeCoords);
        registerPlace(ev.place, coords);
        stops.push({
          person,
          place: ev.place.trim(),
          year: parsed.year,
          sortKey: parsed.sortKey,
          dateLabel: formatGenealogyDate(ev.date) || 'Дата не указана',
          eventLabel: ev.title || EVENT_TYPE_LABELS[ev.type],
          coords,
        });
      }

      for (const u of tree.unions) {
        if (!u.partnerIds.includes(person.id) || !u.marriagePlace?.trim()) continue;
        const parsed = parseGenealogyDate(u.marriageDate);
        if (parsed.year) {
          minY = Math.min(minY, parsed.year);
          maxY = Math.max(maxY, parsed.year);
        }
        const coords = resolvePlaceCoords(u.marriagePlace, tree.placeCoords);
        registerPlace(u.marriagePlace, coords);
        stops.push({
          person,
          place: u.marriagePlace.trim(),
          year: parsed.year,
          sortKey: parsed.sortKey,
          dateLabel: formatGenealogyDate(u.marriageDate) || 'Брак',
          eventLabel: 'Бракосочетание',
          coords,
        });
      }

      if (person.deathPlace?.trim()) {
        const parsed = parseGenealogyDate(person.deathDate);
        if (parsed.year) {
          minY = Math.min(minY, parsed.year);
          maxY = Math.max(maxY, parsed.year);
        }
        const coords = resolvePlaceCoords(person.deathPlace, tree.placeCoords);
        registerPlace(person.deathPlace, coords);
        stops.push({
          person,
          place: person.deathPlace.trim(),
          year: parsed.year,
          sortKey: parsed.sortKey,
          dateLabel: formatGenealogyDate(person.deathDate) || 'Кончина',
          eventLabel: 'Кончина',
          coords,
        });
      }

      stops.sort((a, b) => a.sortKey - b.sortKey);
      if (stops.length > 0) {
        stopsByPerson[person.id] = stops;
      }
    }

    if (minY > maxY) {
      minY = 1860;
      maxY = new Date().getFullYear();
    }

    const allPlacesSorted = Array.from(placeMetaMap.values()).sort((a, b) => {
      if ((a.coords === null) !== (b.coords === null)) {
        return a.coords === null ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'ru');
    });

    return {
      personStops: stopsByPerson,
      unmappedPlaces: Array.from(missingSet),
      allPlaces: allPlacesSorted,
      minYear: minY,
      maxYear: Math.max(maxY, minY + 10),
    };
  }, [personList, tree.placeCoords, tree.unions]);

  useEffect(() => {
    setActiveYear((curr) => Math.max(minYear, Math.min(maxYear, curr)));
  }, [minYear, maxYear]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [56.8, 42.0],
      zoom: 4,
      minZoom: 2,
      worldCopyJump: true,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.invalidateSize();
          })
        : null;
    if (resizeObserver) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      resizeObserver?.disconnect();
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const fallbackTarget = editingPlace || unmappedPlaces[0] || allPlaces[0]?.name || '';
    setBindTargetPlace((curr) => {
      if (curr && allPlaces.some((p) => p.name === curr)) return curr;
      return fallbackTarget;
    });
  }, [allPlaces, editingPlace, unmappedPlaces]);

  const openPlaceEditor = useCallback(
    (placeName: string) => {
      const existingCoords = resolvePlaceCoords(placeName, tree.placeCoords);
      setEditingPlace(placeName);
      setEditAddressInput(placeName);
      setEditCoordsInput(existingCoords ? formatCoordsDisplay(existingCoords) : '');
      setEditError(null);
      setBindTargetPlace(placeName);
      setMobilePanelOpen(true);
    },
    [tree.placeCoords]
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (!pickingPlace) return;
      const clickedCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
      onSavePlaceCoords(normalizePlaceName(pickingPlace), clickedCoords);
      if (editingPlace && normalizePlaceName(editingPlace) === normalizePlaceName(pickingPlace)) {
        setEditCoordsInput(formatCoordsDisplay(clickedCoords));
      }
      setPickingPlace(null);
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [editingPlace, onSavePlaceCoords, pickingPlace]);

  useEffect(() => {
    const group = layerGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;

    group.clearLayers();

    const targetPersons =
      selectedPersonId === 'all'
        ? personList
        : personList.filter((p) => p.id === selectedPersonId);

    const placeBuckets = new Map<
      string,
      {
        coords: GeoPoint;
        placeNames: Set<string>;
        entries: { person: Person; stop: PersonPlaceStop; color: string }[];
      }
    >();

    const boundsCoords: [number, number][] = [];

    for (const person of targetPersons) {
      const stops = (personStops[person.id] || []).filter((s) => s.coords !== null);
      if (stops.length === 0) continue;

      const color = lineage.personColor[person.id] || '#8B261D';

      const visibleStops = filterByYear
        ? stops.filter((s) => !s.year || s.year <= activeYear)
        : stops;

      if (filterByYear) {
        const bYear = parseGenealogyDate(person.birthDate).year;
        if (bYear && bYear > activeYear) continue;
      }

      const pathStops: PersonPlaceStop[] = [];
      for (const s of visibleStops) {
        if (!s.coords) continue;
        const last = pathStops[pathStops.length - 1];
        if (
          !last ||
          !last.coords ||
          Math.abs(last.coords.lat - s.coords.lat) > 0.01 ||
          Math.abs(last.coords.lng - s.coords.lng) > 0.01
        ) {
          pathStops.push(s);
        }
      }

      for (let i = 0; i < pathStops.length - 1; i++) {
        const fromStop = pathStops[i];
        const toStop = pathStops[i + 1];
        if (!fromStop.coords || !toStop.coords) continue;

        const { arcPoints, arrowLatLng, arrowAngleDeg } = buildCurvedRouteAndArrow(
          fromStop.coords,
          toStop.coords
        );

        const poly = L.polyline(arcPoints, {
          color,
          weight: selectedPersonId === 'all' ? 2.2 : 3,
          opacity: 0.78,
          lineCap: 'round',
        });

        poly.bindTooltip(
          `${formatFullName(person)}: ${fromStop.place} → ${toStop.place}`,
          { sticky: true }
        );
        poly.addTo(group);

        // Larger, crisp SVG arrowhead anchored at the arrival city and rotated along incoming tangent
        const arrowIcon = L.divIcon({
          className: '',
          iconSize: [52, 24],
          iconAnchor: [26, 12],
          html: `<svg width="52" height="24" viewBox="0 0 52 24" style="transform: rotate(${arrowAngleDeg.toFixed(
            1
          )}deg); transform-origin: 26px 12px; display: block; overflow: visible;">
            <path d="M 1 4.5 L 16.5 12 L 1 19.5 L 5.2 12 Z" fill="${color}" stroke="#FFFFFF" stroke-width="1.2" stroke-linejoin="round" />
          </svg>`,
        });

        L.marker(arrowLatLng, {
          icon: arrowIcon,
          interactive: false,
          keyboard: false,
          zIndexOffset: 500,
        }).addTo(group);
      }

      const stopsToMark =
        filterByYear && visibleStops.length > 0
          ? [visibleStops[visibleStops.length - 1]]
          : visibleStops;

      for (const stop of stopsToMark) {
        if (!stop.coords) continue;
        boundsCoords.push([stop.coords.lat, stop.coords.lng]);
        const key = `${stop.coords.lat.toFixed(3)},${stop.coords.lng.toFixed(3)}`;
        const bucket = placeBuckets.get(key) || {
          coords: stop.coords,
          placeNames: new Set<string>(),
          entries: [],
        };
        bucket.placeNames.add(stop.place);
        bucket.entries.push({ person, stop, color });
        placeBuckets.set(key, bucket);
      }
    }

    for (const bucket of placeBuckets.values()) {
      const distinctColors = new Set(bucket.entries.map((e) => e.color));
      const primaryColor = distinctColors.size === 1 ? bucket.entries[0].color : '#6B655E';
      const marker = L.circleMarker([bucket.coords.lat, bucket.coords.lng], {
        radius: Math.min(11, 5.5 + bucket.entries.length * 1.2),
        color: '#FFFFFF',
        weight: 2,
        fillColor: primaryColor,
        fillOpacity: 0.94,
      });

      const title = escapeHtml(
        Array.from(bucket.placeNames).join(' / ').toLocaleUpperCase('ru-RU')
      );

      // Group stops per person at this city so photo + ФИО sit at top and events (left date, right event) sit below
      const groupedByPerson = new Map<
        string,
        { person: Person; stops: PersonPlaceStop[] }
      >();
      for (const entry of bucket.entries) {
        const existing = groupedByPerson.get(entry.person.id);
        if (existing) {
          existing.stops.push(entry.stop);
        } else {
          groupedByPerson.set(entry.person.id, {
            person: entry.person,
            stops: [entry.stop],
          });
        }
      }

      const listHtml = Array.from(groupedByPerson.values())
        .map(({ person: p, stops }) => {
          const photo = getPrimaryPhotoObj(p);
          const crop = photo?.crop || { x: 0, y: 0, zoom: 1 };
          const fullName = escapeHtml(formatFullName(p));
          const initials = escapeHtml(getPersonInitials(p));
          const verifBadge =
            p.verification === 'confirmed'
              ? '<span title="Подтверждено" style="color:#15803D;font-size:12px;line-height:1;">✓</span>'
              : p.verification === 'possible'
              ? '<span title="Возможно" style="color:#B45309;font-size:12px;line-height:1;">?</span>'
              : '';

          const portraitHtml = photo?.dataUrl
            ? `<div style="width:48px;height:48px;border-radius:8px;overflow:hidden;background:#f5f5f4;flex-shrink:0;">
                <img src="${photo.dataUrl}" alt="${fullName}" style="width:100%;height:100%;object-fit:cover;transform:translate(${crop.x}%, ${crop.y}%) scale(${crop.zoom});transform-origin:center center;" />
              </div>`
            : `<div style="width:48px;height:48px;border-radius:8px;background:#f5f5f4;color:#57534e;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-size:15.4px;flex-shrink:0;">${initials}</div>`;

          const sortedStops = [...stops].sort((a, b) => a.sortKey - b.sortKey);
          const eventsHtml = sortedStops
            .map(
              (st) => `<div style="display:grid;grid-template-columns:96px 1fr;column-gap:12px;align-items:baseline;font-size:13.2px;line-height:1.38;">
                <span style="color:#57534E;font-variant-numeric:tabular-nums;white-space:nowrap;">${escapeHtml(
                  st.dateLabel
                )}</span>
                <span style="color:#1C1917;text-align:left;">${escapeHtml(st.eventLabel)}</span>
              </div>`
            )
            .join('');

          return `<div style="position:relative;margin-top:10px;border:1px solid #e7e5e4;border-radius:10px;background:#ffffff;padding:10px 12px;font-family:Georgia,'Times New Roman',serif;">
            ${
              verifBadge
                ? `<div style="position:absolute;top:6px;right:6px;display:flex;line-height:1;">${verifBadge}</div>`
                : ''
            }
            <div style="display:flex;align-items:center;gap:12px;padding-right:16px;">
              ${portraitHtml}
              <div style="font-size:14.9px;font-weight:700;line-height:1.3;color:#1C1917;white-space:nowrap;">${fullName}</div>
            </div>
            <div style="margin-top:8px;padding-top:7px;border-top:1px solid #e7e5e4;display:flex;flex-direction:column;gap:4px;">
              ${eventsHtml}
            </div>
          </div>`;
        })
        .join('');

      const placeActionsHtml = Array.from(bucket.placeNames)
        .map(
          (plName) =>
            `<button type="button" data-edit-place="${escapeHtml(
              plName
            )}" style="border:1px solid #d6d3d1;background:#ffffff;color:#8B261D;border-radius:6px;padding:3px 8px;font-size:12px;font-family:Georgia,serif;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">✎ Исправить: ${escapeHtml(
              plName
            )}</button>`
        )
        .join('');

      marker.bindPopup(
        `<div style="min-width:min(280px,76vw);max-height:330px;overflow-y:auto;font-family:Georgia,'Times New Roman',serif;background:#FBF9F5;">
          <div style="font-size:15.4px;font-weight:700;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;padding:0 22px 6px 0;border-bottom:1px solid #e7e5e4;">${title}</div>
          <div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
            ${placeActionsHtml}
            <span style="font-size:11.5px;color:#78716C;font-variant-numeric:tabular-nums;margin-left:auto;">${escapeHtml(
              formatCoordsDisplay(bucket.coords)
            )}</span>
          </div>
          ${listHtml}
        </div>`,
        { maxWidth: 460, minWidth: 240 }
      );
      marker.on('popupopen', (ev) => {
        const el = ev.popup.getElement();
        if (!el) return;
        const buttons = el.querySelectorAll<HTMLButtonElement>('[data-edit-place]');
        buttons.forEach((btn) => {
          btn.onclick = (clickEv) => {
            clickEv.preventDefault();
            clickEv.stopPropagation();
            const targetPlace = btn.getAttribute('data-edit-place');
            if (targetPlace) {
              marker.closePopup();
              openPlaceEditor(targetPlace);
            }
          };
        });
      });
      marker.addTo(group);
    }

    if (searchedGeo) {
      const pinIcon = L.divIcon({
        className: '',
        iconSize: [30, 38],
        iconAnchor: [15, 36],
        popupAnchor: [0, -34],
        html: `<svg width="30" height="38" viewBox="0 0 30 38" style="display:block;filter:drop-shadow(0 3px 6px rgba(28,25,23,0.32));">
          <path d="M15 2C8.4 2 3 7.4 3 14c0 8.6 12 22 12 22s12-13.4 12-22c0-6.6-5.4-12-12-12z" fill="#8B261D" stroke="#FFFFFF" stroke-width="2.2"/>
          <circle cx="15" cy="14" r="4.5" fill="#FBF9F5"/>
        </svg>`,
      });
      const pinTitle = searchedGeo.isLoading
        ? 'Определение населённого пункта...'
        : searchedGeo.label || 'Выбранная точка по координатам';
      const searchMarker = L.marker([searchedGeo.coords.lat, searchedGeo.coords.lng], {
        icon: pinIcon,
        zIndexOffset: 900,
      });
      searchMarker.bindPopup(
        `<div style="font-family:Georgia,'Times New Roman',serif;min-width:200px;">
          <div style="font-size:14px;font-weight:700;color:#8B261D;">${escapeHtml(pinTitle)}</div>
          <div style="margin-top:4px;font-size:12.5px;color:#57534E;font-variant-numeric:tabular-nums;">${escapeHtml(
            formatCoordsDisplay(searchedGeo.coords)
          )}</div>
        </div>`
      );
      searchMarker.addTo(group);
    }

    if (boundsCoords.length > 0 && selectedPersonId !== 'all' && !searchedGeo) {
      map.fitBounds(L.latLngBounds(boundsCoords), { padding: [50, 50], maxZoom: 7 });
    }
  }, [
    activeYear,
    filterByYear,
    lineage.personColor,
    openPlaceEditor,
    personList,
    personStops,
    searchedGeo,
    selectedPersonId,
  ]);

  const handleLookupNominatim = async (placeName: string) => {
    setResolvingPlace(placeName);
    try {
      const coords = await lookupPlaceOnlineNominatim(placeName);
      if (coords) {
        onSavePlaceCoords(normalizePlaceName(placeName), coords);
        mapRef.current?.setView([coords.lat, coords.lng], 7);
      }
    } finally {
      setResolvingPlace(null);
    }
  };

  const handleCoordSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setCoordError(null);
    setCoordBindSuccess(null);
    const parsed = parseCoordinatesInput(coordQuery);
    if (!parsed) {
      setCoordError('Неверный формат. Пример: 55.7558, 37.6173 или 55°45\'21"N 37°37\'02"E');
      return;
    }

    mapRef.current?.setView([parsed.lat, parsed.lng], 11);
    setSearchedGeo({
      coords: parsed,
      label: '',
      displayName: '',
      isLoading: true,
    });

    const rev = await reverseLookupPlaceNominatim(parsed);
    setSearchedGeo({
      coords: parsed,
      label: rev?.label || 'Населённый пункт не определён (доступна постановка метки)',
      displayName: rev?.displayName || '',
      isLoading: false,
    });
  };

  const handleBindSearchedCoord = () => {
    if (!searchedGeo || !bindTargetPlace) return;
    onSavePlaceCoords(normalizePlaceName(bindTargetPlace), searchedGeo.coords);
    if (editingPlace && normalizePlaceName(editingPlace) === normalizePlaceName(bindTargetPlace)) {
      setEditCoordsInput(formatCoordsDisplay(searchedGeo.coords));
    }
    setCoordBindSuccess(`Геометка поставлена для «${bindTargetPlace}»`);
    mapRef.current?.setView([searchedGeo.coords.lat, searchedGeo.coords.lng], 10);
  };

  const handleLookupEditedAddress = async () => {
    const query = editAddressInput.trim();
    if (!query) return;
    setEditError(null);
    setEditSearchingAddr(true);
    try {
      const found = await lookupPlaceOnlineNominatim(query);
      if (!found) {
        setEditError('Не удалось найти этот адрес автоматически. Укажите координаты вручную или кликните по карте.');
      } else {
        setEditCoordsInput(formatCoordsDisplay(found));
        mapRef.current?.setView([found.lat, found.lng], 9);
      }
    } finally {
      setEditSearchingAddr(false);
    }
  };

  const handleSavePlaceEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlace) return;
    setEditError(null);
    const nextAddress = editAddressInput.trim();
    if (!nextAddress) {
      setEditError('Введите название населённого пункта или адреса.');
      return;
    }

    const rawCoords = editCoordsInput.trim();
    let parsedCoords: GeoPoint | undefined = undefined;
    if (rawCoords) {
      const parsed = parseCoordinatesInput(rawCoords);
      if (!parsed) {
        setEditError('Не удалось распознать координаты. Пример: 55.7558, 37.6173');
        return;
      }
      parsedCoords = parsed;
    }

    const sameNorm = normalizePlaceName(editingPlace) === normalizePlaceName(nextAddress);
    if (!sameNorm || editingPlace.trim() !== nextAddress) {
      onUpdatePlaceAddress(editingPlace, nextAddress, parsedCoords);
    } else if (parsedCoords) {
      onSavePlaceCoords(normalizePlaceName(nextAddress), parsedCoords);
    }

    if (parsedCoords) {
      mapRef.current?.setView([parsedCoords.lat, parsedCoords.lng], Math.max(mapRef.current.getZoom(), 8));
    }
    setEditingPlace(null);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#FBF9F5]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-white px-3.5 py-2.5 sm:px-5 sm:py-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Compass size={17} className="text-[#8B261D] shrink-0" />
            <h1 className="font-editorial text-lg sm:text-xl font-semibold text-stone-900">
              География рода и маршруты
            </h1>
          </div>

          <select
            value={selectedPersonId}
            onChange={(e) => setSelectedPersonId(e.target.value)}
            className="h-9 max-w-full min-w-[160px] flex-1 sm:flex-none rounded-md border border-stone-200 bg-[#FBF9F5] px-2.5 text-[16px] font-medium text-stone-900"
          >
            <option value="all">Вся семья (все маршруты)</option>
            {personList.map((p) => (
              <option key={p.id} value={p.id}>
                {formatFullName(p)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <label className="inline-flex h-9 items-center gap-1.5 text-[13.5px] sm:text-[14.5px] font-medium text-stone-700 cursor-pointer">
            <input
              type="checkbox"
              checked={filterByYear}
              onChange={(e) => setFilterByYear(e.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-[#8B261D]"
            />
            <span>Срез на год:</span>
          </label>

          {filterByYear && (
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={minYear}
                max={maxYear}
                value={activeYear}
                onChange={(e) => setActiveYear(parseInt(e.target.value, 10))}
                className="w-24 sm:w-44 accent-[#8B261D]"
              />
              <span className="font-mono-tabular text-[15px] sm:text-base font-semibold text-[#8B261D] min-w-[42px]">
                {activeYear}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setMobilePanelOpen((v) => !v)}
            title="Маршруты и места"
            aria-label="Маршруты и места"
            className={`lg:hidden inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-[13.5px] font-medium transition-colors cursor-pointer ${
              mobilePanelOpen
                ? 'border-[#8B261D] bg-[#8B261D] text-white'
                : 'border-stone-200 bg-[#FBF9F5] text-stone-800 hover:border-stone-300'
            }`}
          >
            <Navigation size={14} className={mobilePanelOpen ? 'text-white' : 'text-[#8B261D]'} />
            <span className="desktop-btn-label">
              {mobilePanelOpen ? 'Скрыть список' : 'Маршруты'}
            </span>
            {unmappedPlaces.length > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  mobilePanelOpen
                    ? 'bg-white text-[#8B261D]'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                {unmappedPlaces.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {pickingPlace && (
        <div className="flex items-center justify-between border-b border-[#8B261D]/20 bg-[#8B261D]/5 px-4 py-2 text-[14px] sm:text-[14.5px] text-stone-800">
          <span>
            Нажмите на нужную точку на карте, чтобы задать координаты для места «
            <strong>{pickingPlace}</strong>».
          </span>
          <button
            type="button"
            onClick={() => setPickingPlace(null)}
            className="font-medium text-[#8B261D] hover:underline shrink-0 ml-2 cursor-pointer"
          >
            Отмена
          </button>
        </div>
      )}

      <div className="relative flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <div ref={mapContainerRef} className="h-full w-full" />
        </div>

        <aside
          className={`${
            mobilePanelOpen
              ? 'absolute inset-0 sm:left-auto sm:w-[380px] z-[450] flex shadow-2xl'
              : 'hidden'
          } lg:static lg:z-auto lg:flex lg:shadow-none w-full lg:w-[400px] xl:w-[440px] shrink-0 flex-col border-l border-stone-200 bg-[#FBF9F5] overflow-y-auto p-3.5 sm:p-4 space-y-4 sm:space-y-5`}
        >
          <div className="flex lg:hidden items-center justify-between border-b border-stone-200 pb-2.5">
            <span className="font-editorial text-lg font-semibold text-stone-900">
              Маршруты и города
            </span>
            <button
              type="button"
              onClick={() => setMobilePanelOpen(false)}
              aria-label="Закрыть список маршрутов"
              className="rounded-md p-1.5 text-stone-500 hover:bg-stone-200/70 hover:text-stone-900 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Coordinate Search & Geotagging */}
          <div className="space-y-2.5 rounded-lg border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[14px] font-semibold text-stone-800">
                <Crosshair size={15} className="text-[#8B261D] shrink-0" />
                <span>Поиск и геометка по координатам</span>
              </div>
              {searchedGeo && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchedGeo(null);
                    setCoordBindSuccess(null);
                  }}
                  title="Убрать метку поиска"
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <form onSubmit={handleCoordSearch} className="flex items-center gap-1.5">
              <input
                type="text"
                value={coordQuery}
                onChange={(e) => {
                  setCoordQuery(e.target.value);
                  setCoordError(null);
                }}
                placeholder="55.7558, 37.6173 или 55°45'21&quot;N 37°37'02&quot;E"
                className="min-w-0 flex-1 rounded-md border border-stone-200 bg-[#FBF9F5] px-2.5 py-1.5 text-[14px] text-stone-900 placeholder:text-stone-400 focus:border-[#8B261D] focus:outline-none"
              />
              <button
                type="submit"
                title="Найти населённый пункт на карте"
                className="inline-flex h-8.5 items-center gap-1 rounded-md bg-[#8B261D] px-2.5 text-[13.5px] font-medium text-white hover:bg-[#741E17] shrink-0 cursor-pointer"
              >
                <Search size={13} />
                <span>Найти</span>
              </button>
            </form>

            {coordError && <p className="text-[12.5px] text-[#8B261D]">{coordError}</p>}

            {searchedGeo && (
              <div className="space-y-2 rounded-md border border-stone-200/90 bg-[#FBF9F5] p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-stone-900">
                      {searchedGeo.isLoading
                        ? 'Определяем населённый пункт...'
                        : searchedGeo.label}
                    </div>
                    {searchedGeo.displayName && searchedGeo.displayName !== searchedGeo.label && (
                      <div className="mt-0.5 text-[12px] text-stone-500 leading-snug">
                        {searchedGeo.displayName}
                      </div>
                    )}
                    <div className="mt-1 font-mono-tabular text-[12px] text-stone-500">
                      {formatCoordsDisplay(searchedGeo.coords)}
                    </div>
                  </div>
                </div>

                {allPlaces.length > 0 && (
                  <div className="space-y-1.5 border-t border-stone-200 pt-2">
                    <label className="block text-[12px] font-medium text-stone-600">
                      Поставить геометку для места из древа:
                    </label>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={bindTargetPlace}
                        onChange={(e) => {
                          setBindTargetPlace(e.target.value);
                          setCoordBindSuccess(null);
                        }}
                        className="min-w-0 flex-1 rounded border border-stone-200 bg-white px-2 py-1.5 text-[13.5px] text-stone-900"
                      >
                        {allPlaces.map((pl) => (
                          <option key={pl.norm} value={pl.name}>
                            {pl.name}
                            {pl.coords === null ? ' (нет метки)' : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleBindSearchedCoord}
                        className="inline-flex items-center gap-1 rounded border border-[#8B261D]/40 bg-[#8B261D]/10 px-2.5 py-1.5 text-[13px] font-medium text-[#8B261D] hover:bg-[#8B261D]/15 shrink-0 cursor-pointer"
                      >
                        <MapPin size={13} />
                        <span>Поставить</span>
                      </button>
                    </div>
                  </div>
                )}

                {coordBindSuccess && (
                  <div className="flex items-center gap-1 text-[12.5px] font-medium text-[#15803D]">
                    <Check size={13} />
                    <span>{coordBindSuccess}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Place Address & Coordinate Correction Editor */}
          {editingPlace && (
            <form
              onSubmit={handleSavePlaceEdit}
              className="space-y-2.5 rounded-lg border border-[#8B261D]/35 bg-white p-3 shadow-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[14px] font-semibold text-[#8B261D]">
                  <Pencil size={14} className="shrink-0" />
                  <span>Исправление адреса и геометки</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPlace(null);
                    setEditError(null);
                  }}
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="space-y-1">
                <label className="block text-[12.5px] font-medium text-stone-600">
                  Адрес / населённый пункт (обновится во всех записях)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={editAddressInput}
                    onChange={(e) => setEditAddressInput(e.target.value)}
                    placeholder="Например: Троицкое, Самарская область"
                    className="min-w-0 flex-1 rounded border border-stone-200 bg-[#FBF9F5] px-2.5 py-1.5 text-[14.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={editSearchingAddr}
                    onClick={handleLookupEditedAddress}
                    title="Найти координаты по этому адресу"
                    className="inline-flex h-8.5 items-center gap-1 rounded border border-stone-200 bg-white px-2.5 text-[13px] font-medium text-stone-700 hover:border-stone-300 shrink-0 cursor-pointer"
                  >
                    <Search size={13} />
                    <span>{editSearchingAddr ? '...' : 'Найти'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[12.5px] font-medium text-stone-600">
                    Координаты на карте
                  </label>
                  <div className="flex items-center gap-2">
                    {searchedGeo && (
                      <button
                        type="button"
                        onClick={() => setEditCoordsInput(formatCoordsDisplay(searchedGeo.coords))}
                        className="text-[12px] font-medium text-[#8B261D] hover:underline cursor-pointer"
                      >
                        Взять из поиска
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setPickingPlace(editingPlace);
                        setMobilePanelOpen(false);
                      }}
                      className="inline-flex items-center gap-1 text-[12px] font-medium text-[#8B261D] hover:underline cursor-pointer"
                    >
                      <MapPin size={12} />
                      <span>Указать на карте</span>
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={editCoordsInput}
                  onChange={(e) => {
                    setEditCoordsInput(e.target.value);
                    setEditError(null);
                  }}
                  placeholder="55.7558, 37.6173"
                  className="w-full rounded border border-stone-200 bg-[#FBF9F5] px-2.5 py-1.5 font-mono-tabular text-[14px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                />
              </div>

              {editError && <p className="text-[12.5px] text-[#8B261D]">{editError}</p>}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {tree.placeCoords?.[normalizePlaceName(editingPlace)] ? (
                  <button
                    type="button"
                    onClick={() => {
                      onUpdatePlaceAddress(editingPlace, editAddressInput.trim() || editingPlace, null);
                      const autoCoords = resolvePlaceCoords(
                        editAddressInput.trim() || editingPlace,
                        undefined
                      );
                      setEditCoordsInput(autoCoords ? formatCoordsDisplay(autoCoords) : '');
                    }}
                    title="Сбросить ручные координаты к автоопределению"
                    className="inline-flex items-center gap-1 text-[12.5px] text-stone-500 hover:text-stone-900 cursor-pointer"
                  >
                    <RotateCcw size={12} />
                    <span>Сбросить метку</span>
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingPlace(null)}
                    className="rounded px-2.5 py-1.5 text-[13px] text-stone-600 hover:bg-stone-100 cursor-pointer"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="rounded bg-[#8B261D] px-3 py-1.5 text-[13.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
                  >
                    Сохранить
                  </button>
                </div>
              </div>
            </form>
          )}

          {unmappedPlaces.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <div className="text-[14.5px] font-semibold text-amber-950">
                Места без координат ({unmappedPlaces.length})
              </div>
              <p className="text-[13px] text-amber-900">
                Найдите автоматически, укажите точку на карте или исправьте адрес:
              </p>
              <div className="space-y-1.5">
                {unmappedPlaces.map((pl) => (
                  <div
                    key={pl}
                    className="flex items-center justify-between gap-2 rounded bg-white px-2.5 py-1.5 border border-amber-200/80 text-[14.5px]"
                  >
                    <span className="truncate text-stone-800">{pl}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={resolvingPlace === pl}
                        onClick={() => handleLookupNominatim(pl)}
                        title="Найти координаты города"
                        className="rounded p-1.5 text-stone-600 hover:bg-stone-100 cursor-pointer"
                      >
                        <Search size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPickingPlace(pl);
                          setMobilePanelOpen(false);
                        }}
                        title="Указать точку на карте"
                        className="rounded p-1.5 text-[#8B261D] hover:bg-red-50 cursor-pointer"
                      >
                        <MapPin size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openPlaceEditor(pl)}
                        title="Исправить адрес или ввести координаты"
                        className="rounded p-1.5 text-stone-600 hover:bg-stone-100 cursor-pointer"
                      >
                        <Pencil size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {allPlaces.length > 0 && (
            <div className="rounded-lg border border-stone-200 bg-white">
              <button
                type="button"
                onClick={() => setPlacesListOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[14px] font-semibold text-stone-700 hover:bg-stone-50 cursor-pointer"
              >
                <span>Все адреса на карте ({allPlaces.length})</span>
                {placesListOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              {placesListOpen && (
                <div className="max-h-60 overflow-y-auto divide-y divide-stone-100 border-t border-stone-200">
                  {allPlaces.map((pl) => (
                    <div
                      key={pl.norm}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-[13.5px]"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (pl.coords) {
                            mapRef.current?.setView([pl.coords.lat, pl.coords.lng], 8);
                            setMobilePanelOpen(false);
                          } else {
                            openPlaceEditor(pl.name);
                          }
                        }}
                        className="min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="font-medium text-stone-900 truncate">{pl.name}</div>
                        <div className="font-mono-tabular text-[11.5px] text-stone-500">
                          {pl.coords ? formatCoordsDisplay(pl.coords) : 'Координаты не заданы'}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => openPlaceEditor(pl.name)}
                        title="Исправить адрес или координаты"
                        className="inline-flex items-center gap-1 rounded border border-stone-200 px-2 py-1 text-[12px] font-medium text-stone-700 hover:border-[#8B261D]/45 hover:text-[#8B261D] shrink-0 cursor-pointer"
                      >
                        <Pencil size={12} />
                        <span>Исправить</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[14.5px] font-semibold text-stone-700">
                Маршруты по персонам
              </span>
              {selectedPersonId !== 'all' && (
                <button
                  type="button"
                  onClick={() => setSelectedPersonId('all')}
                  className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-900 cursor-pointer"
                >
                  <X size={12} />
                  <span>Все</span>
                </button>
              )}
            </div>

            <div className="space-y-2">
              {personList
                .filter((p) => (personStops[p.id] || []).length > 0)
                .map((p) => {
                  const stops = personStops[p.id];
                  const color = lineage.personColor[p.id] || '#8B261D';
                  const isActive = selectedPersonId === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        setSelectedPersonId(isActive ? 'all' : p.id);
                        setMobilePanelOpen(false);
                      }}
                      className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                        isActive
                          ? 'border-stone-900 bg-white shadow-xs'
                          : 'border-stone-200 bg-white hover:border-stone-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-[14.5px] font-semibold text-stone-900 whitespace-nowrap">
                            {formatFullName(p)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPersonInTree(p.id);
                          }}
                          className="text-[13px] text-[#8B261D] hover:underline shrink-0 cursor-pointer"
                        >
                          Досье
                        </button>
                      </div>

                      <div className="mt-2 space-y-1 text-[13px] text-stone-600">
                        {stops.map((st, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Navigation size={10} style={{ color }} className="shrink-0" />
                              <span className="font-mono-tabular text-stone-400 shrink-0">
                                {st.year || '—'}
                              </span>
                              <span className="truncate">{st.place}</span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openPlaceEditor(st.place);
                              }}
                              title={`Исправить адрес или геометку: ${st.place}`}
                              className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-[#8B261D] shrink-0 cursor-pointer"
                            >
                              <Pencil size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

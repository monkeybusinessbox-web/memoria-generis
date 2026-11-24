import JSZip from 'jszip';
import { Person, TreeDocument } from '../types/genealogy';
import { normalizeDateInputToRu } from './dateUtils';
import { exportTreeToGedcom, importGedcomBuffer } from './gedcom';
import { urlToDataUrl } from './storage';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFileBase(title: string): string {
  return (
    title
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'family_tree'
  );
}

export function formatExportTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

async function resolveTreeImagesToDataUrls(tree: TreeDocument): Promise<TreeDocument> {
  const cloned: TreeDocument = JSON.parse(JSON.stringify(tree));
  for (const person of Object.values(cloned.persons)) {
    for (const photo of person.photos) {
      if (photo.dataUrl && !photo.dataUrl.startsWith('data:')) {
        try {
          photo.dataUrl = await urlToDataUrl(photo.dataUrl);
        } catch {
          // Leave as-is if fetch fails
        }
      }
    }
  }
  for (const photo of cloned.archivePhotos || []) {
    if (photo.dataUrl && !photo.dataUrl.startsWith('data:')) {
      try {
        photo.dataUrl = await urlToDataUrl(photo.dataUrl);
      } catch {
        // Leave as-is if fetch fails
      }
    }
  }
  return cloned;
}

export async function exportTreeToJsonFile(tree: TreeDocument): Promise<void> {
  const resolved = await resolveTreeImagesToDataUrls(tree);
  const json = JSON.stringify(resolved, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  triggerDownload(blob, `${sanitizeFileBase(tree.title)}_${formatExportTimestamp()}.json`);
}

export function exportTreeToGedcomFile(tree: TreeDocument): void {
  const ged = exportTreeToGedcom(tree);
  const blob = new Blob([ged], { type: 'text/plain;charset=utf-8' });
  triggerDownload(blob, `${sanitizeFileBase(tree.title)}_${formatExportTimestamp()}.ged`);
}

function dataUrlToBinary(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;
  const mimeSub = match[1].toLowerCase();
  const ext = mimeSub === 'jpeg' ? 'jpg' : mimeSub === 'svg+xml' ? 'svg' : mimeSub;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, ext };
}

export async function exportTreeToZipFile(tree: TreeDocument): Promise<void> {
  const resolved = await resolveTreeImagesToDataUrls(tree);
  const zip = new JSZip();
  const photosFolder = zip.folder('photos');

  // Replace heavy inline base64 dataUrls in archive.json with clean relative photo paths (deduplicated)
  const zipReadyTree: TreeDocument = JSON.parse(JSON.stringify(resolved));
  const writtenByDataUrl = new Map<string, string>();
  const writeOrReusePhoto = (rawUrl: string, candidateName: string): string | null => {
    const existingPath = writtenByDataUrl.get(rawUrl);
    if (existingPath) return existingPath;
    const bin = dataUrlToBinary(rawUrl);
    if (!bin || !photosFolder) return null;
    const filename = `${candidateName}.${bin.ext}`;
    photosFolder.file(filename, bin.bytes);
    const relPath = `photos/${filename}`;
    writtenByDataUrl.set(rawUrl, relPath);
    return relPath;
  };

  for (const person of Object.values(zipReadyTree.persons)) {
    for (const photo of person.photos) {
      const relPath = writeOrReusePhoto(photo.dataUrl, `${person.id}_${photo.id}`);
      if (relPath) photo.dataUrl = relPath;
    }
  }
  for (const photo of zipReadyTree.archivePhotos || []) {
    const relPath = writeOrReusePhoto(photo.dataUrl, `archive_${photo.id}`);
    if (relPath) photo.dataUrl = relPath;
  }

  zip.file('archive.json', JSON.stringify(zipReadyTree, null, 2));
  zip.file('family.ged', exportTreeToGedcom(resolved));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(blob, `${sanitizeFileBase(tree.title)}_archive_${formatExportTimestamp()}.zip`);
}

const externalAssetSizeCache = new Map<string, number>();

export async function collectExternalAssetSizes(
  tree: TreeDocument
): Promise<Record<string, number>> {
  const urls = new Set<string>();
  for (const person of Object.values(tree.persons)) {
    for (const ph of person.photos) {
      if (ph.dataUrl && !ph.dataUrl.startsWith('data:')) {
        urls.add(ph.dataUrl);
      }
    }
  }
  for (const ph of tree.archivePhotos || []) {
    if (ph.dataUrl && !ph.dataUrl.startsWith('data:')) {
      urls.add(ph.dataUrl);
    }
  }

  const out: Record<string, number> = {};
  await Promise.all(
    Array.from(urls).map(async (url) => {
      const cached = externalAssetSizeCache.get(url);
      if (cached !== undefined) {
        out[url] = cached;
        return;
      }
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        externalAssetSizeCache.set(url, blob.size);
        out[url] = blob.size;
      } catch {
        // Ignore unfetchable asset
      }
    })
  );
  return out;
}

function estimateBase64BinarySize(dataUrl: string): number {
  if (!dataUrl || !dataUrl.startsWith('data:')) return 0;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return 0;
  const b64 = dataUrl.slice(commaIdx + 1);
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export function estimateProjectZipBytes(
  tree: TreeDocument,
  externalSizes: Record<string, number> = {}
): { zipBytes: number; rawBytes: number } {
  let mediaBinaryBytes = 0;
  let mediaCount = 0;
  let docBase64Bytes = 0;
  let rawMediaBase64Bytes = 0;

  const accountPhoto = (dataUrl: string) => {
    if (!dataUrl) return;
    if (dataUrl.startsWith('data:')) {
      const bin = estimateBase64BinarySize(dataUrl);
      mediaBinaryBytes += bin;
      rawMediaBase64Bytes += dataUrl.length;
      mediaCount += 1;
    } else {
      const extSize = externalSizes[dataUrl] ?? externalAssetSizeCache.get(dataUrl) ?? 0;
      mediaBinaryBytes += extSize;
      rawMediaBase64Bytes += Math.round((extSize * 4) / 3);
      if (extSize > 0) mediaCount += 1;
    }
  };

  const accountDocs = (docs?: Array<{ dataUrl?: string }>) => {
    if (!docs) return;
    for (const d of docs) {
      if (d.dataUrl) {
        docBase64Bytes += d.dataUrl.length;
      }
    }
  };

  for (const p of Object.values(tree.persons)) {
    for (const ph of p.photos) accountPhoto(ph.dataUrl);
    accountDocs(p.birthDocuments);
    accountDocs(p.deathDocuments);
    for (const ev of p.events) accountDocs(ev.documents);
  }
  for (const ph of tree.archivePhotos || []) accountPhoto(ph.dataUrl);
  for (const u of tree.unions) accountDocs(u.documents);

  const personCount = Object.keys(tree.persons).length;
  const approxMetadataTextBytes =
    800 +
    personCount * 620 +
    tree.unions.length * 220 +
    tree.parentChildLinks.length * 140;

  const rawBytes = approxMetadataTextBytes + rawMediaBase64Bytes + docBase64Bytes;

  // JPEG/PNG/WebP photos are already compressed (~99% after DEFLATE),
  // embedded base64 documents compress ~22%, JSON+GEDCOM text compresses ~72%.
  const compressedMedia = Math.round(mediaBinaryBytes * 0.99);
  const compressedDocs = Math.round(docBase64Bytes * 0.78);
  const compressedText = Math.round(approxMetadataTextBytes * 0.28);
  const zipOverhead = 240 + (mediaCount + 2) * 96;

  return {
    zipBytes: compressedMedia + compressedDocs + compressedText + zipOverhead,
    rawBytes,
  };
}

export function validateAndNormalizeTree(raw: unknown): TreeDocument {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Некорректный формат файла JSON');
  }
  const obj = raw as Partial<TreeDocument>;
  if (!obj.persons || typeof obj.persons !== 'object') {
    throw new Error('В файле отсутствуют данные о членах семьи (persons)');
  }

  const sanitizePoint = (pt: unknown): { x: number; y: number } | undefined => {
    if (!pt || typeof pt !== 'object') return undefined;
    const rec = pt as { x?: unknown; y?: unknown };
    if (typeof rec.x === 'number' && Number.isFinite(rec.x) && typeof rec.y === 'number' && Number.isFinite(rec.y)) {
      return { x: rec.x, y: rec.y };
    }
    return undefined;
  };

  const normalizedPersons: Record<string, Person> = {};
  for (const [id, p] of Object.entries(obj.persons)) {
    if (!p || typeof p !== 'object') continue;
    const rawCustomPositions = p.customPositions;
    let normalizedCustomPositions: Person['customPositions'];
    if (rawCustomPositions && typeof rawCustomPositions === 'object') {
      const v = sanitizePoint(rawCustomPositions.vertical);
      const h = sanitizePoint(rawCustomPositions.horizontal);
      const c = sanitizePoint(rawCustomPositions.compact);
      if (v || h || c) {
        normalizedCustomPositions = {
          ...(v ? { vertical: v } : {}),
          ...(h ? { horizontal: h } : {}),
          ...(c ? { compact: c } : {}),
        };
      }
    }
    normalizedPersons[id] = {
      id: p.id || id,
      firstName: p.firstName || 'Без имени',
      middleName: p.middleName,
      lastName: p.lastName || '',
      maidenName: p.maidenName,
      gender: p.gender || 'other',
      birthDate: p.birthDate ? normalizeDateInputToRu(p.birthDate) : undefined,
      birthPlace: p.birthPlace,
      birthDocuments: Array.isArray(p.birthDocuments) ? p.birthDocuments : undefined,
      deathDate: p.deathDate ? normalizeDateInputToRu(p.deathDate) : undefined,
      deathPlace: p.deathPlace,
      deathDocuments: Array.isArray(p.deathDocuments) ? p.deathDocuments : undefined,
      isLiving: p.isLiving,
      occupation: p.occupation,
      notes: p.notes || '',
      verification: p.verification || 'unverified',
      events: Array.isArray(p.events)
        ? p.events.map((ev) => ({
            ...ev,
            date: ev.date ? normalizeDateInputToRu(ev.date) : '',
          }))
        : [],
      photos: Array.isArray(p.photos) ? p.photos : [],
      customPos: sanitizePoint(p.customPos),
      customPositions: normalizedCustomPositions,
      lineageColor: p.lineageColor,
    };
  }

  return {
    id: obj.id || `tree_${Date.now().toString(36)}`,
    title: obj.title || 'Импортированный архив',
    subtitle: obj.subtitle,
    updatedAt: new Date().toISOString(),
    persons: normalizedPersons,
    unions: Array.isArray(obj.unions)
      ? obj.unions.map((u) => ({
          ...u,
          marriageDate: u.marriageDate ? normalizeDateInputToRu(u.marriageDate) : undefined,
          divorceDate: u.divorceDate ? normalizeDateInputToRu(u.divorceDate) : undefined,
        }))
      : [],
    parentChildLinks: Array.isArray(obj.parentChildLinks) ? obj.parentChildLinks : [],
    placeCoords: obj.placeCoords,
    archivePhotos: Array.isArray(obj.archivePhotos) ? obj.archivePhotos : undefined,
  };
}

function guessMimeFromExt(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

export async function importArchiveFromFile(file: File): Promise<TreeDocument> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.json')) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    return validateAndNormalizeTree(parsed);
  }

  if (lower.endsWith('.ged') || lower.endsWith('.gedcom')) {
    const buffer = await file.arrayBuffer();
    return importGedcomBuffer(buffer, file.name);
  }

  if (lower.endsWith('.zip')) {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    // Find archive.json or any .json
    const jsonEntry =
      zip.file('archive.json') ||
      zip.file(/\.json$/i)[0];

    if (jsonEntry) {
      const jsonText = await jsonEntry.async('string');
      const doc = validateAndNormalizeTree(JSON.parse(jsonText));

      // Rehydrate photos referenced by path in zip
      for (const person of Object.values(doc.persons)) {
        for (const photo of person.photos) {
          if (photo.dataUrl && !photo.dataUrl.startsWith('data:')) {
            const cleanPath = photo.dataUrl.replace(/^\.?\//, '');
            const zipPhoto =
              zip.file(cleanPath) ||
              zip.file(new RegExp(`${cleanPath.split('/').pop()}$`, 'i'))[0];
            if (zipPhoto) {
              const base64 = await zipPhoto.async('base64');
              const mime = guessMimeFromExt(zipPhoto.name);
              photo.dataUrl = `data:${mime};base64,${base64}`;
            }
          }
        }
      }
      for (const photo of doc.archivePhotos || []) {
        if (photo.dataUrl && !photo.dataUrl.startsWith('data:')) {
          const cleanPath = photo.dataUrl.replace(/^\.?\//, '');
          const zipPhoto =
            zip.file(cleanPath) ||
            zip.file(new RegExp(`${cleanPath.split('/').pop()}$`, 'i'))[0];
          if (zipPhoto) {
            const base64 = await zipPhoto.async('base64');
            const mime = guessMimeFromExt(zipPhoto.name);
            photo.dataUrl = `data:${mime};base64,${base64}`;
          }
        }
      }
      return doc;
    }

    // Fallback: look for .ged inside zip
    const gedEntry = zip.file(/\.ged(com)?$/i)[0];
    if (gedEntry) {
      const gedBuf = await gedEntry.async('arraybuffer');
      return importGedcomBuffer(gedBuf, file.name.replace(/\.zip$/i, ''));
    }

    throw new Error('В ZIP-архиве не найден файл archive.json или .ged');
  }

  throw new Error('Поддерживаются форматы .json, .zip и .ged');
}

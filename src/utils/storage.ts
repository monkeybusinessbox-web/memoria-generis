import { DocumentAttachment, TreeDocument } from '../types/genealogy';
import { createId, normalizeTreeDates } from './dateUtils';

const DB_NAME = 'LetopisRodaLocalDB';
const DB_VERSION = 1;
const STORE_NAME = 'archives';
const ACTIVE_KEY = 'active_tree_v1';
const LS_FALLBACK_KEY = 'letopis_roda_tree_fallback_v1';
const LS_META_KEY = 'letopis_roda_meta_v1';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

export async function saveTreeToLocalBrowser(tree: TreeDocument): Promise<void> {
  const payload: TreeDocument = {
    ...tree,
    updatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(
      LS_META_KEY,
      JSON.stringify({
        id: payload.id,
        title: payload.title,
        updatedAt: payload.updatedAt,
        personCount: Object.keys(payload.persons).length,
      })
    );
  } catch {
    // Ignore meta storage error
  }

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(payload, ACTIVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    });
    db.close();
  } catch {
    try {
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(payload));
    } catch {
      // Ignore quota exceeded
    }
  }
}

export async function loadTreeFromLocalBrowser(): Promise<TreeDocument | null> {
  try {
    const db = await openDB();
    const result = await new Promise<TreeDocument | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(ACTIVE_KEY);
      req.onsuccess = () => resolve((req.result as TreeDocument) || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
    db.close();
    if (result && result.persons) {
      const migrated = normalizeTreeDates(result);
      let finalTree = migrated.tree;
      let changed = migrated.changed;
      if (finalTree.title === 'Род Воронцовых — Соколовых') {
        finalTree = { ...finalTree, title: 'Семейное древо' };
        changed = true;
      }
      if (changed) {
        saveTreeToLocalBrowser(finalTree);
      }
      return finalTree;
    }
  } catch {
    // Fall through
  }

  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TreeDocument;
      if (parsed && parsed.persons) {
        const migrated = normalizeTreeDates(parsed);
        let finalTree = migrated.tree;
        let changed = migrated.changed;
        if (finalTree.title === 'Род Воронцовых — Соколовых') {
          finalTree = { ...finalTree, title: 'Семейное древо' };
          changed = true;
        }
        if (changed) {
          saveTreeToLocalBrowser(finalTree);
        }
        return finalTree;
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

export function compressImageFile(
  file: File,
  maxDimension = 960,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл изображения'));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      recompressDataUrl(dataUrl, maxDimension, quality)
        .then(resolve)
        .catch(() => resolve(dataUrl));
    };
    reader.readAsDataURL(file);
  });
}

export function recompressDataUrl(
  dataUrl: string,
  maxDimension = 720,
  quality = 0.78
): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl.startsWith('data:image/') && !dataUrl.startsWith('/') && !dataUrl.startsWith('http')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      const { width, height } = img;
      const scale = Math.min(1, maxDimension / Math.max(width, height));
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}

export async function optimizeTreePhotos(
  tree: TreeDocument,
  maxDimension = 640,
  quality = 0.74
): Promise<TreeDocument> {
  const cloned: TreeDocument = JSON.parse(JSON.stringify(tree));
  for (const person of Object.values(cloned.persons)) {
    for (let i = 0; i < person.photos.length; i++) {
      const ph = person.photos[i];
      const src = ph.dataUrl.startsWith('data:') ? ph.dataUrl : await urlToDataUrl(ph.dataUrl);
      ph.dataUrl = await recompressDataUrl(src, maxDimension, quality);
    }
  }
  if (Array.isArray(cloned.archivePhotos)) {
    for (let i = 0; i < cloned.archivePhotos.length; i++) {
      const ph = cloned.archivePhotos[i];
      const src = ph.dataUrl.startsWith('data:') ? ph.dataUrl : await urlToDataUrl(ph.dataUrl);
      ph.dataUrl = await recompressDataUrl(src, maxDimension, quality);
    }
  }
  return cloned;
}

export function readDocumentFile(file: File): Promise<DocumentAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл документа'));
    reader.onload = async () => {
      let dataUrl = reader.result as string;
      let sizeBytes = file.size;
      if (file.type.startsWith('image/') && file.size > 600 * 1024) {
        dataUrl = await recompressDataUrl(dataUrl, 1400, 0.84);
        sizeBytes = Math.round((dataUrl.length * 3) / 4);
      }
      resolve({
        id: createId('doc'),
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
        sizeBytes,
      });
    };
    reader.readAsDataURL(file);
  });
}

export async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Ошибка конвертации изображения'));
    reader.readAsDataURL(blob);
  });
}

import {
  DocumentAttachment,
  Gender,
  LifeEvent,
  ParentChildLink,
  Person,
  PhotoAttachment,
  TreeDocument,
  Union,
  VerificationStatus,
} from '../types/genealogy';
import {
  EVENT_TYPE_LABELS,
  createId,
  formatFullName,
  normalizeDateInputToRu,
  parseGenealogyDate,
} from './dateUtils';

export type ScalarMergeFieldKey =
  | 'lastName'
  | 'firstName'
  | 'middleName'
  | 'maidenName'
  | 'gender'
  | 'birthDate'
  | 'birthPlace'
  | 'deathDate'
  | 'deathPlace'
  | 'occupation'
  | 'notes'
  | 'verification'
  | 'lineageColor';

export const SCALAR_FIELD_LABELS: Record<ScalarMergeFieldKey, string> = {
  lastName: 'Фамилия',
  firstName: 'Имя',
  middleName: 'Отчество',
  maidenName: 'Девичья фамилия',
  gender: 'Пол',
  birthDate: 'Дата рождения',
  birthPlace: 'Место рождения',
  deathDate: 'Дата смерти',
  deathPlace: 'Место смерти',
  occupation: 'Род занятий / профессия',
  notes: 'Биография и заметки',
  verification: 'Статус достоверности',
  lineageColor: 'Цвет линии рода',
};

export type FieldChoice = 'keep_a' | 'take_b' | 'combine';

export interface PersonFieldDiff {
  key: ScalarMergeFieldKey;
  label: string;
  valA: string;
  valB: string;
  displayA: string;
  displayB: string;
  kind: 'addition' | 'conflict';
  canCombine: boolean;
}

export interface PersonEventAddition {
  id: string;
  event: LifeEvent;
  defaultInclude: boolean;
}

export interface PersonPhotoAddition {
  id: string;
  photo: PhotoAttachment;
  defaultInclude: boolean;
}

export interface PersonDocAddition {
  id: string;
  kind: 'birth' | 'death';
  doc: DocumentAttachment;
  defaultInclude: boolean;
}

export interface MatchedPersonDiff {
  personA: Person;
  personB: Person;
  matchKind: 'id' | 'manual' | 'auto_exact' | 'auto_possible';
  score: number;
  fieldDiffs: PersonFieldDiff[];
  eventAdditions: PersonEventAddition[];
  photoAdditions: PersonPhotoAddition[];
  docAdditions: PersonDocAddition[];
}

export interface UnmatchedPersonEntry {
  personB: Person;
  suggestedPersonAId?: string;
  suggestedScore?: number;
}

export interface UnionMergeItem {
  id: string;
  kind: 'new' | 'update';
  unionB: Union;
  existingUnionA?: Union;
  partnerBIds: [string, string];
  partnerLabels: [string, string];
  diffFields: Array<{
    key: 'status' | 'marriageDate' | 'marriagePlace' | 'divorceDate' | 'notes' | 'verification';
    label: string;
    valA: string;
    valB: string;
    isAddition: boolean;
  }>;
}

export interface ParentChildMergeItem {
  id: string;
  linkB: ParentChildLink;
  parentBId: string;
  childBId: string;
  parentLabel: string;
  childLabel: string;
}

export interface MergeDecisions {
  /** personBId -> action: 'add' (default) | 'skip' | matched personAId */
  manualPersonMap: Record<string, string | 'skip' | undefined>;
  /** `${personAId}:${fieldKey}` -> choice */
  fieldChoices: Record<string, FieldChoice>;
  /** `${personAId}:${eventId}` -> include */
  eventChoices: Record<string, boolean>;
  /** `${personAId}:${photoId}` -> include */
  photoChoices: Record<string, boolean>;
  /** `${personAId}:${kind}:${docId}` -> include */
  docChoices: Record<string, boolean>;
  /** unionB.id -> include */
  unionInclude: Record<string, boolean>;
  /** `${unionB.id}:${fieldKey}` -> 'keep_a' | 'take_b' | 'combine' */
  unionFieldChoices: Record<string, FieldChoice>;
  /** linkB.id -> include */
  linkInclude: Record<string, boolean>;
  /** archivePhoto.id -> include */
  archivePhotoInclude: Record<string, boolean>;
  /** take tree title from A or B */
  titleSource: 'a' | 'b';
}

export interface MergeAnalysis {
  matchedWithChanges: MatchedPersonDiff[];
  matchedIdentical: Array<{ personA: Person; personB: Person; matchKind: MatchedPersonDiff['matchKind'] }>;
  unmatchedB: UnmatchedPersonEntry[];
  unions: UnionMergeItem[];
  parentChildLinks: ParentChildMergeItem[];
  newArchivePhotos: PhotoAttachment[];
  newPlaceCoordsCount: number;
  resolvedBToA: Record<string, string>; // B id -> A id (only for matched people)
}

function normText(s?: string): string {
  return (s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function surnameStem(s?: string): string {
  const n = normText(s);
  if (n.length <= 4) return n;
  return n.replace(/(ова|ева|ина|ына|ая|яя|ов|ев|ин|ын|ий|ой)$/u, '');
}

function extractYear(dateStr?: string): number | null {
  if (!dateStr) return null;
  const parsed = parseGenealogyDate(dateStr);
  return parsed.year;
}

function formatGenderRu(g?: Gender): string {
  if (g === 'male') return 'Мужской';
  if (g === 'female') return 'Женский';
  return 'Не указан';
}

function formatVerifRu(v?: VerificationStatus): string {
  if (v === 'confirmed') return 'Подтверждено';
  if (v === 'possible') return 'Возможно';
  return 'Не проверено';
}

function getScalarRaw(p: Person, key: ScalarMergeFieldKey): string {
  switch (key) {
    case 'lastName':
      return (p.lastName || '').trim();
    case 'firstName':
      return (p.firstName || '').trim();
    case 'middleName':
      return (p.middleName || '').trim();
    case 'maidenName':
      return (p.maidenName || '').trim();
    case 'gender':
      return p.gender || 'other';
    case 'birthDate':
      return p.birthDate ? normalizeDateInputToRu(p.birthDate).trim() : '';
    case 'birthPlace':
      return (p.birthPlace || '').trim();
    case 'deathDate':
      return p.deathDate ? normalizeDateInputToRu(p.deathDate).trim() : '';
    case 'deathPlace':
      return (p.deathPlace || '').trim();
    case 'occupation':
      return (p.occupation || '').trim();
    case 'notes':
      return (p.notes || '').trim();
    case 'verification':
      return p.verification || 'unverified';
    case 'lineageColor':
      return (p.lineageColor || '').trim();
  }
}

function getScalarDisplay(raw: string, key: ScalarMergeFieldKey): string {
  if (!raw) return '';
  if (key === 'gender') return formatGenderRu(raw as Gender);
  if (key === 'verification') return formatVerifRu(raw as VerificationStatus);
  return raw;
}

export function scorePersonSimilarity(a: Person, b: Person): number {
  let score = 0;

  const fnA = normText(a.firstName);
  const fnB = normText(b.firstName);
  const mnA = normText(a.middleName);
  const mnB = normText(b.middleName);
  const lnA = surnameStem(a.lastName);
  const lnB = surnameStem(b.lastName);
  const maidA = surnameStem(a.maidenName);
  const maidB = surnameStem(b.maidenName);

  if (fnA && fnB) {
    if (fnA === fnB) score += 35;
    else if (fnA.startsWith(fnB) || fnB.startsWith(fnA)) score += 16;
    else score -= 45;
  }

  const lastMatches =
    (lnA && lnB && lnA === lnB) ||
    (lnA && maidB && lnA === maidB) ||
    (maidA && lnB && maidA === lnB) ||
    (maidA && maidB && maidA === maidB);
  if (lastMatches) {
    score += 32;
  } else if (lnA && lnB) {
    score -= 20;
  }

  if (mnA && mnB) {
    if (mnA === mnB) score += 25;
    else if (mnA[0] === mnB[0]) score += 8;
    else score -= 30;
  }

  if (a.gender !== 'other' && b.gender !== 'other') {
    if (a.gender === b.gender) score += 8;
    else score -= 75;
  }

  const bdA = normalizeDateInputToRu(a.birthDate || '').trim();
  const bdB = normalizeDateInputToRu(b.birthDate || '').trim();
  const byA = extractYear(a.birthDate);
  const byB = extractYear(b.birthDate);

  if (bdA && bdB && bdA === bdB) {
    score += 45;
  } else if (byA !== null && byB !== null) {
    const diff = Math.abs(byA - byB);
    if (diff === 0) score += 28;
    else if (diff <= 1) score += 15;
    else if (diff >= 4) score -= 50;
  }

  const ddA = normalizeDateInputToRu(a.deathDate || '').trim();
  const ddB = normalizeDateInputToRu(b.deathDate || '').trim();
  const dyA = extractYear(a.deathDate);
  const dyB = extractYear(b.deathDate);
  if (ddA && ddB && ddA === ddB) {
    score += 30;
  } else if (dyA !== null && dyB !== null) {
    if (Math.abs(dyA - dyB) === 0) score += 16;
    else if (Math.abs(dyA - dyB) >= 4) score -= 35;
  }

  const bpA = normText(a.birthPlace);
  const bpB = normText(b.birthPlace);
  if (bpA && bpB && (bpA === bpB || bpA.includes(bpB) || bpB.includes(bpA))) {
    score += 14;
  }

  return score;
}

function isSamePhoto(a: PhotoAttachment, b: PhotoAttachment): boolean {
  if (a.id === b.id) return true;
  if (a.dataUrl && b.dataUrl && a.dataUrl === b.dataUrl) return true;
  return false;
}

function isSameEvent(a: LifeEvent, b: LifeEvent): boolean {
  if (a.id === b.id) return true;
  if (a.type !== b.type) return false;
  const dA = normalizeDateInputToRu(a.date || '').trim();
  const dB = normalizeDateInputToRu(b.date || '').trim();
  const yA = extractYear(a.date);
  const yB = extractYear(b.date);
  const dateClose = (dA && dB && dA === dB) || (yA !== null && yB !== null && yA === yB) || (!dA && !dB);
  if (!dateClose) return false;
  const tA = normText(a.title);
  const tB = normText(b.title);
  if (!tA || !tB || tA === tB || tA.includes(tB) || tB.includes(tA)) return true;
  if (a.type !== 'custom') return true;
  return false;
}

function isSameDoc(a: DocumentAttachment, b: DocumentAttachment): boolean {
  if (a.id === b.id) return true;
  if (a.dataUrl && b.dataUrl && a.dataUrl === b.dataUrl) return true;
  return normText(a.name) === normText(b.name) && a.sizeBytes === b.sizeBytes;
}

/**
 * Computes auto-matches (respecting manual overrides) and builds a structured
 * diff between Base Tree (A) and Incoming Tree (B).
 */
export function analyzeTreeMerge(
  baseTree: TreeDocument,
  incomingTree: TreeDocument,
  manualPersonMap: Record<string, string | 'skip' | undefined> = {}
): MergeAnalysis {
  const bPersons = Object.values(incomingTree.persons);
  const aPersons = Object.values(baseTree.persons);

  const usedAIds = new Set<string>();
  const resolvedBToA: Record<string, string> = {};
  const matchMeta: Record<string, { kind: MatchedPersonDiff['matchKind']; score: number }> = {};

  // 1. Respect explicit manual matches first
  for (const b of bPersons) {
    const manual = manualPersonMap[b.id];
    if (manual && manual !== 'skip' && baseTree.persons[manual] && !usedAIds.has(manual)) {
      resolvedBToA[b.id] = manual;
      usedAIds.add(manual);
      matchMeta[b.id] = { kind: 'manual', score: 100 };
    }
  }

  // 2. Match by exact ID (unless explicitly skipped or unlinked by user)
  for (const b of bPersons) {
    if (resolvedBToA[b.id] || manualPersonMap[b.id] !== undefined) continue;
    const candidateA = baseTree.persons[b.id];
    if (candidateA && !usedAIds.has(candidateA.id)) {
      resolvedBToA[b.id] = candidateA.id;
      usedAIds.add(candidateA.id);
      matchMeta[b.id] = { kind: 'id', score: 100 };
    }
  }

  // 3. Fuzzy genealogical matching by name, dates, and places for remaining persons
  const candidates: Array<{ bId: string; aId: string; score: number }> = [];
  for (const b of bPersons) {
    if (resolvedBToA[b.id] || manualPersonMap[b.id] !== undefined) continue;
    for (const a of aPersons) {
      if (usedAIds.has(a.id)) continue;
      const sc = scorePersonSimilarity(a, b);
      if (sc >= 58) {
        candidates.push({ bId: b.id, aId: a.id, score: sc });
      }
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  for (const c of candidates) {
    if (resolvedBToA[c.bId] || usedAIds.has(c.aId)) continue;
    resolvedBToA[c.bId] = c.aId;
    usedAIds.add(c.aId);
    matchMeta[c.bId] = {
      kind: c.score >= 82 ? 'auto_exact' : 'auto_possible',
      score: c.score,
    };
  }

  const matchedWithChanges: MatchedPersonDiff[] = [];
  const matchedIdentical: MergeAnalysis['matchedIdentical'] = [];
  const unmatchedB: UnmatchedPersonEntry[] = [];

  const scalarKeys: ScalarMergeFieldKey[] = [
    'lastName',
    'firstName',
    'middleName',
    'maidenName',
    'gender',
    'birthDate',
    'birthPlace',
    'deathDate',
    'deathPlace',
    'occupation',
    'notes',
    'verification',
    'lineageColor',
  ];

  for (const b of bPersons) {
    const aId = resolvedBToA[b.id];
    if (!aId) {
      // Find best suggestion from unmatched A if any
      let bestAId: string | undefined;
      let bestScore = 0;
      for (const a of aPersons) {
        if (usedAIds.has(a.id)) continue;
        const sc = scorePersonSimilarity(a, b);
        if (sc > bestScore) {
          bestScore = sc;
          bestAId = a.id;
        }
      }
      unmatchedB.push({
        personB: b,
        suggestedPersonAId: bestScore >= 30 ? bestAId : undefined,
        suggestedScore: bestScore >= 30 ? bestScore : undefined,
      });
      continue;
    }

    const a = baseTree.persons[aId];
    const meta = matchMeta[b.id] || { kind: 'auto_possible', score: 60 };
    const fieldDiffs: PersonFieldDiff[] = [];

    for (const key of scalarKeys) {
      const rawA = getScalarRaw(a, key);
      const rawB = getScalarRaw(b, key);
      if (!rawB) continue; // B has nothing -> never overwrite A
      if (normText(rawA) === normText(rawB) && rawA.toLowerCase() === rawB.toLowerCase()) {
        continue;
      }
      // Special check: for gender/verification only treat non-default or real diffs
      if (key === 'gender' && rawA !== 'other' && rawB === 'other') continue;
      if (key === 'verification' && rawA !== 'unverified' && rawB === 'unverified') continue;
      if (rawA === rawB) continue;

      const isAddition = !rawA && Boolean(rawB);
      fieldDiffs.push({
        key,
        label: SCALAR_FIELD_LABELS[key],
        valA: rawA,
        valB: rawB,
        displayA: getScalarDisplay(rawA, key),
        displayB: getScalarDisplay(rawB, key),
        kind: isAddition ? 'addition' : 'conflict',
        canCombine: !isAddition && (key === 'notes' || key === 'occupation'),
      });
    }

    const eventAdditions: PersonEventAddition[] = [];
    for (const evB of b.events) {
      const dup = a.events.some((evA) => isSameEvent(evA, evB));
      if (!dup) {
        eventAdditions.push({
          id: evB.id,
          event: evB,
          defaultInclude: true,
        });
      }
    }

    const photoAdditions: PersonPhotoAddition[] = [];
    for (const phB of b.photos) {
      const dup = a.photos.some((phA) => isSamePhoto(phA, phB));
      if (!dup) {
        photoAdditions.push({
          id: phB.id,
          photo: phB,
          defaultInclude: true,
        });
      }
    }

    const docAdditions: PersonDocAddition[] = [];
    for (const dB of b.birthDocuments || []) {
      const dup = (a.birthDocuments || []).some((dA) => isSameDoc(dA, dB));
      if (!dup) {
        docAdditions.push({ id: `birth:${dB.id}`, kind: 'birth', doc: dB, defaultInclude: true });
      }
    }
    for (const dB of b.deathDocuments || []) {
      const dup = (a.deathDocuments || []).some((dA) => isSameDoc(dA, dB));
      if (!dup) {
        docAdditions.push({ id: `death:${dB.id}`, kind: 'death', doc: dB, defaultInclude: true });
      }
    }

    if (
      fieldDiffs.length > 0 ||
      eventAdditions.length > 0 ||
      photoAdditions.length > 0 ||
      docAdditions.length > 0
    ) {
      matchedWithChanges.push({
        personA: a,
        personB: b,
        matchKind: meta.kind,
        score: meta.score,
        fieldDiffs,
        eventAdditions,
        photoAdditions,
        docAdditions,
      });
    } else {
      matchedIdentical.push({ personA: a, personB: b, matchKind: meta.kind });
    }
  }

  matchedWithChanges.sort((x, y) =>
    formatFullName(x.personA).localeCompare(formatFullName(y.personA), 'ru')
  );
  unmatchedB.sort((x, y) =>
    formatFullName(x.personB).localeCompare(formatFullName(y.personB), 'ru')
  );

  // Analyze Unions from B
  const unions: UnionMergeItem[] = [];
  for (const uB of incomingTree.unions) {
    const [b0, b1] = uB.partnerIds;
    if (manualPersonMap[b0] === 'skip' || manualPersonMap[b1] === 'skip') continue;
    const p0 = incomingTree.persons[b0];
    const p1 = incomingTree.persons[b1];
    if (!p0 || !p1) continue;

    const target0 = resolvedBToA[b0];
    const target1 = resolvedBToA[b1];
    const existingUnionA =
      target0 && target1
        ? baseTree.unions.find(
            (uA) => uA.partnerIds.includes(target0) && uA.partnerIds.includes(target1)
          )
        : undefined;

    if (!existingUnionA) {
      unions.push({
        id: uB.id,
        kind: 'new',
        unionB: uB,
        partnerBIds: [b0, b1],
        partnerLabels: [formatFullName(p0), formatFullName(p1)],
        diffFields: [],
      });
    } else {
      const diffFields: UnionMergeItem['diffFields'] = [];
      const uKeys: Array<{
        key: UnionMergeItem['diffFields'][number]['key'];
        label: string;
        get: (u: Union) => string;
      }> = [
        { key: 'status', label: 'Статус союза', get: (u) => u.status },
        {
          key: 'marriageDate',
          label: 'Дата бракосочетания',
          get: (u) => (u.marriageDate ? normalizeDateInputToRu(u.marriageDate).trim() : ''),
        },
        { key: 'marriagePlace', label: 'Место бракосочетания', get: (u) => (u.marriagePlace || '').trim() },
        {
          key: 'divorceDate',
          label: 'Дата развода',
          get: (u) => (u.divorceDate ? normalizeDateInputToRu(u.divorceDate).trim() : ''),
        },
        { key: 'notes', label: 'Заметки о союзе', get: (u) => (u.notes || '').trim() },
        { key: 'verification', label: 'Достоверность', get: (u) => u.verification },
      ];
      for (const uk of uKeys) {
        const vA = uk.get(existingUnionA);
        const vB = uk.get(uB);
        if (!vB || vA === vB) continue;
        if (uk.key === 'verification' && vA !== 'unverified' && vB === 'unverified') continue;
        diffFields.push({
          key: uk.key,
          label: uk.label,
          valA: vA,
          valB: vB,
          isAddition: !vA,
        });
      }
      if (diffFields.length > 0) {
        unions.push({
          id: uB.id,
          kind: 'update',
          unionB: uB,
          existingUnionA,
          partnerBIds: [b0, b1],
          partnerLabels: [formatFullName(p0), formatFullName(p1)],
          diffFields,
        });
      }
    }
  }

  // Analyze Parent-Child Links from B
  const parentChildLinks: ParentChildMergeItem[] = [];
  for (const lB of incomingTree.parentChildLinks) {
    if (manualPersonMap[lB.parentId] === 'skip' || manualPersonMap[lB.childId] === 'skip') {
      continue;
    }
    const pParent = incomingTree.persons[lB.parentId];
    const pChild = incomingTree.persons[lB.childId];
    if (!pParent || !pChild) continue;

    const targetParent = resolvedBToA[lB.parentId];
    const targetChild = resolvedBToA[lB.childId];
    if (targetParent && targetChild) {
      const exists = baseTree.parentChildLinks.some(
        (lA) => lA.parentId === targetParent && lA.childId === targetChild
      );
      if (exists) continue;
    }
    parentChildLinks.push({
      id: lB.id,
      linkB: lB,
      parentBId: lB.parentId,
      childBId: lB.childId,
      parentLabel: formatFullName(pParent),
      childLabel: formatFullName(pChild),
    });
  }

  // Archive photos from B not present in A
  const baseArch = baseTree.archivePhotos || [];
  const newArchivePhotos = (incomingTree.archivePhotos || []).filter(
    (phB) => !baseArch.some((phA) => isSamePhoto(phA, phB))
  );

  // Place coordinates in B missing from A
  let newPlaceCoordsCount = 0;
  const baseCoords = baseTree.placeCoords || {};
  for (const key of Object.keys(incomingTree.placeCoords || {})) {
    if (!baseCoords[key]) newPlaceCoordsCount += 1;
  }

  return {
    matchedWithChanges,
    matchedIdentical,
    unmatchedB,
    unions,
    parentChildLinks,
    newArchivePhotos,
    newPlaceCoordsCount,
    resolvedBToA,
  };
}

export function buildDefaultMergeDecisions(analysis: MergeAnalysis): MergeDecisions {
  const fieldChoices: Record<string, FieldChoice> = {};
  const eventChoices: Record<string, boolean> = {};
  const photoChoices: Record<string, boolean> = {};
  const docChoices: Record<string, boolean> = {};
  const unionInclude: Record<string, boolean> = {};
  const unionFieldChoices: Record<string, FieldChoice> = {};
  const linkInclude: Record<string, boolean> = {};
  const archivePhotoInclude: Record<string, boolean> = {};

  for (const m of analysis.matchedWithChanges) {
    for (const fd of m.fieldDiffs) {
      fieldChoices[`${m.personA.id}:${fd.key}`] =
        fd.kind === 'addition' ? 'take_b' : 'keep_a';
    }
    for (const ev of m.eventAdditions) {
      eventChoices[`${m.personA.id}:${ev.id}`] = ev.defaultInclude;
    }
    for (const ph of m.photoAdditions) {
      photoChoices[`${m.personA.id}:${ph.id}`] = ph.defaultInclude;
    }
    for (const doc of m.docAdditions) {
      docChoices[`${m.personA.id}:${doc.id}`] = doc.defaultInclude;
    }
  }

  for (const u of analysis.unions) {
    unionInclude[u.id] = true;
    for (const df of u.diffFields) {
      unionFieldChoices[`${u.id}:${df.key}`] = df.isAddition ? 'take_b' : 'keep_a';
    }
  }

  for (const l of analysis.parentChildLinks) {
    linkInclude[l.id] = true;
  }

  for (const ap of analysis.newArchivePhotos) {
    archivePhotoInclude[ap.id] = true;
  }

  return {
    manualPersonMap: {},
    fieldChoices,
    eventChoices,
    photoChoices,
    docChoices,
    unionInclude,
    unionFieldChoices,
    linkInclude,
    archivePhotoInclude,
    titleSource: 'a',
  };
}

function remapPhotoTags(
  photo: PhotoAttachment,
  bToMergedId: Record<string, string>
): PhotoAttachment {
  if (!photo.tags || photo.tags.length === 0) return photo;
  return {
    ...photo,
    tags: photo.tags
      .filter((t) => Boolean(bToMergedId[t.personId]))
      .map((t) => ({
        ...t,
        id: createId('tag'),
        personId: bToMergedId[t.personId],
      })),
  };
}

/**
 * Produces the final merged TreeDocument strictly applying every user choice
 * without mutating either input tree.
 */
export function applyTreeMerge(
  baseTree: TreeDocument,
  incomingTree: TreeDocument,
  analysis: MergeAnalysis,
  decisions: MergeDecisions
): TreeDocument {
  const nextPersons: Record<string, Person> = JSON.parse(JSON.stringify(baseTree.persons));
  const nextUnions: Union[] = JSON.parse(JSON.stringify(baseTree.unions));
  const nextLinks: ParentChildLink[] = JSON.parse(JSON.stringify(baseTree.parentChildLinks));

  // Build full map of incoming person B ID -> final person ID in merged tree
  const bToMergedId: Record<string, string> = { ...analysis.resolvedBToA };

  // 1. Add unmatched people from B unless skipped
  for (const entry of analysis.unmatchedB) {
    const b = entry.personB;
    if (decisions.manualPersonMap[b.id] === 'skip') continue;
    const targetId = nextPersons[b.id] ? createId('p') : b.id;
    bToMergedId[b.id] = targetId;
    nextPersons[targetId] = {
      ...JSON.parse(JSON.stringify(b)),
      id: targetId,
      customPos: undefined,
      customPositions: undefined,
    };
  }

  // Remap tags on newly added persons' photos once bToMergedId is complete
  for (const entry of analysis.unmatchedB) {
    const targetId = bToMergedId[entry.personB.id];
    if (!targetId || !nextPersons[targetId]) continue;
    nextPersons[targetId] = {
      ...nextPersons[targetId],
      photos: nextPersons[targetId].photos.map((ph) => remapPhotoTags(ph, bToMergedId)),
    };
  }

  // 2. Apply field/event/photo/doc decisions on matched persons
  for (const m of analysis.matchedWithChanges) {
    const p = nextPersons[m.personA.id];
    if (!p) continue;
    bToMergedId[m.personB.id] = m.personA.id;

    for (const fd of m.fieldDiffs) {
      const choice =
        decisions.fieldChoices[`${m.personA.id}:${fd.key}`] ??
        (fd.kind === 'addition' ? 'take_b' : 'keep_a');

      if (choice === 'keep_a') continue;

      if (choice === 'combine' && (fd.key === 'notes' || fd.key === 'occupation')) {
        if (fd.key === 'notes') {
          p.notes = [fd.valA, fd.valB].filter(Boolean).join('\n\n');
        } else {
          p.occupation = [fd.valA, fd.valB].filter(Boolean).join('; ');
        }
        continue;
      }

      // take_b
      switch (fd.key) {
        case 'lastName':
          p.lastName = m.personB.lastName;
          break;
        case 'firstName':
          p.firstName = m.personB.firstName;
          break;
        case 'middleName':
          p.middleName = m.personB.middleName;
          break;
        case 'maidenName':
          p.maidenName = m.personB.maidenName;
          break;
        case 'gender':
          p.gender = m.personB.gender;
          break;
        case 'birthDate':
          p.birthDate = fd.valB;
          break;
        case 'birthPlace':
          p.birthPlace = m.personB.birthPlace;
          break;
        case 'deathDate':
          p.deathDate = fd.valB;
          p.isLiving = false;
          break;
        case 'deathPlace':
          p.deathPlace = m.personB.deathPlace;
          break;
        case 'occupation':
          p.occupation = m.personB.occupation;
          break;
        case 'notes':
          p.notes = m.personB.notes;
          break;
        case 'verification':
          p.verification = m.personB.verification;
          break;
        case 'lineageColor':
          p.lineageColor = m.personB.lineageColor;
          break;
      }
    }

    for (const evAdd of m.eventAdditions) {
      const include = decisions.eventChoices[`${m.personA.id}:${evAdd.id}`] ?? true;
      if (!include) continue;
      p.events.push({
        ...JSON.parse(JSON.stringify(evAdd.event)),
        id: createId('ev'),
      });
    }
    p.events.sort(
      (x, y) => parseGenealogyDate(x.date).sortKey - parseGenealogyDate(y.date).sortKey
    );

    for (const phAdd of m.photoAdditions) {
      const include = decisions.photoChoices[`${m.personA.id}:${phAdd.id}`] ?? true;
      if (!include) continue;
      const clonedPhoto: PhotoAttachment = JSON.parse(JSON.stringify(phAdd.photo));
      clonedPhoto.id = createId('ph');
      clonedPhoto.isPrimary = p.photos.length === 0 ? clonedPhoto.isPrimary : false;
      p.photos.push(remapPhotoTags(clonedPhoto, bToMergedId));
    }

    for (const dAdd of m.docAdditions) {
      const include = decisions.docChoices[`${m.personA.id}:${dAdd.id}`] ?? true;
      if (!include) continue;
      const clonedDoc: DocumentAttachment = {
        ...JSON.parse(JSON.stringify(dAdd.doc)),
        id: createId('doc'),
      };
      if (dAdd.kind === 'birth') {
        p.birthDocuments = [...(p.birthDocuments || []), clonedDoc];
      } else {
        p.deathDocuments = [...(p.deathDocuments || []), clonedDoc];
      }
    }
  }

  // 3. Apply Unions
  for (const uItem of analysis.unions) {
    const [b0, b1] = uItem.partnerBIds;
    const m0 = bToMergedId[b0];
    const m1 = bToMergedId[b1];
    if (!m0 || !m1 || m0 === m1) continue;

    if (uItem.kind === 'new') {
      const include = decisions.unionInclude[uItem.id] ?? true;
      if (!include) continue;
      const alreadyExists = nextUnions.some(
        (u) => u.partnerIds.includes(m0) && u.partnerIds.includes(m1)
      );
      if (alreadyExists) continue;
      nextUnions.push({
        ...JSON.parse(JSON.stringify(uItem.unionB)),
        id: createId('u'),
        partnerIds: [m0, m1],
      });
    } else if (uItem.existingUnionA) {
      const targetUnion = nextUnions.find((u) => u.id === uItem.existingUnionA!.id);
      if (!targetUnion) continue;
      for (const df of uItem.diffFields) {
        const choice =
          decisions.unionFieldChoices[`${uItem.id}:${df.key}`] ??
          (df.isAddition ? 'take_b' : 'keep_a');
        if (choice === 'keep_a') continue;
        if (choice === 'combine' && df.key === 'notes') {
          targetUnion.notes = [df.valA, df.valB].filter(Boolean).join('\n\n');
          continue;
        }
        switch (df.key) {
          case 'status':
            targetUnion.status = uItem.unionB.status;
            break;
          case 'marriageDate':
            targetUnion.marriageDate = uItem.unionB.marriageDate;
            break;
          case 'marriagePlace':
            targetUnion.marriagePlace = uItem.unionB.marriagePlace;
            break;
          case 'divorceDate':
            targetUnion.divorceDate = uItem.unionB.divorceDate;
            break;
          case 'notes':
            targetUnion.notes = uItem.unionB.notes;
            break;
          case 'verification':
            targetUnion.verification = uItem.unionB.verification;
            break;
        }
      }
    }
  }

  // 4. Apply Parent-Child Links
  for (const lItem of analysis.parentChildLinks) {
    const include = decisions.linkInclude[lItem.id] ?? true;
    if (!include) continue;
    const mp = bToMergedId[lItem.parentBId];
    const mc = bToMergedId[lItem.childBId];
    if (!mp || !mc || mp === mc) continue;
    const exists = nextLinks.some((l) => l.parentId === mp && l.childId === mc);
    if (exists) continue;
    nextLinks.push({
      ...JSON.parse(JSON.stringify(lItem.linkB)),
      id: createId('pc'),
      parentId: mp,
      childId: mc,
    });
  }

  // 5. Merge Place Coordinates (add missing from B)
  const mergedPlaceCoords = {
    ...(incomingTree.placeCoords || {}),
    ...(baseTree.placeCoords || {}),
  };

  // 6. Merge Archive Photos
  const nextArchivePhotos: PhotoAttachment[] = JSON.parse(
    JSON.stringify(baseTree.archivePhotos || [])
  );
  for (const ap of analysis.newArchivePhotos) {
    const include = decisions.archivePhotoInclude[ap.id] ?? true;
    if (!include) continue;
    const cloned: PhotoAttachment = JSON.parse(JSON.stringify(ap));
    cloned.id = createId('arch');
    nextArchivePhotos.push(remapPhotoTags(cloned, bToMergedId));
  }

  return {
    ...baseTree,
    title:
      decisions.titleSource === 'b' && incomingTree.title
        ? incomingTree.title
        : baseTree.title,
    updatedAt: new Date().toISOString(),
    persons: nextPersons,
    unions: nextUnions,
    parentChildLinks: nextLinks,
    placeCoords: Object.keys(mergedPlaceCoords).length > 0 ? mergedPlaceCoords : undefined,
    archivePhotos: nextArchivePhotos.length > 0 ? nextArchivePhotos : undefined,
  };
}

export function formatEventSummaryForMerge(ev: LifeEvent): string {
  const typeLabel = EVENT_TYPE_LABELS[ev.type] || 'Событие';
  const parts = [ev.date || 'Без даты', typeLabel];
  if (ev.title && ev.title !== typeLabel) parts.push(`«${ev.title}»`);
  if (ev.place) parts.push(ev.place);
  return parts.join(' · ');
}

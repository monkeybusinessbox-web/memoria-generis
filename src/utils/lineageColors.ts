import { Person, TreeDocument } from '../types/genealogy';
import { parseGenealogyDate } from './dateUtils';

export const LINEAGE_PALETTE = [
  '#1F1E1C',
  '#0F3D5E',
  '#006D77',
  '#6B8E6F',
  '#556B2F',
  '#C48F3A',
  '#B5522C',
  '#8B2F2F',
  '#6D1F3C',
  '#C97B84',
  '#6A4C93',
  '#A58FB4',
  '#D0BBD6',
  '#E0C1C8',
  '#D9C29A',
  '#4E342E',
  '#8B6F47',
  '#B87333',
  '#7B9FB2',
  '#9CC4B8',
];

export function normalizeSurnameStem(raw?: string): string {
  if (!raw) return '';
  const cleaned = raw.trim().toLowerCase().replace(/ё/g, 'е').split(/[\s-]+/)[0] || '';
  if (!cleaned) return '';
  // Group standard Russian masculine/feminine surname endings (e.g., Воронцов / Воронцова -> воронцов)
  if (cleaned.length > 4) {
    if (cleaned.endsWith('ова') || cleaned.endsWith('ева') || cleaned.endsWith('ина')) {
      return cleaned.slice(0, -1);
    }
    if (cleaned.endsWith('ая')) {
      return cleaned.slice(0, -2) + 'ий';
    }
    if (cleaned.endsWith('ой')) {
      return cleaned.slice(0, -2) + 'ий';
    }
  }
  return cleaned;
}

function displaySurnameFamily(person: Person): string {
  const base = (person.maidenName && person.maidenName.trim()) || person.lastName.trim();
  return base || 'Род';
}

export interface LineageMapResult {
  personColor: Record<string, string>;
  personLineageName: Record<string, string>;
  personStem: Record<string, string>;
  primaryStem: string;
  bloodPersonIds: Set<string>;
  legend: { name: string; color: string; stem: string }[];
}

export function computeLineageColors(tree: TreeDocument): LineageMapResult {
  const persons = Object.values(tree.persons);
  if (persons.length === 0) {
    return {
      personColor: {},
      personLineageName: {},
      personStem: {},
      primaryStem: '',
      bloodPersonIds: new Set<string>(),
      legend: [],
    };
  }

  const childrenMap = new Map<string, string[]>();
  const validParentsByChild = new Map<string, string[]>();
  for (const link of tree.parentChildLinks) {
    if (!tree.persons[link.parentId] || !tree.persons[link.childId]) continue;
    const cList = childrenMap.get(link.parentId);
    if (cList) cList.push(link.childId);
    else childrenMap.set(link.parentId, [link.childId]);

    const pList = validParentsByChild.get(link.childId);
    if (pList) pList.push(link.parentId);
    else validParentsByChild.set(link.childId, [link.parentId]);
  }

  const depthMemo = new Map<string, number>();
  const getDescendantDepth = (pid: string, visiting = new Set<string>()): number => {
    if (depthMemo.has(pid)) return depthMemo.get(pid)!;
    if (visiting.has(pid)) return 0;
    visiting.add(pid);
    let maxD = 0;
    for (const cid of childrenMap.get(pid) || []) {
      maxD = Math.max(maxD, 1 + getDescendantDepth(cid, visiting));
    }
    visiting.delete(pid);
    depthMemo.set(pid, maxD);
    return maxD;
  };

  // Precompute each person's own surname stem (from maidenName if present, otherwise lastName)
  const ownStemById: Record<string, string> = {};
  const ownLabelById: Record<string, string> = {};
  for (const p of persons) {
    const label = displaySurnameFamily(p);
    ownLabelById[p.id] = label;
    ownStemById[p.id] = normalizeSurnameStem(label);
  }

  // Does a person have a father (male parent) with the same surname stem already in the tree?
  const hasSameStemFather = (p: Person): boolean => {
    const pStem = ownStemById[p.id];
    const pIds = validParentsByChild.get(p.id) || [];
    return pIds.some((pid) => {
      const parent = tree.persons[pid];
      return parent && parent.gender === 'male' && ownStemById[pid] === pStem;
    });
  };

  const compareOldestFather = (a: Person, b: Person): number => {
    // 1. Topmost person in the surname chain (no father of the same surname above them) comes first
    const aHasFather = hasSameStemFather(a) ? 1 : 0;
    const bHasFather = hasSameStemFather(b) ? 1 : 0;
    if (aHasFather !== bHasFather) return aHasFather - bHasFather;

    // 2. Males (fathers) take strict priority over females for anchoring a surname's color
    const aMale = a.gender === 'male' ? 0 : 1;
    const bMale = b.gender === 'male' ? 0 : 1;
    if (aMale !== bMale) return aMale - bMale;

    // 3. Prefer someone who is actually a father / parent in the tree over a childless individual
    const aIsParent = (childrenMap.get(a.id)?.length || 0) > 0 ? 0 : 1;
    const bIsParent = (childrenMap.get(b.id)?.length || 0) > 0 ? 0 : 1;
    if (aIsParent !== bIsParent) return aIsParent - bIsParent;

    // 4. Oldest by birth date (earliest birth year/date first)
    const aSort = parseGenealogyDate(a.birthDate).sortKey;
    const bSort = parseGenealogyDate(b.birthDate).sortKey;
    if (aSort !== bSort) return aSort - bSort;

    // 5. Higher generational depth (more generations below them) comes first when birth dates tie/missing
    const aDepth = getDescendantDepth(a.id);
    const bDepth = getDescendantDepth(b.id);
    if (bDepth !== aDepth) return bDepth - aDepth;

    // 6. More direct children as deterministic fallback
    const aKids = childrenMap.get(a.id)?.length || 0;
    const bKids = childrenMap.get(b.id)?.length || 0;
    if (bKids !== aKids) return bKids - aKids;

    return a.id.localeCompare(b.id);
  };

  // Group persons by their own surname stem and pick the oldest father for each surname
  const candidatesByStem: Record<string, Person[]> = {};
  for (const p of persons) {
    const stem = ownStemById[p.id];
    if (!stem) continue;
    if (!candidatesByStem[stem]) candidatesByStem[stem] = [];
    candidatesByStem[stem].push(p);
  }

  const anchorByStem: Record<string, Person> = {};
  for (const [stem, list] of Object.entries(candidatesByStem)) {
    const sortedCandidates = [...list].sort(compareOldestFather);
    anchorByStem[stem] = sortedCandidates[0];
  }

  // Sort surname stems chronologically by their oldest father so primary palette colors go to the earliest fathers
  const orderedStems = Object.keys(anchorByStem).sort((sA, sB) =>
    compareOldestFather(anchorByStem[sA], anchorByStem[sB])
  );

  const stemToColor: Record<string, string> = {};
  const stemToLabel: Record<string, string> = {};
  let paletteIdx = 0;

  for (const stem of orderedStems) {
    const anchor = anchorByStem[stem];
    const label = ownLabelById[anchor.id] || 'Род';
    stemToLabel[stem] = label;
    stemToColor[stem] =
      anchor.lineageColor || LINEAGE_PALETTE[paletteIdx % LINEAGE_PALETTE.length];
    paletteIdx += 1;
  }

  // Sort persons chronologically (oldest first) for top-down resolution
  const sorted = [...persons].sort(
    (a, b) => parseGenealogyDate(a.birthDate).sortKey - parseGenealogyDate(b.birthDate).sortKey
  );

  const hasParent = new Set(
    tree.parentChildLinks
      .filter((l) => tree.persons[l.parentId] && tree.persons[l.childId])
      .map((l) => l.childId)
  );
  const roots = sorted.filter((p) => !hasParent.has(p.id)).sort(compareOldestFather);

  // Compute each person's lineage stem/color top-down (inheriting father's line from the oldest father)
  const personStem: Record<string, string> = {};
  const personColor: Record<string, string> = {};
  const personLineageName: Record<string, string> = {};

  const resolvePerson = (pid: string, visited = new Set<string>()): string => {
    if (personColor[pid]) return personColor[pid];
    if (visited.has(pid)) return LINEAGE_PALETTE[0];
    visited.add(pid);

    const p = tree.persons[pid];
    if (!p) return LINEAGE_PALETTE[0];

    const ownStem = ownStemById[pid];
    const ownLabel = ownLabelById[pid];

    // If this person is the oldest-father anchor of their surname stem, always honor stemToColor[ownStem]
    if (ownStem && anchorByStem[ownStem]?.id === pid) {
      const col = p.lineageColor || stemToColor[ownStem] || LINEAGE_PALETTE[0];
      personStem[pid] = ownStem;
      personColor[pid] = col;
      personLineageName[pid] = stemToLabel[ownStem] || ownLabel;
      return col;
    }

    if (p.lineageColor) {
      personColor[pid] = p.lineageColor;
      personStem[pid] = ownStem;
      personLineageName[pid] = stemToLabel[ownStem] || ownLabel;
      return p.lineageColor;
    }

    const parentIds = validParentsByChild.get(pid) || [];
    if (parentIds.length > 0) {
      const fatherId = parentIds.find((parentId) => tree.persons[parentId]?.gender === 'male');
      if (fatherId) {
        const parentColor = resolvePerson(fatherId, visited);
        const pStem = personStem[fatherId];
        if (pStem) {
          personStem[pid] = pStem;
          personLineageName[pid] = stemToLabel[pStem] || ownLabel;
        } else {
          personStem[pid] = ownStem;
          personLineageName[pid] = stemToLabel[ownStem] || ownLabel;
        }
        personColor[pid] = parentColor;
        return parentColor;
      }

      // Only mother(s) in tree: inherit mother's line only if same surname or no surname;
      // otherwise use the person's own patrilineal surname stem (anchored by its oldest father)
      const motherId = parentIds[0];
      const motherColor = resolvePerson(motherId, visited);
      const mStem = personStem[motherId];
      if (!ownStem || !mStem || ownStem === mStem) {
        personStem[pid] = mStem || ownStem;
        personLineageName[pid] = stemToLabel[personStem[pid]] || ownLabel;
        personColor[pid] = motherColor;
        return motherColor;
      }
    }

    const col = (ownStem && stemToColor[ownStem]) || LINEAGE_PALETTE[0];
    personStem[pid] = ownStem;
    personColor[pid] = col;
    personLineageName[pid] = (ownStem && stemToLabel[ownStem]) || ownLabel;
    return col;
  };

  for (const p of sorted) {
    resolvePerson(p.id);
  }

  const legend = orderedStems.map((stem) => ({
    stem,
    name: stemToLabel[stem],
    color: stemToColor[stem],
  }));

  const primaryStem = legend[0]?.stem || '';

  // Determine blood relatives: primary root founder(s) of primaryStem + all descendants via parentChildLinks
  const bloodPersonIds = new Set<string>();
  const queue: string[] = [];
  for (const r of roots) {
    if (personStem[r.id] === primaryStem || !primaryStem) {
      bloodPersonIds.add(r.id);
      queue.push(r.id);
    }
  }
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const cid of childrenMap.get(curr) || []) {
      if (!bloodPersonIds.has(cid)) {
        bloodPersonIds.add(cid);
        queue.push(cid);
      }
    }
  }

  return {
    personColor,
    personLineageName,
    personStem,
    primaryStem,
    bloodPersonIds,
    legend,
  };
}

/**
 * Computes all consanguineous (blood) relatives of `anchorPersonId`:
 * all direct ancestors (across both paternal and maternal lines)
 * and all descendants of those ancestors (siblings, aunts/uncles,
 * cousins, nieces/nephews, children, grandchildren), excluding spouses
 * and in-law branches.
 */
export function computeBloodRelatives(
  tree: TreeDocument,
  anchorPersonId: string
): Set<string> {
  const blood = new Set<string>();
  if (!anchorPersonId || !tree.persons[anchorPersonId]) {
    return blood;
  }

  const parentsByChild = new Map<string, string[]>();
  const childrenByParent = new Map<string, string[]>();

  for (const link of tree.parentChildLinks) {
    if (!tree.persons[link.parentId] || !tree.persons[link.childId]) continue;
    const pList = parentsByChild.get(link.childId);
    if (pList) pList.push(link.parentId);
    else parentsByChild.set(link.childId, [link.parentId]);

    const cList = childrenByParent.get(link.parentId);
    if (cList) cList.push(link.childId);
    else childrenByParent.set(link.parentId, [link.childId]);
  }

  // 1. Walk upward from anchorPersonId to collect all blood ancestors (including self)
  const ancestors = new Set<string>([anchorPersonId]);
  const upQueue: string[] = [anchorPersonId];
  while (upQueue.length > 0) {
    const curr = upQueue.shift()!;
    const parents = parentsByChild.get(curr);
    if (!parents) continue;
    for (const pid of parents) {
      if (!ancestors.has(pid)) {
        ancestors.add(pid);
        upQueue.push(pid);
      }
    }
  }

  // 2. Walk downward from every ancestor (and anchorPersonId) to collect all blood descendants
  const downQueue: string[] = [];
  for (const aid of ancestors) {
    blood.add(aid);
    downQueue.push(aid);
  }
  while (downQueue.length > 0) {
    const curr = downQueue.shift()!;
    const children = childrenByParent.get(curr);
    if (!children) continue;
    for (const cid of children) {
      if (!blood.has(cid)) {
        blood.add(cid);
        downQueue.push(cid);
      }
    }
  }

  return blood;
}

export interface DescendantGenerationGroup {
  level: number;
  label: string;
  persons: Person[];
}

export interface DescendantStats {
  total: number;
  livingCount: number;
  maxDepth: number;
  generations: DescendantGenerationGroup[];
}

function getGenerationDescendantLabel(level: number): string {
  switch (level) {
    case 1:
      return 'Дети';
    case 2:
      return 'Внуки';
    case 3:
      return 'Правнуки';
    case 4:
      return 'Праправнуки';
    case 5:
      return 'Прапраправнуки';
    default:
      return `${level}-е поколение потомков`;
  }
}

/**
 * Computes descendant statistics for `personId` across all downward parent-child links:
 * total unique descendants, living descendants count, generation depth, and generation groups.
 */
export function computeDescendantStats(
  tree: TreeDocument,
  personId: string
): DescendantStats {
  if (!personId || !tree.persons[personId]) {
    return { total: 0, livingCount: 0, maxDepth: 0, generations: [] };
  }

  const childrenByParent = new Map<string, string[]>();
  for (const link of tree.parentChildLinks) {
    if (!tree.persons[link.parentId] || !tree.persons[link.childId]) continue;
    const list = childrenByParent.get(link.parentId);
    if (list) list.push(link.childId);
    else childrenByParent.set(link.parentId, [link.childId]);
  }

  const visited = new Set<string>([personId]);
  const byLevel = new Map<number, Person[]>();
  const queue: Array<{ id: string; level: number }> = [{ id: personId, level: 0 }];
  let total = 0;
  let livingCount = 0;
  let maxDepth = 0;

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const children = childrenByParent.get(curr.id);
    if (!children) continue;

    for (const cid of children) {
      if (visited.has(cid)) continue;
      const childPerson = tree.persons[cid];
      if (!childPerson) continue;

      visited.add(cid);
      const nextLevel = curr.level + 1;
      total += 1;
      if (nextLevel > maxDepth) maxDepth = nextLevel;
      if (!childPerson.deathDate?.trim() && childPerson.isLiving !== false) {
        livingCount += 1;
      }

      const levelList = byLevel.get(nextLevel);
      if (levelList) levelList.push(childPerson);
      else byLevel.set(nextLevel, [childPerson]);

      queue.push({ id: cid, level: nextLevel });
    }
  }

  const generations: DescendantGenerationGroup[] = Array.from(byLevel.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([level, list]) => ({
      level,
      label: getGenerationDescendantLabel(level),
      persons: [...list].sort((a, b) => {
        const ka = parseGenealogyDate(a.birthDate).sortKey;
        const kb = parseGenealogyDate(b.birthDate).sortKey;
        if (ka !== kb) return ka - kb;
        return `${a.lastName} ${a.firstName}`.localeCompare(
          `${b.lastName} ${b.firstName}`,
          'ru'
        );
      }),
    }));

  return {
    total,
    livingCount,
    maxDepth,
    generations,
  };
}

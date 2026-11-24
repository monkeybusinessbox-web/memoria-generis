import { EventType, Gender, Person, PhotoAttachment, TreeDocument } from '../types/genealogy';

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  birth: 'Рождение',
  death: 'Кончина',
  marriage: 'Бракосочетание',
  divorce: 'Развод',
  baptism: 'Крещение / Наречение',
  migration: 'Переезд / Эмиграция',
  education: 'Образование',
  career: 'Карьера и служба',
  award: 'Награда / Титул',
  residence: 'Место жительства',
  custom: 'Памятная дата',
};

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface ParsedDateInfo {
  year: number | null;
  month: number | null;
  day: number | null;
  approximate: boolean;
  sortKey: number;
}

export function parseGenealogyDate(raw?: string): ParsedDateInfo {
  if (!raw || !raw.trim()) {
    return { year: null, month: null, day: null, approximate: false, sortKey: Number.MAX_SAFE_INTEGER };
  }

  const trimmed = raw.trim();
  const approximate = /^([~≈]|ок\.?|abt\.?|est\.?|cal\.?|ca\.?)/i.test(trimmed);
  const cleaned = trimmed.replace(/^([~≈]|ок\.?|abt\.?|est\.?|cal\.?|ca\.?)\s*/i, '');

  // ISO-like YYYY-MM-DD or YYYY/MM/DD or YYYY-MM or YYYY (also strips trailing T...)
  const isoMatch = cleaned.match(/^(\d{3,4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?(?:T.*)?$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = isoMatch[2] ? Math.min(12, Math.max(1, parseInt(isoMatch[2], 10))) : null;
    const day = isoMatch[3] ? Math.min(31, Math.max(1, parseInt(isoMatch[3], 10))) : null;
    const sortKey = year * 10000 + (month ?? 0) * 100 + (day ?? 0);
    return { year, month, day, approximate, sortKey };
  }

  // DD.MM.YYYY or DD/MM/YYYY
  const ruMatch = cleaned.match(/^(\d{1,2})[./](\d{1,2})[./](\d{3,4})$/);
  if (ruMatch) {
    const day = Math.min(31, Math.max(1, parseInt(ruMatch[1], 10)));
    const month = Math.min(12, Math.max(1, parseInt(ruMatch[2], 10)));
    const year = parseInt(ruMatch[3], 10);
    const sortKey = year * 10000 + month * 100 + day;
    return { year, month, day, approximate, sortKey };
  }

  // MM.YYYY
  const ruMonthMatch = cleaned.match(/^(\d{1,2})\.(\d{3,4})$/);
  if (ruMonthMatch) {
    const month = Math.min(12, Math.max(1, parseInt(ruMonthMatch[1], 10)));
    const year = parseInt(ruMonthMatch[2], 10);
    const sortKey = year * 10000 + month * 100;
    return { year, month, day: null, approximate, sortKey };
  }

  // Fallback: extract first 4-digit year
  const yearMatch = cleaned.match(/(\d{4})/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    return { year, month: null, day: null, approximate, sortKey: year * 10000 };
  }

  return { year: null, month: null, day: null, approximate, sortKey: Number.MAX_SAFE_INTEGER };
}

/**
 * Formats all full dates strictly as dd.mm.yyyy (e.g. 21.02.1997).
 */
export function formatGenealogyDate(raw?: string): string {
  if (!raw || !raw.trim()) return '';
  const parsed = parseGenealogyDate(raw);
  if (!parsed.year) return raw.trim();

  const prefix = parsed.approximate ? 'ок. ' : '';
  if (parsed.day && parsed.month) {
    const dd = String(parsed.day).padStart(2, '0');
    const mm = String(parsed.month).padStart(2, '0');
    return `${prefix}${dd}.${mm}.${parsed.year}`;
  }
  if (parsed.month) {
    const mm = String(parsed.month).padStart(2, '0');
    return `${prefix}${mm}.${parsed.year}`;
  }
  return `${prefix}${parsed.year}`;
}

/**
 * Normalizes any recognized date string into stored dd.mm.yyyy (or ~yyyy) format.
 */
export function normalizeDateInputToRu(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const parsed = parseGenealogyDate(trimmed);
  if (!parsed.year) return trimmed;
  const approxPrefix = parsed.approximate ? '~' : '';
  if (parsed.day && parsed.month) {
    return `${approxPrefix}${String(parsed.day).padStart(2, '0')}.${String(parsed.month).padStart(2, '0')}.${parsed.year}`;
  }
  if (parsed.month) {
    return `${approxPrefix}${String(parsed.month).padStart(2, '0')}.${parsed.year}`;
  }
  return `${approxPrefix}${parsed.year}`;
}

/**
 * Migrates all stored dates across a TreeDocument to dd.mm.yyyy format.
 */
export function normalizeTreeDates(tree: TreeDocument): { tree: TreeDocument; changed: boolean } {
  let changed = false;
  const nextPersons: Record<string, Person> = {};

  for (const [id, p] of Object.entries(tree.persons)) {
    const nextBirth = p.birthDate ? normalizeDateInputToRu(p.birthDate) : p.birthDate;
    const nextDeath = p.deathDate ? normalizeDateInputToRu(p.deathDate) : p.deathDate;
    if (nextBirth !== p.birthDate || nextDeath !== p.deathDate) changed = true;

    let eventsChanged = false;
    const nextEvents = (p.events || []).map((ev) => {
      const nextEvDate = ev.date ? normalizeDateInputToRu(ev.date) : ev.date;
      if (nextEvDate !== ev.date) {
        eventsChanged = true;
        changed = true;
        return { ...ev, date: nextEvDate };
      }
      return ev;
    });

    nextPersons[id] =
      nextBirth !== p.birthDate || nextDeath !== p.deathDate || eventsChanged
        ? {
            ...p,
            birthDate: nextBirth,
            deathDate: nextDeath,
            events: nextEvents,
          }
        : p;
  }

  let unionsChanged = false;
  const nextUnions = (tree.unions || []).map((u) => {
    const nextMarr = u.marriageDate ? normalizeDateInputToRu(u.marriageDate) : u.marriageDate;
    const nextDiv = u.divorceDate ? normalizeDateInputToRu(u.divorceDate) : u.divorceDate;
    if (nextMarr !== u.marriageDate || nextDiv !== u.divorceDate) {
      unionsChanged = true;
      changed = true;
      return { ...u, marriageDate: nextMarr, divorceDate: nextDiv };
    }
    return u;
  });

  if (!changed) return { tree, changed: false };

  return {
    changed: true,
    tree: {
      ...tree,
      persons: nextPersons,
      unions: unionsChanged ? nextUnions : tree.unions,
    },
  };
}

/**
 * Compact lifespan format without spaces around em-dash:
 * - Deceased: "1900—1990"
 * - Living / no death date: "1969"
 */
export function formatLifespan(person: Pick<Person, 'birthDate' | 'deathDate' | 'isLiving'>): string {
  const b = parseGenealogyDate(person.birthDate);
  const d = parseGenealogyDate(person.deathDate);

  const bStr = b.year ? `${b.approximate ? '~' : ''}${b.year}` : '';

  if (!d.year && !person.deathDate?.trim()) {
    return bStr || '—';
  }

  const dStr = d.year ? `${d.approximate ? '~' : ''}${d.year}` : person.deathDate?.trim() || '?';
  return `${bStr || '?'}—${dStr}`;
}

/**
 * Lifespan wrapped in parentheses for person cards, e.g. (1900—1990) or (1969).
 */
export function formatCardLifespan(
  person: Pick<Person, 'birthDate' | 'deathDate' | 'isLiving'>
): string {
  const life = formatLifespan(person);
  return life === '—' ? '' : `(${life})`;
}

export function formatFullName(
  person: Pick<Person, 'firstName' | 'middleName' | 'lastName' | 'maidenName'>,
  includeMaiden = false
): string {
  const parts = [person.lastName, person.firstName, person.middleName].filter(
    (s) => s && s.trim().length > 0
  );
  const base = parts.join(' ').trim() || 'Без имени';
  if (includeMaiden && person.maidenName && person.maidenName.trim()) {
    return `${base} (урожд. ${person.maidenName.trim()})`;
  }
  return base;
}

export function formatShortName(person: Pick<Person, 'firstName' | 'middleName' | 'lastName'>): string {
  const first = person.firstName?.trim() || '';
  const middle = person.middleName?.trim() || '';
  const last = person.lastName?.trim() || '';
  if (first && last) {
    return middle ? `${first} ${middle} ${last}` : `${first} ${last}`;
  }
  return first || last || 'Без имени';
}

/**
 * Returns the surname to display in the genealogy tree:
 * for women with a maiden name specified, displays their maiden surname.
 */
export function getTreeDisplaySurname(
  person: Pick<Person, 'gender' | 'lastName' | 'maidenName'>
): string {
  if (person.gender === 'female' && person.maidenName && person.maidenName.trim()) {
    return person.maidenName.trim();
  }
  return person.lastName?.trim() || '—';
}

const PATRONYMIC_PLACEHOLDERS = new Set([
  'родитель',
  'общий родитель',
  'новый',
  'супруг',
  'супруга',
  'супруг(а)',
  'ребёнок',
  'ребенок',
  'брат',
  'сестра',
  'брат / сестра',
  'без имени',
]);

const SPECIAL_PATRONYMICS: Record<string, [string, string]> = {
  павел: ['Павлович', 'Павловна'],
  пётр: ['Петрович', 'Петровна'],
  петр: ['Петрович', 'Петровна'],
  михаил: ['Михайлович', 'Михайловна'],
  данила: ['Данилович', 'Даниловна'],
  даниил: ['Даниилович', 'Данииловна'],
  гавриил: ['Гавриилович', 'Гаврииловна'],
  лев: ['Львович', 'Львовна'],
  яков: ['Яковлевич', 'Яковлевна'],
  илья: ['Ильич', 'Ильинична'],
  кузьма: ['Кузьмич', 'Кузьминична'],
  фома: ['Фомич', 'Фоминична'],
  лука: ['Лукич', 'Лукинична'],
  никита: ['Никитич', 'Никитична'],
  савва: ['Саввич', 'Саввична'],
  добрыня: ['Добрынич', 'Добрынична'],
  игорь: ['Игоревич', 'Игоревна'],
  лазарь: ['Лазаревич', 'Лазаревна'],
  цезарь: ['Цезаревич', 'Цезаревна'],
  дмитрий: ['Дмитриевич', 'Дмитриевна'],
  георгий: ['Георгиевич', 'Георгиевна'],
  сергий: ['Сергиевич', 'Сергиевна'],
  иннокентий: ['Иннокентьевич', 'Иннокентьевна'],
  климентий: ['Климентьевич', 'Климентьевна'],
  константин: ['Константинович', 'Константиновна'],
};

export function derivePatronymic(
  fatherFirstName?: string,
  childGender: Gender = 'male'
): string {
  const raw = (fatherFirstName || '').trim();
  if (!raw) return '';
  const lowerFull = raw.toLowerCase();
  if (PATRONYMIC_PLACEHOLDERS.has(lowerFull)) return '';

  const firstToken = raw.split(/\s+/)[0] || '';
  if (!firstToken) return '';
  const lower = firstToken.toLowerCase();
  if (PATRONYMIC_PLACEHOLDERS.has(lower)) return '';

  const isFemale = childGender === 'female';
  const special = SPECIAL_PATRONYMICS[lower];
  if (special) {
    return isFemale ? special[1] : special[0];
  }

  const cap = firstToken.charAt(0).toUpperCase() + firstToken.slice(1);
  if (lower.endsWith('ий') && cap.length > 3) {
    const stem = cap.slice(0, -2);
    return `${stem}${isFemale ? 'ьевна' : 'ьевич'}`;
  }
  if ((lower.endsWith('ей') || lower.endsWith('ай') || lower.endsWith('ой') || lower.endsWith('уй') || lower.endsWith('юй')) && cap.length > 2) {
    const stem = cap.slice(0, -1);
    return `${stem}${isFemale ? 'евна' : 'евич'}`;
  }
  if (lower.endsWith('ь') && cap.length > 2) {
    const stem = cap.slice(0, -1);
    return `${stem}${isFemale ? 'евна' : 'евич'}`;
  }
  if ((lower.endsWith('а') || lower.endsWith('я')) && cap.length > 2) {
    const stem = cap.slice(0, -1);
    return `${stem}${isFemale ? 'инична' : 'ич'}`;
  }
  if (/[жшчщц]$/.test(lower)) {
    return `${cap}${isFemale ? 'евна' : 'евич'}`;
  }
  if (/[аеёиоуыэюя]$/.test(lower)) {
    return `${cap}${isFemale ? 'вна' : 'вич'}`;
  }
  return `${cap}${isFemale ? 'овна' : 'ович'}`;
}

export function computeAgeAtYear(birthDate?: string, eventDate?: string): string | undefined {
  const b = parseGenealogyDate(birthDate);
  const e = parseGenealogyDate(eventDate);
  if (!b.year || !e.year || e.year < b.year) return undefined;
  let age = e.year - b.year;
  if (b.month && e.month) {
    if (e.month < b.month || (e.month === b.month && b.day && e.day && e.day < b.day)) {
      age -= 1;
    }
  }
  if (age < 0 || age > 125) return undefined;
  if (age === 0) return 'младенчество';
  const mod10 = age % 10;
  const mod100 = age % 100;
  let suffix = 'лет';
  if (mod10 === 1 && mod100 !== 11) suffix = 'год';
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) suffix = 'года';
  return `${age} ${suffix}`;
}

export function getPrimaryPhotoObj(person: Person): PhotoAttachment | null {
  if (!person.photos || person.photos.length === 0) return null;
  return person.photos.find((p) => p.isPrimary) || person.photos[0];
}

export function getPrimaryPhoto(person: Person): string | null {
  const ph = getPrimaryPhotoObj(person);
  return ph?.dataUrl || null;
}

export function getPersonInitials(person: Pick<Person, 'firstName' | 'lastName'>): string {
  const a = person.firstName?.trim()?.[0] || '';
  const b = person.lastName?.trim()?.[0] || '';
  return (a + b).toUpperCase() || '?';
}

export function estimateDataUrlBytes(dataUrl: string): number {
  if (!dataUrl || !dataUrl.startsWith('data:')) return 0;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return 0;
  const b64 = dataUrl.slice(commaIdx + 1);
  return Math.round((b64.length * 3) / 4);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

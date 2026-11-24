import {
  EventType,
  Gender,
  LifeEvent,
  ParentChildLink,
  Person,
  TreeDocument,
  Union,
  VerificationStatus,
} from '../types/genealogy';
import { createId, parseGenealogyDate } from './dateUtils';

const GEDCOM_MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

function parseGedcomDate(raw: string): { date: string; approximate: boolean } {
  const cleaned = raw.trim();
  const isApprox = /^(ABT|EST|CAL|CIR|CA)\b/i.test(cleaned);
  const stripped = cleaned.replace(/^(ABT|EST|CAL|CIR|CA|BEF|AFT|FROM|TO)\s+/i, '').trim();

  // e.g. 14 MAY 1923 or MAY 1923 or 1923
  const fullMatch = stripped.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{3,4})$/i);
  if (fullMatch) {
    const day = fullMatch[1].padStart(2, '0');
    const mIdx = GEDCOM_MONTHS.indexOf(fullMatch[2].toUpperCase());
    const month = mIdx >= 0 ? String(mIdx + 1).padStart(2, '0') : '01';
    const year = fullMatch[3];
    return { date: `${isApprox ? '~' : ''}${day}.${month}.${year}`, approximate: isApprox };
  }

  const monthMatch = stripped.match(/^([A-Z]{3})\s+(\d{3,4})$/i);
  if (monthMatch) {
    const mIdx = GEDCOM_MONTHS.indexOf(monthMatch[1].toUpperCase());
    const month = mIdx >= 0 ? String(mIdx + 1).padStart(2, '0') : '01';
    return { date: `${isApprox ? '~' : ''}${month}.${monthMatch[2]}`, approximate: isApprox };
  }

  const yearMatch = stripped.match(/^(\d{3,4})$/);
  if (yearMatch) {
    return { date: `${isApprox ? '~' : ''}${yearMatch[1]}`, approximate: isApprox };
  }

  // DD.MM.YYYY or YYYY-MM-DD
  const ruMatch = stripped.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ruMatch) {
    return {
      date: `${isApprox ? '~' : ''}${ruMatch[1].padStart(2, '0')}.${ruMatch[2].padStart(2, '0')}.${ruMatch[3]}`,
      approximate: isApprox,
    };
  }
  const isoMatch = stripped.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return {
      date: `${isApprox ? '~' : ''}${isoMatch[3].padStart(2, '0')}.${isoMatch[2].padStart(2, '0')}.${isoMatch[1]}`,
      approximate: isApprox,
    };
  }

  return { date: cleaned, approximate: isApprox };
}

function toGedcomDate(raw?: string): string {
  if (!raw || !raw.trim()) return '';
  const parsed = parseGenealogyDate(raw);
  if (!parsed.year) return raw.trim();
  const prefix = parsed.approximate ? 'ABT ' : '';
  if (parsed.day && parsed.month) {
    return `${prefix}${parsed.day} ${GEDCOM_MONTHS[parsed.month - 1]} ${parsed.year}`;
  }
  if (parsed.month) {
    return `${prefix}${GEDCOM_MONTHS[parsed.month - 1]} ${parsed.year}`;
  }
  return `${prefix}${parsed.year}`;
}

function decodeGedcomBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Check UTF-8 / UTF-16 BOM
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  const utf8Text = new TextDecoder('utf-8').decode(bytes);
  // Check CHAR declaration in header
  const charMatch = utf8Text.slice(0, 1024).match(/^\s*1\s+CHAR\s+(.+)$/im);
  const charset = charMatch ? charMatch[1].trim().toUpperCase() : 'UTF-8';
  if (charset === 'ANSI' || charset === 'WIN1251' || charset === 'WINDOWS-1251' || charset === 'CP1251') {
    try {
      return new TextDecoder('windows-1251').decode(bytes);
    } catch {
      return utf8Text;
    }
  }
  return utf8Text;
}

interface GedLine {
  level: number;
  xref?: string;
  tag: string;
  value: string;
}

function parseLines(text: string): GedLine[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const result: GedLine[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$/);
    if (!match) continue;
    result.push({
      level: parseInt(match[1], 10),
      xref: match[2] || undefined,
      tag: match[3].toUpperCase(),
      value: (match[4] || '').trim(),
    });
  }
  return result;
}

function mapGedEventType(tag: string, customType?: string): { type: EventType; title: string } {
  switch (tag) {
    case 'BAPM':
    case 'CHR':
      return { type: 'baptism', title: 'Крещение' };
    case 'OCCU':
      return { type: 'career', title: customType || 'Служба / Занятие' };
    case 'EDUC':
      return { type: 'education', title: customType || 'Образование' };
    case 'RESI':
      return { type: 'residence', title: customType || 'Проживание' };
    case 'EMIG':
    case 'IMMI':
      return { type: 'migration', title: customType || 'Переезд / Миграция' };
    case 'BURI':
      return { type: 'custom', title: 'Погребение' };
    default:
      return { type: 'custom', title: customType || 'Памятная дата' };
  }
}

export function importGedcomBuffer(buffer: ArrayBuffer, fileName = 'Импортированное древо'): TreeDocument {
  const text = decodeGedcomBytes(buffer);
  return importGedcomText(text, fileName);
}

export function importGedcomText(text: string, fileName = 'Импортированное древо'): TreeDocument {
  const lines = parseLines(text);

  interface RawIndi {
    xref: string;
    firstName: string;
    middleName?: string;
    lastName: string;
    gender: Gender;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
    isLiving?: boolean;
    occupation?: string;
    notes: string[];
    events: LifeEvent[];
    verification: VerificationStatus;
    customPositions?: Person['customPositions'];
  }

  interface RawFam {
    xref: string;
    husb?: string;
    wife?: string;
    children: string[];
    marriageDate?: string;
    marriagePlace?: string;
    divorceDate?: string;
    isDivorced: boolean;
    verification: VerificationStatus;
  }

  const indis: Record<string, RawIndi> = {};
  const fams: Record<string, RawFam> = {};
  const sharedNotes: Record<string, string> = {};

  let currentRecordKind: 'INDI' | 'FAM' | 'NOTE' | 'OTHER' = 'OTHER';
  let currentId = '';
  let currentSubTag = '';
  let currentEvent: LifeEvent | null = null;
  let currentNoteTarget: 'INDI' | 'EVENT' | null = null;

  for (const l of lines) {
    if (l.level === 0) {
      currentSubTag = '';
      currentEvent = null;
      currentNoteTarget = null;
      if (l.tag === 'INDI' && l.xref) {
        currentRecordKind = 'INDI';
        currentId = l.xref;
        indis[currentId] = {
          xref: l.xref,
          firstName: '',
          lastName: '',
          gender: 'other',
          notes: [],
          events: [],
          verification: 'unverified',
        };
      } else if (l.tag === 'FAM' && l.xref) {
        currentRecordKind = 'FAM';
        currentId = l.xref;
        fams[currentId] = {
          xref: l.xref,
          children: [],
          isDivorced: false,
          verification: 'unverified',
        };
      } else if (l.tag === 'NOTE' && l.xref) {
        currentRecordKind = 'NOTE';
        currentId = l.xref;
        sharedNotes[currentId] = l.value;
      } else {
        currentRecordKind = 'OTHER';
        currentId = '';
      }
      continue;
    }

    if (currentRecordKind === 'NOTE' && currentId) {
      if (l.tag === 'CONT') sharedNotes[currentId] += '\n' + l.value;
      else if (l.tag === 'CONC') sharedNotes[currentId] += l.value;
      continue;
    }

    if (currentRecordKind === 'INDI' && indis[currentId]) {
      const indi = indis[currentId];
      if (l.level === 1) {
        currentSubTag = l.tag;
        currentEvent = null;
        currentNoteTarget = null;

        if (l.tag === 'NAME') {
          const surnameMatch = l.value.match(/\/([^/]*)\//);
          const surname = surnameMatch ? surnameMatch[1].trim() : '';
          const givenRaw = l.value.replace(/\/[^/]*\//, '').trim();
          const givenParts = givenRaw.split(/\s+/).filter(Boolean);
          if (!indi.firstName && givenParts.length > 0) {
            indi.firstName = givenParts[0];
            if (givenParts.length > 1 && !indi.middleName) {
              indi.middleName = givenParts.slice(1).join(' ');
            }
          }
          if (!indi.lastName && surname) {
            indi.lastName = surname;
          }
        } else if (l.tag === 'SEX') {
          if (l.value === 'M') indi.gender = 'male';
          else if (l.value === 'F') indi.gender = 'female';
        } else if (l.tag === '_VERIF') {
          if (l.value === 'confirmed' || l.value === 'possible') {
            indi.verification = l.value;
          }
        } else if (l.tag === 'NOTE') {
          if (l.value.startsWith('@') && l.value.endsWith('@')) {
            indi.notes.push(l.value);
          } else {
            indi.notes.push(l.value);
          }
          currentNoteTarget = 'INDI';
        } else if (l.tag === 'OCCU') {
          if (l.value) indi.occupation = indi.occupation ? `${indi.occupation}, ${l.value}` : l.value;
          const mapped = mapGedEventType('OCCU', l.value);
          currentEvent = {
            id: createId('ev'),
            type: mapped.type,
            title: mapped.title,
            date: '',
            verification: 'unverified',
          };
          indi.events.push(currentEvent);
        } else if (
          ['EVEN', 'BAPM', 'CHR', 'EDUC', 'RESI', 'EMIG', 'IMMI', 'BURI'].includes(l.tag)
        ) {
          const mapped = mapGedEventType(l.tag, l.value || undefined);
          currentEvent = {
            id: createId('ev'),
            type: mapped.type,
            title: mapped.title,
            date: '',
            verification: 'unverified',
          };
          indi.events.push(currentEvent);
        } else if (l.tag === 'DEAT') {
          indi.isLiving = false;
        } else if (l.tag === '_POSV' || l.tag === '_POSH') {
          const coords = l.value.trim().split(/\s+/).map(Number);
          if (coords.length >= 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
            const modeKey = l.tag === '_POSV' ? 'vertical' : 'horizontal';
            indi.customPositions = {
              ...(indi.customPositions || {}),
              [modeKey]: { x: coords[0], y: coords[1] },
            };
          }
        }
      } else if (l.level >= 2) {
        if (currentSubTag === 'NAME') {
          if (l.tag === 'GIVN') indi.firstName = l.value;
          else if (l.tag === 'SURN') indi.lastName = l.value;
          else if (l.tag === '_MIDN' || l.tag === 'MIDN') indi.middleName = l.value;
        } else if (currentSubTag === 'BIRT') {
          if (l.tag === 'DATE') {
            const d = parseGedcomDate(l.value);
            indi.birthDate = d.date;
            if (d.approximate && indi.verification === 'unverified') indi.verification = 'possible';
          } else if (l.tag === 'PLAC') {
            indi.birthPlace = l.value;
          }
        } else if (currentSubTag === 'DEAT') {
          if (l.tag === 'DATE') {
            const d = parseGedcomDate(l.value);
            indi.deathDate = d.date;
          } else if (l.tag === 'PLAC') {
            indi.deathPlace = l.value;
          }
        } else if (currentSubTag === 'NOTE' && currentNoteTarget === 'INDI') {
          const lastIdx = indi.notes.length - 1;
          if (lastIdx >= 0) {
            if (l.tag === 'CONT') indi.notes[lastIdx] += '\n' + l.value;
            else if (l.tag === 'CONC') indi.notes[lastIdx] += l.value;
          }
        } else if (currentEvent) {
          if (l.tag === 'TYPE' && l.value) {
            currentEvent.title = l.value;
          } else if (l.tag === 'DATE') {
            const d = parseGedcomDate(l.value);
            currentEvent.date = d.date;
            if (d.approximate && currentEvent.verification === 'unverified') {
              currentEvent.verification = 'possible';
            }
          } else if (l.tag === 'PLAC') {
            currentEvent.place = l.value;
          } else if (l.tag === '_VERIF') {
            if (l.value === 'confirmed' || l.value === 'possible') {
              currentEvent.verification = l.value;
            }
          } else if (l.tag === 'NOTE') {
            currentEvent.description = l.value;
          }
        }
      }
      continue;
    }

    if (currentRecordKind === 'FAM' && fams[currentId]) {
      const fam = fams[currentId];
      if (l.level === 1) {
        currentSubTag = l.tag;
        if (l.tag === 'HUSB') fam.husb = l.value;
        else if (l.tag === 'WIFE') fam.wife = l.value;
        else if (l.tag === 'CHIL') fam.children.push(l.value);
        else if (l.tag === 'DIV') fam.isDivorced = true;
        else if (l.tag === '_VERIF') {
          if (l.value === 'confirmed' || l.value === 'possible') {
            fam.verification = l.value;
          }
        }
      } else if (l.level >= 2) {
        if (currentSubTag === 'MARR') {
          if (l.tag === 'DATE') {
            const d = parseGedcomDate(l.value);
            fam.marriageDate = d.date;
            if (d.approximate && fam.verification === 'unverified') fam.verification = 'possible';
          } else if (l.tag === 'PLAC') {
            fam.marriagePlace = l.value;
          }
        } else if (currentSubTag === 'DIV' && l.tag === 'DATE') {
          fam.divorceDate = parseGedcomDate(l.value).date;
        }
      }
    }
  }

  // Convert into TreeDocument
  const xrefToPersonId: Record<string, string> = {};
  const persons: Record<string, Person> = {};

  for (const [xref, raw] of Object.entries(indis)) {
    const id = createId('p');
    xrefToPersonId[xref] = id;

    const resolvedNotes = raw.notes
      .map((n) => (n.startsWith('@') && sharedNotes[n] ? sharedNotes[n] : n))
      .filter(Boolean)
      .join('\n\n');

    const cleanedEvents = raw.events.filter((e) => e.date || e.place || e.description);

    persons[id] = {
      id,
      firstName: raw.firstName || 'Без имени',
      middleName: raw.middleName,
      lastName: raw.lastName || '',
      gender: raw.gender,
      birthDate: raw.birthDate,
      birthPlace: raw.birthPlace,
      deathDate: raw.deathDate,
      deathPlace: raw.deathPlace,
      isLiving: raw.deathDate ? false : raw.isLiving,
      occupation: raw.occupation,
      notes: resolvedNotes,
      verification: raw.verification,
      events: cleanedEvents,
      photos: [],
      customPositions: raw.customPositions,
    };
  }

  const unions: Union[] = [];
  const parentChildLinks: ParentChildLink[] = [];

  for (const fam of Object.values(fams)) {
    const husbId = fam.husb ? xrefToPersonId[fam.husb] : undefined;
    const wifeId = fam.wife ? xrefToPersonId[fam.wife] : undefined;

    if (husbId && wifeId) {
      unions.push({
        id: createId('u'),
        partnerIds: [husbId, wifeId],
        status: fam.isDivorced ? 'divorced' : 'married',
        marriageDate: fam.marriageDate,
        marriagePlace: fam.marriagePlace,
        divorceDate: fam.divorceDate,
        verification: fam.verification,
      });
    }

    for (const childXref of fam.children) {
      const childId = xrefToPersonId[childXref];
      if (!childId) continue;
      if (husbId) {
        parentChildLinks.push({
          id: createId('pc'),
          parentId: husbId,
          childId,
          relationType: 'biological',
          verification: fam.verification,
        });
      }
      if (wifeId) {
        parentChildLinks.push({
          id: createId('pc'),
          parentId: wifeId,
          childId,
          relationType: 'biological',
          verification: fam.verification,
        });
      }
    }
  }

  const cleanTitle = fileName.replace(/\.(ged|gedcom)$/i, '') || 'Импортированное древо';
  return {
    id: createId('tree'),
    title: cleanTitle,
    subtitle: 'Импорт из GEDCOM (.ged)',
    updatedAt: new Date().toISOString(),
    persons,
    unions,
    parentChildLinks,
  };
}

export function exportTreeToGedcom(tree: TreeDocument): string {
  const lines: string[] = [];
  lines.push('0 HEAD');
  lines.push('1 SOUR LetopisRoda');
  lines.push('2 NAME Letopis Roda Genealogy Archive');
  lines.push('1 GEDC');
  lines.push('2 VERS 5.5.1');
  lines.push('2 FORM LINEAGE-LINKED');
  lines.push('1 CHAR UTF-8');

  const personList = Object.values(tree.persons);
  const idToIndiXref: Record<string, string> = {};
  personList.forEach((p, idx) => {
    idToIndiXref[p.id] = `@I${idx + 1}@`;
  });

  // Build families from unions + single-parent children
  interface ExportFam {
    xref: string;
    husb?: string;
    wife?: string;
    children: string[];
    union?: Union;
  }
  const exportFams: ExportFam[] = [];
  const famsForPerson: Record<string, string[]> = {};
  const famcForPerson: Record<string, string[]> = {};
  const handledChildLinks = new Set<string>();

  tree.unions.forEach((union, idx) => {
    const [aId, bId] = union.partnerIds;
    const pA = tree.persons[aId];
    const pB = tree.persons[bId];
    if (!pA || !pB) return;

    const xref = `@F${idx + 1}@`;
    let husb = aId;
    let wife = bId;
    if (pA.gender === 'female' && pB.gender !== 'female') {
      husb = bId;
      wife = aId;
    }

    const childIds = Array.from(
      new Set(
        tree.parentChildLinks
          .filter((l) => l.parentId === aId || l.parentId === bId)
          .map((l) => l.childId)
      )
    ).filter((cid) => {
      // Attach child to this union if at least one parent is here and not exclusively another union
      const pLinks = tree.parentChildLinks.filter((l) => l.childId === cid);
      const hasA = pLinks.some((l) => l.parentId === aId);
      const hasB = pLinks.some((l) => l.parentId === bId);
      if (hasA && hasB) {
        pLinks
          .filter((l) => l.parentId === aId || l.parentId === bId)
          .forEach((l) => handledChildLinks.add(l.id));
        return true;
      }
      return false;
    });

    exportFams.push({ xref, husb, wife, children: childIds, union });
    (famsForPerson[husb] ||= []).push(xref);
    (famsForPerson[wife] ||= []).push(xref);
    childIds.forEach((cid) => (famcForPerson[cid] ||= []).push(xref));
  });

  // Remaining parent-child links without a 2-parent union
  const singleParentMap = new Map<string, string[]>();
  for (const link of tree.parentChildLinks) {
    if (handledChildLinks.has(link.id)) continue;
    if (!tree.persons[link.parentId] || !tree.persons[link.childId]) continue;
    const arr = singleParentMap.get(link.parentId) || [];
    if (!arr.includes(link.childId)) arr.push(link.childId);
    singleParentMap.set(link.parentId, arr);
  }
  for (const [parentId, children] of singleParentMap.entries()) {
    const xref = `@F${exportFams.length + 1}@`;
    const parent = tree.persons[parentId];
    const isFemale = parent.gender === 'female';
    exportFams.push({
      xref,
      husb: isFemale ? undefined : parentId,
      wife: isFemale ? parentId : undefined,
      children,
    });
    (famsForPerson[parentId] ||= []).push(xref);
    children.forEach((cid) => (famcForPerson[cid] ||= []).push(xref));
  }

  // Emit INDI records
  for (const person of personList) {
    const xref = idToIndiXref[person.id];
    const given = [person.firstName, person.middleName].filter(Boolean).join(' ').trim();
    const surname = person.lastName.trim();
    lines.push(`0 ${xref} INDI`);
    lines.push(`1 NAME ${given} /${surname}/`);
    if (person.firstName) lines.push(`2 GIVN ${person.firstName}`);
    if (person.middleName) lines.push(`2 _MIDN ${person.middleName}`);
    if (surname) lines.push(`2 SURN ${surname}`);

    if (person.gender === 'male') lines.push('1 SEX M');
    else if (person.gender === 'female') lines.push('1 SEX F');

    if (person.verification && person.verification !== 'unverified') {
      lines.push(`1 _VERIF ${person.verification}`);
    }

    if (person.birthDate || person.birthPlace) {
      lines.push('1 BIRT');
      const gd = toGedcomDate(person.birthDate);
      if (gd) lines.push(`2 DATE ${gd}`);
      if (person.birthPlace) lines.push(`2 PLAC ${person.birthPlace}`);
    }

    if (person.deathDate || person.deathPlace || person.isLiving === false) {
      lines.push('1 DEAT');
      const gd = toGedcomDate(person.deathDate);
      if (gd) lines.push(`2 DATE ${gd}`);
      if (person.deathPlace) lines.push(`2 PLAC ${person.deathPlace}`);
    }

    if (person.occupation) {
      lines.push(`1 OCCU ${person.occupation}`);
    }

    for (const ev of person.events) {
      const tag = ev.type === 'baptism' ? 'CHR' : ev.type === 'education' ? 'EDUC' : ev.type === 'migration' ? 'RESI' : 'EVEN';
      lines.push(`1 ${tag}`);
      if (tag === 'EVEN' && ev.title) lines.push(`2 TYPE ${ev.title}`);
      const gd = toGedcomDate(ev.date);
      if (gd) lines.push(`2 DATE ${gd}`);
      if (ev.place) lines.push(`2 PLAC ${ev.place}`);
      if (ev.description) lines.push(`2 NOTE ${ev.description.replace(/\n/g, ' ')}`);
      if (ev.verification !== 'unverified') lines.push(`2 _VERIF ${ev.verification}`);
    }

    if (person.notes && person.notes.trim()) {
      const noteLines = person.notes.split(/\r?\n/);
      lines.push(`1 NOTE ${noteLines[0]}`);
      for (let i = 1; i < noteLines.length; i++) {
        lines.push(`2 CONT ${noteLines[i]}`);
      }
    }

    for (const fx of famsForPerson[person.id] || []) {
      lines.push(`1 FAMS ${fx}`);
    }
    for (const fx of famcForPerson[person.id] || []) {
      lines.push(`1 FAMC ${fx}`);
    }

    const posV = person.customPositions?.vertical || person.customPos;
    const posH = person.customPositions?.horizontal;
    if (posV && Number.isFinite(posV.x) && Number.isFinite(posV.y)) {
      lines.push(`1 _POSV ${Math.round(posV.x)} ${Math.round(posV.y)}`);
    }
    if (posH && Number.isFinite(posH.x) && Number.isFinite(posH.y)) {
      lines.push(`1 _POSH ${Math.round(posH.x)} ${Math.round(posH.y)}`);
    }
  }

  // Emit FAM records
  for (const fam of exportFams) {
    lines.push(`0 ${fam.xref} FAM`);
    if (fam.husb && idToIndiXref[fam.husb]) lines.push(`1 HUSB ${idToIndiXref[fam.husb]}`);
    if (fam.wife && idToIndiXref[fam.wife]) lines.push(`1 WIFE ${idToIndiXref[fam.wife]}`);
    for (const cid of fam.children) {
      if (idToIndiXref[cid]) lines.push(`1 CHIL ${idToIndiXref[cid]}`);
    }
    if (fam.union) {
      if (fam.union.verification !== 'unverified') {
        lines.push(`1 _VERIF ${fam.union.verification}`);
      }
      if (fam.union.marriageDate || fam.union.marriagePlace || fam.union.status === 'married') {
        lines.push('1 MARR');
        const gd = toGedcomDate(fam.union.marriageDate);
        if (gd) lines.push(`2 DATE ${gd}`);
        if (fam.union.marriagePlace) lines.push(`2 PLAC ${fam.union.marriagePlace}`);
      }
      if (fam.union.status === 'divorced' || fam.union.divorceDate) {
        lines.push('1 DIV');
        const gd = toGedcomDate(fam.union.divorceDate);
        if (gd) lines.push(`2 DATE ${gd}`);
      }
    }
  }

  lines.push('0 TRLR');
  return lines.join('\r\n');
}

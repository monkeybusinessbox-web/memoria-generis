import { TreeDocument } from '../types/genealogy';
import { formatFullName, formatGenealogyDate, parseGenealogyDate } from './dateUtils';

export type ValidationSeverity = 'error' | 'warning';

export interface TreeValidationIssue {
  id: string;
  severity: ValidationSeverity;
  personId: string;
  relatedPersonId?: string;
  unionId?: string;
  title: string;
  description: string;
}

const VALID_YEAR_MIN = 1000;

function toApproxYears(sortKey: number): number | null {
  if (!Number.isFinite(sortKey) || sortKey === Number.MAX_SAFE_INTEGER) return null;
  const year = Math.floor(sortKey / 10000);
  if (year < VALID_YEAR_MIN) return null;
  const rem = sortKey % 10000;
  const month = Math.floor(rem / 100) || 6;
  const day = (rem % 100) || 15;
  return year + (month - 1) / 12 + (day - 1) / 365.25;
}

export function validateTreeLogic(tree: TreeDocument): TreeValidationIssue[] {
  const issues: TreeValidationIssue[] = [];
  const persons = Object.values(tree.persons);
  const hasParentInTree = new Set<string>();
  for (const link of tree.parentChildLinks) {
    if (tree.persons[link.parentId] && tree.persons[link.childId]) {
      hasParentInTree.add(link.childId);
    }
  }

  // 1. Person-level birth/death/lifespan, patronymic & event date checks
  for (const person of persons) {
    const name = formatFullName(person) || 'Без имени';
    if (hasParentInTree.has(person.id) && (!person.middleName || !person.middleName.trim())) {
      issues.push({
        id: `err_missing_patronymic_${person.id}`,
        severity: 'error',
        personId: person.id,
        title: `Не указано отчество: ${name}`,
        description: `У персоны «${name}» не заполнено поле «Отчество».`,
      });
    }

    const bParsed = parseGenealogyDate(person.birthDate);
    const dParsed = parseGenealogyDate(person.deathDate);
    const bYears = toApproxYears(bParsed.sortKey);
    const dYears = toApproxYears(dParsed.sortKey);

    if (bYears !== null && dYears !== null) {
      if (dParsed.sortKey < bParsed.sortKey) {
        issues.push({
          id: `err_death_before_birth_${person.id}`,
          severity: 'error',
          personId: person.id,
          title: `Кончина раньше рождения: ${name}`,
          description: `Дата рождения (${formatGenealogyDate(person.birthDate)}) позже даты кончины (${formatGenealogyDate(person.deathDate)}).`,
        });
      } else if (dYears - bYears > 115) {
        issues.push({
          id: `warn_lifespan_${person.id}`,
          severity: 'warning',
          personId: person.id,
          title: `Необычная продолжительность жизни: ${name}`,
          description: `Разница между рождением и кончиной составляет около ${Math.round(dYears - bYears)} лет.`,
        });
      }
    }

    for (const ev of person.events) {
      const evParsed = parseGenealogyDate(ev.date);
      const evYears = toApproxYears(evParsed.sortKey);
      if (evYears === null) continue;

      if (bYears !== null && evParsed.sortKey < bParsed.sortKey) {
        issues.push({
          id: `warn_ev_before_birth_${person.id}_${ev.id}`,
          severity: 'error',
          personId: person.id,
          title: `Событие раньше рождения: ${name}`,
          description: `Событие «${ev.title}» (${formatGenealogyDate(ev.date)}) датировано раньше рождения (${formatGenealogyDate(person.birthDate)}).`,
        });
      } else if (dYears !== null && evParsed.sortKey > dParsed.sortKey) {
        issues.push({
          id: `warn_ev_after_death_${person.id}_${ev.id}`,
          severity: 'warning',
          personId: person.id,
          title: `Событие после кончины: ${name}`,
          description: `Событие «${ev.title}» (${formatGenealogyDate(ev.date)}) указано позже даты кончины (${formatGenealogyDate(person.deathDate)}).`,
        });
      }
    }
  }

  // 2. Parent-Child generational & date logic checks
  for (const link of tree.parentChildLinks) {
    const parent = tree.persons[link.parentId];
    const child = tree.persons[link.childId];
    if (!parent || !child) continue;

    if (link.parentId === link.childId) {
      issues.push({
        id: `err_self_pc_${link.id}`,
        severity: 'error',
        personId: parent.id,
        title: `Человек указан своим же родителем`,
        description: `${formatFullName(parent)} связан(а) связью «родитель — ребёнок» с самим(ой) собой.`,
      });
      continue;
    }

    const pBirth = toApproxYears(parseGenealogyDate(parent.birthDate).sortKey);
    const pDeath = toApproxYears(parseGenealogyDate(parent.deathDate).sortKey);
    const cBirth = toApproxYears(parseGenealogyDate(child.birthDate).sortKey);

    if (pBirth !== null && cBirth !== null) {
      const diff = cBirth - pBirth;
      if (diff <= 0) {
        issues.push({
          id: `err_child_older_${link.id}`,
          severity: 'error',
          personId: child.id,
          relatedPersonId: parent.id,
          title: `Ребёнок старше родителя`,
          description: `${formatFullName(child)} (${formatGenealogyDate(child.birthDate)}) родился(лась) не позже родителя ${formatFullName(parent)} (${formatGenealogyDate(parent.birthDate)}).`,
        });
      } else if (diff < 12) {
        issues.push({
          id: `warn_parent_too_young_${link.id}`,
          severity: 'warning',
          personId: parent.id,
          relatedPersonId: child.id,
          title: `Слишком маленькая разница поколений`,
          description: `Возраст родителя ${formatFullName(parent)} при рождении ребёнка ${formatFullName(child)} составляет менее 12 лет (${Math.floor(diff)}).`,
        });
      } else if (parent.gender === 'female' && diff > 60) {
        issues.push({
          id: `warn_mother_age_${link.id}`,
          severity: 'warning',
          personId: parent.id,
          relatedPersonId: child.id,
          title: `Проверьте дату рождения матери или ребёнка`,
          description: `Возраст матери ${formatFullName(parent)} при рождении ${formatFullName(child)} составляет около ${Math.round(diff)} лет.`,
        });
      }
    }

    if (pDeath !== null && cBirth !== null) {
      const tolerance = parent.gender === 'male' ? 0.85 : 0.05;
      if (cBirth - pDeath > tolerance) {
        issues.push({
          id: `err_born_after_parent_death_${link.id}`,
          severity: 'error',
          personId: child.id,
          relatedPersonId: parent.id,
          title: `Ребёнок родился после кончины родителя`,
          description: `${formatFullName(child)} (${formatGenealogyDate(child.birthDate)}) родился(лась) после кончины ${formatFullName(parent)} (${formatGenealogyDate(parent.deathDate)}).`,
        });
      }
    }
  }

  // 3. Union / Marriage / Divorce checks
  const pcSet = new Set(tree.parentChildLinks.map((l) => `${l.parentId}->${l.childId}`));
  for (const union of tree.unions) {
    const [id1, id2] = union.partnerIds;
    const p1 = tree.persons[id1];
    const p2 = tree.persons[id2];
    if (!p1 || !p2) continue;

    if (id1 === id2) {
      issues.push({
        id: `err_self_union_${union.id}`,
        severity: 'error',
        personId: id1,
        unionId: union.id,
        title: `Брак с самим собой`,
        description: `У ${formatFullName(p1)} обнаружен союз с самим(ой) собой.`,
      });
      continue;
    }

    if (pcSet.has(`${id1}->${id2}`) || pcSet.has(`${id2}->${id1}`)) {
      issues.push({
        id: `err_parent_child_union_${union.id}`,
        severity: 'error',
        personId: id1,
        relatedPersonId: id2,
        unionId: union.id,
        title: `Противоречие связей: родитель и ребёнок в союзе`,
        description: `${formatFullName(p1)} и ${formatFullName(p2)} одновременно указаны как супруги и как родитель с ребёнком.`,
      });
    }

    const mParsed = parseGenealogyDate(union.marriageDate);
    const divParsed = parseGenealogyDate(union.divorceDate);
    const mYears = toApproxYears(mParsed.sortKey);
    const divYears = toApproxYears(divParsed.sortKey);

    if (mYears !== null && divYears !== null && divParsed.sortKey < mParsed.sortKey) {
      issues.push({
        id: `err_divorce_before_marriage_${union.id}`,
        severity: 'error',
        personId: id1,
        relatedPersonId: id2,
        unionId: union.id,
        title: `Развод раньше брака`,
        description: `В союзе ${formatFullName(p1)} и ${formatFullName(p2)} дата развода (${formatGenealogyDate(union.divorceDate)}) раньше даты брака (${formatGenealogyDate(union.marriageDate)}).`,
      });
    }

    if (mYears !== null) {
      for (const partner of [p1, p2]) {
        const pb = toApproxYears(parseGenealogyDate(partner.birthDate).sortKey);
        const pd = toApproxYears(parseGenealogyDate(partner.deathDate).sortKey);
        if (pb !== null && mYears - pb < 12) {
          issues.push({
            id: `err_marriage_too_early_${union.id}_${partner.id}`,
            severity: mYears < pb ? 'error' : 'warning',
            personId: partner.id,
            unionId: union.id,
            title:
              mYears < pb
                ? `Брак раньше рождения супруга`
                : `Очень ранний возраст вступления в брак`,
            description: `${formatFullName(partner)} (${formatGenealogyDate(partner.birthDate)}) вступает в брак ${formatGenealogyDate(union.marriageDate)}.`,
          });
        }
        if (pd !== null && mParsed.sortKey > parseGenealogyDate(partner.deathDate).sortKey) {
          issues.push({
            id: `err_marriage_after_death_${union.id}_${partner.id}`,
            severity: 'error',
            personId: partner.id,
            unionId: union.id,
            title: `Брак после кончины супруга`,
            description: `Дата брака (${formatGenealogyDate(union.marriageDate)}) позже даты кончины ${formatFullName(partner)} (${formatGenealogyDate(partner.deathDate)}).`,
          });
        }
      }
    }
  }

  // 4. Ancestry cycle detection (DFS on parent -> child graph)
  const childrenByParent = new Map<string, string[]>();
  for (const link of tree.parentChildLinks) {
    if (!tree.persons[link.parentId] || !tree.persons[link.childId]) continue;
    const list = childrenByParent.get(link.parentId) || [];
    list.push(link.childId);
    childrenByParent.set(link.parentId, list);
  }

  const visitState = new Map<string, 0 | 1 | 2>();
  const reportedCycles = new Set<string>();

  const dfs = (nodeId: string) => {
    visitState.set(nodeId, 1);
    for (const childId of childrenByParent.get(nodeId) || []) {
      const state = visitState.get(childId) || 0;
      if (state === 1 && !reportedCycles.has(childId)) {
        reportedCycles.add(childId);
        const p = tree.persons[childId];
        issues.push({
          id: `err_cycle_${childId}`,
          severity: 'error',
          personId: childId,
          title: `Циклическая родственная связь`,
          description: `${p ? formatFullName(p) : childId} оказался(лась) одновременно предком и потомком в одной ветви.`,
        });
      } else if (state === 0) {
        dfs(childId);
      }
    }
    visitState.set(nodeId, 2);
  };

  for (const p of persons) {
    if ((visitState.get(p.id) || 0) === 0) {
      dfs(p.id);
    }
  }

  // Sort errors first, then warnings
  issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return a.title.localeCompare(b.title, 'ru');
  });

  return issues;
}

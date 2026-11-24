import {
  AggregatedTimelineEvent,
  ParentChildLink,
  Person,
  TreeDocument,
  TreeViewMode,
  Union,
} from '../types/genealogy';
import {
  computeAgeAtYear,
  formatFullName,
  formatGenealogyDate,
  parseGenealogyDate,
} from './dateUtils';
import { computeLineageColors } from './lineageColors';

export interface PositionedNode {
  person: Person;
  x: number;
  y: number;
  width: number;
  height: number;
  generation: number;
  lineageColor: string;
  lineageName: string;
}

export interface UnionEdgeGeometry {
  union: Union;
  p1: PositionedNode;
  p2: PositionedNode;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hubX: number;
  hubY: number;
  routeBelow: boolean;
  bridgeY?: number;
  color1: string;
  color2: string;
}

export interface ChildEdgeGeometry {
  link: ParentChildLink;
  parentX: number;
  parentY: number;
  childX: number;
  childY: number;
  busPos: number; // busY in vertical/compact, busX in horizontal
  dropY?: number; // safe Y below parent cards before detouring horizontally
  detourX?: number; // clear X channel if skipping intermediate generation
  viaUnionId?: string;
  color: string;
}

export interface ComputedTreeLayout {
  nodes: Record<string, PositionedNode>;
  unionEdges: UnionEdgeGeometry[];
  childEdges: ChildEdgeGeometry[];
  generations: { level: number; personIds: string[] }[];
  legend: { name: string; color: string; stem: string }[];
  levelStep: number;
  unitGap: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
}

export function getNodeDimensions(mode: TreeViewMode): { width: number; height: number } {
  if (mode === 'horizontal') return { width: 212, height: 86 };
  // Vertical: narrower vertical rectangular card with extra symmetric top/bottom padding
  return { width: 124, height: 146 };
}

export function getPersonModePos(
  person: Person,
  mode: TreeViewMode
): { x: number; y: number } | undefined {
  if (person.customPositions && person.customPositions[mode]) {
    return person.customPositions[mode];
  }
  if (mode === 'vertical' && !person.customPositions && person.customPos) {
    return person.customPos;
  }
  return undefined;
}

export function getParents(
  tree: TreeDocument,
  personId: string
): { person: Person; link: ParentChildLink }[] {
  return tree.parentChildLinks
    .filter((l) => l.childId === personId && tree.persons[l.parentId])
    .map((link) => ({ person: tree.persons[link.parentId], link }));
}

export function getChildren(
  tree: TreeDocument,
  personId: string
): { person: Person; link: ParentChildLink }[] {
  return tree.parentChildLinks
    .filter((l) => l.parentId === personId && tree.persons[l.childId])
    .map((link) => ({ person: tree.persons[link.childId], link }))
    .sort((a, b) => {
      const ya = parseGenealogyDate(a.person.birthDate).sortKey;
      const yb = parseGenealogyDate(b.person.birthDate).sortKey;
      return ya - yb;
    });
}

export function getUnionsForPerson(
  tree: TreeDocument,
  personId: string
): { union: Union; partner: Person }[] {
  return tree.unions
    .filter((u) => u.partnerIds.includes(personId))
    .map((union) => {
      const partnerId =
        union.partnerIds[0] === personId ? union.partnerIds[1] : union.partnerIds[0];
      return { union, partner: tree.persons[partnerId] };
    })
    .filter((item) => Boolean(item.partner));
}

export function getSiblings(tree: TreeDocument, personId: string): Person[] {
  const parentIds = new Set(
    tree.parentChildLinks.filter((l) => l.childId === personId).map((l) => l.parentId)
  );
  if (parentIds.size === 0) return [];
  const siblingIds = new Set<string>();
  for (const link of tree.parentChildLinks) {
    if (parentIds.has(link.parentId) && link.childId !== personId && tree.persons[link.childId]) {
      siblingIds.add(link.childId);
    }
  }
  return Array.from(siblingIds)
    .map((id) => tree.persons[id])
    .sort((a, b) => parseGenealogyDate(a.birthDate).sortKey - parseGenealogyDate(b.birthDate).sortKey);
}

function findClearVerticalChannel(
  preferredX: number,
  yTop: number,
  yBottom: number,
  allNodes: PositionedNode[],
  excludeIds: Set<string>
): number | undefined {
  if (yBottom <= yTop + 10) return undefined;
  const blockers = allNodes.filter(
    (n) =>
      !excludeIds.has(n.person.id) &&
      n.y + n.height > yTop + 6 &&
      n.y < yBottom - 6
  );
  const hitsPreferred = blockers.some(
    (b) => preferredX > b.x - 10 && preferredX < b.x + b.width + 10
  );
  if (!hitsPreferred) return undefined;

  // Search nearest gap left or right of blockers
  const candidates: number[] = [];
  for (const b of blockers) {
    candidates.push(b.x - 18, b.x + b.width + 18);
  }
  candidates.sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX));
  for (const cx of candidates) {
    const blocked = blockers.some((b) => cx > b.x - 10 && cx < b.x + b.width + 10);
    if (!blocked) return cx;
  }
  return undefined;
}

export function computeTreeLayout(
  tree: TreeDocument,
  mode: TreeViewMode,
  overrideLineage?: ReturnType<typeof computeLineageColors>
): ComputedTreeLayout {
  const personIds = Object.keys(tree.persons);
  const lineage = overrideLineage ?? computeLineageColors(tree);
  const unitGap = mode === 'horizontal' ? 20 : 24;
  const groupGap = mode === 'horizontal' ? 34 : 40;
  const levelStep = mode === 'horizontal' ? 296 : 210;

  if (personIds.length === 0) {
    return {
      nodes: {},
      unionEdges: [],
      childEdges: [],
      generations: [],
      legend: [],
      levelStep,
      unitGap,
      bounds: { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 },
    };
  }

  // 1. Topological generation level
  const gen: Record<string, number> = {};
  for (const id of personIds) gen[id] = 0;

  const maxPasses = Math.max(8, personIds.length * 2);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const link of tree.parentChildLinks) {
      if (!tree.persons[link.parentId] || !tree.persons[link.childId]) continue;
      if (gen[link.childId] <= gen[link.parentId]) {
        gen[link.childId] = gen[link.parentId] + 1;
        changed = true;
      }
    }
    for (const union of tree.unions) {
      const [a, b] = union.partnerIds;
      if (!tree.persons[a] || !tree.persons[b]) continue;
      if (gen[a] !== gen[b]) {
        const target = Math.max(gen[a], gen[b]);
        gen[a] = target;
        gen[b] = target;
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (let pass = 0; pass < 4; pass++) {
    for (const id of personIds) {
      const hasParents = tree.parentChildLinks.some(
        (l) => l.childId === id && tree.persons[l.parentId]
      );
      if (hasParents) continue;
      const children = tree.parentChildLinks
        .filter((l) => l.parentId === id && tree.persons[l.childId])
        .map((l) => l.childId);
      if (children.length > 0) {
        const minChildGen = Math.min(...children.map((c) => gen[c]));
        if (gen[id] < minChildGen - 1) {
          gen[id] = minChildGen - 1;
        }
      }
    }
    for (const union of tree.unions) {
      const [a, b] = union.partnerIds;
      if (!tree.persons[a] || !tree.persons[b]) continue;
      if (gen[a] !== gen[b]) {
        const target = Math.max(gen[a], gen[b]);
        gen[a] = target;
        gen[b] = target;
      }
    }
  }

  const minGen = Math.min(...personIds.map((id) => gen[id]));
  for (const id of personIds) gen[id] -= minGen;

  // 2. Group into generational couple units with barycenter ordering
  const maxGen = Math.max(...personIds.map((id) => gen[id]));
  const genBuckets: string[][] = Array.from({ length: maxGen + 1 }, () => []);
  for (const id of personIds) {
    genBuckets[gen[id]].push(id);
  }

  const orderIndex: Record<string, number> = {};
  const dim = getNodeDimensions(mode);
  const nodes: Record<string, PositionedNode> = {};

  interface LayoutUnit {
    ids: string[];
    parentCenter: number;
  }

  for (let g = 0; g <= maxGen; g++) {
    const bucket = genBuckets[g];
    const visited = new Set<string>();
    const units: LayoutUnit[] = [];

    const sortedBucket = [...bucket].sort((a, b) => {
      const pa = getParents(tree, a).map((p) => orderIndex[p.person.id] ?? 0);
      const pb = getParents(tree, b).map((p) => orderIndex[p.person.id] ?? 0);
      const avgA = pa.length ? pa.reduce((s, v) => s + v, 0) / pa.length : Number.MAX_SAFE_INTEGER;
      const avgB = pb.length ? pb.reduce((s, v) => s + v, 0) / pb.length : Number.MAX_SAFE_INTEGER;
      if (avgA !== avgB) return avgA - avgB;
      return (
        parseGenealogyDate(tree.persons[a].birthDate).sortKey -
        parseGenealogyDate(tree.persons[b].birthDate).sortKey
      );
    });

    for (const id of sortedBucket) {
      if (visited.has(id)) continue;
      visited.add(id);

      const partners = getUnionsForPerson(tree, id)
        .map((u) => u.partner.id)
        .filter((pid) => gen[pid] === g && !visited.has(pid));

      const unitIds = [id];
      for (const pid of partners) {
        visited.add(pid);
        unitIds.push(pid);
      }

      if (unitIds.length === 2) {
        const [u0, u1] = unitIds;
        const p0HasParents = getParents(tree, u0).length > 0;
        const p1HasParents = getParents(tree, u1).length > 0;
        if (!p0HasParents && p1HasParents) {
          unitIds.reverse();
        }
      }

      const allParents = unitIds
        .flatMap((uid) => getParents(tree, uid).map((p) => orderIndex[p.person.id]))
        .filter((v) => v !== undefined);

      const parentCenter =
        allParents.length > 0
          ? allParents.reduce((s, v) => s + v, 0) / allParents.length
          : units.length * 2;

      units.push({ ids: unitIds, parentCenter });
    }

    units.sort((a, b) => a.parentCenter - b.parentCenter);

    let idxCounter = 0;
    for (const u of units) {
      for (const uid of u.ids) {
        orderIndex[uid] = idxCounter++;
      }
    }

    if (mode === 'horizontal') {
      const unitSpans = units.map(
        (u) => u.ids.length * dim.height + (u.ids.length - 1) * unitGap
      );
      const totalSpan =
        unitSpans.reduce((s, v) => s + v, 0) + Math.max(0, units.length - 1) * groupGap;
      let cursor = Math.round(-totalSpan / 2);

      for (const unit of units) {
        for (const uid of unit.ids) {
          const person = tree.persons[uid];
          const savedPos = getPersonModePos(person, mode);
          nodes[uid] = {
            person,
            x: savedPos ? savedPos.x : g * levelStep,
            y: savedPos ? savedPos.y : cursor,
            width: dim.width,
            height: dim.height,
            generation: g,
            lineageColor: lineage.personColor[uid] || '#8B261D',
            lineageName: lineage.personLineageName[uid] || person.lastName || 'Род',
          };
          cursor += dim.height + unitGap;
        }
        cursor -= unitGap;
        cursor += groupGap;
      }
    } else {
      const unitSpans = units.map(
        (u) => u.ids.length * dim.width + (u.ids.length - 1) * unitGap
      );
      const totalSpan =
        unitSpans.reduce((s, v) => s + v, 0) + Math.max(0, units.length - 1) * groupGap;
      let cursor = Math.round(-totalSpan / 2);

      for (const unit of units) {
        for (const uid of unit.ids) {
          const person = tree.persons[uid];
          const savedPos = getPersonModePos(person, mode);
          nodes[uid] = {
            person,
            x: savedPos ? savedPos.x : cursor,
            y: savedPos ? savedPos.y : g * levelStep,
            width: dim.width,
            height: dim.height,
            generation: g,
            lineageColor: lineage.personColor[uid] || '#8B261D',
            lineageName: lineage.personLineageName[uid] || person.lastName || 'Род',
          };
          cursor += dim.width + unitGap;
        }
        cursor -= unitGap;
        cursor += groupGap;
      }
    }
  }

  const allNodes = Object.values(nodes);

  // 3. Build Union Edge Geometries connecting facing card edges (never slicing through cards!)
  const unionEdges: UnionEdgeGeometry[] = [];
  const unionByPairKey = new Map<string, UnionEdgeGeometry>();

  for (const union of tree.unions) {
    const rawA = nodes[union.partnerIds[0]];
    const rawB = nodes[union.partnerIds[1]];
    if (!rawA || !rawB) continue;

    if (mode === 'horizontal') {
      const [topNode, botNode] = rawA.y <= rawB.y ? [rawA, rawB] : [rawB, rawA];
      const x1 = topNode.x + topNode.width / 2;
      const y1 = topNode.y + topNode.height;
      const x2 = botNode.x + botNode.width / 2;
      const y2 = botNode.y;
      const hubX = (x1 + x2) / 2;
      const hubY = (y1 + y2) / 2;

      const edge: UnionEdgeGeometry = {
        union,
        p1: topNode,
        p2: botNode,
        x1,
        y1,
        x2,
        y2,
        hubX,
        hubY,
        routeBelow: false,
        color1: topNode.lineageColor,
        color2: botNode.lineageColor,
      };
      unionEdges.push(edge);
      const key = [union.partnerIds[0], union.partnerIds[1]].sort().join('|');
      unionByPairKey.set(key, edge);
    } else {
      const [leftNode, rightNode] = rawA.x <= rawB.x ? [rawA, rawB] : [rawB, rawA];
      const x1 = leftNode.x + leftNode.width;
      const y1 = leftNode.y + leftNode.height / 2;
      const x2 = rightNode.x;
      const y2 = rightNode.y + rightNode.height / 2;

      // Check if any third card lies horizontally between leftNode and rightNode
      const hasIntervening = allNodes.some(
        (n) =>
          n.person.id !== leftNode.person.id &&
          n.person.id !== rightNode.person.id &&
          n.x + n.width > x1 + 4 &&
          n.x < x2 - 4 &&
          n.y + n.height > Math.min(leftNode.y, rightNode.y) &&
          n.y < Math.max(leftNode.y + leftNode.height, rightNode.y + rightNode.height)
      );

      const bridgeY = Math.max(leftNode.y + leftNode.height, rightNode.y + rightNode.height) + 16;
      const hubX = (x1 + x2) / 2;
      const hubY = hasIntervening ? bridgeY : (y1 + y2) / 2;

      const edge: UnionEdgeGeometry = {
        union,
        p1: leftNode,
        p2: rightNode,
        x1: hasIntervening ? leftNode.x + leftNode.width / 2 : x1,
        y1: hasIntervening ? leftNode.y + leftNode.height : y1,
        x2: hasIntervening ? rightNode.x + rightNode.width / 2 : x2,
        y2: hasIntervening ? rightNode.y + rightNode.height : y2,
        hubX,
        hubY,
        routeBelow: hasIntervening,
        bridgeY: hasIntervening ? bridgeY : undefined,
        color1: leftNode.lineageColor,
        color2: rightNode.lineageColor,
      };
      unionEdges.push(edge);
      const key = [union.partnerIds[0], union.partnerIds[1]].sort().join('|');
      unionByPairKey.set(key, edge);
    }
  }

  // 4. Build Parent -> Child Edges strictly in clear inter-generation corridors
  const childEdges: ChildEdgeGeometry[] = [];
  const childrenParentsMap = new Map<string, ParentChildLink[]>();
  for (const link of tree.parentChildLinks) {
    if (!nodes[link.parentId] || !nodes[link.childId]) continue;
    const arr = childrenParentsMap.get(link.childId) || [];
    arr.push(link);
    childrenParentsMap.set(link.childId, arr);
  }

  // Assign distinct bus offsets per parent/union group within each generation corridor
  const groupBusOffsetMap = new Map<string, number>();
  const corridorGroupCounters = new Map<number, number>();

  const getBusRatioForGroup = (genLevel: number, groupKey: string): number => {
    if (groupBusOffsetMap.has(groupKey)) return groupBusOffsetMap.get(groupKey)!;
    const idx = corridorGroupCounters.get(genLevel) || 0;
    corridorGroupCounters.set(genLevel, idx + 1);
    // Distribute gently around the corridor midpoint (0.42..0.66) so buses never overlap each other
    const offsets = [0.52, 0.42, 0.62, 0.34, 0.70];
    const ratio = offsets[idx % offsets.length];
    groupBusOffsetMap.set(groupKey, ratio);
    return ratio;
  };

  interface PendingChildEdge {
    groupKey: string;
    link: ParentChildLink;
    parentX: number;
    parentY: number;
    corridorStart: number;
    parentGen: number;
    parentIds: string[];
    childId: string;
    childNode: PositionedNode;
    childX: number;
    childY: number;
    ratio: number;
    viaUnionId?: string;
    color: string;
  }

  const pendingByGroup = new Map<string, PendingChildEdge[]>();
  const pushPending = (edge: PendingChildEdge) => {
    const arr = pendingByGroup.get(edge.groupKey) || [];
    arr.push(edge);
    pendingByGroup.set(edge.groupKey, arr);
  };

  for (const [childId, links] of childrenParentsMap.entries()) {
    const childNode = nodes[childId];
    const childX =
      mode === 'horizontal' ? childNode.x : childNode.x + childNode.width / 2;
    const childY =
      mode === 'horizontal' ? childNode.y + childNode.height / 2 : childNode.y;

    const handledParents = new Set<string>();
    if (links.length >= 2) {
      for (let i = 0; i < links.length; i++) {
        for (let j = i + 1; j < links.length; j++) {
          const pA = links[i].parentId;
          const pB = links[j].parentId;
          const key = [pA, pB].sort().join('|');
          const uEdge = unionByPairKey.get(key);
          if (uEdge && !handledParents.has(pA) && !handledParents.has(pB)) {
            handledParents.add(pA);
            handledParents.add(pB);

            const fatherLink =
              tree.persons[pA]?.gender === 'male'
                ? links[i]
                : tree.persons[pB]?.gender === 'male'
                ? links[j]
                : links[i];

            const parentBottom = Math.max(uEdge.p1.y + uEdge.p1.height, uEdge.p2.y + uEdge.p2.height);
            const parentRight = Math.max(uEdge.p1.x + uEdge.p1.width, uEdge.p2.x + uEdge.p2.width);
            const parentGen = Math.max(uEdge.p1.generation, uEdge.p2.generation);
            const groupKey = `union_${uEdge.union.id}`;
            const ratio = getBusRatioForGroup(parentGen, groupKey);

            pushPending({
              groupKey,
              link: fatherLink,
              parentX: uEdge.hubX,
              parentY: uEdge.hubY,
              corridorStart:
                mode === 'horizontal'
                  ? Math.max(parentRight, uEdge.hubX)
                  : Math.max(parentBottom, uEdge.hubY),
              parentGen,
              parentIds: [pA, pB],
              childId,
              childNode,
              childX,
              childY,
              ratio,
              viaUnionId: uEdge.union.id,
              color: childNode.lineageColor,
            });
          }
        }
      }
    }

    for (const link of links) {
      if (handledParents.has(link.parentId)) continue;
      const pNode = nodes[link.parentId];
      const parentX =
        mode === 'horizontal' ? pNode.x + pNode.width : pNode.x + pNode.width / 2;
      const parentY =
        mode === 'horizontal' ? pNode.y + pNode.height / 2 : pNode.y + pNode.height;
      const groupKey = `single_${pNode.person.id}`;
      const ratio = getBusRatioForGroup(pNode.generation, groupKey);

      pushPending({
        groupKey,
        link,
        parentX,
        parentY,
        corridorStart: mode === 'horizontal' ? parentX : parentY,
        parentGen: pNode.generation,
        parentIds: [link.parentId],
        childId,
        childNode,
        childX,
        childY,
        ratio,
        color: pNode.lineageColor,
      });
    }
  }

  for (const groupEdges of pendingByGroup.values()) {
    if (mode === 'horizontal') {
      const forward = groupEdges
        .filter((e) => e.childX > e.corridorStart + 2)
        .sort((a, b) => a.childX - b.childX);
      const backward = groupEdges.filter((e) => e.childX <= e.corridorStart + 2);

      const clusters: PendingChildEdge[][] = [];
      for (const e of forward) {
        const last = clusters[clusters.length - 1];
        if (last && e.childX - last[0].childX <= 70) {
          last.push(e);
        } else {
          clusters.push([e]);
        }
      }

      for (const cluster of clusters) {
        const minChildX = Math.min(...cluster.map((e) => e.childX));
        const corridorStart = cluster[0].corridorStart;
        const gap = minChildX - corridorStart;
        const idealCorridorSpan = Math.max(36, levelStep - dim.width);
        const maxGenDelta = Math.max(
          ...cluster.map((e) => e.childNode.generation - e.parentGen)
        );
        const busPos =
          gap < 28
            ? corridorStart + gap / 2
            : Math.max(
                corridorStart + 14,
                Math.min(
                  minChildX - 14,
                  maxGenDelta > 1
                    ? minChildX - idealCorridorSpan * (1 - cluster[0].ratio)
                    : corridorStart + gap * cluster[0].ratio
                )
              );

        for (const e of cluster) {
          childEdges.push({
            link: e.link,
            parentX: e.parentX,
            parentY: e.parentY,
            childX: e.childX,
            childY: e.childY,
            busPos,
            viaUnionId: e.viaUnionId,
            color: e.color,
          });
        }
      }

      for (const e of backward) {
        childEdges.push({
          link: e.link,
          parentX: e.parentX,
          parentY: e.parentY,
          childX: e.childX,
          childY: e.childY,
          busPos: (e.corridorStart + e.childX) / 2,
          viaUnionId: e.viaUnionId,
          color: e.color,
        });
      }
    } else {
      const forward = groupEdges
        .filter((e) => e.childY > e.corridorStart + 2)
        .sort((a, b) => a.childY - b.childY);
      const backward = groupEdges.filter((e) => e.childY <= e.corridorStart + 2);

      const clusters: PendingChildEdge[][] = [];
      for (const e of forward) {
        const last = clusters[clusters.length - 1];
        if (last && e.childY - last[0].childY <= 70) {
          last.push(e);
        } else {
          clusters.push([e]);
        }
      }

      for (const cluster of clusters) {
        const minChildY = Math.min(...cluster.map((e) => e.childY));
        const corridorStart = cluster[0].corridorStart;
        const gap = minChildY - corridorStart;
        const idealCorridorSpan = Math.max(36, levelStep - dim.height);
        const maxGenDelta = Math.max(
          ...cluster.map((e) => e.childNode.generation - e.parentGen)
        );
        const busPos =
          gap < 28
            ? corridorStart + gap / 2
            : Math.max(
                corridorStart + 14,
                Math.min(
                  minChildY - 14,
                  maxGenDelta > 1
                    ? minChildY - idealCorridorSpan * (1 - cluster[0].ratio)
                    : corridorStart + gap * cluster[0].ratio
                )
              );

        const dropY =
          corridorStart + Math.min(16, Math.max(6, (busPos - corridorStart) * 0.45));
        const excludeIds = new Set<string>([
          ...cluster[0].parentIds,
          ...cluster.map((e) => e.childId),
        ]);
        const detourX = findClearVerticalChannel(
          cluster[0].parentX,
          dropY,
          busPos,
          allNodes,
          excludeIds
        );

        for (const e of cluster) {
          childEdges.push({
            link: e.link,
            parentX: e.parentX,
            parentY: e.parentY,
            childX: e.childX,
            childY: e.childY,
            busPos,
            dropY: detourX !== undefined ? dropY : undefined,
            detourX,
            viaUnionId: e.viaUnionId,
            color: e.color,
          });
        }
      }

      for (const e of backward) {
        childEdges.push({
          link: e.link,
          parentX: e.parentX,
          parentY: e.parentY,
          childX: e.childX,
          childY: e.childY,
          busPos: (e.corridorStart + e.childY) / 2,
          viaUnionId: e.viaUnionId,
          color: e.color,
        });
      }
    }
  }

  const minX = Math.min(...allNodes.map((n) => n.x)) - 80;
  const minY = Math.min(...allNodes.map((n) => n.y)) - 80;
  const maxX = Math.max(...allNodes.map((n) => n.x + n.width)) + 80;
  const maxY = Math.max(...allNodes.map((n) => n.y + n.height)) + 80;

  return {
    nodes,
    unionEdges,
    childEdges,
    generations: genBuckets.map((pids, level) => ({ level, personIds: pids })),
    legend: lineage.legend,
    levelStep,
    unitGap,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(600, maxX - minX),
      height: Math.max(450, maxY - minY),
    },
  };
}

export function aggregateTimelineEvents(tree: TreeDocument): AggregatedTimelineEvent[] {
  const events: AggregatedTimelineEvent[] = [];

  for (const person of Object.values(tree.persons)) {
    const pName = formatFullName(person);

    if (person.birthDate && person.birthDate.trim()) {
      const parsed = parseGenealogyDate(person.birthDate);
      events.push({
        id: `tl_birth_${person.id}`,
        sortKey: parsed.sortKey,
        year: parsed.year,
        dateDisplay: formatGenealogyDate(person.birthDate),
        rawDate: person.birthDate,
        category: 'birth',
        title: `Рождение: ${pName}`,
        place: person.birthPlace,
        verification: person.verification,
        personId: person.id,
        personName: pName,
        sourceKind: 'birth',
        documents: person.birthDocuments,
      });
    }

    if (person.deathDate && person.deathDate.trim()) {
      const parsed = parseGenealogyDate(person.deathDate);
      events.push({
        id: `tl_death_${person.id}`,
        sortKey: parsed.sortKey,
        year: parsed.year,
        dateDisplay: formatGenealogyDate(person.deathDate),
        rawDate: person.deathDate,
        category: 'death',
        title: `Кончина: ${pName}`,
        place: person.deathPlace,
        ageAtEvent: computeAgeAtYear(person.birthDate, person.deathDate),
        verification: person.verification,
        personId: person.id,
        personName: pName,
        sourceKind: 'death',
        documents: person.deathDocuments,
      });
    }

    for (const ev of person.events) {
      if (!ev.date || !ev.date.trim()) continue;
      const parsed = parseGenealogyDate(ev.date);
      events.push({
        id: `tl_ev_${person.id}_${ev.id}`,
        sortKey: parsed.sortKey,
        year: parsed.year,
        dateDisplay: formatGenealogyDate(ev.date),
        rawDate: ev.date,
        category: ev.type,
        title: ev.title || 'Памятная дата',
        place: ev.place,
        description: ev.description,
        ageAtEvent: computeAgeAtYear(person.birthDate, ev.date),
        verification: ev.verification,
        personId: person.id,
        personName: pName,
        sourceKind: 'life_event',
        sourceEventId: ev.id,
        documents: ev.documents,
      });
    }
  }

  for (const union of tree.unions) {
    const p1 = tree.persons[union.partnerIds[0]];
    const p2 = tree.persons[union.partnerIds[1]];
    if (!p1 || !p2) continue;

    if (union.marriageDate && union.marriageDate.trim()) {
      const parsed = parseGenealogyDate(union.marriageDate);
      const name1 = formatFullName(p1);
      const name2 = formatFullName(p2);
      events.push({
        id: `tl_marr_${union.id}`,
        sortKey: parsed.sortKey,
        year: parsed.year,
        dateDisplay: formatGenealogyDate(union.marriageDate),
        rawDate: union.marriageDate,
        category: 'marriage',
        title: `Брак: ${name1} и ${name2}`,
        place: union.marriagePlace,
        description: union.notes,
        verification: union.verification,
        personId: p1.id,
        personName: name1,
        partnerId: p2.id,
        partnerName: name2,
        sourceKind: 'marriage',
        sourceUnionId: union.id,
        documents: union.documents,
      });
    }

    if (union.divorceDate && union.divorceDate.trim()) {
      const parsed = parseGenealogyDate(union.divorceDate);
      const name1 = formatFullName(p1);
      const name2 = formatFullName(p2);
      events.push({
        id: `tl_div_${union.id}`,
        sortKey: parsed.sortKey,
        year: parsed.year,
        dateDisplay: formatGenealogyDate(union.divorceDate),
        rawDate: union.divorceDate,
        category: 'divorce',
        title: `Расторжение брака: ${name1} и ${name2}`,
        verification: union.verification,
        personId: p1.id,
        personName: name1,
        partnerId: p2.id,
        partnerName: name2,
        sourceKind: 'divorce',
        sourceUnionId: union.id,
      });
    }
  }

  events.sort((a, b) => a.sortKey - b.sortKey);
  return events;
}

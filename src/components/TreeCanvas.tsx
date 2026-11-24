import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  AlignCenter,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  Baby,
  CheckCircle2,
  Focus,
  Heart,
  Link2,
  Lock,
  Magnet,
  Pencil,
  Ruler,
  Search,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
  Users,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ParentChildLink,
  Person,
  PhotoAttachment,
  TreeDocument,
  TreeViewMode,
  Union,
  UnionStatus,
  VerificationStatus,
} from '../types/genealogy';
import {
  formatCardLifespan,
  formatFullName,
  formatLifespan,
  formatShortName,
  getPersonInitials,
  getPrimaryPhotoObj,
  getTreeDisplaySurname,
  normalizeDateInputToRu,
} from '../utils/dateUtils';
import { computeBloodRelatives, computeLineageColors } from '../utils/lineageColors';
import { computeTreeLayout } from '../utils/treeLayout';
import { validateTreeLogic } from '../utils/treeValidation';
import { CroppedCircleAvatar } from './PhotoCropModal';
import { PhotoTagFrameLayer } from './PhotoTagFrameLayer';
import { VerificationIcon, VerificationSelector } from './VerificationBadge';

interface TreeCanvasProps {
  tree: TreeDocument;
  viewMode: TreeViewMode;
  selectedPersonId: string | null;
  onViewModeChange: (mode: TreeViewMode) => void;
  onSelectPerson: (id: string | null) => void;
  onEditPerson: (id: string) => void;
  onMovePerson: (
    personId: string,
    pos: { x: number; y: number },
    mode: TreeViewMode,
    coalesceKey?: string
  ) => void;
  onMovePersons?: (
    moves: Array<{ personId: string; pos: { x: number; y: number } }>,
    mode: TreeViewMode,
    coalesceKey?: string
  ) => void;
  onResetPositions: (mode: TreeViewMode) => void;
  onAddFirstPerson: () => void;
  onAddPerson: () => void;
  onAddRelative: (sourceId: string, kind: 'parent' | 'child' | 'spouse' | 'sibling') => void;
  onCreateConnection: (
    sourceId: string,
    targetId: string,
    kind: 'as_parent' | 'as_child' | 'as_spouse',
    verification: VerificationStatus
  ) => void;
  onUpdateUnion: (unionId: string, patch: Partial<Union>) => void;
  onDeleteUnion: (unionId: string) => void;
  onUpdateParentChild: (linkId: string, patch: Partial<ParentChildLink>) => void;
  onDeleteParentChild: (linkId: string) => void;
  onGoToImport: () => void;
  canUndo?: boolean;
  onUndo?: () => void;
}

const CORNER_RADIUS = 12;

/**
 * Builds an SVG path through orthogonal waypoints where every corner has the same rounded radius.
 */
function buildRoundedPolylinePath(
  rawPoints: Array<{ x: number; y: number }>,
  radius = CORNER_RADIUS
): string {
  // Remove consecutive duplicate points
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of rawPoints) {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.5) {
      pts.push(p);
    }
  }
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);

    if (len1 < 0.5 || len2 < 0.5) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const r = Math.min(radius, len1 / 2, len2 / 2);
    const inX = curr.x - (v1x / len1) * r;
    const inY = curr.y - (v1y / len1) * r;
    const outX = curr.x + (v2x / len2) * r;
    const outY = curr.y + (v2y / len2) * r;

    d += ` L ${inX} ${inY} Q ${curr.x} ${curr.y}, ${outX} ${outY}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

export function TreeCanvas({
  tree,
  viewMode,
  selectedPersonId,
  onViewModeChange,
  onSelectPerson,
  onEditPerson,
  onMovePerson,
  onMovePersons,
  onResetPositions,
  onAddFirstPerson,
  onAddPerson,
  onAddRelative,
  onCreateConnection,
  onUpdateUnion,
  onDeleteUnion,
  onUpdateParentChild,
  onDeleteParentChild,
  onGoToImport,
  canUndo = false,
  onUndo,
}: TreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [hasCenteredInitially, setHasCenteredInitially] = useState(false);

  // Soft snapping toggle + active visual guide lines + equal-distance guides
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapGuides, setSnapGuides] = useState<{
    horizontalY: number | null;
    verticalX: number | null;
    distanceGuides: Array<{
      axis: 'x' | 'y';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      label: string;
      matchedRefs?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
    }>;
  }>({ horizontalY: null, verticalX: null, distanceGuides: [] });

  // Multi-card selection state
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currX: number;
    currY: number;
    additive: boolean;
    baseIds: string[];
  } | null>(null);
  const lastDragMovedRef = useRef(false);

  // Lineage & Blood-Relatives Filters
  const [lineageFilter, setLineageFilter] = useState<string>('all');
  const [hideNonBlood, setHideNonBlood] = useState<boolean>(false);
  const [bloodAnchorId, setBloodAnchorId] = useState<string | null>(null);

  // Search (persons + tagged people on photos)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [photoLightbox, setPhotoLightbox] = useState<{
    ownerId: string;
    photo: PhotoAttachment;
  } | null>(null);
  const [lightboxHoveredTagId, setLightboxHoveredTagId] = useState<string | null>(null);

  // Multi-touch & Pointer tracking
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    initialDist: number;
    initialZoom: number;
    midCanvasX: number;
    midCanvasY: number;
  } | null>(null);

  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0, moved: false });
  const [draggingNode, setDraggingNode] = useState<{
    id: string;
    dragSessionId: string;
    startClientX: number;
    startClientY: number;
    startNodeX: number;
    startNodeY: number;
    groupStartPositions: Record<string, { x: number; y: number }>;
    moved: boolean;
  } | null>(null);

  // Visual Link Mode
  const [linkModeActive, setLinkModeActive] = useState(false);
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null);
  const [dragConnectSourceId, setDragConnectSourceId] = useState<string | null>(null);
  const [hoveredConnectTargetId, setHoveredConnectTargetId] = useState<string | null>(null);
  const [cursorCanvasPos, setCursorCanvasPos] = useState<{ x: number; y: number } | null>(null);

  const [pendingConnection, setPendingConnection] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);
  const [pendingKind, setPendingKind] = useState<'as_spouse' | 'as_parent' | 'as_child'>(
    'as_spouse'
  );
  const [pendingVerif, setPendingVerif] = useState<VerificationStatus>('confirmed');

  const [activeUnionId, setActiveUnionId] = useState<string | null>(null);
  const [activeChildLinkId, setActiveChildLinkId] = useState<string | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);

  const fullLineage = useMemo(() => computeLineageColors(tree), [tree]);
  const validationIssues = useMemo(() => validateTreeLogic(tree), [tree]);

  useEffect(() => {
    if (!hideNonBlood) return;
    if (selectedPersonId && tree.persons[selectedPersonId]) {
      setBloodAnchorId(selectedPersonId);
    } else if (bloodAnchorId && !tree.persons[bloodAnchorId]) {
      setBloodAnchorId(null);
    }
  }, [bloodAnchorId, hideNonBlood, selectedPersonId, tree.persons]);

  const bloodAnchorPerson =
    hideNonBlood && bloodAnchorId && tree.persons[bloodAnchorId]
      ? tree.persons[bloodAnchorId]
      : null;

  const activeBloodSet = useMemo(() => {
    if (!hideNonBlood || !bloodAnchorPerson) return null;
    return computeBloodRelatives(tree, bloodAnchorPerson.id);
  }, [bloodAnchorPerson, hideNonBlood, tree]);

  const filteredTree = useMemo(() => {
    if (lineageFilter === 'all' && (!hideNonBlood || !activeBloodSet)) return tree;

    const allIds = Object.keys(tree.persons);
    const visibleSet = new Set<string>();

    if (lineageFilter === 'all') {
      if (activeBloodSet) {
        for (const id of activeBloodSet) {
          visibleSet.add(id);
        }
      }
    } else {
      const stemIds = new Set<string>();
      for (const id of allIds) {
        if (fullLineage.personStem[id] === lineageFilter) {
          stemIds.add(id);
          if (!activeBloodSet || activeBloodSet.has(id)) {
            visibleSet.add(id);
          }
        }
      }
      if (!hideNonBlood) {
        for (const u of tree.unions) {
          const [a, b] = u.partnerIds;
          if (stemIds.has(a) && tree.persons[b]) visibleSet.add(b);
          if (stemIds.has(b) && tree.persons[a]) visibleSet.add(a);
        }
      }
    }

    const persons: Record<string, Person> = {};
    for (const id of visibleSet) {
      if (tree.persons[id]) persons[id] = tree.persons[id];
    }

    return {
      ...tree,
      persons,
      unions: tree.unions.filter(
        (u) => visibleSet.has(u.partnerIds[0]) && visibleSet.has(u.partnerIds[1])
      ),
      parentChildLinks: tree.parentChildLinks.filter(
        (l) => visibleSet.has(l.parentId) && visibleSet.has(l.childId)
      ),
    };
  }, [activeBloodSet, fullLineage.personStem, hideNonBlood, lineageFilter, tree]);

  const layout = useMemo(
    () => computeTreeLayout(filteredTree, viewMode, fullLineage),
    [filteredTree, fullLineage, viewMode]
  );
  const personList = useMemo(() => Object.values(filteredTree.persons), [filteredTree.persons]);
  const hasCustomPositions = useMemo(
    () =>
      Object.values(tree.persons).some((p) =>
        Boolean(
          p.customPositions?.[viewMode] ||
            (viewMode === 'vertical' && !p.customPositions && p.customPos)
        )
      ),
    [tree.persons, viewMode]
  );

  const fitTreeToViewport = useCallback(() => {
    const el = containerRef.current;
    if (!el || personList.length === 0) return;
    const rect = el.getBoundingClientRect();
    const pad = 44;
    const scaleX = (rect.width - pad * 2) / layout.bounds.width;
    const scaleY = (rect.height - pad * 2) / layout.bounds.height;
    const nextZoom = Math.max(0.32, Math.min(1.06, Math.min(scaleX, scaleY)));
    const centerX = (layout.bounds.minX + layout.bounds.maxX) / 2;
    const centerY = (layout.bounds.minY + layout.bounds.maxY) / 2;
    setZoom(nextZoom);
    setPan({
      x: rect.width / 2 - centerX * nextZoom,
      y: rect.height / 2 - centerY * nextZoom,
    });
  }, [layout.bounds, personList.length]);

  useEffect(() => {
    if (!hasCenteredInitially && personList.length > 0) {
      fitTreeToViewport();
      setHasCenteredInitially(true);
    }
  }, [fitTreeToViewport, hasCenteredInitially, personList.length]);

  useEffect(() => {
    if (personList.length > 0) {
      fitTreeToViewport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const focusOnPerson = useCallback(
    (personId: string) => {
      const node = layout.nodes[personId];
      const el = containerRef.current;
      onSelectPerson(personId);
      if (!node || !el) return;
      const rect = el.getBoundingClientRect();
      const targetZoom = Math.max(zoom, 0.94);
      setZoom(targetZoom);
      setPan({
        x: rect.width / 2 - (node.x + node.width / 2) * targetZoom,
        y: rect.height / 2 - (node.y + node.height / 2) * targetZoom,
      });
    },
    [layout.nodes, onSelectPerson, zoom]
  );

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return personList
      .filter((p) => {
        const hay = `${p.lastName} ${p.firstName} ${p.middleName || ''} ${p.maidenName || ''} ${
          p.occupation || ''
        } ${p.birthPlace || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [personList, searchQuery]);

  const photoSearchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: Array<{
      ownerId: string;
      photo: PhotoAttachment;
      matchedNames: string[];
    }> = [];
    for (const owner of Object.values(tree.persons)) {
      for (const ph of owner.photos) {
        const tagPeople = (ph.tags || [])
          .map((t) => tree.persons[t.personId])
          .filter((p): p is Person => Boolean(p));
        const matchingTagged = tagPeople.filter((tp) =>
          `${tp.lastName} ${tp.firstName} ${tp.middleName || ''} ${tp.maidenName || ''}`
            .toLowerCase()
            .includes(q)
        );
        if (matchingTagged.length > 0) {
          results.push({
            ownerId: owner.id,
            photo: ph,
            matchedNames: Array.from(new Set(matchingTagged.map((tp) => formatFullName(tp)))),
          });
        }
      }
    }
    for (const ph of tree.archivePhotos || []) {
      const tagPeople = (ph.tags || [])
        .map((t) => tree.persons[t.personId])
        .filter((p): p is Person => Boolean(p));
      const matchingTagged = tagPeople.filter((tp) =>
        `${tp.lastName} ${tp.firstName} ${tp.middleName || ''} ${tp.maidenName || ''}`
          .toLowerCase()
          .includes(q)
      );
      if (matchingTagged.length > 0) {
        results.push({
          ownerId: '__archive__',
          photo: ph,
          matchedNames: Array.from(new Set(matchingTagged.map((tp) => formatFullName(tp)))),
        });
      }
    }
    return results.slice(0, 6);
  }, [searchQuery, tree.archivePhotos, tree.persons]);

  const screenToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan.x, pan.y, zoom]
  );

  const findPersonAtCanvasPoint = useCallback(
    (cx: number, cy: number, excludeId?: string | null): string | null => {
      for (const node of Object.values(layout.nodes)) {
        if (excludeId && node.person.id === excludeId) continue;
        if (
          cx >= node.x - 10 &&
          cx <= node.x + node.width + 10 &&
          cy >= node.y - 10 &&
          cy <= node.y + node.height + 10
        ) {
          return node.person.id;
        }
      }
      return null;
    },
    [layout.nodes]
  );

  const validMultiSelectedIds = useMemo(
    () => multiSelectedIds.filter((id) => Boolean(layout.nodes[id])),
    [layout.nodes, multiSelectedIds]
  );
  const multiSelectedSet = useMemo(() => new Set(validMultiSelectedIds), [validMultiSelectedIds]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMultiSelectedIds([]);
        setBoxSelectMode(false);
        setSelectionBox(null);
        setLinkModeActive(false);
        setLinkSourceId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const computeSoftSnap = useCallback(
    (nodeId: string, rawX: number, rawY: number, excludedIds?: Set<string>) => {
      type DistanceGuide = {
        axis: 'x' | 'y';
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        label: string;
        matchedRefs?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
      };

      if (!snapEnabled) {
        return {
          x: Math.round(rawX),
          y: Math.round(rawY),
          guideX: null,
          guideY: null,
          distanceGuides: [] as DistanceGuide[],
        };
      }

      const currentNode = layout.nodes[nodeId];
      if (!currentNode) {
        return {
          x: Math.round(rawX),
          y: Math.round(rawY),
          guideX: null,
          guideY: null,
          distanceGuides: [] as DistanceGuide[],
        };
      }

      const excluded = excludedIds ?? new Set<string>([nodeId]);
      const stationaryNodes = Object.values(layout.nodes).filter(
        (n) => !excluded.has(n.person.id)
      );

      const SNAP_THRESHOLD = 13;
      const UNION_HUB_THRESHOLD = 17;
      const GAP_MATCH_THRESHOLD = 11;
      const RHYTHM_GAP_THRESHOLD = 6;
      const RHYTHM_STEPS = [40, 60, 80, 100, 120, 150, 180];

      let snappedX = rawX;
      let snappedY = rawY;
      let guideX: number | null = null;
      let guideY: number | null = null;
      let distGuideX: DistanceGuide | null = null;
      let distGuideY: DistanceGuide | null = null;

      let bestDx = SNAP_THRESHOLD + 10;
      let bestDy = SNAP_THRESHOLD + 10;
      let hasSnapX = false;
      let hasSnapY = false;

      // Collect existing adjacent gaps among stationary nodes (for equal-distance snapping)
      type GapEntry = { gap: number; x1: number; y1: number; x2: number; y2: number };
      const existingHGaps: GapEntry[] = [];
      const existingVGaps: GapEntry[] = [];

      for (let i = 0; i < stationaryNodes.length; i++) {
        const a = stationaryNodes[i];
        let nearestRight: (typeof stationaryNodes)[number] | null = null;
        let nearestRightDist = Infinity;
        let nearestBelow: (typeof stationaryNodes)[number] | null = null;
        let nearestBelowDist = Infinity;

        for (let j = 0; j < stationaryNodes.length; j++) {
          if (i === j) continue;
          const b = stationaryNodes[j];

          const overlapY =
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          if (overlapY >= 12 && b.x > a.x + a.width + 6) {
            const g = b.x - (a.x + a.width);
            if (g <= 320 && g < nearestRightDist) {
              nearestRightDist = g;
              nearestRight = b;
            }
          }

          const overlapX =
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          if (overlapX >= 12 && b.y > a.y + a.height + 6) {
            const g = b.y - (a.y + a.height);
            if (g <= 320 && g < nearestBelowDist) {
              nearestBelowDist = g;
              nearestBelow = b;
            }
          }
        }

        if (nearestRight) {
          const midY =
            (Math.max(a.y, nearestRight.y) +
              Math.min(a.y + a.height, nearestRight.y + nearestRight.height)) /
            2;
          existingHGaps.push({
            gap: Math.round(nearestRightDist),
            x1: a.x + a.width,
            y1: midY,
            x2: nearestRight.x,
            y2: midY,
          });
        }

        if (nearestBelow) {
          const midX =
            (Math.max(a.x, nearestBelow.x) +
              Math.min(a.x + a.width, nearestBelow.x + nearestBelow.width)) /
            2;
          existingVGaps.push({
            gap: Math.round(nearestBelowDist),
            x1: midX,
            y1: a.y + a.height,
            x2: midX,
            y2: nearestBelow.y,
          });
        }
      }

      // 1. Soft snap to parents' Union hub circle
      const parentIdsOfNode = new Set(
        filteredTree.parentChildLinks
          .filter((l) => l.childId === nodeId && !excluded.has(l.parentId))
          .map((l) => l.parentId)
      );

      for (const ue of layout.unionEdges) {
        if (
          excluded.has(ue.union.partnerIds[0]) ||
          excluded.has(ue.union.partnerIds[1])
        ) {
          continue;
        }
        const isOwnParentsUnion =
          parentIdsOfNode.has(ue.union.partnerIds[0]) &&
          parentIdsOfNode.has(ue.union.partnerIds[1]);
        const threshold = isOwnParentsUnion ? UNION_HUB_THRESHOLD : 11;
        const priorityBonus = isOwnParentsUnion ? 4 : 0;

        if (viewMode === 'horizontal') {
          const targetY = ue.hubY - currentNode.height / 2;
          const dyHub = Math.abs(rawY - targetY);
          const scoreY = Math.max(0, dyHub - priorityBonus);
          if (dyHub <= threshold && scoreY < bestDy) {
            bestDy = scoreY;
            snappedY = targetY;
            guideY = ue.hubY;
            distGuideY = null;
            hasSnapY = true;
          }
        } else {
          const targetX = ue.hubX - currentNode.width / 2;
          const dxHub = Math.abs(rawX - targetX);
          const scoreX = Math.max(0, dxHub - priorityBonus);
          if (dxHub <= threshold && scoreX < bestDx) {
            bestDx = scoreX;
            snappedX = targetX;
            guideX = ue.hubX;
            distGuideX = null;
            hasSnapX = true;
          }
        }
      }

      // Single-parent center snap
      if (parentIdsOfNode.size === 1) {
        const singleParentId = Array.from(parentIdsOfNode)[0];
        const pNode = layout.nodes[singleParentId];
        if (pNode) {
          if (viewMode === 'horizontal') {
            const targetY = pNode.y + pNode.height / 2 - currentNode.height / 2;
            const dyParent = Math.abs(rawY - targetY);
            if (dyParent <= SNAP_THRESHOLD && dyParent < bestDy) {
              bestDy = dyParent;
              snappedY = targetY;
              guideY = pNode.y + pNode.height / 2;
              distGuideY = null;
              hasSnapY = true;
            }
          } else {
            const targetX = pNode.x + pNode.width / 2 - currentNode.width / 2;
            const dxParent = Math.abs(rawX - targetX);
            if (dxParent <= SNAP_THRESHOLD && dxParent < bestDx) {
              bestDx = dxParent;
              snappedX = targetX;
              guideX = pNode.x + pNode.width / 2;
              distGuideX = null;
              hasSnapX = true;
            }
          }
        }
      }

      // 2. Alignment with stationary nodes + find nearest neighbors on each side
      let nearestLeft: (typeof stationaryNodes)[number] | null = null;
      let nearestLeftGap = Infinity;
      let nearestRight: (typeof stationaryNodes)[number] | null = null;
      let nearestRightGap = Infinity;
      let nearestAbove: (typeof stationaryNodes)[number] | null = null;
      let nearestAboveGap = Infinity;
      let nearestBelow: (typeof stationaryNodes)[number] | null = null;
      let nearestBelowGap = Infinity;

      for (const other of stationaryNodes) {
        // Horizontal row alignment (same Y top edge)
        const dyTop = Math.abs(rawY - other.y);
        if (dyTop <= SNAP_THRESHOLD && dyTop < bestDy) {
          bestDy = dyTop;
          snappedY = other.y;
          guideY = other.y + other.height / 2;
          distGuideY = null;
          hasSnapY = true;
        }

        // Vertical column alignment (same X left edge)
        const dxAlign = Math.abs(rawX - other.x);
        if (dxAlign <= SNAP_THRESHOLD && dxAlign < bestDx) {
          bestDx = dxAlign;
          snappedX = other.x;
          guideX = other.x + other.width / 2;
          distGuideX = null;
          hasSnapX = true;
        }

        const yOverlap =
          Math.min(rawY + currentNode.height, other.y + other.height) -
          Math.max(rawY, other.y);
        if (yOverlap >= 12) {
          if (other.x + other.width <= rawX + 14) {
            const gap = rawX - (other.x + other.width);
            if (gap < nearestLeftGap && gap <= 340) {
              nearestLeftGap = gap;
              nearestLeft = other;
            }
          }
          if (other.x >= rawX + currentNode.width - 14) {
            const gap = other.x - (rawX + currentNode.width);
            if (gap < nearestRightGap && gap <= 340) {
              nearestRightGap = gap;
              nearestRight = other;
            }
          }
        }

        const xOverlap =
          Math.min(rawX + currentNode.width, other.x + other.width) -
          Math.max(rawX, other.x);
        if (xOverlap >= 12) {
          if (other.y + other.height <= rawY + 14) {
            const gap = rawY - (other.y + other.height);
            if (gap < nearestAboveGap && gap <= 340) {
              nearestAboveGap = gap;
              nearestAbove = other;
            }
          }
          if (other.y >= rawY + currentNode.height - 14) {
            const gap = other.y - (rawY + currentNode.height);
            if (gap < nearestBelowGap && gap <= 340) {
              nearestBelowGap = gap;
              nearestBelow = other;
            }
          }
        }
      }

      // 3. Equal spacing centered strictly between two horizontal neighbors
      if (nearestLeft && nearestRight) {
        const freeSpace =
          nearestRight.x - (nearestLeft.x + nearestLeft.width) - currentNode.width;
        if (freeSpace >= 12) {
          const halfGap = freeSpace / 2;
          const midTargetX = nearestLeft.x + nearestLeft.width + halfGap;
          const dxMid = Math.abs(rawX - midTargetX);
          if (dxMid <= GAP_MATCH_THRESHOLD && dxMid - 1 < bestDx) {
            bestDx = dxMid - 1;
            snappedX = midTargetX;
            guideX = midTargetX + currentNode.width / 2;
            hasSnapX = true;
            const yMid =
              (Math.max(rawY, nearestLeft.y, nearestRight.y) +
                Math.min(
                  rawY + currentNode.height,
                  nearestLeft.y + nearestLeft.height,
                  nearestRight.y + nearestRight.height
                )) /
              2;
            distGuideX = {
              axis: 'x',
              x1: nearestLeft.x + nearestLeft.width,
              y1: yMid,
              x2: midTargetX,
              y2: yMid,
              label: `= ${Math.round(halfGap)} px`,
              matchedRefs: [
                {
                  x1: midTargetX + currentNode.width,
                  y1: yMid,
                  x2: nearestRight.x,
                  y2: yMid,
                },
              ],
            };
          }
        }
      }

      // 4. Equal-distance & rhythmic horizontal spacing relative to nearest left / right card
      const buildGapCandidates = (gapsList: GapEntry[]) => {
        const counts = new Map<number, number>();
        for (const entry of gapsList) {
          counts.set(entry.gap, (counts.get(entry.gap) || 0) + 1);
        }

        const anchorSteps = Array.from(new Set([layout.unitGap, ...RHYTHM_STEPS]));
        const candidates: Array<{
          gap: number;
          threshold: number;
          penalty: number;
          matched: boolean;
        }> = [];

        // Anchor steps: unitGap + clean rhythmic steps (40, 60, 80, 100, 120, 150, 180)
        for (const anchor of anchorSteps) {
          const isUnit = anchor === layout.unitGap;
          const hasExactExisting = counts.has(anchor);
          candidates.push({
            gap: anchor,
            threshold: isUnit ? SNAP_THRESHOLD : hasExactExisting ? GAP_MATCH_THRESHOLD : RHYTHM_GAP_THRESHOLD,
            penalty: isUnit ? 0.5 : hasExactExisting ? -0.5 : 1.5,
            matched: hasExactExisting && !isUnit,
          });
        }

        // Custom existing gaps that are NOT within ±3 px of an anchor step or an already-added magnet
        const extraExisting = Array.from(counts.keys()).sort(
          (a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a - b
        );
        for (const g of extraExisting) {
          const tooCloseToExisting = candidates.some((c) => Math.abs(c.gap - g) <= 3);
          if (tooCloseToExisting) continue;
          candidates.push({
            gap: g,
            threshold: GAP_MATCH_THRESHOLD,
            penalty: -0.5,
            matched: true,
          });
        }

        return candidates;
      };

      const hCandidates = buildGapCandidates(existingHGaps);
      const checkHorizontalNeighbor = (
        neighbor: (typeof stationaryNodes)[number],
        side: 'left' | 'right'
      ) => {
        for (const cand of hCandidates) {
          const targetX =
            side === 'left'
              ? neighbor.x + neighbor.width + cand.gap
              : neighbor.x - currentNode.width - cand.gap;
          const dx = Math.abs(rawX - targetX);
          const score = dx + cand.penalty;
          if (dx <= cand.threshold && score < bestDx) {
            bestDx = score;
            snappedX = targetX;
            guideX = null;
            hasSnapX = true;
            const yMid =
              (Math.max(rawY, neighbor.y) +
                Math.min(rawY + currentNode.height, neighbor.y + neighbor.height)) /
              2;
            const segX1 =
              side === 'left' ? neighbor.x + neighbor.width : targetX + currentNode.width;
            const segX2 = side === 'left' ? targetX : neighbor.x;
            const refs = existingHGaps
              .filter((eg) => eg.gap === cand.gap)
              .slice(0, 3)
              .map((eg) => ({ x1: eg.x1, y1: eg.y1, x2: eg.x2, y2: eg.y2 }));
            distGuideX = {
              axis: 'x',
              x1: segX1,
              y1: yMid,
              x2: segX2,
              y2: yMid,
              label:
                cand.matched || refs.length > 0
                  ? `= ${cand.gap} px`
                  : `${cand.gap} px`,
              matchedRefs: refs.length > 0 ? refs : undefined,
            };
          }
        }
      };

      if (nearestLeft) checkHorizontalNeighbor(nearestLeft, 'left');
      if (nearestRight) checkHorizontalNeighbor(nearestRight, 'right');

      // 5. Equal spacing centered strictly between two vertical neighbors
      if (nearestAbove && nearestBelow) {
        const freeSpace =
          nearestBelow.y - (nearestAbove.y + nearestAbove.height) - currentNode.height;
        if (freeSpace >= 12) {
          const halfGap = freeSpace / 2;
          const midTargetY = nearestAbove.y + nearestAbove.height + halfGap;
          const dyMid = Math.abs(rawY - midTargetY);
          if (dyMid <= GAP_MATCH_THRESHOLD && dyMid - 1 < bestDy) {
            bestDy = dyMid - 1;
            snappedY = midTargetY;
            guideY = midTargetY + currentNode.height / 2;
            hasSnapY = true;
            const xMid =
              (Math.max(rawX, nearestAbove.x, nearestBelow.x) +
                Math.min(
                  rawX + currentNode.width,
                  nearestAbove.x + nearestAbove.width,
                  nearestBelow.x + nearestBelow.width
                )) /
              2;
            distGuideY = {
              axis: 'y',
              x1: xMid,
              y1: nearestAbove.y + nearestAbove.height,
              x2: xMid,
              y2: midTargetY,
              label: `= ${Math.round(halfGap)} px`,
              matchedRefs: [
                {
                  x1: xMid,
                  y1: midTargetY + currentNode.height,
                  x2: xMid,
                  y2: nearestBelow.y,
                },
              ],
            };
          }
        }
      }

      // 6. Equal-distance & rhythmic vertical spacing relative to nearest above / below card
      const vCandidates = buildGapCandidates(existingVGaps);
      const checkVerticalNeighbor = (
        neighbor: (typeof stationaryNodes)[number],
        side: 'above' | 'below'
      ) => {
        for (const cand of vCandidates) {
          const targetY =
            side === 'above'
              ? neighbor.y + neighbor.height + cand.gap
              : neighbor.y - currentNode.height - cand.gap;
          const dy = Math.abs(rawY - targetY);
          const score = dy + cand.penalty;
          if (dy <= cand.threshold && score < bestDy) {
            bestDy = score;
            snappedY = targetY;
            guideY = null;
            hasSnapY = true;
            const xMid =
              (Math.max(rawX, neighbor.x) +
                Math.min(rawX + currentNode.width, neighbor.x + neighbor.width)) /
              2;
            const segY1 =
              side === 'above' ? neighbor.y + neighbor.height : targetY + currentNode.height;
            const segY2 = side === 'above' ? targetY : neighbor.y;
            const refs = existingVGaps
              .filter((eg) => eg.gap === cand.gap)
              .slice(0, 3)
              .map((eg) => ({ x1: eg.x1, y1: eg.y1, x2: eg.x2, y2: eg.y2 }));
            distGuideY = {
              axis: 'y',
              x1: xMid,
              y1: segY1,
              x2: xMid,
              y2: segY2,
              label:
                cand.matched || refs.length > 0
                  ? `= ${cand.gap} px`
                  : `${cand.gap} px`,
              matchedRefs: refs.length > 0 ? refs : undefined,
            };
          }
        }
      };

      if (nearestAbove) checkVerticalNeighbor(nearestAbove, 'above');
      if (nearestBelow) checkVerticalNeighbor(nearestBelow, 'below');

      // 7. Generation baseline fallback
      const genCoord = currentNode.generation * layout.levelStep;
      if (viewMode === 'horizontal') {
        const dxGen = Math.abs(rawX - genCoord);
        if (dxGen <= 11 && dxGen + 3.5 < bestDx) {
          snappedX = genCoord;
          guideX = genCoord + currentNode.width / 2;
          distGuideX = null;
          hasSnapX = true;
        }
      } else {
        const dyGen = Math.abs(rawY - genCoord);
        if (dyGen <= 11 && dyGen + 3.5 < bestDy) {
          snappedY = genCoord;
          guideY = genCoord + currentNode.height / 2;
          distGuideY = null;
          hasSnapY = true;
        }
      }

      const distanceGuides: DistanceGuide[] = [];
      if (hasSnapX && distGuideX) distanceGuides.push(distGuideX);
      if (hasSnapY && distGuideY) distanceGuides.push(distGuideY);

      return {
        x: Math.round(hasSnapX ? snappedX : rawX),
        y: Math.round(hasSnapY ? snappedY : rawY),
        guideX: hasSnapX ? guideX : null,
        guideY: hasSnapY ? guideY : null,
        distanceGuides,
      };
    },
    [
      filteredTree.parentChildLinks,
      layout.levelStep,
      layout.nodes,
      layout.unionEdges,
      layout.unitGap,
      snapEnabled,
      viewMode,
    ]
  );

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midScreenX = (pts[0].x + pts[1].x) / 2;
      const midScreenY = (pts[0].y + pts[1].y) / 2;
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && dist > 5) {
        pinchStateRef.current = {
          initialDist: dist,
          initialZoom: zoom,
          midCanvasX: (midScreenX - rect.left - pan.x) / zoom,
          midCanvasY: (midScreenY - rect.top - pan.y) / zoom,
        };
      }
      setIsPanning(false);
      setDraggingNode(null);
      setSelectionBox(null);
      return;
    }

    setActiveUnionId(null);
    setActiveChildLinkId(null);
    if (linkModeActive && linkSourceId) {
      setLinkSourceId(null);
      return;
    }

    // Marquee / box selection when boxSelectMode is active OR Shift is held
    if (!linkModeActive && !dragConnectSourceId && (boxSelectMode || e.shiftKey)) {
      const pt = screenToCanvas(e.clientX, e.clientY);
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const baseIds = additive ? validMultiSelectedIds : [];
      if (!additive) {
        setMultiSelectedIds([]);
      }
      onSelectPerson(null);
      setSelectionBox({
        startX: pt.x,
        startY: pt.y,
        currX: pt.x,
        currY: pt.y,
        additive,
        baseIds,
      });
      return;
    }

    setIsPanning(true);
    panStartRef.current = {
      mx: e.clientX,
      my: e.clientY,
      px: pan.x,
      py: pan.y,
      moved: false,
    };
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activePointersRef.current.size === 2 && pinchStateRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && dist > 5) {
        const nextZoom = Math.max(
          0.28,
          Math.min(2.2, pinchStateRef.current.initialZoom * (dist / pinchStateRef.current.initialDist))
        );
        const midScreenX = (pts[0].x + pts[1].x) / 2;
        const midScreenY = (pts[0].y + pts[1].y) / 2;
        setZoom(nextZoom);
        setPan({
          x: midScreenX - rect.left - pinchStateRef.current.midCanvasX * nextZoom,
          y: midScreenY - rect.top - pinchStateRef.current.midCanvasY * nextZoom,
        });
      }
      return;
    }

    if (dragConnectSourceId) {
      const pt = screenToCanvas(e.clientX, e.clientY);
      setCursorCanvasPos(pt);
      setHoveredConnectTargetId(findPersonAtCanvasPoint(pt.x, pt.y, dragConnectSourceId));
      return;
    }

    if (linkModeActive && linkSourceId) {
      setCursorCanvasPos(screenToCanvas(e.clientX, e.clientY));
    }

    if (selectionBox) {
      const pt = screenToCanvas(e.clientX, e.clientY);
      const nextBox = { ...selectionBox, currX: pt.x, currY: pt.y };
      setSelectionBox(nextBox);

      const minX = Math.min(nextBox.startX, nextBox.currX);
      const maxX = Math.max(nextBox.startX, nextBox.currX);
      const minY = Math.min(nextBox.startY, nextBox.currY);
      const maxY = Math.max(nextBox.startY, nextBox.currY);

      if (maxX - minX > 3 || maxY - minY > 3) {
        const hits: string[] = [];
        for (const n of Object.values(layout.nodes)) {
          const intersects =
            n.x <= maxX &&
            n.x + n.width >= minX &&
            n.y <= maxY &&
            n.y + n.height >= minY;
          if (intersects) hits.push(n.person.id);
        }
        const merged = Array.from(new Set([...nextBox.baseIds, ...hits]));
        setMultiSelectedIds(merged);
      }
      return;
    }

    if (draggingNode) {
      const dx = (e.clientX - draggingNode.startClientX) / zoom;
      const dy = (e.clientY - draggingNode.startClientY) / zoom;
      if (draggingNode.moved || Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        lastDragMovedRef.current = true;
        const rawX = draggingNode.startNodeX + dx;
        const rawY = draggingNode.startNodeY + dy;
        const groupIds = Object.keys(draggingNode.groupStartPositions);
        const excluded = new Set(groupIds);
        const snapped = computeSoftSnap(draggingNode.id, rawX, rawY, excluded);
        setSnapGuides({
          horizontalY: snapped.guideY,
          verticalX: snapped.guideX,
          distanceGuides: snapped.distanceGuides,
        });

        const deltaX = snapped.x - draggingNode.startNodeX;
        const deltaY = snapped.y - draggingNode.startNodeY;
        const moves = groupIds.map((pid) => {
          const sp = draggingNode.groupStartPositions[pid];
          return {
            personId: pid,
            pos: {
              x: Math.round(sp.x + deltaX),
              y: Math.round(sp.y + deltaY),
            },
          };
        });

        if (onMovePersons) {
          onMovePersons(moves, viewMode, draggingNode.dragSessionId);
        } else {
          for (const mv of moves) {
            onMovePerson(mv.personId, mv.pos, viewMode, draggingNode.dragSessionId);
          }
        }

        if (!draggingNode.moved) {
          setDraggingNode({ ...draggingNode, moved: true });
        }
      }
      return;
    }

    if (isPanning) {
      const dx = e.clientX - panStartRef.current.mx;
      const dy = e.clientY - panStartRef.current.my;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        panStartRef.current.moved = true;
      }
      setPan({
        x: panStartRef.current.px + dx,
        y: panStartRef.current.py + dy,
      });
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }

    if (selectionBox) {
      setSelectionBox(null);
      return;
    }

    if (dragConnectSourceId) {
      const pt = screenToCanvas(e.clientX, e.clientY);
      const targetId = findPersonAtCanvasPoint(pt.x, pt.y, dragConnectSourceId);
      if (targetId) {
        setPendingConnection({ sourceId: dragConnectSourceId, targetId });
        setPendingKind('as_spouse');
        setPendingVerif('confirmed');
      }
      setDragConnectSourceId(null);
      setHoveredConnectTargetId(null);
      setCursorCanvasPos(null);
    }

    if (isPanning && !panStartRef.current.moved && !draggingNode && !dragConnectSourceId) {
      onSelectPerson(null);
      if (validMultiSelectedIds.length > 0 && !boxSelectMode) {
        setMultiSelectedIds([]);
      }
    }

    setIsPanning(false);
    setDraggingNode(null);
    setSnapGuides({ horizontalY: null, verticalX: null, distanceGuides: [] });
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.09 : 0.91;
    const nextZoom = Math.max(0.28, Math.min(2.2, zoom * factor));
    const ratio = nextZoom / zoom;
    setPan({
      x: mx - (mx - pan.x) * ratio,
      y: my - (my - pan.y) * ratio,
    });
    setZoom(nextZoom);
  };

  const handleNodeClick = (e: React.MouseEvent, personId: string) => {
    e.stopPropagation();
    if (lastDragMovedRef.current) {
      lastDragMovedRef.current = false;
      return;
    }

    if (linkModeActive) {
      if (!linkSourceId) {
        setLinkSourceId(personId);
        return;
      }
      if (linkSourceId === personId) {
        setLinkSourceId(null);
        return;
      }
      setPendingConnection({ sourceId: linkSourceId, targetId: personId });
      setPendingKind('as_spouse');
      setPendingVerif('confirmed');
      return;
    }

    if (boxSelectMode || e.shiftKey || e.ctrlKey || e.metaKey) {
      onSelectPerson(null);
      setMultiSelectedIds((prev) => {
        const cleaned = prev.filter((id) => Boolean(layout.nodes[id]));
        if (cleaned.includes(personId)) {
          return cleaned.filter((id) => id !== personId);
        }
        return [...cleaned, personId];
      });
      return;
    }

    setMultiSelectedIds([]);
    onSelectPerson(personId);
  };

  const startDragConnect = (e: React.PointerEvent, personId: string) => {
    e.stopPropagation();
    const node = layout.nodes[personId];
    if (!node) return;
    setDragConnectSourceId(personId);
    setCursorCanvasPos({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
  };

  const activeUnion = useMemo(
    () => layout.unionEdges.find((u) => u.union.id === activeUnionId) || null,
    [activeUnionId, layout.unionEdges]
  );

  const activeChildEdge = useMemo(
    () => layout.childEdges.find((c) => c.link.id === activeChildLinkId) || null,
    [activeChildLinkId, layout.childEdges]
  );

  const activeDragSource = dragConnectSourceId || linkSourceId;

  const handleEqualizeSpacing40 = useCallback(() => {
    if (validMultiSelectedIds.length < 2) return;
    const GAP = 40;
    const sourceNodes = validMultiSelectedIds
      .map((id) => layout.nodes[id])
      .filter((n): n is NonNullable<typeof n> => Boolean(n));

    if (sourceNodes.length < 2) return;

    type WorkingNode = {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };

    const items: WorkingNode[] = sourceNodes.map((n) => ({
      id: n.person.id,
      x: Math.round(n.x),
      y: Math.round(n.y),
      width: n.width,
      height: n.height,
    }));

    if (viewMode === 'horizontal') {
      items.sort((a, b) => a.x - b.x || a.y - b.y);
      const cols: WorkingNode[][] = [];
      for (const item of items) {
        const lastCol = cols[cols.length - 1];
        if (lastCol) {
          const avgX = lastCol.reduce((s, c) => s + c.x, 0) / lastCol.length;
          if (Math.abs(item.x - avgX) <= Math.round(item.width * 0.55)) {
            lastCol.push(item);
            continue;
          }
        }
        cols.push([item]);
      }

      const colMeta: Array<{ nodes: WorkingNode[]; origLeft: number; origRight: number }> = [];
      for (const col of cols) {
        const xSorted = [...col].sort((a, b) => a.x - b.x);
        const xBands: WorkingNode[][] = [];
        for (const n of xSorted) {
          const last = xBands[xBands.length - 1];
          if (last && Math.abs(n.x - last[0].x) <= 24) {
            last.push(n);
          } else {
            xBands.push([n]);
          }
        }
        for (const band of xBands) {
          const avg = Math.round(band.reduce((s, n) => s + n.x, 0) / band.length);
          for (const n of band) n.x = avg;
        }

        const origLeft = Math.min(...col.map((n) => n.x));
        const origRight = Math.max(...col.map((n) => n.x + n.width));

        col.sort((a, b) => a.y - b.y);
        if (col.length > 1) {
          const origTop = col[0].y;
          const origBot = col[col.length - 1].y + col[col.length - 1].height;
          const center = (origTop + origBot) / 2;
          const totalH =
            col.reduce((s, n) => s + n.height, 0) + (col.length - 1) * GAP;
          let cursorY = Math.round(center - totalH / 2);
          for (const n of col) {
            n.y = cursorY;
            cursorY += n.height + GAP;
          }
        }

        colMeta.push({ nodes: col, origLeft, origRight });
      }

      let prevNewRight = colMeta[0].origRight;
      for (let i = 1; i < colMeta.length; i++) {
        const cm = colMeta[i];
        const targetLeft = prevNewRight + GAP;
        const dx = targetLeft - cm.origLeft;
        for (const n of cm.nodes) {
          n.x += dx;
        }
        prevNewRight = cm.origRight + dx;
      }
    } else {
      items.sort((a, b) => a.y - b.y || a.x - b.x);
      const rows: WorkingNode[][] = [];
      for (const item of items) {
        const lastRow = rows[rows.length - 1];
        if (lastRow) {
          const avgY = lastRow.reduce((s, r) => s + r.y, 0) / lastRow.length;
          if (Math.abs(item.y - avgY) <= Math.round(item.height * 0.55)) {
            lastRow.push(item);
            continue;
          }
        }
        rows.push([item]);
      }

      const rowMeta: Array<{ nodes: WorkingNode[]; origTop: number; origBottom: number }> = [];
      for (const row of rows) {
        const ySorted = [...row].sort((a, b) => a.y - b.y);
        const yBands: WorkingNode[][] = [];
        for (const n of ySorted) {
          const last = yBands[yBands.length - 1];
          if (last && Math.abs(n.y - last[0].y) <= 24) {
            last.push(n);
          } else {
            yBands.push([n]);
          }
        }
        for (const band of yBands) {
          const avg = Math.round(band.reduce((s, n) => s + n.y, 0) / band.length);
          for (const n of band) n.y = avg;
        }

        const origTop = Math.min(...row.map((n) => n.y));
        const origBottom = Math.max(...row.map((n) => n.y + n.height));

        row.sort((a, b) => a.x - b.x);
        if (row.length > 1) {
          const origLeft = row[0].x;
          const origRight = row[row.length - 1].x + row[row.length - 1].width;
          const center = (origLeft + origRight) / 2;
          const totalW =
            row.reduce((s, n) => s + n.width, 0) + (row.length - 1) * GAP;
          let cursorX = Math.round(center - totalW / 2);
          for (const n of row) {
            n.x = cursorX;
            cursorX += n.width + GAP;
          }
        }

        rowMeta.push({ nodes: row, origTop, origBottom });
      }

      let prevNewBottom = rowMeta[0].origBottom;
      for (let i = 1; i < rowMeta.length; i++) {
        const rm = rowMeta[i];
        const targetTop = prevNewBottom + GAP;
        const dy = targetTop - rm.origTop;
        for (const n of rm.nodes) {
          n.y += dy;
        }
        prevNewBottom = rm.origBottom + dy;
      }
    }

    const moves = items.map((n) => ({
      personId: n.id,
      pos: { x: Math.round(n.x), y: Math.round(n.y) },
    }));

    if (onMovePersons) {
      onMovePersons(moves, viewMode);
    } else {
      for (const mv of moves) {
        onMovePerson(mv.personId, mv.pos, viewMode);
      }
    }
  }, [
    layout.nodes,
    onMovePerson,
    onMovePersons,
    validMultiSelectedIds,
    viewMode,
  ]);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Workspace Toolbar (All controls share unified h-9 height) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-[#FBF9F5] px-3 py-2 sm:px-5 sm:py-2.5">
        {/* Left Filters & Search */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Lineage Filter */}
          {fullLineage.legend.length > 0 && (
            <select
              value={lineageFilter}
              onChange={(e) => setLineageFilter(e.target.value)}
              title="Фильтр по линии рода"
              className="h-9 rounded-md border border-stone-200 bg-white px-2.5 text-[16px] font-medium text-stone-700 hover:border-stone-300 focus:outline-none cursor-pointer"
            >
              <option value="all">Все роды</option>
              {fullLineage.legend.map((item) => (
                <option key={item.stem} value={item.stem}>
                  Род: {item.name}
                </option>
              ))}
            </select>
          )}

          {/* Blood Relatives Filter */}
          <button
            type="button"
            onClick={() => {
              const next = !hideNonBlood;
              setHideNonBlood(next);
              if (next) {
                const initialAnchor =
                  (selectedPersonId && tree.persons[selectedPersonId] ? selectedPersonId : null) ||
                  (validMultiSelectedIds.length === 1 && tree.persons[validMultiSelectedIds[0]]
                    ? validMultiSelectedIds[0]
                    : null);
                setBloodAnchorId(initialAnchor);
              } else {
                setBloodAnchorId(null);
              }
            }}
            title="Только кровные: показать кровных родственников выбранной карточки (по отцовской и материнской линиям)"
            aria-label="Только кровные родственники"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors shrink-0 cursor-pointer ${
              hideNonBlood
                ? 'border-[#8B261D] bg-[#8B261D] text-white'
                : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
            }`}
          >
            <Users size={15} />
          </button>

          <div className="relative">
            <div className="flex h-9 items-center rounded-md border border-stone-200 bg-white px-2.5">
              <Search size={14} className="text-stone-400 mr-1.5 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                placeholder="Поиск"
                className="w-28 sm:w-40 bg-transparent text-[16px] text-stone-900 placeholder:text-stone-400 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {searchOpen && (searchMatches.length > 0 || photoSearchMatches.length > 0) && (
              <div className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[90vw] rounded-lg border border-stone-200 bg-white py-1 shadow-lg max-h-[70vh] overflow-y-auto">
                {searchMatches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      focusOnPerson(m.id);
                      setSearchOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-stone-50 cursor-pointer"
                  >
                    <span className="text-[14.5px] font-medium text-stone-900 truncate">
                      {formatFullName(m)}
                    </span>
                    <span className="font-mono-tabular text-[13px] text-stone-400 ml-2 shrink-0">
                      {formatLifespan(m)}
                    </span>
                  </button>
                ))}

                {photoSearchMatches.length > 0 && (
                  <div className={searchMatches.length > 0 ? 'border-t border-stone-100 mt-1 pt-1' : ''}>
                    <div className="px-3 py-1 text-[12px] font-medium uppercase tracking-[0.04em] text-stone-500">
                      Отмечены на фотографиях ({photoSearchMatches.length})
                    </div>
                    {photoSearchMatches.map((item) => (
                      <button
                        key={`${item.ownerId}_${item.photo.id}`}
                        type="button"
                        onClick={() => {
                          setPhotoLightbox({ ownerId: item.ownerId, photo: item.photo });
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-stone-50 cursor-pointer"
                      >
                        <img
                          src={item.photo.dataUrl}
                          alt={item.photo.caption || 'Фото'}
                          className="h-9 w-9 rounded object-cover shrink-0 border border-stone-200"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-medium text-stone-900 truncate">
                            {item.matchedNames.join(', ')}
                          </div>
                          {item.photo.caption && (
                            <div className="text-[12px] italic text-stone-500 truncate">
                              {item.photo.caption}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Controls: Snapping, Multi-Select, Linking, Add Person, Reset, Zoom + View Mode Switcher */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Soft Snapping Toggle */}
          <button
            type="button"
            onClick={() => setSnapEnabled((v) => !v)}
            title="Прилипание: мягкое прилипание карточек и одинаковые расстояния при перетаскивании"
            aria-label="Прилипание"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors shrink-0 cursor-pointer ${
              snapEnabled
                ? 'border-stone-800 bg-stone-900 text-white'
                : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
            }`}
          >
            <Magnet size={15} />
          </button>

          {/* Multi-Select Box/Group Toggle */}
          <button
            type="button"
            onClick={() => {
              setBoxSelectMode((prev) => {
                const next = !prev;
                if (next) {
                  setLinkModeActive(false);
                  setLinkSourceId(null);
                  onSelectPerson(null);
                }
                return next;
              });
            }}
            title={
              validMultiSelectedIds.length > 0
                ? `Выделить: выбрано карточек (${validMultiSelectedIds.length}). Перетаскивайте группу или используйте Shift для добавления`
                : 'Выделить сразу несколько карточек рамкой или нажатием, чтобы переместить их группой (также можно удерживать Shift)'
            }
            aria-label="Выделить несколько карточек"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors shrink-0 cursor-pointer ${
              boxSelectMode || validMultiSelectedIds.length > 0
                ? 'border-[#8B261D] bg-[#8B261D] text-white'
                : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
            }`}
          >
            <SquareDashedMousePointer size={15} />
          </button>

          <button
            type="button"
            onClick={() => {
              setLinkModeActive((prev) => !prev);
              setBoxSelectMode(false);
              setMultiSelectedIds([]);
              setLinkSourceId(null);
              setPendingConnection(null);
            }}
            aria-label="Связать родственников"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors shrink-0 cursor-pointer ${
              linkModeActive
                ? 'border-[#8B261D] bg-[#8B261D] text-white'
                : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
            }`}
            title={
              linkModeActive
                ? 'Связывание активно: нажмите на второго родственника (или сюда для выхода)'
                : 'Связать родственников: нажмите на одного человека и затем на другого, либо потяните за точку связи на карточке'
            }
          >
            <Link2 size={15} />
          </button>

          <button
            type="button"
            onClick={onAddPerson}
            title="Добавить новую персону в древо"
            aria-label="Добавить персону"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[#8B261D] text-white hover:bg-[#741E17] transition-colors shrink-0 cursor-pointer"
          >
            <UserPlus size={15} />
          </button>

          {personList.length >= 2 && (
            <button
              type="button"
              disabled={validMultiSelectedIds.length < 2}
              onClick={handleEqualizeSpacing40}
              title={
                validMultiSelectedIds.length >= 2
                  ? 'Шаг 40 px: выставить расстояние 40 px между выделенными карточками'
                  : 'Шаг 40 px: выделите 2 или более карточек (кнопкой «Выделить» или с зажатым Shift), чтобы выставить между ними шаг 40 px'
              }
              aria-label="Шаг 40 px для выделенных карточек"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors shrink-0 ${
                validMultiSelectedIds.length >= 2
                  ? 'border-[#8B261D]/45 bg-[#8B261D]/5 text-[#8B261D] hover:bg-[#8B261D]/10 cursor-pointer'
                  : 'border-stone-200/70 bg-white/60 text-stone-400 cursor-not-allowed'
              }`}
            >
              <Ruler size={15} />
            </button>
          )}

          {hasCustomPositions && (
            <button
              type="button"
              onClick={() => {
                onResetPositions(viewMode);
                setTimeout(fitTreeToViewport, 30);
              }}
              title="Выровнять древо автоматически"
              aria-label="Выровнять древо"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-700 hover:border-stone-300 shrink-0 cursor-pointer"
            >
              <AlignCenter size={15} />
            </button>
          )}

          {onUndo && (
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              title="Отменить последнее действие (Ctrl+Z)"
              aria-label="Отменить последнее действие"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors shrink-0 ${
                canUndo
                  ? 'border-stone-200 bg-white text-stone-700 hover:border-stone-300 cursor-pointer'
                  : 'border-stone-200/70 bg-white/60 text-stone-400 cursor-not-allowed'
              }`}
            >
              <Undo2 size={15} />
            </button>
          )}

          <div className="inline-flex h-9 items-center rounded-md border border-stone-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.28, z * 0.86))}
              title="Отдалить"
              aria-label="Отдалить"
              className="flex h-full items-center px-2 text-stone-600 hover:bg-stone-50 cursor-pointer"
            >
              <ZoomOut size={14} />
            </button>
            <span className="desktop-btn-label px-1.5 font-mono-tabular text-[13px] text-stone-600 min-w-[44px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.2, z * 1.15))}
              title="Приблизить"
              aria-label="Приблизить"
              className="flex h-full items-center px-2 text-stone-600 hover:bg-stone-50 cursor-pointer"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              onClick={fitTreeToViewport}
              title="Центрировать и поместить всё древо"
              aria-label="Центрировать древо"
              className="flex h-full items-center border-l border-stone-200 px-2.5 text-stone-700 hover:bg-stone-50 cursor-pointer"
            >
              <Focus size={15} />
            </button>
          </div>

          {/* View Mode Switcher (icons-only with hover tooltips) */}
          <div
            className="inline-flex h-9 items-center rounded-lg border border-stone-200 bg-stone-100/90 p-0.5"
            role="group"
            aria-label="Режим отображения древа"
          >
            {(
              [
                { id: 'vertical', label: 'Вертикальное древо', Icon: ArrowUpDown },
                { id: 'horizontal', label: 'Горизонтальное древо', Icon: ArrowLeftRight },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onViewModeChange(id)}
                title={label}
                aria-label={label}
                className={`flex h-full w-8 items-center justify-center rounded-md transition-colors shrink-0 cursor-pointer ${
                  viewMode === id
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sub-header Bar: Lineage Legend + Logic Check + Local Status */}
      <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 bg-white/85 px-3 py-1.5 sm:px-5 text-[12.5px] sm:text-[13px] text-stone-600">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {layout.legend.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {layout.legend.map((item) => (
                <span key={item.stem} className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span>{item.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {(() => {
            const errorIssues = validationIssues.filter((i) => i.severity === 'error');
            const warningIssues = validationIssues.filter((i) => i.severity !== 'error');
            return (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setValidationOpen((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-medium transition-colors cursor-pointer ${
                    errorIssues.length > 0
                      ? 'bg-red-50 text-[#8B261D] border border-red-200 hover:bg-red-100/80'
                      : warningIssues.length > 0
                      ? 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
                      : 'text-stone-600 hover:bg-stone-100'
                  }`}
                  title="Автоматическая проверка логических ошибок, отчеств, дат и родственных связей"
                >
                  {errorIssues.length > 0 ? (
                    <AlertTriangle size={13} className="text-[#8B261D] shrink-0" />
                  ) : warningIssues.length > 0 ? (
                    <AlertTriangle size={13} className="text-amber-700 shrink-0" />
                  ) : (
                    <CheckCircle2 size={13} className="text-[#15803D] shrink-0" />
                  )}
                  <span>
                    {errorIssues.length > 0
                      ? warningIssues.length > 0
                        ? `Ошибки: ${errorIssues.length} · Замечания: ${warningIssues.length}`
                        : `Ошибки: ${errorIssues.length}`
                      : warningIssues.length > 0
                      ? `Проверка: ${warningIssues.length} замечаний`
                      : 'Ошибок нет'}
                  </span>
                </button>

                {validationOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1.5 w-[min(92vw,420px)] rounded-xl border border-stone-200 bg-white p-3.5 shadow-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                      <span className="text-[14px] font-semibold text-stone-800">
                        Логическая проверка древа
                      </span>
                      <button
                        type="button"
                        onClick={() => setValidationOpen(false)}
                        className="text-stone-400 hover:text-stone-700 cursor-pointer"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    {validationIssues.length === 0 ? (
                      <p className="py-2 text-[13.5px] text-stone-600">
                        Даты рождения, кончины, отчества, браки и родственные поколения согласованы — противоречий не обнаружено.
                      </p>
                    ) : (
                      <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
                        {errorIssues.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#8B261D]">
                              Ошибки ({errorIssues.length})
                            </div>
                            <div className="space-y-1.5">
                              {errorIssues.map((issue) => (
                                <button
                                  key={issue.id}
                                  type="button"
                                  onClick={() => {
                                    setValidationOpen(false);
                                    focusOnPerson(issue.personId);
                                    onEditPerson(issue.personId);
                                  }}
                                  className="w-full rounded-lg border border-red-200/80 bg-[#FBF9F5] p-2.5 text-left hover:border-[#8B261D]/55 transition-colors cursor-pointer"
                                >
                                  <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-stone-900">
                                    <AlertTriangle
                                      size={13}
                                      className="text-[#8B261D] shrink-0"
                                    />
                                    <span>{issue.title}</span>
                                  </div>
                                  <p className="mt-1 text-[12.5px] leading-snug text-stone-600">
                                    {issue.description}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {warningIssues.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-amber-800">
                              Предупреждения ({warningIssues.length})
                            </div>
                            <div className="space-y-1.5">
                              {warningIssues.map((issue) => (
                                <button
                                  key={issue.id}
                                  type="button"
                                  onClick={() => {
                                    setValidationOpen(false);
                                    focusOnPerson(issue.personId);
                                    onEditPerson(issue.personId);
                                  }}
                                  className="w-full rounded-lg border border-stone-200 bg-[#FBF9F5] p-2.5 text-left hover:border-amber-400 transition-colors cursor-pointer"
                                >
                                  <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-stone-900">
                                    <AlertTriangle
                                      size={13}
                                      className="text-amber-600 shrink-0"
                                    />
                                    <span>{issue.title}</span>
                                  </div>
                                  <p className="mt-1 text-[12.5px] leading-snug text-stone-600">
                                    {issue.description}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex items-center gap-1.5 text-stone-600 whitespace-nowrap">
            <Lock size={13} className="text-[#15803D]" />
            <span>Локально</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{personList.length} чел.</span>
          </div>
        </div>
      </div>

      {linkModeActive && (
        <div className="flex items-center justify-between gap-4 border-b border-[#8B261D]/20 bg-[#8B261D]/5 px-4 py-2 text-[14px] sm:text-[14.5px] text-stone-800">
          <div className="flex items-center gap-2">
            <Link2 size={15} className="text-[#8B261D] shrink-0" />
            <span>
              {!linkSourceId
                ? 'Нажмите на первую персону (или потяните за красную точку связи на любой карточке).'
                : `Выбран: ${formatShortName(
                    tree.persons[linkSourceId]
                  )}. Нажмите на второго родственника.`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setLinkModeActive(false);
              setLinkSourceId(null);
            }}
            className="font-medium text-[#8B261D] hover:underline whitespace-nowrap cursor-pointer"
          >
            Выйти
          </button>
        </div>
      )}

      {(boxSelectMode || validMultiSelectedIds.length > 0) && !linkModeActive && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#8B261D]/20 bg-[#8B261D]/5 px-4 py-2 text-[14px] sm:text-[14.5px] text-stone-800">
          <div className="flex items-center gap-2">
            <SquareDashedMousePointer size={15} className="text-[#8B261D] shrink-0" />
            <span>
              {validMultiSelectedIds.length > 0
                ? `Выбрано карточек: ${validMultiSelectedIds.length}. Потяните любую выделенную карточку, чтобы переместить всю группу.`
                : 'Режим выделения: обведите рамкой несколько карточек на холсте или нажимайте на них по одной.'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {validMultiSelectedIds.length >= 2 && (
              <button
                type="button"
                onClick={handleEqualizeSpacing40}
                className="font-medium text-[#8B261D] hover:underline whitespace-nowrap cursor-pointer"
              >
                Выставить 40 px
              </button>
            )}
            {validMultiSelectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => setMultiSelectedIds([])}
                className="font-medium text-stone-700 hover:text-stone-950 hover:underline whitespace-nowrap cursor-pointer"
              >
                Снять выделение
              </button>
            )}
            {boxSelectMode && (
              <button
                type="button"
                onClick={() => setBoxSelectMode(false)}
                className="font-medium text-[#8B261D] hover:underline whitespace-nowrap cursor-pointer"
              >
                Готово
              </button>
            )}
          </div>
        </div>
      )}

      {hideNonBlood && !linkModeActive && !boxSelectMode && validMultiSelectedIds.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#8B261D]/20 bg-[#8B261D]/5 px-4 py-2 text-[14px] sm:text-[14.5px] text-stone-800">
          <div className="flex items-center gap-2">
            <Users size={15} className="text-[#8B261D] shrink-0" />
            <span>
              {bloodAnchorPerson
                ? `Показаны только кровные родственники: ${formatShortName(bloodAnchorPerson)} (по отцу и по матери). Нажмите на другую карточку, чтобы переключить точку отсчёта.`
                : 'Режим «Только кровные»: нажмите на любую карточку на древе, чтобы показать её кровных родственников.'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setHideNonBlood(false);
              setBloodAnchorId(null);
            }}
            className="font-medium text-[#8B261D] hover:underline whitespace-nowrap cursor-pointer"
          >
            {bloodAnchorPerson ? 'Показать всех' : 'Отмена'}
          </button>
        </div>
      )}

      {/* Interactive Pointer + Touch Viewport */}
      <div
        ref={containerRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onWheel={handleWheel}
        onClick={() => setSearchOpen(false)}
        style={{ touchAction: 'none' }}
        className={`archival-canvas-grid relative flex-1 overflow-hidden select-none ${
          isPanning
            ? 'cursor-grabbing'
            : linkModeActive || dragConnectSourceId || boxSelectMode || selectionBox
            ? 'cursor-crosshair'
            : 'cursor-grab'
        }`}
      >
        {personList.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md rounded-xl border border-stone-200 bg-white p-8 text-center shadow-xs">
              <h2 className="font-editorial text-2xl font-semibold text-stone-900">
                Чистый лист родословной
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                Начните создание семейного архива с первого человека или импортируйте готовое древо из файла GEDCOM (.ged), ZIP-архива с фото или JSON.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onAddFirstPerson}
                  className="inline-flex items-center gap-2 rounded-md bg-[#8B261D] px-4 py-2 text-[14.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
                >
                  <UserPlus size={15} />
                  <span>Добавить первого человека</span>
                </button>
                <button
                  type="button"
                  onClick={onGoToImport}
                  className="rounded-md border border-stone-300 bg-white px-4 py-2 text-[14.5px] font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
                >
                  Импортировать файл
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="origin-top-left"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            {/* SVG Rounded-Corner Orthogonal Lines Layer (behind cards) */}
            <svg
              className="pointer-events-auto overflow-visible"
              width={1}
              height={1}
              style={{ position: 'absolute', left: 0, top: 0, zIndex: 1 }}
            >
              {/* Parent -> Child Rounded Orthogonal Paths */}
              {layout.childEdges.map((edge) => {
                const isSelected = activeChildLinkId === edge.link.id;
                const isPossible = edge.link.verification === 'possible';
                const isAdoptive = edge.link.relationType !== 'biological';
                const hasActiveSelection = Boolean(selectedPersonId && layout.nodes[selectedPersonId]);
                const dimEdge =
                  hasActiveSelection &&
                  edge.link.parentId !== selectedPersonId &&
                  edge.link.childId !== selectedPersonId;

                let waypoints: Array<{ x: number; y: number }> = [];
                if (viewMode === 'horizontal') {
                  waypoints =
                    Math.abs(edge.parentY - edge.childY) <= 1.5
                      ? [
                          { x: edge.parentX, y: edge.parentY },
                          { x: edge.childX, y: edge.childY },
                        ]
                      : [
                          { x: edge.parentX, y: edge.parentY },
                          { x: edge.busPos, y: edge.parentY },
                          { x: edge.busPos, y: edge.childY },
                          { x: edge.childX, y: edge.childY },
                        ];
                } else if (edge.detourX !== undefined) {
                  // Route cleanly around intermediate generation cards via clear gap
                  const dropY = edge.dropY ?? edge.parentY + 18;
                  waypoints = [
                    { x: edge.parentX, y: edge.parentY },
                    { x: edge.parentX, y: dropY },
                    { x: edge.detourX, y: dropY },
                    { x: edge.detourX, y: edge.busPos },
                    { x: edge.childX, y: edge.busPos },
                    { x: edge.childX, y: edge.childY },
                  ];
                } else {
                  waypoints =
                    Math.abs(edge.parentX - edge.childX) <= 1.5
                      ? [
                          { x: edge.parentX, y: edge.parentY },
                          { x: edge.childX, y: edge.childY },
                        ]
                      : [
                          { x: edge.parentX, y: edge.parentY },
                          { x: edge.parentX, y: edge.busPos },
                          { x: edge.childX, y: edge.busPos },
                          { x: edge.childX, y: edge.childY },
                        ];
                }

                const d = buildRoundedPolylinePath(waypoints, CORNER_RADIUS);

                return (
                  <g
                    key={`${edge.link.id}_${edge.viaUnionId || 'direct'}`}
                    style={{ opacity: dimEdge ? 0.35 : 1, transition: 'opacity 150ms ease' }}
                  >
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                      className="cursor-pointer"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveUnionId(null);
                        setActiveChildLinkId(edge.link.id);
                      }}
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke={edge.color}
                      strokeOpacity={1}
                      strokeWidth={isSelected ? 3.8 : 2.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={isPossible || isAdoptive ? '7 5' : undefined}
                      className="pointer-events-none transition-all"
                    />
                  </g>
                );
              })}

              {/* Union / Marriage Lines + Hubs */}
              {layout.unionEdges.map((ue) => {
                const isSelected = activeUnionId === ue.union.id;
                const isDivorced = ue.union.status === 'divorced';
                const isPossible = ue.union.verification === 'possible';
                const hasActiveSelection = Boolean(selectedPersonId && layout.nodes[selectedPersonId]);
                const dimEdge =
                  hasActiveSelection && !ue.union.partnerIds.includes(selectedPersonId!);

                let path1 = '';
                let path2 = '';

                if (ue.routeBelow && ue.bridgeY !== undefined) {
                  path1 = buildRoundedPolylinePath(
                    [
                      { x: ue.x1, y: ue.y1 },
                      { x: ue.x1, y: ue.bridgeY },
                      { x: ue.hubX, y: ue.bridgeY },
                    ],
                    CORNER_RADIUS
                  );
                  path2 = buildRoundedPolylinePath(
                    [
                      { x: ue.hubX, y: ue.bridgeY },
                      { x: ue.x2, y: ue.bridgeY },
                      { x: ue.x2, y: ue.y2 },
                    ],
                    CORNER_RADIUS
                  );
                } else if (viewMode === 'horizontal') {
                  path1 = buildRoundedPolylinePath(
                    Math.abs(ue.x1 - ue.x2) > 1
                      ? [
                          { x: ue.x1, y: ue.y1 },
                          { x: ue.x1, y: ue.hubY },
                          { x: ue.hubX, y: ue.hubY },
                        ]
                      : [
                          { x: ue.x1, y: ue.y1 },
                          { x: ue.hubX, y: ue.hubY },
                        ],
                    CORNER_RADIUS
                  );
                  path2 = buildRoundedPolylinePath(
                    Math.abs(ue.x1 - ue.x2) > 1
                      ? [
                          { x: ue.hubX, y: ue.hubY },
                          { x: ue.x2, y: ue.hubY },
                          { x: ue.x2, y: ue.y2 },
                        ]
                      : [
                          { x: ue.hubX, y: ue.hubY },
                          { x: ue.x2, y: ue.y2 },
                        ],
                    CORNER_RADIUS
                  );
                } else {
                  path1 = buildRoundedPolylinePath(
                    Math.abs(ue.y1 - ue.y2) > 1
                      ? [
                          { x: ue.x1, y: ue.y1 },
                          { x: ue.hubX, y: ue.y1 },
                          { x: ue.hubX, y: ue.hubY },
                        ]
                      : [
                          { x: ue.x1, y: ue.y1 },
                          { x: ue.hubX, y: ue.hubY },
                        ],
                    CORNER_RADIUS
                  );
                  path2 = buildRoundedPolylinePath(
                    Math.abs(ue.y1 - ue.y2) > 1
                      ? [
                          { x: ue.hubX, y: ue.hubY },
                          { x: ue.hubX, y: ue.y2 },
                          { x: ue.x2, y: ue.y2 },
                        ]
                      : [
                          { x: ue.hubX, y: ue.hubY },
                          { x: ue.x2, y: ue.y2 },
                        ],
                    CORNER_RADIUS
                  );
                }

                return (
                  <g
                    key={ue.union.id}
                    style={{ opacity: dimEdge ? 0.35 : 1, transition: 'opacity 150ms ease' }}
                  >
                    <path
                      d={path1}
                      fill="none"
                      stroke={ue.color1}
                      strokeWidth={isSelected ? 3.8 : 2.6}
                      strokeLinecap="round"
                      strokeOpacity={1}
                      strokeDasharray={isDivorced || isPossible ? '6 4' : undefined}
                    />
                    <path
                      d={path2}
                      fill="none"
                      stroke={ue.color2}
                      strokeWidth={isSelected ? 3.8 : 2.6}
                      strokeLinecap="round"
                      strokeOpacity={1}
                      strokeDasharray={isDivorced || isPossible ? '6 4' : undefined}
                    />
                    <g
                      transform={`translate(${ue.hubX}, ${ue.hubY})`}
                      className="cursor-pointer"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveChildLinkId(null);
                        setActiveUnionId(ue.union.id);
                      }}
                    >
                      <circle
                        r={10}
                        fill="#FBF9F5"
                        stroke={isSelected ? '#1C1917' : '#D6CEBE'}
                        strokeWidth={isSelected ? 2 : 1.5}
                      />
                      {isDivorced ? (
                        <path
                          d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5"
                          stroke="#B45309"
                          strokeWidth={1.6}
                          strokeLinecap="round"
                        />
                      ) : (
                        <circle r={3.5} fill={ue.color1} />
                      )}
                    </g>
                  </g>
                );
              })}

              {/* Live Rubber-Band Curve during drag-connect */}
              {activeDragSource && layout.nodes[activeDragSource] && cursorCanvasPos && (() => {
                const src = layout.nodes[activeDragSource];
                const sx = src.x + src.width / 2;
                const sy = src.y + src.height / 2;
                const tx = cursorCanvasPos.x;
                const ty = cursorCanvasPos.y;
                const cy = (sy + ty) / 2;
                return (
                  <path
                    d={`M ${sx} ${sy} C ${sx} ${cy}, ${tx} ${cy}, ${tx} ${ty}`}
                    fill="none"
                    stroke="#8B261D"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeDasharray="7 5"
                    className="pointer-events-none"
                  />
                );
              })()}
            </svg>

            {/* HTML Person Cards Layer (above lines, z-index 10) */}
            {Object.values(layout.nodes).map((node) => {
              const { person, lineageColor } = node;
              const isMultiSelected = multiSelectedSet.has(person.id);
              const isSelected = selectedPersonId === person.id && validMultiSelectedIds.length === 0;
              const hasSingleSelection =
                validMultiSelectedIds.length === 0 &&
                Boolean(selectedPersonId && layout.nodes[selectedPersonId]);
              const hasMultiSelection = validMultiSelectedIds.length > 0;
              const isDimmed =
                (hasSingleSelection &&
                  !isSelected &&
                  hoveredConnectTargetId !== person.id &&
                  activeDragSource !== person.id) ||
                (hasMultiSelection &&
                  !isMultiSelected &&
                  hoveredConnectTargetId !== person.id &&
                  activeDragSource !== person.id);
              const isLinkSource = activeDragSource === person.id;
              const isConnectHoverTarget = hoveredConnectTargetId === person.id;
              const photoObj = getPrimaryPhotoObj(person);
              const matchesSearch =
                searchQuery.trim().length > 0 &&
                searchMatches.some((m) => m.id === person.id);

              const cardSurname = getTreeDisplaySurname(person);
              const cardLifespan = formatCardLifespan(person);

              return (
                <div
                  key={person.id}
                  style={{
                    position: 'absolute',
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                    zIndex: isSelected || isMultiSelected || draggingNode?.id === person.id ? 20 : 10,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (activePointersRef.current.size >= 1) return;
                    if (linkModeActive) return;
                    lastDragMovedRef.current = false;

                    const isDraggingGroup =
                      multiSelectedSet.has(person.id) && validMultiSelectedIds.length > 1;
                    const groupStartPositions: Record<string, { x: number; y: number }> = {};
                    if (isDraggingGroup) {
                      for (const id of validMultiSelectedIds) {
                        const gn = layout.nodes[id];
                        if (gn) groupStartPositions[id] = { x: gn.x, y: gn.y };
                      }
                    } else {
                      groupStartPositions[person.id] = { x: node.x, y: node.y };
                    }

                    setDraggingNode({
                      id: person.id,
                      dragSessionId: `drag_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      startNodeX: node.x,
                      startNodeY: node.y,
                      groupStartPositions,
                      moved: false,
                    });
                  }}
                  onClick={(e) => handleNodeClick(e, person.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onEditPerson(person.id);
                  }}
                  className={`group relative transition-opacity duration-150 ${
                    isDimmed ? 'opacity-40' : 'opacity-100'
                  }`}
                >
                  {viewMode === 'vertical' ? (
                    /* VERTICAL MODE: Narrower Card, Borderless Square Photo, Extra Symmetric Top/Bottom Padding, -20% Lifespan */
                    <div
                      className={`relative flex h-full flex-col items-center justify-between rounded-lg border bg-white px-2 pt-[15px] pb-[15px] text-center transition-shadow ${
                        isConnectHoverTarget
                          ? 'border-[#8B261D] ring-2 ring-[#8B261D]/45 shadow-md'
                          : isLinkSource || isMultiSelected
                          ? 'border-[#8B261D] ring-2 ring-[#8B261D]/35 shadow-md'
                          : isSelected
                          ? 'border-stone-300 shadow-lg'
                          : matchesSearch
                          ? 'border-[#B45309] ring-2 ring-[#B45309]/30 shadow-sm'
                          : 'border-stone-200/95 hover:border-stone-300 shadow-xs'
                      }`}
                    >
                      {/* Top-right Verification Icon equidistant 5px from top & right edges */}
                      {person.verification !== 'unverified' && (
                        <div className="absolute right-[5px] top-[5px] z-10 flex items-center justify-center rounded-full bg-white/90 leading-none">
                          <VerificationIcon status={person.verification} size={11} />
                        </div>
                      )}

                      {/* Borderless Square Portrait */}
                      <CroppedCircleAvatar
                        photo={photoObj}
                        initials={getPersonInitials(person)}
                        alt={formatShortName(person)}
                        sizeClass="h-[66px] w-[66px]"
                        ringColor={lineageColor}
                        textSizeClass="text-lg"
                        showBorder={false}
                      />

                      {/* Surname & First Name + Lifespan (-20% smaller, slightly lowered) */}
                      <div className="flex w-full min-w-0 flex-col items-center">
                        <div className="w-full font-editorial text-[12.5px] font-normal leading-[1.24] text-[#1C1917] truncate">
                          {cardSurname}
                        </div>
                        <div className="mt-0 w-full font-editorial text-[12.5px] font-normal leading-[1.24] text-[#1C1917] truncate">
                          {person.firstName}
                        </div>
                        {cardLifespan && (
                          <div className="mt-[5px] w-full font-editorial tabular-nums text-[9px] font-normal leading-[1.05] text-stone-600">
                            {cardLifespan}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* HORIZONTAL MODE */
                    <div
                      className={`relative flex h-full items-center gap-2 rounded-lg border bg-white px-[10px] py-[10px] transition-shadow ${
                        isConnectHoverTarget
                          ? 'border-[#8B261D] ring-2 ring-[#8B261D]/40'
                          : isLinkSource || isMultiSelected
                          ? 'border-[#8B261D] ring-2 ring-[#8B261D]/35 shadow-md'
                          : isSelected
                          ? 'border-stone-300 shadow-lg'
                          : 'border-stone-200 hover:border-stone-300 shadow-xs'
                      }`}
                    >
                      {person.verification !== 'unverified' && (
                        <div className="absolute right-[5px] top-[5px] z-10 flex items-center justify-center leading-none">
                          <VerificationIcon status={person.verification} size={11} />
                        </div>
                      )}
                      <CroppedCircleAvatar
                        photo={photoObj}
                        initials={getPersonInitials(person)}
                        alt={formatShortName(person)}
                        sizeClass="h-[54px] w-[54px]"
                        ringColor={lineageColor}
                        textSizeClass="text-base"
                        showBorder={false}
                      />
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="font-editorial text-[12.5px] font-normal leading-[1.24] text-[#1C1917] truncate">
                          {cardSurname}
                        </div>
                        <div className="mt-0 font-editorial text-[12.5px] font-normal leading-[1.24] text-[#1C1917] truncate">
                          {person.firstName}
                        </div>
                        {cardLifespan && (
                          <div className="mt-[4px] font-editorial tabular-nums text-[9px] font-normal leading-none text-stone-600">
                            {cardLifespan}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Drag-to-Connect Handle & Icon-Only Quick Action Strip (visible ONLY after single card click) */}
                  {!linkModeActive && isSelected && !isMultiSelected && (
                    <>
                      <button
                        type="button"
                        onPointerDown={(e) => startDragConnect(e, person.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="Потяните линию к другому родственнику, чтобы связать"
                        aria-label="Связать с другим родственником"
                        className="absolute -right-2.5 top-1/2 -translate-y-1/2 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-[#8B261D] text-white shadow-sm cursor-crosshair"
                      >
                        <Link2 size={10} />
                      </button>

                      <div
                        className="absolute top-full mt-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-stone-200 bg-white px-1.5 py-1 shadow-md"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditPerson(person.id);
                          }}
                          title="Редактировать карточку персоны"
                          aria-label="Редактировать карточку персоны"
                          className="flex h-6 w-6 items-center justify-center rounded-full text-[#8B261D] hover:bg-stone-100 cursor-pointer"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddRelative(person.id, 'parent');
                          }}
                          title="Добавить родителя"
                          aria-label="Добавить родителя"
                          className="flex h-6 w-6 items-center justify-center rounded-full text-stone-700 hover:bg-stone-100 hover:text-[#8B261D] cursor-pointer"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddRelative(person.id, 'spouse');
                          }}
                          title="Добавить супруга / партнёра"
                          aria-label="Добавить супруга / партнёра"
                          className="flex h-6 w-6 items-center justify-center rounded-full text-stone-700 hover:bg-stone-100 hover:text-[#8B261D] cursor-pointer"
                        >
                          <Heart size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddRelative(person.id, 'child');
                          }}
                          title="Добавить ребёнка"
                          aria-label="Добавить ребёнка"
                          className="flex h-6 w-6 items-center justify-center rounded-full text-stone-700 hover:bg-stone-100 hover:text-[#8B261D] cursor-pointer"
                        >
                          <Baby size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddRelative(person.id, 'sibling');
                          }}
                          title="Добавить брата / сестру"
                          aria-label="Добавить брата / сестру"
                          className="flex h-6 w-6 items-center justify-center rounded-full text-stone-700 hover:bg-stone-100 hover:text-[#8B261D] cursor-pointer"
                        >
                          <Users size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Union Edit Popover */}
            {activeUnion && (
              <div
                style={{
                  position: 'absolute',
                  left: activeUnion.hubX,
                  top: activeUnion.hubY + 18,
                  transform: 'translateX(-50%)',
                  zIndex: 35,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="w-80 rounded-lg border border-stone-200 bg-white p-3.5 shadow-lg space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[14.5px] font-semibold text-stone-800">
                    Союз: {tree.persons[activeUnion.union.partnerIds[0]]?.firstName} и{' '}
                    {tree.persons[activeUnion.union.partnerIds[1]]?.firstName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveUnionId(null)}
                    className="text-stone-400 hover:text-stone-700 cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={activeUnion.union.status}
                    onChange={(e) =>
                      onUpdateUnion(activeUnion.union.id, {
                        status: e.target.value as UnionStatus,
                      })
                    }
                    className="rounded border border-stone-200 px-2 py-1 text-[16px] text-stone-800"
                  >
                    <option value="married">Брак</option>
                    <option value="partners">Гражд. союз</option>
                    <option value="divorced">Развод</option>
                    <option value="widowed">Вдовство</option>
                  </select>
                  <input
                    type="text"
                    value={activeUnion.union.marriageDate || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const next = /^\d{4}-\d{1,2}-\d{1,2}$/.test(val.trim())
                        ? normalizeDateInputToRu(val)
                        : val;
                      onUpdateUnion(activeUnion.union.id, { marriageDate: next });
                    }}
                    onBlur={(e) => {
                      const norm = normalizeDateInputToRu(e.target.value);
                      if (norm !== e.target.value) {
                        onUpdateUnion(activeUnion.union.id, { marriageDate: norm });
                      }
                    }}
                    placeholder="дд.мм.гггг"
                    className="rounded border border-stone-200 px-2 py-1 tabular-nums text-[16px] text-stone-800"
                  />
                </div>

                <input
                  type="text"
                  value={activeUnion.union.marriagePlace || ''}
                  onChange={(e) =>
                    onUpdateUnion(activeUnion.union.id, { marriagePlace: e.target.value })
                  }
                  placeholder="Место бракосочетания"
                  className="w-full rounded border border-stone-200 px-2 py-1 text-[16px] text-stone-800"
                />

                <div className="flex items-center justify-between pt-1">
                  <VerificationSelector
                    compact
                    value={activeUnion.union.verification}
                    onChange={(v) => onUpdateUnion(activeUnion.union.id, { verification: v })}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteUnion(activeUnion.union.id);
                      setActiveUnionId(null);
                    }}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-[14.5px] text-[#8B261D] hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Разорвать</span>
                  </button>
                </div>
              </div>
            )}

            {/* Parent-Child Edge Popover */}
            {activeChildEdge && (
              <div
                style={{
                  position: 'absolute',
                  left: (activeChildEdge.parentX + activeChildEdge.childX) / 2,
                  top: (activeChildEdge.parentY + activeChildEdge.childY) / 2,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 35,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="w-72 rounded-lg border border-stone-200 bg-white p-3.5 shadow-lg space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[14.5px] font-semibold text-stone-800">
                    Связь родитель — ребёнок
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveChildLinkId(null)}
                    className="text-stone-400 hover:text-stone-700 cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="text-[14.5px] text-stone-600">
                  {formatShortName(tree.persons[activeChildEdge.link.parentId])} →{' '}
                  {formatShortName(tree.persons[activeChildEdge.link.childId])}
                </div>
                <div className="flex items-center justify-between">
                  <VerificationSelector
                    compact
                    value={activeChildEdge.link.verification}
                    onChange={(v) =>
                      onUpdateParentChild(activeChildEdge.link.id, { verification: v })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteParentChild(activeChildEdge.link.id);
                      setActiveChildLinkId(null);
                    }}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-[14.5px] text-[#8B261D] hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Удалить</span>
                  </button>
                </div>
              </div>
            )}
            {/* Top SVG Overlay Layer for Soft Snapping Alignment & Step Guides (above cards & marriage hubs) */}
            {(snapGuides.horizontalY !== null ||
              snapGuides.verticalX !== null ||
              snapGuides.distanceGuides.length > 0) && (
              <svg
                className="pointer-events-none overflow-visible"
                width={1}
                height={1}
                style={{ position: 'absolute', left: 0, top: 0, zIndex: 25 }}
              >
                {snapGuides.horizontalY !== null && (
                  <line
                    x1={layout.bounds.minX - 400}
                    y1={snapGuides.horizontalY}
                    x2={layout.bounds.maxX + 400}
                    y2={snapGuides.horizontalY}
                    stroke="#8B261D"
                    strokeOpacity={0.45}
                    strokeWidth={1.2}
                    strokeDasharray="5 4"
                  />
                )}
                {snapGuides.verticalX !== null && (
                  <line
                    x1={snapGuides.verticalX}
                    y1={layout.bounds.minY - 400}
                    x2={snapGuides.verticalX}
                    y2={layout.bounds.maxY + 400}
                    stroke="#8B261D"
                    strokeOpacity={0.45}
                    strokeWidth={1.2}
                    strokeDasharray="5 4"
                  />
                )}

                {snapGuides.distanceGuides.map((dg, idx) => {
                  const tick = 5;
                  const overlapsUnionHub = (
                    ax1: number,
                    ay1: number,
                    ax2: number,
                    ay2: number,
                    axis: 'x' | 'y'
                  ) =>
                    layout.unionEdges.some((ue) =>
                      axis === 'x'
                        ? ue.hubX >= Math.min(ax1, ax2) - 22 &&
                          ue.hubX <= Math.max(ax1, ax2) + 22 &&
                          Math.abs(ue.hubY - ay1) < 22
                        : ue.hubY >= Math.min(ay1, ay2) - 22 &&
                          ue.hubY <= Math.max(ay1, ay2) + 22 &&
                          Math.abs(ue.hubX - ax1) < 32
                    );

                  const mainHitsHub = overlapsUnionHub(dg.x1, dg.y1, dg.x2, dg.y2, dg.axis);
                  const mainOffsetX = dg.axis === 'y' && mainHitsHub ? 36 : 0;
                  const mainOffsetY = dg.axis === 'x' && mainHitsHub ? -26 : 0;
                  const gx1 = dg.x1 + mainOffsetX;
                  const gy1 = dg.y1 + mainOffsetY;
                  const gx2 = dg.x2 + mainOffsetX;
                  const gy2 = dg.y2 + mainOffsetY;
                  const midX = (gx1 + gx2) / 2;
                  const midY = (gy1 + gy2) / 2;

                  return (
                    <g key={`dg_${idx}_${dg.axis}`}>
                      {dg.matchedRefs?.map((ref, rIdx) => {
                        const refHitsHub = overlapsUnionHub(
                          ref.x1,
                          ref.y1,
                          ref.x2,
                          ref.y2,
                          dg.axis
                        );
                        const refOx = dg.axis === 'y' && refHitsHub ? 36 : 0;
                        const refOy = dg.axis === 'x' && refHitsHub ? -26 : 0;
                        const rx1 = ref.x1 + refOx;
                        const ry1 = ref.y1 + refOy;
                        const rx2 = ref.x2 + refOx;
                        const ry2 = ref.y2 + refOy;
                        return (
                          <g key={`ref_${rIdx}`}>
                            {refHitsHub && (
                              <>
                                <line
                                  x1={ref.x1}
                                  y1={ref.y1}
                                  x2={rx1}
                                  y2={ry1}
                                  stroke="#8B261D"
                                  strokeOpacity={0.35}
                                  strokeWidth={1}
                                  strokeDasharray="2 2"
                                />
                                <line
                                  x1={ref.x2}
                                  y1={ref.y2}
                                  x2={rx2}
                                  y2={ry2}
                                  stroke="#8B261D"
                                  strokeOpacity={0.35}
                                  strokeWidth={1}
                                  strokeDasharray="2 2"
                                />
                              </>
                            )}
                            <line
                              x1={rx1}
                              y1={ry1}
                              x2={rx2}
                              y2={ry2}
                              stroke="#8B261D"
                              strokeOpacity={0.65}
                              strokeWidth={1.3}
                              strokeDasharray="3 3"
                            />
                            {dg.axis === 'x' ? (
                              <>
                                <line
                                  x1={rx1}
                                  y1={ry1 - tick}
                                  x2={rx1}
                                  y2={ry1 + tick}
                                  stroke="#8B261D"
                                  strokeOpacity={0.65}
                                  strokeWidth={1.3}
                                />
                                <line
                                  x1={rx2}
                                  y1={ry2 - tick}
                                  x2={rx2}
                                  y2={ry2 + tick}
                                  stroke="#8B261D"
                                  strokeOpacity={0.65}
                                  strokeWidth={1.3}
                                />
                              </>
                            ) : (
                              <>
                                <line
                                  x1={rx1 - tick}
                                  y1={ry1}
                                  x2={rx1 + tick}
                                  y2={ry1}
                                  stroke="#8B261D"
                                  strokeOpacity={0.65}
                                  strokeWidth={1.3}
                                />
                                <line
                                  x1={rx2 - tick}
                                  y1={ry2}
                                  x2={rx2 + tick}
                                  y2={ry2}
                                  stroke="#8B261D"
                                  strokeOpacity={0.65}
                                  strokeWidth={1.3}
                                />
                              </>
                            )}
                          </g>
                        );
                      })}
                      {mainHitsHub && (
                        <>
                          <line
                            x1={dg.x1}
                            y1={dg.y1}
                            x2={gx1}
                            y2={gy1}
                            stroke="#8B261D"
                            strokeOpacity={0.45}
                            strokeWidth={1.1}
                            strokeDasharray="2 2"
                          />
                          <line
                            x1={dg.x2}
                            y1={dg.y2}
                            x2={gx2}
                            y2={gy2}
                            stroke="#8B261D"
                            strokeOpacity={0.45}
                            strokeWidth={1.1}
                            strokeDasharray="2 2"
                          />
                        </>
                      )}
                      <line
                        x1={gx1}
                        y1={gy1}
                        x2={gx2}
                        y2={gy2}
                        stroke="#8B261D"
                        strokeOpacity={0.9}
                        strokeWidth={1.5}
                      />
                      {dg.axis === 'x' ? (
                        <>
                          <line
                            x1={gx1}
                            y1={gy1 - tick}
                            x2={gx1}
                            y2={gy1 + tick}
                            stroke="#8B261D"
                            strokeWidth={1.5}
                          />
                          <line
                            x1={gx2}
                            y1={gy2 - tick}
                            x2={gx2}
                            y2={gy2 + tick}
                            stroke="#8B261D"
                            strokeWidth={1.5}
                          />
                        </>
                      ) : (
                        <>
                          <line
                            x1={gx1 - tick}
                            y1={gy1}
                            x2={gx1 + tick}
                            y2={gy1}
                            stroke="#8B261D"
                            strokeWidth={1.5}
                          />
                          <line
                            x1={gx2 - tick}
                            y1={gy2}
                            x2={gx2 + tick}
                            y2={gy2}
                            stroke="#8B261D"
                            strokeWidth={1.5}
                          />
                        </>
                      )}
                      <rect
                        x={midX - 29}
                        y={midY - 9}
                        width={58}
                        height={18}
                        rx={4}
                        fill="#8B261D"
                        stroke="#FBF9F5"
                        strokeWidth={1.5}
                      />
                      <text
                        x={midX}
                        y={midY + 3.5}
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize={10}
                        fontFamily="Georgia, serif"
                      >
                        {dg.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}

            {/* Live Marquee Box Selection Overlay */}
            {selectionBox && (
              <div
                className="pointer-events-none absolute z-30 rounded border border-dashed border-[#8B261D] bg-[#8B261D]/10"
                style={{
                  left: Math.min(selectionBox.startX, selectionBox.currX),
                  top: Math.min(selectionBox.startY, selectionBox.currY),
                  width: Math.abs(selectionBox.currX - selectionBox.startX),
                  height: Math.abs(selectionBox.currY - selectionBox.startY),
                }}
              />
            )}
          </div>
        )}

        {/* Visual Connection Confirmation Modal */}
        {pendingConnection && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/35 p-4"
            onClick={() => setPendingConnection(null)}
          >
            <div
              className="w-full max-w-lg rounded-xl border border-stone-200 bg-[#FBF9F5] p-5 shadow-xl space-y-4 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-editorial text-xl font-semibold text-[#78716C]">
                  Установить родственную связь
                </h3>
                <button
                  type="button"
                  onClick={() => setPendingConnection(null)}
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-4 py-3 text-center text-[15px] text-stone-700">
                <div className="font-semibold text-stone-900">
                  {tree.persons[pendingConnection.sourceId]
                    ? formatFullName(tree.persons[pendingConnection.sourceId])
                    : ''}
                </div>
                <div className="flex items-center justify-center text-stone-400">
                  <ArrowUpDown size={15} />
                </div>
                <div className="font-semibold text-stone-900">
                  {tree.persons[pendingConnection.targetId]
                    ? formatFullName(tree.persons[pendingConnection.targetId])
                    : ''}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[13.5px] font-medium text-stone-600">
                  Характер связи
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {(
                    [
                      {
                        id: 'as_spouse',
                        label: 'Супруги / Партнёры',
                      },
                      {
                        id: 'as_child',
                        label: `${tree.persons[pendingConnection.sourceId]?.firstName} — родитель, ${tree.persons[pendingConnection.targetId]?.firstName} — ребёнок`,
                      },
                      {
                        id: 'as_parent',
                        label: `${tree.persons[pendingConnection.targetId]?.firstName} — родитель, ${tree.persons[pendingConnection.sourceId]?.firstName} — ребёнок`,
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPendingKind(opt.id)}
                      className={`rounded-md border px-3 py-2 text-left text-[14.5px] font-medium transition-colors cursor-pointer ${
                        pendingKind === opt.id
                          ? 'border-[#8B261D] bg-[#8B261D]/5 text-[#8B261D]'
                          : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 border-t border-stone-200/80 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <VerificationSelector value={pendingVerif} onChange={setPendingVerif} />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingConnection(null);
                      setLinkSourceId(null);
                    }}
                    className="rounded-md px-3.5 py-1.5 text-[14.5px] text-stone-600 hover:bg-stone-200/60 cursor-pointer"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onCreateConnection(
                        pendingConnection.sourceId,
                        pendingConnection.targetId,
                        pendingKind,
                        pendingVerif
                      );
                      setPendingConnection(null);
                      setLinkSourceId(null);
                      setLinkModeActive(false);
                    }}
                    className="rounded-md bg-[#8B261D] px-4 py-1.5 text-[14.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
                  >
                    Связать
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Photo Search Lightbox Modal */}
        {photoLightbox && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/85 p-4 sm:p-6"
            onClick={() => {
              setPhotoLightbox(null);
              setLightboxHoveredTagId(null);
            }}
          >
            <div
              className="relative max-h-[90vh] max-w-4xl overflow-y-auto rounded-xl bg-[#FBF9F5] p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setPhotoLightbox(null);
                  setLightboxHoveredTagId(null);
                }}
                aria-label="Закрыть просмотр фотографии"
                className="absolute right-2.5 top-2.5 z-10 rounded-full p-1.5 text-stone-400/75 hover:bg-stone-200/45 hover:text-stone-700 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
              <div className="flex justify-center">
                <PhotoTagFrameLayer
                  src={photoLightbox.photo.dataUrl}
                  alt={photoLightbox.photo.caption || 'Семейное фото'}
                  tags={photoLightbox.photo.tags || []}
                  persons={tree.persons}
                  imgClassName="max-h-[70vh] w-auto rounded object-contain mx-auto block"
                  hoveredTagId={lightboxHoveredTagId}
                  onHoverTagChange={setLightboxHoveredTagId}
                  onTagClick={(pid) => {
                    setPhotoLightbox(null);
                    setLightboxHoveredTagId(null);
                    focusOnPerson(pid);
                  }}
                />
              </div>
              {(photoLightbox.photo.caption || photoLightbox.photo.year) && (
                <div className="mt-3 px-4 text-center space-y-0.5">
                  {photoLightbox.photo.caption && (
                    <div className="font-editorial text-xl italic font-normal text-stone-900">
                      {photoLightbox.photo.caption}
                    </div>
                  )}
                  {photoLightbox.photo.year && (
                    <div className="font-editorial tabular-nums text-base text-stone-500">
                      {photoLightbox.photo.year}
                    </div>
                  )}
                </div>
              )}
              {(photoLightbox.photo.tags || []).length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 px-2">
                  <span className="text-[12.5px] text-stone-500">На фото:</span>
                  {(photoLightbox.photo.tags || []).map((tag) => {
                    const tp = tree.persons[tag.personId];
                    if (!tp) return null;
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onMouseEnter={() => setLightboxHoveredTagId(tag.id)}
                        onMouseLeave={() => setLightboxHoveredTagId(null)}
                        onClick={() => {
                          setPhotoLightbox(null);
                          setLightboxHoveredTagId(null);
                          focusOnPerson(tp.id);
                        }}
                        className={`rounded-full border px-2.5 py-0.5 text-[13px] transition-colors cursor-pointer ${
                          lightboxHoveredTagId === tag.id
                            ? 'border-[#8B261D] bg-[#8B261D]/5 text-[#8B261D]'
                            : 'border-stone-200 bg-white text-stone-800 hover:border-[#8B261D] hover:text-[#8B261D]'
                        }`}
                      >
                        {formatFullName(tp)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  Lock,
  Package,
  X,
} from 'lucide-react';
import { ArchiveView } from './components/ArchiveView';
import { PersonInspector } from './components/PersonInspector';
import { PhotoArchiveView } from './components/PhotoArchiveView';
import { TimelineView } from './components/TimelineView';
import { TopBar } from './components/TopBar';
import { TreeCanvas } from './components/TreeCanvas';
import { WorldMapView } from './components/WorldMapView';
import { createEmptyTree, createSampleTree } from './data/sampleTree';
import {
  AppWorkspaceTab,
  LifeEvent,
  ParentChildLink,
  Person,
  PhotoAttachment,
  PhotoPersonTag,
  TreeDocument,
  TreeViewMode,
  Union,
  VerificationStatus,
} from './types/genealogy';
import type { TagFrameRect } from './components/PhotoTagFrameLayer';
import { createId, derivePatronymic, formatBytes, normalizeTreeDates } from './utils/dateUtils';
import { collectExternalAssetSizes, estimateProjectZipBytes } from './utils/exportImport';
import { GeoPoint, normalizePlaceName } from './utils/geocoding';
import { convertQuotesToGuillemets } from './utils/quoteUtils';
import {
  loadTreeFromLocalBrowser,
  saveTreeToLocalBrowser,
} from './utils/storage';
import { computeTreeLayout, getNodeDimensions, PositionedNode } from './utils/treeLayout';
import { validateTreeLogic } from './utils/treeValidation';
import { getPageHref, getPageTitle, getTabFromLocation } from './utils/routes';
import { APP_VERSION } from './version';

const MAX_UNDO_STEPS = 30;

export default function App() {
  const [history, setHistory] = useState<{
    present: TreeDocument | null;
    past: TreeDocument[];
    future: TreeDocument[];
  }>({ present: null, past: [], future: [] });
  const tree = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const lastCoalesceRef = useRef<{ key: string; at: number } | null>(null);

  const [activeTab, setActiveTabState] = useState<AppWorkspaceTab>(() => getTabFromLocation());
  const [viewMode, setViewMode] = useState<TreeViewMode>('vertical');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [focusPersonRequest, setFocusPersonRequest] = useState<{
    personId: string;
    nonce: number;
  } | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [storageStats, setStorageStats] = useState<{ usage: number; quota: number } | null>(null);
  const [externalAssetSizes, setExternalAssetSizes] = useState<Record<string, number>>({});
  const saveTimerRef = useRef<number | null>(null);

  const setActiveTab = useCallback((nextTab: AppWorkspaceTab) => {
    setActiveTabState(nextTab);
    setValidationOpen(false);
    if (typeof window !== 'undefined') {
      const targetPath = getPageHref(nextTab);
      const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
      if (currentPath !== targetPath || window.location.hash) {
        window.history.pushState({ tab: nextTab }, '', targetPath);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = getPageTitle(activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    const syncFromUrl = () => {
      setActiveTabState(getTabFromLocation());
      setValidationOpen(false);
    };
    window.addEventListener('popstate', syncFromUrl);
    window.addEventListener('hashchange', syncFromUrl);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
      window.removeEventListener('hashchange', syncFromUrl);
    };
  }, []);

  const refreshStorageEstimate = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
    try {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number' && typeof est.quota === 'number') {
        setStorageStats({ usage: est.usage, quota: est.quota });
      }
    } catch {
      // Ignore storage estimate unavailability
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    loadTreeFromLocalBrowser().then((loaded) => {
      if (!mounted) return;
      const initial = loaded || createSampleTree();
      setHistory({ present: initial, past: [], future: [] });
      refreshStorageEstimate();
    });
    return () => {
      mounted = false;
    };
  }, [refreshStorageEstimate]);

  useEffect(() => {
    if (!tree) return;
    let active = true;
    collectExternalAssetSizes(tree).then((sizes) => {
      if (active && Object.keys(sizes).length > 0) {
        setExternalAssetSizes(sizes);
      }
    });
    return () => {
      active = false;
    };
  }, [tree]);

  useEffect(() => {
    if (!tree) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      await saveTreeToLocalBrowser(tree);
      refreshStorageEstimate();
    }, 220);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [refreshStorageEstimate, tree]);

  useEffect(() => {
    if (!tree) return;
    setSelectedPersonId((curr) => (curr && !tree.persons[curr] ? null : curr));
    setEditingPersonId((curr) => (curr && !tree.persons[curr] ? null : curr));
  }, [tree]);

  useEffect(() => {
    const handleGlobalQuoteInput = (e: Event) => {
      if ((e as InputEvent).isComposing) return;
      const target = e.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return;
      }
      if (target instanceof HTMLInputElement) {
        const type = (target.type || 'text').toLowerCase();
        if (type !== 'text' && type !== 'search' && type !== 'url' && type !== 'email') {
          return;
        }
      }
      const raw = target.value;
      if (!/[""“”„‟]/.test(raw)) return;
      const converted = convertQuotesToGuillemets(raw);
      if (converted === raw) return;

      const start = target.selectionStart;
      const end = target.selectionEnd;
      target.value = converted;
      if (start !== null && end !== null) {
        try {
          target.setSelectionRange(start, end);
        } catch {
          // Ignore unsupported selection range
        }
      }
    };

    document.addEventListener('input', handleGlobalQuoteInput, true);
    return () => document.removeEventListener('input', handleGlobalQuoteInput, true);
  }, []);

  const updateTree = useCallback(
    (
      updater: (prev: TreeDocument) => TreeDocument,
      options?: { coalesceKey?: string; coalesceWindowMs?: number }
    ) => {
      const now = Date.now();
      const key = options?.coalesceKey;
      const windowMs = options?.coalesceWindowMs;
      const isCoalescing = Boolean(
        key &&
          lastCoalesceRef.current &&
          lastCoalesceRef.current.key === key &&
          (windowMs === undefined || now - lastCoalesceRef.current.at <= windowMs)
      );
      lastCoalesceRef.current = key ? { key, at: now } : null;

      setHistory((curr) => {
        if (!curr.present) return curr;
        const next = updater(curr.present);
        if (next === curr.present) return curr;
        if (isCoalescing) {
          return { ...curr, present: next, future: [] };
        }
        const nextPast =
          curr.past.length >= MAX_UNDO_STEPS
            ? [...curr.past.slice(curr.past.length - MAX_UNDO_STEPS + 1), curr.present]
            : [...curr.past, curr.present];
        return { present: next, past: nextPast, future: [] };
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    lastCoalesceRef.current = null;
    setHistory((curr) => {
      if (curr.past.length === 0 || !curr.present) return curr;
      const previous = curr.past[curr.past.length - 1];
      const nextFuture =
        curr.future.length >= MAX_UNDO_STEPS
          ? [...curr.future.slice(curr.future.length - MAX_UNDO_STEPS + 1), curr.present]
          : [...curr.future, curr.present];
      return {
        present: previous,
        past: curr.past.slice(0, curr.past.length - 1),
        future: nextFuture,
      };
    });
  }, []);

  const handleRedo = useCallback(() => {
    lastCoalesceRef.current = null;
    setHistory((curr) => {
      if (curr.future.length === 0 || !curr.present) return curr;
      const next = curr.future[curr.future.length - 1];
      const nextPast =
        curr.past.length >= MAX_UNDO_STEPS
          ? [...curr.past.slice(curr.past.length - MAX_UNDO_STEPS + 1), curr.present]
          : [...curr.past, curr.present];
      return {
        present: next,
        past: nextPast,
        future: curr.future.slice(0, curr.future.length - 1),
      };
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const keyLower = e.key.toLowerCase();
      const isZ = keyLower === 'z' || e.code === 'KeyZ';
      const isY = keyLower === 'y' || e.code === 'KeyY';

      if (isZ && !e.shiftKey) {
        if (!canUndo) return;
        e.preventDefault();
        handleUndo();
      } else if ((isZ && e.shiftKey) || (isY && !e.shiftKey)) {
        if (!canRedo) return;
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canRedo, canUndo, handleRedo, handleUndo]);

  const handleUpdatePerson = useCallback(
    (personId: string, patch: Partial<Person>) => {
      const isDiscrete =
        'photos' in patch ||
        'events' in patch ||
        'lineageColor' in patch ||
        'gender' in patch ||
        'isLiving' in patch ||
        'verification' in patch;
      updateTree(
        (prev) => {
          const existing = prev.persons[personId];
          if (!existing) return prev;
          return {
            ...prev,
            persons: {
              ...prev.persons,
              [personId]: { ...existing, ...patch },
            },
          };
        },
        isDiscrete
          ? undefined
          : { coalesceKey: `person_edit_${personId}`, coalesceWindowMs: 1200 }
      );
    },
    [updateTree]
  );

  const handleDeletePersons = useCallback(
    (personIds: string[]) => {
      const idSet = new Set(personIds);
      if (idSet.size === 0) return;
      updateTree((prev) => {
        const nextPersons: Record<string, Person> = {};
        for (const [pid, p] of Object.entries(prev.persons)) {
          if (idSet.has(pid)) continue;
          const hasTaggedPhoto = p.photos.some((ph) =>
            ph.tags?.some((t) => idSet.has(t.personId))
          );
          nextPersons[pid] = hasTaggedPhoto
            ? {
                ...p,
                photos: p.photos.map((ph) =>
                  ph.tags
                    ? { ...ph, tags: ph.tags.filter((t) => !idSet.has(t.personId)) }
                    : ph
                ),
              }
            : p;
        }
        const nextArchivePhotos = (prev.archivePhotos || []).map((ph) =>
          ph.tags
            ? { ...ph, tags: ph.tags.filter((t) => !idSet.has(t.personId)) }
            : ph
        );
        return {
          ...prev,
          persons: nextPersons,
          unions: prev.unions.filter((u) => !u.partnerIds.some((id) => idSet.has(id))),
          parentChildLinks: prev.parentChildLinks.filter(
            (l) => !idSet.has(l.parentId) && !idSet.has(l.childId)
          ),
          archivePhotos: nextArchivePhotos,
        };
      });
      setSelectedPersonId((curr) => (curr && idSet.has(curr) ? null : curr));
      setEditingPersonId((curr) => (curr && idSet.has(curr) ? null : curr));
    },
    [updateTree]
  );

  const handleDeletePerson = useCallback(
    (personId: string) => {
      handleDeletePersons([personId]);
    },
    [handleDeletePersons]
  );

  const handleAddStandalonePerson = useCallback(() => {
    const newId = createId('p');
    const newPerson: Person = {
      id: newId,
      firstName: 'Новый',
      lastName: 'Родственник',
      gender: 'male',
      isLiving: true,
      notes: '',
      verification: 'possible',
      events: [],
      photos: [],
    };
    updateTree((prev) => ({
      ...prev,
      persons: { ...prev.persons, [newId]: newPerson },
    }));
    setActiveTab('tree');
    setSelectedPersonId(newId);
    setEditingPersonId(newId);
  }, [updateTree]);

  const handleAddRelative = useCallback(
    (sourceId: string, kind: 'parent' | 'child' | 'spouse' | 'sibling') => {
      const newId = createId('p');
      updateTree((prev) => {
        const source = prev.persons[sourceId];
        if (!source) return prev;

        const dimV = getNodeDimensions('vertical');
        const dimH = getNodeDimensions('horizontal');
        const layoutV = computeTreeLayout(prev, 'vertical');
        const layoutH = computeTreeLayout(prev, 'horizontal');

        const findFreeSlot = (
          allNodes: PositionedNode[],
          idealX: number,
          idealY: number,
          dim: { width: number; height: number },
          axis: 'x' | 'y',
          gap = 40
        ): { x: number; y: number } => {
          const overlaps = (cx: number, cy: number) =>
            allNodes.some(
              (n) =>
                cx < n.x + n.width + 8 &&
                cx + dim.width + 8 > n.x &&
                cy < n.y + n.height + 8 &&
                cy + dim.height + 8 > n.y
            );

          const rx = Math.round(idealX);
          const ry = Math.round(idealY);
          if (!overlaps(rx, ry)) return { x: rx, y: ry };

          const candidates: number[] = [];
          if (axis === 'x') {
            const bandNodes = allNodes.filter(
              (n) => ry < n.y + n.height + 8 && ry + dim.height + 8 > n.y
            );
            for (const bn of bandNodes) {
              candidates.push(Math.round(bn.x + bn.width + gap));
              candidates.push(Math.round(bn.x - dim.width - gap));
            }
            candidates.sort((a, b) => {
              const da = Math.abs(a - rx);
              const db = Math.abs(b - rx);
              if (da !== db) return da - db;
              return b - a; // prefer right side on tie
            });
            for (const cx of candidates) {
              if (!overlaps(cx, ry)) return { x: cx, y: ry };
            }
            return { x: rx + dim.width + gap, y: ry };
          } else {
            const bandNodes = allNodes.filter(
              (n) => rx < n.x + n.width + 8 && rx + dim.width + 8 > n.x
            );
            for (const bn of bandNodes) {
              candidates.push(Math.round(bn.y + bn.height + gap));
              candidates.push(Math.round(bn.y - dim.height - gap));
            }
            candidates.sort((a, b) => {
              const da = Math.abs(a - ry);
              const db = Math.abs(b - ry);
              if (da !== db) return da - db;
              return b - a; // prefer below on tie
            });
            for (const cy of candidates) {
              if (!overlaps(rx, cy)) return { x: rx, y: cy };
            }
            return { x: rx, y: ry + dim.height + gap };
          }
        };

        const anyCustomInTree = Object.values(prev.persons).some((p) =>
          Boolean(p.customPositions || p.customPos)
        );

        let customPositions: Person['customPositions'];

        if (kind === 'child') {
          const sourceUnions = prev.unions.filter((u) => u.partnerIds.includes(sourceId));
          const parentIds = [sourceId];
          if (sourceUnions.length === 1) {
            const partnerId =
              sourceUnions[0].partnerIds[0] === sourceId
                ? sourceUnions[0].partnerIds[1]
                : sourceUnions[0].partnerIds[0];
            if (prev.persons[partnerId]) parentIds.push(partnerId);
          }

          const pNodesV = parentIds.map((id) => layoutV.nodes[id]).filter(Boolean);
          const pNodesH = parentIds.map((id) => layoutH.nodes[id]).filter(Boolean);

          const vParentBottom =
            pNodesV.length > 0 ? Math.max(...pNodesV.map((n) => n.y + n.height)) : 0;
          const vCenterX =
            pNodesV.length > 0
              ? pNodesV.reduce((s, n) => s + n.x + n.width / 2, 0) / pNodesV.length
              : 0;
          const posV = findFreeSlot(
            Object.values(layoutV.nodes),
            vCenterX - dimV.width / 2,
            vParentBottom + 40,
            dimV,
            'x',
            40
          );

          const hParentRight =
            pNodesH.length > 0 ? Math.max(...pNodesH.map((n) => n.x + n.width)) : 0;
          const hCenterY =
            pNodesH.length > 0
              ? pNodesH.reduce((s, n) => s + n.y + n.height / 2, 0) / pNodesH.length
              : 0;
          const posH = findFreeSlot(
            Object.values(layoutH.nodes),
            hParentRight + 40,
            hCenterY - dimH.height / 2,
            dimH,
            'y',
            40
          );

          customPositions = { vertical: posV, horizontal: posH };
        } else if (anyCustomInTree) {
          const srcV = layoutV.nodes[sourceId];
          const srcH = layoutH.nodes[sourceId];
          if (srcV && srcH) {
            if (kind === 'spouse' || kind === 'sibling') {
              customPositions = {
                vertical: findFreeSlot(
                  Object.values(layoutV.nodes),
                  srcV.x + srcV.width + 40,
                  srcV.y,
                  dimV,
                  'x',
                  40
                ),
                horizontal: findFreeSlot(
                  Object.values(layoutH.nodes),
                  srcH.x,
                  srcH.y + srcH.height + 40,
                  dimH,
                  'y',
                  40
                ),
              };
            } else if (kind === 'parent') {
              customPositions = {
                vertical: findFreeSlot(
                  Object.values(layoutV.nodes),
                  srcV.x,
                  srcV.y - dimV.height - 40,
                  dimV,
                  'x',
                  40
                ),
                horizontal: findFreeSlot(
                  Object.values(layoutH.nodes),
                  srcH.x - dimH.width - 40,
                  srcH.y,
                  dimH,
                  'y',
                  40
                ),
              };
            }
          }
        }

        const defaultGender: 'male' | 'female' =
          kind === 'spouse'
            ? source.gender === 'male'
              ? 'female'
              : 'male'
            : 'male';

        let defaultMiddleName: string | undefined;
        if (kind === 'child') {
          const sourceUnions = prev.unions.filter((u) => u.partnerIds.includes(sourceId));
          const candidateParentIds = [sourceId];
          if (sourceUnions.length === 1) {
            const partnerId =
              sourceUnions[0].partnerIds[0] === sourceId
                ? sourceUnions[0].partnerIds[1]
                : sourceUnions[0].partnerIds[0];
            if (prev.persons[partnerId]) candidateParentIds.push(partnerId);
          }
          const father = candidateParentIds
            .map((pid) => prev.persons[pid])
            .find((p) => p && p.gender === 'male');
          if (father) {
            defaultMiddleName = derivePatronymic(father.firstName, defaultGender) || undefined;
          }
        } else if (kind === 'sibling') {
          const existingParentIds = prev.parentChildLinks
            .filter((l) => l.childId === sourceId)
            .map((l) => l.parentId);
          const father = existingParentIds
            .map((pid) => prev.persons[pid])
            .find((p) => p && p.gender === 'male');
          if (father) {
            defaultMiddleName = derivePatronymic(father.firstName, defaultGender) || undefined;
          }
        }

        const newPerson: Person = {
          id: newId,
          firstName:
            kind === 'parent'
              ? 'Родитель'
              : kind === 'spouse'
              ? 'Супруг(а)'
              : kind === 'child'
              ? 'Ребёнок'
              : 'Брат / Сестра',
          middleName: defaultMiddleName,
          lastName: kind === 'spouse' ? '' : source.lastName,
          gender: defaultGender,
          isLiving: kind === 'child' || kind === 'sibling',
          notes: '',
          verification: 'possible',
          events: [],
          photos: [],
          customPositions,
        };

        const nextPersons = { ...prev.persons, [newId]: newPerson };
        const nextUnions = [...prev.unions];
        const nextLinks = [...prev.parentChildLinks];

        if (kind === 'spouse') {
          nextUnions.push({
            id: createId('u'),
            partnerIds: [sourceId, newId],
            status: 'married',
            verification: 'confirmed',
          });
        } else if (kind === 'child') {
          nextLinks.push({
            id: createId('pc'),
            parentId: sourceId,
            childId: newId,
            relationType: 'biological',
            verification: 'confirmed',
          });
          const sourceUnions = prev.unions.filter((u) => u.partnerIds.includes(sourceId));
          if (sourceUnions.length === 1) {
            const partnerId =
              sourceUnions[0].partnerIds[0] === sourceId
                ? sourceUnions[0].partnerIds[1]
                : sourceUnions[0].partnerIds[0];
            if (prev.persons[partnerId]) {
              nextLinks.push({
                id: createId('pc'),
                parentId: partnerId,
                childId: newId,
                relationType: 'biological',
                verification: 'confirmed',
              });
            }
          }
        } else if (kind === 'parent') {
          const existingParents = prev.parentChildLinks
            .filter((l) => l.childId === sourceId)
            .map((l) => l.parentId);
          nextLinks.push({
            id: createId('pc'),
            parentId: newId,
            childId: sourceId,
            relationType: 'biological',
            verification: 'confirmed',
          });
          if (existingParents.length === 1) {
            const otherParentId = existingParents[0];
            const unionExists = prev.unions.some(
              (u) => u.partnerIds.includes(otherParentId) && u.partnerIds.includes(newId)
            );
            if (!unionExists && prev.persons[otherParentId]) {
              nextUnions.push({
                id: createId('u'),
                partnerIds: [otherParentId, newId],
                status: 'married',
                verification: 'confirmed',
              });
            }
          }
        } else if (kind === 'sibling') {
          const existingParents = prev.parentChildLinks
            .filter((l) => l.childId === sourceId)
            .map((l) => l.parentId);
          if (existingParents.length > 0) {
            for (const pid of existingParents) {
              nextLinks.push({
                id: createId('pc'),
                parentId: pid,
                childId: newId,
                relationType: 'biological',
                verification: 'confirmed',
              });
            }
          } else {
            const sharedParentId = createId('p');
            const srcV = layoutV.nodes[sourceId];
            const srcH = layoutH.nodes[sourceId];
            const sharedPos: Person['customPositions'] =
              anyCustomInTree && srcV && srcH
                ? {
                    vertical: findFreeSlot(
                      Object.values(layoutV.nodes),
                      srcV.x,
                      srcV.y - dimV.height - 40,
                      dimV,
                      'x',
                      40
                    ),
                    horizontal: findFreeSlot(
                      Object.values(layoutH.nodes),
                      srcH.x - dimH.width - 40,
                      srcH.y,
                      dimH,
                      'y',
                      40
                    ),
                  }
                : undefined;
            nextPersons[sharedParentId] = {
              id: sharedParentId,
              firstName: 'Общий родитель',
              lastName: source.lastName,
              gender: 'male',
              notes: '',
              verification: 'possible',
              events: [],
              photos: [],
              customPositions: sharedPos,
            };
            nextLinks.push(
              {
                id: createId('pc'),
                parentId: sharedParentId,
                childId: sourceId,
                relationType: 'biological',
                verification: 'possible',
              },
              {
                id: createId('pc'),
                parentId: sharedParentId,
                childId: newId,
                relationType: 'biological',
                verification: 'possible',
              }
            );
          }
        }

        return {
          ...prev,
          persons: nextPersons,
          unions: nextUnions,
          parentChildLinks: nextLinks,
        };
      });
      setSelectedPersonId(newId);
      setEditingPersonId((curr) => (curr ? newId : curr));
    },
    [updateTree]
  );

  const handleCreateConnection = useCallback(
    (
      sourceId: string,
      targetId: string,
      kind: 'as_parent' | 'as_child' | 'as_spouse',
      verification: VerificationStatus
    ) => {
      if (sourceId === targetId) return;
      updateTree((prev) => {
        if (!prev.persons[sourceId] || !prev.persons[targetId]) return prev;

        if (kind === 'as_spouse') {
          const exists = prev.unions.some(
            (u) => u.partnerIds.includes(sourceId) && u.partnerIds.includes(targetId)
          );
          if (exists) return prev;
          return {
            ...prev,
            unions: [
              ...prev.unions,
              {
                id: createId('u'),
                partnerIds: [sourceId, targetId],
                status: 'married',
                verification,
              },
            ],
          };
        }

        const parentId = kind === 'as_child' ? sourceId : targetId;
        const childId = kind === 'as_child' ? targetId : sourceId;
        const exists = prev.parentChildLinks.some(
          (l) => l.parentId === parentId && l.childId === childId
        );
        if (exists) return prev;

        const parentPerson = prev.persons[parentId];
        const childPerson = prev.persons[childId];
        let nextPersons = prev.persons;
        if (
          parentPerson &&
          childPerson &&
          parentPerson.gender === 'male' &&
          !(childPerson.middleName && childPerson.middleName.trim())
        ) {
          const derived = derivePatronymic(parentPerson.firstName, childPerson.gender);
          if (derived) {
            nextPersons = {
              ...prev.persons,
              [childId]: {
                ...childPerson,
                middleName: derived,
              },
            };
          }
        }

        return {
          ...prev,
          persons: nextPersons,
          parentChildLinks: [
            ...prev.parentChildLinks,
            {
              id: createId('pc'),
              parentId,
              childId,
              relationType: 'biological',
              verification,
            },
          ],
        };
      });
    },
    [updateTree]
  );

  const handleUpdateUnion = useCallback(
    (unionId: string, patch: Partial<Union>) => {
      updateTree((prev) => ({
        ...prev,
        unions: prev.unions.map((u) => (u.id === unionId ? { ...u, ...patch } : u)),
      }));
    },
    [updateTree]
  );

  const handleDeleteUnion = useCallback(
    (unionId: string) => {
      updateTree((prev) => ({
        ...prev,
        unions: prev.unions.filter((u) => u.id !== unionId),
      }));
    },
    [updateTree]
  );

  const handleUpdateParentChild = useCallback(
    (linkId: string, patch: Partial<ParentChildLink>) => {
      updateTree((prev) => ({
        ...prev,
        parentChildLinks: prev.parentChildLinks.map((l) =>
          l.id === linkId ? { ...l, ...patch } : l
        ),
      }));
    },
    [updateTree]
  );

  const handleDeleteParentChild = useCallback(
    (linkId: string) => {
      updateTree((prev) => ({
        ...prev,
        parentChildLinks: prev.parentChildLinks.filter((l) => l.id !== linkId),
      }));
    },
    [updateTree]
  );

  const handleMovePersons = useCallback(
    (
      moves: Array<{ personId: string; pos: { x: number; y: number } }>,
      mode: TreeViewMode,
      coalesceKey?: string
    ) => {
      if (moves.length === 0) return;
      updateTree(
        (prev) => {
          let changed = false;
          const nextPersons = { ...prev.persons };
          for (const { personId, pos } of moves) {
            const existing = nextPersons[personId];
            if (!existing) continue;
            const basePositions = existing.customPositions
              ? { ...existing.customPositions }
              : existing.customPos
              ? { vertical: existing.customPos }
              : {};
            basePositions[mode] = pos;
            nextPersons[personId] = {
              ...existing,
              customPositions: basePositions,
              customPos: undefined,
            };
            changed = true;
          }
          return changed ? { ...prev, persons: nextPersons } : prev;
        },
        coalesceKey ? { coalesceKey } : undefined
      );
    },
    [updateTree]
  );

  const handleMovePerson = useCallback(
    (
      personId: string,
      pos: { x: number; y: number },
      mode: TreeViewMode,
      coalesceKey?: string
    ) => {
      handleMovePersons([{ personId, pos }], mode, coalesceKey);
    },
    [handleMovePersons]
  );

  const handleResetPositions = useCallback(
    (mode: TreeViewMode) => {
      updateTree((prev) => {
        const nextPersons: Record<string, Person> = {};
        for (const [id, p] of Object.entries(prev.persons)) {
          const nextMap = p.customPositions ? { ...p.customPositions } : undefined;
          if (nextMap) {
            delete nextMap[mode];
          }
          nextPersons[id] = {
            ...p,
            customPositions: nextMap && Object.keys(nextMap).length > 0 ? nextMap : undefined,
            customPos: mode === 'vertical' ? undefined : p.customPos,
          };
        }
        return { ...prev, persons: nextPersons };
      });
    },
    [updateTree]
  );

  const handleAddPersonEvent = useCallback(
    (personId: string, event: LifeEvent) => {
      updateTree((prev) => {
        const person = prev.persons[personId];
        if (!person) return prev;
        return {
          ...prev,
          persons: {
            ...prev.persons,
            [personId]: {
              ...person,
              events: [...person.events, event],
            },
          },
        };
      });
    },
    [updateTree]
  );

  const handleSavePlaceCoords = useCallback(
    (placeKey: string, coords: GeoPoint) => {
      updateTree((prev) => ({
        ...prev,
        placeCoords: {
          ...(prev.placeCoords || {}),
          [placeKey]: coords,
        },
      }));
    },
    [updateTree]
  );

  const handleUpdatePlaceAddress = useCallback(
    (oldPlace: string, newPlace: string, newCoords?: GeoPoint | null) => {
      const oldNorm = normalizePlaceName(oldPlace);
      const trimmedNew = convertQuotesToGuillemets(newPlace.trim());
      const newNorm = normalizePlaceName(trimmedNew);
      if (!oldNorm || !trimmedNew || !newNorm) return;

      updateTree((prev) => {
        let changedPersons = false;
        const nextPersons: Record<string, Person> = {};
        for (const [id, p] of Object.entries(prev.persons)) {
          let nextP = p;
          let dirty = false;

          if (p.birthPlace && normalizePlaceName(p.birthPlace) === oldNorm) {
            nextP = { ...nextP, birthPlace: trimmedNew };
            dirty = true;
          }
          if (p.deathPlace && normalizePlaceName(p.deathPlace) === oldNorm) {
            nextP = { ...nextP, deathPlace: trimmedNew };
            dirty = true;
          }
          if (p.events.some((ev) => ev.place && normalizePlaceName(ev.place) === oldNorm)) {
            nextP = {
              ...nextP,
              events: p.events.map((ev) =>
                ev.place && normalizePlaceName(ev.place) === oldNorm
                  ? { ...ev, place: trimmedNew }
                  : ev
              ),
            };
            dirty = true;
          }

          if (dirty) changedPersons = true;
          nextPersons[id] = nextP;
        }

        let changedUnions = false;
        const nextUnions = prev.unions.map((u) => {
          if (u.marriagePlace && normalizePlaceName(u.marriagePlace) === oldNorm) {
            changedUnions = true;
            return { ...u, marriagePlace: trimmedNew };
          }
          return u;
        });

        const nextPlaceCoords = { ...(prev.placeCoords || {}) };
        const prevOldCoord = nextPlaceCoords[oldNorm];
        if (oldNorm !== newNorm) {
          delete nextPlaceCoords[oldNorm];
        }
        if (newCoords === null) {
          delete nextPlaceCoords[newNorm];
        } else if (newCoords) {
          nextPlaceCoords[newNorm] = newCoords;
        } else if (oldNorm !== newNorm && prevOldCoord && !nextPlaceCoords[newNorm]) {
          nextPlaceCoords[newNorm] = prevOldCoord;
        }

        return {
          ...prev,
          persons: changedPersons ? nextPersons : prev.persons,
          unions: changedUnions ? nextUnions : prev.unions,
          placeCoords: nextPlaceCoords,
        };
      });
    },
    [updateTree]
  );

  const handleUpdateArchivePhotos = useCallback(
    (updater: (curr: PhotoAttachment[]) => PhotoAttachment[]) => {
      updateTree((prev) => ({
        ...prev,
        archivePhotos: updater(prev.archivePhotos || []),
      }));
    },
    [updateTree]
  );

  const handleSavePersonCroppedPhoto = useCallback(
    (
      personId: string,
      originalDataUrl: string,
      updatedPhoto: PhotoAttachment,
      tagFrame?: TagFrameRect
    ) => {
      updateTree((prev) => {
        const targetPerson = prev.persons[personId];
        if (!targetPerson) return prev;

        const matchUrls = new Set<string>(
          [originalDataUrl, updatedPhoto.dataUrl].filter(Boolean)
        );
        const tagByPerson = new Map<string, PhotoPersonTag>();
        const collectTags = (tags?: PhotoPersonTag[]) => {
          for (const t of tags || []) {
            tagByPerson.set(t.personId, { ...t });
          }
        };

        for (const archPh of prev.archivePhotos || []) {
          if (matchUrls.has(archPh.dataUrl)) collectTags(archPh.tags);
        }
        for (const p of Object.values(prev.persons)) {
          for (const ph of p.photos) {
            if (matchUrls.has(ph.dataUrl)) collectTags(ph.tags);
          }
        }
        collectTags(updatedPhoto.tags);

        if (tagFrame) {
          tagByPerson.set(personId, {
            id: createId('tag'),
            personId,
            x: tagFrame.x,
            y: tagFrame.y,
            w: tagFrame.w,
            h: tagFrame.h,
          });
        }

        const mergedTags = Array.from(tagByPerson.values());
        const nextPersons: Record<string, Person> = {};

        for (const [pid, p] of Object.entries(prev.persons)) {
          if (pid === personId) {
            nextPersons[pid] = {
              ...p,
              photos: p.photos.map((ph) =>
                ph.id === updatedPhoto.id
                  ? { ...updatedPhoto, tags: mergedTags.map((t) => ({ ...t })) }
                  : matchUrls.has(ph.dataUrl)
                  ? { ...ph, tags: mergedTags.map((t) => ({ ...t })) }
                  : ph
              ),
            };
          } else {
            let changed = false;
            const mappedPhotos = p.photos.map((ph) => {
              if (!matchUrls.has(ph.dataUrl)) return ph;
              changed = true;
              return { ...ph, tags: mergedTags.map((t) => ({ ...t })) };
            });
            nextPersons[pid] = changed ? { ...p, photos: mappedPhotos } : p;
          }
        }

        const nextArchivePhotos = (prev.archivePhotos || []).map((ph) =>
          matchUrls.has(ph.dataUrl)
            ? { ...ph, tags: mergedTags.map((t) => ({ ...t })) }
            : ph
        );

        return {
          ...prev,
          persons: nextPersons,
          archivePhotos: nextArchivePhotos,
        };
      });
    },
    [updateTree]
  );

  const handleUpdateSharedPhoto = useCallback(
    (dataUrl: string, patch: Partial<PhotoAttachment>) => {
      if (!dataUrl) return;
      updateTree((prev) => {
        const nextPersons: Record<string, Person> = {};
        for (const [pid, p] of Object.entries(prev.persons)) {
          let changed = false;
          const nextPhotos = p.photos.map((ph) => {
            if (ph.dataUrl !== dataUrl) return ph;
            changed = true;
            return { ...ph, ...patch };
          });
          nextPersons[pid] = changed ? { ...p, photos: nextPhotos } : p;
        }
        const nextArchivePhotos = (prev.archivePhotos || []).map((ph) =>
          ph.dataUrl === dataUrl ? { ...ph, ...patch } : ph
        );
        return {
          ...prev,
          persons: nextPersons,
          archivePhotos: nextArchivePhotos,
        };
      });
    },
    [updateTree]
  );

  const handleDeleteSharedPhoto = useCallback(
    (dataUrl: string) => {
      if (!dataUrl) return;
      updateTree((prev) => {
        const nextPersons: Record<string, Person> = {};
        for (const [pid, p] of Object.entries(prev.persons)) {
          const filtered = p.photos.filter((ph) => ph.dataUrl !== dataUrl);
          if (filtered.length !== p.photos.length) {
            if (filtered.length > 0 && !filtered.some((ph) => ph.isPrimary)) {
              filtered[0] = { ...filtered[0], isPrimary: true };
            }
            nextPersons[pid] = { ...p, photos: filtered };
          } else {
            nextPersons[pid] = p;
          }
        }
        const nextArchivePhotos = (prev.archivePhotos || []).filter(
          (ph) => ph.dataUrl !== dataUrl
        );
        return {
          ...prev,
          persons: nextPersons,
          archivePhotos: nextArchivePhotos,
        };
      });
    },
    [updateTree]
  );

  const handleReplaceTree = useCallback(
    (next: TreeDocument) => {
      const normalized = normalizeTreeDates(next).tree;
      updateTree(() => normalized);
      setSelectedPersonId(null);
      setEditingPersonId(null);
      setActiveTab('tree');
    },
    [updateTree]
  );

  const handleMergeTree = useCallback(
    (incoming: TreeDocument) => {
      const normalizedIncoming = normalizeTreeDates(incoming).tree;
      updateTree((prev) => {
        const idMap: Record<string, string> = {};
        const mergedPersons = { ...prev.persons };
        for (const [oldId, p] of Object.entries(normalizedIncoming.persons)) {
          const freshId = createId('p');
          idMap[oldId] = freshId;
          mergedPersons[freshId] = {
            ...p,
            id: freshId,
            customPos: undefined,
            customPositions: undefined,
          };
        }
        const mergedUnions = [
          ...prev.unions,
          ...normalizedIncoming.unions
            .filter((u) => idMap[u.partnerIds[0]] && idMap[u.partnerIds[1]])
            .map((u) => ({
              ...u,
              id: createId('u'),
              partnerIds: [idMap[u.partnerIds[0]], idMap[u.partnerIds[1]]] as [string, string],
            })),
        ];
        const mergedLinks = [
          ...prev.parentChildLinks,
          ...normalizedIncoming.parentChildLinks
            .filter((l) => idMap[l.parentId] && idMap[l.childId])
            .map((l) => ({
              ...l,
              id: createId('pc'),
              parentId: idMap[l.parentId],
              childId: idMap[l.childId],
            })),
        ];
        const mergedArchivePhotos = [
          ...(prev.archivePhotos || []),
          ...(normalizedIncoming.archivePhotos || []).map((ph) => ({
            ...ph,
            id: createId('arch'),
            tags: (ph.tags || [])
              .filter((t) => Boolean(idMap[t.personId]))
              .map((t) => ({ ...t, id: createId('tag'), personId: idMap[t.personId] })),
          })),
        ];
        return {
          ...prev,
          persons: mergedPersons,
          unions: mergedUnions,
          parentChildLinks: mergedLinks,
          archivePhotos: mergedArchivePhotos,
        };
      });
      setActiveTab('tree');
    },
    [updateTree]
  );

  const validationIssues = useMemo(() => (tree ? validateTreeLogic(tree) : []), [tree]);
  const zipStats = useMemo(
    () => (tree ? estimateProjectZipBytes(tree, externalAssetSizes) : { zipBytes: 0, rawBytes: 0 }),
    [externalAssetSizes, tree]
  );

  if (!tree) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FBF9F5] text-stone-600">
        <span className="font-editorial text-xl">Открытие семейного архива...</span>
      </div>
    );
  }

  const editingPerson = editingPersonId ? tree.persons[editingPersonId] || null : null;
  const personCount = Object.keys(tree.persons).length;
  const errorIssues = validationIssues.filter((i) => i.severity === 'error');
  const warningIssues = validationIssues.filter((i) => i.severity !== 'error');
  const storagePct =
    storageStats && storageStats.quota > 0
      ? Math.min(100, (storageStats.usage / storageStats.quota) * 100)
      : 0;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#FBF9F5] text-[#1C1917]">
      <TopBar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="flex flex-1 overflow-hidden">
        {activeTab === 'tree' && (
          <TreeCanvas
            tree={tree}
            viewMode={viewMode}
            selectedPersonId={selectedPersonId}
            editingPersonOpen={Boolean(editingPerson)}
            focusPersonRequest={focusPersonRequest}
            onViewModeChange={setViewMode}
            onSelectPerson={setSelectedPersonId}
            onEditPerson={(id) => {
              setSelectedPersonId(id);
              setEditingPersonId(id);
            }}
            onDeletePersons={handleDeletePersons}
            onMovePerson={handleMovePerson}
            onMovePersons={handleMovePersons}
            onResetPositions={handleResetPositions}
            onAddFirstPerson={handleAddStandalonePerson}
            onAddPerson={handleAddStandalonePerson}
            onAddRelative={handleAddRelative}
            onCreateConnection={handleCreateConnection}
            onUpdateUnion={handleUpdateUnion}
            onDeleteUnion={handleDeleteUnion}
            onUpdateParentChild={handleUpdateParentChild}
            onDeleteParentChild={handleDeleteParentChild}
            onGoToImport={() => setActiveTab('archive')}
            canUndo={canUndo}
            onUndo={handleUndo}
            canRedo={canRedo}
            onRedo={handleRedo}
          />
        )}

        {activeTab === 'timeline' && (
          <TimelineView
            tree={tree}
            onSelectPersonInTree={(pid) => {
              setSelectedPersonId(pid);
              setEditingPersonId(null);
              setActiveTab('tree');
            }}
            onOpenPersonInspector={(pid) => {
              setSelectedPersonId(pid);
              setEditingPersonId(pid);
              setActiveTab('tree');
            }}
            onAddPersonEvent={handleAddPersonEvent}
            onUpdatePerson={handleUpdatePerson}
            onUpdateUnion={handleUpdateUnion}
          />
        )}

        {activeTab === 'photos' && (
          <PhotoArchiveView
            tree={tree}
            onUpdatePerson={handleUpdatePerson}
            onUpdateArchivePhotos={handleUpdateArchivePhotos}
            onUpdateSharedPhoto={handleUpdateSharedPhoto}
            onDeleteSharedPhoto={handleDeleteSharedPhoto}
            onOpenPersonInTree={(pid) => {
              setSelectedPersonId(pid);
              setEditingPersonId(pid);
              setActiveTab('tree');
            }}
          />
        )}

        {activeTab === 'map' && (
          <WorldMapView
            tree={tree}
            onSelectPersonInTree={(pid) => {
              setSelectedPersonId(pid);
              setEditingPersonId(pid);
              setActiveTab('tree');
            }}
            onSavePlaceCoords={handleSavePlaceCoords}
            onUpdatePlaceAddress={handleUpdatePlaceAddress}
          />
        )}

        {activeTab === 'archive' && (
          <ArchiveView
            tree={tree}
            onUpdateTreeTitle={(title) =>
              updateTree((prev) => ({
                ...prev,
                title,
              }))
            }
            onReplaceTree={handleReplaceTree}
            onMergeTree={handleMergeTree}
            onResetToEmpty={() => {
              const empty = createEmptyTree();
              updateTree(() => empty);
              setSelectedPersonId(null);
              setEditingPersonId(null);
            }}
            onRestoreSample={() => {
              const sample = createSampleTree();
              updateTree(() => sample);
              setSelectedPersonId(null);
              setEditingPersonId(null);
            }}
          />
        )}
      </main>

      <footer className="font-ui-mono relative z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-stone-200 bg-[#FBF9F5] px-4 py-1.5 text-[10.8px] sm:text-[11.2px] text-stone-500">
        <div
          className="flex items-center gap-1.5 text-stone-500"
          title="Текущая версия приложения Memoria Generis"
        >
          <span>Версия</span>
          <span className="tabular-nums font-medium text-stone-700">v{APP_VERSION}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 ml-auto">
          {/* Estimated ZIP project weight */}
          <span
            className="inline-flex items-center gap-1.5 text-stone-600 whitespace-nowrap"
            title={`Примерный вес текущего проекта после экспорта в ZIP-архив: ~${formatBytes(
              zipStats.zipBytes
            )} (исходные данные в браузере: ~${formatBytes(zipStats.rawBytes)})`}
          >
            <Package size={12} className="text-stone-400 shrink-0" />
            <span>
              ZIP:{' '}
              <span className="tabular-nums font-medium text-stone-700">
                ~{formatBytes(zipStats.zipBytes)}
              </span>
            </span>
          </span>

          {/* Browser storage usage meter */}
          {storageStats && storageStats.quota > 0 && (
            <div
              className="inline-flex items-center gap-1.5 text-stone-600 whitespace-nowrap"
              title={`Память браузера, используемая приложением: ${formatBytes(
                storageStats.usage
              )} из ${formatBytes(storageStats.quota)} доступных`}
            >
              <HardDrive size={12} className="text-stone-400 shrink-0" />
              <div className="h-1.5 w-14 sm:w-20 overflow-hidden rounded-full bg-stone-200">
                <div
                  className={`h-full rounded-full transition-all ${
                    storagePct > 85
                      ? 'bg-[#8B261D]'
                      : storagePct > 60
                      ? 'bg-amber-600'
                      : 'bg-[#15803D]'
                  }`}
                  style={{
                    width: `${storageStats.usage > 0 ? Math.max(4, storagePct) : 0}%`,
                  }}
                />
              </div>
              <span className="tabular-nums">
                {formatBytes(storageStats.usage)} / {formatBytes(storageStats.quota)}
              </span>
            </div>
          )}

          {/* Logic validation button + upward popover */}
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
                <AlertTriangle size={12} className="text-[#8B261D] shrink-0" />
              ) : warningIssues.length > 0 ? (
                <AlertTriangle size={12} className="text-amber-700 shrink-0" />
              ) : (
                <CheckCircle2 size={12} className="text-[#15803D] shrink-0" />
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
              <div className="font-editorial absolute right-0 bottom-full z-40 mb-2 w-[min(92vw,420px)] rounded-xl border border-stone-200 bg-white p-3.5 shadow-xl space-y-3">
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
                                setActiveTab('tree');
                                setSelectedPersonId(issue.personId);
                                setEditingPersonId(issue.personId);
                                setFocusPersonRequest({
                                  personId: issue.personId,
                                  nonce: Date.now(),
                                });
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
                                setActiveTab('tree');
                                setSelectedPersonId(issue.personId);
                                setEditingPersonId(issue.personId);
                                setFocusPersonRequest({
                                  personId: issue.personId,
                                  nonce: Date.now(),
                                });
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

          <div className="inline-flex items-center gap-1.5 text-stone-600 whitespace-nowrap">
            <Lock size={12} className="text-[#15803D]" />
            <span>Локально</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{personCount} чел.</span>
          </div>
        </div>
      </footer>

      {/* Centered Large Editing Modal */}
      {editingPerson && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/45 p-4 sm:p-6 backdrop-blur-[1px]"
          onClick={() => setEditingPersonId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-3xl justify-center"
          >
            <PersonInspector
              tree={tree}
              person={editingPerson}
              onClose={() => setEditingPersonId(null)}
              onUpdatePerson={handleUpdatePerson}
              onUpdateArchivePhotos={handleUpdateArchivePhotos}
              onSaveCroppedPhoto={handleSavePersonCroppedPhoto}
              onUpdateSharedPhoto={handleUpdateSharedPhoto}
              onDeletePerson={handleDeletePerson}
              onSelectPerson={(id) => {
                setSelectedPersonId(id);
                setEditingPersonId(id);
              }}
              onAddRelative={handleAddRelative}
              onLinkExisting={handleCreateConnection}
              onUpdateUnion={handleUpdateUnion}
              onDeleteUnion={handleDeleteUnion}
              onUpdateParentChild={handleUpdateParentChild}
              onDeleteParentChild={handleDeleteParentChild}
            />
          </div>
        </div>
      )}
    </div>
  );
}

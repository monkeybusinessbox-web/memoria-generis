import { useCallback, useEffect, useRef, useState } from 'react';
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
  TreeDocument,
  TreeViewMode,
  Union,
  VerificationStatus,
} from './types/genealogy';
import { createId, derivePatronymic, normalizeTreeDates } from './utils/dateUtils';
import { GeoPoint, normalizePlaceName } from './utils/geocoding';
import { convertQuotesToGuillemets } from './utils/quoteUtils';
import {
  loadTreeFromLocalBrowser,
  saveTreeToLocalBrowser,
} from './utils/storage';
import { computeTreeLayout, getNodeDimensions, PositionedNode } from './utils/treeLayout';

const MAX_UNDO_STEPS = 30;

export default function App() {
  const [history, setHistory] = useState<{
    present: TreeDocument | null;
    past: TreeDocument[];
  }>({ present: null, past: [] });
  const tree = history.present;
  const canUndo = history.past.length > 0;
  const lastCoalesceRef = useRef<{ key: string; at: number } | null>(null);

  const [activeTab, setActiveTab] = useState<AppWorkspaceTab>('tree');
  const [viewMode, setViewMode] = useState<TreeViewMode>('vertical');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    loadTreeFromLocalBrowser().then((loaded) => {
      if (!mounted) return;
      const initial = loaded || createSampleTree();
      setHistory({ present: initial, past: [] });
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!tree) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTreeToLocalBrowser(tree);
    }, 220);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [tree]);

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
          return { ...curr, present: next };
        }
        const nextPast =
          curr.past.length >= MAX_UNDO_STEPS
            ? [...curr.past.slice(curr.past.length - MAX_UNDO_STEPS + 1), curr.present]
            : [...curr.past, curr.present];
        return { present: next, past: nextPast };
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    lastCoalesceRef.current = null;
    setHistory((curr) => {
      if (curr.past.length === 0) return curr;
      const previous = curr.past[curr.past.length - 1];
      return {
        present: previous,
        past: curr.past.slice(0, curr.past.length - 1),
      };
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'z' && e.code !== 'KeyZ') return;
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
      if (!canUndo) return;
      e.preventDefault();
      handleUndo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUndo, handleUndo]);

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

  const handleDeletePerson = useCallback(
    (personId: string) => {
      updateTree((prev) => {
        const nextPersons: Record<string, Person> = {};
        for (const [pid, p] of Object.entries(prev.persons)) {
          if (pid === personId) continue;
          const hasTaggedPhoto = p.photos.some((ph) =>
            ph.tags?.some((t) => t.personId === personId)
          );
          nextPersons[pid] = hasTaggedPhoto
            ? {
                ...p,
                photos: p.photos.map((ph) =>
                  ph.tags
                    ? { ...ph, tags: ph.tags.filter((t) => t.personId !== personId) }
                    : ph
                ),
              }
            : p;
        }
        const nextArchivePhotos = (prev.archivePhotos || []).map((ph) =>
          ph.tags
            ? { ...ph, tags: ph.tags.filter((t) => t.personId !== personId) }
            : ph
        );
        return {
          ...prev,
          persons: nextPersons,
          unions: prev.unions.filter((u) => !u.partnerIds.includes(personId)),
          parentChildLinks: prev.parentChildLinks.filter(
            (l) => l.parentId !== personId && l.childId !== personId
          ),
          archivePhotos: nextArchivePhotos,
        };
      });
      setSelectedPersonId((curr) => (curr === personId ? null : curr));
      setEditingPersonId((curr) => (curr === personId ? null : curr));
    },
    [updateTree]
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

  if (!tree) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FBF9F5] text-stone-600">
        <span className="font-editorial text-xl">Открытие семейного архива...</span>
      </div>
    );
  }

  const editingPerson = editingPersonId ? tree.persons[editingPersonId] || null : null;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#FBF9F5] text-[#1C1917]">
      <TopBar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="flex flex-1 overflow-hidden">
        {activeTab === 'tree' && (
          <TreeCanvas
            tree={tree}
            viewMode={viewMode}
            selectedPersonId={selectedPersonId}
            onViewModeChange={setViewMode}
            onSelectPerson={setSelectedPersonId}
            onEditPerson={(id) => {
              setSelectedPersonId(id);
              setEditingPersonId(id);
            }}
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

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 bg-[#FBF9F5] px-4 py-1.5 text-[12px] sm:text-[12.5px] text-stone-500">
        <span>{tree.title || 'Семейное древо'}</span>
        <span>Локальный семейный архив · Данные хранятся только в вашем браузере</span>
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

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Baby,
  CalendarPlus,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Crop,
  FolderOpen,
  Heart,
  Image as ImageIcon,
  Link2,
  MapPin,
  Pencil,
  Search,
  Shuffle,
  Star,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  EventType,
  LifeEvent,
  ParentChildLink,
  Person,
  PhotoAttachment,
  TreeDocument,
  Union,
  UnionStatus,
  VerificationStatus,
} from '../types/genealogy';
import {
  EVENT_TYPE_LABELS,
  createId,
  derivePatronymic,
  estimateDataUrlBytes,
  formatBytes,
  formatFullName,
  formatGenealogyDate,
  formatLifespan,
  formatShortName,
  getPersonInitials,
  getPrimaryPhotoObj,
  normalizeDateInputToRu,
  parseGenealogyDate,
} from '../utils/dateUtils';
import {
  LINEAGE_PALETTE,
  computeDescendantStats,
  computeLineageColors,
} from '../utils/lineageColors';
import { compressImageFile } from '../utils/storage';
import {
  getChildren,
  getParents,
  getSiblings,
  getUnionsForPerson,
} from '../utils/treeLayout';
import { validateTreeLogic } from '../utils/treeValidation';
import { DocumentList } from './DocumentList';
import { CroppedCircleAvatar, PhotoCropModal } from './PhotoCropModal';
import { PhotoTagFrameLayer, TagFrameRect } from './PhotoTagFrameLayer';
import { VerificationIcon, VerificationSelector } from './VerificationBadge';

type InspectorTab = 'profile' | 'events' | 'relations' | 'photos';

interface PersonInspectorProps {
  tree: TreeDocument;
  person: Person;
  onClose: () => void;
  onUpdatePerson: (personId: string, patch: Partial<Person>) => void;
  onUpdateArchivePhotos?: (updater: (curr: PhotoAttachment[]) => PhotoAttachment[]) => void;
  onSaveCroppedPhoto?: (
    personId: string,
    originalDataUrl: string,
    updatedPhoto: PhotoAttachment,
    tagFrame?: TagFrameRect
  ) => void;
  onUpdateSharedPhoto?: (dataUrl: string, patch: Partial<PhotoAttachment>) => void;
  onDeletePerson: (personId: string) => void;
  onSelectPerson: (personId: string) => void;
  onAddRelative: (
    sourceId: string,
    kind: 'parent' | 'child' | 'spouse' | 'sibling'
  ) => void;
  onLinkExisting: (
    sourceId: string,
    targetId: string,
    kind: 'as_parent' | 'as_child' | 'as_spouse',
    verification: VerificationStatus
  ) => void;
  onUpdateUnion: (unionId: string, patch: Partial<Union>) => void;
  onDeleteUnion: (unionId: string) => void;
  onUpdateParentChild: (linkId: string, patch: Partial<ParentChildLink>) => void;
  onDeleteParentChild: (linkId: string) => void;
}

const CUSTOM_EVENT_OPTIONS: EventType[] = [
  'baptism',
  'migration',
  'education',
  'career',
  'award',
  'residence',
  'custom',
];

export function PersonInspector({
  tree,
  person,
  onClose,
  onUpdatePerson,
  onUpdateArchivePhotos,
  onSaveCroppedPhoto,
  onUpdateSharedPhoto,
  onDeletePerson,
  onSelectPerson,
  onAddRelative,
  onLinkExisting,
  onUpdateUnion,
  onDeleteUnion,
  onUpdateParentChild,
  onDeleteParentChild,
}: PersonInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('profile');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDescendantsList, setShowDescendantsList] = useState(false);
  const [lightboxRef, setLightboxRef] = useState<{ ownerId: string; photoId: string } | null>(null);
  const [croppingPhoto, setCroppingPhoto] = useState<PhotoAttachment | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [showArchivePicker, setShowArchivePicker] = useState(false);
  const [archivePickerQuery, setArchivePickerQuery] = useState('');
  const [archivePickerScope, setArchivePickerScope] = useState<'all' | 'archive'>('all');

  // Photo person tagging & search
  const [photoPersonSearch, setPhotoPersonSearch] = useState('');
  const [taggingPhotoKey, setTaggingPhotoKey] = useState<string | null>(null);
  const [pendingTagFrame, setPendingTagFrame] = useState<{
    ownerId: string;
    photoId: string;
    frame: TagFrameRect;
  } | null>(null);
  const [tagPickerQuery, setTagPickerQuery] = useState('');
  const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);

  // New event form state
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEvType, setNewEvType] = useState<EventType>('career');
  const [newEvTitle, setNewEvTitle] = useState('');
  const [newEvDate, setNewEvDate] = useState('');
  const [newEvPlace, setNewEvPlace] = useState('');
  const [newEvDesc, setNewEvDesc] = useState('');
  const [newEvVerif, setNewEvVerif] = useState<VerificationStatus>('confirmed');

  // Inline edit state for existing events
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    type: EventType;
    title: string;
    date: string;
    place: string;
    description: string;
    verification: VerificationStatus;
  } | null>(null);

  // Link existing relation state
  const [linkKind, setLinkKind] = useState<'as_parent' | 'as_child' | 'as_spouse'>('as_spouse');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [linkVerif, setLinkVerif] = useState<VerificationStatus>('confirmed');

  const lineage = useMemo(() => computeLineageColors(tree), [tree]);
  const personLineageColor = lineage.personColor[person.id] || '#8B261D';
  const descendantStats = useMemo(
    () => computeDescendantStats(tree, person.id),
    [person.id, tree]
  );
  const personIssues = useMemo(
    () =>
      validateTreeLogic(tree).filter(
        (issue) => issue.personId === person.id || issue.relatedPersonId === person.id
      ),
    [person.id, tree]
  );

  const primaryPhotoObj = getPrimaryPhotoObj(person);
  const parents = getParents(tree, person.id);
  const children = getChildren(tree, person.id);
  const unions = getUnionsForPerson(tree, person.id);
  const siblings = getSiblings(tree, person.id);
  const father = parents.find((p) => p.person.gender === 'male')?.person;
  const suggestedPatronymic = father
    ? derivePatronymic(father.firstName, person.gender)
    : '';

  const allPeopleSorted = useMemo(
    () =>
      Object.values(tree.persons).sort((a, b) =>
        formatFullName(a).localeCompare(formatFullName(b), 'ru')
      ),
    [tree.persons]
  );

  const otherPeople = allPeopleSorted.filter((p) => p.id !== person.id);

  const taggedElsewherePhotos = useMemo(() => {
    const seenUrls = new Set<string>(
      person.photos.map((ph) => ph.dataUrl).filter(Boolean)
    );
    const items: Array<{ owner: Person | null; ownerId: string; photo: PhotoAttachment }> = [];
    for (const ph of tree.archivePhotos || []) {
      if (!ph.dataUrl || seenUrls.has(ph.dataUrl)) continue;
      if (ph.tags?.some((t) => t.personId === person.id)) {
        seenUrls.add(ph.dataUrl);
        items.push({ owner: null, ownerId: '__archive__', photo: ph });
      }
    }
    for (const owner of allPeopleSorted) {
      if (owner.id === person.id) continue;
      for (const ph of owner.photos) {
        if (!ph.dataUrl || seenUrls.has(ph.dataUrl)) continue;
        if (ph.tags?.some((t) => t.personId === person.id)) {
          seenUrls.add(ph.dataUrl);
          items.push({ owner, ownerId: owner.id, photo: ph });
        }
      }
    }
    return items;
  }, [allPeopleSorted, person.id, person.photos, tree.archivePhotos]);

  const photoSearchResults = useMemo(() => {
    const q = photoPersonSearch.trim().toLowerCase();
    if (!q) return [];
    const seenUrls = new Set<string>();
    const results: Array<{ owner: Person | null; ownerId: string; photo: PhotoAttachment }> = [];

    const checkAndPush = (owner: Person | null, ownerId: string, ph: PhotoAttachment) => {
      if (!ph.dataUrl || seenUrls.has(ph.dataUrl)) return;
      const taggedMatch = (ph.tags || []).some((t) => {
        const tp = tree.persons[t.personId];
        if (!tp) return false;
        return `${tp.lastName} ${tp.firstName} ${tp.middleName || ''} ${tp.maidenName || ''}`
          .toLowerCase()
          .includes(q);
      });
      const ownerMatch = owner
        ? `${owner.lastName} ${owner.firstName} ${owner.middleName || ''} ${
            owner.maidenName || ''
          }`
            .toLowerCase()
            .includes(q)
        : false;
      if (taggedMatch || ownerMatch) {
        seenUrls.add(ph.dataUrl);
        results.push({ owner, ownerId, photo: ph });
      }
    };

    for (const ph of person.photos) {
      checkAndPush(person, person.id, ph);
    }
    for (const ph of tree.archivePhotos || []) {
      checkAndPush(null, '__archive__', ph);
    }
    for (const owner of allPeopleSorted) {
      if (owner.id === person.id) continue;
      for (const ph of owner.photos) {
        checkAndPush(owner, owner.id, ph);
      }
    }
    return results;
  }, [allPeopleSorted, person, photoPersonSearch, tree.archivePhotos, tree.persons]);

  const liveLightbox = useMemo(() => {
    if (!lightboxRef) return null;
    if (lightboxRef.ownerId === '__archive__') {
      const photo = (tree.archivePhotos || []).find((ph) => ph.id === lightboxRef.photoId);
      if (!photo) return null;
      return { owner: null as Person | null, ownerId: '__archive__', photo };
    }
    const owner = tree.persons[lightboxRef.ownerId];
    if (!owner) return null;
    const photo = owner.photos.find((ph) => ph.id === lightboxRef.photoId);
    if (!photo) return null;
    return { owner, ownerId: owner.id, photo };
  }, [lightboxRef, tree.archivePhotos, tree.persons]);

  const handleRandomLineageColor = () => {
    const candidates = LINEAGE_PALETTE.filter((hex) => hex !== personLineageColor);
    const pool = candidates.length > 0 ? candidates : LINEAGE_PALETTE;
    const nextColor = pool[Math.floor(Math.random() * pool.length)];
    onUpdatePerson(person.id, { lineageColor: nextColor });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploadingPhoto(true);
    try {
      const existingByUrl = new Map<string, PhotoAttachment>();
      for (const ph of tree.archivePhotos || []) {
        if (ph.dataUrl && !existingByUrl.has(ph.dataUrl)) existingByUrl.set(ph.dataUrl, ph);
      }
      for (const p of Object.values(tree.persons)) {
        for (const ph of p.photos) {
          if (ph.dataUrl && !existingByUrl.has(ph.dataUrl)) existingByUrl.set(ph.dataUrl, ph);
        }
      }

      const added: PhotoAttachment[] = [];
      let nextPhotos = [...person.photos];
      let firstAdded: PhotoAttachment | null = null;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dataUrl = await compressImageFile(file);
        const alreadyInPerson = nextPhotos.find((ph) => ph.dataUrl === dataUrl);
        if (alreadyInPerson) {
          if (!firstAdded) firstAdded = alreadyInPerson;
          continue;
        }
        const sharedMatch = existingByUrl.get(dataUrl);
        const newPhoto: PhotoAttachment = {
          id: createId('ph'),
          dataUrl,
          caption: sharedMatch?.caption ?? file.name.replace(/\.[^.]+$/, ''),
          year: sharedMatch?.year,
          date: sharedMatch?.date,
          place: sharedMatch?.place,
          category: sharedMatch?.category,
          customTags: sharedMatch?.customTags ? [...sharedMatch.customTags] : undefined,
          archiveRef: sharedMatch?.archiveRef,
          notes: sharedMatch?.notes,
          isPrimary: nextPhotos.length === 0 && added.length === 0,
          crop: { x: 0, y: 0, zoom: 1 },
          tags: sharedMatch?.tags ? sharedMatch.tags.map((t) => ({ ...t })) : [],
        };
        added.push(newPhoto);
        nextPhotos.push(newPhoto);
        if (!firstAdded) firstAdded = newPhoto;
      }

      if (added.length > 0) {
        onUpdatePerson(person.id, { photos: nextPhotos });
      }
      if (firstAdded) {
        setCroppingPhoto(firstAdded);
      }
    } finally {
      setIsUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleSaveCroppedPhoto = (updated: PhotoAttachment, tagFrame?: TagFrameRect) => {
    if (onSaveCroppedPhoto) {
      onSaveCroppedPhoto(
        person.id,
        croppingPhoto?.dataUrl || updated.dataUrl,
        updated,
        tagFrame
      );
      setCroppingPhoto(null);
      return;
    }

    const nextTags = [...(updated.tags || []).filter((t) => t.personId !== person.id)];
    if (tagFrame) {
      nextTags.push({
        id: createId('tag'),
        personId: person.id,
        x: tagFrame.x,
        y: tagFrame.y,
        w: tagFrame.w,
        h: tagFrame.h,
      });
    }
    const nextPhoto = { ...updated, tags: nextTags };
    onUpdatePerson(person.id, {
      photos: person.photos.map((ph) => (ph.id === nextPhoto.id ? nextPhoto : ph)),
    });
    setCroppingPhoto(null);
  };

  const handleSetPrimaryPhoto = (photoId: string) => {
    const updated = person.photos.map((ph) => ({
      ...ph,
      isPrimary: ph.id === photoId,
    }));
    onUpdatePerson(person.id, { photos: updated });
  };

  const archivePickerItems = useMemo(() => {
    const seenUrls = new Set<string>();
    const list: Array<{
      key: string;
      sourceLabel: string;
      isArchive: boolean;
      photo: PhotoAttachment;
      searchText: string;
    }> = [];

    for (const ph of tree.archivePhotos || []) {
      if (!ph.dataUrl) continue;
      seenUrls.add(ph.dataUrl);
      const taggedNames = (ph.tags || [])
        .map((t) => tree.persons[t.personId])
        .filter((tp): tp is Person => Boolean(tp))
        .map((tp) => formatFullName(tp))
        .join(' ');
      list.push({
        key: `arch:${ph.id}`,
        sourceLabel: 'Общий фотоархив',
        isArchive: true,
        photo: ph,
        searchText: `${ph.caption || ''} ${ph.year || ''} ${ph.date || ''} ${ph.place || ''} ${taggedNames}`.toLowerCase(),
      });
    }

    if (archivePickerScope === 'all') {
      for (const p of allPeopleSorted) {
        const ownerName = formatFullName(p);
        for (const ph of p.photos) {
          if (!ph.dataUrl || seenUrls.has(ph.dataUrl)) continue;
          seenUrls.add(ph.dataUrl);
          const taggedNames = (ph.tags || [])
            .map((t) => tree.persons[t.personId])
            .filter((tp): tp is Person => Boolean(tp))
            .map((tp) => formatFullName(tp))
            .join(' ');
          list.push({
            key: `per:${p.id}:${ph.id}`,
            sourceLabel: ownerName,
            isArchive: false,
            photo: ph,
            searchText: `${ownerName} ${ph.caption || ''} ${ph.year || ''} ${ph.date || ''} ${ph.place || ''} ${taggedNames}`.toLowerCase(),
          });
        }
      }
    }

    const q = archivePickerQuery.trim().toLowerCase();
    return q ? list.filter((item) => item.searchText.includes(q)) : list;
  }, [allPeopleSorted, archivePickerQuery, archivePickerScope, tree.archivePhotos, tree.persons]);

  const handlePickPhotoFromArchive = (sourcePhoto: PhotoAttachment) => {
    const existing = person.photos.find((ph) => ph.dataUrl === sourcePhoto.dataUrl);
    if (existing) {
      const updated = person.photos.map((ph) => ({
        ...ph,
        isPrimary: ph.id === existing.id,
      }));
      onUpdatePerson(person.id, { photos: updated });
      setShowArchivePicker(false);
      setCroppingPhoto({ ...existing, isPrimary: true });
      return;
    }

    const newPhoto: PhotoAttachment = {
      id: createId('ph'),
      dataUrl: sourcePhoto.dataUrl,
      caption: sourcePhoto.caption,
      year: sourcePhoto.year,
      date: sourcePhoto.date,
      place: sourcePhoto.place,
      category: sourcePhoto.category,
      isPrimary: true,
      crop: { x: 0, y: 0, zoom: 1 },
      tags: sourcePhoto.tags ? sourcePhoto.tags.map((t) => ({ ...t })) : [],
    };
    const nextPhotos = [
      ...person.photos.map((ph) => ({ ...ph, isPrimary: false })),
      newPhoto,
    ];
    onUpdatePerson(person.id, { photos: nextPhotos });
    setShowArchivePicker(false);
    setCroppingPhoto(newPhoto);
  };

  const handleUpdatePhotoMeta = (
    ownerId: string,
    photoId: string,
    patch: Partial<PhotoAttachment>
  ) => {
    if (ownerId === '__archive__') {
      const archPh = (tree.archivePhotos || []).find((ph) => ph.id === photoId);
      if (archPh?.dataUrl && onUpdateSharedPhoto) {
        onUpdateSharedPhoto(archPh.dataUrl, patch);
        return;
      }
      onUpdateArchivePhotos?.((curr) =>
        curr.map((ph) => (ph.id === photoId ? { ...ph, ...patch } : ph))
      );
      return;
    }
    const owner = tree.persons[ownerId];
    if (!owner) return;
    const target = owner.photos.find((ph) => ph.id === photoId);
    if (target?.dataUrl && onUpdateSharedPhoto) {
      onUpdateSharedPhoto(target.dataUrl, patch);
      return;
    }
    const updated = owner.photos.map((ph) => (ph.id === photoId ? { ...ph, ...patch } : ph));
    onUpdatePerson(ownerId, { photos: updated });
  };

  const handleAddPhotoTag = (
    ownerId: string,
    photoId: string,
    targetPersonId: string,
    frame: TagFrameRect
  ) => {
    const newTag = {
      id: createId('tag'),
      personId: targetPersonId,
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
    };
    if (ownerId === '__archive__') {
      const archPh = (tree.archivePhotos || []).find((ph) => ph.id === photoId);
      if (archPh?.dataUrl && onUpdateSharedPhoto) {
        const filtered = (archPh.tags || []).filter((t) => t.personId !== targetPersonId);
        onUpdateSharedPhoto(archPh.dataUrl, { tags: [...filtered, newTag] });
      } else {
        onUpdateArchivePhotos?.((curr) =>
          curr.map((ph) => {
            if (ph.id !== photoId) return ph;
            const filtered = (ph.tags || []).filter((t) => t.personId !== targetPersonId);
            return { ...ph, tags: [...filtered, newTag] };
          })
        );
      }
      setPendingTagFrame(null);
      setTagPickerQuery('');
      return;
    }
    const owner = tree.persons[ownerId];
    if (!owner) return;
    const target = owner.photos.find((ph) => ph.id === photoId);
    if (target?.dataUrl && onUpdateSharedPhoto) {
      const filtered = (target.tags || []).filter((t) => t.personId !== targetPersonId);
      onUpdateSharedPhoto(target.dataUrl, { tags: [...filtered, newTag] });
    } else {
      const updated = owner.photos.map((ph) => {
        if (ph.id !== photoId) return ph;
        const filtered = (ph.tags || []).filter((t) => t.personId !== targetPersonId);
        return {
          ...ph,
          tags: [...filtered, newTag],
        };
      });
      onUpdatePerson(ownerId, { photos: updated });
    }
    setPendingTagFrame(null);
    setTagPickerQuery('');
  };

  const handleRemovePhotoTag = (ownerId: string, photoId: string, tagId: string) => {
    if (ownerId === '__archive__') {
      const archPh = (tree.archivePhotos || []).find((ph) => ph.id === photoId);
      if (archPh?.dataUrl && onUpdateSharedPhoto) {
        onUpdateSharedPhoto(archPh.dataUrl, {
          tags: (archPh.tags || []).filter((t) => t.id !== tagId),
        });
        return;
      }
      onUpdateArchivePhotos?.((curr) =>
        curr.map((ph) =>
          ph.id === photoId
            ? { ...ph, tags: (ph.tags || []).filter((t) => t.id !== tagId) }
            : ph
        )
      );
      return;
    }
    const owner = tree.persons[ownerId];
    if (!owner) return;
    const target = owner.photos.find((ph) => ph.id === photoId);
    if (target?.dataUrl && onUpdateSharedPhoto) {
      onUpdateSharedPhoto(target.dataUrl, {
        tags: (target.tags || []).filter((t) => t.id !== tagId),
      });
      return;
    }
    const updated = owner.photos.map((ph) => {
      if (ph.id !== photoId) return ph;
      return {
        ...ph,
        tags: (ph.tags || []).filter((t) => t.id !== tagId),
      };
    });
    onUpdatePerson(ownerId, { photos: updated });
  };

  const handleDeletePhoto = (photoId: string) => {
    const filtered = person.photos.filter((ph) => ph.id !== photoId);
    if (filtered.length > 0 && !filtered.some((ph) => ph.isPrimary)) {
      filtered[0] = { ...filtered[0], isPrimary: true };
    }
    onUpdatePerson(person.id, { photos: filtered });
  };

  const handleCreateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newEvTitle.trim() || EVENT_TYPE_LABELS[newEvType];
    const normalizedDate = normalizeDateInputToRu(newEvDate);
    const newEvent: LifeEvent = {
      id: createId('ev'),
      type: newEvType,
      title,
      date: normalizedDate,
      place: newEvPlace.trim() || undefined,
      description: newEvDesc.trim() || undefined,
      verification: newEvVerif,
      documents: [],
    };
    onUpdatePerson(person.id, {
      events: [...person.events, newEvent].sort(
        (a, b) => parseGenealogyDate(a.date).sortKey - parseGenealogyDate(b.date).sortKey
      ),
    });
    setNewEvTitle('');
    setNewEvDate('');
    setNewEvPlace('');
    setNewEvDesc('');
    setShowNewEvent(false);
  };

  const handleUpdateEvent = (evId: string, patch: Partial<LifeEvent>) => {
    const updated = person.events
      .map((ev) => (ev.id === evId ? { ...ev, ...patch } : ev))
      .sort((a, b) => parseGenealogyDate(a.date).sortKey - parseGenealogyDate(b.date).sortKey);
    onUpdatePerson(person.id, { events: updated });
  };

  const startEditingEvent = (ev: LifeEvent) => {
    setEditingEventId(ev.id);
    setEditDraft({
      type: ev.type,
      title: ev.title,
      date: ev.date,
      place: ev.place || '',
      description: ev.description || '',
      verification: ev.verification,
    });
  };

  const handleSaveEditedEvent = (e: React.FormEvent, evId: string) => {
    e.preventDefault();
    if (!editDraft) return;
    handleUpdateEvent(evId, {
      type: editDraft.type,
      title: editDraft.title.trim() || EVENT_TYPE_LABELS[editDraft.type],
      date: normalizeDateInputToRu(editDraft.date),
      place: editDraft.place.trim() || undefined,
      description: editDraft.description.trim() || undefined,
      verification: editDraft.verification,
    });
    setEditingEventId(null);
    setEditDraft(null);
  };

  const handleDeleteEvent = (evId: string) => {
    if (editingEventId === evId) {
      setEditingEventId(null);
      setEditDraft(null);
    }
    onUpdatePerson(person.id, {
      events: person.events.filter((ev) => ev.id !== evId),
    });
  };

  return (
    <>
      <div className="flex h-[858px] max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#FBF9F5] shadow-2xl">
        {/* Centered Header Card: Borderless Portrait + Plain Text Name beside photo */}
        <div className="border-b border-stone-200 bg-white px-4 py-4 sm:px-6 sm:py-5 shrink-0">
          <div className="flex items-start gap-5">
            {/* Borderless Square Portrait (NO colored highlight ring) */}
            <div className="relative shrink-0">
              <CroppedCircleAvatar
                photo={primaryPhotoObj}
                initials={getPersonInitials(person)}
                alt={formatShortName(person)}
                sizeClass="h-24 w-24"
                showBorder={false}
                textSizeClass="text-2xl"
              />
              <label
                title="Загрузить фото"
                className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white bg-stone-900 text-white shadow-xs hover:bg-[#8B261D]"
              >
                <Camera size={13} />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setArchivePickerQuery('');
                  setShowArchivePicker(true);
                }}
                title="Выбрать фото из общего фотоархива"
                aria-label="Выбрать фото из общего фотоархива"
                className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-xs hover:text-[#8B261D] cursor-pointer"
              >
                <FolderOpen size={12} />
              </button>
              {primaryPhotoObj && (
                <button
                  type="button"
                  onClick={() => setCroppingPhoto(primaryPhotoObj)}
                  title="Настроить кадрирование портрета"
                  className="absolute -left-1.5 -bottom-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-xs hover:text-[#8B261D] cursor-pointer"
                >
                  <Crop size={12} />
                </button>
              )}
            </div>

            {/* Plain-text Full Name beside photo */}
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-editorial text-2xl font-normal leading-snug text-stone-900 break-words">
                    {formatFullName(person)}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[18px] leading-snug text-stone-500">
                    <span className="font-editorial tabular-nums text-stone-700">
                      ({formatLifespan(person)})
                    </span>
                    {person.occupation && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate max-w-[360px]">{person.occupation}</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Закрыть карточку"
                  className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer shrink-0"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="pt-0.5">
                <VerificationSelector
                  value={person.verification}
                  onChange={(v) => onUpdatePerson(person.id, { verification: v })}
                />
              </div>
            </div>
          </div>

          {/* Sub-navigation Tabs (Uppercase + Досье) */}
          <div className="mt-4 grid grid-cols-4 gap-1 rounded-lg bg-stone-100 p-1">
            {(
              [
                { id: 'profile', label: 'Досье' },
                { id: 'events', label: `Даты (${person.events.length})` },
                {
                  id: 'relations',
                  label: `Связи (${parents.length + unions.length + children.length})`,
                },
                { id: 'photos', label: `Фото (${person.photos.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`rounded-md px-2 py-2 text-[14.5px] font-medium uppercase tracking-[0.08em] transition-colors whitespace-nowrap truncate cursor-pointer ${
                  activeTab === t.id
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Lineage Color Panel placed directly beneath Досье / Даты / Связи / Фото */}
          <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-[#FBF9F5] px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-medium text-stone-600">
                Цвет линии рода ({lineage.personLineageName[person.id] || 'Род'})
              </span>
              <button
                type="button"
                onClick={handleRandomLineageColor}
                title="Выбрать случайный цвет линии рода"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-[#8B261D] hover:underline cursor-pointer"
              >
                <Shuffle size={12} />
                <span>Случайный цвет</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {LINEAGE_PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => onUpdatePerson(person.id, { lineageColor: hex })}
                  title={`Задать цвет линии ${hex}`}
                  className={`h-5 w-5 rounded-full transition-transform cursor-pointer ${
                    personLineageColor === hex
                      ? 'scale-115 ring-2 ring-stone-900/40 ring-offset-1'
                      : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Scrollable Tab Body (Fixed Modal Height) */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 space-y-5">
          {personIssues.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-amber-950">
                <AlertTriangle size={14} className="text-amber-700 shrink-0" />
                <span>Логическая проверка данных ({personIssues.length})</span>
              </div>
              <ul className="space-y-1 text-[13px] text-amber-900">
                {personIssues.map((issue) => (
                  <li key={issue.id}>{issue.description}</li>
                ))}
              </ul>
            </div>
          )}
          {activeTab === 'profile' && (
            <div className="space-y-4">
              {/* Surname, First Name, Middle Name */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                    Фамилия
                  </label>
                  <input
                    type="text"
                    value={person.lastName}
                    onChange={(e) => onUpdatePerson(person.id, { lastName: e.target.value })}
                    placeholder="Воронцов"
                    className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                    Имя
                  </label>
                  <input
                    type="text"
                    value={person.firstName}
                    onChange={(e) => onUpdatePerson(person.id, { firstName: e.target.value })}
                    placeholder="Алексей"
                    className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-[13.5px] font-medium text-stone-600">
                      Отчество
                    </label>
                    {!person.middleName?.trim() && suggestedPatronymic && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdatePerson(person.id, { middleName: suggestedPatronymic })
                        }
                        title="Подставить отчество по имени отца"
                        className="text-[12px] font-medium text-[#8B261D] hover:underline cursor-pointer truncate"
                      >
                        По отцу: {suggestedPatronymic}
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={person.middleName || ''}
                    onChange={(e) => onUpdatePerson(person.id, { middleName: e.target.value })}
                    placeholder={suggestedPatronymic || 'Николаевич'}
                    className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                  />
                </div>
              </div>

              {person.gender !== 'male' && (
                <div>
                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                    Девичья фамилия (отображается в древе)
                  </label>
                  <input
                    type="text"
                    value={person.maidenName || ''}
                    onChange={(e) => onUpdatePerson(person.id, { maidenName: e.target.value })}
                    placeholder="Если менялась"
                    className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                  />
                </div>
              )}

              {/* Compact Gender Selector (Муж / Жен) — Living status inferred strictly from deathDate */}
              <div className="flex flex-wrap items-center gap-3 pt-0.5">
                <span className="text-[13.5px] font-medium text-stone-600">Пол:</span>
                <div
                  className="inline-flex items-center rounded-md border border-stone-200 bg-stone-100 p-0.5"
                  role="group"
                  aria-label="Пол"
                >
                  {(
                    [
                      { id: 'male', label: 'Муж' },
                      { id: 'female', label: 'Жен' },
                    ] as const
                  ).map((gOpt) => (
                    <button
                      key={gOpt.id}
                      type="button"
                      onClick={() => {
                        const patch: Partial<Person> = { gender: gOpt.id };
                        if (father) {
                          const currMid = (person.middleName || '').trim();
                          const currDerived = derivePatronymic(father.firstName, person.gender);
                          if (!currMid || currMid === currDerived) {
                            const nextDerived = derivePatronymic(father.firstName, gOpt.id);
                            if (nextDerived) patch.middleName = nextDerived;
                          }
                        }
                        onUpdatePerson(person.id, patch);
                      }}
                      className={`rounded px-3.5 py-1.5 text-[14.5px] font-medium transition-colors cursor-pointer ${
                        person.gender === gOpt.id
                          ? 'bg-white text-stone-900 shadow-xs'
                          : 'text-stone-500 hover:text-stone-900'
                      }`}
                    >
                      {gOpt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                  Род занятий / сословие / профессия
                </label>
                <input
                  type="text"
                  value={person.occupation || ''}
                  onChange={(e) => onUpdatePerson(person.id, { occupation: e.target.value })}
                  placeholder="Архитектор, преподаватель, инженер..."
                  className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                  Биографические заметки и семейные воспоминания
                </label>
                <textarea
                  rows={5}
                  value={person.notes}
                  onChange={(e) => onUpdatePerson(person.id, { notes: e.target.value })}
                  placeholder="Истории из жизни, источники сведений, номера архивных дел..."
                  className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[16.5px] leading-relaxed text-stone-800 focus:border-[#8B261D] focus:outline-none"
                />
              </div>

              {/* Descendant Statistics */}
              <div className="rounded-lg border border-stone-200 bg-[#FBF9F5] p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[14px] font-semibold text-stone-800">
                    <Users size={15} className="text-[#8B261D] shrink-0" />
                    <span>Статистика потомков</span>
                  </div>
                  <span className="font-mono-tabular text-[13.5px] font-semibold text-stone-900">
                    {descendantStats.total === 0
                      ? 'Потомков в древе нет'
                      : `Всего потомков: ${descendantStats.total}`}
                  </span>
                </div>

                {descendantStats.total > 0 && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {descendantStats.generations.map((gen) => (
                        <div
                          key={gen.level}
                          className="flex items-center justify-between rounded-md border border-stone-200/90 bg-white px-2.5 py-1.5"
                        >
                          <span className="text-[13px] text-stone-600">{gen.label}</span>
                          <span className="font-mono-tabular text-[14px] font-semibold text-stone-900">
                            {gen.persons.length}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[13px] text-stone-600">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>
                          Ныне живущих:{' '}
                          <strong className="font-mono-tabular font-semibold text-stone-800">
                            {descendantStats.livingCount}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Поколений вниз:{' '}
                          <strong className="font-mono-tabular font-semibold text-stone-800">
                            {descendantStats.maxDepth}
                          </strong>
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => setShowDescendantsList((v) => !v)}
                        className="inline-flex items-center gap-1 text-[13px] font-medium text-[#8B261D] hover:underline cursor-pointer"
                      >
                        <span>
                          {showDescendantsList ? 'Скрыть список' : 'Показать список'}
                        </span>
                        {showDescendantsList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>

                    {showDescendantsList && (
                      <div className="mt-2 max-h-60 overflow-y-auto space-y-2.5 border-t border-stone-200 pt-2.5 pr-1">
                        {descendantStats.generations.map((gen) => (
                          <div key={gen.level} className="space-y-1">
                            <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-stone-500">
                              {gen.label} ({gen.persons.length})
                            </div>
                            <div className="space-y-1">
                              {gen.persons.map((desc) => (
                                <button
                                  key={desc.id}
                                  type="button"
                                  onClick={() => onSelectPerson(desc.id)}
                                  className="flex w-full items-center justify-between gap-2 rounded-md border border-stone-200/80 bg-white px-2.5 py-1.5 text-left hover:border-[#8B261D]/45 transition-colors cursor-pointer"
                                >
                                  <span className="text-[13.5px] font-medium text-stone-900 truncate">
                                    {formatFullName(desc)}
                                  </span>
                                  <span className="font-editorial tabular-nums text-[12.5px] text-stone-500 shrink-0">
                                    ({formatLifespan(desc)})
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="border-t border-stone-200 pt-4">
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 text-[14.5px] font-medium text-stone-500 hover:text-[#8B261D] transition-colors cursor-pointer"
                  >
                    <Trash2 size={15} />
                    <span>Удалить персону из древа</span>
                  </button>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50/70 px-3 py-2">
                    <span className="text-[14.5px] text-red-900">Удалить безвозвратно?</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded px-2.5 py-1 text-[14.5px] text-stone-600 hover:bg-white cursor-pointer"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDelete(false);
                          onDeletePerson(person.id);
                        }}
                        className="rounded bg-[#8B261D] px-3 py-1 text-[14.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'events' && (
            <div className="space-y-5">
              {/* Core Vital Dates with Confirming Documents */}
              <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
                <div className="text-[14.5px] font-semibold text-stone-700">Основные даты жизни</div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                      Дата рождения (дд.мм.гггг)
                    </label>
                    <input
                      type="text"
                      value={person.birthDate || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const next = /^\d{4}-\d{1,2}-\d{1,2}$/.test(val.trim())
                          ? normalizeDateInputToRu(val)
                          : val;
                        onUpdatePerson(person.id, { birthDate: next });
                      }}
                      onBlur={(e) => {
                        const norm = normalizeDateInputToRu(e.target.value);
                        if (norm !== e.target.value) {
                          onUpdatePerson(person.id, { birthDate: norm });
                        }
                      }}
                      placeholder="08.03.1904"
                      className="w-full rounded border border-stone-200 px-2.5 py-1.5 tabular-nums text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[13.5px] font-medium text-stone-600 mb-1">Место рождения</label>
                    <input
                      type="text"
                      value={person.birthPlace || ''}
                      onChange={(e) => onUpdatePerson(person.id, { birthPlace: e.target.value })}
                      placeholder="Санкт-Петербург"
                      className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                    />
                  </div>
                </div>
                <DocumentList
                  documents={person.birthDocuments || []}
                  onChange={(docs) => onUpdatePerson(person.id, { birthDocuments: docs })}
                  label="Документ о рождении"
                />

                {/* Death date/place always editable; empty deathDate means living */}
                <div className="space-y-3 border-t border-stone-100 pt-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                        Дата кончины (дд.мм.гггг)
                      </label>
                      <input
                        type="text"
                        value={person.deathDate || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const next = /^\d{4}-\d{1,2}-\d{1,2}$/.test(val.trim())
                            ? normalizeDateInputToRu(val)
                            : val;
                          onUpdatePerson(person.id, {
                            deathDate: next,
                            isLiving: !next.trim(),
                          });
                        }}
                        onBlur={(e) => {
                          const norm = normalizeDateInputToRu(e.target.value);
                          onUpdatePerson(person.id, {
                            deathDate: norm,
                            isLiving: !norm.trim(),
                          });
                        }}
                        placeholder="Оставьте пустым, если человек жив"
                        className="w-full rounded border border-stone-200 px-2.5 py-1.5 tabular-nums text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                        Место кончины
                      </label>
                      <input
                        type="text"
                        value={person.deathPlace || ''}
                        onChange={(e) => onUpdatePerson(person.id, { deathPlace: e.target.value })}
                        placeholder="Москва"
                        className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                      />
                    </div>
                  </div>
                  <DocumentList
                    documents={person.deathDocuments || []}
                    onChange={(docs) => onUpdatePerson(person.id, { deathDocuments: docs })}
                    label="Документ о кончине"
                  />
                </div>
              </div>

              {/* Additional Important Dates (Add + Edit Inline + Delete + Document Thumbnails) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[14.5px] font-semibold text-stone-700">
                    Важные события и памятные даты
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowNewEvent((v) => !v)}
                    title="Добавить дату"
                    aria-label="Добавить дату"
                    className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 xl:px-3 py-1.5 text-[14.5px] font-medium text-stone-700 hover:border-stone-300 hover:text-stone-900 cursor-pointer"
                  >
                    <CalendarPlus size={14} />
                    <span className="desktop-btn-label">Добавить дату</span>
                  </button>
                </div>

                {showNewEvent && (
                  <form
                    onSubmit={handleCreateEvent}
                    className="space-y-3 rounded-lg border border-stone-300 bg-white p-4"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[13.5px] font-medium text-stone-600 mb-1">Категория</label>
                        <select
                          value={newEvType}
                          onChange={(e) => setNewEvType(e.target.value as EventType)}
                          className="w-full rounded border border-stone-200 bg-white px-2 py-1.5 text-[16.5px] text-stone-900"
                        >
                          {CUSTOM_EVENT_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {EVENT_TYPE_LABELS[opt]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                          Дата (дд.мм.гггг или гггг)
                        </label>
                        <input
                          type="text"
                          required
                          value={newEvDate}
                          onChange={(e) => setNewEvDate(e.target.value)}
                          onBlur={(e) => {
                            const norm = normalizeDateInputToRu(e.target.value);
                            if (norm !== e.target.value) setNewEvDate(norm);
                          }}
                          placeholder="20.05.1929"
                          className="w-full rounded border border-stone-200 px-2.5 py-1.5 tabular-nums text-[16.5px] text-stone-900"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                          Название события
                        </label>
                        <input
                          type="text"
                          value={newEvTitle}
                          onChange={(e) => setNewEvTitle(e.target.value)}
                          placeholder={EVENT_TYPE_LABELS[newEvType]}
                          className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-[16.5px] text-stone-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[13.5px] font-medium text-stone-600 mb-1">Место</label>
                        <input
                          type="text"
                          value={newEvPlace}
                          onChange={(e) => setNewEvPlace(e.target.value)}
                          placeholder="Город, приход, учреждение"
                          className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-[16.5px] text-stone-900"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[13.5px] font-medium text-stone-600 mb-1">Подробности</label>
                      <textarea
                        rows={2}
                        value={newEvDesc}
                        onChange={(e) => setNewEvDesc(e.target.value)}
                        placeholder="Краткое описание или ссылка на документ..."
                        className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-[16.5px] text-stone-900"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <VerificationSelector value={newEvVerif} onChange={setNewEvVerif} />
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setShowNewEvent(false)}
                          className="rounded px-3 py-1.5 text-[14.5px] text-stone-500 hover:bg-stone-100 cursor-pointer"
                        >
                          Отмена
                        </button>
                        <button
                          type="submit"
                          className="rounded bg-[#8B261D] px-3.5 py-1.5 text-[14.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
                        >
                          Сохранить
                        </button>
                      </div>
                    </div>
                  </form>
                )}

                {person.events.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-stone-200 px-3 py-4 text-center text-[14.5px] text-stone-500">
                    Дополнительных дат пока нет. Добавьте крещение, переезд, образование, награды или важные вехи жизни.
                  </p>
                ) : (
                  <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
                    {person.events.map((ev) => {
                      const isEditing = editingEventId === ev.id && editDraft !== null;
                      return (
                        <div key={ev.id} className="p-3.5 space-y-2.5">
                          {isEditing && editDraft ? (
                            <form
                              onSubmit={(e) => handleSaveEditedEvent(e, ev.id)}
                              className="space-y-2.5 rounded-md bg-stone-50/70 p-3 border border-stone-200"
                            >
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                                    Категория
                                  </label>
                                  <select
                                    value={editDraft.type}
                                    onChange={(e) =>
                                      setEditDraft({
                                        ...editDraft,
                                        type: e.target.value as EventType,
                                      })
                                    }
                                    className="w-full rounded border border-stone-200 bg-white px-2 py-1.5 text-[16.5px] text-stone-900"
                                  >
                                    {CUSTOM_EVENT_OPTIONS.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {EVENT_TYPE_LABELS[opt]}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                                    Дата (дд.мм.гггг)
                                  </label>
                                  <input
                                    type="text"
                                    required
                                    value={editDraft.date}
                                    onChange={(e) =>
                                      setEditDraft({ ...editDraft, date: e.target.value })
                                    }
                                    onBlur={(e) =>
                                      setEditDraft({
                                        ...editDraft,
                                        date: normalizeDateInputToRu(e.target.value),
                                      })
                                    }
                                    className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 tabular-nums text-[16.5px] text-stone-900"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                                    Название события
                                  </label>
                                  <input
                                    type="text"
                                    value={editDraft.title}
                                    onChange={(e) =>
                                      setEditDraft({ ...editDraft, title: e.target.value })
                                    }
                                    className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-[16.5px] text-stone-900"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                                    Место
                                  </label>
                                  <input
                                    type="text"
                                    value={editDraft.place}
                                    onChange={(e) =>
                                      setEditDraft({ ...editDraft, place: e.target.value })
                                    }
                                    className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-[16.5px] text-stone-900"
                                  />
                                </div>
                              </div>

                              <div>
                                <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                                  Подробности
                                </label>
                                <textarea
                                  rows={2}
                                  value={editDraft.description}
                                  onChange={(e) =>
                                    setEditDraft({ ...editDraft, description: e.target.value })
                                  }
                                  className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-[16.5px] text-stone-900"
                                />
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                <VerificationSelector
                                  value={editDraft.verification}
                                  onChange={(v) =>
                                    setEditDraft({ ...editDraft, verification: v })
                                  }
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingEventId(null);
                                      setEditDraft(null);
                                    }}
                                    className="rounded px-3 py-1.5 text-[14.5px] text-stone-600 hover:bg-stone-200/70 cursor-pointer"
                                  >
                                    Отмена
                                  </button>
                                  <button
                                    type="submit"
                                    className="rounded bg-[#8B261D] px-3.5 py-1.5 text-[14.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
                                  >
                                    Сохранить
                                  </button>
                                </div>
                              </div>
                            </form>
                          ) : (
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-stone-500">
                                  <span className="font-editorial tabular-nums font-semibold text-stone-700">
                                    {formatGenealogyDate(ev.date) || ev.date || 'Без даты'}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{EVENT_TYPE_LABELS[ev.type]}</span>
                                  {ev.place && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="inline-flex items-center gap-1 text-stone-600">
                                        <MapPin size={13} className="shrink-0 text-[#8B261D]" />
                                        <span>{ev.place}</span>
                                      </span>
                                    </>
                                  )}
                                </div>
                                <div className="mt-0.5 font-editorial text-lg font-semibold text-stone-900">
                                  {ev.title}
                                </div>
                                {ev.description && (
                                  <p className="mt-1 text-[14.5px] leading-relaxed text-stone-600">
                                    {ev.description}
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <VerificationSelector
                                  compact
                                  value={ev.verification}
                                  onChange={(v) =>
                                    handleUpdateEvent(ev.id, { verification: v })
                                  }
                                />
                                <button
                                  type="button"
                                  onClick={() => startEditingEvent(ev)}
                                  title="Редактировать дату и описание"
                                  className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-900 cursor-pointer"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteEvent(ev.id)}
                                  title="Удалить дату"
                                  className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-[#8B261D] cursor-pointer"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          )}

                          <DocumentList
                            documents={ev.documents || []}
                            onChange={(docs) => handleUpdateEvent(ev.id, { documents: docs })}
                            label="Прикрепить документ к событию"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'relations' && (
            <div className="space-y-5">
              <div>
                <div className="text-[14.5px] font-semibold text-stone-700 mb-2">
                  Быстро добавить родственника
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => onAddRelative(person.id, 'parent')}
                    title="Добавить родителя"
                    aria-label="Добавить родителя"
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-2 text-[14.5px] font-medium text-stone-800 hover:border-[#8B261D] hover:text-[#8B261D] transition-colors cursor-pointer"
                  >
                    <ArrowUp size={15} />
                    <span className="desktop-btn-label">+ Родитель</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddRelative(person.id, 'spouse')}
                    title="Добавить супруга / партнёра"
                    aria-label="Добавить супруга / партнёра"
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-2 text-[14.5px] font-medium text-stone-800 hover:border-[#8B261D] hover:text-[#8B261D] transition-colors cursor-pointer"
                  >
                    <Heart size={15} />
                    <span className="desktop-btn-label">+ Супруг(а)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddRelative(person.id, 'child')}
                    title="Добавить ребёнка"
                    aria-label="Добавить ребёнка"
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-2 text-[14.5px] font-medium text-stone-800 hover:border-[#8B261D] hover:text-[#8B261D] transition-colors cursor-pointer"
                  >
                    <Baby size={15} />
                    <span className="desktop-btn-label">+ Ребёнок</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddRelative(person.id, 'sibling')}
                    title="Добавить брата / сестру"
                    aria-label="Добавить брата / сестру"
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-2 text-[14.5px] font-medium text-stone-800 hover:border-[#8B261D] hover:text-[#8B261D] transition-colors cursor-pointer"
                  >
                    <Users size={15} />
                    <span className="desktop-btn-label">+ Брат / Сестра</span>
                  </button>
                </div>
              </div>

              {otherPeople.length > 0 && (
                <div className="rounded-lg border border-stone-200 bg-white p-3.5 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[14.5px] font-semibold text-stone-700">
                    <Link2 size={14} />
                    <span>Связать с существующим человеком</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={linkKind}
                      onChange={(e) =>
                        setLinkKind(e.target.value as 'as_parent' | 'as_child' | 'as_spouse')
                      }
                      className="w-full rounded border border-stone-200 bg-stone-50 px-2.5 py-2 text-[16.5px] text-stone-800"
                    >
                      <option value="as_spouse">Сделать супругом / партнёром</option>
                      <option value="as_parent">Выбранный человек — родитель</option>
                      <option value="as_child">Выбранный человек — ребёнок</option>
                    </select>
                    <select
                      value={linkTargetId}
                      onChange={(e) => setLinkTargetId(e.target.value)}
                      className="w-full rounded border border-stone-200 bg-white px-2.5 py-2 text-[16.5px] text-stone-800"
                    >
                      <option value="">Выберите персону...</option>
                      {otherPeople.map((op) => (
                        <option key={op.id} value={op.id}>
                          {formatFullName(op)} ({formatLifespan(op)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <VerificationSelector compact value={linkVerif} onChange={setLinkVerif} />
                    <button
                      type="button"
                      disabled={!linkTargetId}
                      onClick={() => {
                        if (!linkTargetId) return;
                        onLinkExisting(person.id, linkTargetId, linkKind, linkVerif);
                        setLinkTargetId('');
                      }}
                      className="rounded bg-stone-900 px-3.5 py-1.5 text-[14.5px] font-medium text-white disabled:opacity-40 hover:bg-stone-800 cursor-pointer"
                    >
                      Связать
                    </button>
                  </div>
                </div>
              )}

              {/* Parents */}
              <div className="space-y-2">
                <div className="text-[14.5px] font-semibold text-stone-700">Родители</div>
                {parents.length === 0 ? (
                  <p className="text-[14.5px] text-stone-400">Не указаны</p>
                ) : (
                  <div className="space-y-1.5">
                    {parents.map(({ person: p, link }) => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-white px-3 py-2"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectPerson(p.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-[#8B261D] cursor-pointer"
                        >
                          <CroppedCircleAvatar
                            photo={getPrimaryPhotoObj(p)}
                            initials={getPersonInitials(p)}
                            alt={formatShortName(p)}
                            sizeClass="h-10 w-10"
                            textSizeClass="text-sm"
                            showBorder={false}
                          />
                          <div className="min-w-0">
                            <div className="text-[14.5px] font-medium text-stone-900 truncate">
                              {formatShortName(p)}
                            </div>
                            <div className="font-editorial tabular-nums text-[13px] text-stone-500">
                              ({formatLifespan(p)})
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <VerificationSelector
                            compact
                            value={link.verification}
                            onChange={(v) => onUpdateParentChild(link.id, { verification: v })}
                          />
                          <button
                            type="button"
                            onClick={() => onDeleteParentChild(link.id)}
                            title="Удалить связь"
                            className="rounded p-1 text-stone-400 hover:text-[#8B261D] cursor-pointer"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Spouses / Unions */}
              <div className="space-y-2">
                <div className="text-[14.5px] font-semibold text-stone-700">Браки и союзы</div>
                {unions.length === 0 ? (
                  <p className="text-[14.5px] text-stone-400">Не указаны</p>
                ) : (
                  <div className="space-y-2.5">
                    {unions.map(({ union, partner }) => (
                      <div
                        key={union.id}
                        className="rounded-md border border-stone-200 bg-white p-3 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => onSelectPerson(partner.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-[#8B261D] cursor-pointer"
                          >
                            <CroppedCircleAvatar
                              photo={getPrimaryPhotoObj(partner)}
                              initials={getPersonInitials(partner)}
                              alt={formatShortName(partner)}
                              sizeClass="h-10 w-10"
                              textSizeClass="text-sm"
                              showBorder={false}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-[14.5px] font-semibold text-stone-900 truncate">
                                <span className="truncate">{formatShortName(partner)}</span>
                                <VerificationIcon status={union.verification} size={14} />
                              </div>
                              <div className="font-editorial tabular-nums text-[13px] text-stone-500">
                                ({formatLifespan(partner)})
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteUnion(union.id)}
                            title="Разорвать связь союза"
                            className="rounded p-1 text-stone-400 hover:text-[#8B261D] cursor-pointer"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[13.5px] font-medium text-stone-600 mb-1">Статус</label>
                            <select
                              value={union.status}
                              onChange={(e) =>
                                onUpdateUnion(union.id, { status: e.target.value as UnionStatus })
                              }
                              className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-[16.5px] text-stone-800"
                            >
                              <option value="married">Брак</option>
                              <option value="partners">Гражд. союз</option>
                              <option value="divorced">Развод</option>
                              <option value="widowed">Вдовство</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                              Дата брака (дд.мм.гггг)
                            </label>
                            <input
                              type="text"
                              value={union.marriageDate || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                const next = /^\d{4}-\d{1,2}-\d{1,2}$/.test(val.trim())
                                  ? normalizeDateInputToRu(val)
                                  : val;
                                onUpdateUnion(union.id, { marriageDate: next });
                              }}
                              onBlur={(e) => {
                                const norm = normalizeDateInputToRu(e.target.value);
                                if (norm !== e.target.value) {
                                  onUpdateUnion(union.id, { marriageDate: norm });
                                }
                              }}
                              placeholder="22.09.1934"
                              className="w-full rounded border border-stone-200 px-2.5 py-1.5 tabular-nums text-[16.5px] text-stone-800"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={union.marriagePlace || ''}
                            onChange={(e) =>
                              onUpdateUnion(union.id, { marriagePlace: e.target.value })
                            }
                            placeholder="Место венчания / ЗАГС"
                            className="min-w-0 flex-1 rounded border border-stone-200 px-2.5 py-1.5 text-[16.5px] text-stone-800"
                          />
                          <VerificationSelector
                            compact
                            value={union.verification}
                            onChange={(v) => onUpdateUnion(union.id, { verification: v })}
                          />
                        </div>

                        <DocumentList
                          documents={union.documents || []}
                          onChange={(docs) => onUpdateUnion(union.id, { documents: docs })}
                          label="Свидетельство о браке"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Children */}
              <div className="space-y-2">
                <div className="text-[14.5px] font-semibold text-stone-700">Дети</div>
                {children.length === 0 ? (
                  <p className="text-[14.5px] text-stone-400">Не указаны</p>
                ) : (
                  <div className="space-y-1.5">
                    {children.map(({ person: c, link }) => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-white px-3 py-2"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectPerson(c.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-[#8B261D] cursor-pointer"
                        >
                          <CroppedCircleAvatar
                            photo={getPrimaryPhotoObj(c)}
                            initials={getPersonInitials(c)}
                            alt={formatShortName(c)}
                            sizeClass="h-10 w-10"
                            textSizeClass="text-sm"
                            showBorder={false}
                          />
                          <div className="min-w-0">
                            <div className="text-[14.5px] font-medium text-stone-900 truncate">
                              {formatShortName(c)}
                            </div>
                            <div className="font-editorial tabular-nums text-[13px] text-stone-500">
                              ({formatLifespan(c)})
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <VerificationSelector
                            compact
                            value={link.verification}
                            onChange={(v) => onUpdateParentChild(link.id, { verification: v })}
                          />
                          <button
                            type="button"
                            onClick={() => onDeleteParentChild(link.id)}
                            title="Удалить связь"
                            className="rounded p-1 text-stone-400 hover:text-[#8B261D] cursor-pointer"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {siblings.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[14.5px] font-semibold text-stone-700">Братья и сёстры</div>
                  <div className="space-y-1.5">
                    {siblings.map((sib) => (
                      <button
                        key={sib.id}
                        type="button"
                        onClick={() => onSelectPerson(sib.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-md border border-stone-200 bg-white px-3 py-2 text-left hover:border-stone-300 cursor-pointer"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <CroppedCircleAvatar
                            photo={getPrimaryPhotoObj(sib)}
                            initials={getPersonInitials(sib)}
                            alt={formatShortName(sib)}
                            sizeClass="h-10 w-10"
                            textSizeClass="text-sm"
                            showBorder={false}
                          />
                          <span className="text-[14.5px] font-medium text-stone-900 truncate">
                            {formatShortName(sib)}
                          </span>
                        </div>
                        <span className="font-editorial tabular-nums text-[13px] text-stone-500 shrink-0">
                          ({formatLifespan(sib)})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'photos' && (
            <div className="space-y-4">
              {/* Search by tagged people across all family photos */}
              <div className="space-y-1">
                <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                  Поиск по персонам на фотографиях
                </label>
                <div className="flex items-center rounded-md border border-stone-200 bg-white px-3 py-1.5">
                  <Search size={15} className="text-stone-400 mr-2 shrink-0" />
                  <input
                    type="text"
                    value={photoPersonSearch}
                    onChange={(e) => setPhotoPersonSearch(e.target.value)}
                    placeholder="Поиск"
                    className="w-full bg-transparent text-[16.5px] text-stone-900 placeholder:text-stone-400 focus:outline-none"
                  />
                  {photoPersonSearch && (
                    <button
                      type="button"
                      onClick={() => setPhotoPersonSearch('')}
                      aria-label="Очистить поиск по фото"
                      className="text-stone-400 hover:text-stone-700 cursor-pointer"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white px-4 py-4 text-center hover:border-[#8B261D] transition-colors">
                  <Camera size={21} className="text-[#8B261D]" />
                  <span className="text-[14.5px] font-medium text-stone-800">
                    {isUploadingPhoto ? 'Обработка снимков...' : 'Загрузить и кадрировать фото'}
                  </span>
                  <span className="text-[12.5px] text-stone-500">
                    JPEG, PNG, WebP с устройства
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handlePhotoUpload}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => {
                    setArchivePickerQuery('');
                    setShowArchivePicker(true);
                  }}
                  className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white px-4 py-4 text-center hover:border-[#8B261D] transition-colors"
                >
                  <FolderOpen size={21} className="text-[#8B261D]" />
                  <span className="text-[14.5px] font-medium text-stone-800">
                    Выбрать из фотоархива
                  </span>
                  <span className="text-[12.5px] text-stone-500">
                    Общий архив и семейные снимки · с кадрированием
                  </span>
                </button>
              </div>

              {(() => {
                const searching = photoPersonSearch.trim().length > 0;
                const displayItems: Array<{
                  owner: Person | null;
                  ownerId: string;
                  photo: PhotoAttachment;
                  isExternal: boolean;
                }> = searching
                  ? photoSearchResults.map((item) => ({
                      ...item,
                      isExternal: item.ownerId !== person.id,
                    }))
                  : [
                      ...person.photos.map((photo) => ({
                        owner: person,
                        ownerId: person.id,
                        photo,
                        isExternal: false,
                      })),
                      ...taggedElsewherePhotos.map((item) => ({
                        ...item,
                        isExternal: true,
                      })),
                    ];

                if (displayItems.length === 0) {
                  return (
                    <p className="py-4 text-center text-[14.5px] text-stone-500">
                      {searching
                        ? 'Фотографии с отмеченной персоной по этому запросу не найдены.'
                        : 'К досье пока не прикреплены фотографии.'}
                    </p>
                  );
                }

                return (
                  <div className="w-full space-y-4">
                    {searching && (
                      <div className="text-[13.5px] font-medium text-stone-600">
                        Найдено фотографий: {displayItems.length}
                      </div>
                    )}

                    {displayItems.map(({ owner, ownerId, photo, isExternal }) => {
                      const bytes = estimateDataUrlBytes(photo.dataUrl);
                      const photoKey = `${ownerId}:${photo.id}`;
                      const isTagging = taggingPhotoKey === photoKey;
                      const pendingHere =
                        pendingTagFrame &&
                        pendingTagFrame.ownerId === ownerId &&
                        pendingTagFrame.photoId === photo.id
                          ? pendingTagFrame.frame
                          : null;
                      const tags = photo.tags || [];
                      const pickerMatches = allPeopleSorted.filter((p) => {
                        const q = tagPickerQuery.trim().toLowerCase();
                        if (!q) return true;
                        return `${p.lastName} ${p.firstName} ${p.middleName || ''} ${
                          p.maidenName || ''
                        }`
                          .toLowerCase()
                          .includes(q);
                      });

                      return (
                        <div
                          key={photoKey}
                          className="w-full overflow-hidden rounded-lg border border-stone-200 bg-white"
                        >
                          {isExternal && (
                            <div className="flex items-center justify-between border-b border-stone-100 bg-[#FBF9F5] px-3.5 py-1.5 text-[13px] text-stone-600">
                              {owner ? (
                                <span>
                                  Снимок из альбома:{' '}
                                  <button
                                    type="button"
                                    onClick={() => onSelectPerson(owner.id)}
                                    className="font-semibold text-stone-800 hover:text-[#8B261D] cursor-pointer"
                                  >
                                    {formatFullName(owner)}
                                  </button>
                                </span>
                              ) : (
                                <span>Материал из раздела ФОТОАРХИВ</span>
                              )}
                            </div>
                          )}

                          <div className="relative flex min-h-[220px] w-full items-center justify-center bg-stone-100 p-3">
                            <PhotoTagFrameLayer
                              src={photo.dataUrl}
                              alt={photo.caption || (owner ? formatShortName(owner) : 'Фотография')}
                              tags={tags}
                              persons={tree.persons}
                              imgClassName="block max-h-80 w-auto rounded object-contain"
                              isTagging={isTagging}
                              pendingFrame={pendingHere}
                              hoveredTagId={hoveredTagId}
                              onHoverTagChange={setHoveredTagId}
                              onFrameDrawn={(frame) => {
                                setPendingTagFrame({ ownerId, photoId: photo.id, frame });
                                setTagPickerQuery('');
                              }}
                              onTagClick={(pid) => onSelectPerson(pid)}
                              onImageClick={() => setLightboxRef({ ownerId, photoId: photo.id })}
                              title={
                                isTagging
                                  ? 'Проведите рамку вокруг лица или нажмите, чтобы отметить персону'
                                  : 'Нажмите, чтобы открыть фотографию крупно'
                              }
                            />

                            <div className="absolute right-2 top-2 flex items-center gap-1">
                              {(ownerId !== '__archive__' || Boolean(onUpdateArchivePhotos)) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTaggingPhotoKey((curr) =>
                                      curr === photoKey ? null : photoKey
                                    );
                                    setPendingTagFrame(null);
                                  }}
                                  title="Отметить персону на фото"
                                  aria-label="Отметить персону на фото"
                                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[13px] font-medium cursor-pointer ${
                                    isTagging
                                      ? 'bg-[#8B261D] text-white'
                                      : 'bg-stone-900/75 text-white hover:bg-stone-900'
                                  }`}
                                >
                                  <Tag size={13} />
                                  <span className="desktop-btn-label">
                                    {isTagging ? 'Готово' : 'Отметить'}
                                  </span>
                                </button>
                              )}

                              {!isExternal && (
                                <>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCroppingPhoto(photo);
                                    }}
                                    title="Настроить кадр портрета / сжать"
                                    aria-label="Настроить кадр портрета"
                                    className="inline-flex items-center gap-1 rounded bg-stone-900/75 px-2 py-1 text-[13px] font-medium text-white hover:bg-stone-900 cursor-pointer"
                                  >
                                    <Crop size={13} />
                                    <span className="desktop-btn-label">Кадр</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeletePhoto(photo.id);
                                    }}
                                    title="Удалить фото"
                                    aria-label="Удалить фото"
                                    className="rounded bg-stone-900/75 p-1.5 text-white hover:bg-[#8B261D] cursor-pointer"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {isTagging && (
                            <div className="border-b border-stone-200 bg-[#FBF9F5] px-3.5 py-2.5 space-y-2">
                              <div className="flex items-center justify-between gap-2 text-[13px] text-stone-700">
                                <span>
                                  {pendingHere
                                    ? 'Выберите персону для выделенной рамки:'
                                    : 'Проведите рамку вокруг лица на фото (или нажмите на лицо)'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTaggingPhotoKey(null);
                                    setPendingTagFrame(null);
                                  }}
                                  className="text-[13px] font-medium text-[#8B261D] hover:underline shrink-0 cursor-pointer"
                                >
                                  Завершить
                                </button>
                              </div>

                              {pendingHere && (
                                <div className="rounded-md border border-stone-200 bg-white p-2 space-y-2">
                                  <input
                                    type="text"
                                    value={tagPickerQuery}
                                    onChange={(e) => setTagPickerQuery(e.target.value)}
                                    placeholder="Поиск"
                                    className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                                  />
                                  <div className="max-h-40 overflow-y-auto divide-y divide-stone-100">
                                    {pickerMatches.map((cand) => (
                                      <button
                                        key={cand.id}
                                        type="button"
                                        onClick={() =>
                                          handleAddPhotoTag(
                                            ownerId,
                                            photo.id,
                                            cand.id,
                                            pendingHere
                                          )
                                        }
                                        className="flex w-full items-center gap-2.5 px-2 py-1.5 text-left hover:bg-stone-50 cursor-pointer"
                                      >
                                        <CroppedCircleAvatar
                                          photo={getPrimaryPhotoObj(cand)}
                                          initials={getPersonInitials(cand)}
                                          alt={formatShortName(cand)}
                                          sizeClass="h-7 w-7"
                                          textSizeClass="text-xs"
                                          showBorder={false}
                                        />
                                        <span className="text-[14px] text-stone-900 truncate">
                                          {formatFullName(cand)}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="p-3.5 space-y-2.5">
                            {/* Tagged people chips */}
                            {tags.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 pb-1.5 border-b border-stone-100">
                                <span className="text-[13px] text-stone-500 mr-0.5">
                                  На фото:
                                </span>
                                {tags.map((tag) => {
                                  const tp = tree.persons[tag.personId];
                                  if (!tp) return null;
                                  return (
                                    <span
                                      key={tag.id}
                                      onMouseEnter={() => setHoveredTagId(tag.id)}
                                      onMouseLeave={() => setHoveredTagId(null)}
                                      className={`inline-flex items-center gap-1 rounded-full border pl-2 pr-1 py-0.5 text-[13px] transition-colors ${
                                        hoveredTagId === tag.id
                                          ? 'border-[#8B261D]/50 bg-[#8B261D]/5 text-stone-900'
                                          : 'border-stone-200 bg-[#FBF9F5] text-stone-800'
                                      }`}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => onSelectPerson(tp.id)}
                                        className="hover:text-[#8B261D] cursor-pointer"
                                      >
                                        {formatFullName(tp)}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleRemovePhotoTag(ownerId, photo.id, tag.id)
                                        }
                                        title="Убрать отметку"
                                        aria-label="Убрать отметку"
                                        className="rounded-full p-0.5 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700 cursor-pointer"
                                      >
                                        <X size={11} />
                                      </button>
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {/* Centered italic non-bold caption + year directly beneath the photo */}
                            {(photo.caption || photo.year) && (
                              <div className="text-center space-y-0.5 pb-1.5 border-b border-stone-100">
                                {photo.caption && (
                                  <div className="font-editorial text-base italic font-normal leading-snug text-stone-900">
                                    {photo.caption}
                                  </div>
                                )}
                                {photo.year && (
                                  <div className="font-editorial tabular-nums text-sm text-stone-500">
                                    {photo.year}
                                  </div>
                                )}
                              </div>
                            )}

                            {!isExternal && (
                              <>
                                <div className="grid grid-cols-1 sm:grid-cols-[1fr_96px] gap-2">
                                  <div>
                                    <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                                      Подпись к снимку
                                    </label>
                                    <input
                                      type="text"
                                      value={photo.caption || ''}
                                      onChange={(e) =>
                                        handleUpdatePhotoMeta(ownerId, photo.id, {
                                          caption: e.target.value,
                                        })
                                      }
                                      placeholder="Подпись к снимку..."
                                      className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-center text-[16.5px] italic font-normal text-stone-800"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                                      Год
                                    </label>
                                    <input
                                      type="text"
                                      value={photo.year || ''}
                                      onChange={(e) =>
                                        handleUpdatePhotoMeta(ownerId, photo.id, {
                                          year: e.target.value,
                                        })
                                      }
                                      placeholder="Год"
                                      className="w-full rounded border border-stone-200 px-2 py-1.5 text-center tabular-nums text-[16.5px] text-stone-800"
                                    />
                                  </div>
                                </div>

                                <div className="flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSetPrimaryPhoto(photo.id)}
                                    className={`inline-flex items-center gap-1.5 text-[14.5px] font-medium cursor-pointer ${
                                      photo.isPrimary
                                        ? 'text-[#15803D]'
                                        : 'text-stone-500 hover:text-stone-900'
                                    }`}
                                  >
                                    {photo.isPrimary ? (
                                      <>
                                        <Check size={14} />
                                        <span>Главный портрет</span>
                                      </>
                                    ) : (
                                      <>
                                        <Star size={14} />
                                        <span>Сделать главным</span>
                                      </>
                                    )}
                                  </button>
                                  {bytes > 0 && (
                                    <span className="tabular-nums text-[13px] text-stone-400">
                                      {formatBytes(bytes)}
                                    </span>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Portrait Crop Modal */}
      {croppingPhoto && (
        <PhotoCropModal
          photo={croppingPhoto}
          onSave={handleSaveCroppedPhoto}
          onClose={() => setCroppingPhoto(null)}
        />
      )}

      {/* Archive Photo Picker Modal */}
      {showArchivePicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/65 p-4"
          onClick={() => setShowArchivePicker(false)}
        >
          <div
            className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-stone-200 bg-[#FBF9F5] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3.5">
              <div>
                <h3 className="font-editorial text-xl font-semibold text-stone-900">
                  Выбрать фото из фотоархива
                </h3>
                <p className="text-[13px] text-stone-500">
                  Нажмите на снимок, чтобы назначить его портретом и при необходимости кадрировать лицо
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowArchivePicker(false)}
                aria-label="Закрыть выбор из фотоархива"
                className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white/80 px-4 py-2.5">
              <div className="flex min-w-[200px] flex-1 items-center rounded-md border border-stone-200 bg-white px-2.5 py-1.5">
                <Search size={14} className="mr-1.5 shrink-0 text-stone-400" />
                <input
                  type="text"
                  value={archivePickerQuery}
                  onChange={(e) => setArchivePickerQuery(e.target.value)}
                  placeholder="Поиск по подписи, году или персоне..."
                  className="w-full bg-transparent text-[15px] text-stone-900 placeholder:text-stone-400 focus:outline-none"
                />
                {archivePickerQuery && (
                  <button
                    type="button"
                    onClick={() => setArchivePickerQuery('')}
                    className="text-stone-400 hover:text-stone-700 cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="inline-flex rounded-md border border-stone-200 bg-stone-100 p-0.5 text-[13px]">
                <button
                  type="button"
                  onClick={() => setArchivePickerScope('all')}
                  className={`rounded px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                    archivePickerScope === 'all'
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Все снимки
                </button>
                <button
                  type="button"
                  onClick={() => setArchivePickerScope('archive')}
                  className={`rounded px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                    archivePickerScope === 'archive'
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Общий архив ({(tree.archivePhotos || []).length})
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {archivePickerItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center text-stone-500">
                  <ImageIcon size={28} className="mb-2 text-stone-300" />
                  <p className="text-[14.5px]">
                    {archivePickerQuery
                      ? 'Подходящие снимки не найдены.'
                      : 'В фотоархиве пока нет снимков.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {archivePickerItems.map((item) => {
                    const alreadyInCard = person.photos.some(
                      (ph) => ph.dataUrl === item.photo.dataUrl
                    );
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handlePickPhotoFromArchive(item.photo)}
                        className={`group flex flex-col overflow-hidden rounded-lg border bg-white text-left transition-all cursor-pointer hover:border-[#8B261D] hover:shadow-md ${
                          alreadyInCard ? 'border-[#15803D]/60' : 'border-stone-200'
                        }`}
                      >
                        <div className="relative aspect-square w-full overflow-hidden bg-stone-100">
                          <img
                            src={item.photo.dataUrl}
                            alt={item.photo.caption || 'Снимок из архива'}
                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          />
                          <span className="absolute left-1.5 top-1.5 rounded bg-stone-900/75 px-1.5 py-0.5 text-[11px] text-white">
                            {item.isArchive ? 'Фотоархив' : item.sourceLabel}
                          </span>
                          {alreadyInCard && (
                            <span className="absolute right-1.5 top-1.5 rounded bg-[#15803D] px-1.5 py-0.5 text-[11px] font-medium text-white">
                              В карточке
                            </span>
                          )}
                        </div>
                        <div className="p-2 space-y-0.5">
                          <div className="truncate text-[13px] font-medium text-stone-800">
                            {item.photo.caption || 'Без подписи'}
                          </div>
                          {item.photo.year && (
                            <div className="font-editorial tabular-nums text-[12px] text-stone-500">
                              {item.photo.year}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox Modal */}
      {liveLightbox && (() => {
        const { owner, ownerId, photo } = liveLightbox;
        const photoKey = `${ownerId}:${photo.id}`;
        const isTagging = taggingPhotoKey === photoKey;
        const pendingHere =
          pendingTagFrame &&
          pendingTagFrame.ownerId === ownerId &&
          pendingTagFrame.photoId === photo.id
            ? pendingTagFrame.frame
            : null;
        const tags = photo.tags || [];
        const pickerMatches = allPeopleSorted.filter((p) => {
          const q = tagPickerQuery.trim().toLowerCase();
          if (!q) return true;
          return `${p.lastName} ${p.firstName} ${p.middleName || ''} ${p.maidenName || ''}`
            .toLowerCase()
            .includes(q);
        });

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/85 p-4 sm:p-6"
            onClick={() => {
              setLightboxRef(null);
              setPendingTagFrame(null);
            }}
          >
            <div
              className="relative max-h-[92vh] max-w-4xl overflow-y-auto rounded-xl bg-[#FBF9F5] p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setLightboxRef(null);
                  setPendingTagFrame(null);
                }}
                aria-label="Закрыть просмотр фотографии"
                className="absolute right-2.5 top-2.5 z-10 rounded-full p-1.5 text-stone-400/70 hover:bg-stone-200/45 hover:text-stone-700 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>

              {(ownerId !== '__archive__' || Boolean(onUpdateArchivePhotos)) && (
                <div className="mb-2 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setTaggingPhotoKey((curr) => (curr === photoKey ? null : photoKey));
                      setPendingTagFrame(null);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] font-medium transition-colors cursor-pointer ${
                      isTagging
                        ? 'border-[#8B261D] bg-[#8B261D] text-white'
                        : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300'
                    }`}
                  >
                    <Tag size={13} />
                    <span>
                      {isTagging
                        ? 'Проведите рамку вокруг лица на фото'
                        : 'Отметить персону'}
                    </span>
                  </button>
                </div>
              )}

              <div className="flex justify-center">
                <PhotoTagFrameLayer
                  src={photo.dataUrl}
                  alt={photo.caption || (owner ? formatShortName(owner) : 'Семейное фото')}
                  tags={tags}
                  persons={tree.persons}
                  imgClassName="max-h-[70vh] w-auto rounded object-contain mx-auto block"
                  isTagging={isTagging}
                  pendingFrame={pendingHere}
                  hoveredTagId={hoveredTagId}
                  onHoverTagChange={setHoveredTagId}
                  onFrameDrawn={(frame) => {
                    setPendingTagFrame({ ownerId, photoId: photo.id, frame });
                    setTagPickerQuery('');
                  }}
                  onTagClick={(pid) => {
                    setLightboxRef(null);
                    onSelectPerson(pid);
                  }}
                />
              </div>

              {pendingHere && (
                <div className="mx-auto mt-3 max-w-md rounded-md border border-stone-200 bg-white p-2.5 space-y-2">
                  <input
                    type="text"
                    value={tagPickerQuery}
                    onChange={(e) => setTagPickerQuery(e.target.value)}
                    placeholder="Поиск"
                    className="w-full rounded border border-stone-200 px-2.5 py-1.5 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                  />
                  <div className="max-h-36 overflow-y-auto divide-y divide-stone-100">
                    {pickerMatches.map((cand) => (
                      <button
                        key={cand.id}
                        type="button"
                        onClick={() =>
                          handleAddPhotoTag(
                            ownerId,
                            photo.id,
                            cand.id,
                            pendingHere
                          )
                        }
                        className="flex w-full items-center gap-2.5 px-2 py-1.5 text-left hover:bg-stone-50 cursor-pointer"
                      >
                        <CroppedCircleAvatar
                          photo={getPrimaryPhotoObj(cand)}
                          initials={getPersonInitials(cand)}
                          alt={formatShortName(cand)}
                          sizeClass="h-7 w-7"
                          textSizeClass="text-xs"
                          showBorder={false}
                        />
                        <span className="text-[14px] text-stone-900 truncate">
                          {formatFullName(cand)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(photo.caption || photo.year) && (
                <div className="mt-3 px-4 text-center space-y-0.5">
                  {photo.caption && (
                    <div className="font-editorial text-xl italic font-normal text-stone-900">
                      {photo.caption}
                    </div>
                  )}
                  {photo.year && (
                    <div className="font-editorial tabular-nums text-base text-stone-500">
                      {photo.year}
                    </div>
                  )}
                </div>
              )}

              {tags.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 px-2">
                  <span className="text-[13px] text-stone-500">На фото:</span>
                  {tags.map((tag) => {
                    const tp = tree.persons[tag.personId];
                    if (!tp) return null;
                    return (
                      <span
                        key={tag.id}
                        onMouseEnter={() => setHoveredTagId(tag.id)}
                        onMouseLeave={() => setHoveredTagId(null)}
                        className={`inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-0.5 text-[13px] transition-colors ${
                          hoveredTagId === tag.id
                            ? 'border-[#8B261D]/50 bg-[#8B261D]/5 text-stone-900'
                            : 'border-stone-200 bg-white text-stone-800'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setLightboxRef(null);
                            onSelectPerson(tp.id);
                          }}
                          className="hover:text-[#8B261D] cursor-pointer"
                        >
                          {formatFullName(tp)}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemovePhotoTag(ownerId, photo.id, tag.id)}
                          title="Убрать отметку"
                          aria-label="Убрать отметку"
                          className="rounded-full p-0.5 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700 cursor-pointer"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}

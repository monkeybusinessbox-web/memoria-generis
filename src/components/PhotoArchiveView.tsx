import React, { useMemo, useState } from 'react';
import {
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  List,
  MapPin,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import {
  ArchiveCategory,
  Person,
  PhotoAttachment,
  TreeDocument,
} from '../types/genealogy';
import {
  createId,
  estimateDataUrlBytes,
  formatBytes,
  formatFullName,
  formatGenealogyDate,
  formatShortName,
  getPersonInitials,
  getPrimaryPhotoObj,
  normalizeDateInputToRu,
  parseGenealogyDate,
} from '../utils/dateUtils';
import { compressImageFile } from '../utils/storage';
import { CroppedCircleAvatar } from './PhotoCropModal';
import { PhotoTagFrameLayer, TagFrameRect } from './PhotoTagFrameLayer';

interface PhotoArchiveViewProps {
  tree: TreeDocument;
  onUpdatePerson: (personId: string, patch: Partial<Person>) => void;
  onUpdateArchivePhotos: (updater: (curr: PhotoAttachment[]) => PhotoAttachment[]) => void;
  onOpenPersonInTree: (personId: string) => void;
}

type CategoryFilter = 'all' | ArchiveCategory;
type SortMode = 'date_asc' | 'date_desc' | 'title' | 'undated' | 'untagged';
type DisplayLayout = 'grid' | 'catalog';

const ARCHIVE_CATEGORY_LABELS: Record<ArchiveCategory, string> = {
  portrait: 'Портреты',
  group: 'Групповые снимки',
  documents: 'Документы',
  letters: 'Письма',
  certificates: 'Справки',
  places: 'Места',
  other: 'Прочее',
};

const CATEGORY_ORDER: ArchiveCategory[] = [
  'portrait',
  'group',
  'documents',
  'letters',
  'certificates',
  'places',
  'other',
];

interface UnifiedArchiveItem {
  key: string;
  source: 'archive' | 'person';
  ownerId?: string;
  owner?: Person;
  photo: PhotoAttachment;
  effectiveCategory: ArchiveCategory;
  sortKey: number;
  dateLabel: string;
}

function resolveItemSortKey(photo: PhotoAttachment): number {
  const dateStr = (photo.date || photo.year || '').trim();
  if (!dateStr) return Number.MAX_SAFE_INTEGER;
  const parsed = parseGenealogyDate(dateStr);
  if (parsed.sortKey !== Number.MAX_SAFE_INTEGER) return parsed.sortKey;
  const yearMatch = dateStr.match(/\b(\d{4})\b/);
  if (yearMatch) return Number(yearMatch[1]) * 10000;
  return Number.MAX_SAFE_INTEGER;
}

function resolveItemDateLabel(photo: PhotoAttachment): string {
  if (photo.date) {
    return formatGenealogyDate(photo.date) || photo.date;
  }
  if (photo.year) return photo.year;
  return '';
}

function resolveDefaultCategory(
  photo: PhotoAttachment,
  source: 'archive' | 'person'
): ArchiveCategory {
  if (photo.category) return photo.category;
  if ((photo.tags || []).length > 1) return 'group';
  if (source === 'person') return 'portrait';
  return 'other';
}

export function PhotoArchiveView({
  tree,
  onUpdatePerson,
  onUpdateArchivePhotos,
  onOpenPersonInTree,
}: PhotoArchiveViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [personFilter, setPersonFilter] = useState<string>('all');
  const [customTagFilter, setCustomTagFilter] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('date_asc');
  const [displayLayout, setDisplayLayout] = useState<DisplayLayout>('grid');
  const [uploadCategory, setUploadCategory] = useState<ArchiveCategory>('documents');
  const [isUploading, setIsUploading] = useState(false);

  // Lightbox / Archival Inspector state
  const [selectedRef, setSelectedRef] = useState<{
    source: 'archive' | 'person';
    ownerId?: string;
    photoId: string;
  } | null>(null);
  const [isTagging, setIsTagging] = useState(false);
  const [fullscreenView, setFullscreenView] = useState(false);
  const [pendingFrame, setPendingFrame] = useState<TagFrameRect | null>(null);
  const [tagPickerQuery, setTagPickerQuery] = useState('');
  const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);
  const [newCustomTagInput, setNewCustomTagInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const allPeopleSorted = useMemo(
    () =>
      Object.values(tree.persons).sort((a, b) =>
        formatFullName(a).localeCompare(formatFullName(b), 'ru')
      ),
    [tree.persons]
  );

  // Aggregate both general archive items (documents, letters, certificates, group photos)
  // and person-attached photos into a single searchable catalog.
  const allItems = useMemo<UnifiedArchiveItem[]>(() => {
    const items: UnifiedArchiveItem[] = [];

    for (const ph of tree.archivePhotos || []) {
      items.push({
        key: `archive:${ph.id}`,
        source: 'archive',
        photo: ph,
        effectiveCategory: resolveDefaultCategory(ph, 'archive'),
        sortKey: resolveItemSortKey(ph),
        dateLabel: resolveItemDateLabel(ph),
      });
    }

    for (const p of allPeopleSorted) {
      for (const ph of p.photos) {
        items.push({
          key: `person:${p.id}:${ph.id}`,
          source: 'person',
          ownerId: p.id,
          owner: p,
          photo: ph,
          effectiveCategory: resolveDefaultCategory(ph, 'person'),
          sortKey: resolveItemSortKey(ph),
          dateLabel: resolveItemDateLabel(ph),
        });
      }
    }

    return items;
  }, [allPeopleSorted, tree.archivePhotos]);

  const categoryCounts = useMemo(() => {
    const counts: Record<ArchiveCategory, number> = {
      portrait: 0,
      group: 0,
      documents: 0,
      letters: 0,
      certificates: 0,
      places: 0,
      other: 0,
    };
    for (const item of allItems) {
      counts[item.effectiveCategory] += 1;
    }
    return counts;
  }, [allItems]);

  const allCustomTags = useMemo(() => {
    const tagMap = new Map<string, number>();
    for (const item of allItems) {
      for (const tag of item.photo.customTags || []) {
        const clean = tag.trim();
        if (!clean) continue;
        tagMap.set(clean, (tagMap.get(clean) || 0) + 1);
      }
    }
    return Array.from(tagMap.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], 'ru')
    );
  }, [allItems]);

  const archiveSummary = useMemo(() => {
    const dated = allItems.filter(
      (i) => Boolean(i.photo.date?.trim() || i.photo.year?.trim())
    ).length;
    const withTaggedPeople = allItems.filter(
      (i) => (i.photo.tags || []).length > 0 || i.source === 'person'
    ).length;
    const totalBytes = allItems.reduce(
      (s, i) => s + estimateDataUrlBytes(i.photo.dataUrl),
      0
    );
    return {
      total: allItems.length,
      dated,
      withTaggedPeople,
      totalBytes,
    };
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = allItems.filter((item) => {
      if (categoryFilter !== 'all' && item.effectiveCategory !== categoryFilter) {
        return false;
      }
      if (customTagFilter !== 'all') {
        const hasTag = (item.photo.customTags || []).some(
          (t) => t.trim().toLowerCase() === customTagFilter.toLowerCase()
        );
        if (!hasTag) return false;
      }
      if (personFilter !== 'all') {
        const isOwner = item.ownerId === personFilter;
        const isTagged = (item.photo.tags || []).some(
          (t) => t.personId === personFilter
        );
        if (!isOwner && !isTagged) return false;
      }
      if (!q) return true;

      const taggedNames = (item.photo.tags || [])
        .map((t) => tree.persons[t.personId])
        .filter((p): p is Person => Boolean(p))
        .map((p) => `${p.lastName} ${p.firstName} ${p.middleName || ''} ${p.maidenName || ''}`)
        .join(' ');
      const ownerName = item.owner
        ? `${item.owner.lastName} ${item.owner.firstName} ${item.owner.middleName || ''}`
        : '';
      const haystack = [
        item.photo.caption || '',
        item.photo.date || '',
        item.photo.year || '',
        item.photo.place || '',
        item.photo.archiveRef || '',
        item.photo.notes || '',
        (item.photo.customTags || []).join(' '),
        ARCHIVE_CATEGORY_LABELS[item.effectiveCategory],
        ownerName,
        taggedNames,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });

    list.sort((a, b) => {
      if (sortMode === 'date_asc') {
        if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
        return (a.photo.caption || '').localeCompare(b.photo.caption || '', 'ru');
      }
      if (sortMode === 'date_desc') {
        const aUndated = a.sortKey === Number.MAX_SAFE_INTEGER;
        const bUndated = b.sortKey === Number.MAX_SAFE_INTEGER;
        if (aUndated !== bUndated) return aUndated ? 1 : -1;
        if (a.sortKey !== b.sortKey) return b.sortKey - a.sortKey;
        return (a.photo.caption || '').localeCompare(b.photo.caption || '', 'ru');
      }
      if (sortMode === 'title') {
        return (a.photo.caption || 'Без названия').localeCompare(
          b.photo.caption || 'Без названия',
          'ru'
        );
      }
      if (sortMode === 'undated') {
        const aUndated = a.sortKey === Number.MAX_SAFE_INTEGER ? 0 : 1;
        const bUndated = b.sortKey === Number.MAX_SAFE_INTEGER ? 0 : 1;
        if (aUndated !== bUndated) return aUndated - bUndated;
        return a.sortKey - b.sortKey;
      }
      if (sortMode === 'untagged') {
        const aCount = (a.photo.tags || []).length;
        const bCount = (b.photo.tags || []).length;
        if (aCount !== bCount) return aCount - bCount;
        return a.sortKey - b.sortKey;
      }
      return 0;
    });

    return list;
  }, [
    allItems,
    categoryFilter,
    customTagFilter,
    personFilter,
    searchQuery,
    sortMode,
    tree.persons,
  ]);

  const activeItem = useMemo<UnifiedArchiveItem | null>(() => {
    if (!selectedRef) return null;
    return (
      allItems.find((item) => {
        if (item.source !== selectedRef.source) return false;
        if (item.source === 'person' && item.ownerId !== selectedRef.ownerId) return false;
        return item.photo.id === selectedRef.photoId;
      }) || null
    );
  }, [allItems, selectedRef]);

  const updatePhotoItem = (
    item: UnifiedArchiveItem,
    patch: Partial<PhotoAttachment>
  ) => {
    if (item.source === 'archive') {
      onUpdateArchivePhotos((curr) =>
        curr.map((ph) => (ph.id === item.photo.id ? { ...ph, ...patch } : ph))
      );
      return;
    }
    if (item.ownerId) {
      const owner = tree.persons[item.ownerId];
      if (!owner) return;
      onUpdatePerson(item.ownerId, {
        photos: owner.photos.map((ph) =>
          ph.id === item.photo.id ? { ...ph, ...patch } : ph
        ),
      });
    }
  };

  const handleDeleteItem = (item: UnifiedArchiveItem) => {
    if (item.source === 'archive') {
      onUpdateArchivePhotos((curr) => curr.filter((ph) => ph.id !== item.photo.id));
    } else if (item.ownerId) {
      const owner = tree.persons[item.ownerId];
      if (owner) {
        const nextPhotos = owner.photos.filter((ph) => ph.id !== item.photo.id);
        if (nextPhotos.length > 0 && !nextPhotos.some((ph) => ph.isPrimary)) {
          nextPhotos[0] = { ...nextPhotos[0], isPrimary: true };
        }
        onUpdatePerson(item.ownerId, { photos: nextPhotos });
      }
    }
    setSelectedRef(null);
    setConfirmDelete(false);
    setIsTagging(false);
    setPendingFrame(null);
  };

  const handleUploadArchiveFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      const added: PhotoAttachment[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dataUrl = await compressImageFile(file, 1200, 0.86);
        added.push({
          id: createId('arch'),
          dataUrl,
          caption: file.name.replace(/\.[^.]+$/, ''),
          category: uploadCategory,
          customTags: [],
          tags: [],
          crop: { x: 0, y: 0, zoom: 1 },
        });
      }
      onUpdateArchivePhotos((curr) => [...added, ...curr]);
      if (added[0]) {
        setSelectedRef({ source: 'archive', photoId: added[0].id });
        setIsTagging(false);
        setPendingFrame(null);
        setConfirmDelete(false);
      }
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleAssignPersonFrame = (
    item: UnifiedArchiveItem,
    personId: string,
    frame: TagFrameRect
  ) => {
    const nextTag = {
      id: createId('tag'),
      personId,
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
    };
    const filtered = (item.photo.tags || []).filter((t) => t.personId !== personId);
    updatePhotoItem(item, { tags: [...filtered, nextTag] });
    setPendingFrame(null);
    setTagPickerQuery('');
  };

  const handleRemovePersonTag = (item: UnifiedArchiveItem, tagId: string) => {
    updatePhotoItem(item, {
      tags: (item.photo.tags || []).filter((t) => t.id !== tagId),
    });
  };

  const handleAddCustomTag = (item: UnifiedArchiveItem, rawTag: string) => {
    const clean = rawTag.trim().replace(/^#/, '');
    if (!clean) return;
    const existing = item.photo.customTags || [];
    if (existing.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setNewCustomTagInput('');
      return;
    }
    updatePhotoItem(item, { customTags: [...existing, clean] });
    setNewCustomTagInput('');
  };

  const handleRemoveCustomTag = (item: UnifiedArchiveItem, tagToRemove: string) => {
    updatePhotoItem(item, {
      customTags: (item.photo.customTags || []).filter((t) => t !== tagToRemove),
    });
  };

  const pickerMatches = useMemo(() => {
    const q = tagPickerQuery.trim().toLowerCase();
    return allPeopleSorted.filter((p) => {
      if (!q) return true;
      return `${p.lastName} ${p.firstName} ${p.middleName || ''} ${p.maidenName || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [allPeopleSorted, tagPickerQuery]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#FBF9F5]">
      {/* Header & Controls */}
      <div className="border-b border-stone-200 bg-white px-4 py-3.5 sm:px-6 lg:px-8 shrink-0 space-y-3">
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-editorial text-xl sm:text-2xl font-semibold text-stone-900">
                Фотоархив и документы
              </h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-stone-500">
                <span>Материалов: {archiveSummary.total}</span>
                <span aria-hidden="true">·</span>
                <span>С датой: {archiveSummary.dated}</span>
                <span aria-hidden="true">·</span>
                <span>С персонами: {archiveSummary.withTaggedPeople}</span>
                {archiveSummary.totalBytes > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatBytes(archiveSummary.totalBytes)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Upload Archive Item Bar */}
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value as ArchiveCategory)}
                aria-label="Категория загружаемых материалов"
                title="Категория при загрузке"
                className="h-9 rounded-md border border-stone-200 bg-[#FBF9F5] px-2.5 text-[15px] text-stone-700 focus:border-[#8B261D] focus:outline-none cursor-pointer"
              >
                {CATEGORY_ORDER.map((cat) => (
                  <option key={cat} value={cat}>
                    {ARCHIVE_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>

              <label
                title="Загрузить фотографии, документы, письма или справки"
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-[#8B261D] px-3 text-[14.5px] font-medium text-white hover:bg-[#741E17] transition-colors"
              >
                <Upload size={15} />
                <span className="desktop-btn-label">
                  {isUploading ? 'Загрузка...' : 'Добавить материал'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleUploadArchiveFiles}
                />
              </label>
            </div>
          </div>

          {/* Search, Filters & Sort Row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 min-w-[180px] flex-1 items-center rounded-md border border-stone-200 bg-[#FBF9F5] px-2.5">
              <Search size={15} className="text-stone-400 mr-2 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск"
                className="w-full bg-transparent text-[16px] text-stone-900 placeholder:text-stone-400 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Очистить поиск"
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              aria-label="Фильтр по персоне"
              className="h-9 max-w-[220px] rounded-md border border-stone-200 bg-white px-2.5 text-[15px] text-stone-700 focus:border-[#8B261D] focus:outline-none cursor-pointer"
            >
              <option value="all">Все персоны</option>
              {allPeopleSorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatFullName(p)}
                </option>
              ))}
            </select>

            {allCustomTags.length > 0 && (
              <select
                value={customTagFilter}
                onChange={(e) => setCustomTagFilter(e.target.value)}
                aria-label="Фильтр по метке"
                className="h-9 max-w-[190px] rounded-md border border-stone-200 bg-white px-2.5 text-[15px] text-stone-700 focus:border-[#8B261D] focus:outline-none cursor-pointer"
              >
                <option value="all">Все метки</option>
                {allCustomTags.map(([tag, count]) => (
                  <option key={tag} value={tag}>
                    #{tag} ({count})
                  </option>
                ))}
              </select>
            )}

            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              aria-label="Сортировка архива"
              className="h-9 rounded-md border border-stone-200 bg-white px-2.5 text-[15px] text-stone-700 focus:border-[#8B261D] focus:outline-none cursor-pointer"
            >
              <option value="date_asc">Сначала старые</option>
              <option value="date_desc">Сначала новые</option>
              <option value="title">По названию (А–Я)</option>
              <option value="undated">Без даты (для разбора)</option>
              <option value="untagged">Без отмеченных персон</option>
            </select>

            <div className="flex h-9 items-center rounded-md border border-stone-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setDisplayLayout('grid')}
                title="Сетка альбома"
                aria-label="Вид сеткой"
                className={`rounded px-2 py-1 transition-colors cursor-pointer ${
                  displayLayout === 'grid'
                    ? 'bg-[#8B261D] text-white'
                    : 'text-stone-500 hover:text-stone-900'
                }`}
              >
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                onClick={() => setDisplayLayout('catalog')}
                title="Подробная опись"
                aria-label="Вид списком"
                className={`rounded px-2 py-1 transition-colors cursor-pointer ${
                  displayLayout === 'catalog'
                    ? 'bg-[#8B261D] text-white'
                    : 'text-stone-500 hover:text-stone-900'
                }`}
              >
                <List size={15} />
              </button>
            </div>
          </div>

          {/* Category Filter Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-[13.5px] font-medium transition-colors cursor-pointer ${
                categoryFilter === 'all'
                  ? 'border-[#8B261D] bg-[#8B261D] text-white'
                  : 'border-stone-200 bg-[#FBF9F5] text-stone-700 hover:border-stone-300'
              }`}
            >
              Все · {allItems.length}
            </button>
            {CATEGORY_ORDER.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`shrink-0 rounded-md border px-2.5 py-1 text-[13.5px] font-medium transition-colors cursor-pointer ${
                  categoryFilter === cat
                    ? 'border-[#8B261D] bg-[#8B261D] text-white'
                    : 'border-stone-200 bg-[#FBF9F5] text-stone-700 hover:border-stone-300'
                }`}
              >
                {ARCHIVE_CATEGORY_LABELS[cat]} · {categoryCounts[cat]}
              </button>
            ))}
          </div>

          {/* Active Custom Tag Quick Bar (if tags exist) */}
          {allCustomTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="text-stone-400 mr-0.5">Метки:</span>
              {customTagFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setCustomTagFilter('all')}
                  className="rounded border border-stone-200 bg-white px-2 py-0.5 text-stone-500 hover:text-stone-800 cursor-pointer"
                >
                  Сбросить
                </button>
              )}
              {allCustomTags.slice(0, 14).map(([tag, count]) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    setCustomTagFilter((curr) => (curr === tag ? 'all' : tag))
                  }
                  className={`rounded border px-2 py-0.5 transition-colors cursor-pointer ${
                    customTagFilter === tag
                      ? 'border-[#8B261D] bg-[#8B261D]/10 text-[#8B261D] font-medium'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                  }`}
                >
                  #{tag} ({count})
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Archive Body */}
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
              <FolderOpen size={30} className="text-stone-400 mb-3" />
              <p className="font-editorial text-lg font-medium text-stone-800">
                {allItems.length === 0
                  ? 'Фотоархив пока пуст'
                  : 'Материалы по заданным фильтрам не найдены'}
              </p>
              <p className="mt-1 max-w-md text-[14px] text-stone-500">
                {allItems.length === 0
                  ? 'Загружайте семейные снимки, отсканированные документы, письма и справки, указывайте даты, архивные шифры и отмечайте людей.'
                  : 'Попробуйте изменить строку поиска, категорию, персону или выбранную метку.'}
              </p>
              {(searchQuery ||
                categoryFilter !== 'all' ||
                personFilter !== 'all' ||
                customTagFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCategoryFilter('all');
                    setPersonFilter('all');
                    setCustomTagFilter('all');
                  }}
                  className="mt-4 rounded-md border border-stone-300 bg-[#FBF9F5] px-3.5 py-1.5 text-[14px] font-medium text-stone-700 hover:border-stone-400 cursor-pointer"
                >
                  Сбросить фильтры
                </button>
              )}
            </div>
          ) : displayLayout === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item) => {
                const taggedPeople = (item.photo.tags || [])
                  .map((t) => tree.persons[t.personId])
                  .filter((p): p is Person => Boolean(p));

                return (
                  <div
                    key={item.key}
                    onClick={() => {
                      setSelectedRef({
                        source: item.source,
                        ownerId: item.ownerId,
                        photoId: item.photo.id,
                      });
                      setIsTagging(false);
                      setFullscreenView(false);
                      setPendingFrame(null);
                      setConfirmDelete(false);
                    }}
                    className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-stone-200 bg-white transition-all hover:border-stone-300 hover:shadow-md"
                  >
                    {/* Top Category Strip (never overlaps photo) */}
                    <div className="flex items-center justify-between gap-2 border-b border-stone-100 bg-[#FBF9F5] px-3.5 py-2 text-[14px] text-stone-600">
                      <span className="font-medium truncate">
                        {ARCHIVE_CATEGORY_LABELS[item.effectiveCategory]}
                      </span>
                      {taggedPeople.length > 0 && (
                        <span
                          title={`Отмечено персон: ${taggedPeople.length}`}
                          className="inline-flex items-center gap-1 font-medium text-stone-700 shrink-0"
                        >
                          <UserCheck size={14} className="text-[#8B261D]" />
                          <span>{taggedPeople.length}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex h-56 items-center justify-center overflow-hidden bg-stone-100 p-2">
                      <img
                        src={item.photo.dataUrl}
                        alt={item.photo.caption || 'Архивный материал'}
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full rounded object-contain transition-transform duration-200 group-hover:scale-[1.015]"
                      />
                    </div>

                    <div className="flex flex-1 flex-col justify-between p-3.5 space-y-2.5">
                      <div className="space-y-1">
                        <div className="text-center font-editorial text-[16px] italic font-normal leading-snug text-stone-900">
                          {item.photo.caption || 'Без названия'}
                        </div>

                        <div className="text-center font-editorial tabular-nums text-[15px] font-normal text-stone-500">
                          {item.dateLabel || 'Дата не указана'}
                        </div>

                        {(item.photo.place || item.photo.archiveRef) && (
                          <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 pt-1 text-[14.5px] text-stone-500">
                            {item.photo.place && (
                              <span className="inline-flex items-center gap-1 text-stone-600">
                                <MapPin size={14} className="shrink-0 text-[#8B261D]" />
                                <span>{item.photo.place}</span>
                              </span>
                            )}
                            {item.photo.archiveRef && (
                              <span className="inline-flex items-center gap-1 text-stone-500">
                                <FileText size={14} className="shrink-0 text-stone-400" />
                                <span>{item.photo.archiveRef}</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-stone-100">
                        {item.owner && (
                          <div className="text-[14.5px] text-stone-500">
                            Досье:{' '}
                            <span className="font-medium text-stone-700">
                              {formatFullName(item.owner)}
                            </span>
                          </div>
                        )}

                        {taggedPeople.length > 0 && (
                          <div className="text-[14.5px] leading-relaxed text-stone-600">
                            На фото:{' '}
                            <span className="text-stone-800">
                              {taggedPeople.map((p) => formatFullName(p)).join(', ')}
                            </span>
                          </div>
                        )}

                        {(item.photo.customTags || []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {(item.photo.customTags || []).map((tag) => (
                              <span
                                key={tag}
                                className="rounded border border-stone-200 bg-[#FBF9F5] px-2 py-0.5 text-[13.5px] text-stone-600"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => {
                const taggedPeople = (item.photo.tags || [])
                  .map((t) => tree.persons[t.personId])
                  .filter((p): p is Person => Boolean(p));

                return (
                  <div
                    key={item.key}
                    onClick={() => {
                      setSelectedRef({
                        source: item.source,
                        ownerId: item.ownerId,
                        photoId: item.photo.id,
                      });
                      setIsTagging(false);
                      setFullscreenView(false);
                      setPendingFrame(null);
                      setConfirmDelete(false);
                    }}
                    className="flex cursor-pointer flex-col sm:flex-row gap-4 rounded-xl border border-stone-200 bg-white p-3.5 transition-all hover:border-stone-300 hover:shadow-sm"
                  >
                    <div className="flex h-36 sm:h-32 sm:w-44 shrink-0 items-center justify-center rounded-lg bg-stone-100 p-1.5">
                      <img
                        src={item.photo.dataUrl}
                        alt={item.photo.caption || 'Архивный материал'}
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full rounded object-contain"
                      />
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2 text-[14.5px] text-stone-500">
                          <span className="rounded border border-stone-200 bg-[#FBF9F5] px-2.5 py-0.5 font-medium text-stone-700">
                            {ARCHIVE_CATEGORY_LABELS[item.effectiveCategory]}
                          </span>
                          <span className="font-editorial tabular-nums text-[14.5px] font-normal text-stone-500">
                            {item.dateLabel || 'Дата не указана'}
                          </span>
                          {item.photo.place && (
                            <span className="inline-flex items-center gap-1 text-stone-600">
                              <MapPin size={14} className="shrink-0 text-[#8B261D]" />
                              <span>{item.photo.place}</span>
                            </span>
                          )}
                          {item.photo.archiveRef && (
                            <span className="inline-flex items-center gap-1 text-stone-500">
                              <FileText size={14} className="shrink-0 text-stone-400" />
                              <span>{item.photo.archiveRef}</span>
                            </span>
                          )}
                        </div>

                        <div className="font-editorial text-lg italic font-normal text-stone-900">
                          {item.photo.caption || 'Без названия'}
                        </div>

                        {item.photo.notes && (
                          <p className="text-[15.5px] leading-relaxed text-stone-600 line-clamp-2">
                            {item.photo.notes}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14.5px] text-stone-500">
                        {item.owner && (
                          <span>
                            Досье: <strong className="font-medium text-stone-700">{formatFullName(item.owner)}</strong>
                          </span>
                        )}
                        {taggedPeople.length > 0 && (
                          <span>
                            Отмечены:{' '}
                            <span className="text-stone-800">
                              {taggedPeople.map((p) => formatFullName(p)).join(', ')}
                            </span>
                          </span>
                        )}
                        {(item.photo.customTags || []).map((tag) => (
                          <span
                            key={tag}
                            className="rounded border border-stone-200 bg-[#FBF9F5] px-2 py-0.5 text-[13.5px] text-stone-600"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Archival Detail & Cataloging Modal */}
      {activeItem && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/85 p-3 sm:p-6"
          onClick={() => {
            setSelectedRef(null);
            setIsTagging(false);
            setFullscreenView(false);
            setPendingFrame(null);
            setHoveredTagId(null);
          }}
        >
          <div
            className="relative flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#FBF9F5] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Unified Top Modal Header */}
            <div className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 sm:px-6 shrink-0">
              <h2 className="font-editorial text-lg sm:text-xl font-normal uppercase tracking-[0.04em] text-[#78716C]">
                ОПИСАНИЕ ФОТОГРАФИИ
              </h2>
              <button
                type="button"
                onClick={() => {
                  setSelectedRef(null);
                  setIsTagging(false);
                  setFullscreenView(false);
                  setPendingFrame(null);
                  setHoveredTagId(null);
                }}
                aria-label="Закрыть просмотр материала"
                className="rounded-full p-1.5 text-stone-400/75 hover:bg-stone-200/45 hover:text-stone-700 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1.25fr_1fr] overflow-y-auto">
              {/* Left Column: High-Res View, Tagging & Tagged People */}
              <div className="flex flex-col items-center justify-between border-b lg:border-b-0 lg:border-r border-stone-200 bg-stone-100/80 p-4 sm:p-5 space-y-3">
                <div className="flex flex-1 items-center justify-center w-full py-1">
                  <PhotoTagFrameLayer
                    src={activeItem.photo.dataUrl}
                    alt={activeItem.photo.caption || 'Архивный материал'}
                    tags={activeItem.photo.tags || []}
                    persons={tree.persons}
                    imgClassName="max-h-[56vh] w-auto rounded object-contain mx-auto block shadow-xs transition-opacity hover:opacity-95"
                    isTagging={isTagging}
                    pendingFrame={pendingFrame}
                    hoveredTagId={hoveredTagId}
                    onHoverTagChange={setHoveredTagId}
                    onFrameDrawn={(frame) => {
                      setPendingFrame(frame);
                      setTagPickerQuery('');
                    }}
                    onTagClick={(pid) => {
                      setSelectedRef(null);
                      onOpenPersonInTree(pid);
                    }}
                    onImageClick={() => setFullscreenView(true)}
                    title={
                      isTagging
                        ? 'Проведите рамку вокруг лица или нажмите, чтобы отметить персону'
                        : 'Нажмите, чтобы открыть фотографию крупно'
                    }
                  />
                </div>

                {/* Below Photo Bar: Prominent "Отметить персону" on left, Photo Size on right */}
                <div className="flex w-full items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsTagging((v) => !v);
                      setPendingFrame(null);
                    }}
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[14px] font-normal shadow-xs transition-colors cursor-pointer ${
                      isTagging
                        ? 'border-[#741E17] bg-[#741E17] text-white ring-2 ring-[#8B261D]/30'
                        : 'border-[#8B261D] bg-[#8B261D] text-white hover:border-[#741E17] hover:bg-[#741E17]'
                    }`}
                  >
                    <Tag size={15} />
                    <span>
                      {isTagging
                        ? 'Проведите рамку вокруг лица'
                        : 'Отметить персону'}
                    </span>
                  </button>

                  <span className="inline-flex items-center gap-1 text-[13px] font-medium text-stone-500">
                    <ImageIcon size={13} />
                    <span className="tabular-nums">
                      {formatBytes(estimateDataUrlBytes(activeItem.photo.dataUrl))}
                    </span>
                  </span>
                </div>

                {pendingFrame && (
                  <div className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-2.5 space-y-2 shadow-sm">
                    <div className="flex items-center justify-between text-[13px] text-stone-600">
                      <span>Выберите персону для рамки:</span>
                      <button
                        type="button"
                        onClick={() => setPendingFrame(null)}
                        className="text-stone-400 hover:text-stone-700 cursor-pointer"
                      >
                        Отмена
                      </button>
                    </div>
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
                            handleAssignPersonFrame(activeItem, cand.id, pendingFrame)
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

                {/* Tagged People Chips */}
                <div className="w-full space-y-1.5">
                  {(activeItem.photo.tags || []).length > 0 ? (
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      <span className="text-[13px] text-stone-500">На снимке:</span>
                      {(activeItem.photo.tags || []).map((tag) => {
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
                                setSelectedRef(null);
                                onOpenPersonInTree(tp.id);
                              }}
                              className="hover:text-[#8B261D] cursor-pointer"
                            >
                              {formatFullName(tp)}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemovePersonTag(activeItem, tag.id)}
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
                  ) : (
                    <p className="text-center text-[12.5px] text-stone-400">
                      Нажмите «Отметить персону» и обведите лицо аккуратной рамкой
                    </p>
                  )}
                </div>
              </div>

              {/* Right Column: Archival Cataloging Metadata */}
              <div className="flex flex-col justify-between p-4 sm:p-6 space-y-4">
                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                      Категория материала
                    </label>
                    <select
                      value={activeItem.effectiveCategory}
                      onChange={(e) =>
                        updatePhotoItem(activeItem, {
                          category: e.target.value as ArchiveCategory,
                        })
                      }
                      className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-2 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none cursor-pointer"
                    >
                      {CATEGORY_ORDER.map((cat) => (
                        <option key={cat} value={cat}>
                          {ARCHIVE_CATEGORY_LABELS[cat]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                      Название или подпись
                    </label>
                    <input
                      type="text"
                      value={activeItem.photo.caption || ''}
                      onChange={(e) =>
                        updatePhotoItem(activeItem, { caption: e.target.value })
                      }
                      placeholder="Например: Свидетельство о рождении / Семейный портрет"
                      className="w-full rounded-md border border-stone-200 bg-white px-3 py-1.5 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                        Дата (дд.мм.гггг или год)
                      </label>
                      <input
                        type="text"
                        value={activeItem.photo.date || activeItem.photo.year || ''}
                        onChange={(e) =>
                          updatePhotoItem(activeItem, {
                            date: e.target.value,
                            year: e.target.value.match(/\b\d{4}\b/)?.[0] || '',
                          })
                        }
                        onBlur={(e) => {
                          const normalized = normalizeDateInputToRu(e.target.value);
                          updatePhotoItem(activeItem, {
                            date: normalized,
                            year: normalized.match(/\b\d{4}\b/)?.[0] || '',
                          });
                        }}
                        placeholder="14.05.1912"
                        className="w-full rounded-md border border-stone-200 bg-white px-3 py-1.5 tabular-nums text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                        Место съёмки / документа
                      </label>
                      <input
                        type="text"
                        value={activeItem.photo.place || ''}
                        onChange={(e) =>
                          updatePhotoItem(activeItem, { place: e.target.value })
                        }
                        placeholder="Город, губерния, село"
                        className="w-full rounded-md border border-stone-200 bg-white px-3 py-1.5 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                      Архивный шифр / источник хранения
                    </label>
                    <input
                      type="text"
                      value={activeItem.photo.archiveRef || ''}
                      onChange={(e) =>
                        updatePhotoItem(activeItem, { archiveRef: e.target.value })
                      }
                      placeholder="Например: Ф. 19, оп. 127 / Альбом бабушки"
                      className="w-full rounded-md border border-stone-200 bg-white px-3 py-1.5 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                    />
                  </div>

                  {/* Custom Archive Tags */}
                  <div>
                    <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                      Метки (Документы, Письма, Фронт, Учёба и т.д.)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newCustomTagInput}
                        onChange={(e) => setNewCustomTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomTag(activeItem, newCustomTagInput);
                          }
                        }}
                        placeholder="Добавить метку..."
                        className="w-full rounded-md border border-stone-200 bg-white px-3 py-1.5 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddCustomTag(activeItem, newCustomTagInput)}
                        title="Добавить метку"
                        className="inline-flex shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white px-3 text-stone-700 hover:border-[#8B261D] hover:text-[#8B261D] cursor-pointer"
                      >
                        <Plus size={16} />
                      </button>
                    </div>

                    {(activeItem.photo.customTags || []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(activeItem.photo.customTags || []).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 rounded border border-stone-200 bg-white pl-2 pr-1 py-0.5 text-[13px] text-stone-700"
                          >
                            <span>#{tag}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomTag(activeItem, tag)}
                              aria-label={`Удалить метку ${tag}`}
                              className="rounded p-0.5 text-stone-400 hover:text-[#8B261D] cursor-pointer"
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                      Расшифровка текста / оборотная подпись
                    </label>
                    <textarea
                      rows={3}
                      value={activeItem.photo.notes || ''}
                      onChange={(e) =>
                        updatePhotoItem(activeItem, { notes: e.target.value })
                      }
                      placeholder="Надпись на обороте снимка, содержание письма или справки..."
                      className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[16.5px] text-stone-900 focus:border-[#8B261D] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Bottom Dossier Source & Delete Bar */}
                <div className="space-y-3 border-t border-stone-200 pt-3">
                  <div>
                    <div className="text-[13px] text-stone-500">
                      {activeItem.owner
                        ? `Досье: ${formatFullName(activeItem.owner)}`
                        : 'Общий семейный фотоархив'}
                    </div>
                    {activeItem.owner && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRef(null);
                          onOpenPersonInTree(activeItem.owner!.id);
                        }}
                        className="mt-0.5 text-[13px] font-medium text-[#8B261D] hover:underline cursor-pointer"
                      >
                        Открыть досье на древе →
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-end border-t border-stone-100 pt-2.5">
                    {confirmDelete ? (
                      <div className="flex w-full items-center justify-end gap-3">
                        <span className="text-[13.5px] font-medium text-[#8B261D]">
                          Удалить?
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            className="rounded px-2.5 py-1 text-[13.5px] text-stone-600 hover:bg-stone-200/70 cursor-pointer"
                          >
                            Отмена
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(activeItem)}
                            className="rounded bg-[#8B261D] px-3 py-1 text-[13.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-stone-500 hover:text-[#8B261D] cursor-pointer"
                      >
                        <Trash2 size={14} />
                        <span>Удалить</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Photo Viewer Lightbox (matches ФОТО tab lightbox) */}
      {activeItem && fullscreenView && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/90 p-4 sm:p-6"
          onClick={() => {
            setFullscreenView(false);
            setPendingFrame(null);
            setHoveredTagId(null);
          }}
        >
          <div
            className="relative max-h-[92vh] max-w-4xl overflow-y-auto rounded-xl bg-[#FBF9F5] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setFullscreenView(false);
                setPendingFrame(null);
                setHoveredTagId(null);
              }}
              aria-label="Закрыть просмотр фотографии"
              className="absolute right-2.5 top-2.5 z-10 rounded-full p-1.5 text-stone-400/75 hover:bg-stone-200/45 hover:text-stone-700 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="mb-2 flex items-center justify-center">
              <button
                type="button"
                onClick={() => {
                  setIsTagging((v) => !v);
                  setPendingFrame(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-[13.5px] font-normal transition-colors cursor-pointer ${
                  isTagging
                    ? 'border-[#741E17] bg-[#741E17] text-white ring-2 ring-[#8B261D]/30'
                    : 'border-[#8B261D] bg-[#8B261D] text-white hover:border-[#741E17] hover:bg-[#741E17]'
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

            <div className="flex justify-center">
              <PhotoTagFrameLayer
                src={activeItem.photo.dataUrl}
                alt={activeItem.photo.caption || 'Архивный материал'}
                tags={activeItem.photo.tags || []}
                persons={tree.persons}
                imgClassName="max-h-[70vh] w-auto rounded object-contain mx-auto block"
                isTagging={isTagging}
                pendingFrame={pendingFrame}
                hoveredTagId={hoveredTagId}
                onHoverTagChange={setHoveredTagId}
                onFrameDrawn={(frame) => {
                  setPendingFrame(frame);
                  setTagPickerQuery('');
                }}
                onTagClick={(pid) => {
                  setFullscreenView(false);
                  setSelectedRef(null);
                  onOpenPersonInTree(pid);
                }}
              />
            </div>

            {pendingFrame && (
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
                        handleAssignPersonFrame(activeItem, cand.id, pendingFrame)
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

            {(activeItem.photo.caption || activeItem.dateLabel) && (
              <div className="mt-3 px-4 text-center space-y-0.5">
                {activeItem.photo.caption && (
                  <div className="font-editorial text-xl italic font-normal text-stone-900">
                    {activeItem.photo.caption}
                  </div>
                )}
                {activeItem.dateLabel && (
                  <div className="font-editorial tabular-nums text-base text-stone-500">
                    {activeItem.dateLabel}
                  </div>
                )}
              </div>
            )}

            {(activeItem.photo.tags || []).length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 px-2">
                <span className="text-[13px] text-stone-500">На фото:</span>
                {(activeItem.photo.tags || []).map((tag) => {
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
                          setFullscreenView(false);
                          setSelectedRef(null);
                          onOpenPersonInTree(tp.id);
                        }}
                        className="hover:text-[#8B261D] cursor-pointer"
                      >
                        {formatFullName(tp)}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemovePersonTag(activeItem, tag.id)}
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
      )}
    </div>
  );
}

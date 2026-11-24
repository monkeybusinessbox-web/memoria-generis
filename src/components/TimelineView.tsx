import React, { useMemo, useState } from 'react';
import {
  CalendarPlus,
  FileCheck2,
  GitFork,
  MapPin,
  Pencil,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  AggregatedTimelineEvent,
  DocumentAttachment,
  EventType,
  LifeEvent,
  Person,
  TreeDocument,
  Union,
  VerificationStatus,
} from '../types/genealogy';
import {
  EVENT_TYPE_LABELS,
  createId,
  formatFullName,
  getPersonInitials,
  getPrimaryPhotoObj,
  normalizeDateInputToRu,
} from '../utils/dateUtils';
import { computeLineageColors } from '../utils/lineageColors';
import { aggregateTimelineEvents } from '../utils/treeLayout';
import { CroppedCircleAvatar } from './PhotoCropModal';
import { VerificationIcon, VerificationSelector } from './VerificationBadge';

interface TimelineViewProps {
  tree: TreeDocument;
  onSelectPersonInTree: (personId: string) => void;
  onOpenPersonInspector: (personId: string) => void;
  onAddPersonEvent: (personId: string, event: LifeEvent) => void;
  onUpdatePerson: (personId: string, patch: Partial<Person>) => void;
  onUpdateUnion: (unionId: string, patch: Partial<Union>) => void;
}

const FILTER_CATEGORIES: EventType[] = [
  'birth',
  'marriage',
  'baptism',
  'education',
  'career',
  'migration',
  'award',
  'residence',
  'custom',
  'divorce',
  'death',
];

const CUSTOM_EVENT_OPTIONS: EventType[] = [
  'baptism',
  'migration',
  'education',
  'career',
  'award',
  'residence',
  'custom',
];

interface TimelineEditDraft {
  eventId: string;
  sourceKind: AggregatedTimelineEvent['sourceKind'];
  personId: string;
  sourceEventId?: string;
  sourceUnionId?: string;
  category: EventType;
  title: string;
  date: string;
  place: string;
  description: string;
  verification: VerificationStatus;
}

export function TimelineView({
  tree,
  onSelectPersonInTree,
  onOpenPersonInspector,
  onAddPersonEvent,
  onUpdatePerson,
  onUpdateUnion,
}: TimelineViewProps) {
  const [search, setSearch] = useState('');
  const [personFilter, setPersonFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [verifFilter, setVerifFilter] = useState<'all' | 'confirmed' | 'possible'>('all');
  const [activeDecade, setActiveDecade] = useState<number | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentAttachment | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newPersonId, setNewPersonId] = useState<string>(() => Object.keys(tree.persons)[0] || '');
  const [newType, setNewType] = useState<EventType>('custom');
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newPlace, setNewPlace] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newVerif, setNewVerif] = useState<VerificationStatus>('confirmed');

  const [editDraft, setEditDraft] = useState<TimelineEditDraft | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const hasActiveFilters =
    personFilter !== 'all' || categoryFilter !== 'all' || verifFilter !== 'all';

  const allEvents = useMemo(() => aggregateTimelineEvents(tree), [tree]);
  const lineage = useMemo(() => computeLineageColors(tree), [tree]);
  const personList = useMemo(
    () =>
      Object.values(tree.persons).sort((a, b) =>
        formatFullName(a).localeCompare(formatFullName(b), 'ru')
      ),
    [tree.persons]
  );

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allEvents.filter((ev) => {
      if (personFilter !== 'all' && ev.personId !== personFilter && ev.partnerId !== personFilter) {
        return false;
      }
      if (categoryFilter !== 'all' && ev.category !== categoryFilter) {
        return false;
      }
      if (verifFilter !== 'all' && ev.verification !== verifFilter) {
        return false;
      }
      if (activeDecade !== null) {
        if (!ev.year || Math.floor(ev.year / 10) * 10 !== activeDecade) {
          return false;
        }
      }
      if (q) {
        const hay = `${ev.title} ${ev.personName} ${ev.partnerName || ''} ${ev.place || ''} ${
          ev.description || ''
        } ${ev.dateDisplay}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeDecade, allEvents, categoryFilter, personFilter, search, verifFilter]);

  const decades = useMemo(() => {
    const set = new Set<number>();
    for (const ev of allEvents) {
      if (ev.year) set.add(Math.floor(ev.year / 10) * 10);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [allEvents]);

  const handleCreateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = newPersonId || personList[0]?.id;
    if (!targetId) return;
    onAddPersonEvent(targetId, {
      id: createId('ev'),
      type: newType,
      title: newTitle.trim() || EVENT_TYPE_LABELS[newType],
      date: normalizeDateInputToRu(newDate),
      place: newPlace.trim() || undefined,
      description: newDesc.trim() || undefined,
      verification: newVerif,
      documents: [],
    });
    setNewTitle('');
    setNewDate('');
    setNewPlace('');
    setNewDesc('');
    setShowAddForm(false);
  };

  const startEditing = (ev: AggregatedTimelineEvent) => {
    setEditDraft({
      eventId: ev.id,
      sourceKind: ev.sourceKind,
      personId: ev.personId,
      sourceEventId: ev.sourceEventId,
      sourceUnionId: ev.sourceUnionId,
      category: ev.category,
      title: ev.title,
      date: ev.rawDate,
      place: ev.place || '',
      description: ev.description || '',
      verification: ev.verification,
    });
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDraft) return;
    const normDate = normalizeDateInputToRu(editDraft.date);

    if (editDraft.sourceKind === 'birth') {
      onUpdatePerson(editDraft.personId, {
        birthDate: normDate,
        birthPlace: editDraft.place.trim() || undefined,
        verification: editDraft.verification,
      });
    } else if (editDraft.sourceKind === 'death') {
      onUpdatePerson(editDraft.personId, {
        deathDate: normDate,
        isLiving: !normDate.trim(),
        deathPlace: editDraft.place.trim() || undefined,
        verification: editDraft.verification,
      });
    } else if (editDraft.sourceKind === 'life_event' && editDraft.sourceEventId) {
      const person = tree.persons[editDraft.personId];
      if (person) {
        onUpdatePerson(editDraft.personId, {
          events: person.events.map((item) =>
            item.id === editDraft.sourceEventId
              ? {
                  ...item,
                  type: editDraft.category,
                  title: editDraft.title.trim() || EVENT_TYPE_LABELS[editDraft.category],
                  date: normDate,
                  place: editDraft.place.trim() || undefined,
                  description: editDraft.description.trim() || undefined,
                  verification: editDraft.verification,
                }
              : item
          ),
        });
      }
    } else if (
      (editDraft.sourceKind === 'marriage' || editDraft.sourceKind === 'divorce') &&
      editDraft.sourceUnionId
    ) {
      if (editDraft.sourceKind === 'marriage') {
        onUpdateUnion(editDraft.sourceUnionId, {
          marriageDate: normDate,
          marriagePlace: editDraft.place.trim() || undefined,
          notes: editDraft.description.trim() || undefined,
          verification: editDraft.verification,
        });
      } else {
        onUpdateUnion(editDraft.sourceUnionId, {
          divorceDate: normDate,
          notes: editDraft.description.trim() || undefined,
          verification: editDraft.verification,
        });
      }
    }

    setEditDraft(null);
  };

  const handleDeleteLifeEvent = (personId: string, sourceEventId: string) => {
    const person = tree.persons[personId];
    if (!person) return;
    onUpdatePerson(personId, {
      events: person.events.filter((item) => item.id !== sourceEventId),
    });
    setEditDraft(null);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#FBF9F5]">
      <div className="border-b border-stone-200 bg-white px-3.5 py-2.5 sm:px-5 sm:py-4 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-2.5 sm:space-y-3">
          <div className="flex items-center justify-between gap-2.5">
            <div className="min-w-0">
              <h1 className="font-editorial text-lg sm:text-2xl font-semibold text-stone-900 truncate">
                Хроника семейных событий
              </h1>
              <p className="text-[12.5px] sm:text-[14.5px] text-stone-500">
                <span className="hidden sm:inline">Лента жизни поколений · </span>
                <span className="font-mono-tabular">{filteredEvents.length}</span> из{' '}
                <span className="font-mono-tabular">{allEvents.length}</span> событий
              </p>
            </div>

            {personList.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (!newPersonId && personList[0]) setNewPersonId(personList[0].id);
                  setShowAddForm((v) => !v);
                }}
                title="Добавить событие в хронику"
                aria-label="Добавить событие в хронику"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-300 bg-[#FBF9F5] px-2.5 xl:px-3.5 text-[14.5px] font-medium text-stone-800 hover:border-[#8B261D] hover:text-[#8B261D] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CalendarPlus size={16} />
                <span className="desktop-btn-label">Добавить событие в хронику</span>
              </button>
            )}
          </div>

          {showAddForm && (
            <form
              onSubmit={handleCreateEvent}
              className="rounded-lg border border-stone-200 bg-[#FBF9F5] p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[14.5px] font-semibold text-stone-800">
                  Новое событие в семейной хронике
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">Персона</label>
                  <select
                    value={newPersonId}
                    onChange={(e) => setNewPersonId(e.target.value)}
                    className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-[16.5px] text-stone-900"
                  >
                    {personList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatFullName(p)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">Категория</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as EventType)}
                    className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-[16.5px] text-stone-900"
                  >
                    {CUSTOM_EVENT_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {EVENT_TYPE_LABELS[c]}
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
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    onBlur={(e) => {
                      const norm = normalizeDateInputToRu(e.target.value);
                      if (norm !== e.target.value) setNewDate(norm);
                    }}
                    placeholder="15.06.1954 или ~1912"
                    className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 tabular-nums text-[16.5px] text-stone-900"
                  />
                </div>
                <div>
                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">Место</label>
                  <input
                    type="text"
                    value={newPlace}
                    onChange={(e) => setNewPlace(e.target.value)}
                    placeholder="Город или адрес"
                    className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-[16.5px] text-stone-900"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">Заголовок события</label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Например: Поступление в университет"
                    className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-[16.5px] text-stone-900"
                  />
                </div>
                <div>
                  <label className="block text-[13.5px] font-medium text-stone-600 mb-1">Комментарий</label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Краткий комментарий или архивная ссылка"
                    className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-[16.5px] text-stone-900"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <VerificationSelector value={newVerif} onChange={setNewVerif} />
                <button
                  type="submit"
                  className="rounded-md bg-[#8B261D] px-4 py-1.5 text-[14.5px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
                >
                  Сохранить в хронике
                </button>
              </div>
            </form>
          )}

          {/* Search + Touch Filter Toggle Row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-1 min-w-0 sm:flex-none h-9 items-center rounded-md border border-stone-200 bg-[#FBF9F5] px-2.5">
              <Search size={14} className="text-stone-400 mr-1.5 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск"
                className="w-full sm:w-52 bg-transparent text-[16px] text-stone-900 focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="text-stone-400 hover:text-stone-700 cursor-pointer"
                  aria-label="Очистить поиск"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMobileFiltersOpen((v) => !v)}
              title="Фильтры хроники"
              aria-label="Фильтры хроники"
              className={`touch-icon-only relative h-9 items-center justify-center rounded-md border px-2.5 transition-colors cursor-pointer ${
                mobileFiltersOpen || hasActiveFilters
                  ? 'border-[#8B261D] bg-[#8B261D]/5 text-[#8B261D]'
                  : 'border-stone-200 bg-white text-stone-700'
              }`}
            >
              <SlidersHorizontal size={15} />
              {hasActiveFilters && (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-[#8B261D]" />
              )}
            </button>

            <div
              className={`${
                mobileFiltersOpen ? 'flex w-full pt-1' : 'desktop-flex-bar'
              } flex-wrap items-center gap-2`}
            >
              <select
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
                className="h-9 w-full sm:w-auto max-w-full rounded-md border border-stone-200 bg-white px-2.5 text-[16px] text-stone-800"
              >
                <option value="all">Все члены семьи</option>
                {personList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatFullName(p)}
                  </option>
                ))}
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-9 w-full sm:w-auto rounded-md border border-stone-200 bg-white px-2.5 text-[16px] text-stone-800"
              >
                <option value="all">Все типы событий</option>
                {FILTER_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EVENT_TYPE_LABELS[c]}
                  </option>
                ))}
              </select>

              <div className="inline-flex h-9 w-full sm:w-auto items-center justify-between sm:justify-start rounded-md border border-stone-200 bg-stone-100 p-0.5">
                {(
                  [
                    { id: 'all', label: 'Все' },
                    { id: 'confirmed', label: 'Подтверждено' },
                    { id: 'possible', label: 'Возможно' },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVerifFilter(v.id)}
                    className={`flex-1 sm:flex-none rounded px-2.5 py-1 text-[13px] sm:text-[14.5px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      verifFilter === v.id
                        ? 'bg-white text-stone-900 shadow-xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {decades.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pt-0.5 pb-0.5 no-scrollbar">
              <button
                type="button"
                onClick={() => setActiveDecade(null)}
                className={`rounded px-2.5 py-1 font-mono-tabular text-[12.5px] sm:text-[13px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activeDecade === null
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                Все эпохи
              </button>
              {decades.map((dec) => (
                <button
                  key={dec}
                  type="button"
                  onClick={() => setActiveDecade(activeDecade === dec ? null : dec)}
                  className={`rounded px-2.5 py-1 font-mono-tabular text-[12.5px] sm:text-[13px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    activeDecade === dec
                      ? 'bg-[#8B261D] text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {dec}-е
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-4 sm:px-5 sm:py-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          {filteredEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 sm:p-10 text-center">
              <p className="font-editorial text-lg sm:text-xl font-medium text-stone-800">
                Событий по выбранным фильтрам не найдено
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Сбросьте фильтры или добавьте памятные даты в профиль любого родственника.
              </p>
            </div>
          ) : (
            <div className="relative space-y-3.5 sm:space-y-4 before:absolute before:left-[52.5px] before:top-2 before:bottom-2 before:w-px before:bg-stone-300/80 sm:before:left-[105.5px]">
              {filteredEvents.map((ev) => {
                const person = tree.persons[ev.personId];
                const photoObj = person ? getPrimaryPhotoObj(person) : null;
                const color = lineage.personColor[ev.personId] || '#8B261D';
                const isEditingThis = editDraft?.eventId === ev.id;

                return (
                  <div key={ev.id} className="relative flex items-start gap-2 sm:gap-5">
                    <div className="w-10 sm:w-20 shrink-0 pt-2.5 sm:pt-3 text-right">
                      <span className="font-mono-tabular text-[13px] sm:text-[15.4px] font-semibold text-stone-900">
                        {ev.year || '—'}
                      </span>
                    </div>

                    <div
                      className="relative z-10 mt-3.5 sm:mt-4 h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0 rounded-full border-2 bg-[#FBF9F5]"
                      style={{ borderColor: color }}
                    />

                    <div className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white p-3 sm:p-5 shadow-2xs transition-colors hover:border-stone-300">
                      {isEditingThis && editDraft ? (
                        <form onSubmit={handleSaveEdit} className="space-y-3">
                          <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                            <span className="text-[14px] font-semibold text-stone-700">
                              Редактирование события ({EVENT_TYPE_LABELS[editDraft.category]})
                            </span>
                            <button
                              type="button"
                              onClick={() => setEditDraft(null)}
                              className="text-stone-400 hover:text-stone-700 cursor-pointer"
                            >
                              <X size={16} />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {editDraft.sourceKind === 'life_event' && (
                              <div>
                                <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                                  Категория
                                </label>
                                <select
                                  value={editDraft.category}
                                  onChange={(e) =>
                                    setEditDraft({
                                      ...editDraft,
                                      category: e.target.value as EventType,
                                    })
                                  }
                                  className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-[16.5px] text-stone-900"
                                >
                                  {CUSTOM_EVENT_OPTIONS.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {EVENT_TYPE_LABELS[opt]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

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

                            {editDraft.sourceKind !== 'divorce' && (
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
                                  placeholder="Город, приход, учреждение"
                                  className="w-full rounded border border-stone-200 bg-white px-2.5 py-1.5 text-[16.5px] text-stone-900"
                                />
                              </div>
                            )}

                            {editDraft.sourceKind === 'life_event' && (
                              <div>
                                <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                                  Заголовок события
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
                            )}
                          </div>

                          {(editDraft.sourceKind === 'life_event' ||
                            editDraft.sourceKind === 'marriage' ||
                            editDraft.sourceKind === 'divorce') && (
                            <div>
                              <label className="block text-[13.5px] font-medium text-stone-600 mb-1">
                                Описание / заметка
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
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <VerificationSelector
                              compact
                              value={editDraft.verification}
                              onChange={(v) => setEditDraft({ ...editDraft, verification: v })}
                            />
                            <div className="flex items-center gap-2">
                              {editDraft.sourceKind === 'life_event' && editDraft.sourceEventId && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteLifeEvent(
                                      editDraft.personId,
                                      editDraft.sourceEventId!
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-[13.5px] text-[#8B261D] hover:bg-red-50 cursor-pointer"
                                >
                                  <Trash2 size={13} />
                                  <span>Удалить</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setEditDraft(null)}
                                className="rounded px-3 py-1.5 text-[14px] text-stone-600 hover:bg-stone-100 cursor-pointer"
                              >
                                Отмена
                              </button>
                              <button
                                type="submit"
                                className="rounded bg-[#8B261D] px-3.5 py-1.5 text-[14px] font-medium text-white hover:bg-[#741E17] cursor-pointer"
                              >
                                Сохранить
                              </button>
                            </div>
                          </div>
                        </form>
                      ) : (
                        <div className="space-y-2.5 sm:space-y-3">
                          {/* Top Meta Strip: Category pill + Exact Date + Place beside Date + Age on Left; Verification + Icon Actions on Right */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="inline-flex items-center rounded border border-stone-200 bg-[#FBF9F5] px-2 py-0.5 text-[12px] sm:text-[12.5px] font-medium text-stone-700">
                                {EVENT_TYPE_LABELS[ev.category]}
                              </span>
                              <span className="font-mono-tabular text-[13.5px] sm:text-[14px] font-semibold text-stone-800">
                                {ev.dateDisplay || ev.rawDate}
                              </span>
                              {ev.place && (
                                <span className="inline-flex items-center gap-1 text-[13px] sm:text-[13.5px] text-stone-600">
                                  <MapPin size={13} className="shrink-0 text-[#8B261D]" />
                                  <span>{ev.place}</span>
                                </span>
                              )}
                              {ev.ageAtEvent && (
                                <span className="text-[12.5px] sm:text-[13px] text-stone-500">
                                  · Возраст: {ev.ageAtEvent}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                              <VerificationIcon status={ev.verification} size={15} />
                              <button
                                type="button"
                                onClick={() => startEditing(ev)}
                                title="Редактировать событие"
                                aria-label="Редактировать событие"
                                className="inline-flex items-center justify-center rounded p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900 cursor-pointer"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => onSelectPersonInTree(ev.personId)}
                                className="inline-flex items-center justify-center rounded p-1.5 text-stone-500 hover:bg-stone-100 hover:text-[#8B261D] cursor-pointer"
                                title="Показать персону на схеме древа"
                                aria-label="Показать персону на схеме древа"
                              >
                                <GitFork size={14} />
                              </button>
                            </div>
                          </div>

                          {/* Person Portrait + Full Name + Clear Event Details */}
                          <div className="flex items-start gap-2.5 sm:gap-3.5">
                            {person && (
                              <button
                                type="button"
                                onClick={() => onOpenPersonInspector(person.id)}
                                className="shrink-0 cursor-pointer"
                                title="Открыть досье"
                              >
                                <CroppedCircleAvatar
                                  photo={photoObj}
                                  initials={getPersonInitials(person)}
                                  alt={ev.personName}
                                  sizeClass="h-10 w-10 sm:h-12 sm:w-12"
                                  textSizeClass="text-xs sm:text-sm"
                                />
                              </button>
                            )}

                            <div className="min-w-0 flex-1 space-y-1 sm:space-y-1.5">
                              <button
                                type="button"
                                onClick={() => onOpenPersonInspector(ev.personId)}
                                className="text-left text-[14.5px] sm:text-[15.5px] font-semibold leading-snug text-stone-900 hover:text-[#8B261D] cursor-pointer"
                              >
                                {ev.partnerName ? `${ev.personName} и ${ev.partnerName}` : ev.personName}
                              </button>

                              <h3 className="font-editorial text-[16.5px] sm:text-[19px] font-medium leading-snug text-stone-800">
                                {ev.title}
                              </h3>

                              {ev.description && (
                                <p className="pt-0.5 text-[15.4px] leading-relaxed text-stone-600 max-w-2xl">
                                  {ev.description}
                                </p>
                              )}

                              {ev.documents && ev.documents.length > 0 && (
                                <div className="pt-1 flex flex-wrap items-center gap-2">
                                  {ev.documents.map((doc) => (
                                    <button
                                      key={doc.id}
                                      type="button"
                                      onClick={() => setPreviewDoc(doc)}
                                      className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50/70 px-2 py-0.5 text-[12.5px] font-medium text-[#15803D] hover:bg-emerald-100 cursor-pointer"
                                    >
                                      <FileCheck2 size={12} />
                                      <span>{doc.name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {previewDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/85 p-4"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl bg-[#FBF9F5] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between border-b border-stone-200 pb-2">
              <span className="text-sm font-semibold text-stone-900">{previewDoc.name}</span>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                aria-label="Закрыть просмотр"
                className="rounded-full p-1 text-stone-400/75 hover:bg-stone-200/45 hover:text-stone-700 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            {previewDoc.mimeType.startsWith('image/') ? (
              <img
                src={previewDoc.dataUrl}
                alt={previewDoc.name}
                className="mx-auto max-h-[75vh] w-auto rounded object-contain"
              />
            ) : (
              <iframe
                src={previewDoc.dataUrl}
                title={previewDoc.name}
                className="h-[75vh] w-full rounded border border-stone-200 bg-white"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

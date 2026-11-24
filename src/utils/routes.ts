import { AppWorkspaceTab } from '../types/genealogy';

export interface PageRouteMeta {
  tab: AppWorkspaceTab;
  path: string;
  label: string;
  title: string;
}

export const PAGE_ROUTES: PageRouteMeta[] = [
  {
    tab: 'tree',
    path: '/',
    label: 'РОДОСЛОВНАЯ',
    title: 'Memoria Generis — Родословная',
  },
  {
    tab: 'timeline',
    path: '/timeline',
    label: 'ХРОНИКА',
    title: 'Memoria Generis — Хроника',
  },
  {
    tab: 'photos',
    path: '/photos',
    label: 'ФОТОАРХИВ',
    title: 'Memoria Generis — Фотоархив',
  },
  {
    tab: 'map',
    path: '/map',
    label: 'ГЕОГРАФИЯ',
    title: 'Memoria Generis — География',
  },
  {
    tab: 'archive',
    path: '/archive',
    label: 'АРХИВАЦИЯ',
    title: 'Memoria Generis — Архивация',
  },
];

const ROUTE_BY_TAB: Record<AppWorkspaceTab, PageRouteMeta> = {
  tree: PAGE_ROUTES[0],
  timeline: PAGE_ROUTES[1],
  photos: PAGE_ROUTES[2],
  map: PAGE_ROUTES[3],
  archive: PAGE_ROUTES[4],
};

function normalizePathSegment(raw: string): string {
  const cleaned = raw.replace(/^#/, '').split('?')[0].replace(/\/+$/, '') || '/';
  return cleaned.toLowerCase();
}

export function getTabFromLocation(): AppWorkspaceTab {
  if (typeof window === 'undefined') return 'tree';

  const candidates = [
    normalizePathSegment(window.location.pathname),
    window.location.hash ? normalizePathSegment(window.location.hash) : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === '/' || candidate === '/tree') return 'tree';
    if (candidate === '/timeline') return 'timeline';
    if (candidate === '/photos') return 'photos';
    if (candidate === '/map') return 'map';
    if (candidate === '/archive') return 'archive';
  }

  return 'tree';
}

export function getPageHref(tab: AppWorkspaceTab): string {
  return ROUTE_BY_TAB[tab].path;
}

export function getPageTitle(tab: AppWorkspaceTab): string {
  return ROUTE_BY_TAB[tab].title;
}

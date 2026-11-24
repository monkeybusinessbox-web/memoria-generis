import React from 'react';
import { AppWorkspaceTab } from '../types/genealogy';
import { getPageHref, PAGE_ROUTES } from '../utils/routes';

interface TopBarProps {
  activeTab: AppWorkspaceTab;
  onTabChange: (tab: AppWorkspaceTab) => void;
}

export function TopBar({ activeTab, onTabChange }: TopBarProps) {
  const handleNavClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    tab: AppWorkspaceTab
  ) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    onTabChange(tab);
  };

  return (
    <header className="flex flex-col items-center border-b border-stone-200 bg-[#FBF9F5] px-3 pt-4 pb-2 sm:px-5 sm:pt-5 sm:pb-2.5 lg:px-7">
      <a
        href={getPageHref('tree')}
        onClick={(e) => handleNavClick(e, 'tree')}
        title="Memoria Generis"
        className="font-editorial text-center text-[25px] sm:text-[30px] font-normal tracking-[0.06em] text-[#8B261D] hover:text-[#741E17] transition-colors leading-tight no-underline"
      >
        Memoria Generis
      </a>

      <nav
        className="mt-3 sm:mt-4 flex w-full items-center justify-center gap-4 overflow-x-auto sm:gap-6 lg:gap-8 no-scrollbar"
        aria-label="Разделы архива"
      >
        {PAGE_ROUTES.map((route) => {
          const isActive = activeTab === route.tab;
          return (
            <a
              key={route.tab}
              href={route.path}
              onClick={(e) => handleNavClick(e, route.tab)}
              aria-current={isActive ? 'page' : undefined}
              className={`border-b-2 py-1 text-[13.5px] sm:text-[16.5px] font-medium uppercase tracking-[0.08em] transition-colors whitespace-nowrap shrink-0 no-underline ${
                isActive
                  ? 'border-[#8B261D] text-stone-900'
                  : 'border-transparent text-stone-500 hover:text-stone-900'
              }`}
            >
              {route.label}
            </a>
          );
        })}
      </nav>
    </header>
  );
}

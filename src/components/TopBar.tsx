import { AppWorkspaceTab } from '../types/genealogy';

interface TopBarProps {
  activeTab: AppWorkspaceTab;
  onTabChange: (tab: AppWorkspaceTab) => void;
}

export function TopBar({ activeTab, onTabChange }: TopBarProps) {
  return (
    <header className="flex flex-col items-center border-b border-stone-200 bg-[#FBF9F5] px-3 pt-4 pb-2 sm:px-5 sm:pt-5 sm:pb-2.5 lg:px-7">
      <button
        type="button"
        onClick={() => onTabChange('tree')}
        title="Memoria Generis"
        className="font-editorial text-center text-[25px] sm:text-[30px] font-normal tracking-[0.06em] text-[#8B261D] hover:text-[#741E17] transition-colors cursor-pointer leading-tight"
      >
        Memoria Generis
      </button>

      <nav
        className="mt-3 sm:mt-4 flex w-full items-center justify-center gap-4 overflow-x-auto sm:gap-6 lg:gap-8 no-scrollbar"
        aria-label="Разделы архива"
      >
        <button
          type="button"
          onClick={() => onTabChange('tree')}
          className={`border-b-2 py-1 text-[13.5px] sm:text-[16.5px] font-medium uppercase tracking-[0.08em] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'tree'
              ? 'border-[#8B261D] text-stone-900'
              : 'border-transparent text-stone-500 hover:text-stone-900'
          }`}
        >
          РОДОСЛОВНАЯ
        </button>

        <button
          type="button"
          onClick={() => onTabChange('timeline')}
          className={`border-b-2 py-1 text-[13.5px] sm:text-[16.5px] font-medium uppercase tracking-[0.08em] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'timeline'
              ? 'border-[#8B261D] text-stone-900'
              : 'border-transparent text-stone-500 hover:text-stone-900'
          }`}
        >
          ХРОНИКА
        </button>

        <button
          type="button"
          onClick={() => onTabChange('photos')}
          className={`border-b-2 py-1 text-[13.5px] sm:text-[16.5px] font-medium uppercase tracking-[0.08em] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'photos'
              ? 'border-[#8B261D] text-stone-900'
              : 'border-transparent text-stone-500 hover:text-stone-900'
          }`}
        >
          ФОТОАРХИВ
        </button>

        <button
          type="button"
          onClick={() => onTabChange('map')}
          className={`border-b-2 py-1 text-[13.5px] sm:text-[16.5px] font-medium uppercase tracking-[0.08em] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'map'
              ? 'border-[#8B261D] text-stone-900'
              : 'border-transparent text-stone-500 hover:text-stone-900'
          }`}
        >
          ГЕОГРАФИЯ
        </button>

        <button
          type="button"
          onClick={() => onTabChange('archive')}
          className={`border-b-2 py-1 text-[13.5px] sm:text-[16.5px] font-medium uppercase tracking-[0.08em] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'archive'
              ? 'border-[#8B261D] text-stone-900'
              : 'border-transparent text-stone-500 hover:text-stone-900'
          }`}
        >
          АРХИВАЦИЯ
        </button>
      </nav>
    </header>
  );
}



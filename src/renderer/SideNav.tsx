import { cn } from '@/lib/utils';

export type PageId = 'home' | 'history' | 'stats' | 'achievements' | 'settings';

export const NAV_ITEMS: { id: PageId; icon: string; label: string }[] = [
  { id: 'home', icon: '🏠', label: '首页' },
  { id: 'history', icon: '📋', label: '历史' },
  { id: 'stats', icon: '📊', label: '统计' },
  { id: 'achievements', icon: '🏆', label: '成就' },
  { id: 'settings', icon: '⚙️', label: '设置' },
];

interface SideNavProps {
  active: PageId;
  onChange: (page: PageId) => void;
}

export default function SideNav({ active, onChange }: SideNavProps) {
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-2 bg-linear-to-b from-app-nav-from to-app-nav-to py-4">
      {NAV_ITEMS.map((item) => {
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            onClick={() => onChange(item.id)}
            className={cn(
              'group relative flex h-11 w-11 items-center justify-center rounded-xl text-xl transition-all',
              selected
                ? 'bg-white/10 shadow-[0_0_16px_rgba(255,255,255,0.25)]'
                : 'opacity-70 hover:bg-white/5 hover:opacity-100',
            )}
          >
            <span className="leading-none">{item.icon}</span>
            {/* 悬停文字提示:从按钮右侧浮出 */}
            <span className="pointer-events-none absolute left-full z-10 ml-2 whitespace-nowrap rounded-md bg-gray-700 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              {item.label}
            </span>
            {/* 选中指示小圆点(主题色) */}
            {selected && (
              <span className="absolute -bottom-1.5 h-1 w-1 rounded-full bg-app-primary" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

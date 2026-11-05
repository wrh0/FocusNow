import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import appIcon from './icon.png';
import { updateSetting, useSettings } from './use-settings';

type WindowButtonProps = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
};

// Windows 原生风格的窗口控制按钮：悬停变色，关闭按钮悬停变红
function WindowButton({ label, onClick, danger = false, children }: WindowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-full w-[46px] items-center justify-center text-[#1f1f1f]',
        '[-webkit-app-region:no-drag] transition-colors',
        danger
          ? 'hover:bg-[#e81123] hover:text-white active:bg-[#f1707a]'
          : 'hover:bg-[#e6e6e6] active:bg-[#dcdcdc]',
      )}
    >
      {children}
    </button>
  );
}

// 自定义标题栏：左侧图标 + 应用名，右侧窗口控制按钮，
// 空白区域（含图标和文字）可拖拽移动窗口，按钮区域不可拖拽
export default function TitleBar() {
  // 窗口置顶：状态保存在全局设置（electron-store）里，图钉只是它的投影——
  // 订阅全局设置快照（初始加载 + 任意位置写入后的广播），
  // 设置页开关与这里的图钉读写同一份状态，两边天然双向同步
  const settings = useSettings();
  const isPinned = settings?.alwaysOnTop ?? false;

  const toggleAlwaysOnTop = () => {
    // 乐观更新 + 主进程校验持久化,失败时由 updateSetting 内部回滚
    updateSetting('alwaysOnTop', !isPinned);
  };

  return (
    <header className="flex h-10 shrink-0 select-none items-center border-b border-app-card-border bg-white [-webkit-app-region:drag]">
      <div className="flex items-center gap-1 pl-3">
        <img src={appIcon} alt="" className="ml-2 h-4 w-4" />
        <span className="text-[13px] font-bold text-app-primary">番茄钟</span>
        {/* 迷你模式:缩成屏幕右上角的悬浮小窗(图标与迷你窗口的「回到主窗口」同款) */}
        <button
          type="button"
          aria-label="迷你模式"
          title="迷你模式"
          onClick={() => void window.windowControls.enterMiniMode()}
          className="[-webkit-app-region:no-drag] flex h-6 w-7 items-center justify-center rounded text-[#1f1f1f] transition-colors hover:bg-[#e6e6e6] active:bg-[#dcdcdc]"
        >
          <svg width="12" height="12" viewBox="0 0 13 13" aria-hidden="true">
            {/* 四角括号缩放图标 */}
            <path
              d="M5.5 1H1v4.5M7.5 1H12v4.5M12 7.5V12H7.5M5.5 12H1V7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </button>
      </div>

      <div className="ml-auto flex h-full">
        <WindowButton
          label={isPinned ? '取消置顶' : '窗口置顶'}
          onClick={toggleAlwaysOnTop}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden="true"
            className={cn(isPinned && 'text-app-primary')}
          >
            {/* 图钉：帽 + 梯形肩 + 针尖，置顶时染成番茄红 */}
            <path
              d="M3.5 1h3v2L8 5.5H2L3.5 3zM5 5.5V9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
        </WindowButton>

        <WindowButton label="最小化" onClick={() => window.windowControls.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </WindowButton>

        <WindowButton label="最大化" onClick={() => window.windowControls.maximize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </WindowButton>

        <WindowButton label="关闭" danger onClick={() => window.windowControls.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </WindowButton>
      </div>
    </header>
  );
}

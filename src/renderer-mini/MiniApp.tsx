import { useEffect, useState } from 'react';
import type { MiniTimerPhase, MiniTimerState } from '../shared/types';
import { cn } from '@/lib/utils';

// 阶段 → 倒计时颜色:与主窗口界面一一对应(专注红/休息绿/暂停琥珀/等待绿或灰/空闲灰)
const PHASE_TEXT: Record<MiniTimerPhase, string> = {
  focus: 'text-app-primary',
  break: 'text-app-glow-break',
  paused: 'text-app-amber',
  'break-wait': 'text-app-glow-break',
  idle: 'text-gray-400',
};

// 缩放图标:主窗口标题栏「迷你模式」与这里的「回到主窗口」共用同一枚
function ScaleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 13 13" aria-hidden="true">
      {/* 四角括号 */}
      <path
        d="M5.5 1H1v4.5M7.5 1H12v4.5M12 7.5V12H7.5M5.5 12H1V7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

// 悬浮迷你窗:左边倒计时,右边播放/暂停 + 回主窗口。
// 整个窗口可拖拽,按钮区 no-drag;内容距边缘留出间距,避免被系统圆角裁掉
export default function MiniApp() {
  const [state, setState] = useState<MiniTimerState | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 打开瞬间先拉主进程缓存的最新状态(第一帧就有数字,不留空白),再订阅每秒推送
    void window.mini
      .getTimerState()
      .then((s) => {
        if (!cancelled && s) setState(s);
      })
      .catch((err) => console.error('读取迷你计时状态失败:', err));
    const off = window.mini.onTimerState((s) => setState(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return (
    <div className="flex h-screen select-none items-center justify-between gap-2 bg-app-nav-from px-4 [-webkit-app-region:drag]">
      {/* 倒计时数字:大号加粗,颜色跟主窗口一致 */}
      <span
        data-testid="mini-time"
        className={cn(
          'min-w-0 truncate text-2xl font-extrabold leading-none tabular-nums',
          PHASE_TEXT[state?.phase ?? 'idle'],
        )}
      >
        {state?.timeText ?? '--:--'}
      </span>

      {/* 按钮区:不跟随拖拽 */}
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        {/* 播放/暂停:计时中显示暂停,其余一律显示播放——任何状态都能直接操作 */}
        <button
          type="button"
          aria-label={state?.running ? '暂停' : '开始'}
          title={state?.running ? '暂停' : '开始'}
          onClick={() => window.mini.toggleTimer()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white active:bg-white/15"
        >
          {state?.running ? (
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 1.5v9M9 1.5v9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 1.5v9l7-4.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        {/* 回到主窗口:迷你窗口关闭,主窗口回到屏幕 */}
        <button
          type="button"
          aria-label="回到主窗口"
          title="回到主窗口"
          onClick={() => window.mini.close()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white active:bg-white/15"
        >
          <ScaleIcon />
        </button>
      </div>
    </div>
  );
}

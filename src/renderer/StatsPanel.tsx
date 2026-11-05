import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// 专注时长格式化:
// ≥ 1 小时 → "X.X 小时"(一位小数,整数不带小数点,如 2 小时、1.5 小时)
// < 1 小时 → "X 分钟"(如 45 分钟);< 1 分钟 → "X 秒"(如 30 秒)
function formatFocusDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  const hours = Math.round((seconds / 3600) * 10) / 10;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`;
}

// 数字从 0 滚动到目标值的动画(0.5 秒内完成,ease-out 减速收尾)。
// 只在首次拿到真实数据时滚动一次:之后每次数据变化都从 0 重滚会显得
// 整块统计在"闪",时长格式也会在滚动过程中来回跳(45 分钟 → 1.5 小时)。
// raf 在后台窗口不触发,故额外用 setTimeout 兜底,保证最终一定显示目标值
function useCountUp(target: number, durationMs = 500): number {
  const [displayed, setDisplayed] = useState(target);
  const animatedRef = useRef(false);

  useEffect(() => {
    // 已滚动过一次:后续目标变化直接跳到新值
    if (animatedRef.current) {
      setDisplayed(target);
      return;
    }
    // 首次加载前的占位(0)或真的没有数据:保持 0,等真实数据到来再滚动
    if (target === 0) return;
    animatedRef.current = true;
    let rafId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(eased * target));
      if (progress < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    const fallback = setTimeout(() => setDisplayed(target), durationMs + 50);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(fallback);
    };
  }, [target, durationMs]);

  return displayed;
}

interface StatCardProps {
  icon: string;
  // 数字部分:整数(配 unit)或直接给格式化文本(如"2 小时")
  value?: number;
  valueText?: string;
  unit?: string;
  label: string;
  valueClass: string;
  // 卡片顶部的细装饰线颜色
  accentClass: string;
}

function StatCard({
  icon,
  value,
  valueText,
  unit,
  label,
  valueClass,
  accentClass,
}: StatCardProps) {
  return (
    <div className="card-refined relative flex min-w-0 flex-col items-center gap-1 overflow-hidden rounded-2xl px-2 py-3">
      {/* 顶部细装饰线 */}
      <span className={cn('absolute inset-x-0 top-0 h-0.5', accentClass)} />
      <div className="flex items-baseline gap-1">
        <span className="text-base leading-none">{icon}</span>
        <span
          className={cn(
            'text-xl font-extrabold leading-none tracking-tight',
            valueClass,
          )}
        >
          {valueText ?? value}
        </span>
        {unit && <span className="text-sm text-gray-400">{unit}</span>}
      </div>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

interface StatsPanelProps {
  // 数据版本号:番茄钟写库 / 任务增删改后 +1,触发重新统计
  dataVersion: number;
}

export default function StatsPanel({ dataVersion }: StatsPanelProps) {
  const [stats, setStats] = useState({ pomodoroCount: 0, focusSeconds: 0, taskCount: 0 });

  // 从数据库统计今天(0:00 到现在)的总量
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pomodoros, taskCount] = await Promise.all([
          window.database.getPomodorosToday(),
          window.database.getCompletedTaskCountToday(),
        ]);
        if (cancelled) return;
        const workRecords = pomodoros.filter((p) => p.type === 'work');
        setStats({
          pomodoroCount: workRecords.length,
          focusSeconds: workRecords.reduce((sum, p) => sum + p.duration, 0),
          taskCount,
        });
      } catch (err) {
        console.error('读取今日统计失败:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  const pomodoroDisplay = useCountUp(stats.pomodoroCount);
  // 时长滚动原始秒数,格式随数值自适应(0 秒 → 45 分钟 → 2 小时)
  const secondsDisplay = useCountUp(stats.focusSeconds);
  const taskDisplay = useCountUp(stats.taskCount);

  return (
    // 淡入动画挂在容器上,三张卡片同时从下方淡入
    <div
      className="grid w-[380px] animate-fade-in-up grid-cols-3 gap-3"
      data-testid="stats-panel"
    >
      <StatCard
        icon="🍅"
        value={pomodoroDisplay}
        unit="个"
        label="番茄钟"
        valueClass="text-app-primary"
        accentClass="bg-app-primary"
      />
      <StatCard
        icon="⏰"
        valueText={formatFocusDuration(secondsDisplay)}
        label="专注时长"
        valueClass="text-app-blue"
        accentClass="bg-app-blue"
      />
      <StatCard
        icon="✅"
        value={taskDisplay}
        unit="个"
        label="任务已完成"
        valueClass="text-app-break"
        accentClass="bg-app-break"
      />
    </div>
  );
}

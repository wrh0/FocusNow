import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task, TaskWithCount } from '../shared/types';
import { cn } from '@/lib/utils';
import SideNav, { NAV_ITEMS, type PageId } from './SideNav';
import SettingsPanel from './SettingsPanel';
import StatsPanel from './StatsPanel';
import TaskPanel from './TaskPanel';
import TimerPanel from './TimerPanel';
import TitleBar from './TitleBar';

// 缩放下限,防止窗口极小时内容小到无法辨认
const MIN_SCALE = 0.5;
// 计时器整体(计时器 + 统计)与左栏边缘的间距,与右栏/设置页的 p-8 统一
const PANE_PADDING = 32;

export default function App() {
  // 任务列表(带今日番茄数)与选中任务:提升到顶层,供计时器与任务面板共享
  const [tasks, setTasks] = useState<TaskWithCount[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  // 数据版本号:任何数据变化(任务增删改、番茄钟写库)后 +1,触发从数据库重新同步
  const [dataVersion, setDataVersion] = useState(0);
  const refreshData = useCallback(() => setDataVersion((v) => v + 1), []);
  // 选中任务被标记完成的信号:触发计时器回到初始状态
  const [taskCompletedSignal, setTaskCompletedSignal] = useState(0);
  // 当前页面
  const [activePage, setActivePage] = useState<PageId>('home');
  // 数据加载失败标记:数据库读不出来时给用户可见提示,而不是伪装成「还没有任务」
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [taskList, pomodoros] = await Promise.all([
          window.database.listTasks(),
          window.database.getPomodorosToday(),
        ]);
        if (cancelled) return;
        // 统计每个任务今天的 work 番茄数
        const counts = new Map<number, number>();
        for (const p of pomodoros) {
          if (p.taskId !== null && p.type === 'work') {
            counts.set(p.taskId, (counts.get(p.taskId) ?? 0) + 1);
          }
        }
        setTasks(taskList.map((t) => ({ ...t, pomodoroCount: counts.get(t.id) ?? 0 })));
        setLoadError(false);
      } catch (err) {
        console.error('读取任务数据失败:', err);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  // 选中的任务对象(任务被删除后自动回落为 null)
  const selectedTask: Task | null =
    tasks.find((t) => t.id === selectedTaskId) ?? null;

  // ---- 左栏内容缩放:按左栏实际尺寸与内容实际大小计算 ----
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const leftContentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const pane = leftPaneRef.current;
    const content = leftContentRef.current;
    if (!pane || !content) return;
    const update = () => {
      // 首页隐藏(display:none)时尺寸为 0,保持当前比例,切回时 observer 会重新触发
      if (pane.clientWidth === 0 || content.offsetWidth === 0) return;
      setScale(
        Math.max(
          MIN_SCALE,
          Math.min(
            1,
            (pane.clientWidth - PANE_PADDING * 2) / content.offsetWidth,
            (pane.clientHeight - PANE_PADDING * 2) / content.offsetHeight,
          ),
        ),
      );
    };
    update();
    // 双保险:ResizeObserver 监听尺寸变化,resize 事件兜底窗口级变化
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    observer.observe(content);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const placeholder = NAV_ITEMS.find((n) => n.id === activePage);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <SideNav active={activePage} onChange={setActivePage} />
        <main className="min-w-0 flex-1 bg-linear-to-br from-app-bg-from to-app-bg-to">
          {/* 首页常驻挂载(切换页面时计时器继续在后台计时),用 hidden 切换显示 */}
          <div className={cn('flex h-full', activePage !== 'home' && 'hidden')}>
            {/* 左栏:计时器 + 统计,作为整体垂直居中、距栏边缘 40px。
                缩放已保证内容始终放得下,禁止滚动(番茄钟不随滚轮移动) */}
            <div ref={leftPaneRef} className="w-1/2 overflow-hidden">
              <div className="flex min-h-full items-center justify-center">
                <div
                  ref={leftContentRef}
                  className="flex w-[380px] shrink-0 flex-col gap-4"
                  style={{ transform: `scale(${scale})` }}
                >
                  <TimerPanel
                    selectedTask={selectedTask}
                    pomodoroVersion={dataVersion}
                    onPomodoroSaved={refreshData}
                    taskCompletedSignal={taskCompletedSignal}
                  />
                  <StatsPanel dataVersion={dataVersion} />
                </div>
              </div>
            </div>
            {/* 右栏:任务列表,宽度随窗口弹性变化;边缘留白与左栏/设置页统一 p-8,
                任务面板作为浮动卡片随内容自然延伸,滚动交给本层(隐藏系统滚动条) */}
            <div className="scrollbar-hidden h-full w-1/2 overflow-y-auto p-8">
              {loadError && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  数据加载失败，请重试或重启应用
                </div>
              )}
              <TaskPanel
                tasks={tasks}
                selectedTaskId={selectedTaskId}
                onSelectTask={(id) =>
                  setSelectedTaskId((cur) => (cur === id ? null : id))
                }
                onChanged={refreshData}
                onSelectedTaskCompleted={() =>
                  setTaskCompletedSignal((v) => v + 1)
                }
              />
            </div>
          </div>

          {/* 设置页:全局设置面板 */}
          {activePage === 'settings' && <SettingsPanel />}

          {/* 其余页面:占位 */}
          {activePage !== 'home' && activePage !== 'settings' && placeholder && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400">
              <span className="text-5xl">{placeholder.icon}</span>
              <span className="text-sm">{placeholder.label} · 即将上线</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

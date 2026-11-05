import { useEffect, useRef, useState } from 'react';
import {
  TASK_CATEGORIES,
  TASK_CATEGORY_LABELS,
  type TaskCategory,
  type TaskWithCount,
} from '../shared/types';
import { cn } from '@/lib/utils';

// 各分类的展示色：工作-橙 / 学习-粉 / 生活-冰蓝
const CATEGORY_COLORS: Record<
  TaskCategory,
  { dot: string; ring: string; label: string; border: string }
> = {
  work: {
    dot: 'bg-orange-500',
    ring: 'ring-orange-500',
    label: 'text-orange-500',
    border: 'border-orange-500',
  },
  study: {
    dot: 'bg-pink-500',
    ring: 'ring-pink-500',
    label: 'text-pink-500',
    border: 'border-pink-500',
  },
  life: {
    dot: 'bg-sky-400',
    ring: 'ring-sky-400',
    label: 'text-sky-400',
    border: 'border-sky-400',
  },
};

interface TaskPanelProps {
  // 任务列表由 App 持有(计时器也要用),本面板只负责展示与操作
  tasks: TaskWithCount[];
  selectedTaskId: number | null;
  // 点击卡片切换选中(选中逻辑在 App 中做 toggle)
  onSelectTask: (id: number) => void;
  // 任何增删改之后通知 App 重新从数据库同步
  onChanged: () => void;
  // 当前选中的任务被标记完成时通知(计时器随之回到初始状态)
  onSelectedTaskCompleted: () => void;
}

export default function TaskPanel({
  tasks,
  selectedTaskId,
  onSelectTask,
  onChanged,
  onSelectedTaskCompleted,
}: TaskPanelProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TaskCategory>('work');
  // 正在编辑名称的任务 id
  const [editingId, setEditingId] = useState<number | null>(null);

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await window.database.createTask(trimmed, category);
      setName('');
      onChanged();
    } catch (err) {
      console.error('添加任务失败:', err);
    }
  };

  const handleToggle = async (task: TaskWithCount) => {
    const nextCompleted = !task.completed;
    try {
      await window.database.updateTask(task.id, { completed: nextCompleted });
      // 标记完成的是当前选中任务时,通知计时器回到初始状态
      if (nextCompleted && task.id === selectedTaskId) onSelectedTaskCompleted();
      onChanged();
    } catch (err) {
      console.error('更新任务失败:', err);
    }
  };

  const handleRename = async (id: number, nextName: string) => {
    const trimmed = nextName.trim();
    if (trimmed) {
      try {
        await window.database.updateTask(id, { name: trimmed });
      } catch (err) {
        console.error('重命名失败:', err);
      }
    }
    onChanged();
  };

  const handleDelete = async (id: number) => {
    try {
      await window.database.deleteTask(id);
      onChanged();
    } catch (err) {
      console.error('删除任务失败:', err);
    }
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col rounded-3xl border-l border-white/20 bg-white p-8 shadow-md shadow-gray-300/50">
      {/* 标题 + 主题色下划线装饰 */}
      <div className="mb-4">
        <h2 className="text-base font-bold text-gray-700">任务列表</h2>
        <span className="mt-1.5 block h-1 w-10 rounded-full bg-app-primary" />
      </div>

      {/* 任务输入区：输入框 + 分类圆点 + 添加按钮 */}
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="添加新任务..."
          className="h-10 min-w-0 flex-1 rounded-xl border border-gray-300 px-3 text-sm text-gray-700 transition-colors placeholder:text-gray-400 focus:border-app-primary/60 focus:outline-none focus:ring-2 focus:ring-app-primary/15"
        />
        <div className="flex shrink-0 items-center gap-1.5">
          {TASK_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              title={TASK_CATEGORY_LABELS[c]}
              aria-label={`分类:${TASK_CATEGORY_LABELS[c]}`}
              onClick={() => setCategory(c)}
              className={cn(
                'h-5 w-5 rounded-full transition-all',
                CATEGORY_COLORS[c].dot,
                category === c
                  ? cn('ring-2 ring-offset-2', CATEGORY_COLORS[c].ring)
                  : 'opacity-50 hover:opacity-100',
              )}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="添加任务"
          onClick={handleAdd}
          className="h-10 w-10 shrink-0 rounded-xl bg-linear-to-b from-app-primary to-app-primary-dark pb-0.5 text-xl leading-none text-white shadow-lg shadow-app-primary/40 transition-all duration-200 hover:scale-105 hover:brightness-110 active:scale-95"
        >
          +
        </button>
      </div>

      {/* 任务列表 / 空状态 */}
      {tasks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-gray-400">
          <span className="text-5xl">📅</span>
          <span className="text-sm">还没有任务，添加一个开始专注吧</span>
        </div>
      ) : (
        <ul className="mt-6 min-h-0 flex-1 space-y-3 overflow-y-auto">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              selected={task.id === selectedTaskId}
              editing={editingId === task.id}
              onToggleSelect={() => onSelectTask(task.id)}
              onStartEdit={() => setEditingId(task.id)}
              onEndEdit={() => setEditingId(null)}
              onRename={(next) => handleRename(task.id, next)}
              onToggle={() => handleToggle(task)}
              onDelete={() => handleDelete(task.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface TaskItemProps {
  task: TaskWithCount;
  selected: boolean;
  editing: boolean;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onRename: (nextName: string) => void;
  onToggle: () => void;
  onDelete: () => void;
}

function TaskItem({
  task,
  selected,
  editing,
  onToggleSelect,
  onStartEdit,
  onEndEdit,
  onRename,
  onToggle,
  onDelete,
}: TaskItemProps) {
  const [draft, setDraft] = useState(task.name);
  // Esc 取消编辑后卸载输入框仍可能触发 blur，用标志位区分「取消」和「失焦保存」
  const cancelRef = useRef(false);
  const color = CATEGORY_COLORS[task.category];

  useEffect(() => {
    if (editing) {
      setDraft(task.name);
      cancelRef.current = false;
    }
  }, [editing, task.name]);

  // Esc 取消时不保存；否则按回车/失焦保存（空名字视为取消）
  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
    } else {
      onRename(draft);
    }
    onEndEdit();
  };

  return (
    <li
      onClick={() => {
        // 编辑中点击卡片只做失焦保存,不切换选中
        if (!editing) onToggleSelect();
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3',
        // 悬停微微上浮 + 阴影加深;出现时从下方淡入(动画结束不占用 transform,上浮不受影响)
        'animate-fade-in-up transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg',
        // 选中:精致卡片底子 + 四周分类颜色边框;未选中:浅灰底
        selected ? cn('card-refined', color.border) : 'border-gray-100 bg-gray-50/60',
      )}
    >
      {/* 圆形复选框：未完成空心，完成后打勾变绿；不触发卡片选中 */}
      <button
        type="button"
        aria-label={task.completed ? '标记为未完成' : '标记为完成'}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          task.completed
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-gray-300 bg-white hover:border-emerald-500',
        )}
      >
        {task.completed && (
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
          >
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* 任务名（双击编辑）+ 今日番茄数 + 分类小标签 */}
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                cancelRef.current = true;
                onEndEdit();
              }
            }}
            onBlur={commit}
            autoFocus
            className="h-7 w-full rounded-lg border border-app-primary/60 bg-white px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-app-primary/15"
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span
              onDoubleClick={onStartEdit}
              title="双击编辑任务名"
              className={cn(
                'min-w-0 flex-1 truncate text-sm text-gray-700',
                task.completed && 'text-gray-400 line-through opacity-60',
              )}
            >
              {task.name}
            </span>
            {/* 该任务今天完成的番茄数 */}
            {task.pomodoroCount > 0 && (
              <span
                className="shrink-0 text-xs"
                title={`今天已完成 ${task.pomodoroCount} 个番茄`}
              >
                {'🍅'.repeat(task.pomodoroCount)}
              </span>
            )}
            <span
              className={cn(
                'flex shrink-0 items-center gap-1 text-xs',
                color.label,
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', color.dot)} />
              {TASK_CATEGORY_LABELS[task.category]}
            </span>
          </div>
        )}
      </div>

      {/* 删除按钮：悬停任务卡片时显示；不触发卡片选中 */}
      <button
        type="button"
        aria-label="删除任务"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="shrink-0 text-base opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100"
      >
        🗑
      </button>
    </li>
  );
}

// 主进程与渲染进程共享的类型定义（单一来源，避免两处声明漂移）

// 任务分类：数据库中只存英文枚举值，界面显示由 TASK_CATEGORY_LABELS 转换
export const TASK_CATEGORIES = ['work', 'study', 'life'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  work: '工作',
  study: '学习',
  life: '生活',
};

// 番茄钟类型
export const POMODORO_TYPES = ['work', 'short_break', 'long_break'] as const;
export type PomodoroType = (typeof POMODORO_TYPES)[number];

// 任务
export interface Task {
  id: number;
  name: string;
  category: TaskCategory;
  completed: boolean;
  // 标记完成的时间（ISO 字符串），未完成为 null
  completedAt: string | null;
  createdAt: string;
}

// 更新任务时允许携带的字段（均可选，只更新携带的字段）
export interface TaskUpdates {
  name?: string;
  category?: TaskCategory;
  completed?: boolean;
}

// 番茄钟记录
export interface Pomodoro {
  id: number;
  // null 表示没选任务的自由专注
  taskId: number | null;
  // 时长，单位秒（如 25 分钟存 1500）
  duration: number;
  type: PomodoroType;
  startedAt: string;
  endedAt: string;
}

// 记录一个番茄钟时的入参
export interface PomodoroInput {
  taskId: number | null;
  duration: number;
  type: PomodoroType;
  startedAt: string;
  endedAt: string;
}

// 渲染层视图模型:任务 + 该任务今天完成的番茄数
export interface TaskWithCount extends Task {
  pomodoroCount: number;
}

// 迷你窗口的计时阶段:比托盘上报的粗分类更细,与主窗口界面的展示颜色一一对应
export type MiniTimerPhase =
  | 'focus' // 专注中(红)
  | 'break' // 休息中(绿)
  | 'paused' // 暂停(琥珀,含专注/休息暂停)
  | 'break-wait' // 专注完成,等待开始休息(绿)
  | 'idle'; // 空闲 / 休息结束待开始(灰)

// 迷你窗口的计时状态:主窗口渲染进程上报 → 主进程缓存并转发 → 迷你窗口只做显示
export interface MiniTimerState {
  phase: MiniTimerPhase;
  // MM:SS;等待/空闲阶段是界面上即将开始的展示时长
  timeText: string;
  // 计时是否进行中(迷你窗口据此显示暂停/播放按钮)
  running: boolean;
}

// 全局应用设置（electron-store 持久化，字段与 main/settings.ts 中的 schema 一一对应）
export interface AppSettings {
  // 窗口是否置顶（标题栏图钉与设置页开关共用同一份状态）
  alwaysOnTop: boolean;
  // 专注时长（分钟）
  workDuration: number;
  // 短休息时长（分钟）
  shortBreakDuration: number;
  // 长休息时长（分钟）
  longBreakDuration: number;
  // 每完成几个番茄进入长休息
  longBreakInterval: number;
  // 是否启用提示音
  soundEnabled: boolean;
  // 提示音音量（0~1）
  soundVolume: number;
  // 工作结束提示音文件路径（空串表示用内置默认音；
  // 自定义时指向 userData/sounds/ 下的时间戳副本，每次选择路径都不同）
  workEndSoundPath: string;
  // 工作结束提示音的用户原始文件名（仅界面显示用，空串表示默认音）
  workEndSoundName: string;
  // 休息结束提示音文件路径（空串表示用内置默认音；同上为时间戳副本）
  breakEndSoundPath: string;
  // 休息结束提示音的用户原始文件名（仅界面显示用，空串表示默认音）
  breakEndSoundName: string;
  // 是否开机自启
  autoLaunch: boolean;
  // 每日目标番茄数
  dailyGoal: number;
  // 上次庆祝达标的日期（YYYY-MM-DD，空串表示今天还没庆祝过）
  celebrationDate: string;
}

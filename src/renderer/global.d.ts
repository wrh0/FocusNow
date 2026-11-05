import type {
  AppSettings,
  MiniTimerState,
  Pomodoro,
  PomodoroInput,
  Task,
  TaskCategory,
  TaskUpdates,
} from '../shared/types';

export {};

// 与 src/preload.ts 中 contextBridge.exposeInMainWorld 暴露的 API 保持一致
declare global {
  interface Window {
    windowControls: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      // 切到迷你模式(主窗口隐藏,悬浮小窗出现)
      enterMiniMode: () => Promise<void>;
    };
    // 迷你模式的状态上报:每秒把计时状态交给主进程缓存并转发给迷你窗口
    miniReporter: {
      updateState: (state: MiniTimerState) => void;
    };
    settings: {
      // 读取全部设置（字段与默认值由主进程 schema 保证）
      get: () => Promise<AppSettings>;
      // 写入单条设置并返回最新设置对象；不支持的键/类型/越界错误会被主进程拒绝
      set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<AppSettings>;
      // 订阅设置变更广播（任意位置写入成功后主进程推送最新设置）；
      // 返回取消监听函数（组件卸载时调用）
      onChange: (callback: (settings: AppSettings) => void) => () => void;
    };
    sound: {
      // 打开系统对话框选择音频（mp3/wav/ogg），选中后主进程把文件复制为
      // userData/sounds/ 下的时间戳副本并清理旧副本；返回副本路径与原始文件名。
      // 取消返回 null
      pick: (
        kind: 'workEndSoundPath' | 'breakEndSoundPath',
      ) => Promise<{ path: string; name: string } | null>;
      // 清掉该类别在专属目录里的全部副本（恢复默认时调用）
      clear: (kind: 'workEndSoundPath' | 'breakEndSoundPath') => Promise<void>;
      // 把专属目录内的音频文件读成 dataURL（Howler 播放用，每次都重新读盘）；
      // 路径不在专属目录内/文件不存在时抛错
      load: (filePath: string) => Promise<{ dataURL: string; name: string }>;
    };
    notification: {
      // 文案由主进程校验（非文本/超长直接拒绝弹出）
      show: (title: string, body: string) => Promise<void>;
    };
    tray: {
      // 上报计时阶段(idle/focus/break/paused/waiting)与剩余时间(MM:SS 或空串),
      // 主进程校验后拼成托盘悬停文字
      updateStatus: (phase: string, timeText: string) => void;
      // 上报托盘图标(PNG dataURL;空串恢复默认番茄图标)
      updateIcon: (dataURL: string) => void;
      // 监听托盘菜单命令;返回取消监听函数(组件卸载时调用)
      onCommand: (callback: (command: 'toggle' | 'skip') => void) => () => void;
    };
    database: {
      // 任务
      listTasks: () => Promise<Task[]>;
      createTask: (name: string, category: TaskCategory) => Promise<Task>;
      updateTask: (id: number, updates: TaskUpdates) => Promise<Task | null>;
      deleteTask: (id: number) => Promise<void>;
      // 番茄钟记录
      addPomodoro: (record: PomodoroInput) => Promise<Pomodoro>;
      getPomodorosToday: () => Promise<Pomodoro[]>;
      getPomodorosByRange: (startISO: string, endISO: string) => Promise<Pomodoro[]>;
      // 统计
      getCompletedTaskCountToday: () => Promise<number>;
    };
  }
}

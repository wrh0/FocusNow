import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  AppSettings,
  MiniTimerState,
  PomodoroInput,
  TaskCategory,
  TaskUpdates,
} from './shared/types';

// 只暴露必要的窗口控制方法，不暴露整个 ipcRenderer / electron 模块
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  // 切到迷你模式(主窗口隐藏,悬浮小窗出现)
  enterMiniMode: () => ipcRenderer.invoke('window:enter-mini-mode'),
});

// 迷你模式的状态上报:计时逻辑留在主窗口渲染进程,这里只把每秒的最新状态
// 交给主进程(校验后缓存并转发给迷你窗口)
contextBridge.exposeInMainWorld('miniReporter', {
  updateState: (state: MiniTimerState) =>
    ipcRenderer.send('mini:update-state', state),
});

// 全局设置：读写同一份 electron-store 持久化配置。
// 只接受 AppSettings 已声明的键，主进程会再次校验（渲染进程参数一律不可信）
contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    ipcRenderer.invoke('settings:set', key, value),
  // 订阅设置变更广播（主进程在任一写入成功后发给除写入者外的所有窗口）;
  // 返回取消监听函数,组件卸载时调用
  onChange: (callback: (settings: AppSettings) => void) => {
    const listener = (_event: IpcRendererEvent, next: unknown) => {
      // 广播由主进程自己发出,值可信;形状仍是 schema 保证的 AppSettings
      callback(next as AppSettings);
    };
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
});

// 提示音文件：选择(复制副本进应用专属目录)、清理(恢复默认时删副本)
// 与读取(主进程读成 dataURL,只允许读专属目录),渲染进程不直接访问 fs / dialog
contextBridge.exposeInMainWorld('sound', {
  pick: (kind: 'workEndSoundPath' | 'breakEndSoundPath') =>
    ipcRenderer.invoke('sound:pick', kind),
  clear: (kind: 'workEndSoundPath' | 'breakEndSoundPath') =>
    ipcRenderer.invoke('sound:clear', kind),
  load: (filePath: string) => ipcRenderer.invoke('sound:load', filePath),
});

// 桌面通知：文案由主进程校验，点击通知后由主进程把窗口带到最前
contextBridge.exposeInMainWorld('notification', {
  show: (title: string, body: string) =>
    ipcRenderer.invoke('notification:show', title, body),
});

// 系统托盘:渲染进程每秒上报计时状态(主进程更新悬停文字),
// 并接收托盘菜单的计时控制命令(开始/暂停、跳过)
contextBridge.exposeInMainWorld('tray', {
  updateStatus: (phase: string, timeText: string) =>
    ipcRenderer.send('tray:update-status', phase, timeText),
  // 上报托盘图标(PNG dataURL,空串恢复默认图标),主进程校验后 setImage
  updateIcon: (dataURL: string) =>
    ipcRenderer.send('tray:update-icon', dataURL),
  // 返回取消监听函数,渲染组件卸载/重载时调用,避免一次菜单点击触发多次操作
  onCommand: (callback: (command: 'toggle' | 'skip') => void) => {
    const listener = (_event: IpcRendererEvent, command: unknown) => {
      if (command === 'toggle' || command === 'skip') callback(command);
    };
    ipcRenderer.on('tray:command', listener);
    return () => ipcRenderer.removeListener('tray:command', listener);
  },
});

// 数据库操作：渲染进程不直接访问 SQLite，统一通过这些方法由主进程中转
contextBridge.exposeInMainWorld('database', {
  // 任务
  listTasks: () => ipcRenderer.invoke('db:tasks:list'),
  createTask: (name: string, category: TaskCategory) =>
    ipcRenderer.invoke('db:tasks:create', name, category),
  updateTask: (id: number, updates: TaskUpdates) =>
    ipcRenderer.invoke('db:tasks:update', id, updates),
  deleteTask: (id: number) => ipcRenderer.invoke('db:tasks:delete', id),
  // 番茄钟记录
  addPomodoro: (record: PomodoroInput) => ipcRenderer.invoke('db:pomodoros:add', record),
  getPomodorosToday: () => ipcRenderer.invoke('db:pomodoros:today'),
  getPomodorosByRange: (startISO: string, endISO: string) =>
    ipcRenderer.invoke('db:pomodoros:range', startISO, endISO),
  // 统计
  getCompletedTaskCountToday: () =>
    ipcRenderer.invoke('db:tasks:completed-count-today'),
});

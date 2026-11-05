import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { MiniTimerState } from './shared/types';

// 迷你窗口的专用桥:只暴露三件事——接收计时状态(get + on 两路)、切换计时、关闭迷你窗口。
// 刻意不复用主窗口的 preload:迷你窗口不需要数据库/设置/通知/托盘等能力,能力越少越安全
contextBridge.exposeInMainWorld('mini', {
  // 读取主进程缓存的最新计时状态:迷你窗口打开瞬间的第一帧,不等下一秒同步
  getTimerState: (): Promise<MiniTimerState | null> =>
    ipcRenderer.invoke('mini:get-timer-state'),
  // 订阅持续同步(主窗口每秒上报,主进程实时转发);返回取消监听函数
  onTimerState: (callback: (state: MiniTimerState) => void) => {
    const listener = (_event: IpcRendererEvent, state: unknown) => {
      // 状态由主进程 assertMiniTimerState 校验后转发,形状可信
      callback(state as MiniTimerState);
    };
    ipcRenderer.on('mini:timer-state', listener);
    return () => ipcRenderer.removeListener('mini:timer-state', listener);
  },
  // 播放/暂停:主进程转发给主窗口的计时器(与托盘「开始/暂停」同一命令)
  toggleTimer: () => ipcRenderer.send('mini:toggle-timer'),
  // 关闭迷你窗口,主窗口回到屏幕
  close: () => ipcRenderer.send('mini:close'),
});

import type { MiniTimerState } from '../shared/types';

export {};

// 与 src/preload-mini.ts 中 contextBridge.exposeInMainWorld 暴露的 API 保持一致。
// 迷你窗口只有这三件事:接收计时状态、切换计时、关闭迷你窗口
declare global {
  interface Window {
    mini: {
      // 读取主进程缓存的最新计时状态(打开瞬间的第一帧)
      getTimerState: () => Promise<MiniTimerState | null>;
      // 订阅每秒同步;返回取消监听函数(组件卸载时调用)
      onTimerState: (callback: (state: MiniTimerState) => void) => () => void;
      // 播放/暂停(转发给主窗口的计时器执行)
      toggleTimer: () => void;
      // 关闭迷你窗口,主窗口回到屏幕
      close: () => void;
    };
  }
}

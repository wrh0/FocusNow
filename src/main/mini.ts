import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MiniTimerState } from '../shared/types';

// ---------- 迷你窗口 ----------
// 悬浮在屏幕上的小窗口(倒计时数字 + 播放/暂停 + 回主窗口):
// - 计时逻辑完全留在主窗口渲染进程,迷你窗口只显示主进程转发的状态,自己不持有计时状态
// - frame:false 无标题栏无边框、skipTaskbar 不进任务栏;
//   背景用深色不透明——Windows 上透明窗口的内容会被系统圆角截断
// - 层级用 'screen-saver'(高于普通置顶),主窗口即使开着"窗口置顶"也在它之下
// - 位置只在本次运行期间记忆:关闭时记录,再次打开回到该位置;应用重启回到默认右上角

const MINI_WIDTH = 200;
const MINI_HEIGHT = 60;
// 默认停靠在屏幕右上角,与屏幕边缘留一点空隙
const EDGE_MARGIN = 16;

let miniWindow: BrowserWindow | null = null;
// 本次运行期间迷你窗口上次关闭时的位置(刻意不持久化)
let lastPosition: { x: number; y: number } | null = null;
// 主窗口渲染进程上报的最新计时状态:迷你窗口打开瞬间先显示这份,不等下一秒同步
let lastTimerState: MiniTimerState | null = null;

export function hasMiniWindow(): boolean {
  return miniWindow !== null && !miniWindow.isDestroyed();
}

// 主窗口渲染进程每秒上报计时状态:更新缓存,迷你窗口开着就实时转发
export function updateMiniTimerState(state: MiniTimerState): void {
  lastTimerState = state;
  if (hasMiniWindow()) {
    miniWindow?.webContents.send('mini:timer-state', state);
  }
}

export function getMiniTimerState(): MiniTimerState | null {
  return lastTimerState;
}

// 停靠位置:有本次运行记忆就用记忆,否则屏幕右上角
function resolvePosition(): { x: number; y: number } {
  if (lastPosition) return lastPosition;
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - MINI_WIDTH - EDGE_MARGIN,
    y: workArea.y + EDGE_MARGIN,
  };
}

function createMiniWindow(
  getMainWindow: () => BrowserWindow | null,
): BrowserWindow {
  if (miniWindow && !miniWindow.isDestroyed()) return miniWindow;
  const win = new BrowserWindow({
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#1a202c',
    webPreferences: {
      preload: path.join(__dirname, 'preload-mini.js'),
      // 显式声明安全基线,与主窗口保持一致(不依赖上游默认值)
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 主窗口隐藏后窗口可能被系统节流,关掉保证状态同步与拖拽响应不延迟
      backgroundThrottling: false,
    },
  });
  miniWindow = win;
  // 比一般置顶更高的层级,盖过主窗口的置顶状态
  win.setAlwaysOnTop(true, 'screen-saver');

  // 与主窗口一致的导航防护:迷你窗只允许加载自身页面,
  // 不给外来内容挂上 preload 桥的机会
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const selfURL = MINI_WINDOW_VITE_DEV_SERVER_URL
      ? MINI_WINDOW_VITE_DEV_SERVER_URL
      : pathToFileURL(
          path.join(__dirname, `../renderer/${MINI_WINDOW_VITE_NAME}/index.html`),
        ).href;
    if (!url.startsWith(selfURL)) event.preventDefault();
  });

  // 加载失败(如产物缺失/磁盘异常)时 ready-to-show 永远不来,而主窗口此时已被
  // 隐藏——必须兜底把主窗口带回来,用户不能只剩一个托盘图标
  win.webContents.on('did-fail-load', () => {
    if (miniWindow === win) miniWindow = null;
    if (!win.isDestroyed()) win.destroy();
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    }
  });

  // 加载迷你窗口页面(开发模式走独立 dev server,打包后走构建产物);
  // 失败分支由上面的 did-fail-load 统一处理,这里吞掉 rejection 即可
  if (MINI_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MINI_WINDOW_VITE_DEV_SERVER_URL).catch(() => undefined);
  } else {
    win
      .loadFile(
        path.join(__dirname, `../renderer/${MINI_WINDOW_VITE_NAME}/index.html`),
      )
      .catch(() => undefined);
  }
  return win;
}

// 进入迷你模式:显示(或创建)迷你窗口,主窗口隐藏——计时在后台继续
export function enterMiniMode(getMainWindow: () => BrowserWindow | null): void {
  const win = createMiniWindow(getMainWindow);
  win.setPosition(resolvePosition().x, resolvePosition().y);
  // 若渲染端还没加载完,show 交给 ready-to-show;加载完的实例直接显示。
  // 首帧状态由渲染端挂载时主动 getTimerState 拉取(绕开加载时序竞态)。
  // 加载期间重复进入会走到同一分支,先清掉旧监听避免叠加
  if (win.webContents.isLoading()) {
    win.removeAllListeners('ready-to-show');
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });
  } else {
    win.show();
  }
  getMainWindow()?.hide();
}

// 退出迷你模式:迷你窗口隐藏(记住本次运行内的位置),主窗口回到屏幕
export function exitMiniMode(getMainWindow: () => BrowserWindow | null): void {
  if (hasMiniWindow()) {
    const [x, y] = miniWindow?.getPosition() ?? [0, 0];
    lastPosition = { x, y };
    miniWindow?.hide();
  }
  const main = getMainWindow();
  if (main) {
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }
}

// 主窗口的置顶状态切换后重申迷你窗口层级:Windows 上同为 TOPMOST 层的窗口
// 按 z 顺序排列,重新 setAlwaysOnTop 保证迷你窗口始终压在主窗口之上
export function reassertMiniAlwaysOnTop(): void {
  if (hasMiniWindow()) {
    miniWindow?.setAlwaysOnTop(true, 'screen-saver');
  }
}

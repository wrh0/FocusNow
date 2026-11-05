import type { BrowserWindow } from 'electron';
import { Menu, Tray, app, ipcMain, nativeImage } from 'electron';
import { getAppIconPath } from './paths';
import { enterMiniMode } from './mini';

// 托盘悬停文案的阶段名映射:渲染进程每秒上报阶段 + 剩余时间,这里拼最终文字
const PHASE_LABELS: Record<string, string> = {
  idle: '空闲',
  focus: '专注中',
  break: '休息中',
  paused: '已暂停',
  waiting: '等待开始',
};

// 上报的剩余时间必须是 MM:SS 格式(分钟位可到 3 位:专注最长 120 分钟 → "120:00";
// 空闲/等待阶段上报空串)
const TIME_PATTERN = /^\d{2,3}:[0-5]\d$/;

let tray: Tray | null = null;
// 默认图标(番茄 logo):渲染进程上报空串时恢复
let defaultIcon: Electron.NativeImage | null = null;

// 把窗口带到前台:最小化先从任务栏恢复,隐藏到托盘则重新显示
function bringToFront(win: BrowserWindow | null): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// 创建系统托盘:图标、悬停状态文字、右键菜单。
// getWindow 由 main.ts 注入(窗口创建时机可能晚于托盘);
// 计时控制命令通过 tray:command 通道发给渲染进程执行,计时逻辑留在界面一侧
export function createTray(getWindow: () => BrowserWindow | null): void {
  const icon = nativeImage.createFromPath(getAppIconPath());
  defaultIcon = icon;
  tray = new Tray(icon);
  tray.setToolTip('番茄钟 - 空闲');

  // 右键菜单:文字固定不变,「开始/暂停」「跳过」只发命令,由渲染进程决定实际行为
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => bringToFront(getWindow()) },
      {
        // 切到迷你模式:主窗口隐藏,只留悬浮小窗(迷你窗口自己可切回)
        label: '迷你模式',
        click: () => enterMiniMode(getWindow),
      },
      { type: 'separator' },
      {
        label: '开始/暂停',
        click: () => getWindow()?.webContents.send('tray:command', 'toggle'),
      },
      {
        label: '跳过',
        click: () => getWindow()?.webContents.send('tray:command', 'skip'),
      },
      { type: 'separator' },
      {
        // app.quit() 会先触发 before-quit(main.ts 在那里解除关闭拦截),
        // 因此这里的退出不会被「点 × 隐藏到托盘」的逻辑拦住
        label: '退出番茄钟',
        click: () => app.quit(),
      },
    ]),
  );

  // 双击托盘图标显示主窗口
  tray.on('double-click', () => bringToFront(getWindow()));

  // 渲染进程每秒上报计时状态 → 更新悬停文字;入参不合法时静默忽略
  ipcMain.on(
    'tray:update-status',
    (_event, phase: unknown, timeText: unknown) => {
      const label =
        typeof phase === 'string' ? PHASE_LABELS[phase] : undefined;
      if (!label) return;
      const time =
        typeof timeText === 'string' && TIME_PATTERN.test(timeText)
          ? ` ${timeText}`
          : '';
      tray?.setToolTip(`番茄钟 - ${label}${time}`);
    },
  );

  // 渲染进程每秒上报托盘图标(倒计时数字直接画进图标——Windows 悬停中的
  // tooltip 不刷新,图标才是实时可见的);空串恢复默认图标,非法 dataURL 静默忽略
  ipcMain.on('tray:update-icon', (_event, dataURL: unknown) => {
    if (typeof dataURL !== 'string') return;
    if (dataURL === '') {
      if (defaultIcon) tray?.setImage(defaultIcon);
      return;
    }
    if (
      !dataURL.startsWith('data:image/png;base64,') ||
      dataURL.length > 65536
    ) {
      return;
    }
    tray?.setImage(nativeImage.createFromDataURL(dataURL));
  });
}

// 托盘倒计时图标:把剩余时间直接画进托盘图标。
// Windows 悬停 tooltip 由系统控制、悬停期间不刷新,图标是唯一能实时看到时间的方式。
// 底色读 index.css 的 app-* token(@theme static 输出到 :root),与计时器颜色语义一致。

const SIZE = 64;
const RADIUS = 12;

// 阶段 → 底色 CSS 变量(空闲/等待不画数字图标,返回空串让主进程恢复默认图标)
const PHASE_COLORS: Record<string, string> = {
  focus: '--color-app-primary',
  break: '--color-app-break',
  paused: '--color-app-amber',
};

// 读取 :root 上的颜色 token 值
function tokenColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// 画 64x64 圆角底 + 白色加粗倒计时,返回 PNG dataURL(主进程 nativeImage 解码)
export function renderTrayIcon(phase: string, timeText: string): string {
  const colorVar = PHASE_COLORS[phase];
  if (!colorVar || !timeText) return '';
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.beginPath();
  ctx.roundRect(0, 0, SIZE, SIZE, RADIUS);
  ctx.fillStyle = tokenColor(colorVar);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(timeText, SIZE / 2, SIZE / 2 + 1);
  return canvas.toDataURL('image/png');
}

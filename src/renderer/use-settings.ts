import { useSyncExternalStore } from 'react';
import type { AppSettings } from '../shared/types';

// 设置在渲染层的镜像:模块级快照,所有订阅组件共享同一份数据。
// 单一事实来源是主进程的 electron-store——任意位置(设置页/图钉/主进程)写入成功后
// 主进程广播 settings:changed,这里统一接收并通知所有订阅者,
// 保证「A 处改了、B 处立即看到新值」,不存在各组件各持一份旧状态的情况
let snapshot: AppSettings | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

// 浅比较:值完全相同(仅引用不同)的两次更新不触发订阅者重渲染
function isShallowEqual(a: AppSettings, b: AppSettings): boolean {
  for (const key of Object.keys(a) as (keyof AppSettings)[]) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function accept(next: AppSettings): void {
  if (snapshot && isShallowEqual(snapshot, next)) return;
  snapshot = next;
  emit();
}

// 模块加载即拉取初始设置并订阅变更广播(本模块只被 import 一次,整块只执行一次;
// preload 先于渲染进程 bundle 运行,window.settings 此处必然已存在)
void window.settings
  .get()
  .then(accept)
  .catch((err) => console.error('读取设置失败:', err));
window.settings.onChange(accept);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): AppSettings | null => snapshot;

// 全局设置 hook:设置加载完成前返回 null(调用方按需用默认值兜底),
// 之后任意一处写入都会让所有调用组件同步重渲染
export function useSettings(): AppSettings | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// 写入一条设置:先乐观更新快照(写入方界面零延迟),再交主进程校验并持久化。
// 写入成功无需处理——乐观值即最终值;失败则回滚。
// 其他窗口/组件通过主进程广播拿到同一份新值
export function updateSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): void {
  if (!snapshot) return;
  const previous = snapshot;
  accept({ ...snapshot, [key]: value });
  window.settings.set(key, value).catch((err) => {
    console.error(`保存设置 ${String(key)} 失败:`, err);
    accept(previous); // 写失败回滚,界面与实际持久化值保持一致
  });
}

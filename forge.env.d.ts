/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// 迷你窗口的 forge vite 运行时常量(按 forge.config.ts 里 renderer 的 name 生成,
// 官方 d.ts 只手写了 main_window 的声明,这里补上 mini_window 的)
declare const MINI_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MINI_WINDOW_VITE_NAME: string;

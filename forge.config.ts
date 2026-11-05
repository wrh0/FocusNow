import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // 应用 exe/任务栏/窗口的图标:不带扩展名,packager 自动选择 .ico(Windows)
    // 或 .icns(macOS);缺省时发布出去的 exe 会是默认 Electron 图标
    icon: './resources/icon',
    // 应用图标复制到安装目录的 resources/(asar 外),供主进程运行时读取
    // (托盘、窗口、通知的图标);asar 内只有构建产物,不含原始 resources/
    extraResource: ['./resources/icon.png', './resources/icon.ico'],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      // Windows 安装包(Setup.exe)与安装向导的图标;
      // productName 为 FocusNow,安装包名为 FocusNow-<version> Setup.exe
      setupIcon: './resources/icon.ico',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          // 迷你窗口的独立预加载脚本:输出 .vite/build/preload-mini.js,
          // 与主窗口的 preload.js 互不相干(各自只暴露各自窗口需要的能力)
          entry: 'src/preload-mini.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
        {
          // 迷你窗口:独立渲染构建(root 指向自己的页面目录),
          // 与主窗口分别打包、各用各的 dev server
          name: 'mini_window',
          config: 'vite.renderer.mini.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;

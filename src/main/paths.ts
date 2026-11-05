import { app } from 'electron';
import path from 'node:path';

// 应用图标路径:开发时在项目 resources/ 下;
// 打包后由 packagerConfig.extraResource 复制到安装目录的 resources/(asar 外),
// 与 asar 内路径不同,必须按是否已打包分支取值
export function getAppIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'resources', 'icon.png');
}

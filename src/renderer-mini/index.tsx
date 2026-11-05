import { createRoot } from 'react-dom/client';
import MiniApp from './MiniApp';
import '../renderer/index.css';

// 迷你窗口的渲染入口:独立 HTML/独立构建,只渲染 MiniApp 一个组件
createRoot(document.getElementById('root') as HTMLElement).render(<MiniApp />);

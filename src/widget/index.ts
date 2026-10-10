/**
 * 小组件入口。
 *
 * 在根布局（src/app/_layout.tsx）顶层 `import '@/widget'`，
 * 让这段在 bundle 加载时就执行 —— 注册 headless task、订阅 store 推送。
 * 非 Android 平台 setupWidgets 内部直接 return，不会做任何事。
 */
import { setupWidgets } from './widgets';

setupWidgets();

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * 单测配置。
 *
 * 只跑 `src/**` 下的纯逻辑（domain / utils）—— 这一层刻意不依赖 React Native 与 Expo，
 * 所以能在 node 环境里直接跑，不需要 jest-expo 那套模拟。
 * 界面组件不走这里（要测界面就得上 RN 测试渲染器，那是另一件事）。
 *
 * `@` 别名必须显式配上：domain 里的文件会 import `@/utils/datetime`，
 * 而 vitest 不读 tsconfig 的 paths。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    /**
     * 把 transform 结果写进磁盘缓存。
     *
     * 未开时每次 `vitest run` 都要重编译一遍全部模块（实测冷启动 7 分钟，
     * 其中 95% 是 transform）—— 改一行代码等一轮编译，回归就被拖成稀罕事。
     * 缓存按文件内容失效，不会测到旧代码。
     */
    fsModuleCache: true,
  },
});

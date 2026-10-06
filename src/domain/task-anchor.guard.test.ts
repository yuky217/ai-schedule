import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * 守卫：**"这件事算哪一刻"只允许有一个定义**。
 *
 * 收口之前 `time.startAt ?? time.dueAt` 这一行被原样抄了 13 遍
 * （日历页 5 处、首页、详情页 2 处、周视图、输入框、选择器、重复、回顾、
 * 预设 3 处、提醒）。它不会立刻报错，所以没人会想起来改 —— 直到某处悄悄漂移，
 * 表现为"任务算错天 / 提醒错时间"，那时已经很难查是哪一处。
 *
 * 同样地，反方向的 `dueAt ?? startAt`（回答"什么时候**到期**"）也被抄了 4 处，
 * 而它与锚点是**两件不同的事**（一件任务可以既在周三开会、又在周二前交材料）。
 * 两个方向都要有名字，都要守住。
 *
 * 单一化之后，"以后不再长出新的手写版本"不能靠自觉，得靠一条会红的测试。
 * 这里直接扫源码：任何生产代码里再手写 `xxx.startAt ?? xxx.dueAt`（或反向），
 * 这条测试就失败，并告诉你该改用哪个函数。
 *
 * 为什么不用 ESLint：ESLint 的 no-restricted-syntax 也能做，但这条规则
 * 的"意图"需要解释，而它在测试里能写成一整段话，还能顺带给出替代写法。
 */
describe('锚点判据的单一性（防回潮）', () => {
  /** `domain/task.ts` 是唯一合法的家 */
  const HOME = join('src', 'domain', 'task.ts');

  /** 手写口径的各种形状：两个方向、`??`/`||` 都堵 */
  const FORBIDDEN: Array<{ pattern: RegExp; instead: string }> = [
    // "什么时候发生" —— 优先开始
    { pattern: /\.startAt\s*\?\?\s*[^;\n]*\.dueAt/, instead: 'taskAnchor(task)' },
    { pattern: /\.startAt\s*\|\|\s*[^;\n]*\.dueAt/, instead: 'taskAnchor(task)' },
    { pattern: /\.startAt\s*\?\?\s*[^;\n]*\.endAt/, instead: 'timeAnchor(time)' },
    { pattern: /\.endAt\s*\?\?\s*[^;\n]*\.startAt/, instead: 'timeAnchor(time)' },
    // "什么时候到期" —— 优先截止（另一条并列的事实，不是锚点的另一种读法）
    { pattern: /\.dueAt\s*\?\?\s*[^;\n]*\.startAt/, instead: 'taskDue(task)' },
    { pattern: /\.dueAt\s*\|\|\s*[^;\n]*\.startAt/, instead: 'taskDue(task)' },
  ];

  function collectSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectSourceFiles(full));
        continue;
      }
      // 只扫生产代码：测试文件里为了断言可以写字面量，不必受这条约束
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
    }
    return out;
  }

  /** 去掉行内与块注释，避免"注释里提到旧写法"被误判 */
  const stripComments = (line: string): string =>
    line
      .replace(/\/\/.*$/, '')
      .replace(/\/\*.*?\*\//g, '')
      .replace(/^\s*\*.*$/, '');

  it('src 下没有任何一处手写锚点（只有 domain/task.ts 例外）', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const files = collectSourceFiles(join(root, 'src'));

    // 防止遍历写错导致"空跑即通过"的假绿
    expect(files.length).toBeGreaterThan(30);

    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(root, file);
      if (rel === HOME) continue;

      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((raw, index) => {
        const line = stripComments(raw);
        for (const { pattern, instead } of FORBIDDEN) {
          if (pattern.test(line)) {
            violations.push(`${rel}:${index + 1}  ${raw.trim()}   → 改用 ${instead}`);
            break;
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('domain/task.ts 确实提供了这三处定义（别把家搬空了）', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const source = readFileSync(join(root, HOME), 'utf8');
    expect(source).toMatch(/export function timeAnchor/);
    expect(source).toMatch(/export const taskAnchor/);
    expect(source).toMatch(/export function timeDue/);
    expect(source).toMatch(/export const taskDue/);
    expect(source).toMatch(/export function hasAnyTime/);
  });
});

import { ContainerKind, TaskStatus } from './enums';
import type { Task } from './task';

/**
 * 容器（目标 / 项目 / 文件夹）的进度与文案。
 *
 * 进度只用**直属任务**算，不递归子容器 —— 递归汇总会让"文件夹"这种
 * 纯分类的东西也冒出一个百分比，既没意义又让人困惑；
 * 想让子项目计入，把任务挂在子项目上就对了。
 */

export interface ContainerStats {
  total: number;
  done: number;
  open: number;
  /** 0..1 */
  ratio: number;
}

export function containerStats(tasks: Pick<Task, 'status'>[]): ContainerStats {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === TaskStatus.Done).length;
  return { total, done, open: total - done, ratio: total ? done / total : 0 };
}

export const CONTAINER_KIND_LABEL: Record<ContainerKind, string> = {
  [ContainerKind.Goal]: '目标',
  [ContainerKind.Project]: '项目',
  [ContainerKind.Folder]: '文件夹',
};

/** 新建时的默认类型：绝大多数人建的是项目，另外两个要显式选 */
export const DEFAULT_CONTAINER_KIND: ContainerKind = ContainerKind.Project;

/** 容器的时间跨度文案，甘特图旁边那行小字用 */
export function describeContainerSpan(
  container: { startAt?: string | null; endAt?: string | null },
): string | null {
  const fmt = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };
  const start = fmt(container.startAt);
  const end = fmt(container.endAt);
  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} 起`;
  if (end) return `到 ${end}`;
  return null;
}

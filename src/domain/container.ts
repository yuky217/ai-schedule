import type { BaseEntity } from './base';
import type { ChainKind, ContainerKind, ContainerStatus, TaskKind } from './enums';

/**
 * 容器：目标 / 项目（主文档 5.3）。
 *
 * 注意：甘特图只是容器的**一种视图**，不是新实体；
 * 排序、分组、进度汇总都基于 containerId 做，避免模型膨胀。
 * 支持 parentId 自嵌套 —— 项目可以挂在目标下，项目里也能再套项目。
 * （曾经还有「文件夹」这一类，2026-10-10 撤掉：它跟项目在界面上没有区别，
 *   多出来的只有一次"该选哪个"的犹豫。）
 */
export interface Container extends BaseEntity {
  kind: ContainerKind;
  title: string;
  note?: string | null;
  parentId?: string | null;
  /** 项目 / 目标的周期，供甘特图视图使用 */
  startAt?: string | null;
  endAt?: string | null;
  status: ContainerStatus;
}

/** 工作流里的一步：完成 A → 生成 B */
export interface ChainStep {
  id: string;
  title: string;
  taskKind: TaskKind;
  /** 相对上一步的偏移天数 */
  offsetDays?: number | null;
}

/**
 * 链（主文档 5.3）：模板 / 工作流。
 * 模板 = 一套可复用的步骤清单；工作流 = 完成 A 自动生成 B。
 * 骨架阶段只落数据模型，触发器留到能力层实现。
 */
export interface TaskChain extends BaseEntity {
  kind: ChainKind;
  title: string;
  steps: ChainStep[];
}

/** 标记（主文档 5.3）：独立于任务，不参与排程 */
export interface Mark extends BaseEntity {
  kind: 'countdown' | 'countup';
  title: string;
  /** YYYY-MM-DD */
  date: string;
  repeatYearly: boolean;
}

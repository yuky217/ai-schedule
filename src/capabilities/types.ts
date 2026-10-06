/**
 * 能力层（主文档 3.1）：AI 是"入口 + 能力"，不是界面本身。
 *
 * 两条铁律体现在这个文件里：
 * 1. 能力是可开关的，且**默认全部关闭**。关闭时产品依然完整可用（日历、清单不依赖 AI）。
 * 2. 能力是离散的、有名有姓的，不是一个大而全的"AI 助手"。
 *    这样用户能只开"语义检索"而不开"自动排期"，符合"尊重用户的管理能力"。
 */

export const AiCapability = {
  /** 理解：一段自然语言 → 结构化任务 */
  Understand: 'understand',
  /** 归类：自动判断是灵感还是待办、进哪个项目 */
  Classify: 'classify',
  /** 拆解：把"写毕业论文"拆成可执行步骤 */
  Breakdown: 'breakdown',
  /** 排期：结合优先级和空闲时间给出建议安排 */
  Schedule: 'schedule',
  /** 语义检索：用一句话找回想法库里的旧内容 */
  SemanticSearch: 'semantic-search',
  /** 复盘：周期性回顾做了什么、卡在哪 */
  Review: 'review',
} as const;
export type AiCapability = (typeof AiCapability)[keyof typeof AiCapability];

export interface AiCapabilityMeta {
  id: AiCapability;
  name: string;
  description: string;
}

export const AI_CAPABILITIES: readonly AiCapabilityMeta[] = [
  {
    id: AiCapability.Understand,
    name: '理解',
    description: '把一句话变成带时间、带类型的任务',
  },
  {
    id: AiCapability.Classify,
    name: '归类',
    description: '自动判断该进想法库还是收集箱',
  },
  {
    id: AiCapability.Breakdown,
    name: '拆解',
    description: '把大任务拆成能立刻动手的步骤',
  },
  {
    id: AiCapability.Schedule,
    name: '排期',
    description: '按优先级和空闲时间建议安排',
  },
  {
    id: AiCapability.SemanticSearch,
    name: '语义检索',
    description: '用一句话找回以前记过的东西',
  },
  {
    id: AiCapability.Review,
    name: '复盘',
    description: '定期回顾进展与卡点',
  },
] as const;

/** 能力的默认开关状态：一律关闭 */
export const defaultCapabilityFlags = (): Record<AiCapability, boolean> =>
  AI_CAPABILITIES.reduce(
    (acc, cap) => {
      acc[cap.id] = false;
      return acc;
    },
    {} as Record<AiCapability, boolean>,
  );

export interface AiConfig {
  /** 云端接口地址，为空表示还没配 */
  endpoint: string;
  apiKey: string;
}

export const emptyAiConfig: AiConfig = { endpoint: '', apiKey: '' };

/**
 * 能力层的"闸门"：既要看单项开关，也要看接口有没有配。
 * 界面层只需要把设置里的这两样递进来，不需要知道校验细节。
 */
export interface CapabilityGate {
  enabled: Record<AiCapability, boolean>;
  config: AiConfig;
}

export class AiDisabledError extends Error {
  constructor(capability: AiCapability) {
    super(`AI 能力「${capability}」未开启或未配置`);
    this.name = 'AiDisabledError';
  }
}

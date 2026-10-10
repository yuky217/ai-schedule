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
    description: '自动判断该进想法库还是待办',
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
    /**
     * ⚠️ **还没接上**（2026-10-10 核对过）：打开这个开关，代码里没有任何 AI 调用 ——
     * 想法页的搜索始终是 `includes` 子串匹配。它此前唯一的作用是改掉搜索框的
     * 占位文案，那正是"界面在承诺、代码不兑现"。留在这儿是为了别把这件事忘了，
     * 但**不要再让任何界面拿它去承诺什么**。
     */
    id: AiCapability.SemanticSearch,
    name: '语义检索',
    description: '用一句话找回以前记过的东西（尚未实现）',
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
  /**
   * 接口地址。可以是完整的 `https://…/chat/completions`，也可以是服务商的 base_url
   * （如 `https://api.deepseek.com`）—— 由 `resolveChatEndpoint` 补全路径。
   * 为空表示还没配。
   */
  endpoint: string;
  /** 密钥。**只存在这台设备上**（AsyncStorage），不上传任何地方 */
  apiKey: string;
  /** 模型名。各家的叫法不同，用户自己填/从预设带过来（预设只是省一次键入，不是硬编码） */
  model: string;
}

export const emptyAiConfig: AiConfig = { endpoint: '', apiKey: '', model: '' };

/**
 * 服务商预设：**只为了少填两格**，不锁定任何一家。
 * endpoint 与 model 都填进输入框、用户可改 —— 模型名半年一换，
 * 写死在代码里等于给未来埋一个"点了没反应"的坑。
 */
export interface AiProviderPreset {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  /** 给用户看的补充（免费额度、注册门槛） */
  hint: string;
}

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'zhipu',
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.7-flash',
    hint: 'glm-4.7-flash 免费，手机号注册',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    hint: '便宜，需充值；模型名以控制台为准',
  },
];

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

/**
 * 一个能力的"接线说明"：怎么问模型、怎么认它的回答。
 *
 * 放这里而不是 client.ts，是为了让各能力文件 import 它时**不反向依赖 client**
 * （否则 client ← understand ← client 成环）。
 *
 * `parse` 返回 null 的语义很重：**这份结果不能用**。调用方必须退回本地启发式，
 * 而不是"凑合着用一半" —— 一条被 AI 理解错的日程，用户看不出来是错的。
 */
export interface CapabilitySpec<T = unknown> {
  /** 系统提示词。把 `now` 交给它，模型才知道"明天"是哪一天 */
  system: (now: Date) => string;
  /** 用户消息（已脱敏的原文） */
  user: (text: string, context?: Record<string, unknown>) => string;
  /** 校验并映射成结构化结果；null = 不合格 */
  parse: (raw: unknown, ctx: { text: string; now: Date }) => T | null;
}

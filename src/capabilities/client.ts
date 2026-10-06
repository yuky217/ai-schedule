import { AiCapability, AiDisabledError, type AiConfig, type CapabilityGate } from './types';
import { desensitize } from './desensitize';

/**
 * 能力层调用入口 —— 骨架阶段只有"契约 + 守卫"，没有真实网络请求。
 *
 * 为什么先写空实现：
 * 界面层需要提前知道"AiDisabledError 该怎么处理"（降级到本地启发式）。
 * 把失败路径先定下来，后面接真实模型时不会连带改动一堆页面。
 */

export interface CapabilityRequest {
  capability: AiCapability;
  /** 原始输入 */
  text: string;
  /** 是否在调用前自动脱敏，默认 true */
  desensitize?: boolean;
  /** 附加上下文（如已有任务标题，供 AI 参考） */
  context?: Record<string, unknown>;
}

export interface CapabilityResponse<T = unknown> {
  capability: AiCapability;
  /** 已脱敏、实际发出的文本 */
  sentText: string;
  /** 被遮蔽的敏感片段数量 */
  maskedCount: number;
  data: T | null;
}

export function assertCapabilityEnabled(gate: CapabilityGate, capability: AiCapability): void {
  const allowed = gate.enabled[capability];
  const configured = gate.config.endpoint.trim().length > 0;
  if (!allowed || !configured) {
    throw new AiDisabledError(capability);
  }
}

/**
 * 发起一次能力调用。
 *
 * 骨架阶段的实现：校验开关 → 脱敏 → 抛"未接入"。
 * 将来把 `performRemoteCall` 换成真实 fetch 即可，调用方无需改动。
 */
export async function callCapability<T>(
  gate: CapabilityGate,
  request: CapabilityRequest,
): Promise<CapabilityResponse<T>> {
  assertCapabilityEnabled(gate, request.capability);

  const shouldMask = request.desensitize ?? true;
  const { text: sentText, maskedCount } = shouldMask
    ? desensitize(request.text)
    : { text: request.text, maskedCount: 0 };

  const data = await performRemoteCall<T>(gate.config, request.capability, sentText, request.context);

  return {
    capability: request.capability,
    sentText,
    maskedCount,
    data,
  };
}

/**
 * TODO(接入真实模型时替换)：POST { endpoint }，带上能力名与脱敏后的文本。
 * 现在直接返回 null，让调用方走本地降级路径。
 */
async function performRemoteCall<T>(
  config: AiConfig,
  capability: AiCapability,
  text: string,
  context?: Record<string, unknown>,
): Promise<T | null> {
  void config;
  void capability;
  void text;
  void context;
  return null;
}

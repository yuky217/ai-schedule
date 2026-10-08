import { desensitize } from './desensitize';
import { understandSpec } from './understand';
import {
  AiCapability,
  AiDisabledError,
  type AiConfig,
  type CapabilityGate,
  type CapabilitySpec,
} from './types';
import type { ParsedSchedule } from '@/domain/parse-schedule';

/**
 * 能力层调用入口。
 *
 * 2026-10-08 起**不再是骨架**：`performRemoteCall` 会真的发一次 HTTPS 请求。
 * 协议按 **OpenAI 兼容的 `/chat/completions`** 走 —— 这是国内几家的最大公约数
 * （DeepSeek、智谱 GLM、Kimi、通义、硅基流动都兼容），于是"支持哪家模型"
 * 这件事从代码问题变成了**配置问题**：用户填地址、密钥、模型名即可。
 *
 * 三条不可动摇的边界：
 * 1. **失败一律抛错、绝不返回半成品**。调用方（记录入口）拿到错就退回本地
 *    启发式解析 —— 宁可识别得笨一点，也不能把一条错的任务写进库。
 * 2. **默认脱敏后再发**（见 desensitize.ts）。宁可多发几次"信息不足"的请求，
 *    也不把手机号、身份证原样送出去。
 * 3. 密钥只存在这台设备的 AsyncStorage 里，除了目标服务商，不流向任何地方。
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

/** 调用失败。message 是**能直接给用户看的中文**，因为设置页要如实显示它 */
export class AiCallError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AiCallError';
    this.status = status;
  }
}

export function assertCapabilityEnabled(gate: CapabilityGate, capability: AiCapability): void {
  const allowed = gate.enabled[capability];
  const configured = gate.config.endpoint.trim().length > 0 && gate.config.model.trim().length > 0;
  if (!allowed || !configured) {
    throw new AiDisabledError(capability);
  }
}

/**
 * 「用模型理解一段话」—— 记录入口用的那个便捷版本。
 *
 * 它**永远不抛错**：没开能力、没配地址、网络不通、模型答得不成形，
 * 一律返回 null，调用方拿着 null 走本地启发式（`parseSchedule`）。
 * 这是"AI 只是加分项"这条底线的落点：**AI 挂掉不能让记录这件事挂掉** ——
 * 记录是主线，识别得聪明一点只是加分。
 *
 * 脱敏默认开着（见 client 顶部的边界说明）：发出去的文本里手机号、身份证
 * 已经是 `[已遮蔽]`。宁可识别得少一点，也不把原始隐私送出去。
 */
export async function understandText(
  gate: CapabilityGate,
  text: string,
  options: { desensitize?: boolean } = {},
): Promise<ParsedSchedule | null> {
  try {
    const res = await callCapability<ParsedSchedule>(gate, {
      capability: AiCapability.Understand,
      text,
      desensitize: options.desensitize,
    });
    return res.data ?? null;
  } catch {
    return null;
  }
}

/** 已经接了真实实现的能力。其余五项仍是"有开关、没接线"（返回 null，走本地降级） */
const CAPABILITY_SPECS: Partial<Record<AiCapability, CapabilitySpec<unknown>>> = {
  [AiCapability.Understand]: understandSpec,
};

/** 默认超时。手机上等 15 秒已经是耐心的上限，再久不如退回本地识别 */
const DEFAULT_TIMEOUT_MS = 15_000;

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * 发起一次能力调用。校验开关 → 脱敏 → 请求 → 解析 → 返回结构化结果。
 * 抛 `AiDisabledError`（没开/没配）或 `AiCallError`（网络、密钥、格式）。
 */
export async function callCapability<T>(
  gate: CapabilityGate,
  request: CapabilityRequest,
): Promise<CapabilityResponse<T>> {
  assertCapabilityEnabled(gate, request.capability);

  const spec = CAPABILITY_SPECS[request.capability];
  if (!spec) {
    // 还没接线：保持"调用成功但没有数据"，调用方自然走本地路径
    const { text: sentText, maskedCount } = stripIfNeeded(request);
    return { capability: request.capability, sentText, maskedCount, data: null };
  }

  const shouldMask = request.desensitize ?? true;
  const { text: sentText, maskedCount } = shouldMask
    ? desensitize(request.text)
    : { text: request.text, maskedCount: 0 };

  const now = new Date();
  const raw = await chatCompletion(gate.config, [
    { role: 'system', content: spec.system(now) },
    { role: 'user', content: spec.user(sentText, request.context) },
  ]);

  const json = extractJson(raw);
  if (json == null) {
    throw new AiCallError(`模型没有按要求返回 JSON：${raw.slice(0, 60)}`);
  }

  const parsed = spec.parse(json, { text: sentText, now });
  if (parsed == null) {
    // 少了名字 / 时间不成形 —— 这份结果不能用。**不猜**，退回本地识别
    throw new AiCallError('模型返回的内容不完整，已改用本地识别');
  }

  return {
    capability: request.capability,
    sentText,
    maskedCount,
    data: parsed as T,
  };
}

function stripIfNeeded(request: CapabilityRequest) {
  const shouldMask = request.desensitize ?? true;
  return shouldMask ? desensitize(request.text) : { text: request.text, maskedCount: 0 };
}

/**
 * 把用户填的地址补成可用的 chat 接口地址。
 *
 * 允许两种写法：完整地址（`…/chat/completions`）原样用；否则当 base_url，
 * 去尾斜杠后拼 `/chat/completions`。这样"`https://api.deepseek.com`"和
 * "`https://open.bigmodel.cn/api/paas/v4`"两种形态都能直接粘。
 */
export function resolveChatEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

/**
 * 发一次 chat 请求，返回模型回复的**纯文本**。
 *
 * 只做一件事：把网络这一层的每个失败都翻译成一句用户看得懂的话 ——
 * 因为这条链路的失败在手机上就是"点了一下没反应"，而设置页的「测试连接」
 * 要能说清到底是密钥错了、地址错了，还是网络不通。
 */
export async function chatCompletion(
  config: AiConfig,
  messages: readonly ChatMessage[],
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const url = resolveChatEndpoint(config.endpoint);
  if (!url) throw new AiCallError('还没填接口地址');

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        // 理解这类任务要的是稳定，不是创意
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new AiCallError(`等了 ${Math.round(timeoutMs / 1000)} 秒没回应，检查一下网络`);
    }
    throw new AiCallError(`连不上接口：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await response.text().catch(() => '');

  if (!response.ok) {
    const detail = extractErrorMessage(bodyText);
    const hint =
      response.status === 401 || response.status === 403
        ? '（密钥不对或没权限）'
        : response.status === 404
          ? '（接口地址不对）'
          : '';
    throw new AiCallError(`接口返回 ${response.status}${hint}${detail ? `：${detail}` : ''}`, response.status);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new AiCallError('接口返回的不是 JSON，确认地址填的是 chat 接口');
  }

  const content = readContent(payload);
  if (content == null) {
    throw new AiCallError('接口返回里没有回复内容，确认模型名填对了');
  }
  return content;
}

/** 从 OpenAI 兼容的响应体里取 `choices[0].message.content` */
function readContent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload == null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  return typeof content === 'string' && content.trim() ? content : null;
}

/** 服务端出错时会回一句人话（`{"error":{"message":"..."}}`），能捞就捞出来给用户看 */
function extractErrorMessage(bodyText: string): string {
  try {
    const payload = JSON.parse(bodyText) as unknown;
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === 'string') return error.message.slice(0, 120);
    const msg = (payload as { message?: unknown }).message;
    if (typeof msg === 'string') return msg.slice(0, 120);
  } catch {
    // 不是 JSON 就算了 —— 状态码本身已经说明了问题
  }
  return '';
}

/**
 * 从模型回复里抠出 JSON。
 *
 * 即便再三嘱咐"只输出 JSON"，模型仍常包一层 ```json 围栏或在前后加一句客套 ——
 * 这不是模型的错，是自然语言的常态，所以解析必须容错而不是苛责。
 */
export function extractJson(text: string): unknown | null {
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

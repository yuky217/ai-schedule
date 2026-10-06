/**
 * 脱敏（主文档 7.4）：敏感内容本地保留、脱敏后再调用。
 *
 * 原则：宁可多发几次"信息不足"的请求，也不把原始隐私送出去。
 * 这里做的是最低限度的正则遮蔽 —— 手机号、邮箱、身份证、银行卡。
 * 真正的"这条内容算不算敏感"应由用户自己判断，所以对外只提供显式调用，
 * 不做隐式全局替换（隐式替换会让用户以为数据没出去）。
 */

export interface DesensitizeResult {
  text: string;
  /** 命中并遮蔽的模式数量，可在 UI 上如实告诉用户"已遮蔽 3 处" */
  maskedCount: number;
}

const PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: '手机号', re: /1[3-9]\d{9}/g },
  { name: '邮箱', re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { name: '身份证号', re: /\b\d{17}[\dXx]\b/g },
  { name: '银行卡号', re: /\b\d{16,19}\b/g },
];

export function desensitize(input: string): DesensitizeResult {
  let text = input;
  let maskedCount = 0;

  for (const { re } of PATTERNS) {
    text = text.replace(re, () => {
      maskedCount += 1;
      return '[已遮蔽]';
    });
  }

  return { text, maskedCount };
}

/** 计算脱敏后要发送的载荷大小，用于给用户一个"到底传了多少"的直观感受 */
export function estimatePayloadSize(text: string): number {
  // 中文字符按 UTF-8 三个字节估算，够用了
  return new TextEncoder().encode(text).length;
}

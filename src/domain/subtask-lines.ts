/**
 * 子项批量输入：**一段文字 → 好几条子任务**。
 *
 * 拆一件事本来就不是一个一个来的：脑子里冒出来的是"先查资料、再写提纲、
 * 最后发给小王"一串，让用户在输入框里建一个、点一次、再建一个，
 * 是把一次思考切成三次操作。所以这里支持一口气写完 ——
 * 一行一步，或者从别处复制好的清单整段粘进来。
 *
 * 只认换行。**不猜逗号和顿号**：一句话里本来就有逗号（"买菜，顺便取快递"），
 * 拿标点切会把用户的话切碎。换行是唯一"用户明确表示这是另一条"的信号。
 *
 * 列表符号会剥掉 —— 从备忘录、聊天记录里复制来的清单大多带着 `- `、`1. `，
 * 那不是标题的一部分。
 */
const BULLET = /^[-*•·]\s*/;
const ORDERED = /^\d+[.、)）]\s*/;
const CIRCLED = /^[①-⓿]\s*/;

/**
 * 把一段文字拆成若干条子项标题。
 * 空行、纯符号行都丢掉；顺序保持用户写的顺序（顺序就是他心里的先后）。
 */
export function splitSubtaskLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(BULLET, '').replace(ORDERED, '').replace(CIRCLED, '').trim();
    if (line) lines.push(line);
  }
  return lines;
}

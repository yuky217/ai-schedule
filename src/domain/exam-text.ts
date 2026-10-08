/**
 * 教务系统「考试信息查询」文本 → 考试草稿。
 *
 * 输入是用户从教务网页复制的表格文本。真实的表格复制出来是
 * "制表符/空白分隔的一行长文本"，一学期一行一场考试：
 *
 *   2025-2026  2  高等数学  2026-07-08(14:30-16:30)  教B216  2025-2026（2）  25级工联技1班-…  试卷  2GJ34962  否  南海  人工智能学院
 *
 * 一行里真正需要的只有三样：**课程名、考试时间、地点**。其余列（学年、学期、
 * 考试名称、班组、方式、课程代码、校区、学院）全部丢弃 —— 它们是教务的账目，
 * 不是日程。
 *
 * 解析策略是"认标记，不数列"：以 `2026-07-08(14:30-16:30)` 这种日期(时段)为锚点，
 * 课程名取锚点前第一个"像课名"的 token，教室取锚点后第一个"像教室"的 token。
 * 不按列号数 —— 不同学校的列序不同，复制时列还可能粘连或丢失，数列必错。
 *
 * 纯函数：不碰数据库、不碰 RN。认不出来就进 problems，绝不猜。
 */

import { createEvent } from './factory';
import type { CalEvent } from './event';

export interface ExamDraft {
  title: string;
  /** ISO 时刻（本地） */
  startAt: string;
  endAt: string | null;
  location: string | null;
}

export interface ExamParseResult {
  exams: ExamDraft[];
  problems: string[];
}

/** 学年 / 学期这类"出现在课名前面的数字串" —— 不能当课名 */
const META_TOKEN =
  /^(?:\d{4}(?:[-–]\d{4})?|\d{1,2}|全部|学期|学年|考试名称|考试地点|课程名称|考试方式|备注|课程代码|重修标记|考试校区|开课学院|教学班组名称)$/;

/** 教室：教B216 / 教A108 / 实训楼305 / B216 这类 —— 字头少量非数字 + 2~4 位数字 */
const LOCATION_TOKEN = /^[^\d\s]{0,4}[A-Za-z]?[0-9]{2,4}室?$/;
/** 这些字一出现就绝不是教室（是班组/学院/备注） */
const NOT_LOCATION = /[班组级院系卷笔查]/;

/**
 * `2026-07-08(14:30-16:30)` —— 全角括号也认（有的教务页面是全角）。
 * 捕获组：1年 2月 3日 4时 5分 6时(止) 7分(止)
 */
const EXAM_TIME =
  /(\d{4})-(\d{1,2})-(\d{1,2})\s*[（(]\s*(\d{1,2}):(\d{2})\s*[-–—~]\s*(\d{1,2}):(\d{2})\s*[)）]/;

/** 只有日期没有时段（少见；按当天 00:00 处理，界面只显示日期感） */
const EXAM_DATE = /(\d{4})-(\d{1,2})-(\d{1,2})/;

/** 本地时间 → ISO。日期不存在（13 月 40 日）返回 null，不让 Date 静默进位 */
function buildIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string | null {
  const d = new Date(year, month - 1, day, hour, minute);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute
  ) {
    return null;
  }
  return d.toISOString();
}

export function parseExamText(text: string): ExamParseResult {
  const problems: string[] = [];
  const exams: ExamDraft[] = [];
  const seen = new Set<string>();

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const timeMatch = EXAM_TIME.exec(line);

    // ---- 时间 ----
    let startAt: string | null = null;
    let endAt: string | null = null;
    let matchText = '';

    if (timeMatch) {
      const [, y, mo, d, h, mi, eh, em] = timeMatch;
      matchText = timeMatch[0];
      startAt = buildIso(Number(y), Number(mo), Number(d), Number(h), Number(mi));
      if (!startAt) {
        problems.push(`日期不存在，跳过：${timeMatch[0]}`);
        continue;
      }
      // 结束时刻：同一天的钟点。止 < 起 说明数据坏了，宁可丢掉止点也不显示倒着的时段
      const endIso = buildIso(Number(y), Number(mo), Number(d), Number(eh), Number(em));
      if (endIso && endIso > startAt) endAt = endIso;
      else problems.push(`结束时间不比开始晚，只保留了开始：${timeMatch[1]}-${timeMatch[2]}-${timeMatch[3]}`);
    } else {
      const dateMatch = EXAM_DATE.exec(line);
      if (!dateMatch) continue; // 不是考试行（表头、页脚……），静默跳过
      const [, y, mo, d] = dateMatch;
      matchText = dateMatch[0];
      startAt = buildIso(Number(y), Number(mo), Number(d), 0, 0);
      if (!startAt) {
        problems.push(`日期不存在，跳过：${dateMatch[0]}`);
        continue;
      }
      problems.push(`这场没带考试时间，按当天 0 点记：${dateMatch[0]}`);
    }

    // ---- 课程名：日期标记之前的最后一个"像课名"的 token ----
    const before = line.slice(0, line.indexOf(matchText));
    const beforeTokens = before.split(/[\t\s]+/).filter(Boolean);
    let title = '';
    for (let i = beforeTokens.length - 1; i >= 0; i -= 1) {
      const token = beforeTokens[i]!;
      if (META_TOKEN.test(token)) continue;
      title = token;
      break;
    }
    if (!title) {
      problems.push(`认出了时间但没认出课程名，跳过：${line.slice(0, 40)}`);
      continue;
    }

    // ---- 教室：日期标记之后的第一个"像教室"的 token ----
    const after = line.slice(line.indexOf(matchText) + matchText.length);
    const afterTokens = after.split(/[\t\s]+/).filter(Boolean);
    let location: string | null = null;
    for (const token of afterTokens) {
      if (EXAM_DATE.test(token)) continue;
      if (!LOCATION_TOKEN.test(token) || NOT_LOCATION.test(token)) continue;
      location = token;
      break;
    }

    // ---- 去重：同一门课同一时刻出现两次（复制重复、表格粘了两遍）只留一条 ----
    const key = `${title}#${startAt}#${location ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    exams.push({ title, startAt, endAt, location });
  }

  if (!exams.length && text.trim() && !problems.length) {
    problems.push('没认出任何考试 —— 检查一下粘的是不是「考试信息查询」的表格');
  }

  exams.sort(
    (a, b) =>
      a.startAt.localeCompare(b.startAt) ||
      a.title.localeCompare(b.title, 'zh'),
  );
  return { exams, problems };
}

/** 草稿 → 实体（导入确认时用；kind/source 在这里统一，调用方不用管） */
export function examDraftToEvent(draft: ExamDraft): CalEvent {
  return createEvent({
    kind: 'exam',
    title: draft.title,
    location: draft.location,
    startAt: draft.startAt,
    endAt: draft.endAt,
    source: 'exam-import',
  });
}

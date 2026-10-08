import { addDays, addMonths, startOfDay, startOfWeek } from 'date-fns';

import { RepeatFreq, TimeAttribute } from './enums';
import { describeReminder, describeRepeat } from './repeat-next';
import { timeAnchor, type RepeatRule, type TaskTime } from './task';

/**
 * 从一句话里识别时间与重复（"自动识别日程"的本地启发式实现）。
 *
 * "明天下午3点开会"   → 标题「开会」+ 固定时间明天 15:00
 * "每周五晚上7点健身" → 标题「健身」+ 重复每周五 + 下一个周五 19:00
 * "下个月10号前交合同" → 标题「交合同」+ 截止下月 10 号 23:59
 * "明天9点开会，提前半小时提醒我" → 标题「开会」+ 明天 9:00 + 提醒提前 30 分钟
 *
 * 设计原则：
 * - 纯函数、不依赖 React Native，方便单测；
 * - 这是能力层关闭时的降级方案，也是日常主力 —— 大多数场景不需要大模型；
 * - 识别不出的情况一律返回 null，上层自然落到收集箱，绝不瞎猜；
 * - **不猜，但也不丢**：拿不准的连"一半"都不认（见下面重复与日期的顺序说明）。
 *
 * 覆盖面参照滴答清单的"智能识别日期"（官方示例：周五下午3点开会 / 每月25号还信用卡 /
 * 下个月10号前完成合同 / 每周五晚上7点健身 / 今晚8点提醒吃药 / 明年6月1日）。
 * 它靠云端语义模型，我们靠本地正则 —— 所以只做**词形明确**的部分，
 * 语义含糊的（"过几天"、"月底"、"下下周内"）宁可不认。
 */

export interface ParsedSchedule {
  /** 去掉时间词与重复词后、**提炼过的**标题（粘一整段通知时只取它真正的那一行） */
  title: string;
  /**
   * 标题之外剩下的正文。粘一整段通知时，"服装要求：xxx""请假条…"这类信息
   * 全落在这儿 —— **不丢**是这一层唯一的立场。识出来的时间与地点不在此列：
   * 它们已经进了各自的字段，备注里再留一份只是重复。
   */
  note: string | null;
  /** 识别出的时间；null = 没识别到 */
  time: TaskTime | null;
  /**
   * 识别出的地点；null = 没识别到（或写的是"待定"这类空信息）。
   *
   * 认到之后它就从正文里切走了 —— 地点已经在字段上，备注里再留一份只是重复
   * （与"时间渣"同一个道理，见 `extractLocation`）。
   */
  location: string | null;
  /** 命中的地点片段原文 */
  locationMatched: string | null;
  /** 识别出的重复；null = 没识别到 */
  repeat: RepeatRule | null;
  /**
   * 文字里写明的提醒提前量（分钟）；0 = 准点；**null = 没写**。
   *
   * 注意与 `reminderUnspecified` 的分工：这里只是"写没写具体多久"，
   * 至于"到底提不提醒"，由 domain/reminder 的 `resolveReminderMinutes` 收口 ——
   * 没提提醒就不提醒，提了没写量才按事情类型给默认值。
   */
  reminder: number | null;
  /** 提了"提醒"但没说提前多久（"记得提醒我"） */
  reminderUnspecified: boolean;
  /** 人类可读的提醒，如 "提前 30 分钟" / "提醒" */
  reminderLabel: string | null;
  /** 命中的提醒片段原文 */
  reminderMatched: string | null;
  /** 人类可读的时间，如 "明天 15:00" */
  label: string | null;
  /** 人类可读的重复，如 "每周五" */
  repeatLabel: string | null;
  /** 命中的时间片段原文 */
  matched: string | null;
  /** 命中的重复片段原文 */
  repeatMatched: string | null;
}

/** 文本片段区间，用于把"重复"和"时间"两段从标题里一次切干净 */
interface Span {
  start: number;
  end: number;
}

const WEEKDAY_OF: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
};

const DAY_WORD = '(今天|今日|今晚|明晚|明天|明日|后天|大后天|(?:这|本)?周末)';
const WEEKDAY_WORD = '((?:下下?|本|这)?(?:周|星期|礼拜)[一二三四五六日天])';
const DATE_WORD =
  '(下下?个?月\\d{1,2}[日号]|本个?月\\d{1,2}[日号]|\\d{1,2}月\\d{1,2}[日号]|\\d{1,2}[日号])';
const DATE_EXPR = `(?:${DAY_WORD}|${WEEKDAY_WORD}|${DATE_WORD})`;
/**
 * 时刻。捕获组（相对整体 = base）：
 * base+1 整体 / base+2 时段词 / base+3 小时 / base+4 分或"半" / base+5 冒点时 / base+6 冒点分
 *
 * 数字与"点/分"之间允许空格：「早上 7 点」是贴备忘时最常见的写法。
 * 小时位**中文数字也算数**（"下午五点"）：一至十、十X、两，最多两个字
 * （2026-10-08 补，此前只认阿拉伯数字，"下午五点"会安静地落成"当天截止 23:59"）。
 */
const TIME_EXPR =
  '((凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\\s*(\\d{1,2}|[一二两三四五六七八九十]{1,2})\\s*[点时]\\s*(半|(\\d{1,2})\\s*分?)?|(\\d{1,2}):(\\d{2}))';
const RANGE_SEP = '(?:到|至|~|～|—|–|-|——)';
/** 时段里第二段 TIME_EXPR 的整体组下标：第一段占 1..7，所以第二段整体是 8 */
const RANGE_END_BASE = 8;

export function parseSchedule(raw: string, now: Date = new Date()): ParsedSchedule {
  const text = raw.trim();
  if (!text) return empty('');

  /*
   * ① 先认重复，而且**在原文上认**。
   *
   * 「每周五」里含「周五」，如果先跑日期规则，「每周五晚上7点」会被读成
   * 「这周五晚上7点」—— 一次性的。这个错法最难受的地方是**看起来完全正常**：
   * 时间对、星期对，只是它再也不会在下周五出现。所以顺序不能反。
   */
  const rep = extractRepeat(text);

  /*
   * ② 时间同样在**原文**上认，而不是在"抠掉重复之后的残文"上认。
   *
   * 反例：「每周五前交报告」——重复片段是「每周五」、截止锚点是「周五前」，
   * 两段在原文里**重叠**。谁先抠谁，另一个就找不到了（先抠重复 → 剩「前交报告」，
   * 认不出日期，于是一条"每周五之前交"的任务变成了没有任何期限的重复任务）。
   * 所以两段各记各的区间，最后一起切。
   */
  const tm = parseTime(text, now);

  // ③ 提醒："提前半小时提醒我" / "记得提醒我"。命中的片段同样要切掉 —— 它是指令，不是内容
  const remind = extractReminder(text);

  /*
   * ④ 地点。**与时间片段重叠就整个作废**：中文里「地点：xxx」的值一直吃到行尾，
   * 而"值后面紧跟时刻"的写法（"地点：教一101 19:00"）会让它把时间也吞进来 ——
   * 那样切完就**少了一个时刻**，而时间比地点重要得多。宁可退回"没认出地点"。
   */
  const place = (() => {
    const hit = extractLocation(text);
    if (!hit) return null;
    const clash = [...(rep?.spans ?? []), ...(tm?.spans ?? [])].some((s) =>
      overlaps(s, hit.spans[0]!),
    );
    return clash ? null : hit;
  })();

  const spans = [
    ...(rep?.spans ?? []),
    ...(tm?.spans ?? []),
    ...(remind?.spans ?? []),
    ...(place?.spans ?? []),
  ];
  let picked = pickTitle(removeSpans(text, spans) || text);
  /*
   * 提醒是**指令**、不是内容，所以默认连它一起切。但极端输入会切得什么都不剩 ——
   * "明天9点提醒我"：时间和"提醒我"都切掉之后，一个字的标题都没有了。
   * 这时退一步：只切时间，把"提醒我"留下来当标题。**空标题比丑标题糟得多** ——
   * 空标题会让上层退回用整段原文（连时间词一起）当名字。
   */
  if (!/[\p{L}\p{N}]/u.test(picked.title)) {
    const onlyTime = pickTitle(
      removeSpans(text, [...(rep?.spans ?? []), ...(tm?.spans ?? []), ...(place?.spans ?? [])]),
    );
    if (/[\p{L}\p{N}]/u.test(onlyTime.title)) picked = onlyTime;
  }

  /*
   * ⑤ 重复里已经写明周几时，**第一期以它为准**。
   *
   * 「每周一三五跑步」里的「周一」只是列表的第一项，不代表第一期就在周一 ——
   * 用户等的是眼下最近的那一次。日期规则只会匹配到列表里的第一个「周X」，
   * 于是好端端一条"每周一三五"会显示成"下周一才开始"。同理「每周五」在
   * 今天正好是周五、而时刻已过时，也该顺延到下周而不是显示一个过去的时刻。
   */
  const aligned =
    rep?.repeat.freq === RepeatFreq.Weekly && rep.repeat.byWeekday?.length
      ? alignToWeekdays(tm?.time ?? null, rep.repeat.byWeekday, now)
      : (tm?.time ?? null);

  return {
    title: picked.title,
    note: picked.rest,
    time: aligned,
    location: place?.location ?? null,
    locationMatched: place?.raw ?? null,
    repeat: rep?.repeat ?? null,
    reminder: remind?.minutes ?? null,
    reminderUnspecified: Boolean(remind && remind.minutes == null),
    reminderLabel: remind?.label ?? null,
    reminderMatched: remind?.raw ?? null,
    label: tm?.label ?? null,
    repeatLabel: rep?.label ?? null,
    matched: tm?.raw ?? null,
    repeatMatched: rep?.raw ?? null,
  };
}

function empty(text: string): ParsedSchedule {
  return {
    title: text,
    note: null,
    time: null,
    location: null,
    locationMatched: null,
    repeat: null,
    reminder: null,
    reminderUnspecified: false,
    reminderLabel: null,
    reminderMatched: null,
    label: null,
    repeatLabel: null,
    matched: null,
    repeatMatched: null,
  };
}

/* ------------------------------------------------------------------ */
/* 重复                                                                */
/* ------------------------------------------------------------------ */

interface RepeatHit {
  repeat: RepeatRule;
  label: string;
  spans: Span[];
  raw: string;
}

/**
 * 认重复。**按"越具体越靠前"排**，命中一个就收工：
 * 「每周末」必须排在「每周」之前，否则"末"字不匹配周几字符类时会掉到「每周」兜底，
 * 把"每周末"读成"每周"（每周一次 vs 每周两次，差一倍）。
 *
 * 不做「每年」：`RepeatFreq` 里没有 yearly，而"每年"的场景（生日、年检、纪念日）
 * 主文档已经划给**纪念日**实体了（`marks.repeat_yearly`）。在这里造一个存不进
 * UI 的规则，就是"留了个没人能碰到的字段" —— 宁可少认一个，也不留半截能力。
 */
function extractRepeat(text: string): RepeatHit | null {
  const make = (rule: RepeatRule, matched: string, index: number): RepeatHit => ({
    repeat: rule,
    label: describeRepeat(rule),
    spans: [{ start: index, end: index + matched.length }],
    raw: matched,
  });

  /** 每个候选返回 RepeatRule 与命中的正则匹配；按顺序取第一个命中的 */
  const candidates: Array<() => { rule: RepeatRule; m: RegExpExecArray } | null> = [
    // 每周末 / 每个双休日 → 周六 + 周日
    () => {
      const m = /每(?:个)?(?:周末|双休日?)/.exec(text);
      return m ? { rule: { freq: RepeatFreq.Weekly, interval: 1, byWeekday: [0, 6] }, m } : null;
    },
    // 工作日 / 每个工作日
    () => {
      const m = /(?:每(?:个)?)?工作日/.exec(text);
      return m
        ? { rule: { freq: RepeatFreq.Weekly, interval: 1, byWeekday: [1, 2, 3, 4, 5] }, m }
        : null;
    },
    // 每周一三五 / 每周一 / 每星期一
    () => {
      const re = new RegExp(`每(?:周|星期|礼拜)([一二三四五六日天]{1,7})`);
      const m = re.exec(text);
      if (!m) return null;
      const days = [
        ...new Set([...m[1]!].map((c) => WEEKDAY_OF[c]).filter((d): d is number => d != null)),
      ].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      if (!days.length) return null;
      return { rule: { freq: RepeatFreq.Weekly, interval: 1, byWeekday: days }, m };
    },
    // 每隔 2 天 / 每 3 周 / 每 2 个月
    () => {
      const m = /每(?:隔)?(\d{1,2}|[一二两三四五六七八九十])(?:\s*个)?(天|周|月)/.exec(text);
      if (!m) return null;
      const n = cnOrDigit(m[1]!);
      if (!n || n < 1 || n > 99) return null;
      const freq =
        m[2] === '天' ? RepeatFreq.Daily : m[2] === '周' ? RepeatFreq.Weekly : RepeatFreq.Monthly;
      return { rule: { freq, interval: n }, m };
    },
    // 每月25号
    () => {
      const m = /每(?:个)?月(\d{1,2})[日号]/.exec(text);
      return m ? { rule: { freq: RepeatFreq.Monthly, interval: 1 }, m } : null;
    },
    // 每天 / 每日 / 每一天
    () => {
      const m = /每(?:一)?[天日]/.exec(text);
      return m ? { rule: { freq: RepeatFreq.Daily, interval: 1 }, m } : null;
    },
    // 每周（不带周几）
    () => {
      const m = /每(?:周|星期|礼拜)/.exec(text);
      return m ? { rule: { freq: RepeatFreq.Weekly, interval: 1 }, m } : null;
    },
    // 每月（不带日期）
    () => {
      const m = /每(?:个)?月/.exec(text);
      return m ? { rule: { freq: RepeatFreq.Monthly, interval: 1 }, m } : null;
    },
  ];

  for (const candidate of candidates) {
    const hit = candidate();
    if (hit) return make(hit.rule, hit.m[0], hit.m.index);
  }
  return null;
}

const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function cnOrDigit(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  return CN_NUM[s] ?? null;
}

/* ------------------------------------------------------------------ */
/* 提醒                                                                */
/* ------------------------------------------------------------------ */

interface ReminderHit {
  /** 写明的提前量（分钟，0 = 准点）；**null = 提了提醒但没说提前多久** */
  minutes: number | null;
  label: string;
  spans: Span[];
  raw: string;
}

/**
 * 提醒动词（连常见的衬字一起吃掉）。
 *
 * 衬字必须一起切：`记得提醒我` 只切「提醒」，剩下的「记得…我」会粘到标题上，
 * 而 `明天9点提醒我` 这种更极端 —— 时间和动词都切掉之后什么都不剩，标题成了空的。
 * 所以「记得 / 请 / 一下 / 我」这些跟着动词走。
 */
const REMINDER_VERB = /(?:记得|别忘了|别忘|请|要)?\s*(?:提醒|叫我|喊我|通知我|别让我忘)(?:一下|一声|我)?/;

/**
 * 认"这件事要不要提醒我"。
 *
 * **动词是入场券**：没有「提醒 / 叫我 / 喊我」这类词，光看到「提前半小时」一律不算 ——
 * "提前半小时出发"说的是行程，不是提醒，误判的代价是给用户排一条他没要的通知。
 * 有了入场券之后再看写明没写明提前多久：
 * - 「提前半小时提醒我」→ 30；「提前 1 小时提醒」→ 60；「提前两小时叫我」→ 120
 * - 「准点提醒我 / 到点喊我」→ 0
 * - 「记得提醒我」→ **没给量**（`minutes = null`），由调用方按这件事的类型给默认值
 *   （见 `domain/reminder.defaultReminderMinutes`）—— 这里**不猜**，猜了就没法按类型分
 *
 * 命中的片段会被切掉：它是指令，不是这件事的名字。
 * "通知我"要带着"我"才算 —— 通知类公文的标题里满是"关于…通知"，那是壳不是提醒。
 */
function extractReminder(text: string): ReminderHit | null {
  const verb = REMINDER_VERB.exec(text);
  if (!verb) return null;

  // 连"提前"都没说，就是那一刻响
  const onTime = /(?:准点|到点|按时|准时)\s*(?:提醒|叫我|喊我|通知我)(?:一下|一声|我)?/.exec(text);
  if (onTime) {
    return { minutes: 0, label: describeReminder(0), spans: [spanOf(onTime)], raw: onTime[0] };
  }

  const lead = /提前\s*(半|\d{1,3}|[一二两三四五六七八九十]{1,2})\s*个?\s*(小时|分钟|分)/.exec(text);
  if (lead) {
    const per = lead[2] === '小时' ? 60 : 1;
    // 「半」只有接"小时"才是 30 分钟；「提前半分」这种不当提醒处理
    const amount =
      lead[1] === '半' ? (per === 60 ? 30 : null) : (() => {
        const n = cnHour(lead[1]!);
        return n == null ? null : n * per;
      })();
    if (amount != null && amount > 0 && amount <= 1440 * 7) {
      return {
        minutes: amount,
        label: describeReminder(amount),
        // 提前量与动词相邻时两个区间会被 removeSpans 合成一段，切完不留碎字
        spans: [spanOf(lead), spanOf(verb)],
        raw: `${lead[0]}${verb[0]}`,
      };
    }
  }

  // 只说了"提醒"，没说提前多久
  return { minutes: null, label: '提醒', spans: [spanOf(verb)], raw: verb[0] };
}

/* ------------------------------------------------------------------ */
/* 地点                                                                */
/* ------------------------------------------------------------------ */

interface LocationHit {
  location: string;
  spans: Span[];
  raw: string;
}

/**
 * 「地点：另行通知」这类**写了等于没写**的值 —— 认了它，地点字段上就挂着一句
 * 废话，用户还得自己去删。宁可这行原样留在备注里，等他真知道地点时再填。
 * 「线上」不在此列：那是明确的地点。
 */
const EMPTY_PLACES = /^(待定|另行通知|未定|未知|不详|暂无|无|待通知|稍后通知)$/i;

/** 成对的引号壳（`"人民大会堂"` → `人民大会堂`） */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['「', '」'],
  ['『', '』'],
  ['【', '】'],
];

/**
 * 剥引号，但**只在首尾成对时剥**。
 *
 * 「地点："一站式"学生社区211」里的引号是原文对"一站式"的强调，不是包住整个地点的壳 ——
 * 见引号就剥会留下一个孤零零的闭引号（`一站式"学生社区211`），比不剥更难看。
 */
function stripQuotes(value: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    if (value.length > open.length + close.length && value.startsWith(open) && value.endsWith(close)) {
      return value.slice(open.length, value.length - close.length).trim();
    }
  }
  return value;
}

/**
 * 认地点。**只认写明标签的那种**：「地点：xxx」「活动地点：xxx」「地址：xxx」。
 *
 * 不认「在体育馆开会」这类 —— 中文里"在"字太常见（"在家工作"是地点还是状态？），
 * 认错地点比认不出糟得多：用户会按着错的地方出门。
 *
 * 值的边界收在"**不含句读、也不含下一个标签**"上，于是：
 * - 「地点：三教101，请提前到」只取到「三教101」，"请提前到"仍留在备注里；
 * - 「地点：教一101 时间：9点」在第二个冒号前停下。
 * 两条都不会把别的内容一口吞掉。
 */
function extractLocation(text: string): LocationHit | null {
  /*
   * `[ \t]*` 而不是 `\s*`：**空白绝不能跨行**。
   * 通知里「活动时间及地点：」这一行以标签+冒号结尾、值在下一行，
   * 用 `\s*` 的话它会吃掉换行，把下一行的「🕖时间」当成地点 —— 真数据上就是这么错的。
   * 冒号后紧跟换行 ⇒ 这一处没有值 ⇒ 正则自然不匹配，继续去找真正的那个「地点：」。
   *
   * 标签前也**不吃空格**：时间正则会把它后面的空格一起圈进自己的区间，
   * 地点若从那个空格起算，两段就"碰"上了，overlap 检查会把地点整个毙掉。
   *
   * 值里排除「请 / 注意 / 务必 / 记得 / 联系 / 届时 / 电话」：这些字几乎不会出现在
   * 地名里，而它们出现就意味着值后面接了另一句话（"地点：教一101 请提前到"）——
   * 在那儿停下，地点拿到手，那句话也仍然留在备注里。
   */
  const m =
    /(?:活动|会议|集合|上课|报到)?(?:地点|地址|场地|位置)[ \t]*[：:][ \t]*([^\n，。；！？,;!?：:请注意务必记得联系届时电话]{1,30})/.exec(
      text,
    );
  if (!m) return null;

  const value = stripQuotes(m[1]!.replace(/[\s，。；、]+$/, ''));
  if (!value || EMPTY_PLACES.test(value)) return null;

  // 整段（标签 + 值）一起切掉：地点已经进了字段，备注里再留一份只是重复
  return {
    location: value,
    spans: [{ start: m.index, end: m.index + m[0].length }],
    raw: m[0],
  };
}

/* ------------------------------------------------------------------ */
/* 时间                                                                */
/* ------------------------------------------------------------------ */

interface TimeHit {
  time: TaskTime;
  label: string;
  spans: Span[];
  raw: string;
}

function spanOf(m: RegExpExecArray): Span {
  return { start: m.index, end: m.index + m[0].length };
}

/** 两段在原文里是否交叠。用来让"地点"给"时间"让路（见 parseSchedule ④） */
function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function parseTime(text: string, now: Date): TimeHit | null {
  // ① 截止式："周五前交报告" / "明天下午3点前交" / "下个月10号前完成合同"
  const deadline = new RegExp(`${DATE_EXPR}\\s*(?:${TIME_EXPR}\\s*)?之?前`).exec(text);
  if (deadline) {
    const dateWord = deadline[1] ?? deadline[2] ?? deadline[3];
    const date = dateWord ? resolveDate(dateWord, now) : null;
    if (date) {
      const inner = new RegExp(TIME_EXPR).exec(deadline[0]);
      const hm = inner ? to24h(inner, 1) : null;
      const due = new Date(date);
      due.setHours(hm ? hm.hour : 23, hm ? hm.minute : 59, 0, 0);
      return {
        time: deadlineTime(due),
        label: `${dateLabel(date, now)}${hm ? ` ${clock(due)}` : ''}前`,
        spans: [spanOf(deadline)],
        raw: deadline[0],
      };
    }
  }

  // ② 相对时间："3小时后吃药" / "20分钟后" / "3天后交"（"两个小时后"的"两"也算）
  const rel = /(半|两|\d{1,2})\s*个?\s*小时后|(\d{1,3})\s*分钟后|(\d{1,2})\s*天后/.exec(text);
  if (rel) {
    const d = new Date(now.getTime());
    let label: string;
    if (rel[1]) {
      const hours = rel[1] === '两' ? 2 : Number(rel[1]);
      d.setMinutes(d.getMinutes() + (rel[1] === '半' ? 30 : hours * 60));
      label = rel[1] === '半' ? '半小时后' : `${hours} 小时后`;
    } else if (rel[2]) {
      d.setMinutes(d.getMinutes() + Number(rel[2]));
      label = `${rel[2]} 分钟后`;
    } else {
      d.setDate(d.getDate() + Number(rel[3]));
      label = `${rel[3]} 天后`;
    }
    return { time: fixedTime(d), label, spans: [spanOf(rel)], raw: rel[0] };
  }

  const dateMatch = new RegExp(DATE_EXPR).exec(text);
  const rangeMatch = execTime(new RegExp(`${TIME_EXPR}\\s*${RANGE_SEP}\\s*${TIME_EXPR}`), text);
  const timeMatch = rangeMatch ? null : execTime(new RegExp(TIME_EXPR), text);

  // ③ 日期 + 时刻 / 时段："明天下午3点开会" / "周三 14:00 复盘" / "明天2点到4点"
  if (dateMatch) {
    const date = resolveDate(pickGroup(dateMatch), now);
    if (date) {
      const daySpan = spanOf(dateMatch);

      if (rangeMatch) {
        const rawStart = to24h(rangeMatch, 1);
        const start = rawStart ? eveningShift(rawStart, pickGroup(dateMatch)) : null;
        const end = to24h(rangeMatch, RANGE_END_BASE);
        if (start && end) {
          const from = new Date(date);
          from.setHours(start.hour, start.minute, 0, 0);
          const to = new Date(date);
          const endMinutes = normalizeEnd(start, end);
          to.setHours(endMinutes.hour, endMinutes.minute, 0, 0);
          if (to.getTime() <= from.getTime()) to.setDate(to.getDate() + 1);
          return {
            time: {
              attribute: TimeAttribute.Fixed,
              startAt: from.toISOString(),
              endAt: to.toISOString(),
              dueAt: null,
            },
            label: `${dateLabel(date, now)} ${clock(from)}–${clock(to)}`,
            spans: [daySpan, spanOf(rangeMatch)],
            raw: `${dateMatch[0]}${rangeMatch[0]}`,
          };
        }
      }

      const rawHm = timeMatch ? to24h(timeMatch, 1) : null;
      const hm = rawHm ? eveningShift(rawHm, pickGroup(dateMatch)) : null;
      if (hm) {
        const d = new Date(date);
        d.setHours(hm.hour, hm.minute, 0, 0);
        return {
          time: fixedTime(d),
          label: `${dateLabel(date, now)} ${clock(d)}`,
          spans: [daySpan, ...(timeMatch ? [spanOf(timeMatch)] : [])],
          raw: `${dateMatch[0]}${timeMatch ? timeMatch[0] : ''}`,
        };
      }

      // 今晚 / 明晚 不带钟点 → 20:00
      if (/^(今晚|明晚)$/.test(pickGroup(dateMatch))) {
        const d = new Date(date);
        d.setHours(20, 0, 0, 0);
        return {
          time: fixedTime(d),
          label: `${dateLabel(date, now)} 20:00`,
          spans: [daySpan],
          raw: dateMatch[0],
        };
      }

      // 只有日期 → 截止到当天结束
      const due = new Date(date);
      due.setHours(23, 59, 0, 0);
      return {
        time: deadlineTime(due),
        label: `${dateLabel(date, now)} · 截止当天`,
        spans: [daySpan],
        raw: dateMatch[0],
      };
    }
  }

  // ④ 只有时段："下午2点到4点" → 今天/明天
  if (rangeMatch) {
    const start = to24h(rangeMatch, 1);
    const end = to24h(rangeMatch, RANGE_END_BASE);
    if (start && end) {
      const from = new Date(startOfDay(now));
      from.setHours(start.hour, start.minute, 0, 0);
      if (from.getTime() <= now.getTime()) from.setDate(from.getDate() + 1);
      const endMinutes = normalizeEnd(start, end);
      const to = new Date(from);
      to.setHours(endMinutes.hour, endMinutes.minute, 0, 0);
      if (to.getTime() <= from.getTime()) to.setDate(to.getDate() + 1);
      return {
        time: {
          attribute: TimeAttribute.Fixed,
          startAt: from.toISOString(),
          endAt: to.toISOString(),
          dueAt: null,
        },
        label: `${describeDay(from, now)} ${clock(from)}–${clock(to)}`,
        spans: [spanOf(rangeMatch)],
        raw: rangeMatch[0],
      };
    }
  }

  // ⑤ 只有时刻："晚上8点跑步" → 今天，过了就顺延到明天
  if (timeMatch) {
    const hm = to24h(timeMatch, 1);
    if (hm) {
      const d = new Date(startOfDay(now));
      d.setHours(hm.hour, hm.minute, 0, 0);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      return {
        time: fixedTime(d),
        label: `${describeDay(d, now)} ${clock(d)}`,
        spans: [spanOf(timeMatch)],
        raw: timeMatch[0],
      };
    }
  }

  return null;
}

/**
 * 把时间锚点挪到"离现在最近的某个 byWeekday 那天"，时刻保留。
 *
 * 只在重复已经写明周几时调用 —— 那是用户亲口说的日子，比日期规则从
 * 「每周一三五」里匹配到的第一个「周一」可靠得多。挪不动的（没有锚点、
 * 或者两周内都找不到）原样返回，不硬凑。
 */
function alignToWeekdays(time: TaskTime | null, days: number[], now: Date): TaskTime | null {
  if (!time) return null;
  // 锚点只有一处出处（domain/task.ts），这儿不自己判 startAt/dueAt
  const iso = timeAnchor(time);
  if (!iso) return time;
  const src = new Date(iso);
  if (Number.isNaN(src.getTime())) return time;

  for (let offset = 0; offset < 14; offset += 1) {
    const d = addDays(startOfDay(now), offset);
    if (!days.includes(d.getDay())) continue;
    d.setHours(src.getHours(), src.getMinutes(), 0, 0);
    if (d.getTime() <= now.getTime()) continue;
    const nextIso = d.toISOString();
    return time.attribute === TimeAttribute.Deadline
      ? { ...time, dueAt: nextIso }
      : { ...time, startAt: nextIso };
  }
  return time;
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                            */
/* ------------------------------------------------------------------ */

/** 中文数字小时：「五」→5、「十二」→12、「十」→10、「两」→2；纯数字原样 */
function cnHour(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  const map: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (s === '十') return 10;
  if (s.startsWith('十')) {
    const ones = map[s[1]!];
    return ones != null ? 10 + ones : null;
  }
  const tens = map[s[0]!];
  if (tens == null) return null;
  if (s[1] === '十') return tens * 10;
  const ones = map[s[1]!];
  return ones != null ? tens * 10 + ones : tens;
}

/**
 * 在原文上找时刻，但**跳过「周X点」这种假时刻**。
 *
 * 中文数字进了小时位之后，"周五点外卖"里的「五点」会被读成下午五点 ——
 * 以前只认阿拉伯数字时这个误读不存在，所以闸必须一起加。命中后看一眼前
 * 一个字：是 周/期/礼/拜 且命中的开头是中文数字，就当作没看见，从下一格重试。
 */
function execTime(re: RegExp, text: string): RegExpExecArray | null {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    // 注意 `includes('')` 恒为 true —— 开头命中的（prev 为空串）绝不能跳
    const prev = m.index > 0 ? text[m.index - 1] : '';
    if (prev && '周星期礼拜'.includes(prev) && /^[一二两三四五六七八九十]/.test(m[0])) continue;
    return m;
  }
  return null;
}

/** DATE_EXPR 有三个捕获分支，取真正命中的那个 */
function pickGroup(m: RegExpExecArray): string {
  for (let i = m.length - 1; i >= 1; i--) {
    if (m[i] !== undefined) return m[i]!;
  }
  return m[0];
}

/**
 * 被切掉的时间 / 提醒在原文里留下的记号。
 *
 * `\u0000` 是几乎不可能出现在用户文本里的控制字符。留着它不是为了显示，
 * 而是为了让下一步能分辨"**这一行的时间被抠走过**"——这是"这行是时间渣、
 * 别留在备注里"唯一的依据（见 `isTimeResidue`）。提醒片段也用它。
 */
const TIME_CUT = '\u0000';

/**
 * 把若干区间从文本里切掉，**有重叠就合并**。
 * 「每周五前交报告」里「每周五」与「周五前」重叠，分开切会剩一堆碎字，
 * 合并成一段再切才能得到干净的「交报告」。
 *
 * **保留换行**（这儿不做 `cleanTitle`）：下一步的 `pickTitle` 要靠"行"来挑标题 ——
 * 在这儿把换行压成空格，一整段通知就变成一大坨，再也不可能认出它真正的名字。
 */
function removeSpans(text: string, spans: Span[]): string {
  if (!spans.length) return text;
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  let out = '';
  let cursor = 0;
  for (const span of merged) {
    out += `${text.slice(cursor, span.start)}${TIME_CUT}`;
    cursor = span.end;
  }
  out += text.slice(cursor);
  return out;
}

/** 标题上限：收集箱一行放得下。超出的部分仍在备注里，不是丢掉 */
const TITLE_MAX = 40;

/**
 * 从"抠掉时间词之后剩下的正文"里挑出标题与备注。
 *
 * - **单行**（记一件事时的绝大多数输入）＝老行为：清洗 + 截断，备注为空。
 * - **多行**（用户把一整段通知粘进来）＝逐行挑。依据是一个很朴素的约定：
 *   **这段文字的第一行就是它的名字** —— 通知、公告、聊天里的长消息都这么写。
 *   挑之前先洗掉行首的 md 标记 / 序号 / 图标；"各位…你们好""活动时间及地点："
 *   这类明显不是名字的行跳过。剩下的一律进备注。
 *
 * 这里**不做语义理解**（那是能力层 `Understand` 的事）：一行都挑不出像样的，
 * 就退回"整段压平后截断" —— 宁可标题长一点，也不替用户编一个他没写的名字。
 */
function pickTitle(raw: string): { title: string; rest: string | null } {
  const lines = raw
    .split('\n')
    .map((line) => ({
      text: stripLineMarks(line.split(TIME_CUT).join(' ')),
      cut: line.includes(TIME_CUT),
    }))
    .filter((line) => line.text.trim().length > 0 && !isTimeResidue(line));

  const body = lines.map((l) => l.text).join('\n').trim() || raw.split(TIME_CUT).join(' ').trim();

  if (lines.length <= 1) {
    return { title: shorten(cleanTitle(body)), rest: null };
  }

  const at = lines.findIndex((line) => isTitleLike(line.text));
  const head = at >= 0 ? lines[at]!.text : cleanTitle(body);
  const rest = lines
    .filter((_, i) => i !== at)
    .map((l) => l.text)
    .join('\n')
    .trim();

  return { title: shorten(cleanTitle(head)), rest: rest || null };
}

/**
 * 这一行是不是"时间被抠走之后剩下的渣"。
 *
 * 时间已经提成日程的时间字段了，备注里再留一份「时间： （下周三） 晚」只有坏处。
 * 判据收得很紧，三个条件缺一不可：
 * ① **这一行真的被抠过时间** —— 不是所有以"时间："开头的行都算，
 *    「时间：另行通知」一个字都没被抠走，那是有用信息，不能删；
 * ② **这一行本来就是时间行的样子**（以"时间："这类标签开头）—— 少了它，
 *    「10月9日 上午9:00 田径场」被抠完只剩"田径场"，一个地名就这么没了；
 * ③ **抠完剩下的有效字不到十个** —— 剩得多说明这行还有别的内容。
 */
function isTimeResidue({ text, cut }: { text: string; cut: boolean }): boolean {
  if (!cut) return false;
  if (!/^(活动|会议|开始|集合)?时间\s*[：:]/.test(text)) return false;
  return text.replace(/[^\p{Script=Han}\d]/gu, '').length < 10;
}

/**
 * 洗掉行首的装饰与行首行尾的标点 —— **只用来挑标题**，备注里的原文照旧。
 *
 * 顺序有讲究：`1️⃣` 是"1 + 变体选择符 + 键帽"三个码点，不先整块去掉，
 * 后面那条"数字序号"规则接不住它，会剩一个光秃秃的"1"贴在标题前面。
 */
function stripLineMarks(line: string): string {
  return line
    .replace(/\d?\uFE0F?\u20E3/g, '') // 1️⃣ 这类键帽整块去
    .replace(/\uFE0F/g, '')
    .replace(/^[\s>*#\-–—•·]+/, '') // markdown 标记
    .replace(/^[（(]?\d{1,2}[）).、]\s*/, '') // 1. / 1、 / (1)
    .replace(/^[一二三四五六七八九十]{1,2}[、.）)]\s*/, '') // 一、
    .replace(/^[\p{Extended_Pictographic}\s]+/u, '') // 图标
    .replace(/^[\s，。、,.；;：:]+|[\s，。、,.；;：:！!？?]+$/g, '')
    .trim();
}

/**
 * 这一行像不像"这段文字的名字"。三条否决都很便宜，而且**只在多行文本里生效**：
 * 太短（序号碎片、"时间"两个字）、寒暄（称呼开场）、以冒号结尾（分节小标题，
 * 比如"活动时间及地点："——它是小标题，不是这件事的名字）、以地点标签开头。
 *
 * 最后那条是给**没认出来的地点行**兜底的：「地点：另行通知」不会被 extractLocation
 * 认走（那是空信息，得留在备注里），但它显然也不是这件事的名字。
 */
function isTitleLike(line: string): boolean {
  const s = line.trim();
  if (s.length < 3) return false;
  if (/^(各位|尊敬的|亲爱的|大家好|你们好)/.test(s)) return false;
  if (/[：:]$/.test(s)) return false;
  if (/^(?:活动|会议|集合|上课|报到)?\s*(?:地点|地址|场地|位置)\s*[：:]/.test(s)) return false;
  return true;
}

/**
 * 收尾：剥掉公文的壳，再超长截断。
 *
 * "关于 X 的通知"里，**"关于…通知"是壳不是名字** —— 而通知类文本的第一行几乎
 * 全是这个格式，所以这条窄规则（必须"关于"开头**且**通知/公告/安排结尾同时成立）
 * 命中率很高、误伤面很小。剥完不足两个字就认输，原样留着。
 */
function shorten(title: string): string {
  let t = title;
  if (/^关于.{2,}/.test(t) && /(通知|公告|安排|方案)$/.test(t)) {
    const inner = t.replace(/^关于\s*/, '').replace(/的?(通知|公告|安排|方案)$/, '');
    if (inner.length >= 2) t = inner;
  }
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t;
}

function cleanTitle(text: string): string {
  return text
    .replace(/^这个\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s，。、,.；;：:的于在]+|[\s，。、,.；;：:的]+$/g, '')
    .trim();
}

/** 把中文日期词换算成具体某一天（当天 0 点） */
function resolveDate(word: string, now: Date): Date | null {
  const day0 = startOfDay(now);

  switch (word) {
    case '今天':
    case '今日':
    case '今晚':
      return day0;
    case '明天':
    case '明日':
    case '明晚':
      return addDays(day0, 1);
    case '后天':
      return addDays(day0, 2);
    case '大后天':
      return addDays(day0, 3);
  }

  // 周末 → 本周六（已经过了这周六就顺延到下周）
  if (/^(?:这|本)?周末$/.test(word)) {
    const monday = startOfWeek(day0, { weekStartsOn: 1 });
    const sat = addDays(monday, 5);
    return sat.getTime() < day0.getTime() ? addDays(sat, 7) : sat;
  }

  // 下周三 / 下下周五 / 周三 / 星期日 / 本周三
  const wd = word.match(/^(下下?|本|这)?(?:周|星期|礼拜)([一二三四五六日天])$/);
  if (wd) {
    const target = WEEKDAY_OF[wd[2]!]!;
    const monday = startOfWeek(day0, { weekStartsOn: 1 });
    const indexFromMonday = (target + 6) % 7;
    if (wd[1] === '下') return addDays(monday, 7 + indexFromMonday);
    if (wd[1] === '下下') return addDays(monday, 14 + indexFromMonday);
    // "周X" = 最近的一个（含今天，过了就算下周）
    let candidate = addDays(monday, indexFromMonday);
    if (candidate.getTime() < day0.getTime()) candidate = addDays(candidate, 7);
    return candidate;
  }

  // 下个月10号 / 本月25号
  const relativeMonth = word.match(/^(下下?|本)个?月(\d{1,2})[日号]$/);
  if (relativeMonth) {
    const offset = relativeMonth[1] === '下' ? 1 : relativeMonth[1] === '下下' ? 2 : 0;
    const base = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), offset);
    const day = Number(relativeMonth[2]);
    if (day < 1 || day > daysInMonth(base)) return null;
    return startOfDay(new Date(base.getFullYear(), base.getMonth(), day));
  }

  // 10月8日 / 8号 / 8日
  const md = word.match(/^(\d{1,2})月(\d{1,2})[日号]$/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month < 1 || month > 12) return null;
    let d = new Date(now.getFullYear(), month - 1, day);
    if (d.getMonth() !== month - 1) return null; // 2月30日 这种不存在的日期
    if (d.getTime() < day0.getTime()) d = new Date(now.getFullYear() + 1, month - 1, day);
    return startOfDay(d);
  }
  const dOnly = word.match(/^(\d{1,2})[日号]$/);
  if (dOnly) {
    const day = Number(dOnly[1]);
    if (day < 1 || day > daysInMonth(now)) return null;
    let d = new Date(now.getFullYear(), now.getMonth(), day);
    if (d.getTime() < day0.getTime()) d = addMonths(d, 1);
    return startOfDay(d);
  }

  return null;
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * 时段的结束时刻。
 * 「下午2点到4点」里第二段没带时段词，直接读会得到 4:00 —— 比开始还早。
 * 差在 12 小时以内时补一个下午，跨天（比如「晚上10点到凌晨2点」）不补。
 */
function normalizeEnd(
  start: { hour: number; minute: number },
  end: { hour: number; minute: number },
): { hour: number; minute: number } {
  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;
  if (endMin > startMin) return end;
  if (endMin + 12 * 60 > startMin) return { hour: end.hour + 12, minute: end.minute };
  return end;
}

/**
 * 把时刻正则的某一组解析成 24 小时制。
 *
 * `base` = 该 TIME_EXPR 的**整体**捕获组下标（单独用时 1；时段里第二段是 8）。
 *
 * TIME_EXPR 有 **7** 个捕获组，不是 6 个 —— 分那一段是 `(半|(\d{1,2})分?)`，
 * 里面还嵌着一个数字组。按 6 个数会把"冒点时"读到"分的数字"上，
 * 结果是 `14:30` 这种写法**永远解析不出来**（老代码就是这么错的，且没人发现，
 * 因为"明天 14:30 复盘"会安静地退化成"明天截止"）。
 *   整体 / 时段词 / 小时 / 分或半 / 分的数字 / 冒点时 / 冒点分
 */
function to24h(m: RegExpExecArray, base: number): { hour: number; minute: number } | null {
  const colonHour = m[base + 5];
  const colonMinute = m[base + 6];
  if (colonHour !== undefined && colonMinute !== undefined) {
    const hour = Number(colonHour);
    const minute = Number(colonMinute);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }
  const hourRaw = cnHour(m[base + 2] ?? '');
  if (hourRaw == null || hourRaw > 24) return null;
  const minutePart = m[base + 3];
  const minute = minutePart === '半' ? 30 : minutePart ? Number(minutePart) : 0;
  if (minute > 59) return null;
  const period = m[base + 1]?.trim();
  let hour = hourRaw;
  if (period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里') {
    if (hour < 12) hour += 12;
  } else if (period === '中午') {
    if (hour < 6) hour += 12;
  }
  if (hour > 23) hour -= 24; // "晚上12点" 视作 0 点
  return { hour, minute };
}

/**
 * 「今晚 / 明晚」自己就带着"晚上"这层意思 —— 所以「今晚8点」是 20:00，不是早上 8 点。
 *
 * 这层意思来自**日期词**而不是时刻词，所以 to24h 看不见它（「8点」单独看没有歧义，
 * 就是这个歧义让「今晚8点提醒吃药」被排到了当天早上）。
 * 只在 1–11 点补半天：12 点以上本来就是晚上，硬补会翻到第二天去。
 */
function eveningShift(
  hm: { hour: number; minute: number },
  dateWord: string | undefined,
): { hour: number; minute: number } {
  if (!dateWord || !/^(今晚|明晚)$/.test(dateWord)) return hm;
  if (hm.hour >= 1 && hm.hour < 12) return { hour: hm.hour + 12, minute: hm.minute };
  return hm;
}

function fixedTime(d: Date): TaskTime {
  return { attribute: TimeAttribute.Fixed, startAt: d.toISOString(), endAt: null, dueAt: null };
}

function deadlineTime(d: Date): TaskTime {
  return { attribute: TimeAttribute.Deadline, startAt: null, endAt: null, dueAt: d.toISOString() };
}

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const;

function dateLabel(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 864e5);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAY_ZH[d.getDay()]}`;
}

function describeDay(d: Date, now: Date): string {
  return startOfDay(d).getTime() === startOfDay(now).getTime() ? '今天' : '明天';
}

function clock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

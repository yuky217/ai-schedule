/**
 * 在 App 内嵌浏览器里"抓当前这一页的课表"。
 *
 * 为什么走这条路（成熟课表软件都是这么做的）：教务系统的课表在**文字**里是不完整的
 * —— 7 天是 7 列，复制成文本之后"每一格属于哪一列"就没了（空白格什么都不剩，
 * 连空位都不留）。所以从粘贴的文本里推不出星期，只能让用户一条条点。
 * 而在**页面里**这个信息一直在：每个格子都有自己的位置。
 *
 * 于是：把页面上的课表格子按**屏幕位置**对齐到星期表头上 —— 教务系统的版式
 * 五花八门（有的是真表格，有的是 div 绝对定位拼出来的），但"星期一那一列的横坐标"
 * 和"这一格的中心横坐标"这两种版式**都有**（真表格的 td 也有 box），
 * 按横坐标归位比认 HTML 结构稳得多。节次不用位置推：每个格子自己就写着
 * "(1-2节)1-16周"。
 *
 * 产出仍然是一段**文本**（制表符分隔、一格一行），交给 `domain/course-text.ts`
 * 那条路解析 —— 这样"抓回来的"和"粘进来的"共用同一套预览、核对、落库逻辑，
 * 不会出现两套导入。
 *
 * 一格里的多行用 U+2028 连接（`course-text.ts` 里的 INNER_BREAK）：
 * 换成换行的话整张表会散成一堆单格行、列就全错位了。
 */

/** 抓取结果：`text` 是可直接交给解析器的表格文本 */
export interface ScrapePayload {
  ok: boolean;
  /** 失败原因（给用户看的一句话） */
  reason?: string;
  text?: string;
  /** 抓到几段课 */
  count?: number;
  /** 有几格没能归到某一天（宁可漏也不乱放） */
  skipped?: number;
  url?: string;
  title?: string;
}

/**
 * 在页面里执行的函数。**必须自包含** —— 它会被 `toString()` 之后注入网页，
 * 引用不到这个模块里的任何东西：只用最朴素的写法，不碰外部变量。
 * （类型标注在打包时就被剥掉了，网页拿到的是纯 JS。）
 */
export function scrapeTimetableInPage(): string {
  var INNER = '\u2028';
  var WEEKDAY = /^(?:星期|周|礼拜)\s*[一二三四五六日天]$/;
  var PERIOD = /\d{1,2}\s*(?:[-~\u2013\u2014\uff0d\u81f3]\s*\d{1,2}\s*)?\s*节/;
  var WEEKS = /\d{1,2}\s*周/;
  var DAY_LABEL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function reply(payload: ScrapePayload): string {
    var json = JSON.stringify(payload);
    try {
      var bridge = (window as unknown as {
        ReactNativeWebView?: { postMessage: (data: string) => void };
      }).ReactNativeWebView;
      if (bridge && bridge.postMessage) bridge.postMessage(json);
    } catch (error) {
      /* 不在 App 里跑就算了，返回值照样给出去 */
    }
    return json;
  }

  /** 一格内容 → 去掉空行、压掉多余空格的"多行文本"（行间用 U+2028） */
  function cleanText(el: Element): string {
    var raw = '';
    try {
      raw = (el as HTMLElement).innerText != null ? (el as HTMLElement).innerText : el.textContent || '';
    } catch (error) {
      raw = el.textContent || '';
    }
    var parts = String(raw == null ? '' : raw).replace(/\r/g, '\n').split('\n');
    var out: string[] = [];
    for (var i = 0; i < parts.length; i += 1) {
      var line = parts[i]!
        .replace(/\t/g, ' ')
        .replace(/[\u00a0\u3000]/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .trim();
      if (line) out.push(line);
    }
    return out.join(INNER);
  }

  /**
   * '星期一' / '周三' / '礼拜天' → 0-6（**0 = 周日**，和 App 里的口径一致）；
   * 整格不只有星期就返回 null。
   */
  function weekdayOf(text: string): number | null {
    var flat = text.replace(/\s/g, '');
    if (!WEEKDAY.test(flat)) return null;
    var token = flat.charAt(flat.length - 1);
    if (token === '天') return 0;
    var index = '日一二三四五六'.indexOf(token);
    return index < 0 ? null : index;
  }

  /**
   * 只留"最里层"的那些元素。
   * 课表的格子外面还套着好几层 div/table，全算上的话同一格会被数很多次；
   * 而最里层那个正是写着课名/节次/周次的那一格。
   *
   * **必须倒着走**：`querySelectorAll` 给的顺序是"先父后子"，正着走会先收下
   * 外层容器、再往里收一层，同一个格子被数两次（真数据上就是"多出一门
   * 一模一样的课"）。倒着走（先子孙）才能一边收一边把祖先标掉。
   */
  function innermost(elements: Element[], flag: string): Element[] {
    var out: Element[] = [];
    for (var i = elements.length - 1; i >= 0; i -= 1) {
      var el = elements[i]! as unknown as Element & Record<string, unknown>;
      if (el[flag]) continue;
      out.push(el);
      var up: Node | null = el.parentNode;
      while (up && up !== document.body && !(up as unknown as Record<string, unknown>)[flag]) {
        (up as unknown as Record<string, unknown>)[flag] = true;
        up = up.parentNode;
      }
    }
    return out;
  }

  /** 页面本身 + 所有同源 iframe（教务系统很爱用框架，课表常常不在最外层文档里） */
  var roots: { doc: Document; dx: number; dy: number }[] = [{ doc: document, dx: 0, dy: 0 }];
  var frames = document.querySelectorAll('iframe');
  for (var f = 0; f < frames.length; f += 1) {
    var innerDoc: Document | null = null;
    try {
      innerDoc = (frames[f] as HTMLIFrameElement).contentDocument;
    } catch (error) {
      innerDoc = null; // 跨域拿不到，跳过
    }
    if (!innerDoc) continue;
    var frameBox = frames[f]!.getBoundingClientRect();
    roots.push({ doc: innerDoc, dx: frameBox.left, dy: frameBox.top });
  }

  var anchorEls: Element[] = [];
  /** 严格的课程格：自己写着节次 + 周次 */
  var strictEls: Element[] = [];
  /** 宽一档的候选：只写着周次（有的学校把节次只放在左边行标上） */
  var looseEls: Element[] = [];
  var labelEls: { n: number; x: number; y: number }[] = [];

  for (var r = 0; r < roots.length; r += 1) {
    var root = roots[r]!;
    var nodes = root.doc.querySelectorAll('div,td,th,li,span,p,a,section,article');
    var anchorHits: Element[] = [];
    var strictHits: Element[] = [];
    var looseHits: Element[] = [];
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i]!;
      var text = node.textContent || '';
      if (!text || text.length > 4000) continue;
      var flat = text.replace(/\s/g, '');
      if (WEEKDAY.test(flat)) {
        anchorHits.push(node);
        continue;
      }
      if (flat.length <= 2 && /^\d{1,2}$/.test(flat)) {
        // 左列"第几节"的行标：给那些自己没写节次的格子兜底（后面再按横坐标筛）
        var labelBox = node.getBoundingClientRect();
        labelEls.push({ n: Number(flat), x: labelBox.left + root.dx, y: labelBox.top + root.dy });
        continue;
      }
      // 一格的判据：自己写着节次、也写着周次 —— 说明它是"某门课的某一段"
      if (PERIOD.test(flat) && WEEKS.test(flat)) strictHits.push(node);
      else if (WEEKS.test(flat)) looseHits.push(node);
    }
    // 元素上记下它在哪个文档里，算位置时统一换算到同一套屏幕坐标
    var keptAnchors = innermost(anchorHits, '__wbAnchor');
    var keptStrict = innermost(strictHits, '__wbBlock');
    var keptLoose = innermost(looseHits, '__wbLoose');
    var kept = [keptAnchors, keptStrict, keptLoose];
    for (var g = 0; g < kept.length; g += 1) {
      var group = kept[g]!;
      for (var k = 0; k < group.length; k += 1) {
        (group[k] as unknown as Record<string, unknown>)['__wbDx'] = root.dx;
        (group[k] as unknown as Record<string, unknown>)['__wbDy'] = root.dy;
      }
    }
    anchorEls = anchorEls.concat(keptAnchors);
    strictEls = strictEls.concat(keptStrict);
    looseEls = looseEls.concat(keptLoose);
  }

  /** 表头：每个"星期X"所在元素的中心横坐标，按横坐标排好 */
  var days: { day: number; x: number }[] = [];
  for (var i2 = 0; i2 < anchorEls.length; i2 += 1) {
    var anchor = anchorEls[i2]! as unknown as Element & Record<string, unknown>;
    var rect = anchor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    var day = weekdayOf(anchor.textContent || '');
    if (day == null) continue;
    var x = rect.left + (Number(anchor['__wbDx']) || 0) + rect.width / 2;
    var seen = false;
    for (var d2 = 0; d2 < days.length; d2 += 1) if (days[d2]!.day === day) seen = true;
    if (!seen) days.push({ day: day, x: x });
  }
  days.sort(function (left, right) {
    return left.x - right.x;
  });

  if (days.length < 3) {
    return reply({
      ok: false,
      reason:
        '这一页上没找到课表（页面上没有"星期一…星期日"那一行）。先把课表查询页打开、能看见课表了再点抓取。',
      url: location.href,
      title: document.title,
    });
  }

  /** 左边的"第几节"行标：只认在课表左边的那些 */
  var leftEdge = days[0]!.x;
  var rowLabels: { n: number; y: number }[] = [];
  for (var i3 = 0; i3 < labelEls.length; i3 += 1) {
    if (labelEls[i3]!.x < leftEdge) rowLabels.push({ n: labelEls[i3]!.n, y: labelEls[i3]!.y });
  }

  /** 谁离得近就归谁 —— 课表格子一定是竖着对齐在某一列上的 */
  function nearestDay(x: number): number | null {
    var best: number | null = null;
    var bestGap = 0;
    for (var d = 0; d < days.length; d += 1) {
      var gap = Math.abs(days[d]!.x - x);
      if (best == null || gap < bestGap) {
        best = days[d]!.day;
        bestGap = gap;
      }
    }
    return best;
  }

  /** 格子自己没写节次时，按纵坐标**就近**找左侧行标 */
  function periodFromLabel(y: number): string {
    var best: number | null = null;
    var bestGap = 0;
    for (var i = 0; i < rowLabels.length; i += 1) {
      var gap = Math.abs(rowLabels[i]!.y - y);
      if (best == null || gap < bestGap) {
        best = rowLabels[i]!.n;
        bestGap = gap;
      }
    }
    return best == null ? '' : '第' + best + '节';
  }

  /**
   * 把候选元素落成"哪一天、哪一节"。
   *
   * `maxWidth` = 0 是**严格那一遍**（元素自己写着节次，错不了）；
   * 给一个宽度上限是**宽那一遍**，只靠"写着周次"当线索，得再筛一下像不像一格：
   * 一格大约就一列宽、而且至少两行字 —— 否则"其他课程"表里"1-12周"
   * 那种单行小格会被当成课程塞进星期一。
   */
  function blocksToRows(
    elements: Element[],
    maxWidth: number,
  ): { rows: { day: number; period: string; text: string }[]; skipped: number } {
    var rows: { day: number; period: string; text: string }[] = [];
    var missed = 0;
    for (var b2 = 0; b2 < elements.length; b2 += 1) {
      var block = elements[b2]! as unknown as Element & Record<string, unknown>;
      var box = block.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
      if (maxWidth && (box.width > maxWidth || box.height > 400)) continue;
      var cellText = cleanText(block);
      if (!cellText) continue;
      if (maxWidth && cellText.split(INNER).length < 2) continue;
      var plain = cellText.split(INNER).join(' ');
      var matched = PERIOD.exec(plain);
      var period = matched
        ? matched[0].replace(/\s/g, '')
        : periodFromLabel(box.top + (Number(block['__wbDy']) || 0));
      var center = box.left + (Number(block['__wbDx']) || 0) + box.width / 2;
      var owner = nearestDay(center);
      if (owner == null) {
        missed += 1;
        continue;
      }
      rows.push({ day: owner, period: period, text: cellText });
    }
    return { rows: rows, skipped: missed };
  }

  /** 相邻两列的间距（宽那一遍用它当"一格有多宽"的尺子） */
  var columnGap =
    days.length > 1 ? (days[days.length - 1]!.x - days[0]!.x) / (days.length - 1) : 120;
  var strictPass = blocksToRows(strictEls, 0);
  var chosen = strictPass.rows.length ? strictPass : blocksToRows(looseEls, columnGap * 1.6);
  var found = chosen.rows;
  var skipped = chosen.skipped;

  if (!found.length) {
    return reply({
      ok: false,
      reason:
        '找到了星期表头，但没读到课程格。确认课表已经完整显示出来了（不是还在加载，也没有被弹窗挡着）。',
      url: location.href,
      title: document.title,
    });
  }

  /**
   * 课表页上还常挂着一张"其他课程"的表（实践、网课那种**本来就没排时间**的课，
   * 教务系统把它们单列在课表下面）。原样搬过来 —— 解析器会把这些课建成
   * "没有上课时间"的课，而不是让它们凭空消失。
   */
  function otherCourses(): string[] {
    var out: string[] = [];
    var tables = document.querySelectorAll('table');
    for (var t = 0; t < tables.length; t += 1) {
      var rowsOf = tables[t]!.rows;
      var head = '';
      for (var hr = 0; hr < rowsOf.length; hr += 1) {
        head += (rowsOf[hr]!.textContent || '').replace(/\s/g, '');
      }
      if (head.indexOf('课程名称') < 0 && head.indexOf('课程名') < 0) continue;
      if (head.indexOf('星期') >= 0) continue; // 这是课表本身，不是"其他课程"
      for (var tr = 0; tr < rowsOf.length; tr += 1) {
        var cells = rowsOf[tr]!.cells;
        var line: string[] = [];
        for (var tc = 0; tc < cells.length; tc += 1) line.push(cleanText(cells[tc]!));
        var joined = line.join('\t').replace(/\t+$/, '');
        if (joined.replace(/\t/g, '').trim()) out.push(joined);
      }
      break;
    }
    return out;
  }

  var header: string[] = ['时间段', '节次'];
  for (var h = 0; h < days.length; h += 1) header.push(DAY_LABEL[days[h]!.day]!);
  var lines: string[] = [header.join('\t')];
  for (var r2 = 0; r2 < found.length; r2 += 1) {
    var row = found[r2]!;
    var cells2: string[] = ['', row.period];
    for (var c = 0; c < days.length; c += 1) cells2.push('');
    for (var c2 = 0; c2 < days.length; c2 += 1) {
      if (days[c2]!.day === row.day) cells2[2 + c2] = row.text;
    }
    lines.push(cells2.join('\t'));
  }
  var extra = otherCourses();
  for (var e = 0; e < extra.length; e += 1) lines.push(extra[e]!);

  return reply({
    ok: true,
    text: lines.join('\n'),
    count: found.length,
    skipped: skipped,
    url: location.href,
    title: document.title,
  });
}

/** 注入网页的那段脚本：把上面的函数原样丢进去执行 */
export const SCRAPE_SCRIPT = `(${scrapeTimetableInPage.toString()})();true;`;

/**
 * 抓到的文本先放这儿，由导入页取走。
 *
 * 不用导航参数传：那是一整张课表（可能几万字），塞进 URL 既难看又容易出事。
 * 也不让抓取页自己写库 —— 导入只留一条路（导入页），两套落库逻辑迟早跑偏。
 */
let scraped = '';

export function setScrapedText(text: string): void {
  scraped = text;
}

/** 取走并清空 —— 用过的文本不该留在内存里影响下一次导入 */
export function takeScrapedText(): string {
  const text = scraped;
  scraped = '';
  return text;
}

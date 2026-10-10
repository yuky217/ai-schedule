import { formatDayTime, formatMonthDay, parseDayKey } from '@/utils/datetime';

import type { Container, Mark } from './container';
import { CONTAINER_KIND_LABEL } from './container-stats';
import type { Course } from './course';
import type { Idea } from './idea';
import { isAllDay, taskAnchor, type Task } from './task';

/**
 * 全库搜索的口径（2026-10-10）。
 *
 * 五份数据本来就都在内存里（`app-store` 的 tasks / containers / courses /
 * marks / ideas），所以这里是**纯前端的子串过滤**：不查库、不新建查询、不建索引。
 * 个人数据这个量级（几千条以内）`includes` 扫一遍就够，换来的是"能一条条测"
 * 和"没有第二套数据源"。
 *
 * ⚠️ 它**不是语义检索**：一条命中的意思就是"这几个字确实出现在它里面"。
 * 界面不要把话说成"懂你的意思"—— 想法页那句"打开语义检索就能用一句话捞出来"
 * 就是这么变成空头支票的（设置里开着开关，代码里仍是 `includes`）。
 *
 * 匹配哪些字段、怎么排序、空组怎么办，全在这里定死 —— 免得页面各写一遍、
 * 各漏一个字段（"我明明记得备注里有这句，搜不出来"就是这么来的）。
 */

export type SearchGroupKey = 'task' | 'container' | 'course' | 'mark' | 'idea';

export interface SearchHit {
  id: string;
  /** 行上的主文字 */
  title: string;
  /** 副文字：说清"这是哪一个"（课的老师 / 任务的时间 / 纪念日的日期 …） */
  subtitle?: string;
  /** 组内排序用：最近动过的排前面 */
  updatedAt: string;
}

export interface SearchGroup {
  key: SearchGroupKey;
  title: string;
  hits: SearchHit[];
}

export interface SearchSources {
  tasks?: readonly Task[];
  containers?: readonly Container[];
  courses?: readonly Course[];
  marks?: readonly Mark[];
  ideas?: readonly Idea[];
}

/** 组的固定顺序：越靠前越可能是"你要找的那件事" */
const GROUP_TITLES: ReadonlyArray<{ key: SearchGroupKey; title: string }> = [
  { key: 'task', title: '任务' },
  { key: 'container', title: '项目' },
  { key: 'course', title: '课程' },
  { key: 'mark', title: '纪念日' },
  { key: 'idea', title: '想法' },
];

/** 这几个字有没有出现在这条记录的任一字段里（大小写不敏感） */
function matches(fields: ReadonlyArray<string | null | undefined>, keyword: string): boolean {
  return fields.some((field) => Boolean(field) && field!.toLowerCase().includes(keyword));
}

/**
 * 组内按"最近动过"倒序。
 *
 * **不补 id 做次关键字**：`sort` 是稳定的，返回 0 就保留传入顺序 ——
 * 而传入顺序在这里有意义（仓库列出来的就是它自己的顺序）。
 */
function byUpdatedAt(hits: SearchHit[]): SearchHit[] {
  return [...hits].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 任务那行的小字：全天不说"00:00"，没定时间就直说 */
function taskSubtitle(task: Task): string {
  if (isAllDay(task.time)) return '全天';
  const anchor = taskAnchor(task);
  if (!anchor) return '还没定时间';
  return formatDayTime(anchor);
}

export function searchAll(query: string, sources: SearchSources): SearchGroup[] {
  const keyword = query.trim().toLowerCase();
  // 空关键词返回空：搜索页刚打开时不该把整个库铺出来当"结果"
  if (!keyword) return [];

  const hitsByGroup: Record<SearchGroupKey, SearchHit[]> = {
    task: [],
    container: [],
    course: [],
    mark: [],
    idea: [],
  };

  for (const task of sources.tasks ?? []) {
    // 备注、地点、标签也搜：用户记得的常常是"在哪儿做的"或当时写下的那句话
    if (!matches([task.title, task.note, task.location, ...task.tags], keyword)) continue;
    hitsByGroup.task.push({
      id: task.id,
      title: task.title,
      subtitle: taskSubtitle(task),
      updatedAt: task.updatedAt,
    });
  }

  for (const container of sources.containers ?? []) {
    if (!matches([container.title, container.note], keyword)) continue;
    hitsByGroup.container.push({
      id: container.id,
      title: container.title,
      subtitle: CONTAINER_KIND_LABEL[container.kind],
      updatedAt: container.updatedAt,
    });
  }

  for (const course of sources.courses ?? []) {
    if (!matches([course.title, course.teacher, course.location, course.note], keyword)) continue;
    const where = [course.teacher, course.location].filter(Boolean).join(' · ');
    hitsByGroup.course.push({
      id: course.id,
      title: course.title,
      subtitle: where || undefined,
      updatedAt: course.updatedAt,
    });
  }

  for (const mark of sources.marks ?? []) {
    if (!matches([mark.title], keyword)) continue;
    // date 是 YYYY-MM-DD，走 parseDayKey 按本地时区解析 —— 直接 new Date 会偏一天
    const day = parseDayKey(mark.date);
    hitsByGroup.mark.push({
      id: mark.id,
      title: mark.title,
      subtitle: day ? formatMonthDay(day) : undefined,
      updatedAt: mark.updatedAt,
    });
  }

  for (const idea of sources.ideas ?? []) {
    if (!matches([idea.content, ...idea.tags], keyword)) continue;
    hitsByGroup.idea.push({
      id: idea.id,
      title: idea.content,
      updatedAt: idea.updatedAt,
    });
  }

  // 空组不显示：一个空标题只会让人以为"这里本该有东西，是不是没加载出来"
  return GROUP_TITLES.map(({ key, title }) => ({
    key,
    title,
    hits: byUpdatedAt(hitsByGroup[key]),
  })).filter((group) => group.hits.length > 0);
}

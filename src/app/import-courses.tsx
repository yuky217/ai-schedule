import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { MonthPicker } from '@/components/month-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { WeekdayRow } from '@/components/weekday-row';
import { courseColor } from '@/constants/course-colors';
import { Spacing } from '@/constants/theme';
import {
  describeSession,
  describeWeeks,
  guessTermLabel,
  guessTermStart,
  maxSessionPeriod,
  mondayOfWeek,
  type CourseSession,
} from '@/domain/course';
import { parseCourseText, type CourseDraft } from '@/domain/course-text';
import { takeScrapedText } from '@/entry/scrape-timetable';
import { colorIndexOf, createCourse } from '@/domain/factory';
import { DEFAULT_PERIODS, MAX_PERIODS, resizePeriods } from '@/domain/timetable';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { toDayKey } from '@/utils/datetime';

/**
 * 导入课表。
 *
 * 为什么把"学期设置"也放在这一页：开学日是课表的**必要输入**（没有它就算不出
 * 第几周），把它拆成另一个页面意味着用户要来回跳两次才看得到第一张课表。
 * 而且这里三个字段的默认值**已经是对的**（学期名按当前日期推、开学日默认本周一、
 * 18 周）—— 直接粘文本点导入就行，一个字都不用填。
 *
 * 导入策略：**替换**。按钮上写清楚会替换掉几门课，用户点之前就知道结果，
 * 所以不再加二次确认弹窗（多一次点击换不来更多安全感）。
 */

/**
 * "怎么拿到课表文本"——按"从省事到麻烦"排，第一条不行就看下一条。
 *
 * 为什么要明写这三条：课表文本在手机上**不是随手可得**的东西。教务系统本来
 * 就是给电脑做的，手机浏览器打开常常排版错乱、甚至根本选不中文字。
 * 早先这里写的是"在课表页 Ctrl+A 全选"——那是桌面上的动作，手机上不存在，
 * 写出来等于没写。
 */
const TEXT_TIPS = [
  '在课表页长按文字 → 点「全选」→ 点「拷贝」；回到这里，长按下面的输入框点「粘贴」',
  '选不中的话：先给课表截图，再到相册里打开那张图，长按上面的文字就能选中复制（iPhone 自带这个本事，多数安卓也有）',
  '还是不行就借一下电脑：在电脑上打开教务系统复制课表，用微信发给自己，再回到手机粘贴',
];

export default function ImportCoursesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const dark = useColorScheme() === 'dark';

  const term = useAppStore((state) => state.term);
  const courses = useAppStore((state) => state.courses);
  const importCourses = useAppStore((state) => state.importCourses);
  const saveTerm = useAppStore((state) => state.saveTerm);

  const [label, setLabel] = useState(() => term?.label ?? guessTermLabel());
  const [startDayKey, setStartDayKey] = useState(
    () =>
      term?.startDayKey ??
      // 按学期名推第一周的周一。推不出来才退回"本周一" —— 那个默认值
      // 在学期中途是错的（10 月打开就变成 10 月的周一，整张课表周次全偏，
      // 而且看起来还挺正常），所以只当最后的兜底。
      guessTermStart(term?.label ?? guessTermLabel()) ??
      toDayKey(mondayOfWeek(new Date())),
  );
  const [totalWeeksText, setTotalWeeksText] = useState(() => String(term?.totalWeeks ?? 18));
  const [pickerOpen, setPickerOpen] = useState(false);

  const [text, setText] = useState(() => takeScrapedText());
  const [busy, setBusy] = useState(false);
  /** "怎么拿到这段文本"平时收起 —— 会粘贴的人不需要多看一段说明 */
  const [tipsOpen, setTipsOpen] = useState(false);

  const totalWeeks = Math.min(30, Math.max(1, Number(totalWeeksText) || 18));

  const result = useMemo(() => {
    if (!text.trim()) return null;
    return parseCourseText(text, { defaultWeeks: { start: 1, end: totalWeeks } });
  }, [text, totalWeeks]);

  const drafted = result?.courses ?? [];
  const sessionCount = drafted.reduce((n, course) => n + course.sessions.length, 0);

  /**
   * 待补星期。key 用 `课名#第几段` —— 同一个课名可能有好几段
   * （学术英语一周上两次、毛概在 4/8/12 周换教室），必须分得开。
   */
  const [weekdayOf, setWeekdayOf] = useState<Record<string, number>>({});
  const pendingTotal = drafted.reduce((n, draft) => n + draft.pending.length, 0);
  const totalSlots = sessionCount + pendingTotal;
  const pendingLeft = drafted.reduce(
    (n, draft) => n + draft.pending.filter((_, index) => weekdayOf[`${draft.title}#${index}`] == null).length,
    0,
  );

  /**
   * 这次会真正导入哪些课、多少条时间。
   *
   * **不必全部选完星期**：点了星期的时段跟着进，没点的这次不带。
   * 一门课的时段**全都没点** → 整门先不导 —— 导进去也只是一具"没有上课时间"
   * 的空壳，而用户并没有确认过它。反过来，本来就没时间的课（"其他课程"里
   * 那种）不算"没决定"，照常进 —— 那是解析结果，不是悬而未决。
   */
  const resolvedOf = (draft: CourseDraft): number =>
    draft.sessions.length +
    draft.pending.filter((_, index) => weekdayOf[`${draft.title}#${index}`] != null).length;

  const importing = drafted.filter(
    (draft) => resolvedOf(draft) > 0 || draft.sessions.length + draft.pending.length === 0,
  );
  const importSlots = importing.reduce((n, draft) => n + resolvedOf(draft), 0);

  const ready = importing.length > 0 && !busy;

  /**
   * 把"用户补好的星期"和解析出来的片段拼成真正能落库的时段。
   * 没点星期的时段在这里自然落空（返回空），正好实现"点了的才带"。
   */
  const sessionsOf = (draft: CourseDraft): CourseSession[] => [
    ...draft.sessions,
    ...draft.pending.flatMap((item, index): CourseSession[] => {
      const day = weekdayOf[`${draft.title}#${index}`];
      if (day == null) return [];
      return [
        {
          weekday: day,
          startPeriod: item.startPeriod,
          endPeriod: item.endPeriod,
          weeks: item.weeks,
          location: item.location,
        },
      ];
    }),
  ];

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const entities = importing.map((draft) =>
      createCourse({
        title: draft.title,
        teacher: draft.teacher,
        location: draft.location,
        sessions: sessionsOf(draft),
      }),
    );

    /**
     * 课排到第几节，作息表就得画到第几节。
     *
     * 教务文本里出现"第 13 节"而作息表只有 12 节时，那一节的时刻**算不出来**
     * （`periodSpan` 返回 null），这门课会从网格和日历里直接消失 ——
     * 不是"没时间"，是"算不出时间"，比没时间更糟。
     * 该排到第几节是从数据里读出来的事实，不用问用户，也不该逼他先去设置页改一次。
     */
    const base = term?.periods?.length ? term.periods : DEFAULT_PERIODS;
    const needed = Math.min(MAX_PERIODS, maxSessionPeriod(entities));
    await saveTerm({
      label: label.trim() || guessTermLabel(),
      startDayKey,
      totalWeeks,
      ...(needed > base.length ? { periods: resizePeriods(base, needed) } : {}),
    });
    await importCourses(entities, { replace: true });
    setBusy(false);
    router.back();
  };

  return (
    <Screen
      title="导入课表"
      subtitle="把教务系统的课表复制过来，粘进去就行"
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.text} />
        </Pressable>
      }>
      {/* 学期：三个字段的默认值都已经是对的，正常情况下不用碰 */}
      <Card title="学期" hint="开学日填第 1 周的周一 —— 有它才能算出每节课是第几周">
        <View style={styles.fieldRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            学期
          </ThemedText>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={guessTermLabel()}
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              styles.grow,
              { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
            ]}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setPickerOpen((open) => !open)}
          style={({ pressed }) => [
            styles.fieldRow,
            { opacity: pressed ? 0.7 : 1 },
          ]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            开学
          </ThemedText>
          <ThemedText type="small">{startDayKey.replace(/-/g, '/')}</ThemedText>
          <View style={styles.grow} />
          <Ionicons
            name={pickerOpen ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.textSecondary}
          />
        </Pressable>
        {pickerOpen ? (
          <MonthPicker
            value={startDayKey}
            onChange={(key) => {
              // 开学日必须有值（没有它整张课表都算不出来），所以 null 直接忽略
              if (key) setStartDayKey(key);
            }}
            onDone={() => setPickerOpen(false)}
          />
        ) : null}

        <View style={styles.fieldRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            共
          </ThemedText>
          <TextInput
            value={totalWeeksText}
            onChangeText={setTotalWeeksText}
            onEndEditing={() => setTotalWeeksText(String(totalWeeks))}
            keyboardType="number-pad"
            style={[
              styles.input,
              styles.weeksInput,
              { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
            ]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            周（没写周次的课按这个补齐）
          </ThemedText>
        </View>
      </Card>

      {/* 粘贴区 */}
      <Card
        title="课表文本"
        hint="在 App 里打开教务系统抓下来，或者长按课表选中 → 全选 → 拷贝粘进来。表格和一行一门课都认"
        right={
          text ? (
            <Pressable hitSlop={8} onPress={() => setText('')}>
              <ThemedText type="small" themeColor="textSecondary">
                清空
              </ThemedText>
            </Pressable>
          ) : undefined
        }>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={'周一\n1-2节 高等数学 教一101 张三 1-16周\n3-4节 大学物理 教二203 李四 1-8周'}
          placeholderTextColor={theme.textSecondary}
          multiline
          textAlignVertical="top"
          style={[
            styles.textarea,
            { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
          ]}
        />

        {/* 还没粘东西时才露这条 —— 粘上了就不占位置了 */}
        {!text ? (
          <>
            {/*
              省事的那条路：在 App 里打开教务系统、登录、点一下抓取。
              成熟课表软件都是这么做的，而且它比复制粘贴**多拿到一件东西** ——
              每一格在哪一天。复制出来的文字里这一列是丢的（7 天是 7 列，空白格什么都不剩），
              所以粘进来的还得一条条点星期，抓回来的不用。
              网页端没有内嵌浏览器，不显示这个入口。
            */}
            {Platform.OS !== 'web' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/import-browser')}
                style={({ pressed }) => [
                  styles.scrapeButton,
                  { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
                ]}>
                <Ionicons name="open-outline" size={15} color={theme.text} />
                <ThemedText type="small">打开教务系统，直接抓下来（连星期一起）</ThemedText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => setTipsOpen((open) => !open)}
              hitSlop={8}
              style={({ pressed }) => [styles.tipsToggle, { opacity: pressed ? 0.7 : 1 }]}>
              <Ionicons
                name={tipsOpen ? 'chevron-up' : 'help-circle-outline'}
                size={13}
                color={theme.textSecondary}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.tipsToggleText}>
                在手机上怎么拿到这段文本？
              </ThemedText>
            </Pressable>
            {tipsOpen ? (
              <View style={styles.tips}>
                {TEXT_TIPS.map((tip) => (
                  <ThemedText key={tip} type="small" themeColor="textSecondary" style={styles.tip}>
                    · {tip}
                  </ThemedText>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </Card>

      {/* 预览：先让用户核对，再写库 */}
      {result ? (
        <Card
          title={
            drafted.length
              ? totalSlots
                ? `识别到 ${drafted.length} 门课 · ${totalSlots} 条上课时间`
                : `读到 ${drafted.length} 门课，但都没有上课时间`
              : '没认出课程'
          }
          hint={
            !drafted.length
              ? '重新选一次（记得带上表头那行星期），或者用下面的「手动添加」'
              : pendingLeft
                ? '这段文字里没带星期（复制时表格的列没跟过来）。点一下星期就带上它；不点的这次不导入'
                : '核对一下，没问题就导入'
          }>
          {result.problems.length ? (
            <View style={styles.problems}>
              {result.problems.map((problem) => (
                <ThemedText key={problem} type="small" themeColor="textSecondary" style={styles.problem}>
                  · {problem}
                </ThemedText>
              ))}
            </View>
          ) : null}

          {drafted.map((draft) => {
            const color = courseColor(colorIndexOf(draft.title), dark);
            return (
              <View key={draft.title} style={styles.course}>
                <View style={styles.courseHead}>
                  <View style={[styles.dot, { backgroundColor: color.background, borderColor: color.border }]} />
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.grow}>
                    {draft.title}
                  </ThemedText>
                  {draft.teacher ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {draft.teacher}
                    </ThemedText>
                  ) : null}
                </View>
                {draft.sessions.map((session, index) => (
                  <ThemedText
                    key={`${session.weekday}-${session.startPeriod}-${index}`}
                    type="small"
                    themeColor="textSecondary"
                    style={styles.session}>
                    {describeSession(session, totalWeeks)}
                    {session.location ?? draft.location ? ` · ${session.location ?? draft.location}` : ''}
                  </ThemedText>
                ))}

                {!draft.sessions.length && !draft.pending.length ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.session}>
                    没有上课时间
                  </ThemedText>
                ) : null}

                {/*
                  待补星期：该知道的（第几节、哪些周、哪个教室）已经替他填好了，
                  只留那个真的猜不出来的问号 —— 点一下就定，不用开面板。
                */}
                {draft.pending.map((item, index) => {
                  const key = `${draft.title}#${index}`;
                  return (
                    <View key={key} style={styles.pending}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.pendingText}>
                        第 {item.startPeriod}
                        {item.endPeriod > item.startPeriod ? `-${item.endPeriod}` : ''} 节 ·{' '}
                        {describeWeeks(item.weeks, totalWeeks)}
                        {item.location ? ` · ${item.location}` : ''}
                      </ThemedText>
                      <WeekdayRow
                        compact
                        value={weekdayOf[key] ?? null}
                        onChange={(day) => setWeekdayOf((prev) => ({ ...prev, [key]: day }))}
                      />
                    </View>
                  );
                })}
                {draft.warnings.map((warning) => (
                  <ThemedText key={warning} type="small" themeColor="textSecondary" style={styles.warning}>
                    ⚠ {warning}
                  </ThemedText>
                ))}
              </View>
            );
          })}
        </Card>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={() => void submit()}
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: theme.text, opacity: !ready ? 0.35 : pressed ? 0.8 : 1 },
        ]}>
        <ThemedText type="smallBold" style={{ color: theme.background }}>
          {busy
            ? '正在导入…'
            : importing.length === 0
              ? `还有 ${pendingLeft} 条没定星期`
              : pendingLeft
                ? `先导入 ${importing.length} 门课（${pendingLeft} 条没定星期）`
                : courses.length
                  ? `导入并替换现有 ${courses.length} 门课`
                  : importSlots
                    ? `导入 ${importing.length} 门课 · ${importSlots} 条时间`
                    : `导入 ${importing.length} 门课（没有上课时间）`}
        </ThemedText>
      </Pressable>

      {/* 认不出来时的兜底出口 —— 成熟课表软件（WakeUp、超级课程表）都留着这一步 */}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/add-course')}
        style={({ pressed }) => [
          styles.secondary,
          { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
        ]}>
        <ThemedText type="small">认不出来？手动添加一门</ThemedText>
      </Pressable>

      {courses.length ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          导入会替换掉现在的 {courses.length} 门课（连同手改过的教师/地点）。换学期时正好这样用；只想加一门的话，建议先在课表里删掉那门再整体导入。
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 32,
  },
  fieldLabel: { width: 32 },
  grow: { flex: 1 },
  input: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
    lineHeight: 20,
  },
  weeksInput: { width: 56, textAlign: 'center' },
  textarea: {
    minHeight: 132,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 13,
    lineHeight: 18,
  },
  problems: { gap: Spacing.half },
  scrapeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  tipsToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.one },
  tipsToggleText: { fontSize: 12 },
  tips: { gap: Spacing.half, paddingTop: Spacing.half },
  tip: { fontSize: 12, lineHeight: 17, opacity: 0.8 },
  problem: { fontSize: 12, lineHeight: 17, opacity: 0.8 },
  course: { gap: 2, paddingVertical: Spacing.one },
  courseHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  session: { fontSize: 12, lineHeight: 17, paddingLeft: Spacing.four },
  pending: { gap: 3, paddingTop: Spacing.one, paddingLeft: Spacing.four },
  pendingText: { fontSize: 12, lineHeight: 17 },
  warning: { fontSize: 12, lineHeight: 17, paddingLeft: Spacing.four, opacity: 0.8 },
  primary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  footnote: { fontSize: 12, lineHeight: 17, opacity: 0.75 },
});

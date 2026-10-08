import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { ClockSheet } from '@/components/clock-sheet';
import { MonthPicker } from '@/components/month-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { guessTermLabel, guessTermStart, maxSessionPeriod, mondayOfWeek } from '@/domain/course';
import {
  DEFAULT_PERIODS,
  DEFAULT_PERIOD_PLAN,
  MAX_PERIODS,
  buildPeriods,
  describeClock,
  readPeriodPlan,
  resizePeriods,
  type ClassPeriod,
} from '@/domain/timetable';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/state/app-store';
import { toDayKey } from '@/utils/datetime';

/**
 * 学期设置 —— 课表的"底座"。
 *
 * 这一页存在的理由：课表**只存节次**（"周三 3-4 节"），几点到几点是这张作息表
 * 算出来的。所以开学日和作息表一动，每一节课的时刻就全变了 —— 它们是用户数据，
 * 必须有一个能改的地方。此前它们只在导入页里露过一次，导完就再也够不着了
 * （"能创建不能改"，跟"能创建不能删"是同一类毛病）。
 *
 * 作息表的编辑方式照抄成熟课表软件（WakeUp 那一类）：**先说几个数**
 * —— 第一节几点开始、一节课多长、课间多长、一天共几节 —— 整张表由它们推出来。
 * 一上来就摆 12 节 × 2 个时刻的输入框，是把"抄一遍学校的作息表"这件事
 * 交给用户做；而各校真正不同的，往往就是这几个数。（共几节跟另外三个不一样：
 * 它只加/砍尾巴，不重排已经核过的那几节。）
 *
 * 三条输入改完立即生效（失焦即写库，没有保存按钮），跟课程详情页一致。
 */

/** 用户此刻在调哪个时刻 */
type Editing =
  | { kind: 'first' }
  | { kind: 'period'; index: number; edge: 'start' | 'end' }
  | null;

export default function TermSettingsScreen() {
  const theme = useTheme();
  const router = useRouter();

  const term = useAppStore((state) => state.term);
  const saveTerm = useAppStore((state) => state.saveTerm);
  const courses = useAppStore((state) => state.courses);

  const [label, setLabel] = useState(() => term?.label ?? guessTermLabel());
  const [startDayKey, setStartDayKey] = useState(
    () =>
      term?.startDayKey ??
      guessTermStart(term?.label ?? guessTermLabel()) ??
      toDayKey(mondayOfWeek(new Date())),
  );
  const [weeksText, setWeeksText] = useState(() => String(term?.totalWeeks ?? 18));
  const [pickerOpen, setPickerOpen] = useState(false);

  /**
   * 作息表**先在本地动起来，库随后跟上**。
   *
   * 之前直接读 store：写库一失败（web 预览里 sqlite-wasm 的 VFS 本来就不通），
   * saveTerm 在 set 之前就抛了 —— 三个数改完，下面整张表纹丝不动，看起来就是
   * 「改了没反应」。但这张表的本质是「三个数排出来的预览」，预览不该等数据库点头；
   * 写库失败宁可保住界面反馈（真机上失败的话，下次进来会读到库里旧的）。
   */
  const [periods, setPeriods] = useState<readonly ClassPeriod[]>(() =>
    term?.periods?.length ? term.periods : DEFAULT_PERIODS,
  );

  const commitPeriods = (next: readonly ClassPeriod[]) => {
    setPeriods(next);
    void saveTerm({ periods: next }).catch(() => {
      // 写库失败不拦界面 —— 见上
    });
  };

  /**
   * 三个数的本地缓冲。
   * 用"输入框文本"而不是数字：不然用户敲 "4"（想打 45）的那一刻就会触发重排，
   * 整张表先被按 4 分钟排一遍。失焦时才结算。
   */
  const [firstStart, setFirstStart] = useState(() => readPeriodPlan(periods)?.firstStart ?? DEFAULT_PERIOD_PLAN.firstStart);
  const [classText, setClassText] = useState(() =>
    String(readPeriodPlan(periods)?.classMinutes ?? DEFAULT_PERIOD_PLAN.classMinutes),
  );
  const [breakText, setBreakText] = useState(() =>
    String(readPeriodPlan(periods)?.breakMinutes ?? DEFAULT_PERIOD_PLAN.breakMinutes),
  );
  /**
   * 「共几节」。它的下界是**课表里实际用到的最大节次** —— 节数不能减到
   * 比它小，否则画在这一节上的课会因为算不出时刻而从网格里消失。
   * 这个数由数据推出来，不用问用户（跟"开学日/周数"一样，用户只说他知道的）。
   */
  const [countText, setCountText] = useState(() => String(periods.length));
  const [countNotice, setCountNotice] = useState<string | null>(null);
  const usedPeriods = useMemo(() => maxSessionPeriod(courses), [courses]);

  const [editing, setEditing] = useState<Editing>(null);

  /**
   * 表被别处改过（点了某一节、点了恢复默认、从导入页回来）就把上面几个数重新读一遍。
   * 签名取**库里那张表**而不是本地这份：本地一改签名就动，会把自己刚敲的字冲掉；
   * 库没变（预览里写库失败）签名就不动，本地这份编辑成果得以保留。
   */
  const storePeriods = term?.periods?.length ? term.periods : DEFAULT_PERIODS;
  const signature = storePeriods.map((p) => `${p.index}:${p.start}-${p.end}`).join(',');
  useEffect(() => {
    const plan = readPeriodPlan(storePeriods);
    if (!plan) return;
    setPeriods(storePeriods);
    setFirstStart(plan.firstStart);
    setClassText(String(plan.classMinutes));
    setBreakText(String(plan.breakMinutes));
    setCountText(String(storePeriods.length));
    setCountNotice(null);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalWeeks = Math.min(30, Math.max(1, Number(weeksText) || 18));
  const plan = { firstStart, classMinutes: Number(classText) || DEFAULT_PERIOD_PLAN.classMinutes, breakMinutes: Number(breakText) || 0 };

  /** 节数的合法区间：下界是"课已经排到第几节"，上界是 MAX_PERIODS */
  const minPeriods = Math.max(1, usedPeriods);

  /** 改三个数 = 重排整张表（节数沿用现在的，不因为"改课间"把 12 节变成 8 节） */
  const rebuild = (next: typeof plan) => {
    commitPeriods(buildPeriods(next, periods.length));
  };

  /**
   * 改「共几节」。跟改三个数不是一回事：**只加/砍尾巴，不重排已有的节** ——
   * 学校下午、晚上各从几点开始往往不同，那些是用户一节节点过的。
   * 输入框里的数会立刻结算成合法值（跟上面的"周数"一样，超出范围就跳回去）。
   */
  const applyCount = (raw: string) => {
    const next = Math.min(MAX_PERIODS, Math.max(minPeriods, Number(raw) || periods.length));
    setCountText(String(next));
    setCountNotice(null);
    if (next !== periods.length) commitPeriods(resizePeriods(periods, next));
  };

  /** 只改某一节：其余原样保留 */
  const patchPeriod = (index: number, edge: 'start' | 'end', value: number) => {
    const next = periods.map((p) => {
      if (p.index !== index) return p;
      if (edge === 'start') {
        // 改起点时长度跟着走（"这节课从 10:00 改成 10:05 开始"是挪动，不是压短）
        const duration = p.end - p.start;
        return { ...p, start: value, end: value + duration };
      }
      // 改终点时不能越过起点：`sanitizePeriods` 会把 end <= start 的行直接丢掉，
      // 那等于用户只是想把课调短，结果整节消失
      return { ...p, end: Math.max(value, p.start + 5) };
    });
    commitPeriods(next);
  };

  const editingValue = (() => {
    if (!editing) return 0;
    if (editing.kind === 'first') return firstStart;
    const target = periods.find((p) => p.index === editing.index);
    if (!target) return firstStart;
    return editing.edge === 'start' ? target.start : target.end;
  })();

  const editingTitle = (() => {
    if (!editing) return '';
    if (editing.kind === 'first') return '第一节什么时候开始';
    return `第 ${editing.index} 节 ${editing.edge === 'start' ? '开始' : '结束'}`;
  })();

  return (
    <Screen
      title="学期"
      subtitle="课表只记第几节，几点到几点是这张表算出来的"
      right={
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={theme.text} />
        </Pressable>
      }>
      <Card title="学期" hint="开学日填第 1 周的周一 —— 有它才能算出每节课是第几周">
        <View style={styles.fieldRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            学期
          </ThemedText>
          <TextInput
            value={label}
            onChangeText={setLabel}
            onEndEditing={() => {
              const next = label.trim() || guessTermLabel();
              setLabel(next);
              void saveTerm({ label: next });
            }}
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
          style={({ pressed }) => [styles.fieldRow, { opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            开学
          </ThemedText>
          <ThemedText type="small">{startDayKey.replace(/-/g, '/')}</ThemedText>
          <View style={styles.grow} />
          <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={14} color={theme.textSecondary} />
        </Pressable>
        {pickerOpen ? (
          <MonthPicker
            value={startDayKey}
            onChange={(key) => {
              if (!key) return;
              setStartDayKey(key);
              void saveTerm({ startDayKey: key });
            }}
            onDone={() => setPickerOpen(false)}
          />
        ) : null}

        <View style={styles.fieldRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            共
          </ThemedText>
          <TextInput
            value={weeksText}
            onChangeText={setWeeksText}
            onEndEditing={() => {
              setWeeksText(String(totalWeeks));
              void saveTerm({ totalWeeks });
            }}
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

      <Card
        title="作息时间表"
        hint="学校跟默认不一样？改上面这几个数，下面整张表跟着变">
        <Pressable
          accessibilityRole="button"
          onPress={() => setEditing({ kind: 'first' })}
          style={({ pressed }) => [styles.fieldRow, { opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.planLabel}>
            第一节从
          </ThemedText>
          <View style={[styles.clockChip, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">{describeClock(firstStart)}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            开始
          </ThemedText>
        </Pressable>

        <View style={styles.fieldRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.planLabel}>
            每节课
          </ThemedText>
          <TextInput
            value={classText}
            onChangeText={setClassText}
            onEndEditing={() => {
              const next = Math.min(180, Math.max(10, Number(classText) || DEFAULT_PERIOD_PLAN.classMinutes));
              setClassText(String(next));
              rebuild({ ...plan, classMinutes: next });
            }}
            keyboardType="number-pad"
            style={[
              styles.input,
              styles.numberInput,
              { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
            ]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            分钟
          </ThemedText>
        </View>

        <View style={styles.fieldRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.planLabel}>
            课间
          </ThemedText>
          <TextInput
            value={breakText}
            onChangeText={setBreakText}
            onEndEditing={() => {
              const next = Math.min(90, Math.max(0, Number(breakText) || 0));
              setBreakText(String(next));
              rebuild({ ...plan, breakMinutes: next });
            }}
            keyboardType="number-pad"
            style={[
              styles.input,
              styles.numberInput,
              { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
            ]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            分钟
          </ThemedText>
        </View>

        {/* 共几节：不是上面三个数推出来的，是"你学校一天排到第几节"这件事本身 */}
        <View style={styles.fieldRow}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.planLabel}>
            共
          </ThemedText>
          <TextInput
            value={countText}
            onChangeText={(raw) => {
              setCountText(raw);
              const typed = Number(raw);
              setCountNotice(
                typed > 0 && typed < minPeriods
                  ? `有课排到第 ${usedPeriods} 节，再少它就没地方画了`
                  : null,
              );
            }}
            onEndEditing={() => applyCount(countText)}
            keyboardType="number-pad"
            accessibilityLabel="共几节"
            style={[
              styles.input,
              styles.numberInput,
              { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
            ]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            节
          </ThemedText>
        </View>
        {countNotice ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.notice}>
            {countNotice}
          </ThemedText>
        ) : null}

        {/* 整张表：既是"排出来对不对"的核对面，也是逐节微调的入口 */}
        <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
        <View style={styles.periodList}>
          {periods.map((period) => (
            <View key={period.index} style={styles.periodRow}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.periodIndex}>
                第 {period.index} 节
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`第 ${period.index} 节开始时间`}
                onPress={() => setEditing({ kind: 'period', index: period.index, edge: 'start' })}
                style={({ pressed }) => [
                  styles.clockChip,
                  { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.6 : 1 },
                ]}>
                <ThemedText type="small">{describeClock(period.start)}</ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">
                –
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`第 ${period.index} 节结束时间`}
                onPress={() => setEditing({ kind: 'period', index: period.index, edge: 'end' })}
                style={({ pressed }) => [
                  styles.clockChip,
                  { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.6 : 1 },
                ]}>
                <ThemedText type="small">{describeClock(period.end)}</ThemedText>
              </Pressable>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => commitPeriods([...DEFAULT_PERIODS])}
          style={({ pressed }) => [styles.reset, { opacity: pressed ? 0.6 : 1 }]}>
          <Ionicons name="refresh" size={13} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">
            恢复默认作息
          </ThemedText>
        </Pressable>
      </Card>

      <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
        课表里每一节课的时刻都是由这张表算出来的 —— 改这里，所有课的时间会一起变
        （已经排出去的提醒会自动重排）。课间不是每节都一样（比如第 2 节后是大课间），
        就点上面那一节的时刻单独改。
      </ThemedText>

      <ClockSheet
        visible={editing !== null}
        title={editingTitle}
        minutesOfDay={editingValue}
        onClose={() => setEditing(null)}
        onConfirm={(value) => {
          if (editing?.kind === 'first') {
            setFirstStart(value);
            rebuild({ ...plan, firstStart: value });
          } else if (editing) {
            patchPeriod(editing.index, editing.edge, value);
          }
          setEditing(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 34 },
  fieldLabel: { width: 32 },
  planLabel: { width: 56, fontSize: 12 },
  grow: { flex: 1 },
  input: {
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
    lineHeight: 20,
  },
  weeksInput: { width: 52, textAlign: 'center' },
  numberInput: { width: 52, textAlign: 'center' },
  /** 跟上面几行"共 X 节"的输入框对齐：标签宽 56 + 行内间距 8 */
  notice: { fontSize: 12, lineHeight: 17, paddingLeft: 64, opacity: 0.75 },
  clockChip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.two,
    minWidth: 58,
    alignItems: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  periodList: { gap: Spacing.one },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  periodIndex: { width: 52, fontSize: 12 },
  reset: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.three,
  },
  footnote: { fontSize: 12, lineHeight: 17, opacity: 0.75 },
});

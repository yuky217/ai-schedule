import { addDays, addMonths, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dayKeyOf, parseDayKey } from '@/utils/datetime';

/**
 * 轻量月份选择器。
 *
 * 为什么不装第三方日期库：只有"选一天"这一个需求（项目的开始/结束日），
 * 而成熟库（react-native-calendars 等）动辄带一整套主题与多选 API，
 * 引进来是为了用 5% 的能力付 100% 的维护成本。这里 60 行就到顶了。
 *
 * 交互照抄系统日历：点一下就选中并收起，另有"今天"和"清除"。
 */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;
const WEEK_ROWS = 6;

export interface MonthPickerProps {
  /** 当前值（ISO 或 'YYYY-MM-DD'） */
  value?: string | null;
  /** 传回 'YYYY-MM-DD'；点"清除"传 null */
  onChange: (dayKey: string | null) => void;
  /** 选完后收起（由调用方决定怎么收起） */
  onDone?: () => void;
  /** 是否显示"清除"。选时间这类场景下必须选一天，置 false 藏掉 */
  allowClear?: boolean;
}

export function MonthPicker({ value, onChange, onDone, allowClear = true }: MonthPickerProps) {
  const theme = useTheme();
  const selected = parseDayKey(dayKeyOf(value));
  const [cursor, setCursor] = useState<Date>(() => selected ?? new Date());

  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    return Array.from({ length: WEEK_ROWS * 7 }, (_, i) => addDays(first, i));
  }, [cursor]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="上个月"
          onPress={() => setCursor((c) => addMonths(c, -1))}
          style={[styles.navButton, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">‹</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">{format(cursor, 'yyyy年M月')}</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="下个月"
          onPress={() => setCursor((c) => addMonths(c, 1))}
          style={[styles.navButton, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">›</ThemedText>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((label) => (
          <View key={label} style={styles.cell}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.weekday}>
              {label}
            </ThemedText>
          </View>
        ))}
      </View>

      {Array.from({ length: WEEK_ROWS }, (_, row) => (
        <View key={row} style={styles.weekRow}>
          {days.slice(row * 7, row * 7 + 7).map((day) => {
            const active = selected ? isSameDay(day, selected) : false;
            const today = isSameDay(day, new Date());
            const outside = !isSameMonth(day, cursor);
            return (
              <Pressable
                key={day.toISOString()}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onChange(format(day, 'yyyy-MM-dd'));
                  onDone?.();
                }}
                style={styles.cell}>
                <View
                  style={[
                    styles.dayCircle,
                    active && { backgroundColor: theme.text },
                    !active && today && { borderColor: theme.text, borderWidth: 1.5 },
                  ]}>
                  <ThemedText
                    type="small"
                    themeColor={active ? 'background' : outside ? 'textSecondary' : 'text'}
                    style={[styles.dayText, outside && styles.outside]}>
                    {day.getDate()}
                  </ThemedText>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onChange(format(new Date(), 'yyyy-MM-dd'));
            onDone?.();
          }}
          style={styles.footerButton}>
          <ThemedText type="small" themeColor="textSecondary">
            今天
          </ThemedText>
        </Pressable>
        {allowClear ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onChange(null);
              onDone?.();
            }}
            style={styles.footerButton}>
            <ThemedText type="small" themeColor="textSecondary">
              清除
            </ThemedText>
          </Pressable>
        ) : (
          <View />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: Spacing.two, padding: Spacing.two, gap: Spacing.one },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.one,
  },
  navButton: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 1 },
  weekday: { fontSize: 11, lineHeight: 15 },
  dayCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 13, lineHeight: 17 },
  outside: { opacity: 0.35 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.two },
  footerButton: { paddingVertical: Spacing.one },
});

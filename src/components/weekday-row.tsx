import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { WEEK_ORDER, weekdayLabel } from '@/domain/course';
import { useTheme } from '@/hooks/use-theme';

/**
 * 一星期七个按钮，点一个就定 —— **内联**使用，不弹面板。
 *
 * 为什么单独抽成一个组件：手动加课要选星期、导入时"没读到星期"的那几条也要选，
 * 两处必须长得一样、手感一样。做成底部弹窗在导入场景里更不行 ——
 * 一份教务系统的课表可能有十几条要补，一条一次弹窗等于让用户点三十下。
 *
 * `value` 收 `null` 是有意的：那正是"还没定"的状态。导入页里
 * "没读到星期"的条目就停在这个状态上，用户点一下才落定 ——
 * 我们绝不替它填一个看起来像真的的默认值。
 */
export interface WeekdayRowProps {
  /** null = 还没定过 */
  value: number | null;
  onChange: (weekday: number) => void;
  /** 紧凑模式：导入预览里一条条补星期时用，格子小一圈 */
  compact?: boolean;
}

export function WeekdayRow({ value, onChange, compact }: WeekdayRowProps) {
  const theme = useTheme();
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {WEEK_ORDER.map((day) => {
        const active = value === day;
        return (
          <Pressable
            key={day}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(day)}
            style={[
              styles.cell,
              compact && styles.cellCompact,
              { backgroundColor: active ? theme.text : theme.backgroundElement },
            ]}>
            <ThemedText
              type="small"
              style={{ color: active ? theme.background : theme.textSecondary }}>
              {weekdayLabel(day).replace('周', '')}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.one },
  rowCompact: { gap: 3 },
  cell: {
    flex: 1,
    minWidth: 34,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  cellCompact: { minWidth: 0, paddingVertical: 3 },
});

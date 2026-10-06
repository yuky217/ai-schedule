import { StyleSheet, View } from 'react-native';

import type { HeatCell } from '@/domain/checkins';
import { useTheme } from '@/hooks/use-theme';

/**
 * 打卡热力图（日历格子那种）。
 *
 * 一列 = 一周、一行 = 星期几，最下面一行是今天所在的那天。
 * 从末尾往前填，所以"今天"永远在右下角固定位置 —— 每次打开看到的
 * 是同一张图向右生长，而不是整块挪位。
 *
 * 只有"打了/没打"两种深浅，不做次数分级：个人习惯一天打几次没有意义，
 * 有了反而要额外解释"深色是什么意思"。
 */
export interface CheckinHeatmapProps {
  cells: HeatCell[];
  /** 显示多少列（周） */
  weeks?: number;
  cellSize?: number;
}

const GAP = 3;

export function CheckinHeatmap({ cells, weeks = 5, cellSize = 12 }: CheckinHeatmapProps) {
  const theme = useTheme();
  if (!cells.length) return null;

  const last = cells[cells.length - 1]!;
  const slots: Array<HeatCell | null> = new Array(weeks * 7).fill(null);

  cells.forEach((cell, i) => {
    const offsetFromEnd = cells.length - 1 - i;
    const index = (weeks - 1) * 7 + last.weekday - offsetFromEnd;
    if (index >= 0 && index < slots.length) slots[index] = cell;
  });

  return (
    <View style={styles.grid}>
      {Array.from({ length: weeks }, (_, column) => (
        <View key={column} style={styles.column}>
          {Array.from({ length: 7 }, (_, row) => {
            const cell = slots[column * 7 + row];
            if (!cell) {
              return (
                <View
                  key={row}
                  style={{ width: cellSize, height: cellSize, borderRadius: 3, opacity: 0 }}
                />
              );
            }
            return (
              <View
                key={row}
                accessibilityLabel={`${cell.dayKey}${cell.done ? ' 已打卡' : ' 未打卡'}`}
                style={[
                  styles.cell,
                  {
                    width: cellSize,
                    height: cellSize,
                    borderRadius: 3,
                    backgroundColor: cell.done ? theme.text : theme.backgroundSelected,
                    borderColor: cell.isToday ? theme.textSecondary : 'transparent',
                    borderWidth: cell.isToday ? 1.5 : 0,
                    opacity: cell.done ? 1 : 0.7,
                  },
                ]}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: GAP },
  column: { gap: GAP },
  cell: {},
});

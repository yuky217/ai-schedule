import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * 悬浮的圆形主按钮。
 *
 * 首页的「记录」原先是一个常驻的输入框 —— 占着一整块地方，而它绝大多数时候是空的。
 * 换成一颗悬浮的「＋」之后，页面从第一眼起就在讲"现在做什么"，
 * 想记的时候手指往下够一下就到。**记这件事没变慢，它只是不再抢地方了**。
 *
 * 尺寸取 56：安卓 Material 的标准值，够大好点，又不至于把内容压掉一块。
 * 用这个值的还有 Screen 的悬浮层（靠它算底部留白），所以导出。
 */
export const FAB_SIZE = 56;

export interface FabProps {
  onPress: () => void;
  /** 读屏时念出来的名字，必须写 —— 一颗没有文字的圆按钮对读屏等于不存在 */
  accessibilityLabel: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function Fab({ onPress, accessibilityLabel, icon = 'add' }: FabProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: theme.text, opacity: pressed ? 0.85 : 1 },
      ]}>
      <Ionicons name={icon} size={FAB_SIZE * 0.5} color={theme.background} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // 浮在内容之上，得有一层阴影把眼睛拉开距离，否则像块贴在纸上的色块
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});

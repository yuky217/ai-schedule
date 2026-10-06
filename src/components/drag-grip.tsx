import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * 拖拽把手 —— 只是一个"这里可以拖"的视觉提示，不接管任何手势。
 *
 * 手势由所在的整行承担（长按拾起，见 hooks/use-cross-day-drag.ts）。
 * 这样既保留了用户熟悉的抓手暗示，又不用让手指去掐准一个 26px 的小热区。
 */
export function DragGrip() {
  const theme = useTheme();
  return (
    <View style={styles.handle} pointerEvents="none">
      <Ionicons name="reorder-three-outline" size={20} color={theme.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  handle: {
    width: 26,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
});

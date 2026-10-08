import type { useRouter } from 'expo-router';

/**
 * 关掉当前页。
 *
 * `router.back()` 在**没有历史栈**时是空操作 —— 浏览器里直接开网址、刷新，
 * 或者将来悬浮球深链冷启动直达记录页，× 就会"按了没反应"。
 * 这里统一收口：有历史就退，没历史就回首页。
 */
export function closeScreen(router: ReturnType<typeof useRouter>) {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

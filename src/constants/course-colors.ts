/**
 * 课表配色。
 *
 * 为什么要单独一份、而不是直接用主题色：
 * 课表是靠**颜色认课**的（一眼看出"周三下午连着三门"），所以每个色块必须是
 * "浅实底 + 同色系深字"的三件套。直接拿主题的强调色当底，浅色模式下太刺眼、
 * 深色模式下又会和黑底糊在一起 —— 而课块里的字必须始终看得清。
 *
 * 领域层只给 0..COURSE_COLORS-1 的下标（`factory.ts` 的 `colorIndexOf`），
 * 颜色值全部收在这里，界面上不出现任何写死的色值。
 */

export interface CourseColor {
  /** 块底色 */
  background: string;
  /** 块描边：比底色深一档，用来把紧挨着的两块分开 */
  border: string;
  /** 块里的字 */
  text: string;
}

/** 8 个色相 × 深浅两套。下标由课名哈希决定，所以同一门课永远同一个颜色 */
export const COURSE_PALETTES: { light: CourseColor[]; dark: CourseColor[] } = {
  light: [
    { background: '#DCE9FF', border: '#B4CDF5', text: '#123A6B' },
    { background: '#DCEFDD', border: '#B2D7B6', text: '#14421A' },
    { background: '#E8E0FB', border: '#CBBDF0', text: '#332063' },
    { background: '#FCE7D2', border: '#F0CBA4', text: '#5C3210' },
    { background: '#D5EFEC', border: '#A7DBD5', text: '#0F4240' },
    { background: '#FBE0E9', border: '#F0BCCD', text: '#5E1B32' },
    { background: '#FAF0CE', border: '#E9D99C', text: '#4E3E06' },
    { background: '#E2E6EC', border: '#C4CDD8', text: '#2A313B' },
  ],
  dark: [
    { background: '#1B3A63', border: '#2F5A8E', text: '#D3E2FB' },
    { background: '#1E3F24', border: '#356B3F', text: '#D3EBD6' },
    { background: '#312557', border: '#4E3D82', text: '#E3DBFB' },
    { background: '#4E3414', border: '#744E21', text: '#F8E3CB' },
    { background: '#123F3C', border: '#21645E', text: '#CDEBE7' },
    { background: '#4E1D2E', border: '#762F48', text: '#F8D9E3' },
    { background: '#46390D', border: '#6B5A18', text: '#F4E8BE' },
    { background: '#2B323C', border: '#454F5D', text: '#DBE1E9' },
  ],
};

/** 取色；下标非法（负数/非整数/越界）一律回落到第 0 号，界面拿不到 undefined */
export function courseColor(index: number, dark: boolean): CourseColor {
  const list = dark ? COURSE_PALETTES.dark : COURSE_PALETTES.light;
  const safe = Number.isInteger(index) && index >= 0 ? index % list.length : 0;
  return list[safe]!;
}

import { describe, expect, it } from 'vitest';

import { splitSubtaskLines } from '@/domain/subtask-lines';

describe('splitSubtaskLines', () => {
  it('空的和只有空白的都拆不出东西', () => {
    expect(splitSubtaskLines('')).toEqual([]);
    expect(splitSubtaskLines('   \n\n  \n')).toEqual([]);
  });

  it('一行就一条 —— 跟"只写一个"的旧行为一致', () => {
    expect(splitSubtaskLines('查资料')).toEqual(['查资料']);
    // 输入框里的首尾空格不算标题的一部分
    expect(splitSubtaskLines('  查资料  ')).toEqual(['查资料']);
  });

  it('多行拆成多条，顺序就是用户写的顺序', () => {
    expect(splitSubtaskLines('查资料\n写提纲\n发给小王')).toEqual([
      '查资料',
      '写提纲',
      '发给小王',
    ]);
  });

  it('中间的空行不留空条目', () => {
    expect(splitSubtaskLines('查资料\n\n\n发给小王')).toEqual(['查资料', '发给小王']);
  });

  it('列表符号不算标题的一部分', () => {
    expect(splitSubtaskLines('- 查资料\n* 写提纲\n• 发给小王')).toEqual([
      '查资料',
      '写提纲',
      '发给小王',
    ]);
    expect(splitSubtaskLines('1. 查资料\n2、写提纲\n3) 发给小王')).toEqual([
      '查资料',
      '写提纲',
      '发给小王',
    ]);
  });

  it('一句话里的逗号不切 —— 那不是"另一条"的意思', () => {
    expect(splitSubtaskLines('买菜，顺便取快递')).toEqual(['买菜，顺便取快递']);
  });

  it('Windows 的换行也认', () => {
    expect(splitSubtaskLines('查资料\r\n写提纲')).toEqual(['查资料', '写提纲']);
  });
});

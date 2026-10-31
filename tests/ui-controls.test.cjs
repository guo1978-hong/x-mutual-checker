const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sortUsers, fitPanel } = require('../x-mutual-checker/ui-controls.js');

test('粉丝数支持双向排序，零粉丝有效，未知数始终放在最后', () => {
  const rows = [{ id: 'unknown', followers: null }, { id: 'high', followers: 15000 }, { id: 'zero', followers: 0 }, { id: 'low', followers: 12 }, { id: 'absent' }];
  assert.deepEqual(sortUsers(rows, 'followers_asc', 'nfb').map(x => x.id), ['zero', 'low', 'high', 'unknown', 'absent']);
  assert.deepEqual(sortUsers(rows, 'followers_desc', 'nfb').map(x => x.id), ['high', 'low', 'zero', 'unknown', 'absent']);
  assert.equal(rows[0].id, 'unknown');
});
test('默认保留取关发现时间排序，用户也能改为粉丝数', () => {
  const rows = [{ id: 'old', detectedAt: 10, followers: 2 }, { id: 'new', detectedAt: 20, followers: 1 }];
  assert.equal(sortUsers(rows, 'default', 'unf')[0].id, 'new');
  assert.equal(sortUsers(rows, 'followers_desc', 'unf')[0].id, 'old');
});
test('竖屏不再被640像素限制，移动与高度始终留在视口内', () => {
  const tall = fitPanel(1920, 200, 1896);
  assert.equal(tall.height, 1896);
  assert.equal(tall.top, 12);
  const moved = fitPanel(1920, 5000, 800);
  assert.equal(moved.top + moved.height, 1908);
  assert.equal(fitPanel(1920, -200, 800).top, 12);
});
test('短屏和缩放后仍能收回面板，非法旧设置使用安全默认值', () => {
  for (const h of [280, 600, 768, 1280, 1920]) {
    const box = fitPanel(h, 1000, 3000);
    assert.ok(box.top >= 12 && box.top + box.height <= h - 12);
  }
  assert.equal(fitPanel(900, NaN, NaN).height, 640);
});
test('新增筛选栏后，最小高度同时容纳固定操作区与列表', () => {
  assert.equal(fitPanel(1280, 12, 360, 520).height, 520);
  assert.equal(fitPanel(480, 12, 360, 520).height, 456);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../x-mutual-checker/relationship-guards.js');
const day = 86400000;
const now = new Date(2026, 9, 29, 12).getTime();
const make = () => G.createGuard(null, {}, now, 'owner-a');
test('升级保留旧忽略记录、账号详情，且独立数据不会因旧忽略字段恢复而复活已移除项', () => {
  const old = { ignored: { '100': 1, '200': 1 }, nonFollowback: [{ id: '100', name: '保留账号' }] };
  const g = G.createGuard(null, old, now, 'a');
  assert.equal(g.whitelist['100'].name, '保留账号');
  assert.equal(g.whitelist['200'].legacy, true);
  G.removeWhitelist(g, '100');
  const restored = G.createGuard(JSON.parse(JSON.stringify(g)), old, now, 'a');
  assert.equal(restored.whitelist['100'], undefined);
  assert.ok(old.ignored['100']);
});
test('首次基线与用户注册时间均不能伪装成新增关注时间', () => {
  const g = make();
  G.observeScan(g, [{ id: '100', created_at: new Date(now).toISOString() }], true, now);
  assert.equal(G.dateInfo(g, '100').kind, 'unknown');
  assert.equal(G.dateInfo(g, '100').firstSeenAt, now);
});
test('只在两次完整扫描之间推断新增区间；部分采集不推进基线', () => {
  const g = make();
  G.observeScan(g, [{ id: '100' }], true, now - 10 * day);
  G.observeScan(g, [{ id: '200' }], false, now - 2 * day);
  assert.equal(g.baseline.at, now - 10 * day);
  assert.equal(G.dateInfo(g, '200').kind, 'unknown');
  G.observeScan(g, [{ id: '100' }, { id: '200' }], true, now);
  assert.deepEqual(G.dateInfo(g, '200'), { kind: 'interval', from: now - 10 * day, to: now });
  g.preferences.period = '7d';
  assert.equal(G.protection(g, '200', now), 'recent');
});
test('本机观察记录可保护近期关注；重新关注会更新记录', () => {
  const g = make();
  G.confirmFollow(g, '100', now - 9 * day);
  G.confirmFollow(g, '100', now - 1000);
  g.preferences.period = 'today';
  assert.equal(G.dateInfo(g, '100').kind, 'confirmed');
  assert.equal(G.protection(g, '100', now), 'recent');
});
test('今天按本机自然日；近七天按滚动窗口并包含边界', () => {
  const g = make(); const midnight = G.cutoff('today', now);
  g.preferences.period = 'today';
  G.confirmFollow(g, '100', midnight);
  G.confirmFollow(g, '200', midnight - 1);
  assert.equal(G.protection(g, '100', now), 'recent');
  assert.equal(G.protection(g, '200', now), null);
  g.preferences.period = '7d';
  G.confirmFollow(g, '300', now - 7 * day);
  G.confirmFollow(g, '400', now - 7 * day - 1);
  assert.equal(G.protection(g, '300', now), 'recent');
  assert.equal(G.protection(g, '400', now), null);
});
test('未知日期可保守保护，也可由用户明确选择继续显示', () => {
  const g = make(); g.preferences.period = '7d';
  assert.equal(G.protection(g, '100', now), null);
  assert.equal(G.dateInfo(g, '100').kind, 'unknown');
  g.preferences.protectUnknown = true;
  assert.equal(G.protection(g, '100', now), 'unknown');
  g.preferences.protectUnknown = false;
  assert.equal(G.protection(g, '100', now), null);
  g.preferences.period = 'off';
  assert.equal(G.protection(g, '100', now), null);
});
test('新账号的完整扫描区间覆盖更早的页面观察信号，避免将操作信号当作服务器精确日期', () => {
  const g = make();
  G.observeScan(g, [{ id: '100' }], true, now - 10 * day);
  G.confirmFollow(g, '200', now - 8 * day);
  G.observeScan(g, [{ id: '100' }, { id: '200' }], true, now);
  g.preferences.period = '7d';
  assert.equal(G.dateInfo(g, '200').kind, 'interval');
  assert.equal(G.protection(g, '200', now), 'recent');
});
test('白名单永远优先，跨扫描保存且移出后才恢复候选资格', () => {
  const g = make(); G.addWhitelist(g, [{ id: '100', screen_name: 'keep' }], now);
  assert.equal(G.protection(g, '100', now), 'whitelist');
  G.observeScan(g, [{ id: '100', screen_name: 'renamed' }], true, now + 1000);
  assert.equal(g.whitelist['100'].screen_name, 'renamed');
  const saved = JSON.parse(JSON.stringify(g));
  assert.equal(G.protection(saved, '100', now), 'whitelist');
  G.removeWhitelist(saved, '100');
  assert.equal(G.protection(saved, '100', now), null);
});
test('错误账号与恶意ID不混入保护名单，空完整名单可成为下一次基线', () => {
  const g = make();
  assert.throws(() => G.createGuard(g, {}, now, 'owner-b'), /不一致/);
  G.addWhitelist(g, [{ id: '__proto__' }, { id: 'not-a-number' }], now);
  assert.equal(Object.keys(g.whitelist).length, 0);
  G.observeScan(g, [], true, now);
  G.observeScan(g, [{ id: '100' }], true, now + 1);
  assert.equal(G.dateInfo(g, '100').kind, 'interval');
});
test('混入无效ID的扫描不能推断新增关注区间', () => {
  const g = make(); G.observeScan(g, [{ id: '100' }], true, now - day);
  G.observeScan(g, [{ id: '200' }, { id: 'invalid' }], true, now);
  assert.equal(g.baseline.at, now - day);
  assert.equal(G.dateInfo(g, '200').kind, 'unknown');
});

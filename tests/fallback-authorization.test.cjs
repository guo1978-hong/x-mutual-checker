const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const guards = require('../x-mutual-checker/relationship-guards.js');
const contentSource = fs.readFileSync(path.join(__dirname, '../x-mutual-checker/content.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(__dirname, '../x-mutual-checker/background.js'), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));

async function runFallback(options = {}) {
  const calls = { clicks: 0, writes: [], guardReads: 0, messages: [] };
  const page = {}; page.top = page;
  let owner = '42';
  const document = {
    get cookie() { return 'twid=u%3D' + owner; },
    querySelector() { if (options.switchOwnerWhenLocating) owner = '43'; return { click() { calls.clicks++; if (options.switchOwner) owner = '43'; } }; },
  };
  const chrome = {
    runtime: { async sendMessage(msg) {
      calls.messages.push(msg);
      if (options.messageError) throw new Error('Synthetic missing worker');
      return options.authorization || { ok: false };
    } },
    storage: { local: {
      async get() { calls.guardReads++; return options.storage || {}; },
      async set(value) { calls.writes.push(value); },
    } },
  };
  vm.runInNewContext(contentSource, { window: page, document, chrome,
    location: { search: '?xmf_unfollow=123' }, URLSearchParams, Date, Promise, setTimeout, XmfGuards: guards });
  await turn();
  return calls;
}
const authorization = { ok: true, owner: '42', resultKey: 'xmf_tab_synthetic' };
test('普通URL没有后台授权：零点击、零结果写入，不读取名单保护状态', async () => {
  const c = await runFallback();
  assert.equal(c.clicks, 0); assert.equal(c.writes.length, 0); assert.equal(c.guardReads, 0);
  assert.equal(c.messages[0].type, 'authorizeUnfollowFallback');
});
test('后台不可用时URL回退不执行任何点击', async () => {
  const c = await runFallback({ messageError: true });
  assert.equal(c.clicks, 0); assert.equal(c.writes.length, 0);
});
test('有效授权也不能在账号发生变化后执行', async () => {
  const c = await runFallback({ authorization: { ...authorization, owner: '43' } });
  assert.equal(c.clicks, 0); assert.equal(c.writes[0].xmf_tab_synthetic.ok, false);
  const delayed = await runFallback({ authorization, switchOwnerWhenLocating: true });
  assert.equal(delayed.clicks, 0); assert.equal(delayed.writes[0].xmf_tab_synthetic.ok, false);
});
test('有效授权仍受白名单保护，且确认前再次核对账号', async () => {
  const guard = guards.createGuard(null, {}, Date.now(), '42');
  guards.addWhitelist(guard, [{ id: '123' }], Date.now());
  const protectedCall = await runFallback({ authorization, storage: { xmf_guard_42: guard } });
  assert.equal(protectedCall.clicks, 0); assert.equal(protectedCall.writes[0].xmf_tab_synthetic.ok, false);
  const changedCall = await runFallback({ authorization, switchOwner: true });
  assert.equal(changedCall.clicks, 1); assert.equal(changedCall.writes[0].xmf_tab_synthetic.ok, false);
});
test('已授权、账号一致且未受保护时，模拟DOM可以完成回退', async () => {
  const c = await runFallback({ authorization });
  assert.equal(c.clicks, 2); assert.equal(c.writes[0].xmf_tab_synthetic.ok, true);
});

function worker(options = {}) {
  let listener, now = 1000, sequence = 0, ticket = 0;
  const timers = new Map(), changeListeners = new Set(), urls = new Map();
  const h = { created: [], updated: [], closed: [], removed: [], enabled: options.enabled !== false,
    advance(ms) { now += ms; },
    expire() { for (const callback of [...timers.values()]) callback(); },
    emit(key, value) { for (const callback of [...changeListeners]) callback({ [key]: { newValue: value } }, 'local'); },
    send(msg, sender) { return new Promise(resolve => listener(msg, sender, resolve)); },
    fallbackSender(tab) { return { id: 'extension', tab: { id: tab.id }, url: urls.get(tab.id) }; },
  };
  class Clock extends Date { static now() { return now; } }
  const noEvent = { addListener() {} };
  const chrome = {
    runtime: { id: 'extension', onMessage: { addListener(fn) { listener = fn; } }, onInstalled: noEvent, onStartup: noEvent },
    action: { onClicked: noEvent },
    tabs: {
      async create(value) { const tab = { id: 100 + h.created.length }; h.created.push({ ...tab, ...value }); return tab; },
      async update(id, value) { h.updated.push({ id, ...value }); urls.set(id, value.url); if (options.updateError) throw new Error('Synthetic navigation failure'); },
      async remove(id) { h.closed.push(id); },
    },
    storage: {
      local: { async get() { return { xmf_enabled: h.enabled }; }, async remove(key) { h.removed.push(key); } },
      onChanged: { addListener(fn) { changeListeners.add(fn); }, removeListener(fn) { changeListeners.delete(fn); } },
    },
  };
  vm.runInNewContext(backgroundSource, { chrome, URL, Map, Date: Clock,
    crypto: { randomUUID() { return 'synthetic-' + ++ticket; } },
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } });
  h.start = async (patch = {}, sender = { id: 'extension', tab: { id: 11 }, url: 'https://x.com/home' }) => {
    const before = h.created.length;
    const reply = h.send({ type: 'unfollowViaTab', id: '123', screen_name: 'example', origin: 'https://x.com', owner: '42', ...patch }, sender);
    await turn();
    return { reply, tab: h.created[before] };
  };
  h.authorize = (tab, id = '123', patch = {}) => h.send({ type: 'authorizeUnfollowFallback', id }, { ...h.fallbackSender(tab), ...patch });
  return h;
}
test('后台只接受本扩展X标签页、合法账号和相同站点来源', async () => {
  for (const [patch, sender] of [
    [{ owner: 'invalid' }, undefined], [{ id: '../123' }, undefined], [{ screen_name: '../other' }, undefined],
    [{ origin: 'https://example.invalid' }, undefined], [{}, { id: 'other', tab: { id: 11 }, url: 'https://x.com/home' }],
    [{}, { id: 'extension', tab: { id: 11 }, url: 'https://example.invalid/' }],
  ]) {
    const h = worker(); const flow = await h.start(patch, sender);
    assert.equal((await flow.reply).ok, false); assert.equal(h.created.length, 0);
  }
});
test('授权绑定后台标签页且只领取一次，先登记授权再打开X页面', async () => {
  const h = worker(); const flow = await h.start();
  assert.equal(flow.tab.url, 'about:blank');
  const wrongTab = await h.authorize(flow.tab, '123', { tab: { id: 999 } });
  assert.equal(wrongTab.ok, false);
  const permit = await h.authorize(flow.tab);
  assert.equal(permit.ok, true); assert.equal(permit.owner, '42');
  assert.equal((await h.authorize(flow.tab)).ok, false);
  h.emit(permit.resultKey, { ok: true });
  assert.equal((await flow.reply).ok, true);
  assert.deepEqual(h.closed, [flow.tab.id]);
});
test('错误目标ID、站点或主页路径不能领取授权', async () => {
  for (const patch of [{ id: '456' }, { url: 'https://twitter.com/example?xmf_unfollow=123' }, { url: 'https://x.com/other?xmf_unfollow=123' }]) {
    const h = worker(); const flow = await h.start();
    const permit = await h.authorize(flow.tab, patch.id || '123', patch.url ? { url: patch.url } : {});
    assert.equal(permit.ok, false); h.expire(); assert.equal((await flow.reply).ok, false);
  }
});
test('过期或扩展已关闭时授权失效', async () => {
  const disabled = worker({ enabled: false }); const noStart = await disabled.start();
  assert.equal((await noStart.reply).ok, false); assert.equal(disabled.created.length, 0);
  for (const reason of ['expired', 'disabled']) {
    const h = worker(); const flow = await h.start();
    if (reason === 'expired') h.advance(31000); else h.enabled = false;
    assert.equal((await h.authorize(flow.tab)).ok, false);
    h.expire(); assert.equal((await flow.reply).ok, false);
  }
});
test('并发后台操作的结果互不串用，结束后仅清理临时结果项', async () => {
  const h = worker(); const a = await h.start(); const b = await h.start({ id: '456', screen_name: 'another' });
  const pa = await h.authorize(a.tab); const pb = await h.authorize(b.tab, '456');
  assert.notEqual(pa.resultKey, pb.resultKey);
  let secondDone = false; b.reply.then(() => { secondDone = true; });
  h.emit(pa.resultKey, { ok: true }); await a.reply; await turn(); assert.equal(secondDone, false);
  h.emit(pb.resultKey, { ok: false, error: 'synthetic' }); assert.equal((await b.reply).ok, false);
  assert.deepEqual(h.removed.sort(), [pa.resultKey, pb.resultKey].sort());
});
test('后台页面打开失败时及时撤销授权并关闭临时标签页', async () => {
  const h = worker({ updateError: true }); const flow = await h.start();
  assert.equal((await flow.reply).ok, false);
  assert.equal((await h.authorize(flow.tab)).ok, false);
  assert.deepEqual(h.closed, [flow.tab.id]);
});

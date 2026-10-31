// 仅用于本机界面验收：不加载页面接口或后台脚本，不访问真实账号。
(async () => {
  const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="#216c9e"/><circle cx="40" cy="30" r="13" fill="#a9ddff"/><path d="M15 70a25 25 0 0 1 50 0" fill="#a9ddff"/></svg>');
  const users = Array.from({ length: 180 }, (_, i) => ({
    id: i === 178 ? '90001' : String(10000 + i), screen_name: 'demo_user_' + String(i + 1).padStart(3, '0'),
    name: '演示账号 ' + String(i + 1).padStart(3, '0'), followers: i === 0 ? 0 : (i * 137) % 18000,
    blue: i % 5 !== 4, followedBy: false, followingCount: 300, avatar,
    detectedAt: Date.now() - i * 3600000,
  }));
  const params = new URLSearchParams(location.search);
  const caseId = (params.get('case') || 'default').replace(/[^a-z0-9-]/gi, '').slice(0, 50);
  const storeKey = 'xmf-preview-v2-' + caseId;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storeKey) || '{}'); } catch {}
  const legacy = {
    mutual: Object.fromEntries(Array.from({ length: 230 }, (_, i) => ['mutual_' + i, 1])),
    unfollowers: Object.fromEntries(users.slice(0, 24).map(u => [u.id, u])), ignored: { '10000': 1, '10011': 1, '10014': 1 }, counts: {},
    nonFollowback: users, lastScanAt: Date.now() - 86400000, lastCount: 410, unknown: 0,
  };
  if (params.get('scenario') === 'legacy') legacy.ignored['999998'] = 1;
  const seededGuard = XmfGuards.createGuard(null, legacy, Date.now(), 'fixture');
  users.forEach((u, i) => {
    if (i < 100) XmfGuards.confirmFollow(seededGuard, u.id, Date.now() - (20 + i) * 86400000);
    else if (i < 120) XmfGuards.confirmFollow(seededGuard, u.id, Date.now() - (i < 104 ? 1000 : 4 * 86400000));
  });
  const data = { xmf_enabled: true,
    ...(params.get('scenario') === 'fresh' ? {} : { xmf_fixture: legacy }),
    ...(params.get('scenario') === 'legacy' || params.get('scenario') === 'fresh' ? {} : { xmf_guard_fixture: seededGuard }),
    ...saved };
  const listeners = [];
  window.chrome = { storage: {
    local: {
      async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))); },
      async set(values) {
        if (params.get('failwrites') === '1') throw new Error('模拟存储不可写');
        const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: data[key], newValue: value }]));
        Object.assign(data, structuredClone(values));
        Object.assign(saved, structuredClone(values));
        localStorage.setItem(storeKey, JSON.stringify(saved));
        queueMicrotask(() => listeners.forEach(fn => fn(changes, 'local')));
      },
    },
    onChanged: { addListener(fn) { listeners.push(fn); } },
  }, runtime: { sendMessage() { throw new Error('预览禁止后台操作'); } } };
  let accountRequests = 0;
  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.source !== 'xmf-content') return;
    const { reqId, type } = e.data;
    if (type === 'unfollow') accountRequests++;
    const result = type === 'scan' ? { users: users.map((u,i) => ({ ...u, followedBy: i % 6 === 0 })), mode: 'fast', endReached: true }
      : { error: '虚构数据预览：未连接 X', ok: false };
    window.postMessage({ source: 'xmf-page', reqId, ...result }, location.origin);
  });
  document.getElementById('fixture-follow').addEventListener('click', e => {
    e.currentTarget.setAttribute('data-testid', '90001-unfollow');
    e.currentTarget.textContent = '演示账号已关注（无网络请求）';
  });
  let source = await (await fetch('../x-mutual-checker/content.js', { cache: 'no-store' })).text();
  const marker = '!(viewerId = getViewerId())';
  if (!source.includes(marker)) throw new Error('界面启动入口已改变，请更新预览夹具');
  // 只替换测试身份入口；排序、布局、渲染、事件与生产界面完全使用同一份代码。
  source = source.replace(marker, "!(viewerId = 'fixture')");
  const endMarker = '  init();\n})();';
  if (!source.includes(endMarker)) throw new Error('测试入口已改变');
  source = source.replace(endMarker, `
  window.fixtureGuardProbe = async kind => {
    const u = { id: '10001', screen_name: 'demo_user_002' };
    S.sel.add(u.id);
    await updateGuard(g => {
      if (kind === 'white') XmfGuards.addWhitelist(g, [u], Date.now());
      else { XmfGuards.removeWhitelist(g, u.id); XmfGuards.confirmFollow(g, u.id, Date.now()); g.preferences.period = '7d'; }
    });
    return await doUnfollow(u);
  };
  init();
})();`);
  for (const kind of ['white', 'recent']) document.getElementById('probe-' + kind).addEventListener('click', async () => {
    const before = accountRequests;
    const result = await window.fixtureGuardProbe(kind);
    document.getElementById('probe-result').textContent = result === null && accountRequests === before
      ? 'PASS：保护账号已拦截，账号操作请求 0' : 'FAIL：保护拦截不符合预期';
  });
  const script = document.createElement('script');
  script.textContent = source;
  document.body.append(script);
  document.getElementById('preview-status').textContent = '虚构数据已载入；扫描、取关均未连接 X。';
})();

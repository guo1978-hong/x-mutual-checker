// 名单保护：独立账号存储；不读取凭据，不发送账号操作。
(() => {
  const DAY = 86400000;
  const validId = id => typeof id === 'string' && /^\d{1,25}$/.test(id);
  const stamp = n => Number.isFinite(n) && n > 0;
  function createGuard(raw, legacy, now, owner) {
    if (raw && raw.owner !== owner) throw new Error('名单保护数据与当前账号不一致');
    const g = { schema: 1, owner, whitelist: {}, dates: {}, baseline: null,
      preferences: { period: 'off', protectUnknown: false }, ...raw };
    g.whitelist = Object.fromEntries(Object.entries(g.whitelist || {}).filter(([id]) => validId(id)));
    g.dates = Object.fromEntries(Object.entries(g.dates || {}).filter(([id]) => validId(id)));
    g.preferences = { period: 'off', protectUnknown: false, ...g.preferences };
    if (!['off', 'today', '7d'].includes(g.preferences.period)) g.preferences.period = 'off';
    g.preferences.protectUnknown = g.preferences.protectUnknown === true;
    if (!raw) {
      const known = new Map([...(legacy.nonFollowback || []), ...Object.values(legacy.unfollowers || {})].map(u => [u.id, u]));
      for (const id of Object.keys(legacy.ignored || {})) {
        if (validId(id)) g.whitelist[id] = { ...(known.get(id) || {}), id, legacy: true, addedAt: null };
      }
      // 旧扫描只能证明曾观察到此账号，不能当作真实关注日期。
      if (stamp(legacy.lastScanAt)) for (const [id] of known) {
        if (validId(id)) g.dates[id] = { firstSeenAt: legacy.lastScanAt, lastSeenAt: legacy.lastScanAt };
      }
    }
    return g;
  }
  function observeScan(g, users, complete, now) {
    const rows = users.filter(u => validId(u.id));
    const reliable = complete && rows.length === users.length && new Set(rows.map(u => u.id)).size === rows.length;
    const previous = g.baseline && stamp(g.baseline.at) && Array.isArray(g.baseline.ids)
      ? new Set(g.baseline.ids) : null;
    for (const u of rows) {
      const d = g.dates[u.id] || { firstSeenAt: now };
      d.lastSeenAt = now;
      if (reliable && previous && !previous.has(u.id)) {
        d.intervalStart = g.baseline.at;
        d.intervalEnd = now;
        delete d.confirmedAt;
      }
      g.dates[u.id] = d;
      if (g.whitelist[u.id]) Object.assign(g.whitelist[u.id], u);
    }
    if (reliable)
      g.baseline = { at: now, ids: rows.map(u => u.id) };
    return g;
  }
  function confirmFollow(g, id, at) {
    if (!validId(id) || !stamp(at)) return false;
    const old = g.dates[id] || {};
    g.dates[id] = { firstSeenAt: old.firstSeenAt || at, lastSeenAt: at, confirmedAt: at };
    return true;
  }
  function addWhitelist(g, users, now) {
    for (const u of users) if (validId(u.id))
      g.whitelist[u.id] = { ...u, id: u.id, addedAt: g.whitelist[u.id]?.addedAt || now };
  }
  function removeWhitelist(g, id) { if (validId(id)) delete g.whitelist[id]; }
  function cutoff(period, now) {
    if (period === '7d') return now - 7 * DAY;
    if (period === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
    return null;
  }
  function dateInfo(g, id) {
    const d = g.dates[id] || {};
    if (stamp(d.confirmedAt)) return { kind: 'confirmed', from: d.confirmedAt, to: d.confirmedAt };
    if (stamp(d.intervalStart) && stamp(d.intervalEnd) && d.intervalStart <= d.intervalEnd)
      return { kind: 'interval', from: d.intervalStart, to: d.intervalEnd };
    return { kind: 'unknown', firstSeenAt: d.firstSeenAt || null };
  }
  function protection(g, id, now) {
    if (g.whitelist[id]) return 'whitelist';
    const limit = cutoff(g.preferences.period, now);
    if (limit == null) return null;
    const info = dateInfo(g, id);
    if (info.kind === 'unknown') return g.preferences.protectUnknown ? 'unknown' : null;
    // 两次完整扫描间新增：时间区间与保护期重叠时保守保护。
    return info.to >= limit ? 'recent' : null;
  }
  const api = { createGuard, observeScan, confirmFollow, addWhitelist, removeWhitelist, cutoff, dateInfo, protection, validId };
  globalThis.XmfGuards = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

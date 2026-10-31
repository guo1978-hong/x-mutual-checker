// 仅允许已确认操作创建的后台标签页领取一次性回退授权。
const fallbackActions = new Map();
const validActionId = value => typeof value === 'string' && /^\d{1,25}$/.test(value);
const xOrigin = value => value === 'https://x.com' || value === 'https://twitter.com';
function trustedSender(sender) {
  try { return sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && xOrigin(new URL(sender.url).origin); }
  catch { return false; }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'unfollowViaTab') {
    unfollowViaTab(msg, sender).then(sendResponse, () => sendResponse({ ok: false, error: '后台回退未能启动' }));
    return true;
  }
  if (msg && msg.type === 'authorizeUnfollowFallback') {
    authorizeFallback(msg, sender).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
});

async function authorizeFallback({ id }, sender) {
  if (!trustedSender(sender)) return { ok: false };
  const action = fallbackActions.get(sender.tab.id);
  if (!action) return { ok: false };
  fallbackActions.delete(sender.tab.id);
  const url = new URL(sender.url);
  if (action.id !== id || action.expiresAt <= Date.now() || url.origin !== action.origin ||
      url.pathname.slice(1).toLowerCase() !== action.screen_name.toLowerCase() ||
      url.searchParams.get('xmf_unfollow') !== id) return { ok: false };
  const { xmf_enabled } = await chrome.storage.local.get('xmf_enabled');
  return xmf_enabled && action.expiresAt > Date.now()
    ? { ok: true, owner: action.owner, resultKey: action.resultKey } : { ok: false };
}

async function unfollowViaTab({ id, screen_name, origin, owner }, sender) {
  if (!trustedSender(sender) || !validActionId(id) || !validActionId(owner) ||
      typeof screen_name !== 'string' || !/^\w{1,15}$/.test(screen_name) ||
      !xOrigin(origin) || origin !== new URL(sender.url).origin)
    return { ok: false, error: '后台操作来源或账号无效' };
  const { xmf_enabled } = await chrome.storage.local.get('xmf_enabled');
  if (!xmf_enabled) return { ok: false, error: '扩展已关闭，未执行后台操作' };

  const key = 'xmf_tab_' + crypto.randomUUID();
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const action = { id, screen_name, origin, owner, resultKey: key, expiresAt: Date.now() + 30000 };
  fallbackActions.set(tab.id, action);
  const result = await new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => done({ ok: false, error: '页面操作超时' }), 30000);
    function onChange(changes, area) {
      if (area === 'local' && changes[key] && changes[key].newValue) done(changes[key].newValue);
    }
    function done(r) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fallbackActions.delete(tab.id);
      chrome.storage.onChanged.removeListener(onChange);
      resolve(r);
    }
    chrome.storage.onChanged.addListener(onChange);
    chrome.tabs.update(tab.id, { url: `${origin}/${screen_name}?xmf_unfollow=${id}` })
      .catch(() => done({ ok: false, error: '后台页面未能打开' }));
  });
  try {
    await chrome.tabs.remove(tab.id);
  } catch {}
  await chrome.storage.local.remove(key);
  return result;
}

// ---------- 开关：点工具栏图标 开启 / 关闭 ----------
async function refreshBadge() {
  const { xmf_enabled } = await chrome.storage.local.get('xmf_enabled');
  await chrome.action.setBadgeText({ text: xmf_enabled ? '开' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
  await chrome.action.setTitle({ title: xmf_enabled ? '互关检测助手 for X：已开启（点击关闭）' : '互关检测助手 for X：已关闭（点击开启）' });
}

chrome.action.onClicked.addListener(async (tab) => {
  const { xmf_enabled } = await chrome.storage.local.get('xmf_enabled');
  const on = !xmf_enabled;
  await chrome.storage.local.set({ xmf_enabled: on });
  await refreshBadge();
  // 开启时如果当前不在 X 页面，直接打开 X
  if (on && !/^https:\/\/(x|twitter)\.com\//.test(tab.url || '')) chrome.tabs.create({ url: 'https://x.com/home' });
});

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);


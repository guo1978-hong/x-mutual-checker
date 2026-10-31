// 本地界面增强：只处理排序和布局，不访问账号、网络或名单存储。
(() => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function sortUsers(users, order, tab) {
    const list = [...users];
    if (order === 'default' && tab === 'unf')
      return list.sort((a, b) => (b.detectedAt || 0) - (a.detectedAt || 0));
    return list.sort((a, b) => {
      const knownA = Number.isFinite(a.followers) && a.followers >= 0;
      const knownB = Number.isFinite(b.followers) && b.followers >= 0;
      if (knownA !== knownB) return knownA ? -1 : 1;
      if (!knownA) return 0;
      return order === 'followers_asc' ? a.followers - b.followers : b.followers - a.followers;
    });
  }
  function fitPanel(viewportHeight, top, height, contentMinimum = 360) {
    const maxHeight = Math.max(1, viewportHeight - 24);
    const minHeight = Math.min(Math.max(360, contentMinimum), maxHeight);
    const fittedHeight = clamp(Number.isFinite(height) ? height : 640, minHeight, maxHeight);
    return {
      height: fittedHeight,
      top: clamp(Number.isFinite(top) ? top : 12, 12, Math.max(12, viewportHeight - fittedHeight - 12)),
      minHeight,
      maxHeight,
    };
  }
  const api = { sortUsers, fitPanel };
  globalThis.XmfUI = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

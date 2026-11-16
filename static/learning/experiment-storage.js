/* 只保存当前学生的轻量实验状态；存储失败不影响实验和服务器札记。 */
export function createExperimentStorage(root, activityId, snapshot) {
  const studentId = root.dataset.studentId;
  const key = studentId ? `shanhai:experiment:${studentId}:${activityId}` : null;
  let timer;
  let previous;
  function flush() {
    clearTimeout(timer); timer = null;
    if (!key) return;
    try {
      const state = snapshot();
      if (state === null) return;
      const encoded = JSON.stringify(state);
      if (encoded === previous) return;
      localStorage.setItem(key, JSON.stringify({ version: 1, studentId, activityId,
        savedAt: new Date().toISOString(), state }));
      previous = encoded;
    } catch { /* 配额不足或浏览器禁用存储时仍可继续实验。 */ }
  }
  function changed() {
    // 动画即使频繁重绘，也只合并保存一次当前快照。
    if (!timer) timer = setTimeout(flush, 1000);
  }
  window.addEventListener('pagehide', flush);
  for (const type of ['input', 'change', 'click', 'pointerup', 'keyup']) root.addEventListener(type, changed);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  return {
    changed, flush,
    read() {
      try {
        const saved = key && JSON.parse(localStorage.getItem(key));
        if (saved?.version === 1 && saved.studentId === studentId && saved.activityId === activityId) return saved.state;
      } catch { /* 坏记录按首次进入处理。 */ }
      return null;
    },
    clear() {
      clearTimeout(timer); timer = null;
      // 记住重置后的初始快照，关闭页面时不会把清除的记录重新写回。
      previous = JSON.stringify(snapshot());
      try { if (key) localStorage.removeItem(key); } catch {}
    },
  };
}

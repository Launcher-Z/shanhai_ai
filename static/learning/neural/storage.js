/* 实验只写当前学生的本地存储；札记、圈色和解锁始终由服务器决定。 */
(function () {
  const query = new URLSearchParams(location.search);
  const studentId = query.get('student');
  const activityId = query.get('activity');
  const key = `shanhai:experiment:${studentId}:${activityId}`;
  let timer;
  window.ExperimentStore = {
    read() {
      if (!studentId || !activityId) return null;
      try {
        const saved = JSON.parse(localStorage.getItem(key));
        return saved?.version === 1 && saved.studentId === studentId && saved.activityId === activityId ? saved.state : null;
      } catch { return null; }
    },
    write(state) {
      if (!studentId || !activityId) return false;
      try {
        localStorage.setItem(key, JSON.stringify({version: 1, studentId, activityId, savedAt: new Date().toISOString(), state}));
        return true;
      } catch { document.dispatchEvent(new CustomEvent('experiment:storage-error')); return false; }
    },
    schedule(getState) { clearTimeout(timer); timer = setTimeout(() => this.write(getState()), 300); },
    clear() { clearTimeout(timer); try { localStorage.removeItem(key); } catch { /* 不阻断实验。 */ } },
  };
})();

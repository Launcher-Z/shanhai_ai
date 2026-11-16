/* 小状态用localStorage，候选图Blob用IndexedDB，均按学生及活动隔离。 */
export function store(studentId, activityId) {
  const key = `shanhai:creation:${studentId}:${activityId}`;
  function open() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('shanhai-creation', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('candidates');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error('本机图片保存失败，请保留下载的原图。'));
    });
  }
  async function blob(action, value) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('candidates', action === 'get' ? 'readonly' : 'readwrite');
        const object = tx.objectStore('candidates');
        const r =
          action === 'get'
            ? object.get(key)
            : action === 'delete'
              ? object.delete(key)
              : object.put(value, key);
        tx.oncomplete = () => resolve(r.result);
        tx.onerror = () => reject(new Error('本机存储空间不足，请保留下载的原图。'));
      });
    } finally {
      db.close();
    }
  }
  return {
    read() {
      try {
        const d = JSON.parse(localStorage.getItem(key));
        return d?.version === 1 && d.studentId === studentId && d.activityId === activityId ? d.state : {};
      } catch {
        return {};
      }
    },
    write(state) {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ version: 1, studentId, activityId, savedAt: new Date().toISOString(), state }),
        );
        return true;
      } catch {
        return false;
      }
    },
    blob,
    async clear() {
      localStorage.removeItem(key);
      await blob('delete');
    },
  };
}

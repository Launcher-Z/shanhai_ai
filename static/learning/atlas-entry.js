/* 学习首页只管理入口和生命周期，地图、原文和图鉴仍由 atlas 模块负责。 */
(() => {
  const entry = document.getElementById('open-atlas');
  const dialog = document.getElementById('learning-atlas');
  const host = dialog.querySelector('.atlas-frame-host');
  const status = dialog.querySelector('.atlas-entry-status');
  let frame;

  function openAtlas() {
    if (dialog.open) return;
    status.hidden = false;
    document.documentElement.classList.add('atlas-open');
    document.body.classList.add('atlas-open');
    dialog.showModal();
    // 点击后才请求地图及三维依赖；不占用学习首页的首屏加载时间。
    frame = document.createElement('iframe');
    frame.title = '可拖动的山海图与山域图鉴';
    const url = new URL(entry.dataset.atlasSrc, window.location.href);
    url.searchParams.set('embed', '1');
    frame.src = url.href;
    frame.addEventListener('load', () => { status.hidden = true; }, { once: true });
    host.replaceChildren(frame);
  }

  function closeAtlas() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    // 先释放 WebGL，再卸载整个文档；重新打开时重读最新图片清单。
    frame?.contentWindow?.dispatchEvent(new Event('shanhai-atlas:dispose'));
    host.replaceChildren();
    frame = null;
    document.documentElement.classList.remove('atlas-open');
    document.body.classList.remove('atlas-open');
    entry.focus({ preventScroll: true });
  });
  entry.addEventListener('click', openAtlas);
  dialog.querySelector('.atlas-entry-close').addEventListener('click', closeAtlas);
  window.addEventListener('message', event => {
    // 只接收当前同源地图窗口发出的关闭请求。
    if (event.origin === window.location.origin && event.source === frame?.contentWindow
        && event.data?.type === 'shanhai-atlas:close') closeAtlas();
  });
  entry.hidden = false;
})();

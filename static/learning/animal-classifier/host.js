/* iframe 隔离模型库；完成、审核与札记继续使用公共控制器。 */
export function mountAnimalClassifier(root, onStepChange, activityId = 'lesson-2-task-2', options = {}) {
  const frame = document.createElement('iframe');
  frame.title = '训练并测试动物分类器';
  const url = new URL('index.html', import.meta.url);
  url.searchParams.set('student', root.dataset.studentId);
  url.searchParams.set('activity', activityId);
  if (options.explore) url.searchParams.set('mode', 'explore');
  let lab, gate = [0], step = 0, active = true;
  function resize() {
    const body = frame.contentDocument?.body;
    if (!body || !active || root.hidden || !root.getClientRects().length) return;
    // iframe随正文自然展开，只让外层古纸阅读区承担工作台的滚动。
    const height = `${Math.ceil(body.getBoundingClientRect().height) + 2}px`;
    if (frame.style.height !== height) frame.style.height = height;
  }
  function bindLab() {
    lab = frame.contentWindow.AnimalLab;
    if (!lab) { frame.contentWindow.addEventListener('animal:ready', bindLab, {once:true}); return; }
    lab.bind({gate, changed:resize, navigate:onStepChange});
    step = lab.getStep();
    if (!active) lab.pause();
    new frame.contentWindow.ResizeObserver(resize).observe(frame.contentDocument.body);
    resize();
  }
  frame.addEventListener('load', bindLab);
  frame.src = url.href;
  root.append(frame);
  const pane = root.closest('.activity-body');
  const paneObserver = new ResizeObserver(resize);
  if (pane) paneObserver.observe(pane);
  return {
    setGate(value) { gate = value; lab?.setGate(value); },
    getStep() { return lab?.getStep() ?? step; },
    goToStep(value) { step = value; lab?.goToStep(value); resize(); },
    refresh() { active = true; lab?.resume(); resize(); },
    pause() { active = false; lab?.pause(); },
    reset() { lab?.reset(); resize(); },
    trainingEvidence() { return lab?.trainingEvidence?.(); },
    discard() { active=false; paneObserver.disconnect(); lab?.dispose?.(); frame.remove(); },
  };
}

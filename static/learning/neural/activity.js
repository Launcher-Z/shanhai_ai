/* 活动外壳复用札记控制器；两个独立文档隔离原实验的 DOM 和模型全局名称。 */
const modes = {
  'zero-one': [
    ['认识输入', '把图片变成 60 个输入数值。'],
    ['训练前测试', '先测同一组 5 张图片，留下比较的起点。'],
    ['逐次训练', '完整观察三次计算、预测与参数更新。'],
    ['继续训练', '再更新 100 次参数，观察学习反馈。'],
    ['训练后比较', '复测原来的 5 张图片，用记录支持结论。'],
  ],
  digits: [
    ['十个输出与初测', '任选 5 张不同图片，记录未训练模型的预测。'],
    ['训练与固定图比较', '各档都是追加次数；用同一组图片比较不同训练阶段。'],
    ['手写与权重探究', '试写三个数字，再对照笔迹和当前模型的权重。'],
    ['添加自己的样本', '选择数字，写下笔迹并加入训练集，再回到前面继续训练与测试。'],
    ['班级数据再训练', '下载教师发布的数据，接着当前模型训练，再比较旧笔迹与新笔迹。'],
  ],
};

export function mountNeural(root, onStepChange) {
  const mode = root.dataset.neuralMode;
  const steps = modes[mode];
  root.style.setProperty('--neural-step-count', steps.length);
  const nav = root.querySelector('.neural-steps');
  const status = root.querySelector('[data-neural-status]');
  const frame = document.createElement('iframe');
  frame.title = {'zero-one':'0—1 单层神经网络实验', digits:'0—9 单层神经网络实验'}[mode];
  // 同源内容不接收外部消息，接口只绑定当前的实验窗口。
  const url = new URL(`${mode}/index.html`, import.meta.url);
  url.searchParams.set('v', '20261115b');
  url.searchParams.set('student', root.dataset.studentId);
  // 测试开关随同源实验传递，不修改学生的训练次数或服务器成绩。
  if (document.querySelector('meta[name="progress-locks-enabled"]')?.content === 'false') url.searchParams.set('progress-locks', 'off');
  url.searchParams.set('activity', {'zero-one':'lesson-7-task-1', digits:'lesson-7-task-2'}[mode]);
  let lab, selected = 0, gate = [0], active = true;
  function drawNav() {
    [...nav.children].forEach((button, index) => {
      button.disabled = gate !== null && !gate.includes(index);
      button.setAttribute('aria-current', selected === index ? 'step' : 'false');
    });
    root.querySelector('.neural-heading h3').textContent = steps[selected][0];
    root.querySelector('.neural-heading p').textContent = steps[selected][1];
  }
  function goToStep(step) {
    if (!Number.isInteger(step) || !steps[step] || (gate !== null && !gate.includes(step))) return;
    if (lab && !lab.selectStep(step)) {
      status.textContent = '先完成当前实验中的操作，再进入这一段。';
      return;
    }
    selected = step;
    status.textContent = '';
    drawNav();
    onStepChange(step);
  }
  steps.forEach(([title], index) => {
    const button = document.createElement('button');
    button.type = 'button';
    const number = document.createElement('span');
    number.className = 'neural-step-number'; number.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span'); label.textContent = title;
    button.append(number, label);
    button.addEventListener('click', () => goToStep(index));
    nav.append(button);
  });
  const resize = () => {
    const body = frame.contentDocument?.body;
    if (body) frame.style.height = `${Math.ceil(body.getBoundingClientRect().height) + 22}px`;
  };
  frame.addEventListener('load', () => {
    lab = frame.contentWindow.NeuralLab;
    const loading = root.querySelector('.neural-load');
    if (!lab) { loading.textContent = '实验未能加载，请关闭活动后重新打开。'; return; }
    loading.hidden = true;
    lab.bind({gate, step: selected, changed: resize, navigate: goToStep});
    if (!active) lab.pause();
    new frame.contentWindow.ResizeObserver(resize).observe(frame.contentDocument.body);
    resize();
  });
  frame.src = url.href;
  root.querySelector('.neural-frame-host').append(frame);
  root.querySelector('[data-neural-note]').addEventListener('click', () => {
    root.closest('dialog').dispatchEvent(new CustomEvent('worksheet:open', {detail:{step:selected}}));
  });
  drawNav();
  return {
    goToStep,
    setGate(steps) { gate = steps; lab?.setGate(steps); drawNav(); },
    refresh() { active = true; lab?.resume(); resize(); },
    pause() { active = false; lab?.pause(); },
    reset() { lab?.reset(); selected = 0; drawNav(); onStepChange(0); },
    experimentAnswers(step) { return lab?.answers(step) || {}; },
    baselineDigits() { return lab?.baselineDigits?.() || []; },
    handwritingAttempts() { return lab?.handwritingAttempts?.() || []; },
    ownTrainingSamples() { return lab?.ownTrainingSamples?.() || []; },
  };
}

/* 学习首页：课程由服务端提供；这里只负责课时切换、翻卷与装饰动画。 */
(() => {
  const volumes = JSON.parse(document.getElementById('course-data').textContent);
  const sheets = [...document.querySelectorAll('.sheet')];
  const links = [...document.querySelectorAll('[data-jump]')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const assets = new URL('.', document.currentScript.src);
  const selected = volumes.map(() => 0);
  const flow = { phase: 0 };
  const animated = () => document.body.classList.contains('animated-book');
  let trigger;
  let currentVolume = -1;

  function createCircle(done, excellent = false) {
    const circle = document.createElement('span');
    circle.className = `status-ring${done ? ' done' : ''}${excellent ? ' gold' : ''}`;
    circle.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.src = new URL(`ink-circle-${done ? 'green' : 'red'}.png`, assets).href;
    image.alt = '';
    circle.append(image);
    return circle;
  }

  function refreshVolumeStatus(volumeIndex) {
    // 卷完成需要覆盖卷内全部课时，不随当前选中的课时而改变。
    const activities = volumes[volumeIndex].lessons.flatMap(lesson => lesson.activities).filter(activity => !activity.optional);
    const done = activities.length > 0 && activities.every(activity => activity.completed);
    const excellent = done && activities.every(activity => activity.excellent);
    const link = document.querySelector(`.volume-navigation [data-jump="${volumeIndex}"]`);
    link.querySelector('.status-ring').replaceWith(createCircle(done, excellent));
    link.setAttribute('aria-label', `卷${volumes[volumeIndex].number} ${volumes[volumeIndex].title}，${excellent ? '优秀' : done ? '已完成' : '未完成'}`);
  }

  function refreshTabs(volumeIndex) {
    sheets[volumeIndex].querySelectorAll('.lesson-tab').forEach((button, lessonIndex) => {
      const lesson = volumes[volumeIndex].lessons[lessonIndex];
      const required = lesson.activities.filter(activity => !activity.optional);
      const done = required.length > 0 && required.every(activity => activity.completed);
      const excellent = done && required.every(activity => activity.excellent);
      const status = !lesson.available ? '未解锁' : excellent ? '优秀' : done ? '已完成' : '未完成';
      const active = lessonIndex === selected[volumeIndex];
      button.classList.toggle('selected', active);
      button.classList.toggle('is-locked', !lesson.available);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      button.querySelector('.status-ring').replaceWith(createCircle(done, excellent));
      button.querySelector('em').textContent = status;
      button.setAttribute('aria-label', `第 ${lesson.number} 课 ${lesson.title}，${status}`);
    });
    refreshVolumeStatus(volumeIndex);
  }

  function createActivity(activity, index) {
    // 活动入口先展示纸页外观；真实开放和完成状态仍由课程数据决定。
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `activity${activity.available ? '' : ' is-locked'}`;
    button.dataset.activityId = activity.id;
    button.disabled = !activity.available;
    if (activity.available) {
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-controls', 'learning-activity');
    } else {
      button.setAttribute('aria-label', `${activity.title}，活动尚未解锁`);
    }
    const ring = createCircle(activity.completed, activity.excellent);
    if(activity.progress_mode==='none')ring.classList.add('resource-ring');
    button.append(ring);
    const copy = document.createElement('span');
    copy.className = 'activity-copy';
    const title = document.createElement('strong');
    title.textContent = activity.title;
    const note = document.createElement('small');
    let status = activity.content_type ? '可体验' : '准备中';
    if (!activity.available) status = '未解锁';
    else if (activity.label) status = activity.label;
    else if (activity.completed) status = activity.excellent ? '优秀' : '已完成';
    if(activity.progress_mode==='none')status='自由观展／采集';
    note.textContent = `活动 ${index + 1} · ${status}`;
    copy.append(title, note);
    const label = document.createElement('span');
    label.className = 'activity-label';
    label.textContent = activity.available ? '查看活动 ' : '未解锁';
    if (activity.available) {
      const arrow = document.createElement('span');
      arrow.textContent = '↗';
      arrow.setAttribute('aria-hidden', 'true');
      label.append(arrow);
    }
    button.append(copy, label);
    return button;
  }

  function renderLesson(volumeIndex, lessonIndex) {
    selected[volumeIndex] = lessonIndex;
    const volume = volumes[volumeIndex];
    const lesson = volume.lessons[lessonIndex];
    const panel = sheets[volumeIndex].querySelector('.lesson-panel');
    panel.classList.toggle('is-locked', !lesson.available);
    panel.setAttribute('aria-labelledby', `tab-${volumeIndex}-${lessonIndex}`);
    panel.querySelector('.eyebrow').textContent = `卷${volume.number} · 第 ${lesson.number} 课`;
    panel.querySelector('.lesson-title').textContent = lesson.title;
    panel.querySelector('.lesson-intro').textContent = lesson.intro;
    panel.querySelector('.activity-list').replaceChildren(...lesson.activities.map(createActivity));
    panel.querySelector('.knowledge-tags').replaceChildren(...lesson.knowledge.map(tag => {
      const item = document.createElement('li');
      item.textContent = tag;
      return item;
    }));
    refreshTabs(volumeIndex);
    if (window.gsap && !reduced.matches) {
      gsap.fromTo(panel, { opacity: .35, y: 8 }, { opacity: 1, y: 0, duration: .4, ease: 'power2.out', overwrite: true });
    }
  }

  // 札记和首页各自读取课程数据，通过后端返回的进度事件同步，避免散落判定规则。
  document.addEventListener('learning:progress', event => {
    const states = new Map(event.detail.map(state => [state.activity_id, state]));
    volumes.forEach((volume, vi) => {
      volume.lessons.forEach(lesson => lesson.activities.forEach(activity => {
        if (states.has(activity.id)) Object.assign(activity, states.get(activity.id));
      }));
      refreshTabs(vi);
      const lesson = volume.lessons[selected[vi]];
      sheets[vi].querySelectorAll('.activity[data-activity-id]').forEach(button => {
        const activity = lesson.activities.find(item => item.id === button.dataset.activityId);
        if (!activity) return;
        if(activity.progress_mode==='none')return;
        button.querySelector('.status-ring').replaceWith(createCircle(activity.completed, activity.excellent));
        const index = lesson.activities.indexOf(activity);
        const status = !activity.available ? '未解锁' : activity.label || (activity.completed ? '已完成' : activity.content_type ? '可体验' : '准备中');
        button.querySelector('.activity-copy small').textContent = `活动 ${index + 1} · ${status}`;
      });
    });
  });

  sheets.forEach((sheet, volumeIndex) => {
    const tabs = sheet.querySelector('.lesson-tabs');
    tabs.addEventListener('click', event => {
      if (!volumes[volumeIndex].available) return;
      const button = event.target.closest('[data-lesson]');
      if (button) renderLesson(volumeIndex, Number(button.dataset.lesson));
    });
    tabs.addEventListener('keydown', event => {
      if (!volumes[volumeIndex].available) return;
      const button = event.target.closest('[data-lesson]');
      if (!button) return;
      const count = volumes[volumeIndex].lessons.length;
      let next = Number(button.dataset.lesson);
      if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (next + 1) % count;
      else if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (next + count - 1) % count;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = count - 1;
      else return;
      event.preventDefault();
      renderLesson(volumeIndex, next);
      sheet.querySelector(`[data-lesson="${next}"]`).focus();
    });
    refreshTabs(volumeIndex);
  });

  function selectVolume(index) {
    sheets.forEach((sheet, pageIndex) => { sheet.inert = animated() && pageIndex !== index; });
    if (index === currentVolume) return;
    currentVolume = index;
    links.forEach(link => {
      const active = Number(link.dataset.jump) === index;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });
    document.querySelector('.current-volume').textContent = `卷${volumes[index].number} · ${volumes[index].title}`;
  }

  function setProgress(progress) {
    document.querySelector('.ink-fill').style.transform = `scaleX(${progress})`;
    document.querySelector('.ink-track').setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  }

  function updateTurn() {
    const phase = Math.min(2, Math.max(0, flow.phase));
    setProgress(phase / 2);
    selectVolume(phase < .82 ? 0 : phase < 1.82 ? 1 : 2);
  }

  links.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const index = Number(link.dataset.jump);
    const top = trigger && animated()
      ? trigger.start + (trigger.end - trigger.start) * index / 2
      : sheets[index].getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top, behavior: reduced.matches ? 'instant' : 'smooth' });
  }));

  if (window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    gsap.ticker.fps(30);
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      document.body.classList.add('animated-book');
      const timeline = gsap.timeline({
        onUpdate: updateTurn,
        scrollTrigger: {
          trigger: '.book-scroll', start: 'top top', end: 'bottom bottom', scrub: 1.2, invalidateOnRefresh: true,
          // 刷新恢复滚动位置时，动画会静默定位；同时同步当前卷，避免可见书页仍被 inert 禁用。
          onRefresh: updateTurn,
        },
      });
      timeline.to(flow, { phase: 2, duration: 2, ease: 'none' }, 0);
      sheets.slice(0, 2).forEach((sheet, index) => {
        const start = index + .38;
        timeline.to(sheet, { rotationY: -7, skewY: -.7, xPercent: -1.2, scale: .997, duration: .62, ease: 'sine.inOut' }, start)
          .to(sheet, { clipPath: 'polygon(0% 0%,62% 0%,75% 100%,0% 100%)', duration: .3, ease: 'sine.in' }, start)
          .to(sheet, { clipPath: 'polygon(0% 0%,0% 0%,0% 100%,0% 100%)', duration: .32, ease: 'sine.out' }, start + .3)
          .to(sheet.querySelector('.fold-shadow'), { opacity: .65, duration: .5, ease: 'sine.inOut' }, start)
          .fromTo('.paper-curl', { right: '3.6vw', opacity: 0, scaleX: .4 }, { right: '89vw', opacity: .75, scaleX: 1.15, duration: .58, ease: 'sine.inOut', immediateRender: false }, start)
          .to('.paper-curl', { opacity: 0, scaleX: .25, duration: .12 }, start + .5)
          .to(document.documentElement, { '--paper': volumes[index + 1].paper, '--accent': volumes[index + 1].accent, duration: .7, ease: 'sine.inOut' }, index + .28);
      });
      trigger = timeline.scrollTrigger;
      updateTurn();
      return () => {
        trigger = null;
        document.body.classList.remove('animated-book');
        sheets.forEach(sheet => { sheet.inert = false; });
        currentVolume = -1;
      };
    });
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }

  // 静态阅读也同步目录与墨条；不依赖动画库才能浏览课程。
  let pendingScroll = false;
  function updateStatic() {
    pendingScroll = false;
    if (animated()) return;
    let index = 0;
    sheets.forEach((sheet, i) => { if (sheet.getBoundingClientRect().top < window.innerHeight * .55) index = i; });
    selectVolume(index);
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    setProgress(distance > 0 ? Math.max(0, Math.min(1, window.scrollY / distance)) : 0);
  }
  window.addEventListener('scroll', () => {
    if (!animated() && !pendingScroll) { pendingScroll = true; requestAnimationFrame(updateStatic); }
  }, { passive: true });
  reduced.addEventListener('change', () => requestAnimationFrame(updateStatic));
  if (!animated()) updateStatic();

  // 广范围、低数量的墨粒：限制像素预算，标签页隐藏时停止绘制。
  const canvas = document.querySelector('.ink-field');
  const context = canvas.getContext('2d');
  if (!context || !window.gsap) return;
  let width = 1, height = 1, last = 0;
  const pointer = { x: -10000, y: -10000 };
  const particles = Array.from({ length: 64 }, (_, index) => ({ u: index / 63, seed: Math.random() * Math.PI * 2, size: 1.4 + Math.random() * 3.8, x: 0, y: 0 }));
  function resize() {
    const box = canvas.getBoundingClientRect();
    width = box.width; height = box.height;
    const ratio = Math.min(.85, Math.sqrt(650000 / Math.max(1, width * height)));
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles.forEach(p => { p.x = width * (.1 + p.u * .84); p.y = height * (.3 + Math.sin(p.seed) * .2); });
  }
  function draw(seconds) {
    if (reduced.matches || document.hidden || document.body.classList.contains('atlas-open') || document.body.classList.contains('activity-open')) { last = 0; return; }
    if (seconds - last < .03) return;
    const dt = last ? Math.min(seconds - last, .12) : 1 / 30;
    last = seconds;
    context.clearRect(0, 0, width, height);
    for (const particle of particles) {
      let x = width * (.07 + particle.u * .86) + Math.sin(seconds * .17 + particle.seed) * width * .045;
      let y = height * (.52 + Math.sin(particle.u * Math.PI * 2.1 + flow.phase * 1.8 + seconds * .15) * .25 + Math.cos(particle.seed + seconds * .12) * .09);
      const dx = x - pointer.x, dy = y - pointer.y, distance = Math.hypot(dx, dy);
      if (distance < 145 && distance > 0) { const push = (1 - distance / 145) * 42; x += dx / distance * push; y += dy / distance * push; }
      const oldX = particle.x, oldY = particle.y, follow = 1 - Math.exp(-dt * 2.2);
      particle.x += (x - particle.x) * follow; particle.y += (y - particle.y) * follow;
      context.lineWidth = particle.size * .5; context.strokeStyle = 'rgba(45,61,48,.14)';
      context.beginPath(); context.moveTo(oldX, oldY); context.lineTo(particle.x, particle.y); context.stroke();
      context.fillStyle = 'rgba(48,63,47,.27)'; context.beginPath();
      context.ellipse(particle.x, particle.y, particle.size, particle.size * .6, particle.seed, 0, Math.PI * 2); context.fill();
    }
  }
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', event => { const box = canvas.getBoundingClientRect(); pointer.x = event.clientX - box.left; pointer.y = event.clientY - box.top; }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.x = pointer.y = -10000; });
  reduced.addEventListener('change', () => { context.clearRect(0, 0, width, height); last = 0; });
  resize();
  gsap.ticker.add(draw);
})();

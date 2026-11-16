/* 原生 Fetch 只替换个人札记；页面链接和表单仍可直接访问。 */
(() => {
  // 目录链接先级联展开所属卷、课与活动，再由原生锚点定位；不影响浏览器返回和键盘操作。
  const analysisIndex = document.querySelector('.analysis-index');
  if (analysisIndex) {
    function revealActivity(hash) {
      if (!hash || hash === '#') return;
      const target = document.getElementById(hash.slice(1));
      for (let el = target; el; el = el.parentElement) {
        if (el.tagName === 'DETAILS') el.open = true;
      }
      const focusNode = target?.closest('details.activity-analysis, details.lesson-analysis, details.volume-analysis') || target;
      const activeHash = focusNode?.id ? `#${focusNode.id}` : hash;
      for (const link of analysisIndex.querySelectorAll('nav a')) {
        if (link.hash === activeHash) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }
    analysisIndex.addEventListener('click', event => {
      const lessonLink = event.target.closest('a.index-lesson');
      if (lessonLink && lessonLink.getAttribute('href')?.startsWith('#')) {
        event.preventDefault();
        const lessonEl = document.getElementById(lessonLink.hash.slice(1));
        if (lessonEl) {
          if (lessonEl.tagName === 'DETAILS') lessonEl.open = true;
          for (const act of lessonEl.querySelectorAll('details.activity-analysis[open]')) {
            act.open = false;
          }
          lessonEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        for (const a of analysisIndex.querySelectorAll('nav a')) {
          if (a === lessonLink) a.setAttribute('aria-current', 'location');
          else a.removeAttribute('aria-current');
        }
        return;
      }
      const link = event.target.closest('a.index-activity');
      if (link) revealActivity(link.hash);
    });
    if (location.hash) revealActivity(location.hash);
  }
  for (const seg of document.querySelectorAll('.bar-seg[data-flex]')) {
    seg.style.flex = `${seg.dataset.flex} 0 0`;
  }
  // 占比从数据属性读取，避免模板表达式被编辑器当成 CSS 语法解析。
  for (const bar of document.querySelectorAll('.tree-variant-bar > [data-percent]')) {
    bar.style.width = `${bar.dataset.percent}%`;
  }
  const cellTooltip = document.getElementById('answer-cell-tooltip');
  const analysisContent = document.querySelector('.analysis-content');
  if (analysisContent) {
    analysisContent.addEventListener('click', event => {
      const refreshBtn = event.target.closest('.curation-refresh-btn');
      if (refreshBtn) {
        const section = refreshBtn.closest('.curation-section');
        if (section?.querySelector('.teacher-sample-card.is-dirty') && !window.confirm('当前有未保存的勾选或标签改动，刷新将丢失这些改动，确定继续刷新吗？')) {
          return;
        }
        refreshBtn.disabled = true;
        refreshBtn.textContent = '刷新中...';
        const url = new URL(location.href);
        const activityId = refreshBtn.dataset.refreshActivity;
        if (activityId) url.searchParams.set('open', activityId);
        const hash = refreshBtn.dataset.refreshHash || '';
        if (hash) url.hash = hash;
        const target = url.toString();
        if (target === location.href) location.reload();
        else location.href = target;
        return;
      }
      const variantTab = event.target.closest('.tree-variant-tab[data-variant-index]');
      if (variantTab) {
        const box = variantTab.closest('.teacher-tree-variants');
        const idx = variantTab.dataset.variantIndex;
        for (const tab of box.querySelectorAll('.tree-variant-tab[data-variant-index]')) {
          const active = tab === variantTab;
          tab.classList.toggle('is-active', active);
          tab.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        for (const panel of box.querySelectorAll('.tree-variant-card[data-variant-index]')) {
          panel.hidden = panel.dataset.variantIndex !== idx;
        }
        return;
      }
      const wcToggle = event.target.closest('.wordcloud-toggle');
      if (wcToggle) {
        const zone = wcToggle.closest('.question-status-zone');
        const panel = zone?.querySelector('.wordcloud-panel');
        if (!panel) return;
        const willOpen = panel.hidden;
        panel.hidden = !willOpen;
        wcToggle.classList.toggle('is-active', willOpen);
        wcToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (!willOpen) {
          for (const w of panel.querySelectorAll('.wc-word.is-active')) w.classList.remove('is-active');
          for (const cell of zone.querySelectorAll('.answer-cell')) {
            cell.classList.remove('is-wc-match', 'is-wc-dim');
          }
          const status = panel.querySelector('.wordcloud-filter-status');
          if (status) status.hidden = true;
        }
        return;
      }
      const wcWord = event.target.closest('.wc-word');
      if (wcWord) {
        const zone = wcWord.closest('.question-status-zone');
        const panel = wcWord.closest('.wordcloud-panel');
        if (!zone || !panel) return;
        const wasActive = wcWord.classList.contains('is-active');
        for (const w of panel.querySelectorAll('.wc-word.is-active')) w.classList.remove('is-active');
        const status = panel.querySelector('.wordcloud-filter-status');
        if (wasActive) {
          for (const cell of zone.querySelectorAll('.answer-cell')) {
            cell.classList.remove('is-wc-match', 'is-wc-dim');
          }
          if (status) status.hidden = true;
        } else {
          wcWord.classList.add('is-active');
          let ids = [];
          try { ids = JSON.parse(wcWord.dataset.students || '[]').map(String); } catch { ids = []; }
          const matched = new Set(ids);
          for (const cell of zone.querySelectorAll('.answer-cell')) {
            const hit = matched.has(String(cell.dataset.studentId || ''));
            cell.classList.toggle('is-wc-match', hit);
            cell.classList.toggle('is-wc-dim', !hit);
          }
          if (status) {
            status.textContent = `已高亮提及「${wcWord.dataset.word || ''}」的 ${matched.size} 位学生（再次点击该词取消筛选）`;
            status.hidden = false;
          }
        }
        return;
      }
      const btn = event.target.closest('.activity-mode-bar .mode-btn[data-activity-mode]');
      if (!btn) return;
      const activityEl = btn.closest('details.activity-analysis');
      if (!activityEl) return;
      const mode = btn.dataset.activityMode === 'correction' ? 'correction' : 'first';
      for (const sibling of btn.closest('.activity-mode-bar').querySelectorAll('.mode-btn[data-activity-mode]')) {
        const active = sibling === btn;
        sibling.classList.toggle('is-active', active);
        sibling.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
      for (const bar of activityEl.querySelectorAll('.question-progress-bar[data-kind="objective"]')) {
        bar.dataset.activeMode = mode;
        const correct = Number(mode === 'correction' ? bar.dataset.corrCorrect : bar.dataset.firstCorrect) || 0;
        const wrong = Number(mode === 'correction' ? bar.dataset.corrWrong : bar.dataset.firstWrong) || 0;
        const unanswered = Number(bar.dataset.unanswered) || 0;
        if (correct + wrong + unanswered > 0) {
          for (const [cls, count] of [['.bar-seg.is-correct', correct], ['.bar-seg.is-wrong', wrong], ['.bar-seg.is-unanswered', unanswered]]) {
            const seg = bar.querySelector(cls);
            if (!seg) continue;
            seg.hidden = count === 0;
            seg.classList.toggle('is-hidden', count === 0);
            seg.style.flex = `${count} 0 0`;
          }
        }
        const prefix = mode === 'correction' ? '自主订正情况' : '整体作答情况';
        bar.setAttribute('aria-label', `${prefix}：正确 ${correct} 人，错误 ${wrong} 人，未回答 ${unanswered} 人`);
      }
      for (const legend of activityEl.querySelectorAll('.legend-text')) {
        if (legend.dataset[mode]) legend.textContent = legend.dataset[mode];
      }
      for (const cell of activityEl.querySelectorAll('.answer-cell[data-first-state]')) {
        const nextState = mode === 'correction' ? cell.dataset.correctionState : cell.dataset.firstState;
        const nextLabel = mode === 'correction' ? cell.dataset.correctionLabel : cell.dataset.firstLabel;
        cell.classList.remove('is-correct', 'is-wrong', 'is-unanswered', 'is-pending');
        if (nextState) cell.classList.add(`is-${nextState}`);
        cell.dataset.stateLabel = nextLabel || '';
      }
    });
  }
  if (cellTooltip && analysisContent) {
    const TOOLTIP_TARGET_SELECTOR = '.answer-cell[data-student-name], .question-progress-bar';
    let activeTarget = null;
    function lineNode(label, text, cls) {
      const p = document.createElement('p');
      if (cls) p.className = cls;
      const strong = document.createElement('strong');
      strong.textContent = label;
      p.append(strong, document.createTextNode(text));
      return p;
    }
    function positionTooltip(target) {
      cellTooltip.hidden = false;
      const rect = target.getBoundingClientRect();
      const tipRect = cellTooltip.getBoundingClientRect();
      const vw = window.innerWidth || 1024;
      const left = Math.max(8, Math.min(vw - tipRect.width - 8, rect.left + rect.width / 2 - tipRect.width / 2));
      const top = rect.top - tipRect.height - 8 >= 8 ? rect.top - tipRect.height - 8 : rect.bottom + 8;
      cellTooltip.style.left = `${Math.round(left)}px`;
      cellTooltip.style.top = `${Math.round(top)}px`;
    }
    function cellBadgeState(cell) {
      for (const s of ['correct', 'pending', 'wrong', 'unanswered']) {
        if (cell.classList.contains(`is-${s}`)) return s;
      }
      return 'unanswered';
    }
    function showCellTooltip(cell) {
      const nodes = [];
      const head = document.createElement('div');
      head.className = 'tooltip-head';
      const who = document.createElement('strong');
      who.textContent = `${cell.dataset.studentName} · ${cell.dataset.className}`;
      const badge = document.createElement('span');
      badge.className = `tooltip-badge is-${cellBadgeState(cell)}`;
      badge.textContent = cell.dataset.stateLabel || '';
      head.append(who, badge);
      nodes.push(head);
      if (cell.dataset.first) {
        nodes.push(lineNode('首次回答：', cell.dataset.first));
      }
      if (cell.dataset.corrected) {
        const suffix = cell.dataset.correctionCorrect === '1' ? '（正确）' : '（仍有错误）';
        nodes.push(lineNode('订正提交：', `${cell.dataset.correction}${suffix}`, cell.dataset.correctionCorrect === '1' ? 'tooltip-right' : 'tooltip-wrong'));
      }
      if (cell.dataset.previewImages) {
        try {
          const images = JSON.parse(cell.dataset.previewImages);
          if (Array.isArray(images) && images.length > 0) {
            const box = document.createElement('div');
            box.className = 'tooltip-images';
            for (const item of images) {
              if (!item) continue;
              if (typeof item.bits === 'string' && /^[01]{216}$/.test(item.bits)) {
                const figure = document.createElement('figure');
                figure.className = 'tooltip-digit-card';
                const svgNS = 'http://www.w3.org/2000/svg';
                const svg = document.createElementNS(svgNS, 'svg');
                svg.setAttribute('viewBox', '0 0 12 18');
                svg.setAttribute('width', '40');
                svg.setAttribute('height', '60');
                svg.setAttribute('class', 'tooltip-digit-svg');
                svg.setAttribute('role', 'img');
                svg.setAttribute('aria-label', typeof item.alt === 'string' ? item.alt : '手写数字');
                const bg = document.createElementNS(svgNS, 'rect');
                bg.setAttribute('width', '12');
                bg.setAttribute('height', '18');
                bg.setAttribute('fill', '#fff');
                svg.append(bg);
                for (let i = 0; i < 216; i++) {
                  if (item.bits[i] !== '1') continue;
                  const r = document.createElementNS(svgNS, 'rect');
                  r.setAttribute('x', String(i % 12));
                  r.setAttribute('y', String(Math.floor(i / 12)));
                  r.setAttribute('width', '1');
                  r.setAttribute('height', '1');
                  r.setAttribute('fill', '#2c4a3e');
                  svg.append(r);
                }
                figure.append(svg);
                if (typeof item.caption === 'string' && item.caption) {
                  const cap = document.createElement('figcaption');
                  cap.textContent = item.caption;
                  figure.append(cap);
                }
                box.append(figure);
                continue;
              }
              if (item.kind === 'knn_capture' && item.target) {
                const figure = document.createElement('figure');
                figure.className = 'tooltip-digit-card';
                const svgNS = 'http://www.w3.org/2000/svg';
                const svg = document.createElementNS(svgNS, 'svg');
                svg.setAttribute('viewBox', '0 0 110 110');
                svg.setAttribute('width', '88');
                svg.setAttribute('height', '88');
                svg.setAttribute('role', 'img');
                svg.setAttribute('aria-label', typeof item.caption === 'string' ? item.caption : '异兽坐标模拟图');
                const mk = (tag, attrs) => {
                  const n = document.createElementNS(svgNS, tag);
                  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
                  svg.append(n);
                };
                mk('rect', { x: 5, y: 5, width: 100, height: 100, fill: '#fcfaf1', stroke: '#4f6659', 'stroke-width': 1 });
                if (item.radius > 0) {
                  mk('circle', { cx: 5 + item.target.x, cy: 105 - item.target.y, r: item.radius, fill: '#42695d16', stroke: '#42695d88', 'stroke-width': 1, 'stroke-dasharray': '3 2' });
                }
                const nbrs = new Set(Array.isArray(item.neighbor_keys) ? item.neighbor_keys : []);
                for (const p of (item.samples || [])) {
                  const isNbr = nbrs.has(`${p.x},${p.y},${p.type}`);
                  const cx = 5 + p.x, cy = 105 - p.y;
                  if (isNbr) mk('line', { x1: 5 + item.target.x, y1: 105 - item.target.y, x2: cx, y2: cy, stroke: '#4a6b56', 'stroke-width': 0.9, 'stroke-dasharray': '2 2' });
                  if (p.type === 'monkey') mk('circle', { cx, cy, r: 2.6, fill: '#d6a338', stroke: '#2f433a', 'stroke-width': 0.6, opacity: isNbr ? 1 : 0.35 });
                  else mk('rect', { x: cx - 2.4, y: cy - 2.4, width: 4.8, height: 4.8, fill: '#557b8a', stroke: '#2f433a', 'stroke-width': 0.6, opacity: isNbr ? 1 : 0.35 });
                }
                mk('circle', { cx: 5 + item.target.x, cy: 105 - item.target.y, r: 4.5, fill: '#953d2e22', stroke: '#953d2e', 'stroke-width': 1 });
                mk('circle', { cx: 5 + item.target.x, cy: 105 - item.target.y, r: 2, fill: '#953d2e' });
                figure.append(svg);
                if (typeof item.caption === 'string' && item.caption) {
                  const cap = document.createElement('figcaption');
                  cap.textContent = item.caption;
                  figure.append(cap);
                }
                box.append(figure);
                continue;
              }
              if (typeof item.src !== 'string' || !item.src.startsWith('/api/creation/media/')) continue;
              const img = document.createElement('img');
              img.className = `tooltip-thumb${item.pixelated ? ' is-pixelated' : ''}`;
              img.src = item.src;
              img.alt = typeof item.alt === 'string' ? item.alt : '学生上传作品';
              box.append(img);
            }
            if (box.childElementCount > 0) nodes.push(box);
          }
        } catch {
          // 忽略无效图片预览载荷
        }
      }
      if (cell.dataset.previewText) {
        const preview = document.createElement('p');
        preview.className = 'tooltip-preview-text';
        const rawText = cell.dataset.previewText;
        preview.textContent = rawText.length > 360 ? `${rawText.slice(0, 360)}…` : rawText;
        nodes.push(preview);
      }
      if (cell.dataset.feedback) {
        nodes.push(lineNode('教师评语：', cell.dataset.feedback));
      }
      const hint = document.createElement('small');
      hint.textContent = '点击方格查看或审核该生札记';
      nodes.push(hint);
      cellTooltip.replaceChildren(...nodes);
    }
    function showProgressTooltip(bar) {
      const nodes = [];
      const head = document.createElement('div');
      head.className = 'tooltip-head';
      const title = document.createElement('strong');
      const kind = bar.dataset.kind || 'objective';
      if (kind === 'review') {
        title.textContent = '审核进度';
        head.append(title);
        nodes.push(head);
        nodes.push(lineNode(
          '通过 / 待审 / 驳回 / 没做：',
          `${bar.dataset.correct || 0} 人 / ${bar.dataset.pending || 0} 人 / ${bar.dataset.wrong || 0} 人 / ${bar.dataset.unanswered || 0} 人`
        ));
      } else if (kind === 'record') {
        title.textContent = '记录进度';
        head.append(title);
        nodes.push(head);
        nodes.push(lineNode('已记录 / 未填写：', `${bar.dataset.correct || 0} 人 / ${bar.dataset.unanswered || 0} 人`));
      } else {
        const isCorr = bar.dataset.activeMode === 'correction';
        const correct = isCorr ? bar.dataset.corrCorrect : bar.dataset.firstCorrect;
        const wrong = isCorr ? bar.dataset.corrWrong : bar.dataset.firstWrong;
        const rate = isCorr ? bar.dataset.corrRate : bar.dataset.firstRate;
        title.textContent = isCorr ? '自主订正情况' : '首答作答情况';
        head.append(title);
        nodes.push(head);
        nodes.push(lineNode('正确 / 错误 / 未答：', `${correct || 0} 人 / ${wrong || 0} 人 / ${bar.dataset.unanswered || 0} 人`));
        if (rate !== undefined && rate !== '') {
          nodes.push(lineNode(isCorr ? '订正后正确率：' : '首答正确率：', `${rate}%`));
        }
        if (Number(bar.dataset.corrected || 0) > 0) {
          nodes.push(lineNode('订正情况：', `已订正 ${bar.dataset.corrected} 人（订正后正确 ${bar.dataset.correctionCorrect || 0} 人）`));
        }
      }
      cellTooltip.replaceChildren(...nodes);
    }
    function showTooltip(target) {
      activeTarget = target;
      if (target.classList.contains('question-progress-bar')) {
        showProgressTooltip(target);
      } else {
        showCellTooltip(target);
      }
      positionTooltip(target);
    }
    function hideCellTooltip() {
      activeTarget = null;
      cellTooltip.hidden = true;
    }
    analysisContent.addEventListener('mouseover', event => {
      const target = event.target.closest(TOOLTIP_TARGET_SELECTOR);
      if (target) showTooltip(target);
    });
    analysisContent.addEventListener('mouseout', event => {
      if (!activeTarget) return;
      const related = event.relatedTarget?.closest?.(TOOLTIP_TARGET_SELECTOR);
      if (related !== activeTarget) hideCellTooltip();
    });
    analysisContent.addEventListener('focusin', event => {
      const target = event.target.closest(TOOLTIP_TARGET_SELECTOR);
      if (target) showTooltip(target);
    });
    analysisContent.addEventListener('focusout', event => {
      if (!activeTarget) return;
      const related = event.relatedTarget?.closest?.(TOOLTIP_TARGET_SELECTOR);
      if (related !== activeTarget) hideCellTooltip();
    });
    window.addEventListener('scroll', hideCellTooltip, { passive: true });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') hideCellTooltip();
    });
  }
  const workspace = document.getElementById('student-workspace');
  if (!workspace) return;
  const message = document.getElementById('workspace-message');
  const students = [...document.querySelectorAll('.student-item')];
  let loading = null;
  let reviewing = false;

  function filterStudents() {
    const query = document.getElementById('student-search').value.trim();
    const state = document.getElementById('student-state').value;
    for (const student of students) {
      const bound = student.dataset.bound === '1';
      const matches = state === 'all' || (state === 'pending' && Number(student.dataset.pending) > 0)
        || (state === 'bound' && bound) || (state === 'free' && !bound);
      student.hidden = !student.dataset.name.includes(query) || !matches;
    }
    document.getElementById('rail-no-match').hidden = students.some(s => !s.hidden);
  }
  document.getElementById('student-search').addEventListener('input', filterStudents);
  document.getElementById('student-state').addEventListener('change', filterStudents);

  function nextPendingStudentItem() {
    const others = students.filter(s => !s.hasAttribute('aria-current') && Number(s.dataset.pending) > 0);
    if (!others.length) return null;
    const currentIndex = students.findIndex(s => s.hasAttribute('aria-current'));
    if (currentIndex >= 0) {
      const after = students.slice(currentIndex + 1).find(s => !s.hasAttribute('aria-current') && Number(s.dataset.pending) > 0);
      if (after) return after;
    }
    return others[0];
  }

  function syncNextStudentButton() {
    const btn = workspace.querySelector('[data-next-pending-student]');
    if (!btn) return;
    const nextItem = nextPendingStudentItem();
    if (nextItem) {
      btn.disabled = false;
      btn.textContent = `前往下一位待审学生（${nextItem.dataset.name}）`;
    } else {
      const anySelfPending = students.some(s => s.hasAttribute('aria-current') && Number(s.dataset.pending) > 0);
      btn.disabled = true;
      btn.textContent = anySelfPending ? '暂无其他待审学生' : '当前范围待审已全部完成';
    }
  }
  function scrollActiveRecordIntoView() {
    workspace.querySelector('.record-nav-scroll a[aria-current="page"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }
  syncNextStudentButton();
  scrollActiveRecordIntoView();

  function applyReviewResult(result, noticeText) {
    workspace.innerHTML = result.html;
    const card = students.find(s => s.dataset.studentId === String(result.student_id));
    if (card) {
      card.dataset.pending = result.pending;
      const badge = card.querySelector('.student-pending');
      const numNode = badge?.querySelector('.pending-num');
      if (numNode) numNode.textContent = result.pending;
      else if (badge) badge.textContent = `${result.pending} 待审`;
      if (badge) badge.hidden = result.pending === 0;
    }
    const total = students.reduce((n, s) => n + Number(s.dataset.pending), 0);
    const tab = document.querySelector('.console-tabs a');
    let badge = tab.querySelector('span');
    if (!badge && total) { badge = document.createElement('span'); tab.append(badge); }
    if (badge) { badge.textContent = `${total} 份待审`; badge.hidden = total === 0; }
    filterStudents();
    syncNextStudentButton();
    scrollActiveRecordIntoView();
    message.textContent = noticeText;
  }

  async function openWorkspace(link, updateHistory = true) {
    if (reviewing) return;
    const form = workspace.querySelector('[data-review-form]');
    if (form?.dataset.dirty && !window.confirm('当前评语尚未保存，确认切换吗？')) return;
    loading?.abort();
    const controller = new AbortController();
    loading = controller;
    workspace.setAttribute('aria-busy', 'true');
    message.textContent = '';
    try {
      const response = await fetch(link.dataset.workspaceUrl, { signal: controller.signal });
      if (response.redirected) { window.location.assign(response.url); return; }
      if (!response.ok) throw new Error('札记暂时无法打开，请重试。');
      const html = await response.text();
      if (controller.signal.aborted) return;
      workspace.innerHTML = html;
      const studentId = new URL(link.href, location.href).searchParams.get('student_id');
      for (const item of students) {
        if (item.dataset.studentId === studentId) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
      }
      syncNextStudentButton();
      scrollActiveRecordIntoView();
      if (updateHistory) history.pushState({}, '', link.href);
    } catch (error) {
      if (error.name !== 'AbortError') message.textContent = error.message;
    } finally {
      if (loading === controller) workspace.removeAttribute('aria-busy');
    }
  }

  async function submitQuestionReview(btn) {
    if (reviewing || workspace.getAttribute('aria-busy') === 'true') return;
    const box = btn.closest('[data-question-review]');
    const form = workspace.querySelector('[data-review-form]');
    if (!box || !form) return;
    const feedback = box.querySelector('[data-q-feedback]');
    const msg = box.querySelector('[data-q-review-msg]');
    const decision = btn.dataset.qReviewBtn;
    if (decision === 'return' && !feedback.value.trim()) {
      msg.textContent = '请填写修改建议后再驳回这道题。';
      feedback.focus();
      return;
    }
    const payload = new FormData();
    payload.set('csrf', form.querySelector('[name="csrf"]').value);
    payload.set('revision', form.querySelector('[name="revision"]').value);
    payload.set('scope_class_id', form.querySelector('[name="scope_class_id"]')?.value || '');
    payload.set('question_id', box.dataset.questionReview);
    payload.set('decision', decision);
    payload.set('feedback', feedback.value);
    reviewing = true;
    const buttons = [...workspace.querySelectorAll('button')];
    buttons.forEach(b => { b.disabled = true; });
    msg.textContent = '正在保存…';
    try {
      const response = await fetch(box.dataset.qReviewUrl, { method: 'POST', body: payload, headers: { Accept: 'application/json' } });
      if (response.redirected) { window.location.assign(response.url); return; }
      const result = await response.json().catch(() => ({ error: '页面验证已失效，请刷新页面后重试。' }));
      if (!response.ok) throw new Error(result.error || '批阅未保存，请重试。');
      delete form.dataset.dirty;
      applyReviewResult(result, result.settled ? '全部待审题已批完，本份札记已结算。' : '该题批阅已保存。');
    } catch (error) {
      msg.textContent = error.message;
      buttons.forEach(b => { b.disabled = false; });
    } finally {
      reviewing = false;
    }
  }

  async function toggleExcellent(btn) {
    if (reviewing || workspace.getAttribute('aria-busy') === 'true') return;
    const payload = new FormData();
    payload.set('csrf', btn.dataset.csrf);
    payload.set('revision', btn.dataset.revision);
    payload.set('excellent', btn.dataset.nextExcellent);
    payload.set('scope_class_id', btn.dataset.scopeClassId || '');
    reviewing = true;
    btn.disabled = true;
    message.textContent = '正在更新优秀评定…';
    try {
      const response = await fetch(btn.dataset.excellentUrl, { method: 'POST', body: payload, headers: { Accept: 'application/json' } });
      if (response.redirected) { window.location.assign(response.url); return; }
      const result = await response.json().catch(() => ({ error: '页面验证已失效，请刷新页面后重试。' }));
      if (!response.ok) throw new Error(result.error || '更新失败，请重试。');
      applyReviewResult(result, '优秀评定已更新。');
    } catch (error) {
      message.textContent = error.message;
      btn.disabled = false;
    } finally {
      reviewing = false;
    }
  }

  document.addEventListener('click', event => {
    const qBtn = event.target.closest('[data-q-review-btn]');
    if (qBtn) { submitQuestionReview(qBtn); return; }
    const exBtn = event.target.closest('[data-excellent-toggle]');
    if (exBtn) { toggleExcellent(exBtn); return; }
    const nextBtn = event.target.closest('[data-next-pending-student]');
    if (nextBtn) {
      const nextItem = nextPendingStudentItem();
      if (nextItem) {
        openWorkspace(nextItem);
        nextItem.scrollIntoView?.({ block: 'nearest' });
      }
      return;
    }
    const link = event.target.closest('a[data-workspace-url]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    openWorkspace(link);
  });
  window.addEventListener('popstate', () => location.reload());
  workspace.addEventListener('input', event => {
    const form = event.target.closest('[data-review-form]');
    if (form) form.dataset.dirty = 'true';
  });
  window.addEventListener('beforeunload', event => {
    if (workspace.querySelector('[data-dirty]') && !reviewing) { event.preventDefault(); event.returnValue = ''; }
  });
  workspace.addEventListener('submit', async event => {
    const form = event.target.closest('[data-review-form]');
    if (!form) return;
    event.preventDefault();
    if (reviewing) return;
    if (workspace.getAttribute('aria-busy') === 'true') return;
    const data = new FormData(form);
    data.set('decision', event.submitter.value);
    const status = form.querySelector('[data-review-message]');
    if (event.submitter.value === 'return' && (!data.get('feedback').trim() || !data.getAll('returned_questions').length)) {
      status.textContent = '请勾选需要修改的文字题，并填写修改建议。';
      return;
    }
    reviewing = true;
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = '正在保存评阅…';
    try {
      const response = await fetch(form.action, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
      if (response.redirected) { window.location.assign(response.url); return; }
      const result = await response.json().catch(() => ({ error: '页面验证已失效，请刷新页面后重试。' }));
      if (!response.ok) throw new Error(result.error || '评阅未保存，请重试。');
      delete form.dataset.dirty;
      // 保存后以服务器返回的札记和待审数刷新列表，避免前端自行推算成绩。
      applyReviewResult(result, '评阅已保存。');
    } catch (error) {
      status.textContent = error.message;
      buttons.forEach(button => { button.disabled = false; });
    } finally {
      reviewing = false;
    }
  });
  // 只在学生列表内支持方向键，避免干扰评语输入和其他操作。
  document.getElementById('student-list').addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const visible = students.filter(s => !s.hidden);
    const index = visible.indexOf(document.activeElement);
    const next = visible[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) { event.preventDefault(); next.focus(); next.click(); }
  });
})();

/* 学习札记只负责展示和收集输入；成绩、锁定和圈色均使用后端结果。 */
import { setupReadingPane } from '../atlas/reading.js';
import { setupExperimentTable, supportsExperimentTable } from './worksheet-exp-table.js';
import { createRecordTable } from './worksheet-record-table.js';
import { createSampleUpload } from './worksheet-samples.js';
import { createCreationForm } from './creation/record-form.js';
import { setupPixelCodeNote } from './image-code/note.js';
import { createTreeNote, createVoteTable, createKnnCapturesNote } from './classification/view.js';

const assets = new URL('.', import.meta.url);

export function setupWorksheet(activityDialog) {
  const locksEnabled = document.querySelector('meta[name="progress-locks-enabled"]')?.content !== 'false';
  const entry = activityDialog.querySelector('#open-learning-note');
  const resetButton = activityDialog.querySelector('#reset-learning-activity');
  const paper = activityDialog.querySelector('#learning-note');
  const form = paper.querySelector('#note-form');
  const message = paper.querySelector('.note-message');
  const stateLine = paper.querySelector('.note-state');
  const saveButton = paper.querySelector('[data-note-action="save"]');
  const submitButton = paper.querySelector('[data-note-action="submit"]');
  const reloadButton = paper.querySelector('[data-note-action="reload"]');
  const nextButton = paper.querySelector('[data-note-action="next"]');
  const sectionsNav = paper.querySelector('.note-sections');
  const progressBar = paper.querySelector('.note-progress');
  const reader = setupReadingPane(paper.querySelector('.note-body'));
  let answerReaders = [];
  const drafts = new Map();
  const states = new Map();
  let active;
  let current;
  let busy = false;
  let loading = false;
  let requestVersion = 0;
  let controller;
  let selectedId;
  let renderedActivity;
  let renderedSection;
  let collection = null;
  let collectionFeedback = '';
  const contextGetters = new Map();
  let autosaveTimer;
  let autosaving = null;

  function scheduleAutosave(delay = 1000) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { void autosave(); }, delay);
  }

  async function autosave() {
    if (autosaving) return autosaving;
    if (busy || loading || form.querySelector('[data-uploading="true"]')) {
      scheduleAutosave(); return;
    }
    collect();
    // 所有活动共用一条保存队列，避免同一份札记的 revision 发生竞争。
    let changedWhileSaving = false;
    autosaving = (async () => {
      for (const [id, draft] of drafts) {
        if (!draft.dirty || draft.autosaveBlocked || ['lesson-1-task-2', 'lesson-1-task-3'].includes(id)) continue;
        for (const sectionId of [...draft.dirtySections]) {
          const section = draft.data.sections.find(s => s.id === sectionId);
          if (!section?.can_edit) continue;
          const answers = Object.fromEntries(section.questions.map(q => [q.id, draft.answers[q.id] ?? (q.type === 'multiple' ? [] : '')]));
          const signature = JSON.stringify(answers);
          if (current === draft) tell('正在自动保存…');
          try {
            const data = await request(`/api/worksheets/${id}/save`, {
              method: 'POST', keepalive: true,
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content },
              body: JSON.stringify({ revision: draft.data.revision, section_id: sectionId, answers, context: draft.contexts?.[sectionId] }),
            });
            // 请求期间允许继续输入；新内容仍留在草稿，下次接着保存。
            if (current === draft) collect();
            draft.data = data;
            const latest = Object.fromEntries(section.questions.map(q => [q.id, draft.answers[q.id] ?? (q.type === 'multiple' ? [] : '')]));
            if (JSON.stringify(latest) === signature) draft.dirtySections.delete(sectionId);
            draft.dirty = Boolean(draft.dirtySections.size);
            if (draft.dirtySections.has(sectionId)) changedWhileSaving = true;
            if (current === draft) tell(draft.dirty ? '有新修改，稍后自动保存。' : '已自动保存');
          } catch (error) {
            // 版本冲突必须由学生选择重新读取，不能重试覆盖其他页面的更新。
            draft.autosaveBlocked = error.code === 409;
            if (current === draft) {
              tell(`自动保存失败：${error.message}`, true);
              if (draft.autosaveBlocked) reloadButton.hidden = false;
            }
            break;
          }
        }
      }
    })();
    try { await autosaving; } finally {
      autosaving = null;
      if (changedWhileSaving) scheduleAutosave();
    }
  }

  function restoreWorksheetView() {
    collection = null;
    collectionFeedback = '';
    paper.classList.remove('is-collection-note', 'is-creation-note');
    entry.querySelector('.status-ring').classList.remove('resource-ring');
  }

  function updateCollectionStatus(feedbackText = collectionFeedback) {
    if (!collection || !active) return;
    collectionFeedback = feedbackText || '';
    const state = states.get(active.id) || active;
    stateLine.textContent = state.excellent
      ? '优秀 · 仍可随时补充整理'
      : state.completed
        ? '已通过 · 仍可随时补充整理'
        : state.status === 'pending'
          ? '待教师查看 · 可随时修改'
          : '记下一条收藏即可送交查看';
    tell(collectionFeedback ? `教师反馈：${collectionFeedback}` : '收藏本与学习札记实时同步，可随时修改。');
  }

  function selectedSection() {
    return current?.data.sections.find(section => section.id === selectedId);
  }

  function isPixelSubmission() {
    return active?.id === 'lesson-1-task-3' || (active?.id === 'lesson-1-task-2' && current?.data.version >= 2);
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function tell(text, error = false) {
    message.textContent = text;
    message.classList.toggle('error', error);
  }

  function publish(items) {
    items.forEach(item => states.set(item.activity_id, item));
    document.dispatchEvent(new CustomEvent('learning:progress', { detail: items }));
    updateRing();
  }

  function updateRing() {
    if (!active) return;
    const state = states.get(active.id) || active;
    const ring = entry.querySelector('.status-ring');
    ring.classList.toggle('done', Boolean(state.completed));
    ring.classList.toggle('gold', Boolean(state.excellent));
    ring.querySelector('.note-entry-ring').src = new URL(`ink-circle-${state.completed ? 'green' : 'red'}.png`, assets).href;
    entry.setAttribute('aria-label', `打开学习札记，${state.label || '未填写'}`);
    entry.title = `学习札记 · ${state.label || '未填写'}`;
    updateReset();
  }

  function updateReset() {
    const completed = Boolean((states.get(active?.id) || current?.data.progress || active)?.completed);
    const available = !locksEnabled || completed || controller?.resetAnytime === true;
    resetButton.hidden = !active?.worksheet_available || typeof controller?.reset !== 'function';
    resetButton.disabled = busy || loading || !available;
    resetButton.title = available ? (isPixelSubmission() ? '整体重置画布和调色，恢复原始小熊猫；保留已提交作品' : '从头体验当前活动，保留札记、成绩与完成情况；所有步骤保持开放') : '完成活动后可重置体验，保留札记与完成情况';
  }

  function buttons() {
    updateReset();
    const section = selectedSection();
    const editable = Boolean(section?.can_edit);
    const pixelSubmission = isPixelSubmission();
    saveButton.disabled = busy || loading || !editable;
    submitButton.disabled = busy || loading || !editable;
    const status = section?.status;
    submitButton.textContent = busy ? '保存中…' : status === 'correction' ? '提交本段订正' : status === 'returned' ? '重新提交本段' : '提交本段';
    if(pixelSubmission)submitButton.textContent = busy ? '正在提交…' : status === 'returned' ? '重新提交作品' : '提交作品';
    saveButton.hidden = !editable || pixelSubmission;
    submitButton.hidden = !editable;
    const next = current?.data.sections.find(s => s.step === section?.step + 1 && s.unlocked);
    nextButton.hidden = (locksEnabled && !section?.submitted) || !next;
    nextButton.disabled = busy || loading;
    reloadButton.hidden = true;
  }

  function collect() {
    if (!current || renderedActivity !== active?.id) return;
    const answers = { ...current.answers };
    const section = current.data.sections.find(s => s.id === renderedSection);
    section?.questions.forEach(q => {
      if (!q.editable) return;
      const inputs = [...form.querySelectorAll('input,textarea')].filter(input => input.name === q.id);
      if (!inputs.length) return;
      if (q.type === 'multiple') answers[q.id] = inputs.filter(input => input.checked).map(input => input.value);
      else if (q.type === 'single') answers[q.id] = inputs.find(input => input.checked)?.value || '';
      else answers[q.id] = inputs[0]?.value || '';
    });
    current.answers = answers;
    if (section) {
      const contextQuestion = section.questions.find(q => contextGetters.has(q.id));
      const context = section.questions.some(q => q.pixel_code) ? controller?.worksheetContext?.(section.step)
        : contextQuestion ? contextGetters.get(contextQuestion.id)() : undefined;
      current.contexts ||= {};
      current.contexts[section.id] = context;
    }
  }

  function readableAnswer(q) {
    if (q.type === 'single') return q.options.find(option => option.value === q.answer)?.label || q.answer;
    if (q.type === 'multiple') return q.options.filter(option => q.answer.includes(option.value)).map(option => option.label).join('；');
    return String(q.answer);
  }

  function renderQuestion(q, number) {
    const field = node('fieldset', 'note-question');
    field.dataset.questionId = q.id;
    field.disabled = !q.editable || busy;
    const prompt = q.record_table?.kind === 'handwriting_results' ? '选择3条手写尝试，核对预测结果，并填写自己实际写的数字。' : q.prompt;
    const legend = node('legend', '', `${number}. ${prompt}`);
    if (!q.required) legend.append(node('span', 'note-optional', '（选填）'));
    field.append(legend);
    const answer = current.answers[q.id];
    if (q.type === 'single' || q.type === 'multiple') {
      q.options.forEach(option => {
        const label = node('label', 'note-option');
        const input = node('input');
        input.type = q.type === 'single' ? 'radio' : 'checkbox';
        input.name = q.id;
        input.value = option.value;
        input.checked = q.type === 'single' ? answer === option.value : Array.isArray(answer) && answer.includes(option.value);
        label.append(input, node('span', '', option.label));
        field.append(label);
      });
    } else {
      const input = node(q.type === 'text' ? 'textarea' : 'input');
      input.name = q.id;
      input.id = `note-answer-${q.id}`;
      input.setAttribute('aria-label', q.prompt);
      if (q.type === 'text') { input.rows = active.id === 'lesson-2-task-1' ? 1 : 4; input.maxLength = q.max_length || 1200; }
      else { input.type = 'number'; input.step = 'any'; input.inputMode = 'decimal'; }
      input.value = answer ?? '';
      if (q.type === 'text' && !q.record_table && !q.record_form && !q.decision_tree) {
        // 复用项目的墨痕滚动条；原生 textarea 继续负责输入、滚动和拉高。
        const shell = node('div', 'note-answer-scroll');
        input.classList.add('reading');
        const scrollbar = node('div', 'ink-scrollbar');
        scrollbar.hidden = true;
        const track = node('div', 'ink-track');
        // 使用可聚焦的滚动控件，已提交的禁用题组仍可拖动回看长回答。
        const thumb = node('div', 'ink-thumb');
        thumb.tabIndex = 0;
        thumb.setAttribute('role', 'scrollbar');
        thumb.setAttribute('aria-label', `${q.prompt}，回答滚动位置`);
        thumb.setAttribute('aria-controls', input.id);
        thumb.setAttribute('aria-orientation', 'vertical');
        thumb.setAttribute('aria-valuemin', '0');
        thumb.setAttribute('aria-valuemax', '100');
        thumb.setAttribute('aria-valuenow', '0');
        track.append(thumb); scrollbar.append(track); shell.append(input, scrollbar);
        if (supportsExperimentTable(q)) setupExperimentTable(field, input, q, shell);
        else field.append(shell);
        answerReaders.push(setupReadingPane(shell));
      } else field.append(input);
      if (q.pixel_code) answerReaders.push(setupPixelCodeNote(field,input,q,controller));
      if(q.decision_tree){input.hidden=true;input.classList.add('note-record-answer');field.append(createTreeNote(q,input,controller));}
      if(q.knn_captures){input.hidden=true;input.classList.add('note-record-answer');field.append(createKnnCapturesNote(q,input,controller));}
      if(q.record_form){input.hidden=true;input.classList.add('note-record-answer');field.append(createCreationForm(q,input,active.id,controller,()=>current.answers));}
      if (q.record_table) {
        input.hidden = true;
        input.classList.add('note-record-answer');
        field.append(q.record_table.kind === 'knn_votes' ? createVoteTable(q,input) : createRecordTable(q, input, {
          getHandwritingAttempts: () => controller?.handwritingAttempts?.() || [],
          getCurrentRGB: () => controller?.currentRGB?.(),
          getBaselineDigits: () => controller?.baselineDigits?.() || [],
          getBaselineRecord: () => current?.answers?.['ten-baseline'] || controller?.experimentAnswers?.(0)?.['ten-baseline'] || '',
          setContextGetter: getter => contextGetters.set(q.id, getter),
        }));
      }
      if (q.experiment_record && controller?.experimentAnswers) {
        const importButton = node('button', 'note-import', '带入本段实验记录');
        importButton.type = 'button';
        importButton.addEventListener('click', () => {
          const value = controller.experimentAnswers(selectedSection().step)[q.id];
          if (!value) { tell('先完成本段实验中的记录，再带入札记。'); return; }
          // 不覆盖学生已经整理的文字；主动带入后按普通草稿自动保存，提交仍由学生确认。
          if (input.value.trim()) { tell('此处已有记录。需要更新时，请先复制保留或清空原文。'); return; }
          if (value.length > input.maxLength) { tell('实验记录较多，请选择关键结果手动整理到札记。'); return; }
          input.value = value; input.dispatchEvent(new Event('input', {bubbles:true}));
          tell('记录已带入，将自动保存草稿；请核对并补充自己的发现后提交。');
        });
        field.append(importButton);
      }
    }
    // 批改信息不能放在 disabled fieldset 内，以保留文本选择和辅助阅读能力。
    const wrap = node('div', 'note-question-wrap');
    wrap.append(field);
    if (q.result) {
      const result = q.result;
      const text = result.correct ? (result.attempts === 2 ? '订正正确' : '回答正确')
        : result.attempts === 1 ? '这题还需想一想，请订正后再提交。' : `订正后仍有误。正确答案：${readableAnswer(q)}`;
      const feedback = node('p', `note-result${result.correct ? '' : ' wrong'}`, text);
      wrap.append(feedback);
      if (q.explanation) wrap.append(node('p', 'note-explanation', `解析：${q.explanation}`));
    }
    if (q.review) {
      const returned = q.review.status === 'returned';
      const label = returned ? '教师批阅：需修改' : '教师批阅：已通过';
      const detail = q.review.feedback ? `${label} —— ${q.review.feedback}` : label;
      wrap.append(node('p', `note-result${returned ? ' wrong' : ''}`, detail));
    }
    return wrap;
  }

  function selectSection(id, navigate = true) {
    if (selectedId !== id && form.querySelector('[data-uploading="true"]')) {
      tell('图片正在上传，请完成后再切换标签。');
      return;
    }
    const section = current?.data.sections.find(s => s.id === id) || active?.flow?.sections.find(s => s.id === id);
    if (!section?.unlocked) return;
    if (selectedId !== id) {
      collect(); selectedId = id;
      if (current) {
        render(true);
        const selected = selectedSection();
        const message = current.dirtySections.has(id) ? '本段有尚未保存的修改。'
          : !selected.submitted ? '填写后自动保存草稿，完成后请主动提交。'
          : selected.status === 'correction' ? '本段已提交，错题可以现在订正，也可以稍后回来。'
          : selected.status === 'pending' ? '本段已提交，等待教师审核；后续步骤不受影响。'
          : selected.status === 'returned' ? '请按教师反馈修改本段，其他已开放步骤不受影响。'
          : '本段已提交，可回看记录与解析。';
        tell(message);
      }
    }
    if (navigate) controller?.goToStep?.(section.step);
  }

  function applyGate(flow) {
    if (!locksEnabled) { controller?.setGate?.(null); return; }
    if (active?.worksheet_available && flow) {
      const completed = current?.data.progress.completed || states.get(active.id)?.completed || active.completed;
      controller?.setGate?.(completed ? null : flow.sections.filter(s => s.unlocked).map(s => s.step));
    }
  }

  function renderNavigation(data) {
    const flow = data.flow;
    progressBar.setAttribute('aria-valuenow', flow.percent);
    progressBar.setAttribute('aria-valuetext', `必做札记已提交 ${flow.submitted} 段，共 ${flow.total} 段`);
    // 每个分段对应一格，选做也展示提交状态；必做百分比仍由服务器统计。
    progressBar.replaceChildren(...data.sections.map(section => {
      const segment = node('span', section.submitted ? 'is-submitted' : '');
      segment.setAttribute('aria-hidden', 'true');
      return segment;
    }));
    sectionsNav.replaceChildren(...data.sections.map(section => {
      const button = node('button', `${section.id === selectedId ? 'is-current ' : ''}${section.submitted ? 'is-submitted ' : ''}${section.optional ? 'is-optional' : ''}`);
      button.type = 'button';
      button.disabled = !section.unlocked || busy;
      button.dataset.noteSection = section.id;
      button.setAttribute('aria-current', section.id === selectedId ? 'step' : 'false');
      const label = String(active.id==='lesson-3-task-2'&&section.step===1?3:section.step+1).padStart(2,'0');
      const state = !section.unlocked ? '未解锁' : section.status === 'correction' ? '已提交·待订正'
        : section.status === 'returned' ? '已提交·需修改' : section.submitted ? '已提交' : '待填写';
      // 导航只显示数字；完整名称、选做属性和状态保留在悬停及辅助阅读信息中。
      const description = `子活动 ${label} · ${section.title}${section.optional ? '（选做，不计进度）' : ''} · ${state}`;
      const recognition = active.id === 'lesson-8-task-1';
      const original = active.id === 'lesson-8-task-2' && data.version >= 2;
      button.append(node('span', recognition || original ? 'note-section-name' : 'note-section-number', recognition ? `图 ${section.step + 1}` : original ? section.title : label));
      button.setAttribute('aria-label', description);
      button.title = description;
      return button;
    }));
  }

  function render(reset = false) {
    answerReaders.forEach(reader => reader.destroy());
    answerReaders = [];
    contextGetters.clear();
    const data = current.data;
    const pixelSubmission = isPixelSubmission();
    paper.querySelector('#note-title').textContent = data.title;
    stateLine.textContent = data.progress.label;
    if (!data.sections.some(s => s.id === selectedId && s.unlocked)) selectedId = data.sections.find(s => s.unlocked)?.id;
    renderNavigation(data);
    sectionsNav.hidden = pixelSubmission;
    const content = [];
    if (data.feedback) content.push(node('p', 'note-feedback', `教师反馈：${data.feedback}`));
    const section = selectedSection();
    if (section) {
      const displayStep=active.id==='lesson-3-task-2'&&section.step===1?3:section.step+1;
      const sectionTitle = ['lesson-8-task-1','lesson-8-task-2'].includes(active.id) ? section.title : `${section.optional ? '选做' : `子活动 0${displayStep}`} · ${section.title}`;
      if(!pixelSubmission)content.push(node('h4', 'note-section-title', sectionTitle));
      const hasNext = data.sections.some(item=>item.step>section.step);
      const hint = !section.submitted ? (locksEnabled ? (hasNext ? '完成本段必填题后提交，即可解锁下一步。' : '完成本段后可暂存或提交。') : '可自由切换活动；札记可暂存或提交。')
        : section.status === 'correction' ? '本段已提交，下一步已开放；这道错题可以现在订正，也可以稍后回来。'
        : section.status === 'pending' ? '本段已提交，等待教师审核；可以继续后面的实验。'
        : section.status === 'returned' ? '教师已驳回部分记录，请按反馈修改；已解锁的步骤继续开放。' : '本段已提交，可回看记录与解析。';
      if(!pixelSubmission)content.push(node('p', 'note-intro', section.optional ? '自主探索记录，不计入必做进度。' : hint));
      if(section.sample_upload)content.push(createSampleUpload(()=>controller?.ownTrainingSamples?.()||[]));
      section.questions.forEach((q, index) => content.push(renderQuestion(q, index + 1)));
    }
    form.replaceChildren(...content);
    renderedActivity = active.id;
    renderedSection = selectedId;
    buttons();
    if (reset) reader.reset(); else reader.update();
  }

  async function request(path, options = {}) {
    let response;
    try { response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options }); }
    catch { throw new Error('未能连接服务器，输入仍保留，请稍后重试暂存。'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || '未能保存，请稍后重试。');
      error.code = response.status;
      throw error;
    }
    return data;
  }

  async function load(discard = false, reset = false) {
    if (autosaving) await autosaving;
    if (!active || !active.worksheet_available || busy || loading) return;
    const id = active.id;
    const version = ++requestVersion;
    loading = true;
    buttons();
    if (!current) { form.replaceChildren(); stateLine.textContent = '正在展开札记…'; }
    tell('正在读取…');
    try {
      const data = await request(`/api/worksheets/${id}`);
      if (version !== requestVersion || active?.id !== id) return;
      const cached = drafts.get(id);
      if (cached?.dirty && !discard && cached.data.revision === data.revision
          && cached.data.version === data.version && renderedActivity === id && renderedSection === selectedId) {
        // 打开札记的后台读取不能重建正在输入或上传的表单，避免丢失文件选择。
        current = cached;
        loading = false;
        buttons();
        tell('有尚未暂存的修改。');
        return;
      }
      if (cached?.dirty && !discard && cached.data.revision !== data.revision) {
        current = cached;
        render(reset);
        tell('服务器上已有更新，当前输入仍保留。请先复制需要的内容，再点“重新读取”。', true);
        reloadButton.hidden = false;
        return;
      }
      current = cached?.dirty && !discard ? cached : { data, answers: { ...data.answers }, dirty: false, dirtySections: new Set() };
      drafts.set(id, current);
      loading = false;
      render(reset);
      applyGate(data.flow);
      publish([data.progress]);
      tell(isPixelSubmission()
        ? (data.can_edit ? '确认作品后，点击“提交作品”。' : '作品已提交，可查看作品与反馈。')
        : current.dirty ? '有尚未保存的修改。' : data.can_edit ? '填写后自动保存草稿，完成后请主动提交。' : '札记已锁定，可查看作答与反馈。');
    } catch (error) {
      if (version !== requestVersion) return;
      tell(error.message, true);
      reloadButton.hidden = false;
    } finally {
      if (version === requestVersion) {
        loading = false;
        updateReset();
        saveButton.disabled = busy || !selectedSection()?.can_edit;
        submitButton.disabled = busy || !selectedSection()?.can_edit;
      }
    }
  }

  async function write(action) {
    clearTimeout(autosaveTimer);
    if (autosaving) await autosaving;
    if (busy || loading || !selectedSection()?.can_edit) return;
    if(form.querySelector('[data-uploading="true"]')){tell('图片仍在上传，请完成后再保存。');return;}
    collect();
    const id = active.id;
    const savedCurrent = current;
    const section = selectedSection();
    const sectionId = section.id;
    const answers = Object.fromEntries(section.questions.map(q => [q.id, current.answers[q.id] ?? (q.type === 'multiple' ? [] : '')]));
    const pixelForm = form.querySelector('.pixel-work-form');
    busy = true;
    buttons();
    form.querySelectorAll('fieldset').forEach(field => { field.disabled = true; });
    tell(action === 'save' ? '正在暂存…' : '正在提交…');
    try {
      if(action==='submit')form.querySelector('.training-evidence')?.prepareSubmission?.();
      if(action === 'submit' && pixelForm?.prepareSubmission) {
        Object.assign(answers,await pixelForm.prepareSubmission());
        Object.assign(savedCurrent.answers,answers);
      }
      const contextQuestion = section.questions.find(q => contextGetters.has(q.id));
      const context = section.questions.some(q => q.pixel_code)
        ? controller?.worksheetContext?.(section.step)
        : contextQuestion ? contextGetters.get(contextQuestion.id)() : undefined;
      const data = await request(`/api/worksheets/${id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content },
        body: JSON.stringify({ revision: savedCurrent.data.revision, section_id: sectionId, answers, context }),
      });
      const dirtySections = new Set(savedCurrent.dirtySections);
      dirtySections.delete(sectionId);
      const preserved = {};
      savedCurrent.data.sections.filter(s => dirtySections.has(s.id)).forEach(s => s.questions.forEach(q => {
        if (q.id in savedCurrent.answers) preserved[q.id] = savedCurrent.answers[q.id];
      }));
      const updated = { data, answers: { ...data.answers, ...preserved }, dirty: Boolean(dirtySections.size), dirtySections, contexts: savedCurrent.contexts };
      drafts.set(id, updated);
      if (updated.dirty) scheduleAutosave();
      busy = false;
      publish([data.progress]);
      if (active?.id === id) {
        current = updated;
        render();
        applyGate(data.flow);
        const submitted = data.sections.find(s => s.id === sectionId);
        tell(action === 'save' ? '本段已暂存，可下次继续。' : submitted.status === 'correction'
          ? '本段已提交，下一步已解锁；错题可稍后订正。'
          : submitted.status === 'pending' ? '本段已提交，等待教师审核；不影响继续探索。'
          : '本段已提交。已开放的步骤可以随时回看。');
      }
    } catch (error) {
      busy = false;
      if (active?.id === id) {
        render();
        tell(error.message, true);
        if (error.code === 409) reloadButton.hidden = false;
      }
    } finally {
      busy = false;
      updateReset();
      // 提交期间学生可能切换了活动，新纸页需在旧请求结束后重新读取。
      if (active?.id !== id && !paper.hidden) load(false, true);
    }
  }

  function close(focus = true) {
    collect();
    scheduleAutosave(0);
    if (paper.matches(':popover-open')) paper.hidePopover();
    paper.hidden = true;
    entry.setAttribute('aria-expanded', 'false');
    if (focus && !entry.hidden) entry.focus({ preventScroll: true });
  }

  resetButton.addEventListener('click', () => {
    if (resetButton.disabled || typeof controller?.reset !== 'function') return;
    // 实验进度与学习记录分开：不发送写入请求，也不清除札记草稿或首次成绩。
    close(false);
    controller.setGate?.(null);
    Promise.resolve(controller.reset()).catch(error=>tell(error.message,true));
  });

  entry.addEventListener('click', () => {
    if (!paper.hidden) { close(); return; }
    paper.hidden = false;
    // 保留在模态活动内部的归属，以独立顶层浮层越过活动纸页边界。
    paper.showPopover();
    const activityBounds = activityDialog.getBoundingClientRect();
    const noteBounds = paper.getBoundingClientRect();
    position(paper.style.left ? noteBounds.left : activityBounds.right - paper.offsetWidth - 22,
      paper.style.left ? noteBounds.top : activityBounds.top + 76);
    entry.setAttribute('aria-expanded', 'true');
    if (collection) {
      const notebook = collection;
      const openedId = active?.id;
      notebook.mount(form);
      Promise.all([
        notebook.refresh(),
        openedId ? request(`/api/worksheets/${encodeURIComponent(openedId)}`).catch(() => null) : null,
      ])
        .then(([, ws]) => {
          if (collection !== notebook) return;
          if (ws?.progress) {
            publish([ws.progress]);
            updateCollectionStatus(ws.feedback || '');
          }
          reader.update();
        })
        .catch(error => { if (collection === notebook) tell(error.message, true); });
      paper.querySelector('.note-drag').focus({ preventScroll: true });
      reader.reset();
      return;
    }
    if (current) render();
    load(false, !current);
    paper.querySelector('.note-drag').focus({ preventScroll: true });
    reader.update();
  });
  paper.querySelector('.note-close').addEventListener('click', () => close());
  activityDialog.addEventListener('cancel', event => {
    if (!paper.hidden) { event.preventDefault(); close(); }
  });
  form.addEventListener('input', () => {
    if (!current || !selectedSection()?.can_edit) return;
    collect(); current.dirty = true; current.dirtySections.add(selectedId); tell('尚未保存，稍后自动保存。');
    if (current.autosaveBlocked) tell('服务器上已有更新，当前输入仍保留。请先复制需要的内容，再点“重新读取”。', true);
    scheduleAutosave();
  });
  form.addEventListener('submit', event => { event.preventDefault(); write('submit'); });
  saveButton.addEventListener('click', () => write('save'));
  reloadButton.addEventListener('click', () => load(true));
  nextButton.addEventListener('click', () => {
    const section = selectedSection();
    const next = current?.data.sections.find(s => s.step === section?.step + 1 && s.unlocked);
    if (next) selectSection(next.id);
  });
  sectionsNav.addEventListener('click', event => {
    const button = event.target.closest('[data-note-section]');
    if (button && !button.disabled) selectSection(button.dataset.noteSection);
  });
  activityDialog.addEventListener('worksheet:open', event => {
    const step = event.detail.step;
    const section = current?.data.sections.find(s => s.step === step);
    if (section) selectSection(section.id, false);
    if (paper.hidden) entry.click();
    else tell(isPixelSubmission()
      ? '确认作品后，点击“提交作品”。'
      : locksEnabled ? '先提交本段札记，即可解锁下一步。' : '可自由切换活动；札记可暂存或提交。');
  });
  window.addEventListener('beforeunload', event => {
    void autosave();
    if ([...drafts.values()].some(draft => draft.dirty)) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('online', () => scheduleAutosave(0));
  document.addEventListener('visibilitychange', () => { if (document.hidden) void autosave(); });

  // 以整个可视网页为边界，始终让纸页和关闭入口留在屏幕内。
  const handle = paper.querySelector('.note-drag');
  let drag;
  function position(left, top) {
    const maxLeft = Math.max(8, document.documentElement.clientWidth - paper.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - paper.offsetHeight - 8);
    paper.style.right = 'auto';
    paper.style.left = `${Math.max(8, Math.min(maxLeft, left))}px`;
    paper.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
    const bounds = paper.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
  });
  handle.addEventListener('pointermove', event => {
    if (drag) position(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, () => { drag = null; });
  handle.addEventListener('keydown', event => {
    const move = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
    if (!move) return;
    const bounds = paper.getBoundingClientRect();
    event.preventDefault(); position(bounds.left + move[0], bounds.top + move[1]);
  });
  function keepNoteVisible() {
    if (paper.hidden) return;
    const bounds = paper.getBoundingClientRect();
    position(bounds.left, bounds.top);
  }
  window.addEventListener('resize', keepNoteVisible);
  // 切到较宽的表格分段时也重新限制边界，避免右侧超出屏幕。
  new ResizeObserver(keepNoteVisible).observe(paper);

  async function refreshProgress() {
    if (document.hidden || busy || !document.querySelector('meta[name="csrf-token"]')?.content) return;
    try {
      const data = await request('/api/learning/progress');
      publish(data.activities);
      if (collection) updateCollectionStatus(collectionFeedback);
      const latest = data.activities.find(item => item.activity_id === active?.id);
      if (!loading && current && !current.dirty && latest && latest.revision !== current.data.revision) load();
    } catch { /* 轮询失败不覆盖学生输入；显式暂存、提交时再提示连接问题。 */ }
  }
  setInterval(refreshProgress, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshProgress(); });
  document.addEventListener('creation:favorites-changed', refreshProgress);
  window.addEventListener('focus', refreshProgress);

  return {
    deactivate(){close(false);++requestVersion;active=null;current=null;controller=null;entry.hidden=true;resetButton.hidden=true;restoreWorksheetView();},
    activateCollection(activity, notebook) {
      close(false);
      ++requestVersion;
      active = activity;
      current = null;
      controller = null;
      loading = false;
      collection = notebook;
      collectionFeedback = '';
      paper.classList.remove('is-digits-note', 'is-recognition-note', 'is-creation-note', 'is-animal-note');
      paper.classList.add('is-collection-note');
      paper.querySelector('#note-title').textContent = '我的提示词收藏本';
      entry.hidden = false;
      entry.querySelector('.status-ring').classList.remove('resource-ring');
      resetButton.hidden = true;
      paper.style.removeProperty('left'); paper.style.removeProperty('top'); paper.style.removeProperty('right');
      updateRing();
      updateCollectionStatus('');
      refreshProgress();
    },
    activate(activity, lab) {
      close(false);
      restoreWorksheetView();
      ++requestVersion;
      loading = false;
      active = activity;
      // 第 7 课使用适当展开的札记宽度，确保对比表与逐次记录表不挤行。
      paper.classList.toggle('is-animal-note', activity.id === 'lesson-2-task-1');
      paper.classList.toggle('is-digits-note', ['lesson-7-task-1', 'lesson-7-task-2','lesson-5-task-1','lesson-5-task-2','lesson-4-task-1'].includes(activity.id));
      paper.classList.toggle('is-recognition-note', activity.id === 'lesson-8-task-1');
      paper.classList.toggle('is-creation-note', ['lesson-8-task-2', 'lesson-9-task-1', 'lesson-9-task-3'].includes(activity.id));
      controller = lab;
      current = drafts.get(activity.id);
      const sections = current?.data.sections || activity.flow?.sections || [];
      const resume = sections.find(s => s.unlocked && !s.submitted) || sections.find(s => s.unlocked);
      selectedId = resume?.id;
      entry.hidden = !activity.worksheet_available;
      paper.style.removeProperty('left'); paper.style.removeProperty('top'); paper.style.removeProperty('right');
      updateRing();
      if (activity.worksheet_available) {
        applyGate(current?.data.flow || activity.flow);
        if (resume) controller?.goToStep?.(controller?.getStep?.() ?? resume.step);
        load();
      } else controller?.setGate?.(null);
      refreshProgress();
    },
    close,
    selectStep(step) {
      const section = current?.data.sections.find(s => s.step === step) || active?.flow?.sections.find(s => s.step === step);
      if (section) selectSection(section.id, false);
    },
  };
}

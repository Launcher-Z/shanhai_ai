/* 教师端作品挑选与就地审核：统一支持卷三（8.2/9.1/9.3）与卷一 1.2 像素画。 */
(() => {
  const sections = [...document.querySelectorAll('.creation-curation, .pixel-curation')];
  if (!sections.length) return;

  function setCardBusy(card, busy) {
    card.dataset.busy = busy ? '1' : '0';
    card.querySelectorAll('button, textarea').forEach(el => {
      el.disabled = busy;
    });
  }

  function showCardMsg(card, text, isError = false) {
    const msg = card.querySelector('[data-card-msg]');
    if (!msg) return;
    msg.textContent = text || '';
    msg.hidden = !text;
    msg.classList.toggle('is-error', Boolean(text && isError));
  }

  function syncCreationSelectionCard(card) {
    if (card.dataset.reviewState !== 'completed') return;
    const included = card.dataset.included === '1';
    const dirty = card.dataset.included !== card.dataset.initIncluded;
    card.classList.toggle('is-included', included);
    card.classList.toggle('is-excluded', !included);
    card.classList.toggle('is-dirty', dirty);
    const btn = card.querySelector('.sample-toggle-btn');
    if (btn) {
      btn.hidden = false;
      btn.classList.toggle('is-included', included);
      btn.classList.toggle('is-excluded', !included);
      btn.setAttribute('aria-pressed', included ? 'true' : 'false');
      btn.textContent = included ? '✓' : '✕';
    }
  }

  function refreshSectionStats(section) {
    const allCards = [...section.querySelectorAll('[data-curation-card]')];
    const pendingEl = section.querySelector('[data-stat-pending]');
    const approvedEl = section.querySelector('[data-stat-approved]');
    const returnedEl = section.querySelector('[data-stat-returned]');
    if (pendingEl) pendingEl.textContent = String(allCards.filter(c => c.dataset.reviewState === 'pending').length);
    if (approvedEl) approvedEl.textContent = String(allCards.filter(c => c.dataset.reviewState === 'completed').length);
    if (returnedEl) returnedEl.textContent = String(allCards.filter(c => c.dataset.reviewState === 'returned').length);
  }

  function applyServerResult(section, result, collectChanges) {
    const matching = [...section.querySelectorAll(`[data-curation-card][data-record-id="${result.record_id}"]`)];
    const canExcellent = result.status === 'completed';
    const isExcellent = Boolean(result.teacher_excellent);

    matching.forEach(card => {
      card.dataset.revision = String(result.revision);
      const secId = card.dataset.sectionId;
      const nextState = (secId && result.stage_states?.[secId]?.status) || result.status;
      card.dataset.reviewState = nextState;
      card.classList.remove('is-state-pending', 'is-state-completed', 'is-state-returned');
      card.classList.add(`is-state-${nextState}`);

      card.dataset.canExcellent = canExcellent ? '1' : '0';
      card.dataset.excellent = isExcellent ? '1' : '0';
      card.classList.toggle('is-excellent', isExcellent);

      const badge = card.querySelector('[data-status-badge]');
      if (badge) {
        badge.classList.remove('is-pending', 'is-completed', 'is-returned');
        badge.classList.add(`is-${nextState}`);
        badge.textContent = nextState === 'pending' ? '待审核' : (nextState === 'returned' ? '已驳回' : '已通过');
        badge.hidden = nextState === 'completed';
      }

      const reviewActions = card.querySelector('[data-review-actions]');
      if (reviewActions) reviewActions.hidden = nextState !== 'pending';
      const rejectBox = card.querySelector('[data-reject-box]');
      if (rejectBox && nextState !== 'pending') rejectBox.hidden = true;

      const feedbackNote = card.querySelector('[data-feedback-note]');
      if (feedbackNote) {
        const qid = card.dataset.questionId;
        const fb = result.question_reviews?.[qid]?.feedback || result.feedback || '';
        if (nextState === 'returned' && fb) {
          feedbackNote.textContent = `驳回建议：${fb}`;
          feedbackNote.title = fb;
          feedbackNote.hidden = false;
        } else {
          feedbackNote.hidden = true;
        }
      }

      const exBtn = card.querySelector('[data-curation-excellent]');
      if (exBtn) {
        const showEx = nextState === 'completed' && canExcellent;
        exBtn.hidden = !showEx;
        exBtn.classList.toggle('is-active', isExcellent);
        exBtn.dataset.nextExcellent = isExcellent ? '0' : '1';
        exBtn.textContent = isExcellent ? '已优秀 · 金圈' : '标为优秀 · 金圈';
      }

      if (nextState === 'completed') {
        if (card.dataset.initIncluded === undefined) card.dataset.initIncluded = '0';
        if (card.dataset.included === undefined) card.dataset.included = '0';
        syncCreationSelectionCard(card);
      }

      showCardMsg(card, '');
    });

    refreshSectionStats(section);
    if (collectChanges) collectChanges();
  }

  async function postCardAction(section, card, url, payload, collectChanges) {
    if (card.dataset.busy === '1') return;
    const sameRecordCards = [...section.querySelectorAll(`[data-curation-card][data-record-id="${card.dataset.recordId}"]`)];
    sameRecordCards.forEach(c => {
      setCardBusy(c, true);
      showCardMsg(c, '正在保存…');
    });
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: payload,
        headers: { Accept: 'application/json' },
      });
      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }
      const result = await response.json().catch(() => ({ error: '页面验证已失效，请刷新页面后重试。' }));
      if (!response.ok) throw new Error(result.error || '操作未保存，请重试。');
      sameRecordCards.forEach(c => setCardBusy(c, false));
      applyServerResult(section, result, collectChanges);
    } catch (error) {
      sameRecordCards.forEach(c => {
        setCardBusy(c, false);
        showCardMsg(c, error.message, true);
      });
    }
  }

  sections.forEach(section => {
    const form = section.querySelector('.creation-batch-form');
    const changesInput = section.querySelector('.creation-batch-changes');
    const saveBtn = section.querySelector('.creation-batch-save-btn');
    const dirtyHint = section.querySelector('.creation-dirty-hint');

    function collectChanges() {
      const changes = [];
      section.querySelectorAll('.creation-work-card[data-review-state="completed"]').forEach(card => {
        if (card.dataset.included !== card.dataset.initIncluded) {
          changes.push({
            record_id: Number(card.dataset.recordId),
            work_key: card.dataset.workKey || 'first',
            included: card.dataset.included === '1',
          });
        }
      });
      if (changesInput) changesInput.value = JSON.stringify(changes);
      if (saveBtn) {
        saveBtn.disabled = changes.length === 0;
        saveBtn.textContent = changes.length ? `保存并发布（${changes.length} 项）` : '保存并发布';
      }
      if (dirtyHint) {
        dirtyHint.classList.toggle('is-dirty', changes.length > 0);
        dirtyHint.textContent = changes.length
          ? `有 ${changes.length} 件待保存，点击「保存并发布」后学生端立即生效`
          : '点击已通过卡片 ✓ / ✕ 后保存并发布';
      }
      return changes;
    }

    function buildPayload(card) {
      const payload = new FormData();
      payload.set('csrf', section.dataset.csrf || '');
      payload.set('revision', card.dataset.revision || '0');
      payload.set('return_to', 'analysis');
      payload.set('scope_class_id', section.dataset.classId || '');
      payload.set('lesson_id', section.dataset.lessonId || '');
      return payload;
    }

    section.addEventListener('click', event => {
      const approveBtn = event.target.closest('[data-curation-approve]');
      if (approveBtn) {
        const card = approveBtn.closest('[data-curation-card]');
        const payload = buildPayload(card);
        payload.set('question_id', card.dataset.questionId);
        payload.set('decision', 'approve');
        payload.set('feedback', '');
        postCardAction(section, card, card.dataset.reviewUrl, payload, collectChanges);
        return;
      }

      const rejectOpenBtn = event.target.closest('[data-curation-reject-open]');
      if (rejectOpenBtn) {
        const card = rejectOpenBtn.closest('[data-curation-card]');
        const box = card.querySelector('[data-reject-box]');
        if (box) {
          box.hidden = false;
          showCardMsg(card, '');
          box.querySelector('[data-reject-input]')?.focus();
        }
        return;
      }

      const rejectCancelBtn = event.target.closest('[data-curation-reject-cancel]');
      if (rejectCancelBtn) {
        const card = rejectCancelBtn.closest('[data-curation-card]');
        const box = card.querySelector('[data-reject-box]');
        if (box) box.hidden = true;
        showCardMsg(card, '');
        return;
      }

      const rejectConfirmBtn = event.target.closest('[data-curation-reject-confirm]');
      if (rejectConfirmBtn) {
        const card = rejectConfirmBtn.closest('[data-curation-card]');
        const input = card.querySelector('[data-reject-input]');
        const feedback = (input?.value || '').trim();
        if (!feedback) {
          showCardMsg(card, '请填写修改建议后再驳回。', true);
          input?.focus();
          return;
        }
        const payload = buildPayload(card);
        payload.set('question_id', card.dataset.questionId);
        payload.set('decision', 'return');
        payload.set('feedback', feedback);
        postCardAction(section, card, card.dataset.reviewUrl, payload, collectChanges);
        return;
      }

      const exBtn = event.target.closest('[data-curation-excellent]');
      if (exBtn) {
        const card = exBtn.closest('[data-curation-card]');
        const payload = buildPayload(card);
        payload.set('excellent', exBtn.dataset.nextExcellent === '1' ? '1' : '0');
        postCardAction(section, card, card.dataset.excellentUrl, payload, collectChanges);
        return;
      }

      const selectAllBtn = event.target.closest('.creation-select-all');
      if (selectAllBtn) {
        const next = selectAllBtn.dataset.included === '1' ? '1' : '0';
        section.querySelectorAll('.creation-work-card[data-review-state="completed"]').forEach(card => {
          card.dataset.included = next;
          syncCreationSelectionCard(card);
        });
        collectChanges();
        return;
      }

      const card = event.target.closest('.creation-work-card[data-review-state="completed"]');
      if (card) {
        if (event.target.closest('a, textarea, input, form, .curation-card-footer')) return;
        card.dataset.included = card.dataset.included === '1' ? '0' : '1';
        syncCreationSelectionCard(card);
        collectChanges();
      }
    });

    if (form) {
      form.addEventListener('submit', () => {
        collectChanges();
      });
    }
  });
})();

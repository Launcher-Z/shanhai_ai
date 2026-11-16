/* 将第7课神经网络实验带入的文本记录实时渲染为结构化数据表，仍以原文本存取兼容旧数据。 */

const EXP_TABLE_IDS = new Set(['baseline-record', 'binary-comparison', 'ten-baseline']);
const ZERO_ONE_TRUTH = { E01: '0', E02: '1', E03: '0', E04: '1', E05: '0' };
const TEN_TRUTH = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`E${String(i + 1).padStart(2, '0')}`, String(i)]));

function el(tag, className, text = '') {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== '') item.textContent = text;
  return item;
}

function parseExperimentTable(qid, text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return null;

  if (qid === 'baseline-record' || qid === 'ten-baseline') {
    const truthMap = qid === 'baseline-record' ? ZERO_ONE_TRUTH : TEN_TRUTH;
    const rows = [];
    for (const line of lines) {
      const m = line.match(/^(E\d+)\s*[:：]\s*(.+)$/);
      if (!m) continue;
      const sample = m[1].toUpperCase();
      const body = m[2].trim();
      const truth = truthMap[sample] || '—';
      if (body.includes('未测试')) {
        rows.push([
          { text: sample },
          { text: truth },
          { text: '未测试', tone: 'muted' },
          { text: '未测试', tone: 'muted' },
        ]);
        continue;
      }
      const pm = body.match(/^(\d+)\s*[（(]\s*([0-9.]+%)\s*[)）]$/);
      if (!pm) continue;
      const ok = truth !== '—' && pm[1] === truth;
      rows.push([
        { text: sample },
        { text: truth },
        { text: `${pm[1]}（${pm[2]}）`, tone: truth === '—' ? '' : (ok ? 'ok' : 'bad') },
        { text: truth === '—' ? '—' : (ok ? '✓ 正确' : '✗ 错误'), tone: truth === '—' ? 'muted' : (ok ? 'ok' : 'bad') },
      ]);
    }
    return rows.length ? { headers: ['图片', '真值', '预测（置信度）', '判定'], rows } : null;
  }

  if (qid === 'binary-comparison') {
    const rows = [];
    for (const line of lines) {
      const m = line.match(/^(E\d+)\s*[:：]\s*训练(\d+)次\s*(.+?)\s*→\s*训练(\d+)次\s*(.+)$/);
      if (!m) continue;
      const sample = m[1].toUpperCase();
      const truth = ZERO_ONE_TRUTH[sample] || '—';
      const bm = m[3].trim().match(/^(\d+)\s*[（(]\s*([0-9.]+%)\s*[)）]$/);
      const am = m[5].trim().match(/^(\d+)\s*[（(]\s*([0-9.]+%)\s*[)）]$/);
      const beforeOk = bm && truth !== '—' ? bm[1] === truth : null;
      const afterOk = am && truth !== '—' ? am[1] === truth : null;
      const bCell = bm ? { text: `${m[2]}次：${bm[1]}（${bm[2]}）`, tone: beforeOk ? 'ok' : 'bad' }
        : { text: `${m[2]}次：未测试`, tone: 'muted' };
      const aCell = am ? { text: `${m[4]}次：${am[1]}（${am[2]}）`, tone: afterOk ? 'ok' : 'bad' }
        : { text: `${m[4]}次：未测试`, tone: 'muted' };
      const change = afterOk === null ? '待测试' : (beforeOk === false && afterOk ? '修正 ✓' : (afterOk ? '保持 ✓' : '仍错 ✗'));
      const changeTone = afterOk === null ? 'muted' : (beforeOk === false && afterOk ? 'up' : (afterOk ? 'ok' : 'bad'));
      rows.push([{ text: `${sample}（${truth}）` }, bCell, aCell, { text: change, tone: changeTone }]);
    }
    return rows.length ? { headers: ['测试图（真值）', '训练前', '训练后', '变化'], rows } : null;
  }

  return null;
}

export function supportsExperimentTable(q) {
  return Boolean(q?.experiment_record && !q?.record_table && EXP_TABLE_IDS.has(q.id));
}

export function setupExperimentTable(field, input, q, anchorShell) {
  const wrap = el('div', 'note-exp-wrap');
  const box = el('div', 'note-exp-table-box');
  box.hidden = true;
  const fold = el('details', 'note-raw-fold');
  const summary = el('summary', '', '原始记录文本');
  fold.append(summary, anchorShell);
  wrap.append(box, fold);
  field.append(wrap);

  let userToggled = false;
  summary.addEventListener('click', () => { userToggled = true; });

  function render() {
    const parsed = parseExperimentTable(q.id, input.value);
    if (!parsed) {
      box.hidden = true;
      box.replaceChildren();
      summary.textContent = '记录输入框（点击下方“带入本段实验记录”后将自动生成数据表）';
      if (!userToggled) fold.open = true;
      return;
    }
    const table = el('table', 'note-exp-table');
    const thead = el('thead');
    const headRow = el('tr');
    parsed.headers.forEach(h => headRow.append(el('th', '', h)));
    thead.append(headRow);
    const tbody = el('tbody');
    parsed.rows.forEach(row => {
      const tr = el('tr');
      row.forEach(cell => tr.append(el('td', cell.tone ? `tone-${cell.tone}` : '', cell.text)));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    box.replaceChildren(table);
    box.hidden = false;
    summary.textContent = '查看 / 修改原始记录文本';
    if (!userToggled) fold.open = false;
  }

  input.addEventListener('input', render);
  render();
}

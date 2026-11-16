/* 用嵌套分支呈现树；条件文字来自固定数据，学生输入不写入 HTML。 */
import { nearest } from './model.mjs';

const BEAST_LIST = ['天狗', '长右', '类', '朱厌'];
const BEAST_FILES = {'天狗': 'tiangou', '长右': 'changyou', '类': 'lei', '朱厌': 'zhuyan'};
const RESULT_TEXT = {monkey: '金丝猴', leopard: '雪豹', tie: '平票'};

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function parseNodePayload(payload) {
  const [kind, id] = String(payload || '').split(':');
  if (kind === 'feature' && id) return {feature: id, yes: {}, no: {}};
  if (kind === 'animal' && id) return {animal: id};
  return null;
}

export function bindNodeDrop(card, acceptKind, onPayload, onTapPlace) {
  card.addEventListener('dragover', event => {
    const types = event.dataTransfer?.types;
    if (!types || (!types.includes('text/plain') && !types.includes('application/x-shanhai-node'))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    card.classList.add('is-drag-over');
  });
  card.addEventListener('dragleave', event => {
    if (!card.contains(event.relatedTarget)) card.classList.remove('is-drag-over');
  });
  card.addEventListener('drop', event => {
    event.preventDefault();
    card.classList.remove('is-drag-over');
    const raw = event.dataTransfer?.getData('application/x-shanhai-node') || event.dataTransfer?.getData('text/plain');
    const [kind] = String(raw || '').split(':');
    if (acceptKind !== 'any' && kind !== acceptKind) return;
    const replacement = parseNodePayload(raw);
    if (replacement) onPayload(replacement);
  });
  card.addEventListener('click', event => {
    if (event.target.closest('select, button')) return;
    onTapPlace?.(acceptKind, onPayload);
  });
}

export function renderTree(tree, catalog, editable, onChange, candidates, depth = 0, options = {}) {
  const box = element('div', undefined, 'decision-node');
  if (depth > 6) return box;
  const names = catalog.animals.filter(a => candidates.includes(a.id));
  const kind = tree.feature ? 'condition' : tree.animal ? 'leaf' : 'empty';
  box.dataset.nodeKind = kind;
  if (editable) {
    const card = element('div', undefined, 'decision-card');
    const badge = element('span', kind === 'condition' ? '判断条件' : kind === 'leaf' ? '分类结果' : '待选择', 'decision-kind');
    const head = element('div', undefined, 'decision-card-head');
    head.append(badge);
    if (kind === 'leaf') {
      const animal = catalog.animals.find(a => a.id === tree.animal);
      if (animal?.icon) head.append(element('span', animal.icon, 'decision-animal-icon'));
    }
    if (kind !== 'empty') {
      const clearBtn = element('button', '×', 'decision-node-clear');
      clearBtn.type = 'button';
      clearBtn.title = '清空此节点';
      clearBtn.setAttribute('aria-label', '清空此节点');
      clearBtn.addEventListener('click', () => onChange(tree, {}));
      head.append(clearBtn);
    }

    const mainText = kind === 'condition'
      ? catalog.features.find(f => f.id === tree.feature)?.label
      : kind === 'leaf'
        ? catalog.animals.find(a => a.id === tree.animal)?.name
        : '拖入条件或动物';
    const main = element('strong', mainText || '待选择', 'decision-card-title');

    const select = element('select', undefined, 'decision-fallback-select');
    select.setAttribute('aria-label', `第${depth + 1}层：${names.map(a=>a.name).join('、') || '空分支'}`);
    select.append(new Option('切换或选择…', ''));
    const conditions = element('optgroup'); conditions.label = '判断条件';
    if (depth < 6) catalog.features.forEach(f => conditions.append(new Option(f.label, `feature:${f.id}`)));
    const leaves = element('optgroup'); leaves.label = '分类结果';
    catalog.animals.filter(a => catalog.stages[catalog.stage].includes(a.id)).forEach(a => leaves.append(new Option(`${a.icon} ${a.name}`, `animal:${a.id}`)));
    select.append(conditions, leaves);
    select.value = tree.feature ? `feature:${tree.feature}` : tree.animal ? `animal:${tree.animal}` : '';
    select.addEventListener('change', () => {
      onChange(tree, parseNodePayload(select.value) || {});
    });

    bindNodeDrop(card, depth < 6 ? 'any' : 'animal', replacement => onChange(tree, replacement), options.onTapPlace);

    card.append(head, main, select);
    box.append(card);
  } else {
    const animal = tree.animal ? catalog.animals.find(a=>a.id === tree.animal) : null;
    const label = tree.feature ? catalog.features.find(f=>f.id === tree.feature)?.label : animal ? `${animal.icon} ${animal.name}` : undefined;
    box.append(element('strong', label || '待选择', tree.feature ? 'decision-condition' : 'decision-leaf'));
  }
  if (tree.feature) {
    box.classList.add('has-branches');
    const branches = element('div', undefined, 'decision-branches');
    ['yes','no'].forEach((key, i) => {
      const branch = element('div', undefined, `decision-branch is-${key}`);
      const subset = names.filter(a=>a.traits.includes(tree.feature) === (i === 0)).map(a=>a.id);
      branch.append(element('span', i === 0 ? '是' : '否', `decision-edge is-${key}`), renderTree(tree[key] || {}, catalog, editable, onChange, subset, depth + 1, options));
      branches.append(branch);
    });
    box.append(branches);
  }
  return box;
}

export function createTreeNote(question, input, controller) {
  const root = element('div', undefined, 'decision-tree-form');
  const preview = element('div', undefined, 'decision-note-preview');
  const status = element('p', '', 'decision-note-status');status.setAttribute('role','status');
  function show() {
    let record;
    try { record = JSON.parse(input.value); } catch { /* 未带入时显示提示。 */ }
    const data = controller?.catalog;
    preview.replaceChildren();
    if (!record?.tree || !data) { status.textContent = '先在活动里搭好树，再带入札记。'; return; }
    const catalog = {...data, stage:question.decision_tree.stage};
    preview.append(renderTree(record.tree, catalog, false, null, record.animal_ids));
    status.textContent = question.editable ? '将提交此处预览的树；修改活动后，可点击下方更新。' : '这是已提交的树。';
  }
  function capture() {
    const record = controller?.treeSnapshot?.(question.decision_tree.stage);
    if (!record) return;
    input.value = JSON.stringify(record);
    input.dispatchEvent(new Event('input', {bubbles:true}));
    show();
  }
  root.append(preview, status);
  if (question.editable) {
    const button = element('button', '带入／更新当前决策树');button.type = 'button';
    button.addEventListener('click', capture);root.append(button);
  }
  show();
  return root;
}

export function createVoteTable(question, answer) {
  const root = element('div', undefined, 'knn-vote-form');
  const table = element('table');
  table.innerHTML = '<thead><tr><th>K</th><th>金丝猴邻居数</th><th>雪豹邻居数</th></tr></thead>';
  const body = element('tbody');
  const inputs = [];
  const values = Object.fromEntries(answer.value.split('\n').map(line=>line.split('：')));
  [1,3,5,7,9].forEach(k => {
    const row = element('tr');row.append(element('th',String(k)));
    ['金丝猴','雪豹'].forEach(name => {
      const label = `K=${k}·${name}`;
      const input = element('input');input.type = 'number';input.min = 0;input.max = k;input.step = 1;
      input.inputMode = 'numeric';input.required = Boolean(question.required);
      input.setAttribute('aria-label', label+'邻居数');input.value = values[label] ?? '';
      inputs.push({input,label});const cell=element('td');cell.append(input);row.append(cell);
    });
    body.append(row);
  });
  root.addEventListener('input', event => {
    event.stopPropagation();
    answer.value = inputs.map(({input,label})=>`${label}：${input.value}`).join('\n');
    answer.dispatchEvent(new Event('input',{bubbles:true}));
  });
  table.append(body);root.append(table);return root;
}

function renderKnnMiniSvg(samples, target, k, beast, uid) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 230 226');
  svg.setAttribute('class', 'knn-capture-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${beast}坐标模拟图`);
  const draw = (tag, attrs = {}, text, parent = svg) => {
    const n = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, val]) => n.setAttribute(key, String(val)));
    if (text !== undefined) n.textContent = text;
    parent.append(n);
    return n;
  };
  const OX = 28, OY = 204, SPAN = 180, SCALE = 1.8;
  const px = x => OX + x * SCALE, py = y => OY - y * SCALE;
  const defs = draw('defs');
  const clip = draw('clipPath', {id: `knn-mini-clip-${uid}`}, undefined, defs);
  draw('rect', {x: OX, y: OY - SPAN, width: SPAN, height: SPAN}, undefined, clip);
  const bClip = draw('clipPath', {id: `knn-mini-bclip-${uid}`}, undefined, defs);
  draw('circle', {cx: 0, cy: 0, r: 9.5}, undefined, bClip);

  draw('rect', {x: OX, y: OY - SPAN, width: SPAN, height: SPAN, fill: '#fcfaf1', stroke: '#71856833', 'stroke-width': 1});
  [20, 40, 60, 80, 100].forEach(n => {
    draw('line', {x1: px(n), y1: OY - SPAN, x2: px(n), y2: OY, stroke: '#7185682b', 'stroke-width': 1});
    draw('line', {x1: OX, y1: py(n), x2: OX + SPAN, y2: py(n), stroke: '#7185682b', 'stroke-width': 1});
    draw('text', {x: px(n), y: OY + 12, 'text-anchor': 'middle', 'font-size': 8, fill: '#5a6d5e'}, String(n));
    draw('text', {x: OX - 5, y: py(n) + 3, 'text-anchor': 'end', 'font-size': 8, fill: '#5a6d5e'}, String(n));
  });
  draw('line', {x1: OX, y1: OY, x2: OX + SPAN + 6, y2: OY, stroke: '#4f6659', 'stroke-width': 1.2});
  draw('line', {x1: OX, y1: OY, x2: OX, y2: OY - SPAN - 6, stroke: '#4f6659', 'stroke-width': 1.2});
  draw('text', {x: OX - 4, y: OY + 11, 'text-anchor': 'end', 'font-size': 8, fill: '#5a6d5e'}, '0');

  const res = nearest(samples, target, k);
  const nbrIds = new Set(res.neighbors.map(p => p.id));
  const clipLayer = draw('g', {'clip-path': `url(#knn-mini-clip-${uid})`});
  if (res.neighbors.length) {
    const r = res.neighbors[res.neighbors.length - 1].distance * SCALE;
    if (r > 0) draw('circle', {cx: px(target.x), cy: py(target.y), r, fill: '#42695d14', stroke: '#42695d7a', 'stroke-width': 1, 'stroke-dasharray': '4 3'}, undefined, clipLayer);
  }
  res.neighbors.forEach(p => {
    draw('line', {x1: px(target.x), y1: py(target.y), x2: px(p.x), y2: py(p.y), stroke: '#4a6b56', 'stroke-width': 1.1, 'stroke-dasharray': '3 2'});
  });
  samples.forEach(p => {
    const g = draw('g', {opacity: nbrIds.has(p.id) ? '1' : '0.38'});
    if (p.type === 'monkey') draw('circle', {cx: px(p.x), cy: py(p.y), r: 3.8, fill: '#d6a338', stroke: '#2f433a', 'stroke-width': 0.9}, undefined, g);
    else draw('rect', {x: px(p.x) - 3.5, y: py(p.y) - 3.5, width: 7, height: 7, rx: 1, fill: '#557b8a', stroke: '#2f433a', 'stroke-width': 0.9}, undefined, g);
  });
  const tg = draw('g', {transform: `translate(${px(target.x)},${py(target.y)})`});
  draw('circle', {cx: 0, cy: 0, r: 9.5, fill: '#fff9e7'}, undefined, tg);
  const url = new URL(`../../bestiary/display/${BEAST_FILES[beast] || 'tiangou'}.png`, import.meta.url).href;
  draw('image', {href: url, x: -9.5, y: -9.5, width: 19, height: 19, 'clip-path': `url(#knn-mini-bclip-${uid})`, preserveAspectRatio: 'xMidYMid slice'}, undefined, tg);
  draw('circle', {cx: 0, cy: 0, r: 9.5, fill: 'none', stroke: '#953d2e', 'stroke-width': 1.3}, undefined, tg);
  return {svg, res};
}

export function createKnnCapturesNote(question, input, controller) {
  const root = element('div', undefined, 'knn-captures-note');
  const grid = element('div', undefined, 'knn-captures-grid');
  const status = element('p', undefined, 'note-hint');
  const catalog = controller?.catalog;

  const parse = () => {
    try {
      const parsed = JSON.parse(input.value);
      if (parsed?.schema_version === 1 && parsed.captures && typeof parsed.captures === 'object') return parsed.captures;
    } catch { /* ignore */ }
    return {};
  };

  if (!input.value.trim() && question.editable) {
    const draft = controller?.knnCaptures?.();
    if (draft && Object.keys(draft).length) {
      input.value = JSON.stringify({schema_version: 1, captures: draft});
    }
  }

  function writeCaptures(nextCaptures) {
    input.value = Object.keys(nextCaptures).length ? JSON.stringify({schema_version: 1, captures: nextCaptures}) : '';
    input.dispatchEvent(new Event('input', {bubbles: true}));
  }

  function show(notice) {
    const captures = parse();
    const count = BEAST_LIST.filter(b => captures[b]).length;
    grid.replaceChildren();
    BEAST_LIST.forEach((beast, idx) => {
      const item = captures[beast];
      const card = element('figure', undefined, `knn-capture-card${item ? '' : ' is-empty'}`);
      const head = element('div', undefined, 'knn-capture-head');
      const who = element('span', undefined, 'knn-capture-who');
      const img = element('img');
      img.src = new URL(`../../bestiary/display/${BEAST_FILES[beast]}.png`, import.meta.url).href;
      img.alt = '';
      who.append(img, element('strong', beast));
      head.append(who);

      if (item && catalog) {
        const samples = item.points || catalog.samples;
        const {svg, res} = renderKnnMiniSvg(samples, item.target, item.k, beast, `${idx}-${item.target.x}-${item.target.y}-${item.k}`);
        head.append(element('span', RESULT_TEXT[res.result], `knn-capture-badge is-${res.result}`));
        card.append(head, svg);
        const meta = element('figcaption', undefined, 'knn-capture-meta');
        meta.append(
          element('span', `坐标 (${item.target.x}, ${item.target.y}) · K=${item.k}`),
          element('span', `金丝猴 ${res.monkey} / 雪豹 ${res.leopard}`)
        );
        card.append(meta);
      } else {
        head.append(element('span', '未截取', 'knn-capture-badge is-empty'));
        card.append(head, element('div', '请先在实验台摆好位置并截取', 'knn-capture-empty'));
      }

      if (question.editable) {
        const btn = element('button', item ? '重新截取替换' : '截取当前图', 'knn-capture-action');
        btn.type = 'button';
        btn.addEventListener('click', () => {
          const snap = controller?.captureBeast?.(beast);
          if (!snap) {
            show(`请先在实验台选中「${beast}」并摆好位置后，再点击截取。`);
            return;
          }
          const next = parse();
          const had = Boolean(next[beast]);
          next[beast] = snap;
          writeCaptures(next);
          show(had ? `已重新截取并替换「${beast}」。` : `已截取「${beast}」。`);
        });
        card.append(btn);
      }
      grid.append(card);
    });
    status.textContent = notice || (question.editable
      ? (count === 4 ? '已集齐 4 只异兽的位置截图，可直接提交或点击卡片重截替换。' : `已截取 ${count}/4 只异兽；集齐 4 张后即可提交。`)
      : '这是已提交的 4 只异兽位置模拟截图。');
  }

  root.append(grid, status);
  if (question.editable && controller?.knnCaptures) {
    const syncBtn = element('button', '从实验台同步全部已截取图');
    syncBtn.type = 'button';
    syncBtn.addEventListener('click', () => {
      const draft = controller.knnCaptures();
      if (!draft || !Object.keys(draft).length) {
        show('实验台上还没有截取记录，请先在实验台截取或直接点击上方卡片截取。');
        return;
      }
      writeCaptures({...parse(), ...draft});
      show('已同步实验台上最新的异兽截图。');
    });
    root.append(syncBtn);
  }
  show();
  return root;
}

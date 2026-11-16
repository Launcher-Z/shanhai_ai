/*
 * [F1] 三种输入模式；[F2] 十路真实加权计算；[F3] 预测与逐次权重时间轴。
 * 数据接口：sample = {id, label, pixels[216], image}；测试和手写不使用 label。
 * 模型接口：weights[216][10]、bias[10]、steps。仅 commitTraining 更新模型。
 */
'use strict';
// 测试仅跳过学习顺序，不伪造测试快照、训练次数或参数更新。
const progressLocksEnabled = new URLSearchParams(location.search).get('progress-locks') !== 'off';

const D = window.ActivityData, M = window.DigitModel;
const $ = id => document.getElementById(id);
const fmt = value => Number(value).toFixed(4);
const percent = value => (value * 100).toFixed(1) + '%';
// 关闭或切换活动后，中止本次播放；已经完成的参数更新仍保留。
const wait = ms => new Promise((resolve, reject) => {
  const epoch = window.labEpoch || 0;
  setTimeout(() => epoch === (window.labEpoch || 0) ? resolve() : reject(new DOMException('演示已暂停', 'AbortError')), ms);
});
const COLOR_SCALE = .5;
// 首次任选5张不同的固定测试图片，留下初始预测后即可训练。
const BASELINE_REQUIRED = 5;
// [F1/B1] 累计训练次数决定按钮开放；开放后可以反复选择任意一档。
const TRAINING_THRESHOLDS = {1: 0, 100: 1, 300: 101, 500: 401};
// 批次越大，画面刷新间隔越大、停留越短；每次真实更新都保存快照。
const TRAINING_TEMPOS = {
  1: {displayEvery: 1, input: 100, scanBatch: 12, scan: 30, bias: 70, prediction: 300, update: 350},
  100: {displayEvery: 1, input: 24, scanBatch: 36, scan: 8, bias: 8, prediction: 40, update: 60},
  300: {displayEvery: 3, input: 12, scanBatch: 72, scan: 4, bias: 4, prediction: 18, update: 25},
  500: {displayEvery: 5, input: 4, scanBatch: 216, scan: 4, bias: 4, prediction: 8, update: 12}
};
let S, noticeTimer;
let computeCache = null, weightCache = null;
let drawingPointer = null, drawingLast = null;

function makeFrame(sample) {
  return {sample, params: M.snapshot(S.net), phase: 'ready', output: null, update: null,
    processed: 0, raw: Array(10).fill(0), lastTerm: null, biasAdded: false};
}
function current() {
  if (S.mode === 'train') return S.trainFrame;
  if (S.mode === 'draw') return S.drawFrame;
  return S.testFrame;
}
// [B2/F1] 固定测试按训练次数分组；只保存预测结果，不重复保存整份模型。
function testSnapshot(steps = S.net.steps, create = false) {
  let snapshot = S.testSnapshots.find(item => item.steps === steps);
  if (!snapshot && create) {
    snapshot = {steps, results: Array(D.testing.length).fill(null)};
    S.testSnapshots.push(snapshot);
  }
  return snapshot;
}
function testedCount(steps = S.net.steps) {return testSnapshot(steps)?.results.filter(Boolean).length || 0;}
function baselineReady() {return testedCount(0) >= BASELINE_REQUIRED;}
function copyOutput(output) {return {digit: output.digit, scores: output.scores.slice(), probs: output.probs.slice()};}
function sameDrawing(a, b) {return a.length === b.length && a.every((value, i) => value === b[i]);}
// 本次实验中每次更新只有一条实际训练记录，同一次数对应确定的历史参数。
function uniqueDrawingSnapshots(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.steps}:${item.pixels.join('')}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function loadTestFrame(index) {
  const frame = makeFrame(D.testing[index]);
  const output = testSnapshot()?.results[index];
  if (output) {
    frame.output = copyOutput(output); frame.phase = 'tested'; frame.processed = 216;
    frame.raw = output.scores.map((score, j) => score - frame.params.bias[j]);
    frame.lastTerm = {index: 215}; frame.biasAdded = true;
  }
  return frame;
}
function notice(message) {
  clearTimeout(noticeTimer);
  $('status').textContent = message;
  noticeTimer = setTimeout(() => {$('status').textContent = '';}, 4500);
}
function reset() {
  S = {net: M.create(D.seed, D.learningRate), mode: 'test', stage: 'before',
    baselineIds: [],
    testSnapshots: [{steps: 0, results: Array(D.testing.length).fill(null)}], testSnapshotSteps: 0, testIndex: 0,
    drawSnapshots: [], drawSnapshotFilter: 'all', drawSourceId: null, nextDrawSourceId: 1,
    history: [], historyIndex: 0, followLive: true, busy: false, autoActive: false, autoDone: 0, autoTarget: 0, autoStop: false,
    scanActive: false, region: 'input',
    drawPixels: Array(216).fill(0), drawTool: 1, keyboardPixel: 6 + 9 * 12,
    drawWeightMapping: false, drawWeightDigit: 0, drawInkOpacity: .4};
  S.ownSamples = []; S.retiredSamples = []; S.trainingOverrides = {}; S.trainingCursor = null;
  S.sharedDatasets = {}; S.activeDatasetVersion = null; S.datasetMode = 'personal';
  S.history.push(M.snapshot(S.net));
  S.trainFrame = makeFrame(D.training.find(s => s.id === D.firstTraining));
  S.testFrame = makeFrame(D.testing[0]);
  S.drawFrame = makeFrame({id: '手写输入', pixels: S.drawPixels.slice()});
  computeCache = null; weightCache = null;
  drawingPointer = null; drawingLast = null;
  $('status').textContent = '';
  $('autoProgress').value = 0;
  buildGalleries();
  render();
}
function setMode(mode) {
  if (S.busy || !['train', 'test', 'draw'].includes(mode)) return;
  S.mode = mode;
  if (mode === 'train') S.stage = S.net.steps ? 'auto' : 'manual';
  else {
    S.stage = S.net.steps ? 'after' : 'before';
    if (mode === 'test') {
      S.testSnapshotSteps = S.net.steps;
      S.testFrame = loadTestFrame(S.testIndex);
    } else {
      // 已显示的结果保留原训练上下文；只有主动重测才切到最新模型。
      if (!S.drawFrame.output) S.drawFrame = makeFrame({id: '手写输入', pixels: S.drawPixels.slice()});
    }
  }
  S.region = nextRegion();
  render();
}
function nextRegion() {
  // 所有训练从输入区的一次点击开始，结束后引导学生继续选择次数。
  return 'input';
}
function selectTest(index) {
  if (S.busy || S.mode !== 'test') return;
  S.testIndex = index;
  S.testFrame = loadTestFrame(index);
  render();
  $('testPicker').querySelector(`[data-test-index="${index}"]`).focus({preventScroll: true});
}

// [F2] 用 canvas 绘制小图。每个格子仍对应一个真实权重，不创建 4800 个按钮。
function weightColor(value) {
  const ratio = Math.min(Math.abs(value) / COLOR_SCALE, 1);
  const color = value < 0 ? [35, 100, 176] : [189, 54, 65];
  return `rgb(${color.map(v => Math.round(249 + (v - 249) * ratio)).join(',')})`;
}
function paintGrid(canvas, values, weight = false, highlight = -1, backgroundWeights = null, inkOpacity = 1) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width / 12;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  values.forEach((value, i) => {
    const x = (i % 12) * size, y = Math.floor(i / 12) * size;
    // [F5] 先画完整背景，再按滑条设置的不透明度叠加笔迹；真实输入仍为0/1。
    ctx.fillStyle = weight ? weightColor(value) : backgroundWeights ? weightColor(backgroundWeights[i]) : '#fff';
    ctx.fillRect(x, y, size, size);
    if (!weight && value) {
      ctx.fillStyle = backgroundWeights ? `rgba(32,52,72,${inkOpacity})` : '#203448';
      ctx.fillRect(x, y, size, size);
    }
  });
  ctx.strokeStyle = '#d8e3ec'; ctx.lineWidth = canvas.width >= 216 ? 1 : .5;
  ctx.beginPath();
  for (let x = 0; x <= 12; x++) {ctx.moveTo(x * size, 0); ctx.lineTo(x * size, canvas.height);}
  for (let y = 0; y <= D.rows; y++) {ctx.moveTo(0, y * size); ctx.lineTo(canvas.width, y * size);}
  ctx.stroke();
  if (highlight >= 0) {
    ctx.strokeStyle = '#efb946'; ctx.lineWidth = Math.max(1, size * .2);
    ctx.strokeRect((highlight % 12) * size + 1, Math.floor(highlight / 12) * size + 1, size - 2, size - 2);
  }
}
function buildViews() {
  $('drawWeightDigit').innerHTML = Array.from({length: 10}, (_, digit) => `<option value="${digit}">数字 ${digit}</option>`).join('');
  $('computeRoutes').innerHTML = Array.from({length: 10}, (_, j) => `
    <div class="compute-route"><figure class="weight-node"><figcaption>数字<b>${j}</b></figcaption><canvas id="computeWeights${j}" width="120" height="180" role="img" aria-label="通向数字${j}的216个权重"></canvas><div id="weightValue${j}" class="weight-value">w：—</div></figure><span class="sum-arrow" aria-hidden="true">→</span><div class="sum-node"><div class="sum-caption"><span>加权和 z<sub>${j}</sub></span><span id="sumStatus${j}" class="sum-status">待计算</span></div><strong id="sum${j}" class="sum-value">—</strong><div id="accumulator${j}" class="step-formula"><span>等待计算</span><span> </span></div></div></div>`).join('');
  $('probabilityChart').innerHTML = Array.from({length: 10}, (_, j) => `<div id="probRow${j}" class="probability-row"><span>数字 ${j}</span><div class="bar-track"><div id="bar${j}"></div></div><strong id="prob${j}">—</strong></div>`).join('');
  $('weightSnapshots').innerHTML = Array.from({length: 10}, (_, j) => `<figure class="snapshot-card"><figcaption>数字 <b>${j}</b></figcaption><canvas id="snapshot${j}" width="120" height="180" role="img" aria-label="数字${j}的历史权重"></canvas><div id="bias${j}" class="bias-label">b = 0.0000</div></figure>`).join('');
}
function sampleImage(sample) {
  if(sample.image) return sample.image;
  const canvas=document.createElement('canvas'); canvas.width=120;canvas.height=180;paintGrid(canvas,sample.pixels);return canvas.toDataURL();
}
function allTrainingSamples() {
  return [...D.training,...S.ownSamples,...(S.retiredSamples||[]),...Object.values(S.sharedDatasets).flatMap(data=>data.samples)];
}
function trainingPool() {
  const extras=S.datasetMode==='class'?(S.sharedDatasets[S.activeDatasetVersion]?.samples||[]):S.ownSamples;
  return [...D.trainingOrder.map(id=>D.training.find(sample=>sample.id===id)),...extras];
}
function drawingWasTrained(pixels) {
  const ids=new Set(S.history.map(item=>item.sampleId));
  return allTrainingSamples().some(sample=>ids.has(sample.id)&&sameDrawing(sample.pixels,pixels));
}
function buildGalleries() {
  const sampleButton = (group, sample, index) => `<button class="${group==='own'?'is-own-sample':group==='shared'?'is-shared-sample':''}" data-gallery="${group}" data-sample-index="${index}" aria-label="${group==='own'?'自写训练':group==='shared'?'班级训练':'教学'}图片 ${sample.id}，点击查看大图" title="${group==='own'?'自写样本 ':group==='shared'?'班级样本 ':''}${sample.id}"><img src="${sampleImage(sample)}" alt="图片 ${sample.id}"><span>${sample.id}</span></button>`;
  const shared=S.datasetMode==='class'&&document.body.dataset.view!=='samples';
  const extras=shared?(S.sharedDatasets[S.activeDatasetVersion]?.samples||[]):S.ownSamples;
  const trainingSamples = [...D.training.map((sample, index) => ({sample, index, group:'training'})),...extras.map((sample,index)=>({sample,index,group:shared?'shared':'own'}))];
  $('trainingGallery').innerHTML = Array.from({length: 10}, (_, digit) => {
    const samples = trainingSamples.filter(item => item.sample.label === digit)
      .sort((a, b) => a.sample.id.localeCompare(b.sample.id, 'en', {numeric: true}));
    return `<div class="digit-group" role="group" aria-label="数字${digit}的${samples.length}张训练图片"><div class="digit-label">数字<strong>${digit}</strong></div><div class="digit-samples">${samples.map(item => sampleButton(item.group, item.sample, item.index)).join('')}</div></div>`;
  }).join('');
  $('testingGallery').innerHTML = D.testing.map((sample, index) => sampleButton('testing', sample, index)).join('');
  $('trainingGallery').previousElementSibling.querySelector('p').textContent = `${trainingSamples.length} 张 · ${shared?'班级':'自写'} ${extras.length} 张`;
}
function renderNavigation() {
  const done = {before: baselineReady(), manual: S.net.steps >= 1,
    auto: S.net.steps > 1, after: S.net.steps > 0 && (testedCount() > 0 || S.drawSnapshots.some(item => item.steps === S.net.steps))};
  document.querySelectorAll('[data-stage]').forEach(item => {
    item.classList.toggle('done', done[item.dataset.stage]);
    if (item.dataset.stage === S.stage) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  const tasks = {
    before: baselineReady() ? '已完成5张初测，可以进入训练模式，也可继续测试。' : '首次训练前任选5张不同图片测试，留下初始模型的预测快照。',
    manual: baselineReady() ? '点击“训练1次”，自动完成加权计算、预测、衡量误差和权重更新。' : '请先在测试模式完成5张初测，再开始训练。',
    auto: S.autoActive ? `本批追加 ${S.autoTarget} 次训练，每次更新都保存在时间轴。` : '自由选择已开放的训练按钮，可反复追加训练；较大批次播放更快。',
    after: '随时测试任意图片或自己的手写数字，按训练次数查看预测快照。'
  };
  $('taskText').textContent = tasks[S.stage];
  $('beforeNav').textContent = `${Math.min(testedCount(0), BASELINE_REQUIRED)} / ${BASELINE_REQUIRED} 张初测`;
  $('singleNav').textContent = S.net.steps ? '已完成，可重复训练1次' : '点击一次，完成一次训练';
  $('autoNav').textContent = S.autoActive ? `${S.autoDone} / ${S.autoTarget} 次已完成` : '100 → 300 → 500 次';
  $('afterNav').textContent = `当前 ${S.net.steps} 次 · ${testedCount()} / 10 张已测试`;
  $('trainCount').textContent = S.net.steps;
  $('resetButton').disabled = S.busy;
  document.querySelectorAll('.learning-region').forEach(el => el.classList.toggle('is-active', el.dataset.region === S.region));
}
function renderInput() {
  const f = current(), train = S.mode === 'train', test = S.mode === 'test', draw = S.mode === 'draw';
  document.body.dataset.mode = S.mode;
  for (const mode of ['train', 'test', 'draw']) {
    $(mode + 'Mode').setAttribute('aria-pressed', S.mode === mode);
    $(mode + 'Mode').disabled = S.busy;
  }
  $('modeHint').textContent = train ? '用100张训练图学习，标签用于更新参数。' : test ? S.net.steps ? '测试不改参数，结果保存在下方。' : '任选5张初测，保留训练前的结果。' : '手写预测保存在下方，不参与训练。';
  $('sampleName').textContent = train ? `训练图片 ${f.sample.id}` : test ? `固定测试 ${S.testIndex + 1} / 10 · ${f.sample.id}` : S.drawSourceId ? `手写图片 ${S.drawSourceId}` : '写下一个 0—9 的数字';
  $('sampleTag').textContent = train ? S.autoActive ? `本批 ${Math.min(S.autoTarget, S.autoDone + (f.phase === 'updated' ? 0 : 1))} / ${S.autoTarget}` : `第 ${f.params.steps + 1} 次训练` : `训练 ${draw && f.output ? f.params.steps : S.net.steps} 次后`;
  $('sourceCanvas').hidden = draw; $('drawingCanvas').hidden = !draw;
  document.querySelector('.source-display').classList.toggle('is-own-sample', train && f.sample.id.startsWith('H'));
  if (draw) renderDrawing(); else paintGrid($('sourceCanvas'), f.sample.pixels, false, S.scanActive ? f.processed - 1 : -1);
  $('drawingTools').hidden = !draw;
  $('drawingMappingControls').hidden = !draw;
  $('penButton').setAttribute('aria-pressed', S.drawTool === 1);
  $('eraserButton').setAttribute('aria-pressed', S.drawTool === 0);
  for (const id of ['penButton', 'eraserButton', 'clearDrawing']) $(id).disabled = S.busy;
  $('inputLabelBox').hidden = !train;
  $('inputLabel').textContent = train ? `数字 ${f.sample.label}` : '';
  $('testPicker').hidden = !test;
  const hasComparison = Boolean(S.baselineIds?.length);
  $('testPicker').innerHTML = D.testing.map((sample, i) => {
    const tested = Boolean(testSnapshot()?.results[i]);
    const comparison = S.baselineIds?.includes(sample.id);
    const role = hasComparison ? `<em class="test-role">${comparison ? '对照' : ''}</em>` : '';
    const state = tested ? '已测' : comparison ? '待测' : '未测';
    return `<button data-test-index="${i}" class="${tested ? 'is-tested' : 'is-untested'}${comparison ? ' is-comparison' : ''}" aria-pressed="${S.testIndex === i}" title="${comparison ? '初测选定的对照图片' : '可自由测试'}" ${S.busy ? 'disabled' : ''}>${role}<img src="${sample.image}" alt="固定测试图片 ${sample.id}"><span>${sample.id}</span><small class="test-state">${state}</small></button>`;
  }).join('');
  $('testCurrentButton').hidden = !test;
  $('testCurrentButton').disabled = S.busy || f.phase !== 'ready';
  $('drawPredictButton').hidden = !draw;
  $('drawPredictButton').disabled = S.busy || !S.drawPixels.some(Boolean);
  $('drawPredictButton').textContent = draw && f.output ? '再次测试' : '预测手写数字';
  $('trainingSource').hidden = !train;
  $('trainingSource').textContent = S.datasetMode==='class'?`训练数据：原100张＋班级第${S.activeDatasetVersion}版`:'训练数据：个人训练集';
  $('trainingControls').hidden = !train;
  document.querySelectorAll('[data-train-count]').forEach(button => {
    const count = Number(button.dataset.trainCount), threshold = TRAINING_THRESHOLDS[count];
    button.disabled = S.busy || (progressLocksEnabled && (!baselineReady() || S.net.steps < threshold));
    button.title = !progressLocksEnabled ? `追加 ${count} 次真实训练` : !baselineReady() ? '先完成5张训练前测试' : S.net.steps < threshold ? `累计训练 ${threshold} 次后开放` : `追加 ${count} 次完整训练，可重复使用`;
  });
  $('autoControls').hidden = !S.autoActive;
  $('autoProgress').max = S.autoTarget || 100;
  $('autoProgress').value = S.autoDone;
  const tempo = TRAINING_TEMPOS[S.autoTarget];
  $('autoHint').textContent = `本批已完成 ${S.autoDone} / ${S.autoTarget} 次更新${tempo && tempo.displayEvery > 1 ? `；每 ${tempo.displayEvery} 次刷新画面，逐次保存权重` : ''}`;
  $('stopAutoButton').disabled = S.autoStop;
  $('stopAutoButton').textContent = S.autoStop ? '本张完成后停止…' : '本张完成后停止';
  let hint = !progressLocksEnabled && train ? '可自由选择训练次数；计数仅在参数更新后增加。' : train ? !baselineReady() ? `先在测试模式完成初测，还剩 ${BASELINE_REQUIRED - testedCount(0)} 张。` : S.net.steps < 1 ? '点击“训练1次”，完成后开放100次。' : S.net.steps < 101 ? '已开放100次；累计101次后开放300次。按钮可重复使用。' : S.net.steps < 401 ? '已开放300次；累计401次后开放500次。可任选已开放的次数。' : '四档已全部开放，可自由选择并重复训练。' : test ? S.net.steps === 0 && baselineReady() ? '初测完成，可以开始训练，也可继续测试。0次快照会保留。' : testedCount() === 10 ? '当前次数的10张结果已保存，可继续训练或查看历史。' : f.phase === 'tested' ? S.net.steps === 0 ? `结果已保存，初测还剩 ${BASELINE_REQUIRED - testedCount(0)} 张。` : '结果已保存，可任选其他图片，也可继续训练。' : '点选图片，再按“测试当前图片”。' : S.drawPixels.some(Boolean) ? '预测后自动保存图片和结果；清空画板也会保留快照。' : '先写一个数字，再观察模型预测。';
  if (S.busy && train) hint = '自动完成计算、预测和权重更新；实际更新后计数才增加。';
  if (draw && f.output && !S.busy) hint = `显示训练 ${f.params.steps} 次的结果；再次测试使用当前 ${S.net.steps} 次模型。`;
  if(draw&&S.drawPixels.some(Boolean)&&drawingWasTrained(S.drawPixels))hint+=' 当前模型已训练过此笔迹，请再写一张验证。';
  $('inputActionHint').textContent = hint;
}
function renderCompute() {
  const f = current();
  $('scanProgress').value = f.processed;
  $('scanCount').textContent = `${f.processed} / 216`;
  const index = f.lastTerm ? f.lastTerm.index : -1;
  const started = f.processed > 0;
  $('scanLocation').textContent = index < 0 ? '同一输入位置，同时通向十个输出。' : f.biasAdded ? '216 个输入已累加，再分别加入十个偏置。' : `第 ${Math.floor(index / 12) + 1} 行，第 ${index % 12 + 1} 列 · 输入 ${index + 1} = ${f.sample.pixels[index]}`;
  paintGrid($('computePixels'), f.sample.pixels, false, S.scanActive && !f.biasAdded ? index : -1);
  // 扫描时只重画需要高亮的图；所有权重保持本张计算前的快照。
  const redrawWeights = computeCache !== f || S.scanActive;
  for (let j = 0; j < 10; j++) {
    if (redrawWeights) paintGrid($('computeWeights' + j), f.params.weights.map(row => row[j]), true, S.scanActive && !f.biasAdded ? index : -1);
    $('weightValue' + j).textContent = index < 0 ? 'w：—' : 'w：' + fmt(f.params.weights[index][j]);
    $('sum' + j).textContent = f.output ? fmt(f.output.scores[j]) : started ? fmt(f.raw[j]) : '—';
    $('sumStatus' + j).textContent = f.output ? '最终值' : started ? '计算中' : '待计算';
    // 下方只显示这一步的运算；上方大数字是累加结果。
    const prior = f.biasAdded ? f.raw[j] : f.lastTerm ? f.lastTerm.prior[j] : null;
    const term = f.biasAdded ? '+ 偏置 (' + fmt(f.params.bias[j]) + ')' : index >= 0 ? '+ ' + f.sample.pixels[index] + ' × (' + fmt(f.params.weights[index][j]) + ')' : '';
    $('accumulator' + j).innerHTML = prior === null ? '<span>等待计算</span><span> </span>' : `<span>${fmt(prior)}</span><span>${term}</span>`;
  }
  computeCache = S.scanActive ? null : f;
  $('computeHint').textContent = f.phase === 'updated' ? `此处为第 ${f.params.steps + 1} 次更新前的计算；时间轴可看更新后权重。` : '216个输入参与十路计算；逐项显示每批最后一个像素的乘加。';
}
function renderPrediction() {
  const f = current(), train = S.mode === 'train';
  const output = !train || ['measured', 'updated'].includes(f.phase) ? f.output : null;
  for (let j = 0; j < 10; j++) {
    $('prob' + j).textContent = output ? percent(output.probs[j]) : '—';
    $('bar' + j).style.width = output ? percent(output.probs[j]) : '0%';
    $('probRow' + j).classList.toggle('is-winner', Boolean(output) && output.digit === j);
  }
  $('probabilityChart').setAttribute('aria-label', output ? output.probs.map((p, j) => `数字${j}：${percent(p)}`).join('，') : '等待预测');
  $('verdict').classList.toggle('test-verdict', !train);
  $('prediction').textContent = output ? output.digit : '—';
  $('answerTile').hidden = !train; $('judgmentTile').hidden = !train; $('lossBox').hidden = !train;
  $('answer').textContent = train ? f.sample.label : '';
  $('verdictText').textContent = train ? output ? output.digit === f.sample.label ? '预测正确' : '预测错误' : '等待预测' : '';
  $('verdictText').className = !train || !output ? '' : output.digit === f.sample.label ? 'correct' : 'wrong';
  $('lossValue').textContent = train && output ? fmt(M.loss(output, f.sample.label)) : '—';
  $('lossCalculation').textContent = train && output ? `−ln(${output.probs[f.sample.label].toFixed(6)}) ≈ ${fmt(M.loss(output, f.sample.label))}` : '预测后可查看本次实际损失。';
  $('lossAfter').textContent = train && f.update ? `更新后，本张损失 ${fmt(f.update.afterLoss)}` : '';
}
function renderWeights() {
  const snap = S.history[S.historyIndex];
  const historical = snap.steps !== S.net.steps;
  $('updateStatus').textContent = historical ? '回看历史' : S.mode === 'train' ? S.net.steps ? '更新后参数' : '初始参数' : '参数保持不变';
  $('updateHint').textContent = historical ? `正在回看第 ${snap.steps} 次训练后的十组权重；当前模型仍已训练 ${S.net.steps} 次。` : S.mode === 'train' ? snap.steps ? `已训练 ${snap.steps} 次。下面是十组更新后的权重和偏置。` : '下面是十组初始权重；每次完整训练后，时间轴新增一次记录。' : '测试与手写只做预测，十组权重和偏置保持不变。';
  if (weightCache !== snap) {
    for (let j = 0; j < 10; j++) {
      const values = snap.weights.map(row => row[j]);
      paintGrid($('snapshot' + j), values, true);
      $('snapshot' + j).setAttribute('aria-label', `第${snap.steps}次训练后，数字${j}的216个权重`);
      $('bias' + j).textContent = 'b = ' + fmt(snap.bias[j]);
    }
    weightCache = snap;
  }
  $('timeline').max = S.net.steps; $('timeline').value = snap.steps;
  $('timeline').disabled = S.net.steps === 0;
  $('timeline').setAttribute('aria-valuetext', `第 ${snap.steps} 次训练后的权重，当前模型已训练 ${S.net.steps} 次`);
  $('timelineLabel').textContent = snap.steps ? `第 ${snap.steps} 次 · 更新后` : '第 0 次 · 初始';
  $('timelineEnd').textContent = `当前 ${S.net.steps} 次`;
  $('timelineInfo').textContent = snap.steps ? `${snap.sampleId} · 标签 ${snap.label}；${historical ? '仅回看，模型保持不变。' : '拖动查看此前每一次更新。'}` : '初始参数；拖动回看，当前模型保持不变。';
  $('liveWeights').disabled = S.followLive;
}
function renderRecords() {
  $('testSnapshotPanel').hidden = S.mode !== 'test';
  $('drawSnapshotPanel').hidden = S.mode !== 'draw';
  if (S.mode === 'test') {
    const steps = [...new Set([...S.testSnapshots.map(item => item.steps), S.net.steps])].sort((a, b) => a - b);
    $('testSnapshotSelect').innerHTML = steps.map(step => `<option value="${step}">训练 ${step} 次${step === 0 ? ' · 初测' : ''} · ${testedCount(step)}/10 已测</option>`).join('');
    $('testSnapshotSelect').value = S.testSnapshotSteps;
    $('testSnapshotSelect').disabled = S.busy;
    const selected = testSnapshot(S.testSnapshotSteps);
    $('testSnapshotInfo').textContent = `快照：训练 ${S.testSnapshotSteps} 次 · 当前模型：${S.net.steps} 次`;
    $('testSnapshotTable').innerHTML = D.testing.map((sample, index) => {
      const output = selected?.results[index];
      return `<tr><td><div class="record-image"><img src="${sample.image}" alt="测试图片 ${sample.id}"><span>${sample.id}</span></div></td><td class="record-digit">${output ? output.digit : '<span class="record-pending">未测试</span>'}</td><td>${output ? percent(output.probs[output.digit]) : '—'}</td></tr>`;
    }).join('');
  }
  if (S.mode === 'draw') {
    const steps = [...new Set(S.drawSnapshots.map(item => item.steps))].sort((a, b) => a - b);
    $('drawSnapshotSelect').innerHTML = '<option value="all">全部训练次数</option>' + steps.map(step => `<option value="${step}">训练 ${step} 次 · ${S.drawSnapshots.filter(item => item.steps === step).length} 条记录</option>`).join('');
    $('drawSnapshotSelect').value = S.drawSnapshotFilter;
    $('drawSnapshotSelect').disabled = S.busy || !S.drawSnapshots.length;
    const snapshots = S.drawSnapshots.filter(item => S.drawSnapshotFilter === 'all' || item.steps === Number(S.drawSnapshotFilter)).slice().reverse();
    $('drawSnapshotEmpty').hidden = snapshots.length > 0;
    $('drawSnapshotScroll').hidden = snapshots.length === 0;
    $('drawSnapshotTable').innerHTML = snapshots.map(item => `<tr><td><div class="record-image"><button class="record-replay" data-draw-snapshot="${item.id}" aria-label="回看手写图片${item.sourceId}在训练${item.steps}次时的预测" title="回看当时的笔迹与结果" ${S.busy ? 'disabled' : ''}><img src="${item.image}" alt="手写图片 ${item.sourceId}"></button><span>手写 ${item.sourceId}<small>训练 ${item.steps} 次</small></span></div></td><td class="record-digit">${item.output.digit}</td><td>${percent(item.output.probs[item.output.digit])}</td><td>${ranked(item.output)[1].digit}（${percent(ranked(item.output)[1].prob)}）</td></tr>`).join('');
  }
}
function render() {
  renderNavigation(); renderInput(); renderCompute(); renderPrediction(); renderWeights(); renderRecords(); window.labChanged?.();
}

// [B1/F2] 所有运算先使用本张输入的参数快照，预测阶段才转换 softmax。
async function scan(f, tempo = {scanBatch: 24, scan: 18, bias: 70}, visible = true) {
  S.scanActive = visible;
  S.region = 'compute';
  if (visible) render();
  while (f.processed < 216) {
    const end = Math.min(216, f.processed + tempo.scanBatch);
    for (let i = f.processed; i < end; i++) {
      f.lastTerm = {index: i, prior: f.raw.slice()};
      for (let j = 0; j < 10; j++) f.raw[j] += f.sample.pixels[i] * f.params.weights[i][j];
    }
    f.processed = end;
    if (visible) {
      renderCompute();
      if (S.mode !== 'draw') paintGrid($('sourceCanvas'), f.sample.pixels, false, end - 1);
      await wait(tempo.scan);
    }
  }
  f.biasAdded = true;
  f.output = M.predict(f.params, f.sample.pixels);
  f.phase = 'computed';
  S.scanActive = false;
  if (visible) {
    computeCache = null; renderCompute();
    await wait(tempo.bias);
  }
}
// 统一锁住操作，防止重复点击、扫描中换图或手写修改造成快照错配。
async function runAction(work) {
  if (S.busy) return;
  S.busy = true; render();
  try {await work();}
  catch (error) {if (error.name !== 'AbortError') { console.error(error); notice('操作未完成：' + error.message); } window.labRecover?.();}
  finally {
    S.busy = false; S.autoActive = false; S.scanActive = false;
    S.region = nextRegion(); render();
  }
}
function commitTraining(f) {
  if (f.params.steps !== S.net.steps) throw Error('本张计算参数已变化，请重新计算');
  f.update = M.train(S.net, f.sample); f.phase = 'updated';
  if(S.trainingCursor !== null) {
    S.trainingOverrides[f.params.steps] = f.sample.id;
    S.trainingCursor=(S.trainingCursor+1)%trainingPool().length;
  }
  S.history.push(M.snapshot(S.net, f.sample));
  // 每个次数拥有独立测试记录；新训练不能覆盖此前测试与手写快照。
  if (S.followLive) S.historyIndex = S.net.steps;
}
async function testCurrent() {
  if (S.mode !== 'test' || S.testFrame.phase !== 'ready') return;
  await runAction(async () => {
    const f = S.testFrame;
    await scan(f);
    S.region = 'prediction'; f.phase = 'tested';
    testSnapshot(f.params.steps, true).results[S.testIndex] = copyOutput(f.output);
    if (f.params.steps === 0 && !S.baselineIds?.length && testedCount(0) >= BASELINE_REQUIRED) {
      // 达到五张时固定对照组；之后额外测试不改变这组图片。
      S.baselineIds = D.testing.filter((_,i)=>testSnapshot(0).results[i]).slice(0,BASELINE_REQUIRED).map(sample=>sample.id);
    }
    S.testSnapshotSteps = f.params.steps;
    render(); await wait(300);
  });
}
async function predictDrawing() {
  if (S.busy || S.mode !== 'draw' || !S.drawPixels.some(Boolean)) return;
  await runAction(async () => {
    // 重测必须重新取当前参数，不能继续使用调出快照时的历史参数。
    const f = makeFrame({id: '手写输入', pixels: S.drawPixels.slice()});
    S.drawFrame = f; computeCache = null;
    S.followLive = true; S.historyIndex = S.net.steps;
    await scan(f);
    // [B2/F3] 复制笔迹并独立生成图片，后续擦写和清空不会修改旧快照。
    const image = document.createElement('canvas'); image.width = 120; image.height = 180;
    paintGrid(image, f.sample.pixels);
    // [F6/B2] 图片编号标识同一笔迹，记录编号标识每次测试；重测不会改变图片编号。
    const samePixels = S.drawSnapshots.find(item => sameDrawing(item.pixels, f.sample.pixels));
    const sourceId = samePixels?.sourceId ?? S.drawSourceId ?? S.nextDrawSourceId++;
    S.drawSourceId = sourceId;
    if (!S.drawSnapshots.some(item => item.steps === f.params.steps && sameDrawing(item.pixels, f.sample.pixels))) {
      const id = Math.max(0, ...S.drawSnapshots.map(item => item.id)) + 1;
      S.drawSnapshots.push({id, sourceId, steps: f.params.steps,
        pixels: f.sample.pixels.slice(), image: image.toDataURL(), output: copyOutput(f.output)});
    }
    S.drawSnapshotFilter = String(f.params.steps);
    S.region = 'prediction'; f.phase = 'tested'; render(); await wait(300);
  });
}
async function trainBatch(count) {
  if (S.busy || S.mode !== 'train' || !Object.hasOwn(TRAINING_THRESHOLDS, count) || (progressLocksEnabled && (!baselineReady() || S.net.steps < TRAINING_THRESHOLDS[count]))) return;
  await runAction(async () => {
    const tempo = TRAINING_TEMPOS[count];
    S.autoActive = count > 1; S.autoStop = false; S.autoDone = 0; S.autoTarget = count;
    S.stage = S.net.steps || count > 1 ? 'auto' : 'manual';
    for (let n = 0; n < count; n++) {
      // 首次用数字1衔接活动1，其后100张均衡循环；重复点任何按钮都接着当前模型训练。
      const id = S.net.steps === 0 ? D.firstTraining : D.trainingOrder[(S.net.steps - 1) % D.trainingOrder.length];
      const pool=trainingPool();
      const sample=S.trainingCursor===null?D.training.find(sample=>sample.id===id):pool[S.trainingCursor];
      const f = makeFrame(sample);
      // 大批次只减少画面刷新，不能跳过任何训练，也不能漏存历史。
      const visible = n % tempo.displayEvery === 0 || n === count - 1;
      S.trainFrame = f;
      if (visible) {S.region = 'input'; render(); await wait(tempo.input);}
      await scan(f, tempo, visible);
      S.region = 'prediction'; f.phase = 'measured';
      if (visible) {render(); await wait(tempo.prediction);}
      S.region = 'update'; commitTraining(f); S.autoDone++;
      if (visible) {render(); await wait(tempo.update);}
      if (S.autoStop) break;
    }
    S.stage = 'auto';
    notice(`本批完成 ${S.autoDone} 次更新，当前累计 ${S.net.steps} 次。可切换模式测试。`);
  });
}

// [F1] 手写直接落在 12×18 二值输入上，拖动补齐路径；不提交训练标签。
function renderDrawing() {
  // 映射与当前显示的预测使用同一组参数；手动拖时间轴不改变笔迹或结果。
  const model = S.drawFrame.output ? S.drawFrame.params : S.net;
  const weights = S.drawWeightMapping ? model.weights.map(row => row[S.drawWeightDigit]) : null;
  paintGrid($('drawingCanvas'), S.drawPixels, false,
    document.activeElement === $('drawingCanvas') && drawingPointer === null ? S.keyboardPixel : -1, weights, S.drawInkOpacity);
  $('drawWeightToggle').checked = S.drawWeightMapping;
  // 保留三个控件的位置；关闭映射时禁用滑条和数字选择，避免开关引起布局变化。
  $('drawInkOpacity').disabled = !S.drawWeightMapping;
  $('drawInkOpacity').value = Math.round(S.drawInkOpacity * 100);
  $('drawInkOpacity').setAttribute('aria-valuetext', `${Math.round(S.drawInkOpacity * 100)}%`);
  $('drawInkOpacity').title = `笔迹不透明度 ${Math.round(S.drawInkOpacity * 100)}%`;
  $('drawWeightDigit').disabled = !S.drawWeightMapping;
  $('drawWeightDigit').value = S.drawWeightDigit;
  $('drawingCanvas').setAttribute('aria-label', `手写输入板：鼠标或触摸绘制，也可用方向键移动，空格涂写，Delete擦除${S.drawWeightMapping ? `；背景为训练${model.steps}次模型通向数字${S.drawWeightDigit}的权重` : ''}`);
}
function invalidateDrawing() {
  // 真正修改笔迹后作为新图片；保存过的像素副本仍保留在历史中。
  S.drawSourceId = null;
  $('sampleName').textContent = '写下一个 0—9 的数字';
  $('sampleTag').textContent = `训练 ${S.net.steps} 次后`;
  S.drawFrame = makeFrame({id: '手写输入', pixels: S.drawPixels.slice()});
  computeCache = null;
  renderCompute(); renderPrediction(); renderDrawing();
  $('drawPredictButton').disabled = !S.drawPixels.some(Boolean);
  $('drawPredictButton').textContent = '预测手写数字';
  $('inputActionHint').textContent = S.drawPixels.some(Boolean) ? '预测后自动保存图片和结果；清空画板也会保留快照。' : '先写一个数字，再观察模型预测。';
}
function drawingPoint(event) {
  const box = $('drawingCanvas').getBoundingClientRect();
  return {x: Math.max(0, Math.min(11, Math.floor((event.clientX - box.left) / box.width * 12))),
    y: Math.max(0, Math.min(D.rows - 1, Math.floor((event.clientY - box.top) / box.height * D.rows)))};
}
function paintStroke(point) {
  const previous = drawingLast || point;
  const steps = Math.max(Math.abs(point.x - previous.x), Math.abs(point.y - previous.y), 1);
  let changed = false;
  for (let n = 0; n <= steps; n++) {
    const x = Math.round(previous.x + (point.x - previous.x) * n / steps);
    const y = Math.round(previous.y + (point.y - previous.y) * n / steps);
    const index = y * 12 + x;
    if (S.drawPixels[index] !== S.drawTool) {S.drawPixels[index] = S.drawTool; changed = true;}
  }
  drawingLast = point;
  if (changed) { invalidateDrawing(); window.labChanged?.(); }
}
function loadDrawingSnapshot(id) {
  if (S.busy || S.mode !== 'draw' || drawingPointer !== null) return;
  const snapshot = S.drawSnapshots.find(item => item.id === id);
  if (!snapshot) return;
  // 只回看历史帧，不修改当前模型；计算、结果及权重都对应当时的训练次数。
  S.drawPixels = snapshot.pixels.slice();
  S.drawSourceId = snapshot.sourceId;
  S.drawFrame = makeFrame({id: `手写 ${snapshot.sourceId}`, pixels: S.drawPixels.slice()});
  const f = S.drawFrame;
  f.params = M.snapshot(S.history[snapshot.steps]);
  f.output = copyOutput(snapshot.output); f.phase = 'tested'; f.processed = 216;
  f.raw = f.output.scores.map((score, j) => score - f.params.bias[j]);
  f.lastTerm = {index: 215}; f.biasAdded = true;
  S.historyIndex = snapshot.steps; S.followLive = snapshot.steps === S.net.steps;
  drawingLast = null; computeCache = null; S.region = 'input';
  render();
  $('drawingCanvas').scrollIntoView({block: 'center'});
}
function showSample(group, index) {
  const sample = group==='own'?S.ownSamples[index]:group==='shared'?S.sharedDatasets[S.activeDatasetVersion].samples[index]:D[group][index];
  $('dialogTitle').textContent = (group === 'training' ? '训练图片 ' : group === 'own' ? '自写训练图片 ' : group === 'shared' ? '班级训练图片 ' : '测试图片 ') + sample.id;
  $('dialogContent').innerHTML = `<img src="${sampleImage(sample)}" alt="${sample.id}的12列18行点阵"><p>${group !== 'testing' ? '正确标签：' + sample.label + ' · ' : ''}12 列 × 18 行；有笔迹为 1，无笔迹为 0。</p>`;
  $('sampleDialog').showModal();
}

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
$('testPicker').addEventListener('click', event => {
  const button = event.target.closest('[data-test-index]'); if (button) selectTest(Number(button.dataset.testIndex));
});
$('testCurrentButton').addEventListener('click', testCurrent);
$('drawPredictButton').addEventListener('click', predictDrawing);
$('drawSnapshotTable').addEventListener('click', event => {
  const button = event.target.closest('[data-draw-snapshot]');
  if (button) loadDrawingSnapshot(Number(button.dataset.drawSnapshot));
});
// 这些控件只改变画板显示，预测计算中也可调整，不清空当前结果。
$('drawWeightToggle').addEventListener('change', event => {
  S.drawWeightMapping = event.target.checked; renderDrawing();
});
$('drawWeightDigit').addEventListener('change', event => {
  S.drawWeightDigit = Number(event.target.value); renderDrawing();
});
$('drawInkOpacity').addEventListener('input', event => {
  S.drawInkOpacity = Number(event.target.value) / 100; renderDrawing();
});
$('testSnapshotSelect').addEventListener('change', event => {
  S.testSnapshotSteps = Number(event.target.value); renderRecords();
});
$('drawSnapshotSelect').addEventListener('change', event => {
  S.drawSnapshotFilter = event.target.value; renderRecords();
});
document.querySelectorAll('[data-train-count]').forEach(button => button.addEventListener('click', () => trainBatch(Number(button.dataset.trainCount))));
$('stopAutoButton').addEventListener('click', () => {S.autoStop = true; renderInput();});
$('resetButton').addEventListener('click', () => {if (!S.busy) reset();});
$('timeline').addEventListener('input', event => {
  S.historyIndex = Number(event.target.value); S.followLive = S.historyIndex === S.net.steps; renderWeights();
});
$('liveWeights').addEventListener('click', () => {S.followLive = true; S.historyIndex = S.net.steps; renderWeights();});
$('penButton').addEventListener('click', () => {S.drawTool = 1; renderInput();});
$('eraserButton').addEventListener('click', () => {S.drawTool = 0; renderInput();});
$('clearDrawing').addEventListener('click', () => {
  if (S.busy) return;
  S.drawPixels.fill(0); drawingLast = null; invalidateDrawing();
});
const drawing = $('drawingCanvas');
drawing.addEventListener('pointerdown', event => {
  if (S.busy || S.mode !== 'draw' || drawingPointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); drawing.focus({preventScroll: true});
  drawingPointer = event.pointerId; drawingLast = null;
  drawing.setPointerCapture(event.pointerId); paintStroke(drawingPoint(event));
});
drawing.addEventListener('pointermove', event => {
  if (!S.busy && drawingPointer === event.pointerId) paintStroke(drawingPoint(event));
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) drawing.addEventListener(name, event => {
  if (drawingPointer !== event.pointerId) return;
  if (drawing.hasPointerCapture(event.pointerId)) drawing.releasePointerCapture(event.pointerId);
  drawingPointer = null; drawingLast = null;
});
drawing.addEventListener('keydown', event => {
  if (S.busy || S.mode !== 'draw') return;
  const moves = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -12, ArrowDown: 12};
  if (Object.hasOwn(moves, event.key)) {
    event.preventDefault();
    const x = S.keyboardPixel % 12;
    if ((event.key !== 'ArrowLeft' || x > 0) && (event.key !== 'ArrowRight' || x < 11)) S.keyboardPixel = Math.max(0, Math.min(215, S.keyboardPixel + moves[event.key]));
    renderDrawing();
  } else if ([' ', 'Enter', 'Delete', 'Backspace'].includes(event.key)) {
    event.preventDefault();
    const value = ['Delete', 'Backspace'].includes(event.key) ? 0 : S.drawTool;
    if (S.drawPixels[S.keyboardPixel] !== value) {S.drawPixels[S.keyboardPixel] = value; invalidateDrawing(); window.labChanged?.();}
  }
});
drawing.addEventListener('focus', renderDrawing); drawing.addEventListener('blur', renderDrawing);
for (const id of ['trainingGallery', 'testingGallery']) $(id).addEventListener('click', event => {
  const button = event.target.closest('[data-gallery]'); if (button) showSample(button.dataset.gallery, Number(button.dataset.sampleIndex));
});
$('closeDialog').addEventListener('click', () => $('sampleDialog').close());
buildViews(); reset();

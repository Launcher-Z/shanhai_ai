/*
 * [F1] 学习流程和模式；[F2] 逐点加权计算；[F3] 预测、损失与参数对照。
 * 预测和测试只读。只有更新按钮和追加训练会调用模型的 train。
 */
'use strict';
// 测试仅跳过学习顺序，不伪造测试快照、训练次数或参数更新。
const progressLocksEnabled = new URLSearchParams(location.search).get('progress-locks') !== 'off';

const D = window.ActivityData;
const M = window.DigitModel;
const $ = id => document.getElementById(id);
const fmt = v => Number(v).toFixed(4);
const percent = v => (v * 100).toFixed(1) + '%';
const clone = value => JSON.parse(JSON.stringify(value));
// 手动观察次数与追加次数统一定义，测试图片仍固定为 5 张。
const MANUAL_TRAINING_COUNT = 3;
const TOTAL_TRAINING_COUNT = MANUAL_TRAINING_COUNT + 100;
// 数值逐步出现属于教学过程，不能因系统减少动效偏好而变成零等待。
// 关闭或切换活动后，中止本次播放；已经完成的参数更新仍保留。
const wait = ms => new Promise((resolve, reject) => {
  const epoch = window.labEpoch || 0;
  setTimeout(() => epoch === (window.labEpoch || 0) ? resolve() : reject(new DOMException('演示已暂停', 'AbortError')), ms);
});
let S, toastTimer;
let computeViewFrame, computeViewScale, computeViewCells=[];

function frame(sample) {
  return { sample, phase:'ready', output:null, update:null, processed:0, raw:[0,0],lastTerm:null,
    weights:clone(S.net.weights), bias:S.net.bias.slice(), steps:S.net.steps };
}
function reset() {
  S = {net:M.create(D.seed,D.learningRate),stage:'input',mode:'train',mapping:0,started:false,
    mappingSeen:false,trainingStarted:false,trainIndex:0,trainFrame:null,autoFrame:null,autoActive:false,testFrame:null,testRound:'before',testIndex:0,
    before:Array(5).fill(null),after:Array(5).fill(null),records:[],selected:null,busy:false,scanIndex:-1,
    scanActive:false,scanPaused:false,scanPhase:'idle',singleSteps:0,resumeScan:null,operationRegion:null};
  S.trainFrame = frame(D.training.find(s => s.id === D.firstFive[0]));
  S.testFrame = frame(D.testing[0]);
  $('autoProgress').value = 0;
  $('selectedDetail').open = false;
  $('status').textContent = '';
  render();
}
function current() {
  // 图片映射沿用首张固定测试图，开始测试时保持同一张；训练另用数字 1。
  if(!S.started) return S.testFrame;
  return S.mode === 'train' ? (S.stage === 'manual' ? S.trainFrame : S.autoFrame||S.trainFrame) : S.testFrame;
}
// 允许按任意顺序测试；按固定图片索引保存，不能用数组长度表示已测张数。
function testedCount(round) { return S[round].filter(Boolean).length; }
function notice(message) {
  clearTimeout(toastTimer);
  $('status').textContent = message;
  toastTimer = setTimeout(() => { $('status').textContent = ''; },4500);
}
function available(stage) {
  return !progressLocksEnabled || stage === 'input' || (stage === 'before' && S.mappingSeen) ||
    (stage === 'manual' && testedCount('before') === 5) ||
    (stage === 'auto' && S.records.length === MANUAL_TRAINING_COUNT) ||
    (stage === 'after' && S.net.steps === TOTAL_TRAINING_COUNT);
}
function go(stage) {
  if(S.busy || !available(stage)) return;
  S.stage = stage;
  if(stage === 'before' || stage === 'after') {
    S.mode = 'test';
    const round = stage === 'after' ? 'after' : 'before';
    const results = S[round];
    S.testRound = round;
    S.testIndex = results.findIndex(result=>!result);
    if(S.testIndex<0) S.testIndex=4;
    // 已完成的测试用保存的快照回看，不能用训练后的模型重写基线。
    S.testFrame = results[S.testIndex] || frame(D.testing[S.testIndex]);
  } else S.mode = 'train';
  render();
}
function setMode(mode) {
  if(S.busy||!S.started||(progressLocksEnabled&&mode==='train'&&testedCount('before')<5)) return;
  S.mode = mode;
  if(mode==='train') S.trainingStarted=true;
  if(mode === 'test') {
    const round = S.net.steps === TOTAL_TRAINING_COUNT ? 'after' : 'before';
    if(round !== S.testRound) {
      S.testRound = round;
      S.testIndex = 0;
      S.testFrame = S[round][0] || frame(D.testing[0]);
    }
  }
  if(mode==='train'&&S.stage==='before') S.stage='manual';
  if(mode==='test'&&S.net.steps===TOTAL_TRAINING_COUNT) S.stage='after';
  render();
}
function selectTest(index) {
  if(S.busy||S.mode!=='test') return;
  S.testIndex=index;
  // 已测试的图片直接恢复快照；不会重新测试或覆盖训练前结果。
  S.testFrame=S[S.testRound][index] || frame(D.testing[index]);
  render();
  $('testPicker').querySelector(`[data-test-index="${index}"]`)?.focus({preventScroll:true});
}
function targetColor(value, scale) {
  if(Math.abs(value)<1e-12) return '#f9fafb';
  const ratio = Math.min(Math.abs(value)/scale,1);
  const channel = value < 0 ? [35,100,176] : [189,54,65];
  const mixed = channel.map(v => Math.round(249 + (v - 249)*ratio));
  return `rgb(${mixed.join(',')})`;
}
function colorScale(f) {
  const values = f.weights.flat();
  if(f.update) values.push(...f.update.weightsAfter.flat());
  return Math.max(.12,...values.map(Math.abs));
}
// 网格不从全局模型推断动画进度，使用当前模式的快照。
function grid(values,kind,scale,outputClass=null,blank=false) {
  const f = current();
  return values.map((value,i) => {
    const isPixel = kind === 'pixel';
    const chosen = S.selected === i;
    const scanning = S.scanIndex === i;
    const label = `第 ${Math.floor(i/6)+1} 行第 ${i%6+1} 列，${isPixel ? '输入 '+value : blank ? '尚未更新' : (kind==='delta'?'权重改变量 ':'权重 ')+fmt(value)}`;
    const style = isPixel ? '' : `style="background:${targetColor(value,scale)};color:${Math.abs(value)/scale>.65 ? '#fff' : '#203448'}"`;
    return `<button type="button" data-pixel="${i}" ${outputClass === null ? '' : `data-output="${outputClass}"`} class="${isPixel&&value===1?'ink ':''}${chosen?'selected ':''}${scanning?'scanning ':''}${i<f.processed?'visited':''}" ${style} aria-label="${label}" aria-pressed="${chosen}" title="${label}" ${blank?'disabled':''}>${isPixel ? value : ''}</button>`;
  }).join('');
}
// 扫描时复用三张图的像素元素，只移动高亮；换图片或色阶时才重建。
function refreshComputeGrids(f,scale) {
  if(computeViewFrame!==f||computeViewScale!==scale) {
    $('computePixels').innerHTML=grid(f.sample.pixels,'pixel',1);
    for(let j=0;j<2;j++) $('computeWeights'+j).innerHTML=grid(f.weights.map(w=>w[j]),'weight',scale,j);
    computeViewCells=['computePixels','computeWeights0','computeWeights1'].map(id=>Array.from($(id).children));
    computeViewFrame=f;
    computeViewScale=scale;
  }
  for(const cells of computeViewCells) cells.forEach((cell,i)=>{
    cell.classList.toggle('selected',i===S.selected);
    cell.classList.toggle('scanning',i===S.scanIndex);
    cell.classList.toggle('visited',i<f.processed);
    cell.setAttribute('aria-pressed',i===S.selected);
  });
}
function renderNavigation() {
  // 阶段属性仅用于收起后续步骤的控件，不改变训练与札记的解锁判定。
  document.body.dataset.stage=S.stage;
  const done = {input:S.mappingSeen,before:testedCount('before')===5,manual:S.records.length===MANUAL_TRAINING_COUNT,auto:S.net.steps===TOTAL_TRAINING_COUNT,after:testedCount('after')===5};
  document.querySelectorAll('[data-stage]').forEach(item => {
    const stage = item.dataset.stage;
    item.classList.toggle('done',done[stage]);
    if(stage === S.stage) item.setAttribute('aria-current','step');
    else item.removeAttribute('aria-current');
  });
  const tasks = {
    input:'观察图片怎样变成数值。预测时，模型接收 60 个像素值。',
    before:'先逐张测试 5 张图片，保存模型预测。测试不会更新参数，也不提供对错判断。',
    manual:'观察前 3 次训练：计算预测 → 衡量误差 → 调整参数。',
    auto:S.net.steps===TOTAL_TRAINING_COUNT ? '已完成 103 次训练。用同一组 5 张测试图片检查变化。' : '单步观察已完成。再训练 100 次，继续调整参数。',
    after:testedCount('after')===5 ? '比较两轮测试结果，再回到学习单整理神经网络的学习过程。' : '再次逐张测试同一组图片，对照训练前后的结果。'
  };
  $('taskText').textContent = tasks[S.stage];
  $('trainCount').textContent = S.net.steps;
  $('beforeNav').textContent = `${testedCount('before')} / 5 张已测试`;
  $('manualNav').textContent = `${S.records.length} / ${MANUAL_TRAINING_COUNT} 次已训练`;
  $('afterNav').textContent = `${testedCount('after')} / 5 张已测试`;
  $('resetButton').disabled = S.busy;
}
function renderInput() {
  const f = current(), sample = f.sample;
  for(const mode of ['train','test']) {
    $(mode+'Mode').setAttribute('aria-pressed',S.mode === mode);
    $(mode+'Mode').disabled = S.busy||(progressLocksEnabled&&mode==='train'&&testedCount('before')<5);
  }
  $('modeHint').textContent = !S.started ? '先观察图片，再把每个像素映射为 0 或 1。' : S.mode === 'train' ? '使用预制训练图片，标签用于计算误差并更新参数。' : '固定 5 张图片逐一预测，只保存模型结果，不更新参数。';
  $('sampleName').textContent = !S.started ? `观察图片 ${sample.id}` : S.mode === 'train' ? `训练图片 ${sample.id}` : `固定测试 ${S.testIndex+1} / 5 · ${sample.id}`;
  $('sampleTag').textContent = !S.started ? '6 列 × 10 行' : S.mode === 'train' ? S.autoFrame?`自动 ${f.steps-MANUAL_TRAINING_COUNT+1} / 100`:`第 ${S.trainIndex+1} 次单步观察` : S.testRound === 'before' ? '训练前' : '训练后';
  $('sourceImage').src = sample.image;
  $('sourceImage').hidden = S.mapping > 0;
  $('sourceGrid').hidden = S.mapping === 0;
  $('sourceGrid').innerHTML = grid(sample.pixels,'pixel',1);
  if(S.mapping===1) $('sourceGrid').querySelectorAll('button').forEach(b => {b.textContent='';});
  $('sourceCaption').textContent = ['原始教学图片','划分为 6 列 × 10 行，位置与权重一一对应','有笔迹的位置记为 1，无笔迹的位置记为 0'][S.mapping];
  $('mappingButton').textContent = S.mapping===0?'把图片分成点阵':'映射为 0、1 输入值';
  $('mappingButton').hidden=S.mappingSeen;
  $('mappingButton').disabled = S.busy;
  $('trainingCounter').hidden = !S.mappingSeen;
  $('inputLabelBox').hidden = !S.started||S.mode === 'test';
  // 训练标签随样本呈现，但模型的输入仍然只有像素；测试不呈现标签。
  $('inputLabel').textContent = S.mode === 'test' ? '' : `数字 ${sample.label}`;
  const test=S.mode==='test';
  $('nextTrainingControls').hidden=!S.started||test;
  $('nextTrainingButton').disabled=S.busy||f.phase!=='updated'||S.records.length>=MANUAL_TRAINING_COUNT;
  $('inputActions').hidden=!S.started;
  $('testPicker').hidden=!test;
  // 已测试是流程进度，不表示预测正确；使用蓝色状态牌，避免与对错颜色混淆。
  $('testPicker').innerHTML=D.testing.map((s,i)=>{
    const tested=Boolean(S[S.testRound][i]);
    return `<button data-test-index="${i}" class="${tested?'is-tested':'is-untested'}" aria-pressed="${S.testIndex===i}" ${S.busy?'disabled':''}><img src="${s.image}" alt="固定测试图片 ${s.id}"><span>${s.id}</span><small class="test-state">${tested?'已测试':'未测试'}</small></button>`;
  }).join('');
  $('testCurrentButton').hidden=!test;
  const valid=S.testRound==='before'?S.net.steps===0:!progressLocksEnabled||S.net.steps===TOTAL_TRAINING_COUNT;
  $('testCurrentButton').disabled=S.busy||!valid||f.phase!=='ready';
  $('autoTrainButton').hidden=test;
  $('autoTrainButton').disabled=S.busy||S.net.steps>=TOTAL_TRAINING_COUNT||(progressLocksEnabled&&(S.net.steps<MANUAL_TRAINING_COUNT||S.records.length!==MANUAL_TRAINING_COUNT));
  $('inputActionHint').textContent=test ? !valid?'正在回看训练前的测试快照。完成训练后再做第二轮测试。':testedCount(S.testRound)===5 ? S.testRound==='before'?'本轮已完成，选择“训练模式”开始逐次训练。':'本轮已完成，可点选图片回看预测。':f.phase==='tested'?'结果已保留。点选下一张缩略图，再测试当前图片。':'点选图片，再按“测试当前图片”。' : S.net.steps===TOTAL_TRAINING_COUNT?'训练完成。选择“测试模式”进行训练后测试。':S.records.length<MANUAL_TRAINING_COUNT?f.phase==='updated'?'点击“下一张图像”，再计算本张加权和。':'先完成当前图片的计算、核对与权重更新。':'已完成 3 次单步训练，可自动追加 100 次。';
  if(S.autoActive) $('inputActionHint').textContent='自动逐张计算、预测并更新权重，观察高亮区域与参数变化。';
}
function renderVisibility() {
  document.body.dataset.mode=S.mode;
  document.body.dataset.auto=S.autoActive?'active':'idle';
  document.body.dataset.reveal=S.started?'open':S.mappingSeen?'mapped':'input';
  document.querySelector('.compute-panel').hidden=progressLocksEnabled&&!S.mappingSeen;
  document.querySelector('.result-panel').hidden=!S.started;
  document.querySelector('.update-section').hidden=!S.started||!S.trainingStarted;
  document.querySelector('.experiment-record').hidden=!S.started;
  document.querySelector('.dataset-panel').hidden=!S.started;
  document.querySelector('footer').hidden=!S.started;
  $('modeSwitch').hidden=!S.started;
  $('computeGateway').hidden=!S.mappingSeen||S.started;
  $('computeContent').hidden=!S.started;
  $('startTestButton').disabled=S.busy||(progressLocksEnabled&&!S.mappingSeen);
}
function renderCompute() {
  const f = current(), scale = colorScale(f);
  $('computeButton').hidden=S.mode==='test';
  $('computeButton').disabled=!S.started||S.busy||S.records.length>=MANUAL_TRAINING_COUNT||f.phase!=='ready';
  const i=S.scanIndex>=0?S.scanIndex:S.selected;
  // 未选择时不借用某个像素充当默认值；扫描位置与手动选择分开管理。
  const hasPixel=i!==null;
  const x=hasPixel?f.sample.pixels[i]:null;
  $('currentInput').textContent=hasPixel?x:'—';
  $('scanLocation').textContent = hasPixel?`第 ${Math.floor(i/6)+1} 行，第 ${i%6+1} 列 · 输入 ${i+1} = ${x}`:'点击任意位置，查看输入与权重';
  $('scanProgress').value=f.processed;
  $('scanCount').textContent=`${f.processed} / 60`;
  $('scanControls').hidden=!S.scanActive||S.mode==='test'||S.autoActive;
  $('pauseScan').textContent=S.scanPaused?'继续扫描':'暂停扫描';
  $('pauseScan').disabled=!S.scanActive||forcedScanStep();
  $('nextPixel').disabled=!S.scanPaused||S.scanPhase!=='waiting'||S.singleSteps>0;
  $('nextPixel').textContent=forcedScanStep()?'计算下一点':f.processed===60?'加入偏置':'演示下一点';
  // 首次计算停在第一点时，直接引导学生找到必须点击的按钮。
  $('nextPixel').classList.toggle('is-guided',forcedScanStep()&&f.processed===0&&S.scanPhase==='waiting');
  // 一个输入图向两组权重分叉，扫描时三张图共享同一位置。
  refreshComputeGrids(f,scale);
  for(let k=0;k<2;k++) {
    const w=hasPixel?f.weights[i][k]:null;
    $('weightValue'+k).textContent=hasPixel?fmt(w):'—';
    const term=f.lastTerm;
    // 大数字实时显示已完成项的累计值，最后再加偏置；状态区分中间值和最终值。
    const started=S.scanActive||f.processed>0;
    const addingBias=S.scanActive&&S.scanPhase==='bias';
    $('sum'+k).textContent=f.output ? fmt(f.output.scores[k]) : started ? fmt(f.raw[k]+(addingBias?f.bias[k]:0)) : '—';
    $('sumStatus'+k).textContent=f.output?'最终值':started?'计算中':'待计算';
    // 结果只显示在上方大数字；下方保留当步算式的运算部分，不重复结果。
    const biasStep=Boolean(f.output)||addingBias;
    const matchingTerm=term&&term.index===i;
    const prior=biasStep?f.raw[k]:matchingTerm?term.prior[k]:f.raw[k];
    const operand=biasStep?`+ 偏置 <span>(${fmt(f.bias[k])})</span>`:`+ ${x} × <span>(${fmt(w)})</span>`;
    $('accumulator'+k).innerHTML=biasStep||hasPixel?`<span class="formula-prior">${fmt(prior)}</span><span class="formula-operation">${operand}</span>`:'等待计算';
  }
  $('computeHint').textContent=forcedScanStep() ? `前 6 个位置逐次点击“计算下一点”；已完成 ${f.processed} / 6，之后自动快速扫描。` : S.autoActive?'自动训练每批扫描 10 个像素，完成计算后进行预测与权重更新。':f.update ? `此处保留第 ${f.steps+1} 次训练更新前的计算，与下方前后对照对应。` : '两组各有 60 个权重；扫描到同一位置时，分别相乘并累加。';
}
function renderResult() {
  const f=current(), test=S.mode==='test';
  const revealed=!test&&['measured','updated'].includes(f.phase);
  // 训练分步呈现：计算阶段只展示加权和，点击“预测结果”后才显示比例与类别。
  // 内部计算快照保持完整，以便回看；测试模式一次操作即可显示完整预测。
  const output=test||revealed ? f.output : null;
  for(let j=0;j<2;j++) {
    $('prob'+j).textContent=output?percent(output.probs[j]):'—';
    $('prob'+j).hidden=!output;
    // 小比例贴边标注，保持真实条长；不会为容纳文字而增大预测比例。
    $('bar'+j).classList.toggle('compact-label',Boolean(output)&&output.probs[j]<.15);
    $('bar'+j).title=output?`数字${j}：${percent(output.probs[j])}`:'';
    // 分段条使用完整精度的宽度，两类共用一条 100% 的长度。
    $('bar'+j).style.width=output?`${output.probs[j]*100}%`:'0%';
  }
  $('probabilityEmpty').hidden=Boolean(output);
  $('probabilityEmpty').textContent=test?'等待计算':'等待预测';
  $('probabilityTrack').setAttribute('aria-label',output?`模型预测比例：数字0 ${percent(output.probs[0])}，数字1 ${percent(output.probs[1])}，合计100%`:'尚未显示预测比例');
  $('prediction').textContent=output?output.digit:'—';
  $('verdict').classList.toggle('test-verdict',test);
  $('answerTile').hidden=test;
  $('judgmentTile').hidden=test;
  $('lossBox').hidden=test;
  $('answer').textContent=test?'':f.sample.label;
  $('verdictText').textContent=test?'':revealed ? output.digit===f.sample.label?'预测正确':'预测错误' : output?'待核对':'待预测';
  $('verdictText').className=revealed ? output.digit===f.sample.label?'correct':'wrong' : '';
  $('lossValue').textContent=revealed?fmt(M.loss(output,f.sample.label)):'—';
  $('lossAfter').textContent=f.update?`本图更新后：${fmt(f.update.afterLoss)}`:'';
  $('lossCalculation').textContent=revealed ? `本图正确类别为 ${f.sample.label}，对应比例为 ${percent(output.probs[f.sample.label])}。损失 = −ln(${output.probs[f.sample.label].toFixed(6)}) ≈ ${fmt(M.loss(output,f.sample.label))}。` : '点击“预测结果”后，可查看本次损失计算。';
  $('trainingActions').hidden=test;
  $('updateActions').hidden=test;
  $('revealButton').disabled=!S.started||S.busy||f.phase!=='predicted';
  $('updateButton').disabled=!S.started||S.busy||f.phase!=='measured';
  renderComparisons();
}
function renderComparisons() {
  const f=current(), u=f.update, scale=colorScale(f), test=S.mode==='test';
  // 改变量独立定标，两类共用同一改变量色阶，避免小变化被权重色阶淹没。
  const deltas=f.weights.map((row,i)=>row.map((value,j)=>u?u.weightsAfter[i][j]-value:0));
  const deltaScale=Math.max(.0001,...deltas.flat().map(Math.abs));
  $('updateHeading').textContent=test?'测试期间 · 参数保持不变':'权重更新与变化';
  $('updateHeading').classList.toggle('frozen-parameters',test);
  $('updateStatus').textContent=test?'只读计算':u?`第 ${f.steps+1} 次更新`:'尚未更新';
  $('updateHint').textContent=test?'预测前后参数相同，改变量为 0。':'更新前 + 改变量 = 更新后；中间图独立色阶。';
  $('deltaScaleHint').textContent=`中间改变量：${test?'全部为 0':u?`色阶 ±${fmt(deltaScale)} · 红增 / 蓝减`:'等待更新 · 红增 / 蓝减'}`;
  $('learningDetail').hidden=test;
  $('weightComparisons').innerHTML=[0,1].map(j=>{
    const before=f.weights.map(w=>w[j]);
    const after=u?u.weightsAfter.map(w=>w[j]):before;
    const blank=!test&&!u;
    const delta=deltas.map(row=>row[j]);
    const biasAfter=u?u.biasAfter[j]:f.bias[j];
    return `<section class="weight-group" aria-label="数字${j}的权重变化"><h4>数字 <b>${j}</b> 的权重</h4><div class="comparison-row"><figure><figcaption>${test?'预测前':'更新前'}</figcaption><div class="pixel-grid weight-grid">${grid(before,'weight',scale,j)}</div><small class="bias-label">b = ${fmt(f.bias[j])}</small></figure><figure class="delta-figure"><figcaption>改变量 Δw</figcaption><div class="pixel-grid weight-grid delta-grid ${blank?'empty-grid':''}">${grid(delta,'delta',deltaScale,j,blank)}</div><small class="bias-label">Δb = ${blank?'—':fmt(biasAfter-f.bias[j])}</small></figure><figure><figcaption>${test?'预测后':'更新后'}</figcaption><div class="pixel-grid weight-grid ${blank?'empty-grid':''}">${grid(after,'weight',scale,j,blank)}</div><small class="bias-label">b = ${blank?'—':fmt(biasAfter)}</small></figure></div></section>`;
  }).join('');
  // 横向参数对照保留“更新前 + 改变量 = 更新后”的阅读顺序。
  $('weightComparisons').querySelectorAll('.comparison-row').forEach(row=>{
    [...row.children].slice(1).forEach((figure,index)=>{
      const sign=document.createElement('span');
      sign.className='weight-equation-sign';sign.setAttribute('aria-hidden','true');
      sign.textContent=index===0?'＋':'＝';row.insertBefore(sign,figure);
    });
  });
  if(S.selected===null) {
    $('selectedChange').textContent='点击权重位置，可查看具体数值；再次点击同一位置取消选中。';
    return;
  }
  const i=S.selected,x=f.sample.pixels[i];
  const values=[0,1].map(j=>{
    const before=f.weights[i][j],after=u?u.weightsAfter[i][j]:before;
    const delta=after-before;
    return `通向 ${j}：<strong>${fmt(before)}</strong>${u||test?` → <strong>${fmt(after)}</strong>（${delta>0?'+':''}${fmt(delta)}）`:''}`;
  });
  $('selectedChange').innerHTML=`第 ${Math.floor(i/6)+1} 行第 ${i%6+1} 列 · 输入 = ${x}<br>${values.join('<br>')}${u&&x===0?'<br>本位置输入为 0，两个权重本步不变；其他位置和偏置仍可能更新。':''}`;
}
function renderRecords() {
  for(const round of ['before','after']) {
    $(round+'Progress').textContent=`${testedCount(round)} / 5 已测试`;
    // 类别与比例一起读取当轮测试快照，不能用训练后的模型重算基线。
    const pictures=D.testing.map((sample,i)=>`<td><img src="${sample.image}" alt="固定测试${i+1}"><span>${sample.id}</span></td>`).join('');
    const predictions=D.testing.map((sample,i)=>{
      const output=S[round][i]?.output;
      return `<td class="saved-prediction">${output?`<b class="saved-class">${output.digit}</b><small class="saved-probability">（${percent(output.probs[output.digit])}）</small>`:'—'}</td>`;
    }).join('');
    $(round+'Table').innerHTML=`<tr><th scope="row">测试图片</th>${pictures}</tr><tr><th scope="row">模型预测</th>${predictions}</tr>`;
  }
  // 训练模式预留追加训练进度的位置，第 3 次完成时只揭示内容，不推移下方区域。
  const pending=S.records.length<MANUAL_TRAINING_COUNT;
  $('autoControls').hidden=S.mode!=='train';
  $('autoControls').classList.toggle('is-pending',pending);
  $('autoControls').setAttribute('aria-hidden',pending);
  $('autoProgress').value=Math.max(0,S.net.steps-MANUAL_TRAINING_COUNT);
  $('autoHint').textContent=S.autoActive?`已追加 ${S.net.steps-MANUAL_TRAINING_COUNT} / 100 次` : S.net.steps===TOTAL_TRAINING_COUNT?'已追加 100 次，共 103 次，保留最后一次训练对照。':'再自动执行 100 次，总计 103 次。';
}
function renderGallery() {
  for(const [id,samples] of [['trainingGallery',D.training],['testingGallery',D.testing]]) {
    $(id).innerHTML=samples.map(sample=>{
      const training=id==='trainingGallery';
      return `<button data-sample="${sample.id}" class="${current().sample.id===sample.id?'current':''}"><img src="${sample.image}" alt="${sample.id} 数字点阵"><span>${sample.id}</span>${training?`<span class="sample-label">标签 ${sample.label}</span>`:''}</button>`;
    }).join('');
  }
}
// 空闲时指向下一次操作，执行时留在当前区；高亮不改变几何尺寸。
function renderActivity() {
  const phase=current().phase;
  let active;
  if(S.busy) active=S.operationRegion;
  else if(!S.started) active=S.mappingSeen?'compute':'input';
  else if(S.mode==='test') active=S.testRound==='after'&&testedCount('after')===5?null:'input';
  else active={ready:'compute',predicted:'prediction',measured:'update',updated:'input'}[phase];
  for(const region of ['input','compute','prediction','update']) {
    const panel=document.querySelector(`[data-region="${region}"]`);
    panel.classList.toggle('is-active',region===active);
    panel.classList.toggle('is-running',S.busy&&region===active);
  }
}
function render() { renderVisibility();renderNavigation();renderInput();renderCompute();renderResult();renderRecords();renderGallery();renderActivity(); window.labChanged?.(); }

function forcedScanStep() {
  return progressLocksEnabled&&!S.autoActive&&S.mode==='train'&&S.trainIndex===0&&S.scanActive&&current().processed<6;
}

async function permitScanStep() {
  while(S.scanPaused&&S.singleSteps===0) {
    S.scanPhase='waiting';
    renderCompute();
    await new Promise(resolve=>{S.resumeScan=resolve;});
  }
  S.resumeScan=null;
  if(S.singleSteps>0) S.singleSteps--;
}

// 手动、测试和自动训练复用真实乘加；自动模式按批播放，缩短课堂等待。
async function scanWeightedSum(f,automatic=false) {
  const operationEpoch = window.labEpoch || 0;
  const batchSize=automatic?10:1;
  const halfDelay=automatic?12:8;
  S.scanActive=true;S.scanIndex=0;
  S.scanPaused=progressLocksEnabled&&!automatic&&S.mode==='train'&&S.trainIndex===0;
  S.singleSteps=0;S.scanPhase='idle';
  renderCompute();
  for(let start=0;start<60;start+=batchSize) {
    await permitScanStep();
    if (operationEpoch !== (window.labEpoch || 0)) throw new DOMException('演示已暂停', 'AbortError');
    const end=Math.min(start+batchSize,60);
    // 批内每个像素都参与计算，画面停在本批最后一点，显示其实际运算。
    for(let i=start;i<end;i++) {
      S.scanIndex=i;
      const x=f.sample.pixels[i];
      f.lastTerm={index:i,prior:f.raw.slice(),products:f.weights[i].map(w=>x*w),added:false};
      if(i===end-1) {
        S.scanPhase='product';renderCompute();
        await wait(S.scanPaused?180:halfDelay);
      }
      for(let j=0;j<2;j++) f.raw[j]+=f.lastTerm.products[j];
      f.lastTerm.added=true;f.processed=i+1;
    }
    S.scanPhase='sum';
    renderCompute();
    await wait(S.scanPaused?180:halfDelay);
    // 第一次训练前 6 点必须点击，完成第 6 点后自然转入自动扫描。
    if(!automatic&&S.mode==='train'&&S.trainIndex===0&&end===6) {S.scanPaused=false;renderCompute();}
  }
  await permitScanStep();
  S.scanPhase='bias';renderCompute();
  await wait(automatic?40:100);
  // 计算动画和实际预测使用同一组权重、输入与偏置。
  f.output=M.predict({weights:f.weights,bias:f.bias},f.sample.pixels);
  S.scanIndex=-1;S.scanActive=false;S.scanPaused=false;S.scanPhase='complete';
}
async function predict() {
  const f=current();
  if(S.busy||f.phase!=='ready') return;
  S.busy=true;S.operationRegion='compute';
  render();
  await scanWeightedSum(f);
  f.phase=S.mode==='train'?'predicted':'tested';
  if(S.mode==='test') S[S.testRound][S.testIndex]=clone(f);
  // 测试一次操作完成计算和预测，短暂呈现结果后回到输入区等待下一张。
  if(S.mode==='test') {
    S.operationRegion='prediction';render();
    // 训练前测试给学生多 1 秒观察预测结果；后测沿用原来的停留时间。
    await wait(S.testRound==='before'?1450:450);
  }
  S.busy=false;
  S.operationRegion=null;
  render();
}
async function revealPrediction() {
  const f=S.trainFrame;
  if(S.busy||S.mode!=='train'||f.phase!=='predicted') return;
  S.busy=true;S.operationRegion='prediction';f.phase='measured';
  render();
  await wait(450);
  S.busy=false;S.operationRegion=null;
  render();
}
async function update() {
  const f=S.trainFrame;
  if(S.busy||S.mode!=='train'||f.phase!=='measured'||S.net.steps!==f.steps) return;
  S.busy=true;S.operationRegion='update';
  // 先让当前区高亮绘制，再揭示本次参数变化；更新仍然只执行一次。
  render();await wait(60);
  const result=M.train(S.net,f.sample);
  f.update={...result,weightsAfter:clone(S.net.weights),biasAfter:S.net.bias.slice()};
  f.phase='updated';
  S.records.push(clone(f));
  if(S.records.length===MANUAL_TRAINING_COUNT) S.stage='auto';
  render();
  await wait(450);
  S.busy=false;S.operationRegion=null;
  render();
}
async function autoTrain() {
  if(S.busy||S.net.steps>=TOTAL_TRAINING_COUNT||(progressLocksEnabled&&(S.net.steps<MANUAL_TRAINING_COUNT||S.records.length!==MANUAL_TRAINING_COUNT))) return;
  S.busy=true;S.autoActive=true;S.stage='auto';S.mode='train';
  $('selectedDetail').open=false;
  // 每一轮独立保存更新前的参数，使显示的预测、损失和改变量属于同一张图。
  for(let i=S.net.steps-MANUAL_TRAINING_COUNT;i<100;i++) {
    const id=D.trainingOrder[S.net.steps%D.trainingOrder.length];
    const f=frame(D.training.find(sample=>sample.id===id));
    S.autoFrame=f;S.operationRegion='input';render();
    await wait(60);
    S.operationRegion='compute';renderActivity();
    await scanWeightedSum(f,true);
    f.phase='measured';S.operationRegion='prediction';render();
    await wait(100);
    S.operationRegion='update';renderActivity();
    // 先绘制更新区的高亮，再执行一次真实训练；计数只在参数更新后增加。
    await wait(40);
    const result=M.train(S.net,f.sample);
    f.update={...result,weightsAfter:clone(S.net.weights),biasAfter:S.net.bias.slice()};
    f.phase='updated';render();
    await wait(160);
  }
  S.autoActive=false;S.busy=false;S.operationRegion=null;
  render();
  notice('已完成 103 次训练。请用同一组测试图片检查表现。');
}
async function computeTraining() {
  if(S.busy||S.mode!=='train'||(progressLocksEnabled&&testedCount('before')<5)||S.records.length>=MANUAL_TRAINING_COUNT) return;
  if(S.trainFrame.phase==='ready') await predict();
}
function nextTrainingImage() {
  if(S.busy||S.mode!=='train'||S.trainFrame.phase!=='updated'||S.records.length>=MANUAL_TRAINING_COUNT) return;
  // 换图只准备输入和新参数快照，必须另按计算按钮才开始运算。
  S.trainIndex++;
  S.trainFrame=frame(D.training.find(sample=>sample.id===D.firstFive[S.trainIndex]));
  $('selectedDetail').open=false;
  render();
}
function selectPixel(i,button) {
  if(S.busy) return;
  // 同一位置在所有图上联动；再次点击即取消，不留下隐含的默认选择。
  S.selected=S.selected===i?null:i;
  if(S.selected===null) $('selectedDetail').open=false;
  else if(button.closest('#weightComparisons')) $('selectedDetail').open=true;
  const container=button.closest('[id]');
  const containerId=container?container.id:null;
  const output=button.dataset.output;
  render();
  // 替换网格后保留键盘焦点，避免键盘用户每次从页首重新进入。
  if(containerId) {
    const selector=`[data-pixel="${i}"]${output!==undefined?`[data-output="${output}"]`:''}`;
    $(containerId).querySelector(selector)?.focus({preventScroll:true});
  }
}
function dialogSample(id) {
  const sample=[...D.training,...D.testing].find(s=>s.id===id);
  const training=id.startsWith('T');
  $('dialogTitle').textContent=`${training?'训练':'固定测试'}图片 ${id}`;
  $('dialogContent').innerHTML=`<div class="dialog-data"><img src="${sample.image}" alt="${id}"><pre>${sample.rows.join('\n')}</pre></div><p class="dialog-note">6 列 × 10 行，共 60 个像素值，与权重位置一一对应。${training?'正确标签：数字 '+sample.label+'。':'测试图片不提供正确标签。'}<br>此处只查看数据，不改变实验图片或训练顺序。</p>`;
  $('sampleDialog').showModal();
}
document.addEventListener('click',async event=>{
  try {
  const button=event.target.closest('button');
  if(!button||button.disabled) return;
  if(button.dataset.mode) setMode(button.dataset.mode);
  else if(button.dataset.testIndex!==undefined) selectTest(Number(button.dataset.testIndex));
  else if(button.dataset.pixel!==undefined) {
    if(button.closest('#sampleDialog')) return;
    selectPixel(Number(button.dataset.pixel),button);
  }
  else if(button.dataset.sample) dialogSample(button.dataset.sample);
  else if(button.id==='mappingButton') {
    if(S.mappingSeen) return;
    S.mapping++;
    if(S.mapping===2) S.mappingSeen=true;
    render();
  }
  else if(button.id==='startTestButton') {S.started=true;S.mapping=2;go('before');}
  else if(button.id==='pauseScan') {
    if(S.mode==='test'||forcedScanStep()) return;
    S.scanPaused=!S.scanPaused;
    if(!S.scanPaused) S.resumeScan?.();
    renderCompute();
  }
  else if(button.id==='nextPixel') {S.singleSteps=1;S.resumeScan?.();renderCompute();}
  else if(button.id==='computeButton') await computeTraining();
  else if(button.id==='nextTrainingButton') nextTrainingImage();
  else if(button.id==='testCurrentButton') await predict();
  else if(button.id==='autoTrainButton') await autoTrain();
  else if(button.id==='revealButton') await revealPrediction();
  else if(button.id==='updateButton') await update();
  else if(button.id==='resetButton') reset();
  else if(button.id==='closeDialog') $('sampleDialog').close();
  } catch(error) { if (error.name !== 'AbortError') { console.error(error); notice('操作未完成，请重试。'); } window.labRecover?.(); }
});
reset();

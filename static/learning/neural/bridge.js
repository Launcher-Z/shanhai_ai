/* 适配原实验：阶段门禁、本地恢复、暂停与可由学生主动带入札记的实验摘要。 */
const isBinary = location.pathname.includes('/zero-one/');
let host, hostStep = 0, hostGate = [0], extension, classroomTraining, restoring = true;
function ranked(output) { return output.probs.map((prob,digit)=>({prob,digit})).sort((a,b)=>b.prob-a.prob); }
function compactFrame(f) {
  if (!f) return null;
  return {...f, sample: f.sample.id === '手写输入' || f.sample.id.startsWith('手写') ? {id:f.sample.id,pixels:f.sample.pixels} : {id:f.sample.id}};
}
function expandFrame(f) {
  if (!f) return null;
  return {...f, sample:[...D.training,...D.testing,...(S.ownSamples||[]),...Object.values(S.sharedDatasets||{}).flatMap(data=>data.samples)].find(sample=>sample.id===f.sample.id) || f.sample};
}
function snapshot() {
  if (isBinary) {
    const clean = {...S, busy:false, autoActive:false, scanActive:false, scanPaused:false, resumeScan:null, operationRegion:null};
    for (const key of ['trainFrame','testFrame','autoFrame']) clean[key] = compactFrame(S[key]);
    for (const key of ['before','after','records']) clean[key] = S[key].map(compactFrame);
    return {step:hostStep, experiment:clean};
  }
  // 历史权重可按固定种子和训练顺序重算，不把每次完整权重重复写入本地。
  const {history,...clean} = S;
  for (const key of ['trainFrame','testFrame','drawFrame']) clean[key] = compactFrame(S[key]);
  clean.drawSnapshots = S.drawSnapshots.map(({image,...item})=>item);
  return {step:hostStep, experiment:{...clean,busy:false,autoActive:false,scanActive:false,autoStop:false,region:'input'}, extension:extension?.snapshot()};
}
function imageOf(pixels) {
  const canvas = document.createElement('canvas'); canvas.width=120; canvas.height=180; paintGrid(canvas,pixels); return canvas.toDataURL();
}
function restore(saved) {
  if (!saved?.experiment) return;
  const previous = S;
  try {
    const net = saved.experiment.net;
    const count = isBinary ? 60 : 216, outputs = isBinary ? 2 : 10;
    if (!net || !Number.isInteger(net.steps) || net.steps < 0 || net.weights.length !== count || net.weights.some(row=>row.length!==outputs || row.some(v=>!Number.isFinite(v))) || net.bias.length!==outputs) return;
    S = saved.experiment; hostStep = saved.step || 0;
    if (isBinary) {
      for (const key of ['trainFrame','testFrame','autoFrame']) S[key]=expandFrame(S[key]);
      for (const key of ['before','after','records']) S[key]=S[key].map(expandFrame);
    } else {
      const legacySamples = !S.ownSamples;
      S.ownSamples ||= (saved.extension?.samples||[]).filter(sample=>sample.role==='train').map(sample=>({id:sample.id,label:sample.label,pixels:sample.pixels,addedAt:S.net.steps}));
      S.retiredSamples ||= [];
      S.trainingOverrides ||= {}; S.trainingCursor ??= legacySamples && S.ownSamples.length ? D.training.length : null;
      S.sharedDatasets ||= {};S.datasetMode ||= 'personal';S.activeDatasetVersion ??= null;
      for (const key of ['trainFrame','testFrame','drawFrame']) S[key]=expandFrame(S[key]);
      // 承接旧版重复快照；保留首份记录及其编号，不触碰服务器札记。
      S.drawSnapshots=uniqueDrawingSnapshots(S.drawSnapshots).map(item=>({...item,image:imageOf(item.pixels)}));
      const replay = M.create(D.seed,D.learningRate);
      S.history=[M.snapshot(replay)];
      for(let i=0;i<S.net.steps;i++) {
        const id=S.trainingOverrides[i] || (i===0?D.firstTraining:D.trainingOrder[(i-1)%D.trainingOrder.length]);
        const sample=allTrainingSamples().find(item=>item.id===id); M.train(replay,sample); S.history.push(M.snapshot(replay,sample));
      }
      buildGalleries();
      computeCache=null; weightCache=null;
    }
    recover(false);
  } catch { S=previous; hostStep=0; }
}
function recover(redraw=true) {
  S.busy=false; S.autoActive=false; S.scanActive=false;
  if (isBinary) {
    S.scanPaused=false; S.resumeScan=null; S.operationRegion=null;
    for(const key of ['trainFrame','testFrame','autoFrame']) {
      const f=S[key];
      if(f && !f.output && f.phase==='ready') S[key]={...f,processed:0,raw:[0,0],lastTerm:null};
    }
    computeViewFrame=null;
  } else {
    S.region='input';
    for(const key of ['trainFrame','testFrame','drawFrame']) {
      const f=S[key];
      if(f && f.phase==='ready') S[key]={...f,processed:0,raw:Array(10).fill(0),lastTerm:null,biasAdded:false};
    }
    computeCache=null;
  }
  if(redraw) render();
}
const savedExperiment = ExperimentStore.read();
restore(savedExperiment);
if (!isBinary) {
  extension = window.createHandwritingExtension(savedExperiment?.extension, changed);
  classroomTraining = window.createClassroomTraining(changed, step=>host?host.navigate(step):selectStep(step));
}
restoring=false;

function changed() {
  if (restoring) return;
  ExperimentStore.schedule(snapshot);
  host?.changed();
}
window.labChanged=changed;
window.labSave=()=>ExperimentStore.write(snapshot());
window.labRecover=recover;
document.addEventListener('experiment:storage-error',()=>notice('本机未能保存实验，当前仍可继续；离开前请把关键结果记入札记。'));
function allowed(step) { return hostGate===null || hostGate.includes(step); }
function selectStep(step) {
  if (!allowed(step) || S.busy) return false;
  if (isBinary) {
    if(progressLocksEnabled && (step>=1 && !S.mappingSeen || step>=2 && testedCount('before')<5 || step>=3 && S.records.length<3 || step>=4 && S.net.steps<103)) return false;
    if(step===0) { S.started=false; S.stage='input'; render(); }
    else {
      S.started=true;
      if(step>=2) S.trainingStarted=true;
      go(['input','before','manual','auto','after'][step]);
    }
  } else {
    if(progressLocksEnabled && (step>=1 && !baselineReady() || step>=2 && !S.net.steps)) return false;
    setMode(step===0?'test':step===1?'train':'draw');
    extension.show(step===3);
    classroomTraining.show(step===4);
    buildGalleries();
  }
  hostStep=step; changed(); return true;
}
function requestedStep(button) {
  if(isBinary) {
    if(button.id==='startTestButton') return 1;
    if(['computeButton','nextTrainingButton','revealButton','updateButton'].includes(button.id)||button.dataset.mode==='train') return 2;
    if(button.id==='autoTrainButton') return 3;
    if(button.dataset.mode==='test') return S.net.steps===103?4:1;
    if(button.id==='testCurrentButton') return S.testRound==='after'?4:1;
  } else {
    if(button.dataset.mode==='train'||button.dataset.trainCount) return 1;
    if(button.dataset.mode==='draw') return 2;
  }
  return null;
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button) return;
  const step=requestedStep(button);
  if(step!==null && !allowed(step)) {
    event.preventDefault(); event.stopImmediatePropagation(); notice('先提交当前分段札记，再继续下一步。'); return;
  }
  if(step!==null && step!==hostStep && !(hostStep===3 && !isBinary && step===2)) host?.navigate(step);
},true);

function predictionText(f) {
  const output=f?.output || f;
  return output?.probs ? `${output.digit}（${percent(output.probs[output.digit])}）` : '未测试';
}
function answers(step) {
  if (isBinary) {
    if(step===1) return {'baseline-record':D.testing.map((sample,i)=>`${sample.id}：${predictionText(S.before[i])}`).join('\n')};
    if(step===2) return {'manual-record':S.records.map((f,i)=>`第${i+1}次，${f.sample.id}，标签${f.sample.label}，预测${predictionText(f)}，${f.output.digit===f.sample.label?'正确':'错误'}；参数已更新，损失${fmt(f.update.beforeLoss)} → ${fmt(f.update.afterLoss)}`).join('\n')};
    if(step===4) return {'binary-comparison':D.testing.map((sample,i)=>`${sample.id}：训练0次 ${predictionText(S.before[i])} → 训练${S.net.steps}次 ${predictionText(S.after[i])}`).join('\n')};
    return {};
  }
  if(step<=1) return {[step===0?'ten-baseline':'ten-comparison']:S.testSnapshots.filter(s=>step!==0||s.steps===0).map(s=>`训练${s.steps}次\n`+D.testing.map((sample,i)=>`${sample.id}：${predictionText(s.results[i])}`).join('\n')).join('\n\n')};
  if(step===2) return {'handwriting-record':S.drawSnapshots.map(item=>{
    const top=ranked(item.output); return `手写${item.sourceId}，训练${item.steps}次：第一预测${top[0].digit}（${percent(top[0].prob)}）；第二预测${top[1].digit}（${percent(top[1].prob)}）`;
  }).join('\n')};
  return {'own-comparison':extension.summary()};
}
window.NeuralLab={
  ownTrainingSamples() {return isBinary?[]:S.ownSamples.map(sample=>({...sample,pixels:sample.pixels.slice(),image:sampleImage(sample)}));},
  baselineDigits() {return isBinary?[]:(S.baselineIds||[]).map(id=>D.testing.find(s=>s.id===id)?.label).filter(v=>v!==undefined);},
  handwritingAttempts() {
    if(isBinary) return [];
    return S.drawSnapshots.map(item=>{
      const top=ranked(item.output);
      return {id:item.id,sourceId:item.sourceId,steps:item.steps,image:item.image,
        pixels:item.pixels.join(''),
        firstDigit:top[0].digit,firstProbability:Number((top[0].prob*100).toFixed(1)),
        secondDigit:top[1].digit,secondProbability:Number((top[1].prob*100).toFixed(1))};
    });
  },
  bind(options) {host=options;hostGate=options.gate; if(!selectStep(options.step)) host?.navigate(0); render();},
  selectStep,
  setGate(gate) {hostGate=gate;},
  pause() {
    window.labEpoch=(window.labEpoch||0)+1;
    S.autoStop=true;
    if(isBinary) {S.scanPaused=false;S.resumeScan?.();}
    extension?.pause();
    // 在离开文档前立即落盘；恢复时清除未完成的扫描，绝不继续自动播放。
    ExperimentStore.write(snapshot());
  },
  resume() {host?.changed();},
  reset() {
    ExperimentStore.clear(); restoring=true; reset(); hostStep=0;
    if(!isBinary) extension=window.createHandwritingExtension(null,changed);
    if(!isBinary) classroomTraining=window.createClassroomTraining(changed,step=>host?host.navigate(step):selectStep(step));
    restoring=false; selectStep(0);
  },
  answers,
};
document.addEventListener('input',()=>changed());
document.addEventListener('change',()=>changed());
window.addEventListener('pagehide',()=>ExperimentStore.write(snapshot()));
render();

import {normalize, createClassifier, predict, trainEpoch} from './model.mjs';

const $ = id => document.getElementById(id);
// 仅按已知活动选择内置配置，不接受任意资源地址。
const params = new URLSearchParams(location.search);
const isBeasts = params.get('activity') === 'lesson-4-task-1';
const improvement = params.get('activity') === 'lesson-3-task-2';
const explore = improvement && params.get('mode') === 'explore';
const MAX_CLASSES=8,MAX_IMAGES_PER_CLASS=40;
const response = await fetch(isBeasts ? 'beasts/dataset.json' : 'dataset.json');
if (!response.ok) { $('status').textContent='内置图库加载失败，请刷新后重试。'; throw new Error('内置图库加载失败'); }
const dataset = await response.json();
let classCount = dataset.classes.length;
const imageBase = isBeasts ? 'beasts/images/' : 'images/';
const cameraEnabled = !isBeasts;
document.body.classList.toggle('four-class', isBeasts);
document.body.classList.toggle('improvement-lab', improvement);
$('camera-test-tab').hidden = !cameraEnabled;
if (isBeasts) document.querySelector('.test-tabs').hidden = true;
const preset = new Map(dataset.classes.flatMap(c=>c.images).map(image=>[image.id,image]));
const fresh = () => ({uiVersion:2,step:0,classes:dataset.classes.map((c,i)=>({name:isBeasts||improvement?c.name:`分类${i+1}`,ids:[]})),model:null,dirty:false,round:null,history:[],selectedTest:dataset.testing[0].id});
let state=fresh(), host, busy=false, generation=0, enginePromise, stream, cameraRequest=0;
let libraryTarget=0, libraryGroup=0, selection=new Set();
let testMode='image', liveTimer;
let probabilityRows=[], displayedProbabilities=Array(classCount).fill(0), probabilityTarget=null, probabilityAnimation=0;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
// 2.2/4.1只用内置图库；3.2额外图片留在内存，本地仅存编号、模型和结果。
const featureCache=new Map();
// 个人图片及本轮训练证据只留在内存；拓展实验不读写任何实验存储。
const personal=new Map();let lastEvidence=null;
const saved=explore?null:window.ExperimentStore.read();
if(saved && saved.classes?.length===classCount && saved.classes.every((c,i)=>typeof c.name==='string' && Array.isArray(c.ids) && (!isBeasts || c.name===dataset.classes[i].name))) {
  state={...fresh(),...saved,uiVersion:2,step:0};
  // 已取消个人照片入口：旧照片编号移出训练集，已有结果和札记保留。
  for(const category of state.classes){const ids=category.ids.filter(id=>preset.has(id));if(ids.length!==category.ids.length&&state.model)state.dirty=true;category.ids=ids;}
  if(state.model && (state.model.names?.length!==classCount || state.model.weights?.length!==classCount
    || !state.model.weights.every(row=>row.length===1280 && row.every(Number.isFinite))
    || state.model.bias?.length!==classCount || !state.model.bias.every(Number.isFinite))) state.model=null;
  if(improvement&&state.model&&!state.needsPersonalReselection)lastEvidence={round:state.round.number,samples:[]};
}
function element(tag,text,className) {const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(className)item.className=className;return item;}
function icon(kind) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  const paths={edit:'M4 17 16 5 20 9 8 21H4ZM14 7 18 11'};
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[kind]);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','2');svg.append(path);return svg;
}
function tell(text) {$('status').textContent=text;host?.changed();}
function save() {
  if(explore)return;
  // 保存自选图片数量以提示重新选图，不保存原图、文件名或临时地址。
  const snapshot={...state,classes:state.classes.map(c=>({...c,ids:c.ids.filter(id=>preset.has(id))})),
    needsPersonalReselection:Boolean(state.round?.extraCount)||state.classes.some(c=>c.ids.some(id=>personal.has(id)))};
  window.ExperimentStore.write(snapshot);
}
function imageUrl(id) {return personal.get(id)?.url || (preset.has(id)?`${imageBase}${preset.get(id).file}`:null);}
function counts() {return state.classes.map(c=>`${c.name} ${c.ids.length}张`).join('；');}
function changed() {stopCamera();if(state.model)state.dirty=true;save();renderStatus();renderPreview();}
function renderStatus() {
  $('training-status').textContent=state.dirty?'样本或名称已修改，请重新训练':state.model?'训练完成，可以测试':isBeasts?'为四类动物添加训练图片':'先为两个类别命名并添加图片';
  $('train').textContent=busy?'正在处理…':state.model?'重新训练':'开始训练';$('train').disabled=busy;
}
function renderClasses() {
  $('classes').replaceChildren(...state.classes.map((c,index)=>{
    const card=element('section',undefined,'class-card'),title=element('div',undefined,'class-title'),name=element('input',undefined,'class-name');
    name.value=c.name;name.maxLength=12;name.readOnly=isBeasts||(improvement&&!explore);name.setAttribute('aria-label',`分类${index+1}名称`);name.disabled=busy;
    name.addEventListener('change',()=>{const value=name.value.trim();if(!value || state.classes.some((other,i)=>i!==index&&other.name===value)){name.value=c.name;tell('类别名称不能为空或重复。');return;}c.name=value;changed();});title.append(name);if(!isBeasts&&(!improvement||explore))title.append(icon('edit'));
    const body=element('div',undefined,'class-body');body.append(element('p',c.ids.length?`${c.ids.length}张图像样本`:'添加图像样本','class-count'));
    const tools=element('div',undefined,'sample-tools'),library=element('button','添加图片');library.disabled=busy;library.addEventListener('click',()=>openLibrary(index));
    tools.append(library);
    if(improvement){
      const upload=element('button','＋','personal-plus');upload.type='button';upload.title='添加自己的训练图片';upload.setAttribute('aria-label',`为${c.name}添加自己的训练图片`);upload.disabled=busy;
      const input=element('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.multiple=true;input.hidden=true;
      upload.addEventListener('click',()=>input.click());input.addEventListener('change',()=>addPersonal(input.files,index));tools.append(upload,input);
    }
    body.append(tools);
    if(c.ids.length){const gallery=element('div',undefined,'sample-gallery');c.ids.forEach((id,i)=>{
      const url=imageUrl(id),sample=element('div',url?undefined:'需重选',`sample${url?'':' missing'}`);
      if(url){const img=element('img');img.src=url;img.alt=`${c.name}样本${i+1}`;sample.append(img);}
      const remove=element('button','×','remove-sample');remove.disabled=busy;remove.setAttribute('aria-label',`移除${c.name}样本${i+1}`);remove.addEventListener('click',()=>{c.ids=c.ids.filter(v=>v!==id);changed();renderClasses();});sample.append(remove);gallery.append(sample);
    });body.append(gallery);}card.append(title,body);return card;
  }));
  if(explore){const add=element('button','＋ 添加类别');add.type='button';add.title=`总共最多${MAX_CLASSES}个类别`;add.disabled=busy||classCount>=MAX_CLASSES;add.addEventListener('click',()=>{if(classCount>=MAX_CLASSES)return;state.classes.push({name:`分类${classCount+1}`,ids:[]});classCount=state.classes.length;changed();renderClasses();});$('classes').append(add);}
  renderStatus();
}

async function addPersonal(files,index) {
  if(busy)return;setBusy(true);const token=generation;
  try{
    for(const file of files){
      if(state.classes[index].ids.length>=MAX_IMAGES_PER_CLASS)throw new Error(`每类最多${MAX_IMAGES_PER_CLASS}张训练图片。`);
      if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择PNG、JPEG或WebP图片。');
      if(file.size>12*1024*1024)throw new Error('每张图片请控制在12MB以内。');
      // 固定测试图不能原样回流训练；测试集始终独立。
      if(!explore){const bytes=new Uint8Array(await file.arrayBuffer());
        for(const image of dataset.testing){const fixed=new Uint8Array(await (await fetch(`${imageBase}${image.file}`)).arrayBuffer());if(bytes.length===fixed.length&&bytes.every((b,i)=>b===fixed[i]))throw new Error('固定9张测试图不能加入训练，请选择其他图片。');}}
      const url=URL.createObjectURL(file);
      try{const img=await loadImage(url);if(img.naturalWidth*img.naturalHeight>25000000)throw new Error('图片像素总数请控制在2500万以内。');}
      catch(error){URL.revokeObjectURL(url);throw error;}
      if(token!==generation){URL.revokeObjectURL(url);return;}
      const id=`personal-${Date.now()}-${personal.size}`;personal.set(id,{file,url});state.classes[index].ids.push(id);
    }
    tell('图片已加入。请检查类别和画面，必要时先处理图片再重新选择。');
  }catch(error){tell(error.message);}finally{if(token===generation){changed();setBusy(false);renderClasses();}}
}
function openLibrary(index) {
  libraryTarget=index;selection=new Set();libraryGroup=Math.min(index,dataset.classes.length-1);
  const dialog=$('image-library');
  // iframe可能高于外层纸页，弹窗须在学生当前看得见的范围内居中。
  const frame=window.frameElement?.getBoundingClientRect();
  const pane=window.frameElement?.closest('.activity-body')?.getBoundingClientRect();
  if(frame&&pane){
    const top=Math.max(0,pane.top,frame.top),bottom=Math.min(parent.innerHeight,pane.bottom,frame.bottom);
    dialog.style.top=`${Math.max(12,top-frame.top+12)}px`;
    dialog.style.margin='0 auto';
    dialog.style.maxHeight=`${Math.max(180,bottom-top-24)}px`;
  }
  dialog.showModal();renderLibrary();
}
function renderLibrary() {
  $('library-title').textContent=`为“${state.classes[libraryTarget].name}”添加图片`;
  $('library-tabs').hidden=isBeasts;
  $('library-tabs').replaceChildren(...dataset.classes.map((c,i)=>{const button=element('button',c.name);button.setAttribute('aria-pressed',String(libraryGroup===i));button.addEventListener('click',()=>{libraryGroup=i;renderLibrary();});return button;}));
  $('library-images').replaceChildren(...dataset.classes[libraryGroup].images.map((image,i)=>{
    const label=element('label',undefined,'library-sample'),img=element('img');img.src=`${imageBase}${image.file}`;img.alt=`${dataset.classes[libraryGroup].name}图片${i+1}`;
    const input=element('input');input.type='checkbox';input.checked=selection.has(image.id);input.disabled=state.classes[libraryTarget].ids.includes(image.id);input.setAttribute('aria-label',`选择${dataset.classes[libraryGroup].name}图片${i+1}`);
    input.addEventListener('change',()=>{if(input.checked)selection.add(image.id);else selection.delete(image.id);updateLibraryCount();});label.append(img,input,element('span',input.disabled?'已添加':`图片${i+1}`));return label;
  }));updateLibraryCount();
}
function updateLibraryCount() {$('library-count').textContent=`已选${selection.size}张`;$('add-selected').disabled=!selection.size;}
$('select-group').addEventListener('click',()=>{dataset.classes[libraryGroup].images.forEach(image=>{if(!state.classes[libraryTarget].ids.includes(image.id))selection.add(image.id);});renderLibrary();});
$('add-selected').addEventListener('click',()=>{const c=state.classes[libraryTarget],ids=[...new Set([...c.ids,...selection])];if(ids.length>MAX_IMAGES_PER_CLASS){tell(`每类最多${MAX_IMAGES_PER_CLASS}张训练图片，请减少选择或移除已有图片。`);$('library-count').textContent=`超出上限：每类最多${MAX_IMAGES_PER_CLASS}张`;return;}c.ids=ids;changed();renderClasses();$('image-library').close();tell('图片已加入当前类别。');});
$('close-library').addEventListener('click',()=>$('image-library').close());
// 弹窗滚到边缘或没有溢出时，阻止滚轮继续带动外面的活动纸页。
$('image-library').addEventListener('wheel',event=>{
  if(event.ctrlKey||!event.deltaY)return;
  let node=event.target;
  while(node instanceof Element && $('image-library').contains(node)){
    const overflow=getComputedStyle(node).overflowY;
    const limit=node.scrollHeight-node.clientHeight;
    if(['auto','scroll'].includes(overflow)&&limit>0 && (event.deltaY<0?node.scrollTop>0:node.scrollTop<limit-1))return;
    node=node.parentElement;
  }
  event.preventDefault();
},{passive:false});
async function loadImage(url) {const img=new Image();img.src=url;await img.decode();return img;}
function script(src) {return new Promise((resolve,reject)=>{const node=document.createElement('script');node.src=src;node.onload=resolve;node.onerror=()=>{node.remove();reject(new Error('本地模型运行库加载失败'));};document.head.append(node);});}
function engine() {
  if(!enginePromise)enginePromise=(async()=>{
    tell('正在加载图像模型…');if(!window.tf)await script('vendor/tf.min.js');if(!window.mobilenet)await script('vendor/mobilenet.min.js');await window.tf.ready();
    return window.mobilenet.load({version:2,alpha:0.5,modelUrl:new URL('model/model.json',location.href).href,inputRange:[0,1]});
  })().catch(error=>{enginePromise=null;throw error;});return enginePromise;
}
async function extract(url,key) {
  if(key&&featureCache.has(key))return featureCache.get(key);const net=await engine(),img=await loadImage(url),tensor=net.infer(img,true);let features;
  try{features=normalize(await tensor.data());}finally{tensor.dispose();}if(key)featureCache.set(key,features);return features;
}
function setBusy(value) {busy=value;document.querySelectorAll('button,input').forEach(node=>{node.disabled=value;});renderStatus();}
async function train() {
  if(busy)return;
  if(state.classes.some(c=>c.ids.length>MAX_IMAGES_PER_CLASS)){tell(`每类最多${MAX_IMAGES_PER_CLASS}张训练图片，请先移除多余图片。`);return;}
  if(state.classes.some(c=>/^分类\d+$/.test(c.name))){tell('请先把默认类别名改成你要训练的动物名称。');return;}
  if(state.classes.some(c=>c.ids.length<2)){tell('请为每个类别至少添加2张训练图片。');return;}
  const token=++generation;setBusy(true);stopCamera();testMode='image';$('progress').hidden=false;$('progress').value=0;
  try{
    const samples=[],total=state.classes.reduce((sum,c)=>sum+c.ids.length,0);
    for(let label=0;label<classCount;label++)for(const id of state.classes[label].ids){const features=await extract(imageUrl(id),id);if(token!==generation)return;samples.push({features,label});$('progress').value=50*samples.length/total;tell(`正在读取图片 ${samples.length}/${total}`);await new Promise(resolve=>setTimeout(resolve,0));}
    const model=createClassifier(samples[0].features.length,state.classes.map(c=>c.name));let loss;
    for(let i=0;i<80;i++){if(token!==generation)return;loss=trainEpoch(model,samples);$('progress').value=50+(i+1)*50/80;if(i%5===0){tell(`正在训练 ${Math.round($('progress').value)}%`);await new Promise(resolve=>setTimeout(resolve,0));}}
    if(state.round)state.history=[...state.history,state.round].slice(-5);
    state.model=model;state.dirty=false;state.round={number:(state.round?.number||0)+1,at:new Date().toISOString(),counts:counts(),epochs:80,loss,results:{},custom:[]};
    lastEvidence={round:state.round.number,samples:state.classes.flatMap(c=>c.ids.filter(id=>personal.has(id)).map(id=>({category:c.name,name:personal.get(id).file.name,file:personal.get(id).file})))};
    state.round.extraCount=lastEvidence.samples.length;
    state.selectedTest='test-1';save();renderPreview();tell('训练完成。点击右侧图片，逐张查看测试结果。');
  }catch(error){tell(`训练未完成：${error.message}，请重试。`);}finally{if(token===generation){setBusy(false);renderClasses();}}
}
function prediction(features) {const probabilities=predict(state.model,features),best=probabilities.indexOf(Math.max(...probabilities));return {name:state.model.names[best],probability:probabilities[best],probabilities:state.model.names.map((name,i)=>({name,value:probabilities[i]}))};}
function readyToTest() {if(!state.model||state.dirty){tell(state.dirty?'类别或样本已修改，请重新训练。':'请先训练模型。');return false;}return true;}
function paintProbabilities(values) {
  displayedProbabilities=values;
  probabilityRows.forEach((row,i)=>{row.value.textContent=`${values[i].toFixed(1)}%`;row.fill.style.width=`${values[i]}%`;});
}
function finishProbabilityAnimation() {
  cancelAnimationFrame(probabilityAnimation);probabilityAnimation=0;
  if(probabilityTarget)paintProbabilities([...probabilityTarget]);
}
function drawProbabilities(result) {
  // 保留节点，实时预测从当前显示值过渡，不能每帧重建进度条再从零开始。
  if(!probabilityRows.length || probabilityRows.some((row,i)=>row.name!==state.model.names[i])) {
    finishProbabilityAnimation();probabilityTarget=null;displayedProbabilities=Array(classCount).fill(0);
    probabilityRows=state.model.names.map(name=>{
      const root=element('div',undefined,'probability'),label=element('div',undefined,'probability-label'),value=element('span','—');
      label.append(element('span',name),value);
      const track=element('div',undefined,'probability-track'),fill=element('div',undefined,'probability-fill');
      track.setAttribute('role','progressbar');track.setAttribute('aria-label',`${name}预测比例`);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');fill.style.width='0%';
      track.append(fill);root.append(label,track);return {root,name,value,fill,track};
    });
    $('probabilities').replaceChildren(...probabilityRows.map(row=>row.root));
  }
  if(!result) {
    cancelAnimationFrame(probabilityAnimation);probabilityAnimation=0;probabilityTarget=null;displayedProbabilities=Array(classCount).fill(0);
    probabilityRows.forEach(row=>{row.value.textContent='—';row.fill.style.width='0%';row.track.removeAttribute('aria-valuenow');});return;
  }
  const target=result.probabilities.map(p=>p.value*100);
  if(probabilityTarget && target.every((value,i)=>value===probabilityTarget[i]))return;
  cancelAnimationFrame(probabilityAnimation);probabilityTarget=target;
  probabilityRows.forEach((row,i)=>row.track.setAttribute('aria-valuenow',target[i].toFixed(1)));
  if(reducedMotion.matches){paintProbabilities(target);return;}
  const from=[...displayedProbabilities],start=performance.now(),duration=testMode==='camera'?220:600;
  function animate(now) {
    const progress=Math.min((now-start)/duration,1),eased=1-Math.pow(1-progress,3);
    paintProbabilities(target.map((value,i)=>from[i]+(value-from[i])*eased));
    probabilityAnimation=progress<1?requestAnimationFrame(animate):0;
  }
  probabilityAnimation=requestAnimationFrame(animate);
}
function renderPreview() {
  document.querySelectorAll('[data-test-mode]').forEach(tab=>{const selected=tab.dataset.testMode===testMode;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
  $('image-test-panel').hidden=testMode!=='image';$('camera-test-panel').hidden=testMode!=='camera';$('image-test-picker').hidden=testMode!=='image';
  $('preview-empty').hidden=Boolean(state.model);$('preview').hidden=!state.model;if(!state.model)return;
  const image=dataset.testing.find(image=>image.id===state.selectedTest)||dataset.testing[0],result=state.round?.results[image.id];
  $('test-image').src=`${imageBase}${image.file}`;$('test-image').alt=image.name||`测试图${image.number}`;$('test-caption').textContent=`测试图${image.number}${image.name?' · '+image.name:''}${result?'':' · 点击下方图片测试'}`;
  drawProbabilities(testMode==='image'?result:null);
  $('tests').replaceChildren(...dataset.testing.map(image=>{
    const button=element('button',undefined,`test-card${state.round?.results[image.id]?' tested':''}`),img=element('img');img.src=`${imageBase}${image.file}`;img.alt=image.name||`测试图${image.number}`;button.append(img,element('span',`图${image.number}${image.name?'·'+image.name:''}`));button.setAttribute('aria-pressed',String(state.selectedTest===image.id));button.disabled=busy||state.dirty;button.addEventListener('click',()=>testImage(image));return button;
  }));
  if(explore){
    const upload=element('button','＋','test-card personal-plus');upload.setAttribute('aria-label','上传自己的测试图片');upload.disabled=busy||state.dirty;
    const input=element('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.hidden=true;
    upload.addEventListener('click',()=>input.click());input.addEventListener('change',()=>testPersonal(input.files[0]));$('tests').append(upload,input);
  }
  host?.changed();
}
async function testPersonal(file) {
  if(!file||busy||!readyToTest())return;
  if(file.size>12*1024*1024){tell('每张图片请控制在12MB以内。');return;}
  const token=++generation,url=URL.createObjectURL(file);setBusy(true);stopCamera();
  try{const result=prediction(await extract(url));if(token!==generation)return;
    $('test-image').src=url;$('test-image').alt='自己的测试图片';$('test-caption').textContent='自己的测试图片';drawProbabilities(result);
    // 图片节点加载完成后即可释放临时地址，照片不进入结果历史或存储。
    await $('test-image').decode();tell('个人图片测试完成。');
  }catch(error){tell(`测试失败：${error.message}`);}finally{URL.revokeObjectURL(url);if(token===generation)setBusy(false);}
}
async function testImage(image) {
  if(busy||!readyToTest())return;const token=++generation;state.selectedTest=image.id;setBusy(true);stopCamera();renderPreview();
  try{const features=await extract(`${imageBase}${image.file}`,image.id);if(token!==generation)return;state.round.results[image.id]=prediction(features);save();renderPreview();tell(`图${image.number}测试完成。`);}
  catch(error){tell(`测试失败：${error.message}，请重试。`);}finally{if(token===generation){setBusy(false);renderPreview();}}
}
function stopCamera() {
  finishProbabilityAnimation();
  ++cameraRequest;clearTimeout(liveTimer);stream?.getTracks().forEach(track=>track.stop());stream=null;
  $('live-video').srcObject=null;
  $('start-live').hidden=false;$('live-status').textContent='打开摄像头后实时查看预测';
}
// 一次只计算一帧，完成后再安排下一帧；实时画面不进入固定测试记录或本地流水。
async function startLive() {
  if(!cameraEnabled||busy||testMode!=='camera'||!readyToTest())return;
  stopCamera();
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){$('live-status').textContent='当前地址不能使用摄像头，请切换图片测试。';return;}
  const token=cameraRequest,video=$('live-video');$('start-live').hidden=true;$('live-status').textContent='正在打开摄像头…';
  try{
    const next=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    if(token!==cameraRequest||testMode!=='camera'){next.getTracks().forEach(track=>track.stop());return;}
    stream=next;video.srcObject=stream;await video.play();const net=await engine();
    if(token!==cameraRequest)return;
    $('live-status').textContent='摄像头实时测试中';tell('');
    async function frame() {
      if(token!==cameraRequest||testMode!=='camera'||state.dirty)return;
      try{
        if(video.readyState>=2){
          const tensor=net.infer(video,true);let features;
          try{features=normalize(await tensor.data());}finally{tensor.dispose();}
          if(token!==cameraRequest)return;drawProbabilities(prediction(features));
        }
        liveTimer=setTimeout(frame,250);
      }catch{if(token===cameraRequest){stopCamera();$('live-status').textContent='实时测试中断，请重新开启摄像头。';}}
    }
    frame();
  }catch{if(token===cameraRequest){stopCamera();$('live-status').textContent='摄像头未能打开，请检查权限后重试。';}}
}
function switchTestMode(mode) {
  if(busy||(!cameraEnabled&&mode==='camera'))return;stopCamera();testMode=mode;renderPreview();
  if(mode==='camera')startLive();
}
document.querySelectorAll('[data-test-mode]').forEach(tab=>{
  tab.addEventListener('click',()=>switchTestMode(tab.dataset.testMode));
  tab.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const mode=event.key==='Home'?'image':event.key==='End'?'camera':testMode==='image'?'camera':'image';switchTestMode(mode);$(`${mode}-test-tab`).focus();}});
});
$('start-live').addEventListener('click',startLive);
$('train').addEventListener('click',train);
function disposePersonal(){for(const item of personal.values())URL.revokeObjectURL(item.url);personal.clear();lastEvidence=null;}
function reset() {++generation;stopCamera();testMode='image';$('image-library').close();featureCache.clear();disposePersonal();state=fresh();classCount=dataset.classes.length;if(!explore)window.ExperimentStore.clear();setBusy(false);$('progress').hidden=true;renderClasses();renderPreview();tell('');}
// 札记由学生自行观察填写，不向公共札记控制器提供结果代入接口。
window.AnimalLab={bind(value){host=value;host?.changed();},setGate(){},getStep(){return 0;},goToStep(){},resume(){renderStatus();},pause(){++generation;stopCamera();$('image-library').close();setBusy(false);save();},reset,
  trainingEvidence(){return state.model&&!state.dirty?lastEvidence:null;},
  dispose(){++generation;stopCamera();disposePersonal();featureCache.clear();}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});
window.addEventListener('pagehide',()=>{++generation;stopCamera();save();});renderClasses();renderPreview();window.dispatchEvent(new Event('animal:ready'));
if(improvement&&saved?.needsPersonalReselection)tell('上次的个人图片未保存在浏览器中。可回看已有结果；继续训练或提交训练图片前，请重新选择图片并训练。');

/* 统一使用活动 ID 查找课程信息，不把打开预览当成提交或完成。 */
import { setupReadingPane } from '../atlas/reading.js';
import { mountImageMath } from './image-math/activity.js';
import { mountImageFeatures } from './image-features/activity.js';
import { setupWorksheet } from './worksheet.js';
import { mountNeural } from './neural/activity.js';
import { mountCreation } from './creation/activity.js';
import { mountImageCode } from './image-code/activity.js';
import { mountPixelPaint } from './pixel-paint/activity.js';
import { mountPixelRedraw } from './pixel-paint/redraw.js';
import { mountAnimalClassifier } from './animal-classifier/host.js';
import { mountAnimalReview } from './animal-review/activity.js';
import { mountAnimalImprovement } from './animal-improvement/activity.js';
import { mountClassification } from './classification/activity.js';

const volumes = JSON.parse(document.getElementById('course-data').textContent);
const dialog = document.getElementById('learning-activity');
const assets = new URL('.', import.meta.url);
const activities = new Map();
let lastEntry;
let imageMath;
let imageCode;
let pixelPaint;
let pixelPaintPromise;
let pixelRedraw;
let pixelRedrawPromise;
const animalClassifiers = new Map();
let animalReview;
let animalImprovement;
const classificationLabs = new Map();
const featureLabs = new Map();
const neuralLabs = new Map();
let creationLab;
let creationVersion=0;
const creationRoot=document.createElement('section');creationRoot.className='creation-lab';creationRoot.hidden=true;
dialog.querySelector('.activity-content').append(creationRoot);

for (const volume of volumes) {
  for (const lesson of volume.lessons) {
    lesson.activities.forEach((activity, index) => {
      activities.set(activity.id, { volume, lesson, activity, index });
    });
  }
}

// 直接复用山海图的原生滚动与墨痕滑块，支持拖动、点轨道和键盘。
const reader = setupReadingPane(dialog.querySelector('.activity-body'));
const worksheet = setupWorksheet(dialog);

document.querySelector('.book-scroll').addEventListener('click', async event => {
  const entry = event.target.closest('[data-activity-id]');
  const detail = activities.get(entry?.dataset.activityId);
  if (!detail || !detail.volume.available || !detail.lesson.available || !detail.activity.available || dialog.open) return;
  const { volume, lesson, activity, index } = detail;
  const version=++creationVersion;
  const classificationKind = {'classification-tree':'tree','classification-knn':'knn'}[activity.content_type];
  dialog.classList.toggle('has-classification', Boolean(classificationKind));
  dialog.querySelectorAll('.classification-lab').forEach(root=>{root.hidden=root.id!==`classification-${classificationKind}`;});
  const isCreation=activity.content_type==='creation';
  dialog.classList.toggle('has-creation',isCreation);creationRoot.hidden=!isCreation;
  const neuralMode = {'neural-zero-one':'zero-one', 'neural-digits':'digits'}[activity.content_type];
  dialog.classList.toggle('has-neural', Boolean(neuralMode));
  dialog.querySelectorAll('.neural-lab').forEach(root => { root.hidden = root.dataset.neuralMode !== neuralMode; });
  const isImageMath = activity.content_type === 'image-math';
  const imageMathRoot = dialog.querySelector('#image-math');
  dialog.classList.toggle('has-image-math', isImageMath);
  imageMathRoot.hidden = !isImageMath;
  const isImageCode = activity.content_type === 'image-code';
  const imageCodeRoot = dialog.querySelector('#image-code');
  dialog.classList.toggle('has-image-code', isImageCode);
  imageCodeRoot.hidden = !isImageCode;
  // 人工识别只展示固定图片；学生回答统一留在服务器札记中。
  const isAnimalIdentification = activity.content_type === 'animal-identification';
  dialog.classList.toggle('has-animal-identification', isAnimalIdentification);
  dialog.querySelector('#animal-identification').hidden = !isAnimalIdentification;
  const isAnimalClassifier = activity.content_type === 'animal-classifier';
  const animalClassifierRoot = dialog.querySelector('#animal-classifier');
  animalClassifierRoot.hidden = !isAnimalClassifier;
  animalClassifierRoot.querySelectorAll('[data-classifier-activity]').forEach(root => { root.hidden = root.dataset.classifierActivity !== activity.id; });
  dialog.classList.toggle('has-animal-classifier', isAnimalClassifier);
  const isAnimalReview = activity.content_type === 'animal-review';
  const animalReviewRoot = dialog.querySelector('#animal-review');
  animalReviewRoot.hidden = !isAnimalReview;
  dialog.classList.toggle('has-animal-review', isAnimalReview);
  const isAnimalImprovement=activity.content_type==='animal-improvement';
  const improvementRoot=dialog.querySelector('#animal-improvement');
  improvementRoot.hidden=!isAnimalImprovement;
  dialog.classList.toggle('has-animal-improvement',isAnimalImprovement);
  const isPixelPaint=activity.content_type==='pixel-paint';
  const isPixelRedraw=activity.content_type==='pixel-redraw';
  const pixelPaintRoot=dialog.querySelector('#pixel-paint');
  const pixelRedrawRoot=dialog.querySelector('#pixel-redraw');
  dialog.classList.toggle('has-pixel-paint',isPixelPaint||isPixelRedraw);pixelPaintRoot.hidden=!isPixelPaint;pixelRedrawRoot.hidden=!isPixelRedraw;
  const featureMode = { 'image-edge': 'edge', 'image-hog': 'hog' }[activity.content_type];
  dialog.classList.toggle('has-image-features', Boolean(featureMode));
  dialog.classList.toggle('has-image-edge', featureMode === 'edge');
  dialog.classList.toggle('has-image-hog', featureMode === 'hog');
  dialog.querySelectorAll('.feature-lab').forEach(root => { root.hidden = root.dataset.mode !== featureMode; });
  const number = String(index + 1).padStart(2, '0');
  dialog.querySelector('.activity-context').textContent = `卷${volume.number} · ${volume.title} / 第 ${lesson.number} 课 · ${lesson.title}`;
  dialog.querySelector('.activity-number').textContent = `活动 ${number} / ${String(lesson.activities.length).padStart(2, '0')}`;
  dialog.querySelector('#activity-title').textContent = activity.title;
  dialog.querySelector('.activity-intro').textContent = lesson.intro;
  dialog.querySelector('.activity-knowledge').replaceChildren(...lesson.knowledge.map(knowledge => {
    const item = document.createElement('li');
    item.textContent = knowledge;
    return item;
  }));
  dialog.querySelector('.activity-folio').textContent = `${volume.number} · ${number}`;
  dialog.style.setProperty('--accent', volume.accent);
  dialog.style.setProperty('--activity-illustration', `url("${new URL(volume.image, assets).href}")`);
  lastEntry = entry;
  document.documentElement.classList.add('activity-open');
  document.body.classList.add('activity-open');
  dialog.showModal();
  if(classificationKind){
    worksheet.deactivate();
    const root=dialog.querySelector(`#classification-${classificationKind}`);
    try{
      if(!classificationLabs.has(classificationKind)){
        const lab=await mountClassification(root,classificationKind,step=>{reader.reset();worksheet.selectStep(step);});
        classificationLabs.set(classificationKind,lab);
      }
      const lab=classificationLabs.get(classificationKind);
      if(version!==creationVersion||!dialog.open){lab.pause();return;}
      lab.refresh();worksheet.activate(activity,lab);
    }catch(error){root.textContent=error.message;}
    reader.reset();return;
  }
  if(isCreation){
    worksheet.deactivate();
    const pane=document.createElement('div');pane.textContent='正在展开创作纸页…';creationRoot.replaceChildren(pane);
    dialog.querySelector('.note-entry').hidden=true;
    dialog.querySelector('#reset-learning-activity').hidden=true;
    try{
      const lab=await mountCreation(pane,activity);
      if(version!==creationVersion||!dialog.open){lab.pause();return;}
      creationLab=lab;
      if(activity.id==='lesson-9-task-2'||activity.progress_mode==='none')worksheet.activateCollection(activity,lab.collectionNotebook);else worksheet.activate(activity,lab);
    }catch(error){creationRoot.textContent=error.message+' 请关闭后重试。';}
    reader.reset();return;
  }
  if(isPixelPaint){
    worksheet.deactivate();
    pixelPaintRoot.querySelector('.paint-load-error')?.remove();
    try{
      pixelPaintPromise ||= mountPixelPaint(pixelPaintRoot);
      pixelPaint=await pixelPaintPromise;
      if(version!==creationVersion||!dialog.open){pixelPaint.pause();return;}
      pixelPaint.refresh();worksheet.activate(activity,pixelPaint);
    }catch(error){pixelPaintPromise=null;const message=document.createElement('p');message.className='paint-load-error';message.textContent=error.message;message.setAttribute('role','alert');pixelPaintRoot.prepend(message);}
    reader.reset();return;
  }
  if(isPixelRedraw){
    worksheet.deactivate();pixelRedrawRoot.querySelector('.paint-load-error')?.remove();
    try{
      pixelRedrawPromise ||= mountPixelRedraw(pixelRedrawRoot,()=>reader.reset());
      pixelRedraw=await pixelRedrawPromise;
      if(version!==creationVersion||!dialog.open){pixelRedraw.pause();return;}
      pixelRedraw.refresh();worksheet.activate(activity,pixelRedraw);
    }catch(error){pixelRedrawPromise=null;const message=document.createElement('p');message.className='paint-load-error';message.textContent=error.message;message.setAttribute('role','alert');pixelRedrawRoot.prepend(message);}
    reader.reset();return;
  }
  if (isImageCode) {
    imageCode ||= mountImageCode(imageCodeRoot, step => { reader.reset(); worksheet.selectStep(step); });
    imageCode.refresh();
  }
  if (isImageMath) {
    imageMath ||= mountImageMath(imageMathRoot, step => { reader.reset(); worksheet.selectStep(step); });
    imageMath.refresh();
  }
  if (featureMode) {
    if (!featureLabs.has(featureMode)) {
      featureLabs.set(featureMode, mountImageFeatures(dialog.querySelector(`#feature-${featureMode}`), step => {
        reader.reset(); worksheet.selectStep(step);
      }));
    }
    featureLabs.get(featureMode).refresh();
  }
  if (neuralMode) {
    if (!neuralLabs.has(neuralMode)) neuralLabs.set(neuralMode, mountNeural(dialog.querySelector(`#neural-${neuralMode}`), step => {
      reader.reset(); worksheet.selectStep(step);
    }));
    neuralLabs.get(neuralMode).refresh();
  }
  if (isAnimalClassifier) {
    // 两课各保留一个实验实例，切换时不混用模型或本地记录。
    if (!animalClassifiers.has(activity.id)) {
      const root = document.createElement('div');
      root.dataset.classifierActivity = activity.id;
      root.dataset.studentId = animalClassifierRoot.dataset.studentId;
      animalClassifierRoot.append(root);
      animalClassifiers.set(activity.id, mountAnimalClassifier(root, step => { reader.reset(); worksheet.selectStep(step); }, activity.id));
    }
    animalClassifiers.get(activity.id).refresh();
  }
  if (isAnimalReview) {
    animalReview ||= mountAnimalReview(animalReviewRoot);
    animalReview.refresh(activity);
  }
  if(isAnimalImprovement){
    animalImprovement ||= mountAnimalImprovement(improvementRoot,step=>{reader.reset();worksheet.selectStep(step);});
    animalImprovement.refresh();
  }
  worksheet.activate(activity, isAnimalImprovement ? animalImprovement : isAnimalReview ? animalReview : isAnimalClassifier ? animalClassifiers.get(activity.id) : isImageCode ? imageCode : neuralMode ? neuralLabs.get(neuralMode) : isImageMath ? imageMath : featureLabs.get(featureMode));
  reader.reset();
});

dialog.querySelector('.activity-entry-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  ++creationVersion;creationLab?.pause();creationLab=null;
  worksheet.close(false);
  imageMath?.pause();
  imageCode?.pause();
  pixelPaint?.pause();
  pixelRedraw?.pause();
  animalClassifiers.forEach(lab => lab.pause());
  animalReview?.pause();
  animalImprovement?.pause();
  classificationLabs.forEach(lab=>lab.pause());
  featureLabs.forEach(lab => lab.pause());
  neuralLabs.forEach(lab => lab.pause());
  document.documentElement.classList.remove('activity-open');
  document.body.classList.remove('activity-open');
  lastEntry?.focus({ preventScroll: true });
});

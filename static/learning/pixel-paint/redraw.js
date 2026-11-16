/* 观摩只读服务器已审核作品；重画复用画笔，以活动ID隔离本机第二稿。 */
import {mountPixelPaint} from './activity.js';

export async function mountPixelRedraw(root,onStepChange) {
  const editor=await mountPixelPaint(root,{activityId:'lesson-1-task-3'});
  const panels=[...root.querySelectorAll('[data-redraw-panel]')];
  const tabs=[...root.querySelectorAll('[data-redraw-step]')];
  const gallery=root.querySelector('.redraw-gallery');
  const message=root.querySelector('[data-redraw-status]');
  const refresh=root.querySelector('[data-redraw-refresh]');
  const sourceTabs=[...root.querySelectorAll('[data-redraw-source]')];
  const tip=root.querySelector('[data-redraw-tip]');
  const firstButton=root.querySelector('[data-redraw-first]');
  const viewer=root.querySelector('.redraw-lightbox');
  const image=viewer.querySelector('[data-redraw-image]');
  const imageStatus=viewer.querySelector('[data-redraw-image-status]');
  const SOURCE_META={
    'lesson-1-task-2':{
      tip:'看看同学 1.2 第一稿的帽形与配色。',
      empty:'暂无选展的 1.2 第一稿作品，可切换查看「1.3 重绘第二稿」或先开始重画。',
    },
    'lesson-1-task-3':{
      tip:'看看同学 1.3 重新提交的第二稿改进。',
      empty:'暂无选展的 1.3 重绘第二稿作品，可切换查看「1.2 第一稿」或先开始重画。',
    },
  };
  let first=null,sourceActivity='lesson-1-task-2',loadSeq=0;

  async function read(url) {
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'作品暂时未能读取。');
    return data;
  }
  function closeImage(){if(viewer.open)viewer.close();}
  function view(work,caption) {
    viewer.querySelector('#redraw-image-title').textContent=caption;
    image.alt=caption;imageStatus.textContent='正在读取大图…';
    image.src='/api/creation/media/'+work.media_id;
    viewer.showModal();
  }
  image.addEventListener('load',()=>{imageStatus.textContent='';});
  image.addEventListener('error',()=>{imageStatus.textContent='图片暂时未能读取，请关闭后刷新作品。';});
  viewer.querySelector('[data-redraw-close]').addEventListener('click',closeImage);
  viewer.addEventListener('cancel',event=>event.stopPropagation());
  viewer.addEventListener('click',event=>{if(event.target===viewer)closeImage();});
  firstButton.addEventListener('click',()=>{if(first)view(first,'我的第一稿');});

  function setSource(nextActivity) {
    sourceActivity=SOURCE_META[nextActivity]?nextActivity:'lesson-1-task-2';
    sourceTabs.forEach(tab=>tab.setAttribute('aria-pressed',String(tab.dataset.redrawSource===sourceActivity)));
    if(tip)tip.textContent=SOURCE_META[sourceActivity].tip;
  }

  async function loadGallery(targetActivity=sourceActivity) {
    const active=SOURCE_META[targetActivity]?targetActivity:'lesson-1-task-2';
    const seq=++loadSeq;
    refresh.disabled=true;message.textContent='正在展开同学的作品…';message.classList.remove('is-error');
    try {
      const data=await read('/api/pixel-paint/gallery?activity_id='+encodeURIComponent(active));
      if(seq!==loadSeq)return;
      const cards=data.entries.map(work=>{
        const card=document.createElement('button');card.type='button';card.className='redraw-work';
        const caption=`${work.author} · ${work.class_name}`;
        card.setAttribute('aria-label',`查看${caption}的作品大图`);
        const thumb=document.createElement('img');thumb.src='/api/creation/media/'+work.media_id+'/thumbnail';
        thumb.alt=work.title;thumb.loading='lazy';thumb.decoding='async';
        const author=document.createElement('span');author.textContent=work.author;
        const className=document.createElement('small');className.textContent=work.class_name;
        card.append(thumb,author,className);card.addEventListener('click',()=>view(work,caption));return card;
      });
      gallery.replaceChildren(...cards);
      message.textContent=cards.length?'':SOURCE_META[active].empty;
    } catch(error) {
      if(seq!==loadSeq)return;
      gallery.replaceChildren();message.textContent='作品暂时未能读取，请刷新重试；也可以先重画。';message.classList.add('is-error');
    } finally {
      if(seq===loadSeq)refresh.disabled=false;
    }
  }
  async function loadFirst() {
    try{first=(await read('/api/pixel-paint/first-work')).work;}
    catch{first=null;}
    firstButton.hidden=!first||editor.getStep()!==1;
  }
  function show(step,save=true) {
    closeImage();step=step===1?1:0;
    if(save)editor.goToStep(step);
    panels.forEach((panel,index)=>{panel.hidden=index!==step;});
    tabs.forEach((tab,index)=>tab.setAttribute('aria-pressed',String(index===step)));
    firstButton.hidden=!first||step!==1;
    editor.refresh();onStepChange?.();
  }
  tabs.forEach(tab=>tab.addEventListener('click',()=>{show(Number(tab.dataset.redrawStep));if(editor.getStep()===0)loadGallery();}));
  sourceTabs.forEach(tab=>tab.addEventListener('click',()=>{
    const next=tab.dataset.redrawSource;
    if(!next||next===sourceActivity)return;
    setSource(next);loadGallery(next);
  }));
  root.querySelector('[data-redraw-start]').addEventListener('click',()=>show(1));
  refresh.addEventListener('click',()=>loadGallery());
  setSource('lesson-1-task-2');
  show(editor.getStep(),false);
  return {
    ...editor,
    refresh(){show(editor.getStep(),false);loadGallery();loadFirst();},
    goToStep:show,
    pause(){closeImage();editor.pause();},
    reset(){editor.reset();setSource('lesson-1-task-2');show(0,false);loadGallery();},
  };
}

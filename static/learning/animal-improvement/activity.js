import {mountAnimalClassifier} from '../animal-classifier/host.js';

const imageBase='/static/learning/animal-classifier/images/';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};

export function mountAnimalImprovement(root,onStepChange){
  const panels=[...root.querySelectorAll('[data-improvement-panel]')],tabs=[...root.querySelectorAll('[data-improvement-step]')];
  panels.forEach(panel=>panel.dataset.studentId=root.dataset.studentId);
  const regular=mountAnimalClassifier(panels[0],()=>{},'lesson-3-task-2');
  let extension,step=0,gate=[0],data,selected,request,active=true;
  const modal=root.querySelector('dialog'),feedback=root.querySelector('[data-comparison-feedback]');
  const intros=['选择一个可能影响识别的因素，调整训练图片。保持金丝猴、雪豹两类，用相同9图和摄像头检验。','自由添加类别、训练图和测试图；本段不写札记，离开活动后清除。','对照2.2与本次正规实验的班级结果，再写下自己的判断。'];
  function allowed(value){return value===0||gate===null||gate.includes(1);}
  function show(value,notify=true){
    if(!allowed(value))return;
    regular.pause();extension?.pause();step=value;
    panels.forEach((p,i)=>p.hidden=i!==step);tabs.forEach((t,i)=>{t.setAttribute('aria-pressed',String(i===step));t.disabled=!allowed(i);});
    root.querySelector('[data-improvement-intro]').textContent=intros[step];
    if(step===0)regular.refresh();
    if(step===1){
      const note=root.closest('dialog').querySelector('#learning-note');if(!note.hidden)note.querySelector('.note-close').click();
      extension||=mountAnimalClassifier(panels[1],()=>{},'lesson-3-task-2',{explore:true});extension.refresh();
    }
    if(step===2)refreshComparison();
    if(notify&&step!==1)onStepChange(step===2?1:0);
  }
  function ratio(row,key){
    const wrap=el('div',undefined,'improvement-ratio'),labels=el('div',undefined,'improvement-ratio-labels'),track=el('div',undefined,'improvement-ratio-track');
    const baseline=key==='before'&&!row.before&&row.baseline_before;
    const values=baseline||row[key];labels.append(el('strong',key==='before'?baseline?'原训练 · 2.2（未配对）':'原训练 · 2.2':'优化后 · 3.2'),el('span',values?data.names.map((name,i)=>`${name} ${values[i].toFixed(1)}%`).join(' / '):'暂无配对数据'));
    track.setAttribute('role','img');track.setAttribute('aria-label',labels.textContent);
    for(let i=0;i<2;i++){const fill=el('span');fill.style.width=`${values?values[i]:0}%`;track.append(fill);}wrap.append(labels,track);return wrap;
  }
  function draw(){
    root.querySelector('[data-comparison-scope]').textContent=`${data.class_name} · 原训练提交${data.before_submitted}人 / 本次提交${data.after_submitted}人`;
    const cards=data.rows.map(row=>{
      const card=el('article',undefined,'improvement-card'),head=el('div',undefined,'improvement-card-head'),title=el('div');
      title.append(el('h4',row.label),el('small',`${row.count?`配对 ${row.count}人`:`尚无配对 · 2.2有效${row.baseline_count}人`}${['image-6','image-7','image-8'].includes(row.id)?' · 虚构对象':''}`));
      if(row.image_file){const button=el('button'),img=el('img');img.src=imageBase+row.image_file;img.alt=`放大${row.label}`;button.type='button';button.dataset.sourceId=row.id;button.append(img);button.addEventListener('click',()=>{selected=row.id;drawImage();modal.showModal();});head.append(button);}
      head.append(title);card.append(head,ratio(row,'before'),ratio(row,'after'));return card;
    });root.querySelector('[data-comparison-rows]').replaceChildren(...cards);
  }
  function drawImage(){
    const row=data.rows.find(r=>r.id===selected),images=data.rows.filter(r=>r.image_file);
    root.querySelector('#improvement-image-title').textContent=`${row.label} · 前后比较`;
    const img=root.querySelector('[data-comparison-image]');img.src=imageBase+row.image_file;img.alt=row.label;
    root.querySelector('[data-comparison-position]').textContent=`${images.findIndex(r=>r.id===selected)+1} / ${images.length} · ${row.count?`配对${row.count}人`:`2.2有效${row.baseline_count}人，未配对，仅供回看`}`;
    root.querySelector('[data-comparison-detail]').replaceChildren(ratio(row,'before'),ratio(row,'after'));
  }
  async function refreshComparison(){
    request?.abort();request=new AbortController();const current=request;feedback.textContent='正在读取本班对照结果…';
    try{const response=await fetch(root.dataset.api,{signal:current.signal,cache:'no-store'}),result=await response.json();if(!response.ok)throw new Error(result.error||'读取失败，请重试。');if(!active||current!==request)return;data=result;draw();if(modal.open)drawImage();feedback.textContent=!data.before_submitted?'本班还没有2.2正式提交的测试记录。':!data.after_submitted?'先回看2.2原结果；完成并提交3.2子活动1的测试札记后，再刷新查看配对对照。':data.rows.some(row=>row.count)?'':'两轮已有提交，但尚无可配对的有效记录；请核对是否为同一批学生，并检查教师排除情况。';}
    catch(error){if(error.name!=='AbortError')feedback.textContent=error.message;}
  }
  function move(direction){if(!data||!modal.open)return;const rows=data.rows.filter(r=>r.image_file),i=rows.findIndex(r=>r.id===selected);selected=rows[(i+direction+rows.length)%rows.length].id;drawImage();}
  tabs.forEach((tab,i)=>tab.addEventListener('click',()=>show(i)));
  root.querySelector('[data-comparison-refresh]').addEventListener('click',refreshComparison);
  root.querySelector('[data-comparison-close]').addEventListener('click',()=>modal.close());
  root.querySelectorAll('[data-comparison-direction]').forEach(button=>button.addEventListener('click',()=>move(Number(button.dataset.comparisonDirection))));
  modal.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}});
  modal.addEventListener('close',()=>root.querySelector(`[data-source-id="${selected}"]`)?.focus({preventScroll:true}));
  show(0,false);
  return {getStep:()=>step===2?1:0,goToStep:value=>show(value===1?2:0,false),
    setGate(value){gate=value;tabs.forEach((tab,i)=>tab.disabled=!allowed(i));},
    trainingEvidence:()=>regular.trainingEvidence(),
    refresh(){active=true;show(step,false);},
    pause(){active=false;request?.abort();regular.pause();extension?.discard();extension=null;if(step===1)step=0;modal.close();},
    reset(){regular.reset();extension?.discard();extension=null;show(0);}
  };
}

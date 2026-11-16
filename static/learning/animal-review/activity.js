import {renderAnimalChart} from '../../animal-chart.js';

/* 活动只观察本班汇总；个人观点由学生自己写入公共札记。 */
export function mountAnimalReview(root) {
  const groups=root.querySelector('[data-review-groups]'),modal=root.querySelector('dialog');
  const refreshButton=root.querySelector('[data-review-refresh]'),feedback=root.querySelector('[data-review-feedback]');
  const legend=root.querySelector('[data-review-legend]'),note=root.querySelector('[data-review-note]');
  let active=false,controller,data,selected,currentActivityId='lesson-3-task-1';
  const isBeasts=()=>currentActivityId==='lesson-4-task-2';
  const currentImageBase=()=>isBeasts()?root.dataset.beastsImageBase:root.dataset.imageBase;
  function drawImage() {
    const row=data?.rows.find(row=>row.id===selected);if(!row)return;
    root.querySelector('#animal-review-image-title').textContent=`${row.label} · 本班测试结果`;
    const image=root.querySelector('[data-review-image]');image.hidden=!row.image_file;
    root.querySelector('[data-review-image-frame]').hidden=!row.image_file;
    const position=root.querySelector('[data-review-image-position]');position.hidden=!row.image_file;
    const images=data.rows.filter(item=>item.image_file);
    position.textContent=row.image_file?`${images.findIndex(item=>item.id===selected)+1} / ${images.length}`:'';
    if(row.image_file){image.src=currentImageBase()+row.image_file;image.alt=`原测试图片${row.label}`;}else{image.removeAttribute('src');image.alt='';}
    root.querySelector('[data-review-camera]').hidden=Boolean(row.image_file);
    const values=root.querySelector('[data-review-values]');values.replaceChildren();
    const labels=document.createElement('div'),track=document.createElement('div');labels.className='animal-review-ratio-labels';track.className='animal-review-ratio-track';
    track.setAttribute('role','img');track.setAttribute('aria-label',row.means?data.names.map((name,i)=>`${name}平均预测比例${row.means[i].toFixed(1)}%`).join('，'):'暂无有效记录');
    data.names.forEach((name,i)=>{
      const key=document.createElement('span'),label=document.createElement('span'),number=document.createElement('strong'),fill=document.createElement('span');
      key.className='animal-review-ratio-key';label.textContent=name;number.className='animal-review-ratio-number';number.textContent=row.means?`${row.means[i].toFixed(1)}%`:'—';
      key.append(label,number);labels.append(key);fill.className='animal-review-ratio-fill';fill.style.width=`${row.means?row.means[i]:0}%`;track.append(fill);
    });
    values.append(labels,track);
    root.querySelector('[data-review-count]').textContent=`有效记录 ${row.count}人${row.means?'':' · 暂无有效结果'}`;
  }
  async function refresh(activity) {
    if(activity?.id)currentActivityId=activity.id;
    active=true;controller?.abort();controller=new AbortController();const current=controller;
    refreshButton.disabled=true;feedback.textContent='正在读取本班结果…';
    note.textContent=isBeasts()?'统计已同步教师的数据排除结果。点击柱组可放大查看对应异兽图片。':'统计已同步教师的数据排除结果。摄像头画面因人而异，其均值仅供参考。';
    try {
      const api=new URL(root.dataset.api,location.href);
      if(isBeasts())api.searchParams.set('activity_id','lesson-4-task-1');
      const response=await fetch(api,{signal:current.signal,cache:'no-store',headers:{Accept:'application/json'}});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'读取失败，请重试。');
      if(!active||current!==controller)return;
      data=result;root.querySelector('[data-review-scope]').textContent=`${data.class_name} · ${data.submitted}/${data.student_count}名学生已提交测试记录`;
      if(legend){
        const items=data.names.map(name=>{const span=document.createElement('span'),icon=document.createElement('i');span.append(icon,document.createTextNode(name));return span;});
        const tip=document.createElement('small');tip.textContent='全班平均预测比例（%）';
        legend.replaceChildren(...items,tip);
      }
      renderAnimalChart(groups,data,{imageBase:currentImageBase(),actionLabel:row=>row.image_file?'点击查看大图':'点击查看摄像头汇总',onSelect:row=>{selected=row.id;drawImage();modal.showModal();}});
      feedback.textContent=data.submitted?'':'本班还没有已提交的测试结果，可以先点开图片观察。';
      if(modal.open)drawImage();
    } catch(error) {if(error.name!=='AbortError'&&active&&current===controller)feedback.textContent=error.message;}
    finally{if(current===controller)refreshButton.disabled=false;}
  }
  refreshButton.addEventListener('click',()=>refresh());
  // 在当前汇总数据中循环浏览9张图片，图像、均值和有效人数一起切换。
  function moveImage(direction) {
    if(!modal.open||!data)return;
    const images=data.rows.filter(row=>row.image_file),index=images.findIndex(row=>row.id===selected);
    if(index<0)return;
    selected=images[(index+direction+images.length)%images.length].id;drawImage();
  }
  root.querySelectorAll('[data-review-direction]').forEach(button=>button.addEventListener('click',()=>moveImage(Number(button.dataset.reviewDirection))));
  modal.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();moveImage(event.key==='ArrowLeft'?-1:1);
  });
  root.querySelector('[data-review-close]').addEventListener('click',()=>modal.close());
  modal.addEventListener('close',()=>groups.querySelector(`[data-source-id="${selected}"]`)?.focus({preventScroll:true}));
  return {refresh,pause(){active=false;controller?.abort();modal.close();},getStep(){return 0;},goToStep(){},setGate(){}};
}

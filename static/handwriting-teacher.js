/* 仅绘制服务器已校验的二值点阵，并在前端暂存样本选用与标签修正状态。 */
document.querySelectorAll('canvas[data-bits]').forEach(canvas=>{
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,120,180);ctx.fillStyle='#365f58';
  [...canvas.dataset.bits].forEach((bit,index)=>{if(bit==='1')ctx.fillRect(index%12*10,Math.floor(index/12)*10,10,10);});
});

const batchForm=document.getElementById('sample-batch-form');
const changesInput=document.getElementById('sample-batch-changes');
const saveBtn=document.getElementById('sample-batch-save-btn');
const dirtyHint=document.getElementById('sample-dirty-hint');
const sampleCards=[...document.querySelectorAll('.teacher-sample-card[data-sample-id]')];

function syncSampleCard(card){
  const included=card.dataset.included==='1';
  const dirty=card.dataset.label!==card.dataset.initLabel||card.dataset.included!==card.dataset.initIncluded;
  card.classList.toggle('is-included',included);
  card.classList.toggle('is-excluded',!included);
  card.classList.toggle('is-dirty',dirty);
  const toggleBtn=card.querySelector('.sample-toggle-btn');
  if(toggleBtn){
    toggleBtn.classList.toggle('is-included',included);
    toggleBtn.classList.toggle('is-excluded',!included);
    toggleBtn.setAttribute('aria-pressed',included?'true':'false');
    toggleBtn.setAttribute('aria-label',`切换样本${card.dataset.sampleId}启用状态，当前${included?'启用':'停用'}`);
    toggleBtn.textContent=included?'✓':'✕';
  }
}

function collectDirtySamples(){
  const changes=[];
  sampleCards.forEach(card=>{
    const dirty=card.dataset.label!==card.dataset.initLabel||card.dataset.included!==card.dataset.initIncluded;
    if(dirty){
      changes.push({id:Number(card.dataset.sampleId),label:Number(card.dataset.label),included:card.dataset.included==='1'});
    }
  });
  if(changesInput)changesInput.value=JSON.stringify(changes);
  if(saveBtn){
    saveBtn.disabled=changes.length===0;
    saveBtn.textContent=changes.length?`保存并发布（${changes.length} 项）`:'保存并发布';
  }
  if(dirtyHint){
    dirtyHint.classList.toggle('is-dirty',changes.length>0);
    dirtyHint.textContent=changes.length?`有 ${changes.length} 张样本待保存，点击「保存并发布」后立即生效`:'点击卡片 ✓ / ✕ 或修正数字标签后保存并发布';
  }
  return changes;
}

document.querySelectorAll('.sample-select-all').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const next=btn.dataset.included==='1'?'1':'0';
    sampleCards.forEach(card=>{
      card.dataset.included=next;
      syncSampleCard(card);
    });
    collectDirtySamples();
  });
});

sampleCards.forEach(card=>{
  const select=card.querySelector('.sample-label-select');
  card.addEventListener('click',event=>{
    if(event.target.closest('.sample-label-select'))return;
    card.dataset.included=card.dataset.included==='1'?'0':'1';
    syncSampleCard(card);
    collectDirtySamples();
  });
  if(select){
    select.addEventListener('change',()=>{
      card.dataset.label=select.value;
      syncSampleCard(card);
      collectDirtySamples();
    });
  }
});

if(batchForm){
  batchForm.addEventListener('submit',()=>{
    collectDirtySamples();
  });
}

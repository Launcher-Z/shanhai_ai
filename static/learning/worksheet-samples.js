/* 札记内的样本收集入口：点选并主动上传，与暂存、提交和评分互不替代。 */
export function createSampleUpload(getSamples) {
  const root=document.createElement('section');root.className='note-sample-upload';
  root.innerHTML='<h5>贡献手写样本 · 选做</h5><p>选择自己添加的笔迹，确认数字标签后上传，每人累计最多10张。</p><div class="note-upload-grid"></div><div class="note-upload-actions"><button type="button" data-upload-refresh>更新样本列表</button><button type="button" data-upload-send>上传所选样本</button></div><p role="status" class="note-upload-status"></p>';
  const grid=root.querySelector('.note-upload-grid'),status=root.querySelector('.note-upload-status'),send=root.querySelector('[data-upload-send]'),refresh=root.querySelector('[data-upload-refresh]');
  let mine=[],samples=[],pending=false,ready=false;
  function render() {
    samples=getSamples();grid.replaceChildren();
    const uploaded=new Set(mine.map(sample=>sample.pixels.join('')));
    for(const sample of samples) {
      const label=document.createElement('label');label.className='note-upload-sample';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=sample.id;
      const already=uploaded.has(sample.pixels.join(''));checkbox.disabled=!ready||pending||already||mine.length>=10;
      checkbox.setAttribute('aria-label',`上传${sample.id}，数字${sample.label}`);
      const image=document.createElement('img');image.src=sample.image;image.alt=`${sample.id}的笔迹`;
      const caption=document.createElement('span');caption.textContent=`${sample.id} · 数字${sample.label}${already?' · 已上传':''}`;
      label.append(checkbox,image,caption);grid.append(label);
    }
    if(!samples.length)grid.textContent='先在第4步添加自己的笔迹，再更新列表。';
    send.disabled=pending||!ready||mine.length>=10;refresh.disabled=pending;
  }
  async function load() {
    pending=true;render();
    try {const result=await window.HandwritingAPI.request('/api/handwriting/mine');mine=result.samples;ready=true;status.textContent=`已上传${mine.length}/10张。`;}
    catch(error){ready=false;status.textContent=error.message;}
    finally{pending=false;render();}
  }
  root.addEventListener('input',event=>{
    event.stopPropagation();
    const checked=grid.querySelectorAll('input:checked');
    if(checked.length>10-mine.length){event.target.checked=false;status.textContent=`还可上传${10-mine.length}张。`;}
  });
  root.addEventListener('change',event=>event.stopPropagation());
  refresh.onclick=load;
  send.onclick=async()=>{
    if(pending||!ready)return;
    const ids=new Set([...grid.querySelectorAll('input:checked')].map(input=>input.value));
    const selected=samples.filter(sample=>ids.has(sample.id)).map(({label,pixels})=>({label,pixels}));
    if(!selected.length){status.textContent='先勾选要上传的样本。';return;}
    pending=true;render();
    try {const result=await window.HandwritingAPI.request('/api/handwriting/upload',{samples:selected});mine=result.samples;status.textContent=`本次新增${result.added}张，累计${mine.length}/10张，等待教师整理。`;}
    catch(error){status.textContent=error.message;}
    finally{pending=false;render();}
  };
  queueMicrotask(load);
  return root;
}

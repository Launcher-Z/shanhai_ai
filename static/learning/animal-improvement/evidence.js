import {el,api} from '../creation/common.js';

/* 学生主动确认后才上传正规实验的训练附件，不采集自由拓展图片。 */
export function createTrainingEvidence(input,controller){
  const root=el('div',undefined,'training-evidence');let state;
  try{state=JSON.parse(input.value);}catch{state=null;}
  const update=()=>{input.value=JSON.stringify(state);input.dispatchEvent(new Event('input',{bubbles:true}));};
  const status=el('p');status.setAttribute('role','status');
  root.prepareSubmission=()=>{
    const snapshot=controller?.trainingEvidence?.();
    if(!state||!snapshot||snapshot.round!==state.round)throw new Error('训练已更新或图片尚未确认，请重新确认本轮训练图片后提交。');
  };
  function draw(){
    root.replaceChildren();
    root.append(el('p',state?`已确认正规实验第${state.round}轮：额外训练图${state.extra_count}张，已上传${state.samples.length}张。`:'先完成正规实验训练，再主动确认该轮使用的额外图片。'));
    const send=el('button',state?'重新确认本轮训练图片':'确认并上传本轮训练图片');send.type='button';
    send.addEventListener('click',async()=>{
      const snapshot=controller?.trainingEvidence?.();
      if(!snapshot){status.textContent='请先完成正规实验训练；刷新后个人图片需重新选择并训练。';return;}
      root.dataset.uploading='true';send.disabled=true;
      const previous=state;
      try{
        const samples=[];
        for(const sample of snapshot.samples){
          status.textContent=`正在上传 ${samples.length+1}/${snapshot.samples.length}…`;
          const form=new FormData();form.append('activity_id','lesson-3-task-2');form.append('file',sample.file,sample.name);
          form.append('csrf',document.querySelector('meta[name="csrf-token"]').content);
          const result=await api('/api/creation/media',form);samples.push({media_id:result.media_id,name:sample.name.slice(0,200),category:sample.category});
        }
        // 结果数值始终由学生手填；这里只记录其主动提交的训练图片证据。
        state={schema_version:1,round:snapshot.round,extra_count:samples.length,samples,note:previous?.note||''};update();draw();status.textContent='训练图片已确认。暂存或提交札记后，教师可在个人审核页查看。';
      }catch(error){status.textContent=error.message;}finally{root.dataset.uploading='false';send.disabled=false;}
    });root.append(send);
    if(state){
      const grid=el('div',undefined,'training-evidence-grid');
      state.samples.forEach(sample=>{const figure=el('figure'),link=el('a'),image=el('img');link.href=`/api/creation/media/${sample.media_id}`;link.target='_blank';link.rel='noopener';image.src=link.href+'/thumbnail';image.alt=sample.name;link.append(image);figure.append(link,el('figcaption',`${sample.category} · ${sample.name}`));grid.append(figure);});root.append(grid);
      const label=el('label','本轮图片已做的处理（未处理可写“未处理”）'),note=el('textarea');note.value=state.note;note.maxLength=2000;note.addEventListener('input',()=>{state.note=note.value;update();});label.append(note);root.append(label);
    }
    root.append(status);
  }draw();return root;
}

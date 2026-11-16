/* 札记只预览和提交作品；打开预览不上传，提交时固定当前画面。 */
import {api} from '../creation/common.js';

export function createPixelWorkForm(question,input,activityId,controller) {
  const root=document.createElement('div');root.className='pixel-work-form';
  let state;
  try{state=JSON.parse(input.value);}catch{state={schema_version:1,kind:'pixel',works:[]};}
  const previous=state.works?.[0];
  const redraw=activityId==='lesson-1-task-3';
  if(question.editable) {
    const canvas=document.createElement('canvas');canvas.width=384;canvas.height=384;
    canvas.className='pixel-work-image';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','当前待提交作品');
    controller?.renderPreview?.(canvas);root.append(canvas);
    // 统一札记按钮先固定这次点击时的作品，再提交附件编号；绘画本身不发请求。
    root.prepareSubmission=async()=>{
      const snapshot=controller?.snapshot?.();
      if(!snapshot?.edits.length)throw new Error('先在活动里画上礼帽，再提交作品。');
      const result=await api('/api/pixel-paint/capture',snapshot);
      state={schema_version:1,kind:'pixel',works:[{key:redraw?'second':'first',title:previous?.title||`小熊猫礼帽 · 第${redraw?'二':'一'}稿`,media_id:result.media_id}]};
      input.value=JSON.stringify(state);
      return {[question.id]:input.value};
    };
  } else if(previous?.media_id) {
    const image=document.createElement('img');image.className='pixel-work-image';image.alt='已提交作品';
    image.src='/api/creation/media/'+previous.media_id+'/thumbnail';root.append(image);
  }
  return root;
}

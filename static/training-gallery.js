/* 完整列表使用小缩略图，只有主动放大时才请求大图；权限沿用私有附件。 */
document.querySelectorAll('.training-gallery').forEach(root=>{
  const dialog=root.querySelector('dialog'),image=dialog.querySelector('[data-training-large]');let source;
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-training-image]');if(!button)return;
    source=button;image.src=button.dataset.trainingImage;image.alt=button.dataset.trainingCaption;
    dialog.querySelector('[data-training-caption]').textContent=button.dataset.trainingCaption;
    const note=dialog.querySelector('[data-training-note]');note.textContent=button.dataset.trainingNote?`图片处理说明：${button.dataset.trainingNote}`:'';
    dialog.showModal();
  });
  dialog.querySelector('[data-training-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{image.removeAttribute('src');source?.focus({preventScroll:true});});
});

// 原生滚动负责内容移动；墨痕滚动条只同步位置，保留触控和键盘能力。
export function scrollMetrics(viewport,content,track,scrollTop){
  const maxScroll=Math.max(0,content-viewport);
  const thumb=Math.min(track,Math.max(32,track*viewport/Math.max(1,content)));
  const travel=Math.max(0,track-thumb);
  return {maxScroll,thumb,travel,top:maxScroll?Math.min(maxScroll,Math.max(0,scrollTop))/maxScroll*travel:0};
}

export function setupReadingPane(shell){
  const pane=shell.querySelector('.reading');
  const content=shell.querySelector('.reading-content');
  const scrollbar=shell.querySelector('.ink-scrollbar');
  const track=shell.querySelector('.ink-track');
  const thumb=shell.querySelector('.ink-thumb');
  let frame,drag;
  function update(){
    frame=null;
    const max=Math.max(0,pane.scrollHeight-pane.clientHeight);
    scrollbar.hidden=max<=1;
    if(scrollbar.hidden)return;
    const metrics=scrollMetrics(pane.clientHeight,pane.scrollHeight,track.clientHeight,pane.scrollTop);
    thumb.style.height=metrics.thumb+'px';thumb.style.transform='translateY('+metrics.top+'px)';
    const percent=Math.round(pane.scrollTop/Math.max(1,max)*100);
    thumb.setAttribute('aria-valuenow',percent);thumb.setAttribute('aria-valuetext','资料滚动至 '+percent+'%');
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(update);}
  pane.addEventListener('scroll',schedule,{passive:true});
  pane.addEventListener('toggle',schedule,true);
  const observer=new ResizeObserver(schedule);observer.observe(pane);if(content)observer.observe(content);
  // 文本框没有独立的内容节点，输入和带入记录时也要更新滚动位置。
  pane.addEventListener('input',schedule);
  thumb.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.preventDefault();thumb.focus();thumb.setPointerCapture(event.pointerId);
    drag={y:event.clientY,scrollTop:pane.scrollTop};thumb.classList.add('dragging');
  });
  thumb.addEventListener('pointermove',event=>{
    if(!drag)return;
    const m=scrollMetrics(pane.clientHeight,pane.scrollHeight,track.clientHeight,pane.scrollTop);
    pane.scrollTop=drag.scrollTop+(event.clientY-drag.y)/Math.max(1,m.travel)*m.maxScroll;
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])thumb.addEventListener(type,()=>{drag=null;thumb.classList.remove('dragging');});
  track.addEventListener('pointerdown',event=>{
    if(event.target===thumb)return;
    const m=scrollMetrics(pane.clientHeight,pane.scrollHeight,track.clientHeight,pane.scrollTop);
    const y=event.clientY-track.getBoundingClientRect().top-m.thumb/2;
    pane.scrollTop=Math.min(1,Math.max(0,y/Math.max(1,m.travel)))*m.maxScroll;
  });
  thumb.addEventListener('keydown',event=>{
    const amounts={ArrowUp:-36,ArrowDown:36,PageUp:-pane.clientHeight*.8,PageDown:pane.clientHeight*.8};
    if(event.key in amounts){event.preventDefault();pane.scrollTop+=amounts[event.key];}
    else if(event.key==='Home'){event.preventDefault();pane.scrollTop=0;}
    else if(event.key==='End'){event.preventDefault();pane.scrollTop=pane.scrollHeight;}
  });
  shell.classList.add('has-ink-scroll');schedule();
  return {
    reset(){pane.scrollTop=0;schedule();},update:schedule,
    // 札记换段会替换输入框，及时释放旧节点的尺寸监听。
    destroy(){observer.disconnect();if(frame)cancelAnimationFrame(frame);pane.removeEventListener('input',schedule);}
  };
}

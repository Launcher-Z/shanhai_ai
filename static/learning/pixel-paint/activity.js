/* 全画布可改色；本机只保存改色，主动提交札记时才上传作品。 */
const PALETTE = ['#1c2021','#ffffff','#814937','#b94b3e','#d89a41','#e4d37a','#3d6b51','#68a484','#365d89','#6b8fb5','#8d668e','#da9aa3'];
const hex = values => '#' + values.map(value=>value.toString(16).padStart(2,'0')).join('');
const channels = color => [1,3,5].map(at=>parseInt(color.slice(at,at+2),16));

export async function mountPixelPaint(root, {activityId='lesson-1-task-2'}={}) {
  const ACTIVITY=activityId;
  const response = await fetch(new URL('./panda.json',import.meta.url));
  if (!response.ok) throw new Error('小熊猫底图暂时没有展开，请关闭后重试。');
  const base = await response.json();
  const main = root.querySelector('[data-paint-canvas="main"]');
  const preview = root.querySelector('[data-paint-canvas="preview"]');
  const picker = root.querySelector('[data-paint-picker]');
  const inputs = [...root.querySelectorAll('[data-paint-channel]')];
  const tools = [...root.querySelectorAll('[data-paint-tool]')];
  const undo = root.querySelector('[data-paint-action="undo"]');
  const position = root.querySelector('[data-paint-ui="position"]');
  const studentId = root.dataset.studentId;
  const storageKey = studentId ? `shanhai:experiment:${studentId}:${ACTIVITY}` : null;
  const limit = base.width * base.height;
  let edits = new Map(), rgb = [129,73,55], tool = 'brush', cursor = 0, zoomed = false, step=0;
  let history = [], stroke = null, lastPoint = null, saveTimer, dirty = false;
  let notePreview = null;
  const original = index=>base.palette[base.pixels[index]];
  const colorAt = index=>edits.get(index) || original(index);

  function save() {
    clearTimeout(saveTimer);
    if (!storageKey || !dirty) return;
    try {
      localStorage.setItem(storageKey,JSON.stringify({version:1,studentId,activityId:ACTIVITY,savedAt:new Date().toISOString(),
        state:{baseId:base.id,edits:[...edits],rgb,tool,cursor,zoomed,step}})); dirty=false;
    } catch { /* 本地保存失败仍可继续画，不改变札记与完成状态。 */ }
  }
  function changed() { dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(save,300); }
  try {
    const saved=JSON.parse(storageKey ? localStorage.getItem(storageKey) : 'null'), state=saved?.state;
    const previous=base.previousBase, migrate=state?.baseId===previous.id;
    const savedLimit=migrate ? previous.width*previous.height : limit;
    // 扩画布只增加留白：旧稿的每格向右、向下平移5格，保留颜色和工具。
    const currentIndex=index=>migrate ? (Math.floor(index/previous.width)+previous.offsetY)*base.width+index%previous.width+previous.offsetX : index;
    if (saved?.version===1 && saved.studentId===studentId && saved.activityId===ACTIVITY && (state?.baseId===base.id||migrate)
        && Array.isArray(state.edits) && state.edits.length<=savedLimit && state.edits.every(cell=>Array.isArray(cell)&&cell.length===2&&Number.isInteger(cell[0])&&cell[0]>=0&&cell[0]<savedLimit&&/^#[0-9a-f]{6}$/.test(cell[1]))) {
      edits=new Map(state.edits.map(([index,color])=>[currentIndex(index),color]));
      if(Array.isArray(state.rgb)&&state.rgb.length===3&&state.rgb.every(v=>Number.isInteger(v)&&v>=0&&v<=255))rgb=state.rgb;
      if(['brush','eraser','picker'].includes(state.tool))tool=state.tool;
      if(Number.isInteger(state.cursor)&&state.cursor>=0&&state.cursor<savedLimit)cursor=currentIndex(state.cursor);
      zoomed=state.zoomed===true;
      if(ACTIVITY==='lesson-1-task-3'&&state.step===1)step=1;
      if(migrate){dirty=true;save();}
    }
  } catch { /* 损坏或其他学生的记录不恢复。 */ }

  function picture(canvas, withGrid) {
    if(withGrid) {
      // 让绘画分辨率匹配实际显示大小，避免缩小像素图时细网格被抽掉。
      const size=Math.round(canvas.getBoundingClientRect().width);
      if(size>0&&canvas.width!==size){canvas.width=size;canvas.height=size;}
    }
    const ctx=canvas.getContext('2d'), unit=canvas.width/base.width;
    ctx.imageSmoothingEnabled=false;
    base.pixels.forEach((_,index)=>{
      ctx.fillStyle=colorAt(index);
      const x=index%base.width,y=Math.floor(index/base.width);
      ctx.fillRect(Math.round(x*unit),Math.round(y*unit),Math.round((x+1)*unit)-Math.round(x*unit),Math.round((y+1)*unit)-Math.round(y*unit));
    });
    if(!withGrid)return;
    // 全幅使用同样的方形网格；辅助线不进入作品附件。
    ctx.strokeStyle='#60574660';ctx.lineWidth=1;
    ctx.beginPath();
    for(let x=1;x<base.width;x++) {ctx.moveTo(Math.round(x*unit)+.5,0);ctx.lineTo(Math.round(x*unit)+.5,canvas.height);}
    for(let y=1;y<base.height;y++) {ctx.moveTo(0,Math.round(y*unit)+.5);ctx.lineTo(canvas.width,Math.round(y*unit)+.5);}
    ctx.stroke();
    if(document.activeElement===main) {
      ctx.strokeStyle='#b9702d';ctx.lineWidth=2;
      ctx.strokeRect(cursor%base.width*unit+1,Math.floor(cursor/base.width)*unit+1,unit-2,unit-2);
    }
  }
  function draw() {
    root.classList.toggle('paint-is-zoomed',zoomed);
    const zoom=root.querySelector('[data-paint-action="zoom"]');
    zoom.setAttribute('aria-pressed',String(zoomed));zoom.textContent=zoomed?'缩回':'放大';
    zoom.setAttribute('aria-label',zoomed?'缩回完整画布':'放大画布');
    picture(main,true);picture(preview,false);
    if(notePreview?.isConnected)picture(notePreview,false);
    tools.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.paintTool===tool)));
    undo.disabled=!history.length;
    picker.value=hex(rgb); root.querySelector('[data-paint-ui="hex"]').textContent=hex(rgb).toUpperCase();
    inputs.forEach((input,index)=>{
      input.value=rgb[index];root.querySelector(`[data-paint-value="${index}"]`).value=String(rgb[index]);
      // 每条渐变只改变本通道，拖动时能直接观察RGB混色。
      const low=[...rgb],high=[...rgb];low[index]=0;high[index]=255;
      input.style.setProperty('--paint-channel-gradient',`linear-gradient(to right,${hex(low)},${hex(high)})`);
    });
  }
  function endStroke() {
    if(stroke) {
      if(JSON.stringify([...stroke])!==JSON.stringify([...edits])) {history.push(stroke);if(history.length>30)history.shift();changed();}
      stroke=null;lastPoint=null;draw();
    }
  }
  function apply(index) {
    cursor=index;
    if(tool==='picker') {rgb=channels(colorAt(index));tool='brush';changed();return;}
    const color=tool==='eraser' ? original(index) : hex(rgb);
    if(color===original(index))edits.delete(index);else edits.set(index,color);
    position.textContent=`第${Math.floor(index/base.width)+1}行，第${index%base.width+1}列 · ${tool==='eraser'?'擦除':'绘画'}`;
  }
  function point(event) {
    const bounds=main.getBoundingClientRect();
    const x=Math.floor((event.clientX-bounds.left)/bounds.width*base.width);
    const y=Math.floor((event.clientY-bounds.top)/bounds.height*base.height);
    return x>=0&&x<base.width&&y>=0&&y<base.height ? {x,y} : null;
  }
  function move(to) {
    if(!to)return;
    if(tool==='picker') {apply(to.y*base.width+to.x);draw();return;}
    // 两次指针事件之间补齐像素，快速拖动画线时也不会留下断点。
    const from=lastPoint||to, steps=Math.max(Math.abs(to.x-from.x),Math.abs(to.y-from.y));
    for(let n=0;n<=steps;n++) {
      const ratio=steps?n/steps:0;
      apply(Math.round(from.y+(to.y-from.y)*ratio)*base.width+Math.round(from.x+(to.x-from.x)*ratio));
    }
    lastPoint=to;draw();
  }
  main.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;event.preventDefault();main.focus();main.setPointerCapture(event.pointerId);
    if(tool==='picker') {const at=point(event);if(at)apply(at.y*base.width+at.x);draw();return;}
    stroke=new Map(edits);move(point(event));
  });
  main.addEventListener('pointermove',event=>{if(stroke&&tool!=='picker')move(point(event));});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])main.addEventListener(name,endStroke);
  main.addEventListener('keydown',event=>{
    if(event.key===' '||event.key==='Enter') {event.preventDefault();stroke=new Map(edits);apply(cursor);endStroke();return;}
    const moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:-base.width,ArrowDown:base.width};
    if(!(event.key in moves))return;event.preventDefault();
    const column=cursor%base.width;
    if(event.key==='ArrowLeft'&&column===0||event.key==='ArrowRight'&&column===base.width-1)return;
    cursor=Math.max(0,Math.min(limit-1,cursor+moves[event.key]));
    position.textContent=`第${Math.floor(cursor/base.width)+1}行，第${cursor%base.width+1}列`;draw();changed();
  });
  main.addEventListener('focus',draw);main.addEventListener('blur',draw);
  tools.forEach(button=>button.addEventListener('click',()=>{endStroke();tool=button.dataset.paintTool;draw();changed();}));
  undo.addEventListener('click',()=>{endStroke();if(history.length){edits=history.pop();draw();changed();}});
  root.querySelector('[data-paint-action="zoom"]').addEventListener('click',()=>{endStroke();zoomed=!zoomed;draw();changed();});
  PALETTE.forEach(color=>{
    const button=document.createElement('button');button.type='button';button.style.backgroundColor=color;
    button.setAttribute('aria-label',`选择颜色${color}`);button.dataset.paintColor=color;
    button.addEventListener('click',()=>{rgb=channels(color);tool='brush';draw();changed();});root.querySelector('.paint-colors').append(button);
  });
  picker.addEventListener('input',()=>{rgb=channels(picker.value);draw();changed();});
  inputs.forEach((input,index)=>input.addEventListener('input',()=>{
    const value=Number(input.value);if(input.value===''||!Number.isInteger(value)||value<0||value>255)return;
    rgb[index]=value;draw();changed();
  }));
  inputs.forEach(input=>input.addEventListener('change',draw));
  root.querySelector('[data-paint-action="note"]').addEventListener('click',()=>root.dispatchEvent(new CustomEvent('worksheet:open',{bubbles:true,detail:{step:0}})));
  window.addEventListener('pagehide',()=>{endStroke();save();});draw();
  new ResizeObserver(draw).observe(main);
  return {
    refresh:draw,pause(){endStroke();save();},getStep:()=>step,
    goToStep(value){if(ACTIVITY==='lesson-1-task-3'){step=value===1?1:0;changed();}},setGate(){},resetAnytime:true,
    renderPreview(canvas){notePreview=canvas;picture(canvas,false);},
    snapshot(){endStroke();return {activity_id:ACTIVITY,base_id:base.id,edits:[...edits]};},
    reset(){endStroke();clearTimeout(saveTimer);edits=new Map();history=[];rgb=[129,73,55];tool='brush';cursor=0;zoomed=false;step=0;dirty=false;
      try{if(storageKey)localStorage.removeItem(storageKey);}catch{/* 不影响札记。 */}draw();},
  };
}

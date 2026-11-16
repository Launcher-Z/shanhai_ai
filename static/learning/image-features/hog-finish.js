/* 何罗鱼：真实灰度 → 梯度 → 区域统计 → 完整HOG数字 → 两个维度的坐标。 */
import {grayscale, gradientAt} from "./model.mjs";
import {describe} from "./hog-model.mjs";
import {featurePoint} from "./hog-finish-model.mjs";

export function mountHogFinish(root) {
  const ui = name => root.querySelector(`[data-hog-finish-ui="${name}"]`);
  const studentId = root.dataset.studentId;
  const key = studentId ? `shanhai:experiment:${studentId}:lesson-6-task-3:finish` : null;
  let phase = 0, cells = 0, blocks = 0, timer = null;
  let image = null, gray = null, descriptor = null, point = null, failed = false;
  const phases = ["原图", "灰度与方向", "分区统计", "顺序组成数字", "坐标中的点"];
  try {
    const saved = key && JSON.parse(localStorage.getItem(key));
    // 新演示与旧反差实验含义不同，版本2不恢复旧实验阶段。
    if (saved?.version === 2 && saved.studentId === studentId && saved.activityId === "lesson-6-task-3") {
      const s = saved.state;
      if (Number.isInteger(s?.phase) && s.phase >= 0 && s.phase <= 4 &&
          Number.isInteger(s.cells) && s.cells >= 0 && s.cells <= 36 &&
          Number.isInteger(s.blocks) && s.blocks >= 0 && s.blocks <= 25) {
        phase = s.phase;
        cells = phase < 2 ? 0 : phase > 2 ? 36 : s.cells;
        blocks = phase < 3 ? 0 : phase === 4 ? 25 : s.blocks;
      }
    }
  } catch {}
  function save() {
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({version:2,studentId,
        activityId:"lesson-6-task-3",savedAt:new Date().toISOString(),state:{phase,cells,blocks}}));
    } catch {}
  }
  function pause() {
    clearTimeout(timer); timer = null;
    save(); render();
  }
  function source() {
    const canvas = ui("source"), c = canvas.getContext("2d"), u = canvas.width / 48;
    c.fillStyle = "#fff"; c.fillRect(0,0,canvas.width,canvas.height);
    if (!descriptor) return;
    if (phase === 0) {
      const scale = Math.min(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight);
      const w = image.naturalWidth*scale, h = image.naturalHeight*scale;
      c.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
      return;
    }
    gray.values.forEach((v,i) => {
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.fillRect(i%48*u,Math.floor(i/48)*u,u+.1,u+.1);
    });
    if (phase === 1) {
      c.fillStyle = "#ffffff90"; c.fillRect(0,0,canvas.width,canvas.height);
      gray.values.forEach((_,i) => {
        const x=i%48,y=Math.floor(i/48),g=gradientAt(gray,x,y);
        if (!g.magnitude) return;
        const r=u*.45*g.magnitude/(255*Math.SQRT2), angle=Math.atan2(-g.gy,g.gx);
        const cx=(x+.5)*u,cy=(y+.5)*u;
        c.strokeStyle="#a85b32";c.lineWidth=1;
        const hx=cx+Math.cos(angle)*r,hy=cy+Math.sin(angle)*r;
        c.beginPath();c.moveTo(cx,cy);c.lineTo(hx,hy);
        c.moveTo(hx-Math.cos(angle-.5)*r*.35,hy-Math.sin(angle-.5)*r*.35);
        c.lineTo(hx,hy);c.lineTo(hx-Math.cos(angle+.5)*r*.35,hy-Math.sin(angle+.5)*r*.35);c.stroke();
      });
      return;
    }
    c.strokeStyle="#365f5890";c.lineWidth=1;
    for(let n=0;n<=48;n+=8) {
      c.beginPath();c.moveTo(n*u,0);c.lineTo(n*u,canvas.height);c.stroke();
      c.beginPath();c.moveTo(0,n*u);c.lineTo(canvas.width,n*u);c.stroke();
    }
    const selected = phase === 2 ? Math.max(0,cells-1) : Math.max(0,blocks-1);
    const x = phase === 2 ? selected%6 : descriptor.blocks[selected].x;
    const y = phase === 2 ? Math.floor(selected/6) : descriptor.blocks[selected].y;
    c.strokeStyle="#a85b32";c.lineWidth=3;
    c.strokeRect(x*8*u+1.5,y*8*u+1.5,(phase===2?8:16)*u-3,(phase===2?8:16)*u-3);
  }
  function statistics() {
    const canvas=ui("statistics"),c=canvas.getContext("2d"),u=canvas.width/6;
    c.fillStyle="#f2f3e9";c.fillRect(0,0,canvas.width,canvas.height);
    if (!descriptor) return;
    const peak=Math.max(1,...descriptor.histograms.flat());
    descriptor.histograms.forEach((hist,i)=>{
      const x=i%6*u,y=Math.floor(i/6)*u;
      c.strokeStyle="#365f5825";c.lineWidth=1;c.strokeRect(x,y,u,u);
      if(i>=cells)return;
      hist.forEach((v,b)=>{
        if(!v)return;
        const angle=(b*20+90)*Math.PI/180,r=u*.42*v/peak;
        c.strokeStyle="#365f58";c.lineWidth=2;
        c.beginPath();c.moveTo(x+u/2-Math.cos(angle)*r,y+u/2+Math.sin(angle)*r);
        c.lineTo(x+u/2+Math.cos(angle)*r,y+u/2-Math.sin(angle)*r);c.stroke();
      });
    });
  }
  function coordinates() {
    const canvas=ui("plot"),c=canvas.getContext("2d");
    const left=55,top=30,side=canvas.width-85,bottom=top+side;
    c.clearRect(0,0,canvas.width,canvas.height);
    c.font='16px Consolas';c.textAlign="center";
    for(let n=0;n<=4;n++) {
      const value=n/4,pos=value*side;
      c.strokeStyle="#365f5825";c.lineWidth=1;
      c.beginPath();c.moveTo(left+pos,top);c.lineTo(left+pos,bottom);c.stroke();
      c.beginPath();c.moveTo(left,bottom-pos);c.lineTo(left+side,bottom-pos);c.stroke();
      c.fillStyle="#365f58";c.fillText(value.toFixed(2),left+pos,bottom+20);
      c.fillText(value.toFixed(2),left-25,bottom-pos+4);
    }
    c.strokeStyle="#365f58";c.strokeRect(left,top,side,side);
    if(phase!==4 || !point)return;
    const x=left+point.x*side,y=bottom-point.y*side;
    c.setLineDash([4,4]);c.strokeStyle="#a85b32";
    c.beginPath();c.moveTo(left,y);c.lineTo(x,y);c.lineTo(x,bottom);c.stroke();c.setLineDash([]);
    c.fillStyle="#a85b32";c.beginPath();c.arc(x,y,6,0,2*Math.PI);c.fill();
    c.textAlign=x>left+side*.65?"right":"left";
    c.font='18px KaiTi,"楷体",serif';c.fillText("何罗鱼",x+(x>left+side*.65?-12:12),y-12);
  }
  function numbers() {
    const container=ui("numbers");
    container.replaceChildren();
    if(!descriptor)return;
    const positions=["左上区域", "右上区域", "左下区域", "右下区域"];
    if(blocks) {
      const header=document.createElement("div");header.className="hog-number-header";
      ["块", ...positions.map(name=>name+" · 9个数")].forEach(text=>{
        const label=document.createElement("span");label.textContent=text;header.append(label);
      });
      container.append(header);
    }
    for(let i=0;i<blocks;i++) {
      const row=document.createElement("div");row.className="hog-number-row";
      const label=document.createElement("span");label.textContent=String(i+1).padStart(2,"0");row.append(label);
      // 一个重叠块含四个8×8区域，按位置分成四组；保持原特征数值和顺序。
      for(let cell=0;cell<4;cell++) {
        const group=document.createElement("div");group.className="hog-number-cell";
        group.dataset.label=positions[cell]+" · 9个数";
        group.setAttribute("aria-label",positions[cell]+"的9个特征数");
        descriptor.blocks[i].values.slice(cell*9,cell*9+9).forEach((v,bin)=>{
          const j=cell*9+bin;
          const index=i*36+j,value=document.createElement("span");
          value.className="hog-number-value";
          value.textContent=v.toFixed(2);value.style.setProperty("--strength",v);
          value.title=`${positions[cell]} · ${bin*20}° · 第${index+1}个特征数：${v.toFixed(5)}`;
          if(index===point.xIndex || index===point.yIndex) {
            value.classList.add(index===point.xIndex?"is-x":"is-y");
            value.title+=(index===point.xIndex?" · 横坐标":" · 纵坐标");
          }
          group.append(value);
        });
        row.append(group);
      }
      container.append(row);
    }
  }
  function render() {
    root.querySelectorAll("[data-hog-finish-phase]").forEach(el=>{
      el.setAttribute("aria-current",String(Number(el.dataset.hogFinishPhase)===phase));
    });
    ui("auto").disabled=!descriptor;
    ui("auto").textContent=timer!==null?"暂停演示":phase===4?"重新演示":phase||cells||blocks?"继续演示":"自动演示";
    ui("phase").textContent=failed?"图片未能载入，请重新打开活动。":!descriptor?"正在读取何罗鱼…":phases[phase];
    ui("count").textContent=phase<3?`已统计 ${cells} / 36 个区域`:`已组成 ${blocks*36} / 900 个特征数`;
    ui("source-label").textContent=phase===0?"何罗鱼 · 原图":phase===1?"灰度与明暗变化方向":"48×48像素 · 8×8分区";
    const captions=["同一张何罗鱼，接下来用数字描述它。","比较像素邻居，求出变化的方向与强度。","每个区域的方向统计，用9个数表示。","逐块整理，按从左到右、从上到下的顺序连接。","完整特征有900个数；右图只用其中两个数作坐标，并未完成分类。"];
    ui("feedback").textContent=captions[phase];
    ui("coordinate-values").textContent=point&&phase===4?`(${point.x.toFixed(3)}, ${point.y.toFixed(3)})`:"等待特征数字组成…";
    ui("x-label").textContent=point?`横轴：第${point.xIndex+1}个特征数`:"横轴：一个特征数";
    ui("y-label").textContent=point?`纵轴：第${point.yIndex+1}个特征数`:"纵轴：另一个特征数";
    source();statistics();numbers();coordinates();
  }
  function advance() {
    if(phase<2)phase++;
    else if(phase===2) { if(cells<36)cells++;else phase=3; }
    else if(phase===3) { if(blocks<25)blocks++;else phase=4; }
    const delay=phase<2?2200:phase===2?140:300;
    timer=phase===4?null:setTimeout(advance,delay);
    save();render();
  }
  ui("auto").addEventListener("click",()=>{
    if(timer!==null){pause();return;}
    if(!descriptor)return;
    if(phase===4){phase=0;cells=blocks=0;save();}
    timer=setTimeout(advance,1800);render();
  });
  const ready=(async()=>{
    try {
      image=new Image();image.src=new URL("../../bestiary/heluo-fish.png",import.meta.url).href;
      await image.decode();
      const canvas=document.createElement("canvas");canvas.width=canvas.height=48;
      const c=canvas.getContext("2d");c.fillStyle="#fff";c.fillRect(0,0,48,48);
      const scale=Math.min(48/image.naturalWidth,48/image.naturalHeight);
      const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      c.drawImage(image,(48-w)/2,(48-h)/2,w,h);
      const rgba=c.getImageData(0,0,48,48).data,values=[];
      for(let i=0;i<rgba.length;i+=4)values.push([rgba[i],rgba[i+1],rgba[i+2]]);
      gray=grayscale({width:48,height:48,values});
      descriptor=describe(gray);point=featurePoint(descriptor.vector);render();
    } catch {failed=true;render();}
  })();
  window.addEventListener("pagehide",pause);
  return {refresh:render,pause,ready,reset(){
    clearTimeout(timer);timer=null;phase=cells=blocks=0;
    try{if(key)localStorage.removeItem(key);}catch{}
    render();
  }};
}

import {layoutRange} from './terrain.js';

const $=selector=>document.querySelector(selector),dialog=$('#atlas'),open=$('#open');
let data,scene,book,range,nodes,current,maxIndex,SceneClass;
const controls=['pan','orbit','previous','next','zoom-out','zoom-in','home','quality','range','mountain-jump','progress'];
function error(message){$('#loading').hidden=false;$('#loading').textContent=message;}
async function load(){
  try{
    const [response,module]=await Promise.all([fetch('./mountains.json'),import('./scene.js')]);
    if(!response.ok)throw new Error('原文数据加载失败');
    data=await response.json();SceneClass=module.MountainScene;
    if(!data.books?.length)throw new Error('山经数据为空');
    $('#catalog-status').textContent='五篇山经 · '+data.books.reduce((sum,b)=>sum+b.ranges.length,0)+'条山系 · '+data.books.reduce((sum,b)=>sum+b.ranges.reduce((s,r)=>s+r.mountains.length,0),0)+'处山域';
    $('#books').replaceChildren(...data.books.map((b,i)=>{const button=document.createElement('button');button.textContent=b.name;button.setAttribute('aria-selected',String(i===0));button.addEventListener('click',()=>selectBook(b));return button;}));
    for(const id of controls)$('#'+id).disabled=false;
    selectBook(data.books[0]);
  }catch(e){error('山海图未能加载。请通过项目服务打开本页，并刷新重试。');console.error(e);}
}
function selectBook(value){book=value;[...$('#books').children].forEach((b,i)=>b.setAttribute('aria-selected',String(data.books[i]===book)));$('#range').replaceChildren(...book.ranges.map((r,i)=>new Option(r.name,i)));selectRange(0);}
function selectRange(index){range=book.ranges[index];nodes=layoutRange(range);current=null;maxIndex=progressLimit();$('#range-count').textContent=range.mountains.length+'处山域';updateJump();if(scene)scene.setRange(nodes,maxIndex);else updateReading(nodes[0]);drawRoute();}
function progressLimit(){return Math.floor((nodes.length-1)*Number($('#progress').value)/100);}
function updateJump(){$('#mountain-jump').replaceChildren(...nodes.map((n,i)=>{const option=new Option((i+1)+' · '+n.name+(i>maxIndex?' · 未开放':''),i);option.disabled=i>maxIndex;return option;}));}
function updateReading(node){
  if(node.index>maxIndex)return;
  $('#position').textContent='第 '+(node.index+1)+' 山';
  if(current?.id===node.id)return;current=node;
  $('#index').textContent=String(node.index+1).padStart(2,'0')+' / '+nodes.length;
  $('#mountain').textContent=node.name;$('#direction').textContent=node.index===0?range.name+' · 山系之首': '循前山向'+node.direction+' · 原文记'+node.li+'里';
  $('#original').textContent=node.text;$('#source').href=book.source;$('#source').textContent='《'+book.name+'》原文 ↗';
  $('#creature-count').textContent=node.creatures.length?node.creatures.length+'则':'';
  const entries=node.creatures.map(c=>{const details=document.createElement('details');details.className='creature';const summary=document.createElement('summary'),p=document.createElement('p');summary.textContent=c.name;p.textContent=c.text;details.append(summary,p);return details;});
  if(!entries.length){const p=document.createElement('p');p.className='empty-creatures';p.textContent=/无鸟兽|无兽/.test(node.text)?'此山原文明确记有无兽或无鸟兽。':/白猿/.test(node.text)?'原文记有白猿，未另列具名异兽。':/怪兽|怪鱼|怪鸟|怪蛇/.test(node.text)?'原文记有怪兽、怪鱼或怪鸟等，未逐一命名。':'更多山中生灵与物产记载，可见下方原文。';entries.push(p);}
  $('#creatures').replaceChildren(...entries);$('#mountain-jump').value=node.index;$('#previous').disabled=node.index===0;$('#next').disabled=node.index>=maxIndex;drawRoute();
}
function drawRoute(){
  if(!nodes)return;const canvas=$('#route'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,700,60);
  const step=660/Math.max(1,nodes.length-1);ctx.lineWidth=1;ctx.strokeStyle='#9caa8b';ctx.beginPath();ctx.moveTo(20,30);ctx.lineTo(680,30);ctx.stroke();
  nodes.forEach((n,i)=>{ctx.beginPath();ctx.fillStyle=i>maxIndex?'#bdc3ac':i===current?.index?'#a3694c':'#648b74';ctx.arc(20+i*step,30,i===current?.index?4:2.2,0,Math.PI*2);ctx.fill();});
}
function mountScene(){try{scene=new SceneClass($('#viewport'),$('#labels'),updateReading,message=>$('#boundary').textContent=message);scene.setRange(nodes,maxIndex);scene.setQuality($('#quality').value);scene.mode=$('#orbit').getAttribute('aria-pressed')==='true'?'orbit':'pan';$('#loading').hidden=true;}catch(e){error('当前浏览器无法启动三维地图。请启用浏览器图形加速，或改用支持 WebGL 的浏览器。');scene?.dispose();scene=null;console.error(e);}}
async function show(){dialog.hidden=false;document.body.style.overflow='hidden';$('#close').focus();if(!data)await load();if(data&&!dialog.hidden&&!scene)mountScene();}
function close(){dialog.hidden=true;scene?.dispose();scene=null;document.body.style.overflow='';open.focus();}
open.addEventListener('click',show);$('#close').addEventListener('click',close);
$('#range').addEventListener('change',e=>selectRange(Number(e.target.value)));$('#mountain-jump').addEventListener('change',e=>scene?.jump(Number(e.target.value)));
$('#progress').addEventListener('change',()=>{maxIndex=progressLimit();updateJump();scene?.setProgress(maxIndex);drawRoute();});
$('#previous').addEventListener('click',()=>scene?.jump(Math.max(0,current.index-1)));$('#next').addEventListener('click',()=>scene?.jump(Math.min(maxIndex,current.index+1)));
$('#zoom-out').addEventListener('click',()=>scene?.zoomBy(1/1.15));$('#zoom-in').addEventListener('click',()=>scene?.zoomBy(1.15));$('#home').addEventListener('click',()=>scene?.home());
for(const mode of ['pan','orbit'])$('#'+mode).addEventListener('click',()=>{if(scene)scene.mode=mode;$('#pan').setAttribute('aria-pressed',String(mode==='pan'));$('#orbit').setAttribute('aria-pressed',String(mode==='orbit'));});
$('#quality').addEventListener('change',e=>scene?.setQuality(e.target.value));
document.addEventListener('keydown',e=>{if(dialog.hidden)return;if(e.key==='Escape')close();if(e.key==='Tab'){const list=[...dialog.querySelectorAll('button:not(:disabled),select:not(:disabled),a,summary,canvas[tabindex]')],first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
// 首次加载默认展示模型；后续仍可通过导航栏入口开关。
for(const id of controls)$('#'+id).disabled=true;
show();

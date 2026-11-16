import {layoutWorld,PALETTES,unlockedLimit,ZONE_SIZE} from './terrain.js';
import {setupReadingPane} from './reading.js';

const $=selector=>document.querySelector(selector),dialog=$('#atlas'),open=$('#open');
// 正式学习页复用同一份地图，只在嵌入模式隐藏独立预览的示例课程。
const embedded=window.parent!==window&&new URLSearchParams(window.location.search).get('embed')==='1';
if(embedded){document.documentElement.dataset.embedded='true';dialog.setAttribute('role','region');dialog.removeAttribute('aria-modal');}
let data,world,nodes,scene,current,maxIndex,SceneClass,locationAnimation,pendingLocation,locationRunning=false;
let illustrations=[];
const readingPane=setupReadingPane($('#reading-shell'));
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const controls=['pan','orbit','zoom-out','zoom-in','home','progress'];
function error(message){$('#loading').hidden=false;$('#loading').textContent=message;}
async function load(){
  try{
    const [response,module,manifest]=await Promise.all([
      fetch('./mountains.json'),import('./scene.js'),
      fetch('../bestiary/index.json').then(r=>r.ok?r.json():{assets:[]}).catch(()=>({assets:[]}))
    ]);
    if(!response.ok)throw new Error('原文数据加载失败');
    data=await response.json();SceneClass=module.MountainScene;
    illustrations=manifest.assets||[];
    if(!data.books?.length)throw new Error('山经数据为空');
    world=layoutWorld(data.books);nodes=world.nodes;maxIndex=progressLimit();
    $('#catalog-status').textContent='九域一图 · 26条山系 · '+nodes.length+'处山域';
    for(const id of controls)$('#'+id).disabled=false;
    updateReading(nodes[0]);drawOverview();
  }catch(e){error('山海图未能加载。请通过项目服务打开本页，并刷新重试。');console.error(e);}
}
function progressLimit(){return unlockedLimit(nodes,Number($('#progress').value));}
function renderEntries(container,entries,className){
  container.replaceChildren(...entries.map(entry=>{
    const details=document.createElement('details');details.className=className;
    const summary=document.createElement('summary'),paragraph=document.createElement('p');
    const art=className==='creature'?illustrations.find(asset=>(asset.names||[]).includes(entry.name)||(asset.textIncludes||[]).some(text=>entry.text.includes(text))):null;
    summary.textContent=art?.displayName||entry.name;paragraph.textContent=entry.text;
    if(!art){details.append(summary,paragraph);return details;}
    const body=document.createElement('div');body.className='creature-body with-illustration';
    const figure=document.createElement('figure');figure.className='creature-art';
    const image=document.createElement('img');image.alt=art.alt||art.name+'写意示意';image.width=384;image.height=384;image.loading='lazy';image.decoding='async';
    const caption=document.createElement('figcaption');caption.textContent='AI 写意示意';figure.append(image,caption);
    const copy=document.createElement('div');copy.className='creature-copy';
    if(art.description){const description=document.createElement('p');description.className='creature-description';description.textContent=art.description;copy.append(description);}
    paragraph.className='creature-quote';const quoteLabel=document.createElement('span');quoteLabel.className='quote-label';quoteLabel.textContent='原文记载';copy.append(quoteLabel,paragraph);
    body.append(figure,copy);details.append(summary,body);
    // 仅展开后赋予图片地址；未浏览的图鉴不占用课堂网络。
    details.addEventListener('toggle',()=>{if(details.open&&!image.hasAttribute('src'))image.src=new URL('../bestiary/'+art.file,import.meta.url).href;});
    image.addEventListener('error',()=>{figure.remove();body.classList.remove('with-illustration');readingPane.update();},{once:true});
    return details;
  }));
}
function locationText(node){
  $('#region-seal').textContent=node.bookName[0];$('#location-trail').textContent='第'+node.zoneLesson+'域 · '+node.bookName+' · '+node.rangeName;
  $('#mountain').textContent=node.name;$('#direction').textContent=node.rangeIndex===0?'此山系之首': '循前山向'+node.direction+' · 原文记'+node.li+'里';
  document.documentElement.style.setProperty('--region-accent',PALETTES[node.bookId].accent);
}
// 仅地点文字执行短动画；连续拖动时保留最新目标，不堆积过渡。
async function transitionLocation(node){
  pendingLocation=node;if(locationRunning)return;
  if(reducedMotion.matches){locationText(node);pendingLocation=null;return;}
  locationRunning=true;
  try{
    while(pendingLocation&&!dialog.hidden){
      const element=$('#location');
      locationAnimation=element.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-3px)'}],{duration:160,easing:'ease-in',fill:'forwards'});
      await locationAnimation.finished;
      const target=pendingLocation;pendingLocation=null;locationText(target);locationAnimation.cancel();
      locationAnimation=element.animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:420,easing:'cubic-bezier(.2,.65,.3,1)',fill:'forwards'});
      await locationAnimation.finished;locationAnimation.cancel();
    }
  }catch(e){if(e.name!=='AbortError')console.error(e);}
  finally{locationRunning=false;locationAnimation=null;}
}
function updateReading(node,center){
  if(node.index>maxIndex)return;if(center)drawOverview(center);if(current?.id===node.id)return;
  const first=!current;current=node;if(first)locationText(node);else transitionLocation(node);
  $('#index').textContent=node.bookName;$('#reading-place').textContent=node.name;
  $('#original').textContent=node.text;$('#source').href=node.source;$('#source').textContent='《'+node.bookName+'》原文 ↗';
  const creatures=node.creatures||[],plants=node.plants||[],minerals=node.minerals||[];
  $('#creature-count').textContent=creatures.length?creatures.length+'则':'';
  $('#biology-section').hidden=!creatures.length;
  $('#resources-section').hidden=!plants.length&&!minerals.length;
  $('#plants-section').hidden=!plants.length;$('#minerals-section').hidden=!minerals.length;
  $('#original-section').hidden=!node.text?.trim();$('#source').hidden=!node.source;
  renderEntries($('#creatures'),creatures,'creature');
  renderEntries($('#plant-resources'),plants,'resource');renderEntries($('#mineral-resources'),minerals,'resource');
  readingPane.reset();
  drawOverview(center);
}
function overviewProjection(){const b=world.bounds,scale=Math.min(320/(b.maxX-b.minX),125/(b.maxZ-b.minZ));return {scale,offsetX:(360-(b.maxX-b.minX)*scale)/2,offsetZ:(155-(b.maxZ-b.minZ)*scale)/2};}
function drawOverview(center){
  if(!world)return;const canvas=$('#route'),ctx=canvas.getContext('2d'),{scale,offsetX,offsetZ}=overviewProjection(),bounds=world.bounds;
  const project=n=>[offsetX+(n.x-bounds.minX)*scale,offsetZ+(n.z-bounds.minZ)*scale];ctx.clearRect(0,0,360,155);
  // 九个浅色格块只作为逻辑分区提示，不在三维山水中筑起硬边界。
  for(const zone of world.zones){const [x,y]=project(zone);ctx.globalAlpha=zone.lesson<=Number($('#progress').value)?.08:.025;ctx.fillStyle=PALETTES[zone.book].accent;ctx.fillRect(x-ZONE_SIZE*scale/2+1,y-ZONE_SIZE*scale/2+1,ZONE_SIZE*scale-2,ZONE_SIZE*scale-2);}
  const ranges=new Map();for(const node of nodes){if(!ranges.has(node.rangeId))ranges.set(node.rangeId,[]);ranges.get(node.rangeId).push(node);}
  for(const range of ranges.values()){
    range.sort((a,b)=>a.rangeIndex-b.rangeIndex);ctx.beginPath();ctx.strokeStyle=PALETTES[range[0].bookId].accent;ctx.globalAlpha=.28;ctx.lineWidth=1.3;
    range.forEach((n,i)=>{const [x,y]=project(n);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
  }
  for(const n of nodes){const [x,y]=project(n);ctx.beginPath();ctx.fillStyle=PALETTES[n.bookId].accent;ctx.globalAlpha=n.index>maxIndex?.12:.7;ctx.arc(x,y,1.15,0,Math.PI*2);ctx.fill();}
  const position=center||current||nodes[0],[x,y]=project(position);ctx.globalAlpha=1;ctx.beginPath();ctx.strokeStyle='#9c5b42';ctx.lineWidth=1.6;ctx.arc(x,y,4,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#9c5b42';ctx.fillRect(x-1,y-1,2,2);
}
function mountScene(){try{scene=new SceneClass($('#viewport'),$('#labels'),updateReading,message=>$('#boundary').textContent=message);scene.setRange(nodes,maxIndex);scene.mode=$('#orbit').getAttribute('aria-pressed')==='true'?'orbit':'pan';$('#loading').hidden=true;}catch(e){error('当前浏览器无法启动三维地图。请启用图形加速，或改用支持 WebGL 的浏览器。');scene?.dispose();scene=null;console.error(e);}}
async function show(){dialog.hidden=false;document.body.classList.add('map-open');document.body.style.overflow='hidden';$('.lesson').inert=true;$('#close').focus();if(!data)await load();if(data&&!dialog.hidden&&!scene)mountScene();}
function close(){dialog.hidden=true;pendingLocation=null;locationAnimation?.cancel();current=null;scene?.dispose();scene=null;document.body.classList.remove('map-open');document.body.style.overflow='';$('.lesson').inert=false;if(embedded)window.parent.postMessage({type:'shanhai-atlas:close'},window.location.origin);else open.focus();}
// iframe 卸载或独立页面离开时，都主动释放三维资源和地点动画。
function disposeScene(){pendingLocation=null;locationAnimation?.cancel();scene?.dispose();scene=null;}
window.addEventListener('pagehide',disposeScene);
window.addEventListener('shanhai-atlas:dispose',disposeScene);
open.addEventListener('click',show);$('#close').addEventListener('click',close);
$('#progress').addEventListener('change',()=>{maxIndex=progressLimit();scene?.setProgress(maxIndex);drawOverview(scene?.center);});
$('#zoom-out').addEventListener('click',()=>scene?.zoomBy(1/1.15));$('#zoom-in').addEventListener('click',()=>scene?.zoomBy(1.15));$('#home').addEventListener('click',()=>scene?.home());
for(const mode of ['pan','orbit'])$('#'+mode).addEventListener('click',()=>{if(scene)scene.mode=mode;$('#pan').setAttribute('aria-pressed',String(mode==='pan'));$('#orbit').setAttribute('aria-pressed',String(mode==='orbit'));});
document.addEventListener('keydown',e=>{if(dialog.hidden)return;if(e.key==='Escape')close();if(e.key==='Tab'&&!embedded){const list=[...dialog.querySelectorAll('button:not(:disabled),select:not(:disabled),a,summary,canvas[tabindex]')].filter(element=>element.getClientRects().length),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
for(const id of controls)$('#'+id).disabled=true;
show();

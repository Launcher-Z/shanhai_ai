import {treePaths, treeComplete, nearest} from './model.mjs';
import {element, renderTree, bindNodeDrop, parseNodePayload} from './view.js';

let dataPromise;
const copy = value => JSON.parse(JSON.stringify(value));
const labels = {monkey:'金丝猴', leopard:'雪豹', tie:'票数相同，暂不判断'};
const initial = () => ({step:0, trees:[{feature:'meat',yes:{},no:{}},{},{}], k:3, target:{x:50,y:50}, points:null, mode:'test', beast:'天狗', captures:{}, reveal:false, cardsOpen:false});

export async function mountClassification(root, kind, onStepChange) {
  dataPromise ||= fetch(new URL('data.json',import.meta.url)).then(response=>{
    if (!response.ok) throw new Error('教学数据未能加载，请关闭活动后重试。');
    return response.json();
  }).catch(error=>{dataPromise=null;throw error;});
  const data = await dataPromise;
  const activityId = kind === 'tree' ? 'lesson-5-task-1' : 'lesson-5-task-2';
  const studentId = root.dataset.studentId;
  const key = studentId ? `shanhai:experiment:${studentId}:${activityId}` : null;
  let state = initial(), gate = null, timer, dirty = false;
  let undo = [], picked = null, zoom = 1;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved?.version === 1 && saved.studentId === studentId && saved.activityId === activityId) {
      const s = saved.state;
      const point = p=>p && Number.isFinite(p.x) && p.x>=0 && p.x<=100 && Number.isFinite(p.y) && p.y>=0 && p.y<=100;
      const treeShape = (t,depth=0)=>depth<=6 && t && typeof t==='object' && (t.feature ? data.features.some(f=>f.id===t.feature) && treeShape(t.yes,depth+1) && treeShape(t.no,depth+1) : !t.animal || data.animals.some(a=>a.id===t.animal));
      if (s && Number.isInteger(s.step) && s.step>=0 && s.step<=2 && [1,3,5,7,9].includes(s.k)
          && Array.isArray(s.trees) && s.trees.length===3 && s.trees.every(t=>treeShape(t)) && point(s.target)
          && (s.points === null || Array.isArray(s.points) && s.points.length<=30 && s.points.every(p=>point(p)&&['monkey','leopard'].includes(p.type)&&typeof p.id==='string'))) {
        const capOk = c => c && point(c.target) && [1,3,5,7,9].includes(c.k) && (c.points === null || Array.isArray(c.points) && c.points.length<=30 && c.points.every(p=>point(p)&&['monkey','leopard'].includes(p.type)&&typeof p.id==='string'));
        const captures = s.captures && typeof s.captures === 'object' ? Object.fromEntries(Object.entries(s.captures).filter(([name,c])=>['天狗','长右','类','朱厌'].includes(name)&&capOk(c))) : {};
        state = {...initial(),...s,captures,mode:'test'};
      }
    }
  } catch { /* 本地草稿不可用时仍可从初始状态操作，不影响服务器札记。 */ }
  function save() {
    clearTimeout(timer);
    if (!dirty || !key) return;
    try {localStorage.setItem(key,JSON.stringify({version:1,studentId,activityId,savedAt:new Date().toISOString(),state}));dirty=false;} catch { /* 存储失败不阻断实验。 */ }
  }
  function changed() {dirty=true;clearTimeout(timer);timer=setTimeout(save,180);}
  const allowed = step=>gate === null || gate.includes(step);
  const header = element('header', undefined, 'method-heading');
  const heading = element('h3');
  const intro = element('p',undefined,'method-intro');
  header.append(heading, intro);
  const nav = element('nav',undefined,'method-steps');nav.setAttribute('aria-label','实验步骤');
  const body = element('div',undefined,'method-body');
  const footer = element('div',undefined,'method-footer');
  const previous=element('button','上一步'), next=element('button','下一步'), note=element('button','填写本段札记','method-btn-primary');
  [previous,next,note].forEach(button=>button.type='button');footer.append(previous,next,note);
  root.replaceChildren(nav,header,body,footer);
  const titles = kind === 'tree' ? ['沿着条件分一分','四种动物，补充分支','六种动物，自建决策树'] : ['找最近的邻居','同一点，比较 K 值','异兽位置与样本探索'];
  titles.forEach((title, step)=>{
    const button=element('button');button.type='button';button.dataset.methodStep=step;
    button.append(element('span',`0${step+1}`,'method-step-num'), element('span',title));
    button.addEventListener('click',()=>goToStep(step));nav.append(button);
  });
  function goToStep(step) {
    if (!Number.isInteger(step)||step<0||step>2||!allowed(step))return;
    picked=null;zoom=1;state.step=step;changed();save();render();onStepChange(step);
  }
  previous.addEventListener('click',()=>goToStep(state.step-1));
  next.addEventListener('click',()=>goToStep(state.step+1));
  note.addEventListener('click',()=>root.dispatchEvent(new CustomEvent('worksheet:open',{bubbles:true,detail:{step:state.step}})));

  function renderCards(stage) {
    const animals=data.animals.filter(a=>data.stages[stage].includes(a.id));
    const table=element('table',undefined,'method-traits');
    const head=element('tr');head.append(element('th','动物'));
    const features = data.features.filter(f=>stage===2 || ['meat','stripes','tail'].includes(f.id));
    features.forEach(f=>head.append(element('th',f.short)));
    const thead=element('thead');thead.append(head);table.append(thead);
    const tbody=element('tbody');
    animals.forEach(a=>{
      const row=element('tr');row.append(element('th',`${a.icon} ${a.name}`));
      features.forEach(f=>{
        const has=a.traits.includes(f.id);
        row.append(element('td',has?'是':'否',has?'is-yes':'is-no'));
      });
      tbody.append(row);
    });
    table.append(tbody);const scroll=element('div',undefined,'method-table-scroll');scroll.append(table);
    const cards=element('details',undefined,'method-cards');cards.open=state.step===0||state.cardsOpen;
    const summary=element('summary');
    summary.append(element('span','动物特征卡片'), element('small',`本段共 ${animals.length} 种动物`));
    cards.append(summary,scroll);
    cards.addEventListener('toggle',()=>{if(state.step>0){state.cardsOpen=cards.open;changed();}});
    body.append(cards);
    return animals;
  }
  function collectPlacedAnimals(node, set = new Set()) {
    if (!node || typeof node !== 'object') return set;
    if (node.animal) set.add(node.animal);
    if (node.yes) collectPlacedAnimals(node.yes, set);
    if (node.no) collectPlacedAnimals(node.no, set);
    return set;
  }
  function makePaletteChip(payload, label, icon, extraClass, locked = false, placed = false) {
    const chip = element('button', undefined, `palette-chip ${extraClass}${picked === payload ? ' is-selected' : ''}${placed ? ' is-placed' : ''}`);
    chip.type = 'button';
    chip.disabled = locked;
    chip.setAttribute('aria-pressed', picked === payload ? 'true' : 'false');
    if (icon) chip.append(element('span', icon, 'palette-chip-icon'));
    chip.append(element('span', label, 'palette-chip-label'));
    if (placed) chip.append(element('small', '已放', 'palette-chip-tag'));
    if (!locked) {
      chip.draggable = true;
      chip.addEventListener('dragstart', event => {
        picked = null;
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-shanhai-node', payload);
        event.dataTransfer.setData('text/plain', payload);
        chip.classList.add('is-dragging');
      });
      chip.addEventListener('dragend', () => chip.classList.remove('is-dragging'));
      chip.addEventListener('click', () => {
        picked = picked === payload ? null : payload;
        render();
      });
    }
    return chip;
  }
  function renderDecision() {
    intro.textContent = state.step===0 ? '从上方把动物拖到“是”或“否”两个分支中（也可先点动物，再点分支）。' : state.step===1 ? '从上方拖入判断条件与动物；也可先点选牌再点击树节点放置。' : '从上方自由选择判断条件与 6 种动物；搭好后点击「验证决策树」。';
    const animals=renderCards(state.step);
    const catalog={...data,stage:state.step};
    const tools=element('div',undefined,'method-tools');
    const back=element('button','撤销上一步'), clear=element('button','清空重搭');
    back.type=clear.type='button';
    back.disabled=!undo.some(item=>item.step===state.step);
    const currentTree=state.trees[state.step];
    clear.disabled=state.step===0 ? !currentTree.yes?.animal && !currentTree.no?.animal : !currentTree.feature && !currentTree.animal;
    const status=element('p',picked ? '已选中手牌：点击下方树上的目标节点即可放入（再次点击手牌可取消）。' : '搭好分支后，点击「验证决策树」核对每只动物的判断路径。','method-status');status.setAttribute('role','status');
    const results=element('div',undefined,'decision-results');
    const check=element('button','验证决策树','method-btn-primary');check.type='button';
    check.addEventListener('click',()=>{
      const tree=state.trees[state.step];
      const paths=treePaths(tree,animals,data.features);
      const complete=treeComplete(tree,animals,data.features);
      status.className=`method-status ${complete?'is-success':'is-warning'}`;
      status.textContent=complete ? `全部 ${animals.length} 种动物都分对了！可以把这棵树带入本段札记。` : '还有未分开的动物、空分支或分类错误，请按下面的路径检查。';
      results.replaceChildren(...paths.map(p=>{
        const item=element('div',undefined,`decision-result-item ${p.correct?'is-correct':'is-pending'}`);
        const who=element('span',`${p.animal.icon} ${p.animal.name}`,'decision-result-animal');
        const route=element('span',[...p.decisions,p.result?`${p.result.icon} ${p.result.name}`:'待分类'].join(' → '),'decision-result-path');
        const mark=element('span',p.correct?'✓ 通过':'待检查','decision-result-mark');
        item.append(who,route,mark);
        return item;
      }));
    });
    back.addEventListener('click',()=>{
      const index=undo.findLastIndex(item=>item.step===state.step);
      if(index<0)return;picked=null;state.trees[state.step]=undo[index].tree;undo.splice(index,1);changed();render();
    });
    clear.addEventListener('click',()=>{
      undo.push({step:state.step,tree:copy(state.trees[state.step])});if(undo.length>20)undo.shift();
      picked=null;state.trees[state.step]=state.step===0 ? {feature:'meat',yes:{},no:{}} : {};
      changed();render();
    });
    const legend=element('span',undefined,'decision-legend');
    legend.append(element('i','■','is-cond'),' 判断条件　',element('i','■','is-leaf'),' 分类结果');
    const zoomBox=element('div',undefined,'decision-zoom-controls');
    const zoomOut=element('button','－'), zoomReset=element('button',`${Math.round(zoom*100)}%`), zoomIn=element('button','＋'), zoomFit=element('button','全览');
    [zoomOut,zoomReset,zoomIn,zoomFit].forEach(b=>b.type='button');
    zoomOut.setAttribute('aria-label','缩小决策树');zoomIn.setAttribute('aria-label','放大决策树');
    zoomReset.setAttribute('aria-label','恢复100%大小');zoomFit.setAttribute('aria-label','缩放至一屏全览');
    zoomBox.append(zoomOut,zoomReset,zoomIn,zoomFit);
    tools.append(back,clear,zoomBox,legend);body.append(tools);

    const dock=element('div',undefined,'decision-dock');
    const featurePane=element('section',undefined,'decision-palette is-features');
    const featureHead=element('div',undefined,'decision-palette-head');
    featureHead.append(element('h4','判断条件'),element('span',state.step===0?'本段固定根条件':'拖到下方节点','decision-palette-hint'));
    const featureList=element('div',undefined,'palette-list');
    data.features.forEach(f=>{
      featureList.append(makePaletteChip(`feature:${f.id}`,f.label,null,'is-feature',state.step===0,false));
    });
    featurePane.append(featureHead,featureList);

    const placed=collectPlacedAnimals(currentTree);
    const animalPane=element('section',undefined,'decision-palette is-animals');
    const animalHead=element('div',undefined,'decision-palette-head');
    animalHead.append(element('h4','动物结果'),element('span','拖到分支末端','decision-palette-hint'));
    const animalList=element('div',undefined,'palette-list');
    animals.forEach(a=>{
      animalList.append(makePaletteChip(`animal:${a.id}`,a.name,a.icon,'is-animal',false,placed.has(a.id)));
    });
    animalPane.append(animalHead,animalList);
    dock.append(featurePane,animalPane);

    const canvas=element('div',undefined,'decision-canvas');
    const stage=element('div',undefined,'decision-zoom-stage');
    const stageContent=element('div',undefined,'decision-zoom-content');
    stage.append(stageContent);canvas.append(stage);
    const change=(node,replacement)=>{
      undo.push({step:state.step,tree:copy(state.trees[state.step])});if(undo.length>20)undo.shift();
      picked=null;Object.keys(node).forEach(key=>delete node[key]);Object.assign(node,replacement);changed();render();
    };
    const onTapPlace=(acceptKind,apply)=>{
      if(!picked)return;
      const [kind]=picked.split(':');
      if(acceptKind!=='any'&&kind!==acceptKind)return;
      const replacement=parseNodePayload(picked);
      if(replacement)apply(replacement);
    };
    if(state.step===0){
      const tree=state.trees[0];
      // 第一段保留一个固定判断条件，只让学生选择两片叶子。
      const container=element('div',undefined,'decision-node has-branches');container.dataset.nodeKind='condition';
      const card=element('div',undefined,'decision-card');
      const head=element('div',undefined,'decision-card-head');head.append(element('span','固定条件','decision-kind'));
      card.append(head, element('strong','主要吃肉吗？','decision-condition-title'));
      container.append(card);
      const branches=element('div',undefined,'decision-branches');
      ['yes','no'].forEach((key,i)=>{
        const branch=element('div',undefined,`decision-branch is-${key}`);branch.append(element('span',i===0?'是':'否',`decision-edge is-${key}`));
        const leafId=tree[key].animal||'';
        const leafAnimal=animals.find(a=>a.id===leafId);
        const leafNode=element('div',undefined,'decision-node');leafNode.dataset.nodeKind=leafId?'leaf':'empty';
        const leafCard=element('div',undefined,'decision-card');
        const leafHead=element('div',undefined,'decision-card-head');leafHead.append(element('span',leafId?'分类结果':'待选择','decision-kind'));
        if(leafAnimal?.icon)leafHead.append(element('span',leafAnimal.icon,'decision-animal-icon'));
        if(leafId){
          const clearBtn=element('button','×','decision-node-clear');clearBtn.type='button';clearBtn.title='清空此分支';clearBtn.setAttribute('aria-label','清空此分支');
          clearBtn.addEventListener('click',()=>change(tree[key],{}));leafHead.append(clearBtn);
        }
        const leafTitle=element('strong',leafAnimal?leafAnimal.name:'拖入动物','decision-card-title');
        const select=element('select',undefined,'decision-fallback-select');select.setAttribute('aria-label',i===0?'主要吃肉：是':'主要吃肉：否');select.append(new Option('切换或选择…',''));
        animals.forEach(a=>select.append(new Option(`${a.icon} ${a.name}`,a.id)));select.value=leafId;
        select.addEventListener('change',()=>change(tree[key],select.value?{animal:select.value}:{}));
        bindNodeDrop(leafCard,'animal',replacement=>change(tree[key],replacement),onTapPlace);
        leafCard.append(leafHead,leafTitle,select);leafNode.append(leafCard);branch.append(leafNode);branches.append(branch);
      });
      container.append(branches);stageContent.append(container);
    }else stageContent.append(renderTree(state.trees[state.step],catalog,true,change,animals.map(a=>a.id),0,{onTapPlace}));

    const applyZoom=(nextZoom, anchor)=>{
      const oldZoom=zoom;
      const clamped=Math.min(1.4,Math.max(0.5,Math.round(nextZoom*100)/100));
      let cursorX, cursorY, contentX, contentY;
      if(anchor && oldZoom){
        const rect=canvas.getBoundingClientRect();
        cursorX=anchor.clientX-rect.left;
        cursorY=anchor.clientY-rect.top;
        contentX=(canvas.scrollLeft+cursorX-stage.offsetLeft)/oldZoom;
        contentY=(canvas.scrollTop+cursorY-stage.offsetTop)/oldZoom;
      }
      zoom=clamped;
      zoomReset.textContent=`${Math.round(zoom*100)}%`;
      zoomOut.disabled=zoom<=0.5;zoomIn.disabled=zoom>=1.4;
      stageContent.style.transform=`scale(${zoom})`;
      const w=stageContent.offsetWidth, h=stageContent.offsetHeight;
      if(w&&h){
        stage.style.width=`${Math.ceil(w*zoom)}px`;
        stage.style.height=`${Math.ceil(h*zoom)}px`;
      }
      if(anchor && oldZoom && clamped!==oldZoom){
        canvas.scrollLeft=stage.offsetLeft+contentX*zoom-cursorX;
        canvas.scrollTop=stage.offsetTop+contentY*zoom-cursorY;
      }
    };
    const centerAnchor=()=>{
      const rect=canvas.getBoundingClientRect();
      return {clientX:rect.left+canvas.clientWidth/2, clientY:rect.top+canvas.clientHeight/2};
    };
    zoomOut.addEventListener('click',()=>applyZoom(zoom-0.1, centerAnchor()));
    zoomIn.addEventListener('click',()=>applyZoom(zoom+0.1, centerAnchor()));
    zoomReset.addEventListener('click',()=>applyZoom(1, centerAnchor()));
    zoomFit.addEventListener('click',()=>{
      const availW=canvas.clientWidth-28, availH=canvas.clientHeight-44;
      const fullW=stageContent.offsetWidth, fullH=stageContent.offsetHeight;
      if(availW>0&&availH>0&&fullW>0&&fullH>0)applyZoom(Math.min(1,availW/fullW,availH/fullH));
    });
    canvas.addEventListener('wheel',event=>{
      event.preventDefault();
      applyZoom(zoom+(event.deltaY<0?0.1:-0.1), event);
    },{passive:false});
    let pan=null;
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.target.closest('.decision-card, select, button'))return;
      pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:canvas.scrollLeft,top:canvas.scrollTop};
      canvas.classList.add('is-panning');
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove',event=>{
      if(!pan||event.pointerId!==pan.id)return;
      canvas.scrollLeft=pan.left-(event.clientX-pan.x);
      canvas.scrollTop=pan.top-(event.clientY-pan.y);
    });
    const endPan=event=>{
      if(!pan||event.pointerId!==pan.id)return;
      pan=null;canvas.classList.remove('is-panning');
    };
    canvas.addEventListener('pointerup',endPan);
    canvas.addEventListener('pointercancel',endPan);

    const verifyBar=element('div',undefined,'decision-verify-bar');
    verifyBar.append(check,status);
    body.append(dock,canvas,verifyBar,results);
    requestAnimationFrame(()=>applyZoom(zoom));
  }

  function renderKnn() {
    const explore=state.step===2, reveal=state.step>0||state.reveal;
    const samples=explore ? state.points||data.samples : data.samples;
    const target=explore ? state.target : data.target;
    const k=state.step===0?1:state.k;
    const result=nearest(samples,target,k);
    const neighborIds=new Set(result.neighbors.map(p=>p.id));
    const beastFiles={'天狗':'tiangou','长右':'changyou','类':'lei','朱厌':'zhuyan'};
    const beastUrl=new URL(`../../bestiary/display/${beastFiles[state.beast]||'tiangou'}.png`,import.meta.url).href;
    intro.textContent=explore ? '本环节为位置模拟：图片只作标记，图片为何能变成“坐标”会在后续课程讲解。点击坐标图可移动异兽或补充样本。' : state.step===0 ? '这是简化的特征位置示意图。两点越近，表示所选特征越相似；先找离★最近的样本。' : '样本和★的位置保持不变，只改变 K，观察邻居组成与多数投票结果。';
    const tools=element('div',undefined,`method-tools${explore?' is-knn-explore':''}`);
    const makeKSlider=()=>{
      const label=element('label',`K = ${k}`,'knn-k-control');const slider=element('input');slider.type='range';slider.min=1;slider.max=9;slider.step=2;slider.value=k;slider.setAttribute('aria-label','K值');
      slider.addEventListener('input',()=>{state.k=Number(slider.value);changed();render();root.querySelector('input[type="range"]').focus({preventScroll:true});});label.append(slider);return label;
    };
    if(state.step===0){const button=element('button','显示最近的邻居','method-btn-primary');button.type='button';button.addEventListener('click',()=>{state.reveal=true;changed();render();});tools.append(button);}
    else if(!explore){tools.append(makeKSlider());}
    else {
      const topRow=element('div',undefined,'knn-tool-row');
      topRow.append(makeKSlider());

      const modeGroup=element('div',undefined,'knn-radio-group');modeGroup.setAttribute('role','radiogroup');modeGroup.setAttribute('aria-label','点击坐标图的操作');
      const modeWrap=element('div',undefined,'knn-tool-group');
      modeWrap.append(element('span','点击模式','knn-tool-label'),modeGroup);
      [['test','移动异兽'],['monkey','补充金丝猴样本'],['leopard','补充雪豹样本']].forEach(([v,t])=>{
        const btn=element('button',t,`knn-radio-btn${state.mode===v?' is-active':''}`);btn.type='button';btn.setAttribute('role','radio');btn.setAttribute('aria-checked',state.mode===v?'true':'false');
        btn.addEventListener('click',()=>{
          state.mode=v;changed();
          [...modeGroup.children].forEach((b,i)=>{const active=['test','monkey','leopard'][i]===v;b.classList.toggle('is-active',active);b.setAttribute('aria-checked',active?'true':'false');});
        });
        modeGroup.append(btn);
      });
      topRow.append(modeWrap);

      const restore=element('button','恢复示例点位','knn-restore-btn');restore.type='button';restore.addEventListener('click',()=>{state.points=null;state.target=copy(data.target);state.k=3;changed();render();});
      topRow.append(restore);

      const beastRow=element('div',undefined,'knn-tool-row is-beasts');
      const beastGroup=element('div',undefined,'knn-beast-group');beastGroup.setAttribute('role','radiogroup');beastGroup.setAttribute('aria-label','异兽标记');
      beastRow.append(element('span','异兽标记','knn-tool-label'),beastGroup);
      ['天狗','长右','类','朱厌'].forEach(name=>{
        const active=state.beast===name, captured=Boolean(state.captures?.[name]);
        const btn=element('button',undefined,`knn-beast-btn${active?' is-active':''}${captured?' is-captured':''}`);btn.type='button';btn.setAttribute('role','radio');btn.setAttribute('aria-checked',active?'true':'false');
        const img=element('img');img.className='knn-beast-thumb';img.alt='';img.src=new URL(`../../bestiary/display/${beastFiles[name]}.png`,import.meta.url).href;
        btn.append(img,element('span',name));
        if(captured)btn.append(element('small','✓','knn-beast-done'));
        btn.addEventListener('click',()=>{state.beast=name;changed();render();});
        beastGroup.append(btn);
      });
      const hasCurrent=Boolean(state.captures?.[state.beast]);
      const capBtn=element('button',hasCurrent?`重截「${state.beast}」`:`截取为「${state.beast}」`,'method-btn-primary knn-capture-btn');
      capBtn.type='button';
      capBtn.addEventListener('click',()=>{
        state.captures={...(state.captures||{}),[state.beast]:{target:copy(target),k:state.k,points:state.points?copy(state.points):null}};
        changed();save();render();
      });
      beastRow.append(capBtn);
      const doneCount=['天狗','长右','类','朱厌'].filter(n=>state.captures?.[n]).length;
      tools.append(topRow,beastRow,element('p',`已截取 ${doneCount}/4 只异兽（截取后可在下方「填写本段札记」中查看或重截替换）。`,'knn-capture-progress'));
    }
    body.append(tools);
    const work=element('div',undefined,'knn-work');
    const plot=element('div',undefined,`knn-plot${explore?' is-explore':''}`);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 500 480');svg.setAttribute('role','img');svg.setAttribute('aria-label',explore?`特征位置图：圆形为金丝猴，方形为雪豹，${state.beast}头像为待分类点`:'特征位置图：圆形为金丝猴，方形为雪豹，星号为待分类点');
    const draw=(tag,attrs={},text,parent=svg)=>{const n=document.createElementNS(svg.namespaceURI,tag);Object.entries(attrs).forEach(([key,value])=>n.setAttribute(key,value));if(text!==undefined)n.textContent=text;parent.append(n);return n;};
    // 横纵轴使用相同缩放（4px/单位），画面上的远近与欧氏距离一致。
    const OX=52, OY=436, SPAN=400;
    const px=x=>OX+x*4, py=y=>OY-y*4;

    const defs=draw('defs');
    const marker=draw('marker',{id:'knn-axis-arrow',viewBox:'0 0 10 10',refX:7,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'},undefined,defs);
    draw('path',{d:'M 1 1.5 L 8.5 5 L 1 8.5 z',fill:'#4f6659'},undefined,marker);
    const clip=draw('clipPath',{id:'knn-plot-clip'},undefined,defs);
    draw('rect',{x:OX,y:OY-SPAN,width:SPAN,height:SPAN},undefined,clip);
    if(explore){
      const beastClip=draw('clipPath',{id:'knn-beast-clip'},undefined,defs);
      draw('circle',{cx:0,cy:0,r:14},undefined,beastClip);
    }

    draw('rect',{x:OX,y:OY-SPAN,width:SPAN,height:SPAN,class:'knn-plot-bg'});
    const gridGroup=draw('g',{class:'knn-grid-layer'});
    for(let n=10;n<=100;n+=10){
      const cls=n%20===0?'knn-grid knn-grid-major':'knn-grid knn-grid-minor';
      draw('line',{x1:px(n),y1:OY-SPAN,x2:px(n),y2:OY,class:cls},undefined,gridGroup);
      draw('line',{x1:OX,y1:py(n),x2:OX+SPAN,y2:py(n),class:cls},undefined,gridGroup);
    }
    const axisGroup=draw('g',{class:'knn-axis-layer'});
    draw('line',{x1:OX,y1:OY,x2:OX+SPAN+16,y2:OY,class:'knn-axis','marker-end':'url(#knn-axis-arrow)'},undefined,axisGroup);
    draw('line',{x1:OX,y1:OY,x2:OX,y2:OY-SPAN-16,class:'knn-axis','marker-end':'url(#knn-axis-arrow)'},undefined,axisGroup);
    draw('text',{x:OX-8,y:OY+14,'text-anchor':'end',class:'knn-tick-label'},'0',axisGroup);
    for(let n=20;n<=100;n+=20){
      draw('line',{x1:px(n),y1:OY,x2:px(n),y2:OY+5,class:'knn-tick'},undefined,axisGroup);
      draw('text',{x:px(n),y:OY+19,'text-anchor':'middle',class:'knn-tick-label'},String(n),axisGroup);
      draw('line',{x1:OX-5,y1:py(n),x2:OX,y2:py(n),class:'knn-tick'},undefined,axisGroup);
      draw('text',{x:OX-10,y:py(n)+4,'text-anchor':'end',class:'knn-tick-label'},String(n),axisGroup);
    }
    draw('text',{x:OX+SPAN,y:OY+36,'text-anchor':'end',class:'knn-axis-title'},'示意特征一',axisGroup);
    draw('text',{x:OX+10,y:OY-SPAN-12,'text-anchor':'start',class:'knn-axis-title'},'示意特征二',axisGroup);

    const clipLayer=draw('g',{'clip-path':'url(#knn-plot-clip)'});
    if(reveal&&result.neighbors.length){
      const radius=result.neighbors[result.neighbors.length-1].distance*4;
      if(radius>0)draw('circle',{cx:px(target.x),cy:py(target.y),r:radius,class:'knn-radius'},undefined,clipLayer);
    }
    const hoverGuide=explore?draw('g',{class:'knn-hover-guide',visibility:'hidden'},undefined,clipLayer):null;
    const hoverX=hoverGuide?draw('line',{x1:OX,y1:OY,x2:OX+SPAN,y2:OY,class:'knn-crosshair'},undefined,hoverGuide):null;
    const hoverY=hoverGuide?draw('line',{x1:OX,y1:OY-SPAN,x2:OX,y2:OY,class:'knn-crosshair'},undefined,hoverGuide):null;
    const hoverTag=explore?draw('text',{x:OX+SPAN-8,y:OY-SPAN+18,'text-anchor':'end',class:'knn-hover-coord',visibility:'hidden'}):null;

    if(reveal){
      const linkGroup=draw('g',{class:'knn-link-layer'});
      result.neighbors.forEach(p=>draw('line',{x1:px(target.x),y1:py(target.y),x2:px(p.x),y2:py(p.y),class:'knn-link'},undefined,linkGroup));
    }

    const sampleGroup=draw('g',{class:'knn-sample-layer'});
    samples.forEach(p=>{
      const isNbr=reveal&&neighborIds.has(p.id);
      const stateCls=reveal?(isNbr?' is-neighbor':' is-dimmed'):'';
      const g=draw('g',{class:`knn-point${stateCls}`},undefined,sampleGroup);
      if(isNbr)draw('circle',{cx:px(p.x),cy:py(p.y),r:11,class:`knn-neighbor-halo ${p.type}`},undefined,g);
      const attrs={class:`knn-sample ${p.type}`};
      if(p.type==='monkey')draw('circle',{...attrs,cx:px(p.x),cy:py(p.y),r:6.5},undefined,g);
      else draw('rect',{...attrs,x:px(p.x)-6,y:py(p.y)-6,width:12,height:12,rx:1.5},undefined,g);
      draw('text',{x:px(p.x)+9,y:py(p.y)-8,class:'knn-point-label'},p.id,g);
    });

    const targetGroup=draw('g',{class:'knn-target-layer',transform:`translate(${px(target.x)},${py(target.y)})`});
    if(explore){
      draw('circle',{cx:0,cy:0,r:17.5,class:'knn-target-halo'},undefined,targetGroup);
      draw('circle',{cx:0,cy:0,r:14.5,class:'knn-target-badge'},undefined,targetGroup);
      draw('image',{href:beastUrl,x:-14,y:-14,width:28,height:28,'clip-path':'url(#knn-beast-clip)',preserveAspectRatio:'xMidYMid slice'},undefined,targetGroup);
      draw('circle',{cx:0,cy:0,r:14.5,class:'knn-target-ring'},undefined,targetGroup);
      draw('text',{x:0,y:28,'text-anchor':'middle',class:'knn-target-label'},state.beast,targetGroup);
    }else{
      draw('circle',{cx:0,cy:0,r:13,class:'knn-target-halo'},undefined,targetGroup);
      draw('path',{d:'M0,-9.5 L2.7,-3.1 L9.5,-2.9 L4.2,1.5 L6.0,8.2 L0,4.4 L-6.0,8.2 L-4.2,1.5 L-9.5,-2.9 L-2.7,-3.1 Z',class:'knn-target-star'},undefined,targetGroup);
      draw('text',{x:0,y:24,'text-anchor':'middle',class:'knn-target-label'},'待分类点',targetGroup);
    }

    const summary=element('aside',undefined,'knn-summary');
    if(reveal){
      const verdict=element('div',undefined,`knn-verdict is-${result.result}`);
      verdict.append(element('span',`K = ${result.neighbors.length} · 多数投票判断`,'knn-verdict-kicker'));
      const main=element('div',undefined,'knn-verdict-main');
      if(result.result!=='tie')main.append(element('i',undefined,`knn-dot is-${result.result}`));
      main.append(element('strong',labels[result.result]));
      verdict.append(main);
      summary.append(verdict);
    }
    const status=element('p',reveal ? `参考最近 ${result.neighbors.length} 个邻居：金丝猴 ${result.monkey} 票，雪豹 ${result.leopard} 票。` : '先观察点位，再显示连线核对。','method-status');status.setAttribute('role','status');

    if(explore){
      const toDataCoords=event=>{
        const ctm=svg.getScreenCTM();if(!ctm)return null;
        const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(ctm.inverse());
        if(p.x<OX||p.x>OX+SPAN||p.y<OY-SPAN||p.y>OY)return null;
        return {x:Math.round((p.x-OX)/4),y:Math.round((OY-p.y)/4)};
      };
      svg.addEventListener('pointermove',event=>{
        const coords=toDataCoords(event);
        if(!coords){hoverGuide.setAttribute('visibility','hidden');hoverTag.setAttribute('visibility','hidden');return;}
        const cx=px(coords.x), cy=py(coords.y);
        hoverX.setAttribute('y1',cy);hoverX.setAttribute('y2',cy);
        hoverY.setAttribute('x1',cx);hoverY.setAttribute('x2',cx);
        hoverGuide.setAttribute('visibility','visible');
        hoverTag.textContent=`(${coords.x}, ${coords.y})`;
        hoverTag.setAttribute('visibility','visible');
      });
      svg.addEventListener('pointerleave',()=>{hoverGuide.setAttribute('visibility','hidden');hoverTag.setAttribute('visibility','hidden');});
      const setPoint=(x,y)=>{
        if(state.mode==='test')state.target={x,y};else{
          const points=copy(state.points||data.samples);if(points.length>=30){status.textContent='最多保留30个样本，可恢复示例点位后重新探索。';return;}
          points.push({id:`自${points.length+1}`,x,y,type:state.mode});state.points=points;
        }
        changed();render();
      };
      svg.addEventListener('click',event=>{const coords=toDataCoords(event);if(coords)setPoint(coords.x,coords.y);});
      // 数值输入也可移动测试点，避免只提供鼠标操作。
      const coordinates=element('div',undefined,'knn-coordinates');
      const xy={};['x','y'].forEach(axis=>{const label=element('label',axis.toUpperCase()+' ');const input=element('input');input.type='number';input.min=0;input.max=100;input.step=1;input.value=target[axis];input.setAttribute('aria-label','异兽'+axis.toUpperCase()+'坐标');xy[axis]=input;label.append(input);coordinates.append(label);});
      const move=element('button','移动到此坐标');move.type='button';move.addEventListener('click',()=>{const x=Number(xy.x.value),y=Number(xy.y.value);if(xy.x.value===''||xy.y.value===''||!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>100||y<0||y>100){status.textContent='坐标请填写0—100的整数。';return;}state.target={x,y};changed();render();});coordinates.append(move);plot.append(coordinates);
    }
    plot.prepend(svg);
    const legend=element('div',undefined,'knn-legend');
    legend.innerHTML='<span><i class="knn-swatch is-monkey"></i>金丝猴</span><span><i class="knn-swatch is-leopard"></i>雪豹</span>';
    if(explore){
      const beastItem=element('span');
      const icon=element('img',undefined,'knn-swatch-img');icon.src=beastUrl;icon.alt='';
      beastItem.append(icon,document.createTextNode(`${state.beast}（待分类）`));
      legend.append(beastItem);
    }else{
      const starItem=element('span');starItem.innerHTML='<i class="knn-swatch is-target">★</i>待分类点';
      legend.append(starItem);
    }
    if(reveal){
      const radiusItem=element('span');radiusItem.innerHTML='<i class="knn-swatch is-radius"></i>K 邻域边界';
      legend.append(radiusItem);
    }
    plot.append(legend);

    summary.append(status);
    if(reveal){
      const tally=element('div',undefined,'knn-tally');
      const total=Math.max(1,result.neighbors.length);
      [['monkey','金丝猴',result.monkey],['leopard','雪豹',result.leopard]].forEach(([type,name,count])=>{
        const row=element('div',undefined,`knn-tally-row${result.result===type?' is-winner':''}`);
        const head=element('div',undefined,'knn-tally-head');
        head.append(element('span',name),element('strong',`${count} 票`));
        const track=element('div',undefined,'knn-tally-track');
        const fill=element('div',undefined,`knn-tally-fill is-${type}`);
        fill.style.width=`${(count/total)*100}%`;
        track.append(fill);row.append(head,track);tally.append(row);
      });
      summary.append(tally);

      const table=element('table',undefined,'knn-table');table.innerHTML='<thead><tr><th>邻居</th><th>类别</th><th>距离</th></tr></thead>';const tbody=element('tbody');result.neighbors.forEach(p=>{const row=element('tr');const who=element('td');who.append(element('i',undefined,`knn-dot is-${p.type}`),document.createTextNode(p.id));row.append(who,element('td',labels[p.type]),element('td',p.distance.toFixed(1)));tbody.append(row);});table.append(tbody);summary.append(table);
    }
    work.append(plot,summary);body.append(work);
  }
  function render() {
    heading.textContent=titles[state.step];body.replaceChildren();
    [...nav.children].forEach((button,i)=>{button.disabled=!allowed(i);button.setAttribute('aria-current',i===state.step?'step':'false');});
    previous.disabled=state.step===0||!allowed(state.step-1);next.hidden=state.step===2;next.disabled=!allowed(state.step+1);
    if(kind==='tree')renderDecision();else renderKnn();
  }
  window.addEventListener('pagehide',save);render();
  return {
    catalog:data,getStep:()=>state.step,goToStep,refresh:render,pause:save,
    setGate(value){gate=value;if(!allowed(state.step))goToStep(value?.[0]??0);else render();},
    treeSnapshot(stage){return {schema_version:1,animal_ids:copy(data.stages[stage]),tree:copy(state.trees[stage])};},
    knnCaptures(){return kind==='knn'?copy(state.captures||{}):{};},
    captureBeast(beast){
      if(kind!=='knn'||state.beast!==beast)return null;
      const snap={target:copy(state.target),k:state.k,points:state.points?copy(state.points):null};
      state.captures={...(state.captures||{}),[beast]:copy(snap)};
      changed();save();render();
      return snap;
    },
    experimentAnswers(){return {};},
    reset(){clearTimeout(timer);dirty=false;try{localStorage.removeItem(key);}catch{/* 仍恢复页面。 */}state=initial();undo=[];render();onStepChange(0);},
  };
}

/* 第四步只编辑训练样本；确认不会更新模型，返回第二步训练时才使用。 */
(function () {
  window.createHandwritingExtension = function (saved, changed) {
    S.sampleDraft ||= saved?.draft || {label:'', pixels:Array(216).fill(0)};
    const panel = document.getElementById('handwriting-extension');
    // 用可缩放的手写笔画绘制数字，选项仍是原生单选，支持键盘与触控。
    const digitPaths = [
      'M18 5C6 2 4 30 14 32C26 36 29 4 18 5Z',
      'M11 12 18 5 17 32M11 32 24 32',
      'M7 12C9 1 27 3 25 13C24 19 12 23 7 31L26 31',
      'M8 7C22 0 30 11 17 17C32 17 27 35 7 30',
      'M22 32 23 5 6 23 29 23',
      'M26 5 10 6 8 18C24 11 32 29 19 32C12 34 7 29 6 27',
      'M25 6C14 0 4 21 8 29C13 38 28 30 25 22C21 13 9 17 8 24',
      'M6 6 28 5C20 14 15 24 12 33',
      'M17 18C0 9 14 0 23 6C33 14 10 21 8 27C5 37 29 35 27 25C25 21 20 19 17 18Z',
      'M25 14C25 1 7 2 7 13C7 24 25 23 25 14L23 27C21 33 15 34 10 31'
    ];
    const choices = [1,2,3,4,5,6,7,8,9,0].map(digit=>`<label class="own-digit${digit===0?' own-digit-zero':''}"><input type="radio" name="own-label" value="${digit}" aria-label="数字${digit}"><span class="own-digit-face"><svg viewBox="0 0 36 38" aria-hidden="true"><path d="${digitPaths[digit]}" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="${digitPaths[digit]}" fill="none" stroke="currentColor" stroke-width=".8" opacity=".25" transform="translate(.6 -.3)"/></svg></span></label>`).join('');
    panel.innerHTML = `<div class="own-editor"><div class="own-writing"><span class="own-writing-heading">手写笔迹</span><canvas id="own-canvas" width="240" height="360" tabindex="0" aria-label="自己的训练样本：手写数字，方向键移动，空格涂写，Delete擦除"></canvas><div class="extension-actions"><button id="own-pen" aria-pressed="true">画笔</button><button id="own-eraser" aria-pressed="false">橡皮</button><button id="own-clear">清空</button></div></div><div class="own-form"><span id="own-label-heading">我写的是</span><div id="own-label" class="own-digit-grid" role="group" aria-labelledby="own-label-heading">${choices}</div><button id="own-add-train" class="primary">确认加入</button><p class="hint">加入下方训练集后，返回第2步继续训练。</p><p id="own-message" role="status"></p></div></div>`;
    const el = id => document.getElementById(id), canvas = el('own-canvas');
    panel.insertAdjacentHTML('beforeend', `<div id="own-samples-bar" class="own-samples-bar" hidden><div class="own-samples-head"><strong>已加入的本地样本</strong><span id="own-samples-count"></span></div><div id="own-sample-list" class="own-sample-list"></div></div>`);
    let pointer = null, last = null, tool = 1, keyboardPixel = 114;
    function renderOwnSamples() {
      const bar = el('own-samples-bar'), list = el('own-sample-list'), count = el('own-samples-count');
      if (!bar || !list) return;
      const samples = S.ownSamples || [];
      bar.hidden = samples.length === 0;
      count.textContent = `${samples.length} 张`;
      list.innerHTML = samples.map(sample => `<div class="own-sample-item"><img src="${sampleImage(sample)}" alt="${sample.id}，数字${sample.label}"><div class="own-sample-meta"><strong>${sample.id}</strong><span>数字 ${sample.label}</span></div><button type="button" class="quiet own-sample-delete" data-delete-own="${sample.id}" aria-label="删除本地样本 ${sample.id}">删除</button></div>`).join('');
    }
    function deleteOwnSample(id) {
      if (S.busy) return;
      const index = (S.ownSamples || []).findIndex(sample => sample.id === id);
      if (index < 0) return;
      const [removed] = S.ownSamples.splice(index, 1);
      const usedInHistory = Object.values(S.trainingOverrides || {}).includes(id);
      if (usedInHistory) {
        S.retiredSamples ||= [];
        if (!S.retiredSamples.some(sample => sample.id === id)) S.retiredSamples.push(removed);
      }
      if (S.trainingCursor !== null && S.trainingCursor >= D.training.length) {
        if (!S.ownSamples.length) S.trainingCursor = null;
        else S.trainingCursor = Math.min(S.trainingCursor, D.training.length + S.ownSamples.length - 1);
      }
      if (S.trainFrame?.sample?.id === id) {
        S.trainFrame = makeFrame(D.training.find(s => s.id === D.firstTraining));
      }
      buildGalleries();
      renderOwnSamples();
      draw();
      changed();
      el('own-message').textContent = usedInHistory ? `已删除 ${id}（已完成的训练记录仍保留）。` : `已删除 ${id}。`;
    }
    el('own-sample-list').addEventListener('click', event => {
      const btn = event.target.closest('[data-delete-own]');
      if (btn) deleteOwnSample(btn.dataset.deleteOwn);
    });
    function draw() {
      paintGrid(canvas, S.sampleDraft.pixels, false, document.activeElement === canvas && pointer === null ? keyboardPixel : -1);
      el('own-label').querySelectorAll('input').forEach(input=>input.checked=input.value===String(S.sampleDraft.label));
      el('own-pen').setAttribute('aria-pressed', tool === 1);
      el('own-eraser').setAttribute('aria-pressed', tool === 0);
    }
    function point(event) {
      const box = canvas.getBoundingClientRect();
      return {x:Math.max(0,Math.min(11,Math.floor((event.clientX-box.left)/box.width*12))),y:Math.max(0,Math.min(17,Math.floor((event.clientY-box.top)/box.height*18)))};
    }
    function stroke(point) {
      const start = last || point, steps = Math.max(1,Math.abs(point.x-start.x),Math.abs(point.y-start.y));
      for(let i=0;i<=steps;i++) S.sampleDraft.pixels[Math.round(start.y+(point.y-start.y)*i/steps)*12+Math.round(start.x+(point.x-start.x)*i/steps)] = tool;
      last = point; draw(); changed();
    }
    canvas.addEventListener('pointerdown', event => {
      if(S.busy || pointer !== null || event.button !== 0) return;
      event.preventDefault(); canvas.focus(); pointer=event.pointerId; last=null; canvas.setPointerCapture(pointer); stroke(point(event));
    });
    canvas.addEventListener('pointermove', event => {if(event.pointerId===pointer) stroke(point(event));});
    for(const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type,()=>{pointer=null;last=null;});
    canvas.addEventListener('keydown', event => {
      const moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:-12,ArrowDown:12};
      if(event.key in moves) {
        event.preventDefault(); const x=keyboardPixel%12;
        if((event.key!=='ArrowLeft'||x>0)&&(event.key!=='ArrowRight'||x<11)) keyboardPixel=Math.max(0,Math.min(215,keyboardPixel+moves[event.key]));
        draw();
      } else if([' ','Enter','Delete','Backspace'].includes(event.key)) {
        event.preventDefault(); S.sampleDraft.pixels[keyboardPixel]=['Delete','Backspace'].includes(event.key)?0:tool; draw(); changed();
      }
    });
    canvas.addEventListener('focus',draw); canvas.addEventListener('blur',draw);
    el('own-pen').onclick=()=>{tool=1;draw();}; el('own-eraser').onclick=()=>{tool=0;draw();};
    el('own-clear').onclick=()=>{S.sampleDraft.pixels.fill(0);draw();changed();};
    el('own-label').onchange=event=>{S.sampleDraft.label=event.target.value;draw();changed();};
    el('own-add-train').onclick=()=>{
      if(S.busy) return;
      const {pixels,label}=S.sampleDraft;
      if(label===''||!pixels.some(Boolean)) {el('own-message').textContent='先选择数字，再写下笔迹。';return;}
      if([...D.training,...D.testing,...S.ownSamples].some(sample=>sameDrawing(sample.pixels,pixels))) {el('own-message').textContent='这张笔迹已存在，请换一种写法。';return;}
      const usedIds = [...S.ownSamples, ...(S.retiredSamples || [])].map(sample => Number(sample.id.slice(1))).filter(Number.isFinite);
      const id='H'+(Math.max(0,...usedIds)+1);
      S.ownSamples.push({id,label:Number(label),pixels:pixels.slice(),addedAt:S.net.steps});
      S.datasetMode='personal';
      // 从新图开始继续遍历训练集，确认加入本身不改变任何权重。
      S.trainingCursor=D.training.length+S.ownSamples.length-1;
      S.sampleDraft.pixels.fill(0); buildGalleries(); renderOwnSamples(); draw(); changed();
      el('own-message').textContent=`${id}已加入，返回第2步训练。`;
    };
    draw();
    renderOwnSamples();
    return {
      // 旧版对照记录仅留存，不再出现在新的添加页中。
      snapshot:()=>saved||null,
      show(visible) {panel.hidden=!visible;document.body.dataset.view=visible?'samples':'lab';if(visible){renderOwnSamples();draw();}},
      pause(){pointer=null;last=null;},
      summary(){return S.ownSamples.map(sample=>`${sample.id}：数字${sample.label}，在累计${sample.addedAt??0}次时加入，已参与${Object.values(S.trainingOverrides).filter(id=>id===sample.id).length}次训练`).join('\n');}
    };
  };
})();

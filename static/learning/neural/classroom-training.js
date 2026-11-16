/* 第五步下载教师发布的不可变数据集，训练仍在当前学生浏览器中执行。 */
(function () {
  window.createClassroomTraining = function (changed, navigate) {
    const panel=document.getElementById('classroom-training');
    panel.innerHTML=`<div class="classroom-dataset-heading"><h3>教师发布的数据</h3><button id="classroom-check">查看教师发布</button></div><p id="classroom-latest" role="status">点击查看教师已发布的数据集。</p><div id="classroom-counts" class="classroom-counts"></div><div class="extension-actions"><button id="classroom-download" class="primary" disabled>下载到本机并使用</button><button id="classroom-personal">使用个人训练集</button></div><p id="classroom-current"></p><div class="extension-actions"><button id="classroom-train">返回第2步继续训练</button><button id="classroom-test">返回第3步调出笔迹复测</button></div><p class="hint">下载保留当前模型和旧结果；点击训练后才更新参数，再用旧笔迹和新笔迹比较。</p>`;
    const el=id=>document.getElementById(id);let latest=null,busy=false;
    function draw() {
      const active=S.sharedDatasets[S.activeDatasetVersion];
      el('classroom-current').textContent=S.datasetMode==='class'&&active?`训练数据：原100张＋班级第${active.version}版${active.count}张，模型累计训练${S.net.steps}次。`:`当前使用：个人训练集，模型累计训练${S.net.steps}次。`;
      el('classroom-download').disabled=busy||!latest;
      el('classroom-check').disabled=busy;el('classroom-personal').disabled=busy||S.datasetMode==='personal';
    }
    el('classroom-check').onclick=async()=>{
      if(busy)return;busy=true;draw();
      try {
        latest=(await HandwritingAPI.request('/api/handwriting/latest')).dataset;
        el('classroom-latest').textContent=latest?`教师已发布第${latest.version}版 · ${latest.count}张。`:'等待教师发布，前面的实验可以继续。';
        el('classroom-counts').replaceChildren(...(latest?.counts||[]).map((count,digit)=>{const span=document.createElement('span');span.textContent=`${digit}：${count}张`;return span;}));
      }catch(error){el('classroom-latest').textContent=error.message;}
      finally{busy=false;draw();}
    };
    el('classroom-download').onclick=async()=>{
      if(busy||!latest||S.busy)return;busy=true;draw();
      try {
        const data=await HandwritingAPI.request(`/api/handwriting/datasets/${latest.version}`);
        if(S.busy)throw Error('当前正在训练，请结束后再次下载。');
        if(data.schema!==1||data.width!==12||data.height!==18||!data.samples?.length)throw Error('数据集格式不匹配。');
        // 每版保留原样，旧训练记录始终能找到当时使用的标签和笔迹。
        const unchanged=S.datasetMode==='class'&&S.activeDatasetVersion===data.version;
        S.sharedDatasets[data.version]=data;S.activeDatasetVersion=data.version;S.datasetMode='class';
        if(!unchanged)S.trainingCursor=D.training.length;
        buildGalleries();changed();
        el('classroom-latest').textContent=window.labSave()?`第${data.version}版已保存在本机，可以继续训练。`:`第${data.version}版已载入，但本机保存失败。请保留当前页面。`;
      }catch(error){el('classroom-latest').textContent=error.message;}
      finally{busy=false;draw();}
    };
    el('classroom-personal').onclick=()=>{if(S.busy)return;S.datasetMode='personal';S.trainingCursor=S.ownSamples.length?D.training.length:null;buildGalleries();draw();changed();};
    el('classroom-train').onclick=()=>navigate(1);el('classroom-test').onclick=()=>navigate(2);
    draw();
    return {show(visible){panel.hidden=!visible;if(visible){document.body.dataset.view='classroom';draw();}else if(document.body.dataset.view==='classroom')document.body.dataset.view='lab';}};
  };
})();

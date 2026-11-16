/* 柱图只展示服务器汇总；排除操作携带来源指纹，不修改学生札记。 */
import {renderAnimalChart} from './animal-chart.js';
(() => {
  document.querySelectorAll('.animal-analysis').forEach(root => {
  let data=JSON.parse(root.querySelector('[data-animal-data]').textContent),selected=null,busy=false;
  const groups=root.querySelector('[data-animal-groups]'),dialog=root.querySelector('dialog');
  const filter=root.querySelector('[data-animal-filter]'),reason=root.querySelector('[data-animal-reason]');
  function node(tag,text,className){const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(className)item.className=className;return item;}
  const feedback=message=>{root.querySelector('[data-animal-feedback]').textContent=message;root.querySelector('[data-animal-source-feedback]').textContent=message;};
  function drawChart(){
    root.querySelector('[data-animal-total]').textContent=`${data.submitted}/${data.student_count}名学生已正式提交`;
    renderAnimalChart(groups,data,{imageBase:root.dataset.imageBase,onSelect:row=>{selected=row.id;filter.value='all';drawSources();dialog.showModal();}});
  }
  function visible(source){return filter.value==='all'||(filter.value==='excluded'?source.excluded:!source.excluded&&source.status===filter.value);}
  function drawSources(){
    const row=data.rows.find(row=>row.id===selected);if(!row)return;
    root.querySelector('[data-animal-source-title]').textContent=`${row.label} · 数据源`;
    root.querySelector('[data-animal-source-summary]').textContent=`有效${row.count}人 · 已排除${row.excluded_count}人 · 格式异常${row.invalid_count}人 · 未填${row.missing_count}人`;
    const body=root.querySelector('[data-animal-sources]');body.replaceChildren();
    const sources=row.sources.filter(visible);
    for(const source of sources){
      const tr=node('tr');tr.className=source.excluded?'is-excluded':source.status==='valid'?'is-valid':'is-muted';
      const person=node('td');person.append(node('strong',source.student_name),node('small',`${source.class_name} · 题目v${source.version}`));
      const raw=node('td',source.raw_values.map((value,c)=>`${source.raw_names[c]||`类别${c+1}`}：${value===''?'—':value+'%'}`).join('\n'),'animal-raw-value');
      const status=node('td');status.append(node('span',source.excluded?'已排除':({valid:'已纳入',invalid:'格式异常',missing:'未填写'})[source.status]));
      if(source.exclusion_reason||source.validation_reason)status.append(node('small',source.excluded?(source.exclusion_reason||'教师手动排除'):source.validation_reason));
      const actions=node('td'),link=node('a','查看原札记');const url=new URL(root.dataset.studentUrl,location.href);
      url.searchParams.set('tab','members');url.searchParams.set('student_id',source.student_id);url.searchParams.set('activity_id',root.dataset.activityId);if(root.dataset.classId)url.searchParams.set('class_id',root.dataset.classId);
      link.href=url.href;link.target='_blank';link.rel='noopener';actions.append(link);
      if(source.status!=='missing'){
        const button=node('button',source.excluded?'恢复统计':'排除此行','secondary compact');button.type='button';button.disabled=busy;
        button.addEventListener('click',()=>changeExclusion(source));actions.append(button);
      }
      tr.append(person,raw,status,actions);body.append(tr);
    }
    if(!sources.length){const row=node('tr'),cell=node('td','当前筛选下没有来源记录。');cell.colSpan=4;row.append(cell);body.append(row);}
  }
  async function request(method,payload){
    const url=new URL(root.dataset.api,location.href);if(root.dataset.classId)url.searchParams.set('class_id',root.dataset.classId);
    url.searchParams.set('activity_id',root.dataset.activityId);
    const options={method,headers:{Accept:'application/json'}};
    if(payload){options.headers['Content-Type']='application/json';options.headers['X-CSRF-Token']=document.querySelector('meta[name=csrf-token]')?.content||document.querySelector('input[name=csrf]')?.value||'';options.body=JSON.stringify({...payload,activity_id:root.dataset.activityId,class_id:root.dataset.classId||null});}
    const response=await fetch(url,options);if(response.redirected)throw new Error('教师登录已失效，请刷新后登录。');
    const result=await response.json();if(!response.ok)throw new Error(result.error||'操作未完成，请重试。');return result;
  }
  async function changeExclusion(source){
    if(busy)return;busy=true;drawSources();feedback('正在更新统计…');
    try{data=await request('POST',{record_id:source.record_id,source_id:selected,fingerprint:source.fingerprint,excluded:!source.excluded,reason:reason.value});reason.value='';drawChart();feedback(source.excluded?'该行已恢复统计，原札记未改变。':'该行已从统计中排除，原札记保留。');}
    catch(error){feedback(error.message);}finally{busy=false;drawSources();}
  }
  filter.addEventListener('change',drawSources);
  root.querySelector('[data-animal-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{groups.querySelector(`[data-source-id="${selected}"]`)?.focus({preventScroll:true});});
  root.querySelector('[data-animal-refresh]').addEventListener('click',async event=>{
    if(busy)return;busy=true;event.target.disabled=true;feedback('正在读取提交数据…');
    try{data=await request('GET');drawChart();if(dialog.open)drawSources();feedback('已刷新当前班级范围的数据。');}catch(error){feedback(error.message);}finally{busy=false;event.target.disabled=false;}
  });
  drawChart();
  });
})();

/* 师生共用柱图；点击行为由各自页面提供，组件不读取姓名或执行排除操作。 */
export function renderAnimalChart(groups,data,{imageBase,onSelect,actionLabel='点击查看来源'}) {
  function node(tag,text,className){const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(className)item.className=className;return item;}
  groups.style.setProperty('--chart-groups',String(data.rows.length||1));
  groups.replaceChildren(...data.rows.map(row=>{
    const button=node('button',undefined,'animal-chart-group');button.type='button';button.dataset.sourceId=row.id;
    const action=typeof actionLabel==='function'?actionLabel(row):actionLabel;
    const summary=row.means?`${data.names.map((name,i)=>`${name}${row.means[i].toFixed(1)}%`).join('，')}，有效${row.count}人`:'暂无有效数据';
    button.setAttribute('aria-label',`${row.label}：${summary}；${action}`);
    const pair=node('span',undefined,'animal-chart-pair');
    data.names.forEach((_,c)=>{const column=node('span',undefined,`animal-chart-column animal-class-${c}`);column.style.height=`${row.means?row.means[c]:0}%`;column.append(node('span',row.means?row.means[c].toFixed(1):'—','animal-chart-value'));pair.append(column);});
    const label=node('span',undefined,'animal-chart-label');
    if(row.image_file){const image=node('img');image.src=imageBase+row.image_file;image.alt='';image.loading='lazy';label.append(image);}
    label.append(node('span',row.label));button.append(pair,label,node('small',`有效 ${row.count}人`));
    if(row.excluded_count||row.invalid_count)button.append(node('small',`排除${row.excluded_count} · 异常${row.invalid_count}`,'animal-chart-outliers'));
    button.addEventListener('click',()=>onSelect(row,button));return button;
  }));
}

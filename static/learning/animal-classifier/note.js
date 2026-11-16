/* 图片与摄像头结果均由学生手填，继续序列化为原有文字答案。 */
export function createAnimalPredictionTable(question, answer) {
  const root=document.createElement('div');root.className='note-record-grid note-animal-record';
  const table=document.createElement('table'),head=table.createTHead().insertRow(),controls=new Map();
  const hasCamera=question.record_table.fields.some(field=>field.key==='camera-class-1');
  const fixedColumns=question.record_table.columns;
  const classCount=fixedColumns?.length||2;
  table.setAttribute('aria-label',fixedColumns?'4张异兽图片的四类预测比例':hasCamera?'9张测试图片及摄像头的两类预测比例':'9张测试图片的两类预测比例');
  root.classList.toggle('note-beast-record',Boolean(fixedColumns));
  const imageHeading=document.createElement('th');imageHeading.scope='col';imageHeading.textContent='来源';head.append(imageHeading);
  for(let c=1;c<=classCount;c++){
    const cell=document.createElement('th'),input=document.createElement('input');
    cell.scope='col';cell.dataset.animalClass=c;
    const title=document.createElement('span');title.className='note-animal-column-title';title.textContent=fixedColumns?fixedColumns[c-1]:c===1?'壹 · 类别':'贰 · 类别';
    input.type='text';input.maxLength=12;input.placeholder=`类别${c}名称`;input.setAttribute('aria-label',`结果表类别${c}名称`);input.name=`${question.id}__class-${c}`;
    const unit=document.createElement('small');unit.className='note-animal-unit';unit.textContent='预测比例 · %';
    cell.append(title);
    if(!fixedColumns){controls.set(`类别${c}名称`,input);cell.append(input);}
    cell.append(unit);head.append(cell);
  }
  const body=table.createTBody();
  const rows=question.record_table.rows||Array.from({length:9},(_,i)=>({key:`image-${i+1}`,label:`图${i+1}`,number:i+1}));
  if(hasCamera)rows.push({key:'camera',label:'摄像头'});
  for(const source of rows){
    const row=body.insertRow(),label=document.createElement('th');label.scope='row';
    if(source.number){
      const prefix=document.createElement('span');prefix.className='note-animal-image-prefix';prefix.textContent='图';
      const number=document.createElement('span');number.className='note-animal-image-number';number.textContent=String(source.number).padStart(2,'0');label.append(prefix,number);
      if(fixedColumns){const name=document.createElement('span');name.className='note-beast-name';name.textContent=source.label;label.append(name);}
    }else{
      label.className='note-animal-camera-label';label.append(document.createTextNode('摄像头'));
      const optional=document.createElement('small');optional.textContent='选填';label.append(optional);
    }
    row.append(label);
    for(let c=1;c<=classCount;c++){
      const field=question.record_table.fields.find(field=>field.key===`${source.key}-class-${c}`);
      const cell=row.insertCell(),input=document.createElement('input');input.type='number';input.min=0;input.max=100;input.step='0.1';input.inputMode='decimal';input.required=Boolean(question.required&&field.required!==false);
      cell.dataset.animalClass=c;input.placeholder='—';
      input.name=`${question.id}__${source.key}-class-${c}`;input.setAttribute('aria-label',field.label+'预测比例');controls.set(field.label,input);cell.append(input);
    }
  }
  root.append(table);let writing=false;
  function restore(){
    const values=new Map(answer.value.split('\n').map(line=>{const at=line.indexOf('：');return [line.slice(0,at),line.slice(at+1)];}));
    controls.forEach((input,label)=>{input.value=values.get(label)||'';});
  }
  root.addEventListener('input',event=>{
    event.stopPropagation();answer.value=question.record_table.fields.map(field=>`${field.label}：${controls.get(field.label).value}`).join('\n');
    writing=true;try{answer.dispatchEvent(new Event('input',{bubbles:true}));}finally{writing=false;}
  });
  answer.addEventListener('input',()=>{if(!writing)restore();});restore();return root;
}

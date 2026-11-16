/* 学习单只读取实验题面，编码由学生输入；验证不触发暂存或提交。 */
export function setupPixelCodeNote(field, input, question, controller) {
  const reference = document.createElement('div');
  reference.className = 'note-pixel-reference';
  const convention = document.createElement('p');
  const picture = document.createElement('div');
  picture.className = 'note-pixel-picture';
  picture.setAttribute('role','img'); picture.setAttribute('aria-label','本题5×5原图');
  const cells = Array.from({length:25}, () => {const cell=document.createElement('span');picture.append(cell);return cell;});
  reference.append(convention,picture);
  field.querySelector('legend').after(reference);
  const check = document.createElement('button');
  check.type = 'button'; check.className = 'note-pixel-check'; check.textContent = '验证编码';
  const feedback = document.createElement('p');
  feedback.className = 'note-pixel-feedback'; feedback.setAttribute('role','status');
  field.append(check,feedback);
  let context;
  let signature = null;

  function update() {
    // 已提交后只读服务器保留的题面，重新绘图不会改写已提交札记。
    context = question.editable ? controller?.worksheetContext?.(1) || question.pixel_context : question.pixel_context;
    const nextSignature = JSON.stringify(context);
    if (nextSignature === signature) return;
    signature = nextSignature; feedback.textContent = '';
    convention.textContent = context ? `白色＝${context.white}，黑色＝${1-context.white}` : '请先在活动中绘制图像并选择黑白约定。';
    cells.forEach((cell,index) => {cell.style.backgroundColor=context?.pixels[index] ? '#151515' : '#fff';});
  }
  const clearFeedback = () => {feedback.textContent='';};
  input.addEventListener('input',clearFeedback);
  check.addEventListener('click',() => {
    update();
    const sequence = input.value.replace(/\s/g,'');
    if (!context) {feedback.textContent='请先完成活动中的图像绘制。';return;}
    if (!/^[01]{25}$/.test(sequence)) {feedback.textContent='请填入25位0或1，可以使用空格或换行分组。';return;}
    const wrong = context.pixels.filter((pixel,index)=>Number(sequence[index]) !== (pixel ? 1-context.white : context.white)).length;
    feedback.textContent = wrong ? `还有${wrong}位与原图不一致，请核对顺序和黑白约定。` : '编码正确，可以提交本段。';
  });
  update();
  const unsubscribe = question.editable ? controller?.onContextChange?.(update) : null;
  return {destroy() {unsubscribe?.();input.removeEventListener('input',clearFeedback);}};
}

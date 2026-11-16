/* 只解析数字、括号和四则运算，不用 eval 执行学生输入。 */
export function calculateExpression(expression) {
  const source = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s/g, '');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/]/g) || [];
  if (!tokens.length || tokens.join('') !== source || source.length > 180) throw new Error('请检查算式。');
  let cursor = 0;
  function number() {
    const token = tokens[cursor++];
    if (token === '+') return number();
    if (token === '-') return -number();
    if (token === '(') {
      const value = sum();
      if (tokens[cursor++] !== ')') throw new Error('括号需要成对。');
      return value;
    }
    if (token === undefined || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw new Error('算式还没写完整。');
    return Number(token);
  }
  function product() {
    let value = number();
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operator = tokens[cursor++], right = number();
      if (operator === '/' && right === 0) throw new Error('不能除以 0。');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++], right = product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }
  const result = sum();
  if (cursor !== tokens.length || !Number.isFinite(result)) throw new Error('请检查算式。');
  return result;
}

export function setupMathCalculator(root) {
  const popover = root.querySelector('#math-calculator');
  const display = popover.querySelector('[data-calc-display]');
  const result = popover.querySelector('[data-calc-result]');
  const hint = popover.querySelector('[data-calc-hint]');
  const help = hint.textContent;
  let expression = '', evaluated = false, isOpen = false;
  function enter(key) {
    if (key === 'C') { expression = ''; result.textContent = '0'; evaluated = false; }
    else if (key === '⌫') { expression = expression.slice(0, -1); evaluated = false; result.textContent = '—'; }
    else if (key === '=') {
      try {
        const value = calculateExpression(expression);
        result.textContent = String(Number(value.toPrecision(12)));
        evaluated = true;
        hint.textContent = help;
      } catch (error) {
        result.textContent = '再检查一下';
        hint.textContent = error.message;
      }
      display.value = expression || '0';
      return;
    } else {
      if (evaluated) expression = /[+−×÷]/.test(key) ? result.textContent : '';
      evaluated = false;
      if (expression.length >= 180) return;
      expression += key;
      result.textContent = '—';
    }
    hint.textContent = help;
    display.value = expression || '0';
    display.scrollLeft = display.scrollWidth;
  }
  popover.addEventListener('click', event => {
    const key = event.target.closest('[data-calc-key]')?.dataset.calcKey;
    if (key) enter(key);
  });
  popover.addEventListener('keydown', event => {
    // Enter/空格在按钮上保留原生点击，避免一次按键被计算两次。
    if (event.key === 'Enter' && event.target.closest('button')) return;
    let key = event.key;
    if (key === 'Enter' || key === '=') key = '=';
    else if (key === 'Backspace') key = '⌫';
    else if (key === 'Delete') key = 'C';
    else if (key === '*') key = '×';
    else if (key === '/') key = '÷';
    else if (key === '-') key = '−';
    else if (!/^[0-9.()+]$/.test(key)) return;
    event.preventDefault();
    enter(key);
  });
  popover.addEventListener('toggle', event => { isOpen = event.newState === 'open'; });
  return { close() { if (isOpen) popover.hidePopover(); } };
}

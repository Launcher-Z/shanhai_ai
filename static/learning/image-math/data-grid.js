/* 数据表与画布共用原始 RGB 数组；切换视图不生成或修改像素值。 */
export function createPixelDataGrid(viewport, image, onSelect) {
  const table = document.createElement('table');
  table.className = 'math-data-table';
  table.setAttribute('aria-label', `${image.height} 行 ${image.width} 列的原图 RGB 数据`);
  const head = table.createTHead().insertRow();
  const corner = document.createElement('th');
  corner.textContent = '行 / 列';
  head.append(corner);
  for (let x = 0; x < image.width; x++) {
    const header = document.createElement('th');
    header.scope = 'col';
    header.textContent = x + 1;
    head.append(header);
  }
  const body = table.createTBody();
  const buttons = [];
  const rowHeaders = [];
  let selectedIndex = -1;
  for (let y = 0; y < image.height; y++) {
    const row = body.insertRow();
    const header = document.createElement('th');
    header.scope = 'row';
    header.textContent = y + 1;
    row.append(header);
    rowHeaders.push(header);
    for (let x = 0; x < image.width; x++) {
      const index = y * image.width + x;
      const pixel = image.values[index];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'math-data-cell';
      button.dataset.pixelIndex = index;
      button.tabIndex = -1;
      button.setAttribute('aria-label', `第 ${y + 1} 行，第 ${x + 1} 列，R ${pixel[0]}，G ${pixel[1]}，B ${pixel[2]}`);
      button.style.setProperty('--pixel-color', `rgb(${pixel.join(',')})`);
      button.style.setProperty('--pixel-wash', `rgba(${pixel.join(',')},.16)`);
      button.style.setProperty('--reveal-delay', `${x * 16 + y * 22}ms`);
      pixel.forEach((value, channel) => {
        const number = document.createElement('span');
        number.className = `math-data-value math-channel-${['red', 'green', 'blue'][channel]}`;
        number.textContent = value;
        number.setAttribute('aria-hidden', 'true');
        button.append(number);
      });
      row.insertCell().append(button);
      buttons.push(button);
    }
  }
  viewport.replaceChildren(table);

  function select(pixel) {
    if (selectedIndex >= 0) {
      buttons[selectedIndex].removeAttribute('aria-current');
      buttons[selectedIndex].tabIndex = -1;
      head.cells[selectedIndex % image.width + 1].classList.remove('is-current');
      rowHeaders[Math.floor(selectedIndex / image.width)].classList.remove('is-current');
    }
    selectedIndex = pixel.y * image.width + pixel.x;
    buttons[selectedIndex].setAttribute('aria-current', 'true');
    buttons[selectedIndex].tabIndex = 0;
    head.cells[pixel.x + 1].classList.add('is-current');
    rowHeaders[pixel.y].classList.add('is-current');
  }

  function revealSelected() {
    if (selectedIndex < 0) return;
    // 只滚动数据窗口，不牵动外层书页或弹窗。
    const button = buttons[selectedIndex];
    const cell = button.parentElement;
    const row = cell.parentElement;
    viewport.scrollLeft = Math.max(0, cell.offsetLeft - (viewport.clientWidth - cell.offsetWidth) / 2);
    viewport.scrollTop = Math.max(0, row.offsetTop - (viewport.clientHeight - row.offsetHeight) / 2);
  }

  viewport.addEventListener('click', event => {
    const button = event.target.closest('[data-pixel-index]');
    if (!button) return;
    const index = Number(button.dataset.pixelIndex);
    onSelect(index % image.width, Math.floor(index / image.width));
  });
  viewport.addEventListener('keydown', event => {
    if (!event.target.closest('[data-pixel-index]') || selectedIndex < 0) return;
    let x = selectedIndex % image.width, y = Math.floor(selectedIndex / image.width);
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key in moves) {
      const [dx, dy] = moves[event.key];
      x = Math.max(0, Math.min(image.width - 1, x + dx));
      y = Math.max(0, Math.min(image.height - 1, y + dy));
    } else if (event.key === 'Home') x = 0;
    else if (event.key === 'End') x = image.width - 1;
    else return;
    event.preventDefault();
    onSelect(x, y);
    buttons[y * image.width + x].focus({ preventScroll: true });
    revealSelected();
  });
  return { select, revealSelected };
}

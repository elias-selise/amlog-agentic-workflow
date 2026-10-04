// @ts-check
// AMLOG Crawl Map webview. Receives activity events from the extension and
// renders files as nodes with a line-drawn spider per agent crawling between the
// files it touches, leaving a fading silk trail. Pure canvas, no dependencies.
(function () {
  const vscode = acquireVsCodeApi();
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
  const ctx = canvas.getContext('2d');
  const legendEl = document.getElementById('legend');
  const statsEl = document.getElementById('stats');
  const tickerEl = document.getElementById('ticker');
  const toggleBtn = document.getElementById('toggle');

  /** @type {Map<string, {x:number,y:number,label:string,reads:number,writes:number,pulse:number}>} */
  const nodes = new Map();
  /** @type {Map<string, {color:string,x:number,y:number,tx:number,ty:number,target:string|null,legPhase:number,label:string}>} */
  const spiders = new Map();
  /** @type {{from:{x:number,y:number},to:{x:number,y:number},color:string,age:number}[]} */
  const threads = [];
  /** @type {string[]} */
  const ticks = [];
  let paused = false;
  let placeIndex = 0;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  window.addEventListener('resize', resize);

  // Deterministic, spread-out placement for each new file node (phyllotaxis
  // spiral keeps nodes from clumping as the count grows).
  function placeNode() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cx = w / 2;
    const cy = h / 2;
    const i = placeIndex++;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const radius = Math.min(w, h) * 0.46 * Math.sqrt(i / 120 + 0.02);
    const angle = i * golden;
    return {
      x: Math.max(24, Math.min(w - 24, cx + radius * Math.cos(angle))),
      y: Math.max(24, Math.min(h - 24, cy + radius * Math.sin(angle))),
    };
  }

  function ensureNode(file) {
    let node = nodes.get(file);
    if (!node) {
      const pos = placeNode();
      node = { x: pos.x, y: pos.y, label: file.split('/').pop() || file, reads: 0, writes: 0, pulse: 0 };
      nodes.set(file, node);
    }
    return node;
  }

  function handleEvent(ev) {
    const node = ensureNode(ev.file);
    if (ev.op === 'read') { node.reads++; } else { node.writes++; }
    node.pulse = 1;

    let spider = spiders.get(ev.agent);
    if (!spider) {
      spider = { color: ev.color, x: node.x, y: node.y, tx: node.x, ty: node.y, target: ev.file, legPhase: 0, label: ev.agent };
      spiders.set(ev.agent, spider);
      renderLegend();
    }
    // Draw a silk thread from where the spider is heading now to the new target.
    threads.push({ from: { x: spider.tx, y: spider.ty }, to: { x: node.x, y: node.y }, color: spider.color, age: 0 });
    while (threads.length > 160) { threads.shift(); }
    spider.tx = node.x;
    spider.ty = node.y;
    spider.target = ev.file;
    spider.color = ev.color;

    const when = (ev.ts || '').slice(11, 19);
    ticks.unshift(`${when}  ${ev.agent}  ${ev.op === 'write' ? '✎' : '👁'}  ${ev.file}`);
    while (ticks.length > 6) { ticks.pop(); }
    renderTicker();
    renderStats();
  }

  function renderLegend() {
    legendEl.innerHTML = '';
    for (const [agent, spider] of spiders) {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const dot = document.createElement('span');
      dot.className = 'legend-dot';
      dot.style.background = spider.color;
      const label = document.createElement('span');
      label.textContent = agent;
      item.appendChild(dot);
      item.appendChild(label);
      legendEl.appendChild(item);
    }
  }

  function renderTicker() {
    tickerEl.innerHTML = '';
    for (const line of ticks) {
      const div = document.createElement('div');
      div.className = 'tick-line';
      div.textContent = line;
      tickerEl.appendChild(div);
    }
  }

  function renderStats() {
    statsEl.textContent = `${spiders.size} agent(s) · ${nodes.size} file(s)`;
  }

  function drawSpider(s) {
    const r = 6;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 1.5;
    const wiggle = Math.sin(s.legPhase) * 2;
    // eight legs, four each side
    for (let i = 0; i < 4; i++) {
      const dy = (i - 1.5) * 4;
      const len = 9 + (i % 2) * 3;
      ctx.beginPath();
      ctx.moveTo(s.x - r + 2, s.y + dy);
      ctx.lineTo(s.x - r - len, s.y + dy + wiggle * (i % 2 ? 1 : -1));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x + r - 2, s.y + dy);
      ctx.lineTo(s.x + r + len, s.y + dy - wiggle * (i % 2 ? 1 : -1));
      ctx.stroke();
    }
    // body + head
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * 0.8, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y - r, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function frame() {
    if (!paused) {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      // fading silk threads
      for (const t of threads) {
        t.age += 0.01;
        const a = Math.max(0, 0.5 - t.age * 0.5);
        if (a <= 0) { continue; }
        ctx.strokeStyle = t.color;
        ctx.globalAlpha = a;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(t.from.x, t.from.y);
        ctx.lineTo(t.to.x, t.to.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // file nodes
      for (const node of nodes.values()) {
        const written = node.writes > 0;
        ctx.fillStyle = written ? 'rgba(220,120,80,0.9)' : 'rgba(120,160,220,0.9)';
        const size = 3 + Math.min(6, (node.reads + node.writes) * 0.4);
        if (node.pulse > 0) {
          ctx.globalAlpha = node.pulse * 0.5;
          ctx.beginPath();
          ctx.arc(node.x, node.y, size + node.pulse * 12, 0, Math.PI * 2);
          ctx.fillStyle = written ? 'rgba(220,120,80,0.6)' : 'rgba(120,160,220,0.6)';
          ctx.fill();
          node.pulse = Math.max(0, node.pulse - 0.03);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = written ? 'rgba(220,120,80,0.95)' : 'rgba(120,160,220,0.95)';
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(200,200,200,0.75)';
        ctx.font = '10px var(--vscode-editor-font-family, monospace)';
        ctx.fillText(node.label, node.x + size + 3, node.y + 3);
      }

      // spiders crawl toward their current target
      for (const s of spiders.values()) {
        const dx = s.tx - s.x;
        const dy = s.ty - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.5) {
          const step = Math.min(dist, Math.max(2, dist * 0.08));
          s.x += (dx / dist) * step;
          s.y += (dy / dist) * step;
          s.legPhase += 0.6;
        } else {
          s.legPhase += 0.08; // idle breathing
        }
        drawSpider(s);
      }
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg) { return; }
    if (msg.type === 'event') {
      handleEvent(msg.event);
    } else if (msg.type === 'reset') {
      nodes.clear();
      spiders.clear();
      threads.length = 0;
      ticks.length = 0;
      placeIndex = 0;
      renderLegend();
      renderTicker();
      renderStats();
    }
  });

  toggleBtn.addEventListener('click', () => {
    paused = !paused;
    toggleBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
  });

  resize();
  renderStats();
  requestAnimationFrame(frame);
  vscode.postMessage({ type: 'ready' });
})();

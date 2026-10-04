// @ts-check
// AMLOG Code Crawl webview — multi-pane.
//
// Each file an agent is working on gets its own pane with its own line-drawn
// spider that walks the code LINE BY LINE, pausing on each line to "inspect" it
// (a scan beam for reads, a woven stitch for writes). When several files are
// active at once the view splits into a grid so you see every spider working in
// parallel. Zoom with the toolbar buttons or Ctrl+wheel.
(function () {
  const vscode = acquireVsCodeApi();
  const panesEl = /** @type {HTMLElement} */ (document.getElementById('panes'));
  const statusEl = /** @type {HTMLElement} */ (document.getElementById('status'));
  const zoomLabel = /** @type {HTMLElement} */ (document.getElementById('zoom-level'));

  const GUTTER = 52;
  const SPEED = 0.42;     // px/ms — brisk, visible crawl
  const MAX_WAYPOINTS = 400;

  /** @type {Map<string, Pane>} */
  const panes = new Map();
  let lastTs = 0;
  let zoom = 13;

  // Off-screen context used to measure how wide a line's text is, so the spider
  // can walk across the actual characters rather than a fixed width.
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');

  // ---- zoom ----------------------------------------------------------------
  function applyZoom() {
    document.documentElement.style.setProperty('--cc-font', `${zoom}px`);
    zoomLabel.textContent = `${Math.round((zoom / 13) * 100)}%`;
  }
  function setZoom(px) {
    zoom = Math.max(8, Math.min(28, px));
    applyZoom();
  }
  document.getElementById('zoom-in').addEventListener('click', () => setZoom(zoom + 1));
  document.getElementById('zoom-out').addEventListener('click', () => setZoom(zoom - 1));
  document.getElementById('zoom-reset').addEventListener('click', () => setZoom(13));
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(zoom + (e.deltaY < 0 ? 1 : -1));
    }
  }, { passive: false });
  applyZoom();

  // ---- pane ----------------------------------------------------------------
  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  }

  class Pane {
    constructor(file) {
      this.file = file;
      this.op = 'read';
      this.color = '#9e9e9e';
      this.detail = '';
      this.agent = '';
      this.lineEls = [];
      this.queue = [];        // line indexes still to walk
      this.web = [];
      this.curLine = -1;
      this.mode = 'idle';     // 'idle' | 'approach' | 'crawl'
      this.bodyX = GUTTER;    // screen x of the spider (walks across the code)
      this.bodyDocY = -100;   // document y of the spider
      this.lineStartX = GUTTER;
      this.lineEndX = GUTTER;
      this.lineY = -100;
      this.dwell = 0;
      this.heading = 0;       // facing direction (radians) for the head
      this.prevX = GUTTER;
      this.prevDocY = -100;
      this.feet = [];
      for (let i = 0; i < 8; i++) {
        this.feet.push({ x: 0, y: 0, side: i < 4 ? -1 : 1, rank: i % 4, step: Math.random() * 6.28 });
      }

      this.root = document.createElement('div');
      this.root.className = 'pane';
      this.root.innerHTML =
        '<div class="pane-header"><span class="dot"></span><span class="agent"></span>'
        + '<span class="op"></span><span class="file"></span></div>'
        + '<div class="pane-viewport"><pre class="code"></pre></div>'
        + '<canvas class="overlay"></canvas>';
      panesEl.appendChild(this.root);
      this.dotEl = this.root.querySelector('.dot');
      this.agentEl = this.root.querySelector('.agent');
      this.opEl = this.root.querySelector('.op');
      this.fileEl = this.root.querySelector('.file');
      this.viewport = this.root.querySelector('.pane-viewport');
      this.codeEl = this.root.querySelector('.code');
      this.canvas = this.root.querySelector('.overlay');
      this.ctx = this.canvas.getContext('2d');
    }

    layout() {
      const ratio = window.devicePixelRatio || 1;
      const w = this.viewport.clientWidth;
      const h = this.viewport.clientHeight;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.canvas.width = Math.max(1, w * ratio);
      this.canvas.height = Math.max(1, h * ratio);
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    render(lines) {
      this.codeEl.innerHTML = lines
        .map((l) => `<span class="line">${escapeHtml(l) || ' '}</span>`)
        .join('');
      this.lineEls = Array.from(this.codeEl.querySelectorAll('.line'));
      this.bodyDocY = this.prevDocY = this.lineCenterDocY(0);
      this.bodyX = this.prevX = GUTTER;
      this.queue = [];
      this.web = [];
      this.curLine = -1;
      this.mode = 'idle';
      this.layout();
    }

    codeFont() {
      let fam = 'monospace';
      try { fam = getComputedStyle(this.codeEl).fontFamily || 'monospace'; } catch (e) { /* no DOM */ }
      return `${zoom}px ${fam}`;
    }

    // Pixel width of the code on line i (tabs expanded), clamped so the spider
    // stays within the pane even on very long lines.
    textWidth(i) {
      const el = this.lineEls[i];
      if (!el) { return 12; }
      const txt = (el.textContent || '').replace(/\t/g, '    ');
      measureCtx.font = this.codeFont();
      const w = measureCtx.measureText(txt).width;
      const maxW = Math.max(60, this.canvas.clientWidth - GUTTER - 16);
      return Math.max(10, Math.min(w, maxW));
    }

    setHeader() {
      this.agentEl.textContent = this.agent;
      const verb = this.op === 'write' ? '✎' : '👁';
      this.opEl.textContent = this.detail ? `${verb} ${this.detail}` : (this.op === 'write' ? '✎ writing' : '👁 reading');
      this.opEl.style.color = this.color;
      this.fileEl.textContent = this.file;
      this.dotEl.style.background = this.color;
    }

    lineCenterDocY(i) {
      const el = this.lineEls[i];
      return el ? el.offsetTop + el.offsetHeight / 2 : 0;
    }
    lineBox(i) {
      const el = this.lineEls[i];
      return el ? { top: el.offsetTop, h: el.offsetHeight } : null;
    }

    // Walk line by line. A range walks exactly those lines; a whole-file read
    // walks the whole file top-to-bottom. Big files are strided so it stays
    // snappy while still sweeping the entire file.
    plan(startLine, endLine) {
      const n = this.lineEls.length;
      if (n === 0) {
        return;
      }
      const clamp = (i) => Math.max(0, Math.min(n - 1, i));
      const hasRange = Number.isFinite(startLine);
      const from = hasRange ? clamp(startLine - 1) : 0;
      const to = hasRange ? clamp((Number.isFinite(endLine) ? endLine : startLine) - 1) : n - 1;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const span = hi - lo + 1;
      const stride = Math.max(1, Math.ceil(span / MAX_WAYPOINTS));
      const plan = [];
      for (let i = lo; i <= hi; i += stride) {
        plan.push(i);
      }
      if (plan[plan.length - 1] !== hi) {
        plan.push(hi);
      }
      this.queue = this.queue.concat(plan);
    }

    // Start walking a line: highlight it and work out how far right the spider
    // must crawl (the width of the actual code on that line).
    beginLine(i) {
      const el = this.lineEls[i];
      if (el) {
        el.classList.remove('visited');
        el.classList.add(this.op);
        setTimeout(() => { el.classList.remove('read', 'write'); el.classList.add('visited'); }, 1000);
      }
      this.lineStartX = GUTTER;
      this.lineEndX = GUTTER + this.textWidth(i);
    }

    // Lay a silk anchor at the end of a line the spider just finished.
    dropAnchor() {
      const box = this.lineBox(this.curLine);
      if (!box) { return; }
      this.web.push({ x: this.lineEndX, y: box.top + box.h / 2, op: this.op, age: 0 });
      while (this.web.length > 70) { this.web.shift(); }
    }

    ensureVisible(docY) {
      const top = this.viewport.scrollTop;
      const h = this.viewport.clientHeight;
      if (docY < top + 40) {
        this.viewport.scrollTo({ top: Math.max(0, docY - 50) });
      } else if (docY > top + h - 70) {
        this.viewport.scrollTo({ top: docY - h + 100 });
      }
    }

    step(dt) {
      if (this.dwell > 0) {
        this.dwell -= dt;
        return;
      }
      if (this.mode === 'idle') {
        if (this.queue.length === 0) { return; }
        this.curLine = this.queue.shift();
        this.beginLine(this.curLine);
        this.mode = 'approach';
      }

      const box = this.lineBox(this.curLine);
      if (!box) { this.mode = 'idle'; return; }
      this.lineY = box.top + box.h / 2;

      if (this.mode === 'approach') {
        // travel to the start of the line (its left edge, on the first character)
        const dx = this.lineStartX - this.bodyX;
        const dy = this.lineY - this.bodyDocY;
        const dist = Math.hypot(dx, dy);
        const sp = 0.7 * dt;
        if (dist <= sp || dist < 1.5) {
          this.bodyX = this.lineStartX;
          this.bodyDocY = this.lineY;
          this.mode = 'crawl';
          this.ensureVisible(this.lineY);
        } else {
          this.bodyX += (dx / dist) * sp;
          this.bodyDocY += (dy / dist) * sp;
        }
      } else if (this.mode === 'crawl') {
        // walk rightward ALONG the code of this line
        this.bodyDocY = this.lineY;
        const sp = (this.op === 'write' ? 0.3 : 0.55) * dt; // writing is slower (typing)
        if (this.bodyX + sp >= this.lineEndX) {
          this.bodyX = this.lineEndX;
          this.dropAnchor();
          this.mode = 'idle';
          this.dwell = this.op === 'write' ? 90 : 45; // brief beat at end of line
        } else {
          this.bodyX += sp;
        }
      }
    }

    draw(dt) {
      const ctx = this.ctx;
      const scroll = this.viewport.scrollTop;
      const w = this.canvas.clientWidth;
      ctx.clearRect(0, 0, w, this.canvas.clientHeight);
      this.drawWeb(ctx, scroll, dt);
      this.drawActive(ctx, scroll);
      this.drawSpider(ctx, scroll, dt);
    }

    drawWeb(ctx, scroll, dt) {
      for (const a of this.web) { a.age += dt * 0.0002; }
      this.web = this.web.filter((a) => a.age < 1);
      for (let i = 1; i < this.web.length; i++) {
        const a = this.web[i - 1];
        const b = this.web[i];
        const alpha = Math.max(0, 0.5 - Math.max(a.age, b.age) * 0.5);
        if (alpha <= 0) { continue; }
        const ay = a.y - scroll;
        const by = b.y - scroll;
        ctx.strokeStyle = this.color;
        ctx.globalAlpha = alpha * (b.op === 'write' ? 1 : 0.5);
        ctx.lineWidth = b.op === 'write' ? 1.1 : 0.8;
        ctx.beginPath();
        ctx.moveTo(a.x, ay);
        ctx.quadraticCurveTo((a.x + b.x) / 2 + 8, (ay + by) / 2 + Math.min(12, Math.abs(by - ay) * 0.25), b.x, by);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // The read/write effect is tied to the spider's own position: it marks the
    // code from the line's start up to where the spider has walked.
    drawActive(ctx, scroll) {
      if (this.mode !== 'crawl' || this.curLine < 0) { return; }
      const box = this.lineBox(this.curLine);
      if (!box) { return; }
      const y = box.top - scroll;
      const x = this.bodyX;
      if (this.op === 'write') {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(this.lineStartX, y, Math.max(0, x - this.lineStartX), box.h);
        const blink = 0.5 + 0.5 * Math.sin(performance.now() * 0.012);
        ctx.globalAlpha = 0.4 + 0.5 * blink;
        ctx.fillRect(x - 1, y + 2, 2, box.h - 4); // caret at the spider
      } else {
        const grad = ctx.createLinearGradient(x - 22, 0, x + 6, 0);
        grad.addColorStop(0, 'rgba(120,170,230,0)');
        grad.addColorStop(1, 'rgba(120,170,230,0.5)');
        ctx.fillStyle = grad;
        ctx.globalAlpha = 1;
        ctx.fillRect(x - 22, y, 28, box.h);
      }
      ctx.globalAlpha = 1;
    }

    drawSpider(ctx, scroll, dt) {
      if (this.lineEls.length === 0) { return; }
      const bx = this.bodyX;
      const by = this.bodyDocY - scroll;

      // heading from actual movement, so the spider faces where it walks
      const vx = this.bodyX - this.prevX;
      const vy = this.bodyDocY - this.prevDocY;
      const moving = Math.hypot(vx, vy) > 0.3;
      if (moving) { this.heading = Math.atan2(vy, vx); }
      this.prevX = this.bodyX;
      this.prevDocY = this.bodyDocY;

      // legs: eight radial legs that step while moving
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      for (const f of this.feet) {
        const spread = 9 + f.rank * 6;
        const homeX = bx + f.side * (9 + f.rank * 3);
        const homeY = by + (f.rank - 1.5) * 4.5;
        const targetX = homeX + f.side * spread;
        const targetY = homeY + (f.rank % 2 ? 5 : -5);
        f.step += dt * (moving ? 0.03 : 0.004);
        const lift = moving ? Math.max(0, Math.sin(f.step)) * 3.5 : 0;
        f.x += (targetX - f.x) * Math.min(1, dt / 110);
        f.y += (targetY - f.y) * Math.min(1, dt / 110);
        const kneeX = (homeX + f.x) / 2 + f.side * 4;
        const kneeY = (homeY + (f.y - lift)) / 2 - 4;
        ctx.beginPath();
        ctx.moveTo(homeX, homeY);
        ctx.quadraticCurveTo(kneeX, kneeY, f.x, f.y - lift);
        ctx.stroke();
      }

      // body + head (head leads in the walking direction)
      const hx = bx + Math.cos(this.heading) * 6;
      const hy = by + Math.sin(this.heading) * 6;
      ctx.save();
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 9;
      ctx.fillStyle = this.color;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.ellipse(bx, by, 4.5, 6, this.heading, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hx, hy, 2.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // eyes on the head
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const ox = Math.cos(this.heading + Math.PI / 2) * 1.1;
      const oy = Math.sin(this.heading + Math.PI / 2) * 1.1;
      ctx.beginPath();
      ctx.arc(hx + ox, hy + oy, 0.7, 0, Math.PI * 2);
      ctx.arc(hx - ox, hy - oy, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    dispose() {
      this.root.remove();
    }
  }

  // ---- reconciliation ------------------------------------------------------
  function updateLayout() {
    const n = panes.size;
    panesEl.setAttribute('data-count', String(Math.min(n, 4)));
    let empty = document.getElementById('empty');
    if (n === 0) {
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'empty';
        empty.textContent = 'Waiting for agent file activity…';
        panesEl.appendChild(empty);
      }
    } else if (empty) {
      empty.remove();
    }
    // Canvases may have resized when the grid changed.
    for (const p of panes.values()) {
      p.layout();
    }
  }

  function handlePanes(list) {
    const incoming = new Set(list.map((p) => p.file));
    // remove panes no longer active
    for (const [file, pane] of panes) {
      if (!incoming.has(file)) {
        pane.dispose();
        panes.delete(file);
      }
    }
    // add / update
    for (const info of list) {
      let pane = panes.get(info.file);
      const isNew = !pane;
      if (!pane) {
        pane = new Pane(info.file);
        panes.set(info.file, pane);
      }
      pane.op = info.op;
      pane.color = info.color;
      pane.detail = info.detail || (info.unreadable ? 'binary / not shown' : '');
      pane.agent = info.agent;
      pane.setHeader();
      if (Array.isArray(info.lines)) {
        pane.render(info.lines);
      }
      if (isNew) {
        updateLayout(); // grid dimensions change -> relayout before planning
      }
      pane.plan(info.startLine, info.endLine);
    }
    updateLayout();

    const files = panes.size;
    const agents = new Set([...panes.values()].map((p) => p.agent)).size;
    statusEl.textContent = files
      ? `${agents} agent(s) · ${files} file(s) active`
      : 'waiting for agent activity…';
  }

  // ---- loop ----------------------------------------------------------------
  function frame(ts) {
    const dt = lastTs ? Math.min(60, ts - lastTs) : 16;
    lastTs = ts;
    for (const pane of panes.values()) {
      pane.step(dt);
      pane.draw(dt);
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => { for (const p of panes.values()) { p.layout(); } });
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg && msg.type === 'panes') {
      handlePanes(msg.panes || []);
    }
  });

  updateLayout();
  requestAnimationFrame(frame);
  vscode.postMessage({ type: 'ready' });
})();

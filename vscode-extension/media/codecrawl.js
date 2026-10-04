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
      this.targets = [];
      this.web = [];
      this.active = null;
      this.bodyDocY = -100;
      this.aimDocY = -100;
      this.dir = 1;
      this.dwell = 0;
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
      this.bodyDocY = this.aimDocY = this.lineCenterDocY(0);
      this.targets = [];
      this.web = [];
      this.active = null;
      this.layout();
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
      this.targets = this.targets.concat(plan);
    }

    arrive(i) {
      const el = this.lineEls[i];
      if (el) {
        el.classList.remove('visited');
        el.classList.add(this.op);
        setTimeout(() => { el.classList.remove('read', 'write'); el.classList.add('visited'); }, 1000);
      }
      this.active = { line: i, t: 0 };
      const box = this.lineBox(i);
      if (box) {
        const jitter = (i * 53) % 36;
        this.web.push({ x: GUTTER + 14 + jitter, y: box.top + box.h / 2, op: this.op, age: 0 });
        while (this.web.length > 70) {
          this.web.shift();
        }
      }
      this.ensureVisible(this.lineCenterDocY(i));
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
      } else if (this.targets.length > 0) {
        const next = this.targets[0];
        this.aimDocY = this.lineCenterDocY(next);
        if (Math.abs(this.bodyDocY - this.aimDocY) < 2) {
          this.arrive(next);
          this.targets.shift();
          this.dwell = this.op === 'write' ? 130 : 85; // pause to "inspect" each line
        }
      }
      const d = this.aimDocY - this.bodyDocY;
      if (Math.abs(d) > 0.5) {
        this.dir = d > 0 ? 1 : -1;
        const stepPx = SPEED * dt;
        this.bodyDocY = stepPx >= Math.abs(d) ? this.aimDocY : this.bodyDocY + this.dir * stepPx;
      }
    }

    draw(dt) {
      const ctx = this.ctx;
      const scroll = this.viewport.scrollTop;
      const w = this.canvas.clientWidth;
      ctx.clearRect(0, 0, w, this.canvas.clientHeight);
      this.drawWeb(ctx, scroll, dt);
      this.drawActive(ctx, scroll, dt, w);
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

    drawActive(ctx, scroll, dt, w) {
      if (!this.active) { return; }
      this.active.t = Math.min(1, this.active.t + dt / 300);
      const box = this.lineBox(this.active.line);
      if (!box) { return; }
      const y = box.top - scroll;
      const left = GUTTER;
      const right = w - 10;
      const span = right - left;
      if (this.op === 'write') {
        const x = left + span * this.active.t;
        ctx.fillStyle = this.color;
        ctx.globalAlpha = 0.14;
        ctx.fillRect(left, y, x - left, box.h);
        const blink = 0.5 + 0.5 * Math.sin(performance.now() * 0.012);
        ctx.globalAlpha = 0.4 + 0.5 * blink;
        ctx.fillRect(x - 1, y + 2, 2, box.h - 4);
      } else {
        const x = left + span * this.active.t;
        const grad = ctx.createLinearGradient(x - 24, 0, x + 6, 0);
        grad.addColorStop(0, 'rgba(120,170,230,0)');
        grad.addColorStop(1, 'rgba(120,170,230,0.5)');
        ctx.fillStyle = grad;
        ctx.globalAlpha = 1;
        ctx.fillRect(x - 24, y, 30, box.h);
      }
      ctx.globalAlpha = 1;
    }

    drawSpider(ctx, scroll, dt) {
      if (this.lineEls.length === 0) { return; }
      const by = this.bodyDocY - scroll;
      const bx = GUTTER - 26;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      const moving = Math.abs(this.aimDocY - this.bodyDocY) > 1.5;
      for (const f of this.feet) {
        const spread = 9 + f.rank * 6;
        const homeX = bx + f.side * (9 + f.rank * 3);
        const homeY = by + (f.rank - 1.5) * 4.5;
        const targetX = homeX + f.side * spread;
        const targetY = homeY + (f.rank % 2 ? 5 : -5);
        f.step += dt * (moving ? 0.02 : 0.004);
        const lift = moving ? Math.max(0, Math.sin(f.step)) * 3.5 : 0;
        f.x += (targetX - f.x) * Math.min(1, dt / 120);
        f.y += (targetY - f.y) * Math.min(1, dt / 120);
        const kneeX = (homeX + f.x) / 2 + f.side * 4;
        const kneeY = (homeY + (f.y - lift)) / 2 - 4;
        ctx.beginPath();
        ctx.moveTo(homeX, homeY);
        ctx.quadraticCurveTo(kneeX, kneeY, f.x, f.y - lift);
        ctx.stroke();
      }
      ctx.save();
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 9;
      ctx.fillStyle = this.color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.ellipse(bx, by, 4.5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, by - 6.5 * this.dir, 2.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(bx - 1, by - 6.5 * this.dir, 0.7, 0, Math.PI * 2);
      ctx.arc(bx + 1, by - 6.5 * this.dir, 0.7, 0, Math.PI * 2);
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

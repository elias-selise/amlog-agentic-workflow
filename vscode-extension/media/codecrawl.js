// @ts-check
// AMLOG Code Crawl webview.
//
// Renders the text of the file an agent is touching and crawls an articulated,
// line-drawn spider over the real code lines — so what you see maps to what the
// agent is doing:
//   • writing  → the spider walks down the edited run, WEAVING silk over the
//                lines it writes and "stitching" each line left-to-right.
//   • reading  → the spider scans the range, sweeping a thin beam across each
//                line it inspects.
// A status bubble over the spider says what it is doing ("writing line 42").
(function () {
  const vscode = acquireVsCodeApi();
  const codeEl = /** @type {HTMLElement} */ (document.getElementById('code'));
  const viewport = /** @type {HTMLElement} */ (document.getElementById('viewport'));
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('overlay'));
  const ctx = canvas.getContext('2d');
  const dotEl = /** @type {HTMLElement} */ (document.getElementById('dot'));
  const agentEl = /** @type {HTMLElement} */ (document.getElementById('agent'));
  const opEl = /** @type {HTMLElement} */ (document.getElementById('op'));
  const fileEl = /** @type {HTMLElement} */ (document.getElementById('file'));

  const GUTTER = 58;

  /** @type {HTMLElement[]} */
  let lineEls = [];
  /** @type {number[]} */
  let targets = [];
  /** silk anchors in DOCUMENT coords: {x,y,op,age} */
  let web = [];

  let currentOp = 'read';
  let currentColor = '#9e9e9e';
  let currentDetail = '';

  // spider body in document-Y, screen-X
  let bodyDocY = -100;
  let aimDocY = -100;
  let bodyX = GUTTER - 24;
  let dir = 1; // +1 down, -1 up
  let dwell = 0;
  let lastTs = 0;

  // one "active" line effect (the stitch/scan playing out on the current line)
  let active = null; // {line, op, t}

  // eight procedural feet in SCREEN coords
  const feet = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const rank = i % 4;
    feet.push({ x: 0, y: 0, side, rank, step: Math.random() * Math.PI * 2 });
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  window.addEventListener('resize', resize);

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  }

  function renderFile(lines) {
    codeEl.innerHTML = lines
      .map((l) => `<span class="line">${escapeHtml(l) || ' '}</span>`)
      .join('');
    lineEls = /** @type {HTMLElement[]} */ (Array.from(codeEl.querySelectorAll('.line')));
  }

  function lineCenterDocY(i) {
    const el = lineEls[i];
    return el ? el.offsetTop + el.offsetHeight / 2 : 0;
  }

  function lineBox(i) {
    const el = lineEls[i];
    if (!el) {
      return null;
    }
    return { top: el.offsetTop, h: el.offsetHeight };
  }

  // Build the spider's path. A real line range makes it crawl the exact lines;
  // otherwise it animates a plausible working pattern.
  function planTargets(op, startLine, endLine) {
    if (lineEls.length === 0) {
      return;
    }
    const n = lineEls.length;
    const clamp = (i) => Math.max(0, Math.min(n - 1, i));
    const plan = [];
    const hasRange = Number.isFinite(startLine);
    const from = hasRange ? clamp(startLine - 1) : 0;
    const to = hasRange ? clamp((Number.isFinite(endLine) ? endLine : startLine) - 1) : n - 1;

    if (hasRange) {
      const span = Math.max(1, to - from + 1);
      const steps = op === 'write' ? Math.min(span, 40) : Math.min(span, 8);
      for (let i = 0; i < steps; i++) {
        plan.push(clamp(from + Math.round((i * (span - 1)) / Math.max(1, steps - 1))));
      }
    } else {
      const start = targets.length ? targets[targets.length - 1] : Math.floor(Math.random() * n);
      if (op === 'write') {
        let line = clamp(start);
        const run = 4 + Math.floor(Math.random() * 5);
        for (let i = 0; i < run; i++) {
          line = clamp(line + 1 + Math.floor(Math.random() * 2));
          plan.push(line);
        }
      } else {
        const hops = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < hops; i++) {
          plan.push(Math.floor(Math.random() * n));
        }
      }
    }
    targets = targets.concat(plan);
  }

  function arrive(i, op) {
    const el = lineEls[i];
    if (el) {
      el.classList.remove('visited');
      el.classList.add(op);
      // leave a faint "visited" trace after the bright highlight fades
      setTimeout(() => {
        el.classList.remove('read', 'write');
        el.classList.add('visited');
      }, 1100);
    }
    active = { line: i, op, t: 0 };
    // weave a silk anchor on the code at this line
    const box = lineBox(i);
    if (box) {
      const jitter = ((i * 53) % 40);
      web.push({ x: GUTTER + 18 + jitter, y: box.top + box.h / 2, op, age: 0 });
      while (web.length > 90) {
        web.shift();
      }
    }
    ensureVisible(lineCenterDocY(i));
  }

  function ensureVisible(docY) {
    const top = viewport.scrollTop;
    const h = viewport.clientHeight - 34;
    if (docY < top + 50) {
      viewport.scrollTo({ top: Math.max(0, docY - 70), behavior: 'smooth' });
    } else if (docY > top + h - 90) {
      viewport.scrollTo({ top: docY - h + 130, behavior: 'smooth' });
    }
  }

  // ---- drawing -------------------------------------------------------------

  function draw(dt) {
    const scroll = viewport.scrollTop;
    const w = canvas.clientWidth;
    ctx.clearRect(0, 0, w, canvas.clientHeight);

    drawWeb(scroll, dt);
    drawActive(scroll, dt, w);
    drawSpider(scroll, dt);
  }

  function drawWeb(scroll, dt) {
    // sagging silk between consecutive anchors + the odd cross-strand
    for (let i = 0; i < web.length; i++) {
      web[i].age += dt * 0.00018;
    }
    web = web.filter((a) => a.age < 1);

    for (let i = 1; i < web.length; i++) {
      const a = web[i - 1];
      const b = web[i];
      const alpha = Math.max(0, 0.5 - Math.max(a.age, b.age) * 0.5);
      if (alpha <= 0) {
        continue;
      }
      const ay = a.y - scroll;
      const by = b.y - scroll;
      ctx.strokeStyle = currentColor;
      ctx.globalAlpha = alpha * (b.op === 'write' ? 1 : 0.5);
      ctx.lineWidth = b.op === 'write' ? 1.1 : 0.8;
      ctx.beginPath();
      ctx.moveTo(a.x, ay);
      const midX = (a.x + b.x) / 2 + 10;
      const midY = (ay + by) / 2 + Math.min(14, Math.abs(by - ay) * 0.25); // sag
      ctx.quadraticCurveTo(midX, midY, b.x, by);
      ctx.stroke();
      if (b.op === 'write' && i > 2) {
        const c = web[i - 3];
        ctx.globalAlpha = alpha * 0.3;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - scroll);
        ctx.lineTo(b.x, by);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawActive(scroll, dt, w) {
    if (!active) {
      return;
    }
    active.t = Math.min(1, active.t + dt / 520);
    const box = lineBox(active.line);
    if (!box) {
      return;
    }
    const y = box.top - scroll;
    const left = GUTTER;
    const right = w - 14;
    const span = right - left;

    if (active.op === 'write') {
      // a "stitch" that fills the line left→right with a caret at the front
      const x = left + span * active.t;
      ctx.fillStyle = currentColor;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(left, y, x - left, box.h);
      ctx.globalAlpha = 0.9;
      const blink = 0.5 + 0.5 * Math.sin(performance.now() * 0.012);
      ctx.globalAlpha = 0.4 + 0.5 * blink;
      ctx.fillRect(x - 1, y + 2, 2, box.h - 4);
    } else {
      // a scan beam sweeping across the line
      const x = left + span * active.t;
      const grad = ctx.createLinearGradient(x - 26, 0, x + 6, 0);
      grad.addColorStop(0, 'rgba(120,170,230,0)');
      grad.addColorStop(1, 'rgba(120,170,230,0.5)');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 1;
      ctx.fillRect(x - 26, y, 32, box.h);
    }
    ctx.globalAlpha = 1;
  }

  function drawSpider(scroll, dt) {
    if (lineEls.length === 0) {
      return;
    }
    const by = bodyDocY - scroll;
    const bx = bodyX;

    // --- procedural legs ---
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    const moving = Math.abs(aimDocY - bodyDocY) > 1.5;
    for (const f of feet) {
      // home position for this foot relative to the body
      const spread = 10 + f.rank * 7;
      const homeX = bx + f.side * (10 + f.rank * 3);
      const homeY = by + (f.rank - 1.5) * 5;
      const targetX = homeX + f.side * spread;
      const targetY = homeY + (f.rank % 2 ? 6 : -6);
      // step the foot toward its target; lift as it steps when the body moves
      f.step += dt * (moving ? 0.02 : 0.004);
      const lift = moving ? Math.max(0, Math.sin(f.step)) * 4 : 0;
      f.x += (targetX - f.x) * Math.min(1, dt / 120);
      f.y += (targetY - f.y) * Math.min(1, dt / 120);
      const footX = f.x;
      const footY = f.y - lift;
      // two-segment leg with an outward knee
      const kneeX = (homeX + footX) / 2 + f.side * 5;
      const kneeY = (homeY + footY) / 2 - 5;
      ctx.beginPath();
      ctx.moveTo(homeX, homeY);
      ctx.quadraticCurveTo(kneeX, kneeY, footX, footY);
      ctx.stroke();
    }

    // --- body + head with a soft glow ---
    ctx.save();
    ctx.shadowColor = currentColor;
    ctx.shadowBlur = 10;
    ctx.fillStyle = currentColor;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(bx, by, 5, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by - 7 * dir, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // eyes
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(bx - 1.2, by - 7 * dir, 0.8, 0, Math.PI * 2);
    ctx.arc(bx + 1.2, by - 7 * dir, 0.8, 0, Math.PI * 2);
    ctx.fill();

    drawBubble(bx, by);
  }

  function drawBubble(bx, by) {
    const text = currentDetail || (currentOp === 'write' ? 'writing' : 'reading');
    ctx.font = '11px sans-serif';
    const padX = 7;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = 18;
    let bxx = bx + 16;
    let byy = by - 26;
    if (byy < 4) {
      byy = by + 12;
    }
    if (bxx + bw > canvas.clientWidth - 6) {
      bxx = canvas.clientWidth - 6 - bw;
    }
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(30,30,34,0.92)';
    roundRect(bxx, byy, bw, bh, 5);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = currentColor;
    roundRect(bxx, byy, bw, bh, 5);
    ctx.stroke();
    // little tail toward the spider
    ctx.beginPath();
    ctx.moveTo(bxx + 8, byy + bh);
    ctx.lineTo(bx + 4, by);
    ctx.stroke();
    ctx.fillStyle = 'rgba(240,240,245,0.95)';
    ctx.fillText(text, bxx + padX, byy + 13);
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- loop ----------------------------------------------------------------

  function frame(ts) {
    const dt = lastTs ? Math.min(60, ts - lastTs) : 16;
    lastTs = ts;

    if (dwell > 0) {
      dwell -= dt;
    } else if (targets.length > 0) {
      const next = targets[0];
      aimDocY = lineCenterDocY(next);
      if (Math.abs(bodyDocY - aimDocY) < 2.5) {
        arrive(next, currentOp);
        targets.shift();
        dwell = currentOp === 'write' ? 220 : 120;
      }
    }

    const d = aimDocY - bodyDocY;
    if (Math.abs(d) > 0.5) {
      dir = d > 0 ? 1 : -1;
      bodyDocY += d * Math.min(1, dt / 240);
    }

    draw(dt);
    requestAnimationFrame(frame);
  }

  // ---- messages ------------------------------------------------------------

  function setHeader(agent, op, file, color, detail) {
    agentEl.textContent = agent;
    const verb = op === 'write' ? '✎' : '👁';
    opEl.textContent = detail ? `${verb} ${detail}` : (op === 'write' ? '✎ writing' : '👁 reading');
    opEl.style.color = color;
    fileEl.textContent = file;
    dotEl.style.background = color;
    dotEl.style.color = color;
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg) {
      return;
    }
    if (msg.type === 'file') {
      currentOp = msg.op;
      currentColor = msg.color;
      currentDetail = msg.detail || '';
      setHeader(msg.agent, msg.op, msg.file, msg.color, msg.detail);
      renderFile(msg.lines);
      targets = [];
      web = [];
      active = null;
      const first = Number.isFinite(msg.startLine) ? Math.max(0, msg.startLine - 1) : 0;
      bodyDocY = aimDocY = lineCenterDocY(Math.min(first, lineEls.length - 1));
      planTargets(msg.op, msg.startLine, msg.endLine);
    } else if (msg.type === 'touch') {
      currentOp = msg.op;
      currentColor = msg.color;
      currentDetail = msg.detail || '';
      setHeader(msg.agent, msg.op, msg.file + (lineEls.length ? '' : '  (not shown)'), msg.color, msg.detail);
      planTargets(msg.op, msg.startLine, msg.endLine);
    }
  });

  resize();
  requestAnimationFrame(frame);
  vscode.postMessage({ type: 'ready' });
})();

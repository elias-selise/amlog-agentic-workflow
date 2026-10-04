// @ts-check
// AMLOG Code Crawl webview. Renders the text of the file an agent is touching and
// crawls a line-drawn spider over the actual code lines — the "spider on the
// file" effect, drawn by us so it isn't bound by the editor-decoration limit.
(function () {
  const vscode = acquireVsCodeApi();
  const codeEl = /** @type {HTMLElement} */ (document.getElementById('code'));
  const viewport = /** @type {HTMLElement} */ (document.getElementById('viewport'));
  const spiderEl = /** @type {HTMLElement} */ (document.getElementById('spider'));
  const dotEl = /** @type {HTMLElement} */ (document.getElementById('dot'));
  const agentEl = /** @type {HTMLElement} */ (document.getElementById('agent'));
  const opEl = /** @type {HTMLElement} */ (document.getElementById('op'));
  const fileEl = /** @type {HTMLElement} */ (document.getElementById('file'));

  /** @type {HTMLElement[]} */
  let lineEls = [];
  /** @type {number[]} */
  let targets = []; // queue of line indexes to visit
  let curY = -100; // current spider pixel offset (within #code)
  let aimY = -100; // target pixel offset
  let dwell = 0; // ms left to linger on the current line
  let legPhase = 0;
  let lastTs = 0;
  let currentOp = 'read';
  let currentColor = '#9e9e9e';

  function setSpiderColor(color) {
    spiderEl.innerHTML = spiderSvg(color);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  }

  function renderFile(lines) {
    codeEl.innerHTML = lines
      .map((l) => `<span class="line">${escapeHtml(l) || ' '}</span>`)
      .join('');
    lineEls = /** @type {HTMLElement[]} */ (Array.from(codeEl.querySelectorAll('.line')));
    spiderEl.classList.remove('hidden');
  }

  function lineTop(i) {
    const el = lineEls[i];
    return el ? el.offsetTop + el.offsetHeight / 2 - 15 : 0;
  }

  // Build a plausible "working" path for the spider: a write crawls down a run of
  // consecutive lines (editing), a read hops around (scanning).
  function planTargets(op) {
    if (lineEls.length === 0) {
      return;
    }
    const n = lineEls.length;
    const start = targets.length ? targets[targets.length - 1] : Math.floor(Math.random() * n);
    const plan = [];
    if (op === 'write') {
      let line = Math.min(start, n - 1);
      const run = 4 + Math.floor(Math.random() * 5);
      for (let i = 0; i < run; i++) {
        line = Math.min(n - 1, line + 1 + Math.floor(Math.random() * 2));
        plan.push(line);
      }
    } else {
      const hops = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < hops; i++) {
        plan.push(Math.floor(Math.random() * n));
      }
    }
    targets = targets.concat(plan);
  }

  function highlight(i, op) {
    const el = lineEls[i];
    if (!el) {
      return;
    }
    el.classList.remove('fade');
    el.classList.add(op);
    setTimeout(() => {
      el.classList.remove('read', 'write');
      el.classList.add('fade');
    }, 900);
  }

  function frame(ts) {
    const dt = lastTs ? ts - lastTs : 16;
    lastTs = ts;

    if (dwell > 0) {
      dwell -= dt;
    } else if (targets.length > 0) {
      const next = targets[0];
      aimY = lineTop(next);
      // close enough -> arrive: highlight, dwell, pop
      if (Math.abs(curY - aimY) < 2) {
        highlight(next, currentOp);
        ensureVisible(aimY);
        targets.shift();
        dwell = 140 + Math.random() * 160;
      }
    }

    // ease toward the aim
    const d = aimY - curY;
    if (Math.abs(d) > 0.5) {
      curY += d * Math.min(1, dt / 220);
      legPhase += dt * 0.03;
    } else {
      legPhase += dt * 0.004; // idle breathing
    }

    const bob = Math.sin(legPhase) * 1.5;
    spiderEl.style.transform = `translateY(${curY + bob}px)`;
    requestAnimationFrame(frame);
  }

  function ensureVisible(y) {
    const top = viewport.scrollTop;
    const h = viewport.clientHeight;
    if (y < top + 40) {
      viewport.scrollTo({ top: Math.max(0, y - 60), behavior: 'smooth' });
    } else if (y > top + h - 80) {
      viewport.scrollTo({ top: y - h + 120, behavior: 'smooth' });
    }
  }

  function setHeader(agent, op, file, color) {
    agentEl.textContent = agent;
    opEl.textContent = op === 'write' ? '✎ writing' : '👁 reading';
    fileEl.textContent = file;
    dotEl.style.background = color;
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg) {
      return;
    }
    if (msg.type === 'file') {
      currentOp = msg.op;
      currentColor = msg.color;
      setSpiderColor(msg.color);
      setHeader(msg.agent, msg.op, msg.file, msg.color);
      renderFile(msg.lines);
      targets = [];
      curY = aimY = lineTop(0);
      planTargets(msg.op);
    } else if (msg.type === 'touch') {
      currentOp = msg.op;
      currentColor = msg.color;
      setSpiderColor(msg.color);
      setHeader(msg.agent, msg.op, msg.file + (lineEls.length ? '' : '  (not shown)'), msg.color);
      planTargets(msg.op);
    }
  });

  function spiderSvg(color) {
    return `<svg viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round">`
      + `<path d="M15 12 L6 7 M15 14 L4 13 M15 16 L5 20 M15 18 L7 25"/>`
      + `<path d="M15 12 L24 7 M15 14 L26 13 M15 16 L25 20 M15 18 L23 25"/>`
      + `<ellipse cx="15" cy="15" rx="4" ry="5" fill="${color}" fill-opacity="0.55"/>`
      + `<circle cx="15" cy="8.5" r="2.2" fill="${color}" fill-opacity="0.8"/>`
      + `</svg>`;
  }

  setSpiderColor(currentColor);
  requestAnimationFrame(frame);
  vscode.postMessage({ type: 'ready' });
})();

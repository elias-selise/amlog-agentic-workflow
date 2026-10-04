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

  // Build the spider's path. When the event carries a real line range (from the
  // hook's tool_input — "read lines 1-200", "edited 5 lines @ 142") the spider
  // crawls those exact lines; otherwise it animates a plausible working pattern.
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
      if (op === 'write') {
        // Walk the edited run line by line (cap steps so a huge range stays snappy).
        const steps = Math.min(span, 40);
        for (let i = 0; i < steps; i++) {
          plan.push(clamp(from + Math.round((i * (span - 1)) / Math.max(1, steps - 1))));
        }
      } else {
        // Scan a few evenly-spaced points across the read range.
        const hops = Math.min(span, 8);
        for (let i = 0; i < hops; i++) {
          plan.push(clamp(from + Math.round((i * (span - 1)) / Math.max(1, hops - 1))));
        }
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

  function setHeader(agent, op, file, color, detail) {
    agentEl.textContent = agent;
    const verb = op === 'write' ? '✎' : '👁';
    opEl.textContent = detail ? `${verb} ${detail}` : (op === 'write' ? '✎ writing' : '👁 reading');
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
      setHeader(msg.agent, msg.op, msg.file, msg.color, msg.detail);
      renderFile(msg.lines);
      targets = [];
      const first = Number.isFinite(msg.startLine) ? Math.max(0, msg.startLine - 1) : 0;
      curY = aimY = lineTop(Math.min(first, lineEls.length - 1));
      planTargets(msg.op, msg.startLine, msg.endLine);
    } else if (msg.type === 'touch') {
      currentOp = msg.op;
      currentColor = msg.color;
      setSpiderColor(msg.color);
      setHeader(msg.agent, msg.op, msg.file + (lineEls.length ? '' : '  (not shown)'), msg.color, msg.detail);
      planTargets(msg.op, msg.startLine, msg.endLine);
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

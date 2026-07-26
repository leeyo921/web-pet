const COMPONENT_URL = new URL('.', import.meta.url);
const MANIFEST_URL = new URL('manifest.json', COMPONENT_URL);

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      --pet-size: 130px;
      position: fixed;
      left: 0;
      top: 0;
      z-index: 23;
      display: block;
      width: 1px;
      height: 1px;
      contain: layout style;
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition: opacity .2s ease;
    }
    :host([hidden]), :host([paused]) { opacity: 0; pointer-events: none; }
    .stage {
      position: absolute;
      left: 0;
      bottom: 0;
      display: grid;
      place-items: end center;
      border: 0;
      padding: 0;
      margin: 0;
      background: transparent;
      cursor: grab;
      touch-action: none;
      transform-origin: center bottom;
      /* 姿态切换不插值舞台尺寸；插值会让透明画布在动画帧之间产生“忽大忽小”的错觉。 */
      transition: none;
    }
    .stage:active { cursor: grabbing; }
    .stage:focus-visible { outline: 2px solid #e8633a; outline-offset: 3px; border-radius: 16px; }
    .sprite {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: fill;
      pointer-events: none;
      transform-origin: center bottom;
    }
    :host([direction="left"]) .sprite { transform: scaleX(-1); }
    :host([state="idle"]) .stage,
    :host([state="loaf"]) .stage { animation: breathe 4s ease-in-out infinite; }
    :host([state="sleep"]) .stage,
    :host([state="sleep2"]) .stage { animation: breathe 5s ease-in-out infinite; }
    :host([dragging]) .stage { animation: dangle 0.6s ease-in-out infinite; }
    @keyframes dangle { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
    .hint {
      position: absolute;
      left: 50%;
      bottom: calc(100% - 5px);
      transform: translateX(-50%) translateY(4px);
      white-space: nowrap;
      border: 1px solid rgba(7, 19, 23, .12);
      border-radius: 999px;
      padding: 6px 10px;
      background: rgba(255, 255, 255, .94);
      color: #18333a;
      box-shadow: 0 5px 18px rgba(7, 19, 23, .12);
      font: 600 11px/1.2 system-ui, sans-serif;
      opacity: 0;
      pointer-events: none;
      transition: opacity .2s ease, transform .2s ease;
    }
    :host([hint]) .hint { opacity: 1; transform: translateX(-50%) translateY(0); }
    @keyframes breathe { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.012); } }
    @media (max-width: 699px) { :host { --pet-size: 80px; } }
    @media (prefers-reduced-motion: reduce) {
      .stage { transition: none; animation: none !important; }
    }
  </style>
  <button class="stage" type="button" aria-label="网页桌宠：单击切换姿态，双击卖萌，拖动可移动" disabled>
    <img class="sprite" alt="雪爪桌宠" draggable="false" />
    <span class="hint" aria-hidden="true">点我切姿态 · 双击会卖萌</span>
  </button>
`;

export class WebPet extends HTMLElement {
  static get observedAttributes() { return ['paused']; }

  #manifest;
  #stage;
  #sprite;
  #audio;
  #state = 'idle';
  #frame = 0;
  #frameTimer = 0;
  #playGeneration = 0;
  #scheduler = 0;
  #moveRaf = 0;
  #moveResolve = null;
  #x = 0;
  #y = 0;
  #drag = null;
  #throw = null;
  #clickTimer = 0;
  #loaded = new Set();
  #motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  #suppressClick = false;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.append(template.content.cloneNode(true));
    this.#stage = shadow.querySelector('.stage');
    this.#sprite = shadow.querySelector('.sprite');
  }

  connectedCallback() {
    this.#bind();
    this.#initialize().catch((error) => {
      console.error('WebPet 初始化失败', error);
      this.hidden = true;
    });
  }

  disconnectedCallback() {
    this.#stopTimers();
    this.#audio?.pause();
  }

  get states() {
    return Object.keys(this.#manifest?.states || {});
  }

  play(state) {
    if (!this.#manifest) return Promise.resolve(false);
    return this.#play(state, { thenIdle: this.#manifest?.states[state]?.once === true });
  }

  pause() { this.setAttribute('paused', ''); }

  resume() { this.removeAttribute('paused'); }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name !== 'paused' || oldValue === newValue || !this.#manifest) return;
    if (newValue !== null) {
      this.#stopTimers();
      this.#audio?.pause();
    } else {
      this.#play('idle');
      this.#schedule();
    }
  }

  async #initialize() {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) throw new Error(`manifest ${response.status}`);
    this.#manifest = await response.json();
    this.#audio = new Audio(new URL(this.#manifest.audio, COMPONENT_URL));
    this.#audio.preload = 'none';
    this.#audio.volume = 0.8;
    await this.#preload('idle');
    this.#positionInitially();
    this.#play('idle');
    this.#stage.disabled = false;
    this.#schedule();
    this.dispatchEvent(new CustomEvent('webpet-ready', { bubbles: true }));
  }

  #bind() {
    this.#stage.addEventListener('pointerdown', (event) => this.#dragStart(event));
    this.#stage.addEventListener('pointermove', (event) => this.#dragMove(event));
    this.#stage.addEventListener('pointerup', (event) => this.#dragEnd(event));
    this.#stage.addEventListener('pointercancel', (event) => this.#dragEnd(event));
    this.#stage.addEventListener('click', () => this.#singleClick());
    this.#stage.addEventListener('dblclick', (event) => this.#doubleClick(event));
    this.#stage.addEventListener('pointerenter', () => this.#showHintOnce(), { once: true });
    this.#stage.addEventListener('focus', () => this.#showHintOnce(), { once: true });
    addEventListener('resize', () => {
      if (this.#manifest) this.#showFrame(this.#state, this.#frame);
      this.#clampPosition();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.#stopTimers();
      else if (this.#manifest) { this.#play('idle'); this.#schedule(); }
    });
  }

  async #preload(state) {
    if (this.#loaded.has(state)) return;
    const frames = this.#manifest.states[state]?.frames || [];
    await Promise.all(frames.map((frame) => new Promise((resolve) => {
      const image = new Image();
      image.onload = image.onerror = resolve;
      image.src = new URL(frame.src, COMPONENT_URL);
    })));
    this.#loaded.add(state);
  }

  #positionInitially() {
    const mobile = innerWidth < 700;
    this.#x = Math.max(8, innerWidth - (mobile ? 125 : 225));
    this.#y = Math.max(8, innerHeight - (mobile ? 10 : 18));
    this.#applyPosition();
  }

  #baseSize() {
    const requested = Number(this.getAttribute('size'));
    return requested > 0 ? requested : (innerWidth < 700 ? 80 : 130);
  }

  #showFrame(state, index) {
    const config = this.#manifest.states[state];
    const frame = config.frames[index] || config.frames[0];
    const base = this.#baseSize();
    const scale = Number(config.displayScale || 1) * Number(config.runtimeScale || 1);
    const height = frame.heightScale * base * scale;
    const width = height * (frame.width / frame.height);
    this.#stage.style.width = `${Math.round(width)}px`;
    this.#stage.style.height = `${Math.round(height)}px`;
    this.#sprite.src = new URL(frame.src, COMPONENT_URL);
    this.#sprite.alt = `雪爪桌宠：${state}`;
    this.#clampPosition();
  }

  async #play(state, { thenIdle = false } = {}) {
    if (!this.#manifest?.states[state]) state = 'idle';
    const generation = ++this.#playGeneration;
    this.#clearPlayback();
    await this.#preload(state);
    if (generation !== this.#playGeneration) return;
    this.#state = state;
    this.#frame = 0;
    this.setAttribute('state', state);
    this.dispatchEvent(new CustomEvent('webpet-statechange', { detail: { state }, bubbles: true }));
    this.#showFrame(state, 0);
    const config = this.#manifest.states[state];
    if (config.hold || config.frames.length < 2 || this.#motionQuery.matches) return;
    const interval = Math.max(70, Math.round(config.cycleMs / config.frames.length));
    this.#frameTimer = setInterval(() => {
      if (generation !== this.#playGeneration) return;
      if (config.once && this.#frame >= config.frames.length - 1) {
        this.#clearPlayback();
        if (thenIdle) setTimeout(() => this.#play('idle'), 350);
        return;
      }
      this.#frame = (this.#frame + 1) % config.frames.length;
      this.#showFrame(state, this.#frame);
    }, interval);
  }

  #clearPlayback() {
    clearInterval(this.#frameTimer);
    this.#frameTimer = 0;
  }

  #schedule() {
    clearTimeout(this.#scheduler);
    if (this.#motionQuery.matches || this.hasAttribute('paused')) return;
    this.#scheduler = setTimeout(async () => {
      const r = Math.random();
      if (innerWidth >= 700 && r < 0.45) await this.#wander(Math.random() < 0.2 ? 'run' : 'walk');
      else if (r < 0.58) await this.#climb();
      else await this.#play(['loaf', 'sleep', 'sleep2', 'lie', 'groom', 'stretch', 'watch'][Math.floor(Math.random() * 7)], { thenIdle: true });
      this.#schedule();
    }, 6500 + Math.random() * 5000);
  }

  async #climb() {
    if (this.#drag || !this.#manifest.states.fall) return;
    const baseY = this.#y;
    // deskpet: 高度 min(340, 45% 视口高)
    const climbDist = Math.min(340, Math.round(innerHeight * 0.45));
    await this.#play('climb');
    // 上升：deskpet 83px/s (2px/24ms tick)
    let last = performance.now();
    await new Promise((resolve) => {
      this.#moveResolve = resolve;
      const step = (now) => {
        const delta = Math.min(40, now - last) / 1000;
        last = now;
        this.#y -= 83 * delta;
        if (this.#y <= baseY - climbDist) { this.#moveResolve = null; resolve(); return; }
        this.#applyPosition();
        this.#moveRaf = requestAnimationFrame(step);
      };
      this.#moveRaf = requestAnimationFrame(step);
    });
    if (this.hasAttribute('paused') || this.#drag) return;
    // deskpet: hang 600ms 悬停
    await new Promise((r) => setTimeout(r, 600));
    if (this.hasAttribute('paused') || this.#drag) return;
    // 下落：deskpet 自由落体加速 v=4 初速, 每帧 v=min(28, v+2)
    if (this.#manifest.states.fall) this.#play('fall');
    let v = 4;
    await new Promise((resolve) => {
      this.#moveResolve = resolve;
      const step = () => {
        v = Math.min(28, v + 2);
        this.#y += v;
        if (this.#y >= baseY) { this.#y = baseY; this.#applyPosition(); this.#moveResolve = null; resolve(); return; }
        this.#applyPosition();
        this.#moveRaf = requestAnimationFrame(step);
      };
      this.#moveRaf = requestAnimationFrame(step);
    });
    if (this.hasAttribute('paused') || this.#drag) return;
    // 落地缓冲
    await this.#land();
  }

  async #wander(state) {
    const config = this.#manifest.states[state];
    if (!config || this.#drag) return;
    await this.#play(state);
    const width = this.#stage.offsetWidth || 180;
    const target = 12 + Math.random() * Math.max(1, innerWidth - width - 24);
    const direction = target < this.#x ? -1 : 1;
    this.setAttribute('direction', direction < 0 ? 'left' : 'right');
    const speed = state === 'run' ? 250 : 83;
    let last = performance.now();
    await new Promise((resolve) => {
      this.#moveResolve = resolve;
      const step = (now) => {
        const delta = Math.min(40, now - last) / 1000;
        last = now;
        this.#x += direction * speed * delta;
        if ((direction > 0 && this.#x >= target) || (direction < 0 && this.#x <= target)) {
          this.#x = target;
          this.#applyPosition();
          this.#moveRaf = 0;
          this.#moveResolve = null;
          resolve();
          return;
        }
        this.#applyPosition();
        this.#moveRaf = requestAnimationFrame(step);
      };
      this.#moveRaf = requestAnimationFrame(step);
    });
    if (this.hasAttribute('paused')) return;
    await this.#play('idle');
  }

  #singleClick() {
    if (this.#suppressClick) { this.#suppressClick = false; return; }
    clearTimeout(this.#clickTimer);
    this.#clickTimer = setTimeout(() => {
      const states = ['idle', 'walk', 'run', 'lie', 'loaf', 'groom', 'sleep2', 'sleep', 'stretch', 'watch', 'climb'];
      const next = states[(states.indexOf(this.#state) + 1) % states.length];
      if (next === 'climb') this.#climb();
      else if (next === 'walk' || next === 'run') this.#wander(next);
      else this.#play(next, { thenIdle: next === 'watch' });
      this.#schedule();
    }, 260);
  }

  #doubleClick(event) {
    event.preventDefault();
    clearTimeout(this.#clickTimer);
    if (this.#audio) {
      this.#audio.currentTime = 0;
      this.#audio.play().catch(() => {});
    }
    this.#play('nuzzle', { thenIdle: true });
    this.#schedule();
  }

  #dragStart(event) {
    if (event.button !== 0) return;
    cancelAnimationFrame(this.#moveRaf);
    this.#drag = {
      id: event.pointerId,
      offsetX: event.clientX - this.#x,
      offsetY: event.clientY - this.#y,
      moved: false,
      samples: [{ x: event.clientX, y: event.clientY, t: performance.now() }],
    };
    this.#stage.setPointerCapture(event.pointerId);
    // deskpet: 按下不改变姿态，移动超过阈值才进 drag 态
  }

  #dragMove(event) {
    if (!this.#drag || event.pointerId !== this.#drag.id) return;
    const dx = event.clientX - (this.#drag.offsetX + this.#x);
    const dy = event.clientY - (this.#drag.offsetY + this.#y);
    if (Math.hypot(dx, dy) > 6 && !this.#drag.moved) {
      this.#drag.moved = true;
      // deskpet: 确认移动后才进入 drag 态
      this.#clearPlayback();
      this.#state = 'drag';
      this.#frame = 0;
      this.setAttribute('state', 'drag');
      this.#showFrame('idle', 0);
      this.setAttribute('dragging', '');
    }
    this.#x = event.clientX - this.#drag.offsetX;
    this.#y = event.clientY - this.#drag.offsetY;
    const now = performance.now();
    this.#drag.samples.push({ x: event.clientX, y: event.clientY, t: now });
    this.#drag.samples = this.#drag.samples.filter((s) => now - s.t <= 140);
    this.#clampPosition();
  }

  #dragEnd(event) {
    if (!this.#drag || event.pointerId !== this.#drag.id) return;
    this.#stage.releasePointerCapture?.(event.pointerId);
    const moved = this.#drag.moved;
    if (!moved) { this.#drag = null; return; }
    this.#suppressClick = true;
    const samples = this.#drag.samples;
    this.#drag = null;
    this.removeAttribute('dragging');
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = first && last ? Math.max(1, last.t - first.t) : 1;
    const vx = first && last ? (last.x - first.x) / elapsed : 0;
    const vy = first && last ? (last.y - first.y) / elapsed : 0;
    if (this.#startThrow(vx, vy)) return;
    this.#play('idle');
    this.#schedule();
  }

  #startThrow(vx, vy) {
    const speed = Math.hypot(vx, vy);
    if (speed < 0.75) return false;
    this.#throw = {
      vx: Math.max(-2.8, Math.min(2.8, vx)),
      vy: Math.max(-2.8, Math.min(2.8, vy)),
      until: performance.now() + 5000,
    };
    // deskpet: 飞行期间用 drag 态(idle 帧)，落地才显示 fall[1]
    this.#state = 'drag';
    this.#showFrame('idle', 0);
    this.#runThrow();
    return true;
  }

  #runThrow() {
    if (!this.#throw) return;
    const dt = 24;
    const b = this.#throw;
    const width = this.#stage.offsetWidth || 120;
    const height = this.#stage.offsetHeight || 100;
    const floor = innerHeight - height - 4;
    let nx = this.#x + Math.round(b.vx * dt);
    let ny = this.#y + Math.round(b.vy * dt);
    b.vy += 0.004 * dt;
    b.vx *= 0.995;
    if (nx <= 4 || nx + width >= innerWidth - 4) {
      nx = Math.max(4, Math.min(innerWidth - width - 4, nx));
      b.vx *= -0.55;
    }
    if (ny >= floor) {
      ny = floor;
      if (Math.abs(b.vy) > 0.65) {
        b.vy *= -0.32;
      } else {
        // 落地：显示 fall[1] 缓冲帧 + react 700ms
        this.#x = nx; this.#y = ny; this.#applyPosition();
        this.#throw = null;
        this.#land();
        return;
      }
    }
    this.#x = nx; this.#y = ny; this.#applyPosition();
    if (performance.now() > b.until) { this.#throw = null; this.#land(); return; }
    setTimeout(() => this.#runThrow(), dt);
  }

  // deskpet: 落地缓冲，显示 fall[1] 700ms 后回 idle
  async #land() {
    if (this.#manifest.states.fall?.frames[1]) {
      this.#state = 'react';
      this.setAttribute('state', 'react');
      this.#showFrame('fall', 1);
      await new Promise((r) => setTimeout(r, 700));
    }
    if (this.hasAttribute('paused') || this.#drag) return;
    await this.#play('idle');
    this.#schedule();
  }

  #clampPosition() {
    const width = this.#stage.offsetWidth || 120;
    const height = this.#stage.offsetHeight || 100;
    this.#x = Math.min(Math.max(4, this.#x), Math.max(4, innerWidth - width - 4));
    // y 表示姿态底边的基线，舞台用 bottom:0 向上展开。
    this.#y = Math.min(Math.max(height + 4, this.#y), Math.max(height + 4, innerHeight - 4));
    this.#applyPosition();
  }

  #applyPosition() {
    this.style.transform = `translate3d(${Math.round(this.#x)}px, ${Math.round(this.#y)}px, 0)`;
  }

  #showHintOnce() {
    try {
      if (sessionStorage.getItem('webpet-hint-seen')) return;
      sessionStorage.setItem('webpet-hint-seen', '1');
    } catch (_) {}
    this.setAttribute('hint', '');
    setTimeout(() => this.removeAttribute('hint'), 3800);
  }

  #stopTimers() {
    this.#playGeneration += 1;
    this.#clearPlayback();
    clearTimeout(this.#scheduler);
    clearTimeout(this.#clickTimer);
    cancelAnimationFrame(this.#moveRaf);
    this.#moveRaf = 0;
    this.#moveResolve?.();
    this.#moveResolve = null;
  }
}

if (!customElements.get('web-pet')) customElements.define('web-pet', WebPet);

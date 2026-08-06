const COMPONENT_URL = new URL('.', import.meta.url);
const MANIFEST_URL = new URL('manifest.json', COMPONENT_URL);

// 自动姿态权重（合计 100）：卖萌 nuzzle 是纯交互态，不进入自动池。
// play / lie / loaf / sleep / sleep2 各 11.6%；睡眠结束另有 80% 概率接 stretch。
const AUTO_POSE_WEIGHTS = [
  ['walk', 9], ['run', 6], ['climb', 9],
  ['play', 11.6], ['lie', 11.6], ['loaf', 11.6], ['sleep', 11.6], ['sleep2', 11.6],
  ['groom', 6], ['stretch', 6], ['watch', 6],
];

// 姿态停留时长（毫秒区间），与桌面端 deskpet 的 DURATIONS 逐项对齐
// （deskpet/src/main.js）。这是行为参数不是素材参数，跟桌面端一样放代码里，不进 manifest。
//
// 之前 webpet 拿 cycleMs（一轮动画的长度）当停留时长，等于每个姿态只播一遍就走；
// 没有 cycleMs 的静止姿态更是只停 #schedule 的 1–3 秒过渡。睡觉睡 3 秒、理毛只梳
// 一遍就起身，都不合理。
// idle 不列在这里：它是动作之间的过渡（deskpet 叫 bridge），时长由 #schedule 的
// 1–3 秒承担，两处都写会叠成 2–6 秒。
const DURATIONS = {
  sleep: [20000, 45000],
  sleep2: [20000, 45000],
  lie: [8000, 20000],
  loaf: [8000, 20000],
  // 至少播完一整套梳理动作再离开
  groom: [6500, 12000],
  // 一次性动作：时长必须正好覆盖完整时间轴，不能提前切走
  stretch: [4000, 4000],
  watch: [6000, 15000],
  play: [5000, 9000],
  nuzzle: [4100, 4300],
};

// 游荡的最短距离，同 deskpet：目标点离当前位置太近就重抽，抽 8 次仍太近就放弃改
// 成 idle。没有这个下限时随机目标可能就落在脚边，于是"刚走两步就切换"。
const MIN_WANDER_DIST = { walk: 60, run: 200 };

function rand([lo, hi]) { return lo + Math.random() * (hi - lo); }

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
      left: 50%;
      bottom: 0;
      display: grid;
      place-items: end center;
      border: 0;
      padding: 0;
      margin: 0;
      background: transparent;
      cursor: grab;
      touch-action: none;
      overflow: visible;
      transform: translateX(-50%);
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
    @keyframes dangle {
      0%,100% { transform: translateX(-50%) rotate(-6deg); }
      50% { transform: translateX(-50%) rotate(6deg); }
    }
    .zzz {
      position: absolute;
      left: 60%;
      bottom: 90%;
      font: 700 26px/1 system-ui, sans-serif;
      color: rgba(7, 19, 23, .25);
      pointer-events: none;
    }
    .zzz span {
      display: inline-block;
      opacity: 0;
    }
    :host([state="sleep"]) .zzz span,
    :host([state="sleep2"]) .zzz span { animation: zzzFloat 2.8s ease-out infinite; }
    :host([state="sleep"]) .zzz span:nth-child(2),
    :host([state="sleep2"]) .zzz span:nth-child(2) { animation-delay: .4s; font-size: 20px; }
    :host([state="sleep"]) .zzz span:nth-child(3),
    :host([state="sleep2"]) .zzz span:nth-child(3) { animation-delay: .8s; font-size: 14px; }
    @keyframes zzzFloat {
      0% { opacity: 0; transform: translate(0, 0) scale(.6); }
      20% { opacity: 1; transform: translate(3px, -3px) scale(.9); }
      80% { opacity: .5; transform: translate(10px, -18px) scale(1); }
      100% { opacity: 0; transform: translate(14px, -26px) scale(.7); }
    }
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
    @keyframes breathe {
      0%, 100% { transform: translateX(-50%) scaleY(1); }
      50% { transform: translateX(-50%) scaleY(1.012); }
    }
    @media (max-width: 699px) { :host { --pet-size: 80px; } }
    @media (prefers-reduced-motion: reduce) {
      .stage { transition: none; animation: none !important; }
    }
  </style>
  <button class="stage" type="button" aria-label="网页桌宠：单击切换姿态，双击卖萌，拖动可移动" disabled>
    <img class="sprite" alt="雪爪桌宠" draggable="false" />
    <span class="hint" aria-hidden="true">点我切姿态 · 双击会卖萌</span>
    <span class="zzz" aria-hidden="true"><span>z</span><span>z</span><span>z</span></span>
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
  #throwTimer = 0;
  #clickTimer = 0;
  #bound = false;
  #loaded = new Set();
  #motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  #suppressClick = false;

  // window / document 上的监听必须能解绑，否则元素被移除后闭包仍持有 this，
  // 既泄漏又会在重新挂载时叠加一份 handler。
  #onResize = () => {
    if (this.#manifest) this.#showFrame(this.#state, this.#frame);
    this.#clampPosition();
  };

  #onVisibilityChange = () => {
    if (document.hidden) this.#stopTimers();
    else if (this.#manifest) { this.#play('idle'); this.#schedule(); }
  };

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.append(template.content.cloneNode(true));
    this.#stage = shadow.querySelector('.stage');
    this.#sprite = shadow.querySelector('.sprite');
  }

  connectedCallback() {
    this.#bind();
    addEventListener('resize', this.#onResize, { passive: true });
    document.addEventListener('visibilitychange', this.#onVisibilityChange);
    if (this.#manifest) {
      // 重新挂载：manifest 已在手，直接恢复循环，不必再走一遍 #initialize。
      this.#play('idle');
      this.#schedule();
      return;
    }
    this.#initialize().catch((error) => {
      console.error('WebPet 初始化失败', error);
      this.hidden = true;
    });
  }

  disconnectedCallback() {
    removeEventListener('resize', this.#onResize);
    document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    this.#stopTimers();
    this.#audio?.pause();
  }

  get states() {
    return Object.keys(this.#manifest?.states || {});
  }

  play(state) {
    if (!this.#manifest) return Promise.resolve(false);
    // 与单击换姿态一致，播完后把自动姿态循环重新武装起来。少了这一步，在游荡途中
    // 调用 play() 会打断位移却没人再排程，宠物就永久停在这个姿态不动了。
    return this.#play(state, { thenIdle: this.#manifest.states[state]?.once === true })
      .then(() => { this.#scheduleAfterPose(state); return true; });
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
    // shadow DOM 里的监听跟着元素走，不会泄漏到外面，但重新挂载会叠加，绑一次即可。
    if (this.#bound) return;
    this.#bound = true;
    this.#stage.addEventListener('pointerdown', (event) => this.#dragStart(event));
    this.#stage.addEventListener('pointermove', (event) => this.#dragMove(event));
    this.#stage.addEventListener('pointerup', (event) => this.#dragEnd(event));
    this.#stage.addEventListener('pointercancel', (event) => this.#dragEnd(event));
    this.#stage.addEventListener('click', () => this.#singleClick());
    this.#stage.addEventListener('dblclick', (event) => this.#doubleClick(event));
    this.#stage.addEventListener('pointerenter', () => this.#showHintOnce(), { once: true });
    this.#stage.addEventListener('focus', () => this.#showHintOnce(), { once: true });
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
    // x 是舞台中心，而不是左边缘。姿态画布宽度不同，中心仍应保持不变。
    this.#x = Math.max(8, innerWidth - (mobile ? 85 : 138));
    this.#y = Math.max(8, innerHeight - (mobile ? 10 : 18));
    this.#applyPosition();
  }

  #baseSize() {
    const requested = Number(this.getAttribute('size'));
    return requested > 0 ? requested : (innerWidth < 700 ? 80 : 130);
  }

  #pickAutoPose() {
    if ((this.#state === 'sleep' || this.#state === 'sleep2')
      && this.#manifest.states.stretch && Math.random() < 0.8) {
      return 'stretch';
    }
    const allowMovement = innerWidth >= 700;
    const available = AUTO_POSE_WEIGHTS.filter(([state]) => {
      // climb 也是位移姿态（爬升 + 自由落体），移动端一并排除，
      // 与 README 承诺的“移动端不游荡，仅静止姿态”保持一致。
      if (!allowMovement && (state === 'walk' || state === 'run' || state === 'climb')) return false;
      if (!this.#manifest.states[state]) return false;
      return state !== 'climb' || this.#manifest.states.fall;
    });
    const total = available.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = Math.random() * total;
    for (const [state, weight] of available) {
      roll -= weight;
      if (roll < 0) return state;
    }
    return 'idle';
  }

  #showFrame(state, index) {
    const config = this.#manifest.states[state];
    const frame = config.frames[index] || config.frames[0];
    const base = this.#baseSize();
    const scale = Number(config.displayScale || 1) * Number(config.runtimeScale || 1);
    let height = frame.heightScale * base * scale;
    let width = height * (frame.width / frame.height);
    // Keep DeskPet's desktop-window fit rule: broad poses such as lie are
    // capped to 1.7x base width, while nuzzle/play may use the full width.
    const fullWidth = this.#manifest.fullWidthStates?.includes(state);
    const fullHeight = this.#manifest.fullHeightStates?.includes(state);
    // DeskPet 的“全宽”是宠物窗口约 1.9 倍基准尺寸，不是浏览器整个视口宽度。
    // WebPet 没有独立窗口，因此用同样的窗口宽度上限，避免 nuzzle 卖萌放大到异常。
    // 该上限只对横向宽的画布有意义：帧画布多为正方形，画布宽度跟着 heightScale
    // 一起涨，对 climb/stretch 这类高姿态套用会把整只宠物按比例压小（climb 曾被
    // 压到 0.94）。竖向或正方形画布只保留视口溢出保护。
    const windowCap = fullWidth ? Math.round(base * 1.9) - 4 : Math.round(base * 1.7) - 4;
    const maxWidth = frame.width > frame.height
      ? Math.min(innerWidth - 4, windowCap)
      : innerWidth - 4;
    const maxHeight = innerHeight - (fullHeight ? 4 : 34);
    const fit = Math.min(1, maxWidth / width, maxHeight / height);
    width *= fit;
    height *= fit;
    this.#stage.style.width = `${Math.round(width)}px`;
    this.#stage.style.height = `${Math.round(height)}px`;
    // 地面基线对齐：舞台底边就是地面，但素材主体未必贴着画布底边（loaf 留白 3.7%、
    // watch 2.4%），直接摆就会浮空。把画布往下压掉这段留白，各姿态的脚才落在同一
    // 条线上。老 manifest 没有 groundPad 时退化成原来的行为。
    this.#stage.style.bottom = `${-Math.round((frame.groundPad || 0) * height)}px`;
    this.#sprite.src = new URL(frame.src, COMPONENT_URL);
    this.#sprite.alt = `雪爪桌宠：${state}`;
    // 姿态切换只替换舞台尺寸，不重新校正宿主位置；否则非移动姿态会
    // 因透明画布宽高变化被误判为需要平移。边界校正只在 resize/拖拽时进行。
  }

  async #play(state, { thenIdle = false } = {}) {
    if (!this.#manifest?.states[state]) state = 'idle';
    const generation = ++this.#playGeneration;
    this.#clearPlayback();
    // 位移必须跟着姿态一起换。#wander / #climb 的 rAF 循环和抛掷链都独立于姿态
    // 运行，只换帧不停它们，就会出现"已经是农民揣了还在平移"。必须在 await 之前
    // 同步停掉：#climb 紧接着 #play('fall') 就启动下落循环，放到 await 之后会把
    // 它自己刚建立的循环一起掐死。
    this.#stopMotion();
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

  #scheduleAfterPose(state) {
    // 停留时长优先用 DURATIONS（与桌面端对齐）；表里没有的姿态退回一轮动画长度。
    // 多帧姿态在这段时间里会一直循环，不再播一遍就走。
    const cycleMs = DURATIONS[state]
      ? Math.round(rand(DURATIONS[state]))
      : Number(this.#manifest.states[state]?.cycleMs || 0);
    if (cycleMs <= 0) {
      this.#schedule();
      return;
    }
    clearTimeout(this.#scheduler);
    this.#scheduler = setTimeout(() => {
      // 姿态已被别处换掉时不再强行回 idle，但**必须**重新排程：
      // 整个组件只有 #schedule() 能重新武装定时器，这里直接 return
      // 会让自动姿态循环永久停摆，宠物卡在当前姿态不动。
      if (this.#state !== state) { this.#schedule(); return; }
      this.#play('idle');
      this.#schedule();
    }, cycleMs);
  }

  #schedule() {
    clearTimeout(this.#scheduler);
    if (this.#motionQuery.matches || this.hasAttribute('paused') || !this.isConnected) return;
    this.#scheduler = setTimeout(async () => {
      const state = this.#pickAutoPose();
      if (state === 'walk' || state === 'run') {
        if (await this.#wander(state)) this.#schedule();
        return;
      }
      if (state === 'climb') {
        if (await this.#climb()) this.#schedule();
        return;
      }
      await this.#play(state);
      this.#scheduleAfterPose(state);
    // 动作结束后只保留 1–3 秒 idle 过渡，避免站立状态停留过久。
    }, 1000 + Math.random() * 2000);
  }

  // 同 #wander：返回 true 表示正常爬完落地，false 表示中途被打断。
  async #climb() {
    if (this.#drag || !this.#manifest.states.fall) return false;
    const baseY = this.#y;
    // deskpet: 高度 min(340, 45% 视口高)
    const climbDist = Math.min(340, Math.round(innerHeight * 0.45));
    // 中断时把宠物放回起跳基线：baseY 是局部变量，函数一返回就丢，
    // 半空中断会让宠物永久悬在那儿。拖拽中位置由用户接管，不要抢。
    const abort = () => {
      if (!this.#drag && this.#y !== baseY) {
        this.#y = baseY;
        this.#applyPosition();
        this.#play('idle');
      }
    };
    await this.#play('climb');
    let generation = this.#playGeneration;
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
    // 被换姿态打断时不要 abort()：位置该由新姿态接管，硬拉回起跳基线会看到瞬移。
    if (generation !== this.#playGeneration) return false;
    if (this.hasAttribute('paused') || this.#drag) { abort(); return false; }
    // deskpet: hang 600ms 悬停
    await new Promise((r) => setTimeout(r, 600));
    if (generation !== this.#playGeneration) return false;
    if (this.hasAttribute('paused') || this.#drag) { abort(); return false; }
    // 下落：deskpet 自由落体加速 v=4 初速, 每帧 v=min(28, v+2)
    // 顶部已保证 fall 存在。这是本函数自己换的姿态，要把基准 generation 一起更新，
    // 否则下面的打断判定会把自己误判成被打断。
    this.#play('fall');
    generation = this.#playGeneration;
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
    if (generation !== this.#playGeneration) return false;
    if (this.hasAttribute('paused') || this.#drag) { abort(); return false; }
    // 落地缓冲
    await this.#land();
    return true;
  }

  // 返回 true 表示正常走完，false 表示中途被打断（换姿态 / 暂停 / 拖拽）。
  // 打断时调用方不要再排程：打断者自己会排（#scheduleAfterPose），重复排会把
  // 刚选的姿态提前换走。
  async #wander(state) {
    const config = this.#manifest.states[state];
    if (!config || this.#drag) return false;
    await this.#play(state);
    const generation = this.#playGeneration;
    const width = this.#stage.offsetWidth || 180;
    const pickTarget = () => 12 + width / 2
      + Math.random() * Math.max(1, innerWidth - width - 24);
    // 目标点必须离得够远，否则走两步就到了、立刻换姿态。同 deskpet：重抽最多 8 次，
    // 仍然太近就说明视口里没地方可走，放弃游荡改成 idle。
    const minDist = MIN_WANDER_DIST[state] || 0;
    let target = this.#x;
    for (let i = 0; i < 8 && Math.abs(target - this.#x) < minDist; i++) target = pickTarget();
    if (Math.abs(target - this.#x) < minDist) {
      await this.#play('idle');
      return true;
    }
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
    // 姿态已被换掉：位移刚才已由 #play → #stopMotion 停下，这里不能再回 idle，
    // 否则会把用户点出来的姿态覆盖掉。
    if (generation !== this.#playGeneration) return false;
    if (this.hasAttribute('paused')) return false;
    await this.#play('idle');
    return true;
  }

  #singleClick() {
    if (this.#suppressClick) { this.#suppressClick = false; return; }
    clearTimeout(this.#clickTimer);
    this.#clickTimer = setTimeout(() => {
      const states = ['idle', 'walk', 'run', 'lie', 'loaf', 'groom', 'sleep2', 'sleep', 'stretch', 'play', 'watch', 'climb'];
      const next = states[(states.indexOf(this.#state) + 1) % states.length];
      if (next === 'climb') this.#climb().then((done) => { if (done) this.#schedule(); });
      else if (next === 'walk' || next === 'run') this.#wander(next).then((done) => { if (done) this.#schedule(); });
      else this.#play(next).then(() => this.#scheduleAfterPose(next));
    }, 260);
  }

  #doubleClick(event) {
    event.preventDefault();
    clearTimeout(this.#clickTimer);
    if (this.#audio) {
      this.#audio.currentTime = 0;
      this.#audio.play().catch(() => {});
    }
    this.#play('nuzzle').then(() => this.#scheduleAfterPose('nuzzle'));
  }

  #dragStart(event) {
    if (event.button !== 0) return;
    // 拖拽接管位置，一切自动位移都要让位。抛飞途中重新抓住尤其要停物理链：
    // 否则 #runThrow 与 #dragMove 同时写 #x/#y（宠物在手里抖），松手时
    // #startThrow 换上新的 #throw 后旧链还活着，两条链读同一个对象、每 24ms
    // 叠加两次重力，连抛就越抛越快。
    this.#stopMotion();
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
    if (nx - width / 2 <= 4 || nx + width / 2 >= innerWidth - 4) {
      nx = Math.max(4 + width / 2, Math.min(innerWidth - width / 2 - 4, nx));
      b.vx *= -0.55;
    }
    if (ny >= floor) {
      ny = floor;
      if (Math.abs(b.vy) > 0.65) {
        b.vy *= -0.32;
      } else {
        // 落地：显示 fall[1] 缓冲帧 + react 700ms
        this.#x = nx; this.#y = ny; this.#applyPosition();
        this.#stopThrow();
        this.#land();
        return;
      }
    }
    this.#x = nx; this.#y = ny; this.#applyPosition();
    if (performance.now() > b.until) { this.#stopThrow(); this.#land(); return; }
    this.#throwTimer = setTimeout(() => this.#runThrow(), dt);
  }

  // 停掉一切正在改写 #x/#y 的东西：游荡/爬墙的 rAF 循环 + 抛掷的 setTimeout 链。
  // 一并 resolve 挂起的移动 Promise，否则 #wander / #climb 会永远停在 await 上，
  // 它们的调用方再也等不到返回值。
  #stopMotion() {
    cancelAnimationFrame(this.#moveRaf);
    this.#moveRaf = 0;
    this.#moveResolve?.();
    this.#moveResolve = null;
    this.#stopThrow();
  }

  #stopThrow() {
    clearTimeout(this.#throwTimer);
    this.#throwTimer = 0;
    this.#throw = null;
  }

  // deskpet: 落地缓冲，显示 fall[1] 700ms 后回 idle
  async #land() {
    if (this.#manifest.states.fall?.frames[1]) {
      this.#state = 'react';
      this.setAttribute('state', 'react');
      this.#showFrame('fall', 1);
      await new Promise((r) => setTimeout(r, 700));
    }
    // isConnected：元素已被移除时不要再把整个自动姿态循环重新武装起来。
    if (this.hasAttribute('paused') || this.#drag || !this.isConnected) return;
    await this.#play('idle');
    this.#schedule();
  }

  #clampPosition() {
    const width = this.#stage.offsetWidth || 120;
    const height = this.#stage.offsetHeight || 100;
    this.#x = Math.min(Math.max(4 + width / 2, this.#x),
      Math.max(4 + width / 2, innerWidth - width / 2 - 4));
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
    this.#stopMotion();
    clearTimeout(this.#scheduler);
    clearTimeout(this.#clickTimer);
  }
}

if (!customElements.get('web-pet')) customElements.define('web-pet', WebPet);

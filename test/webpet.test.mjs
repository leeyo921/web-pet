// web-pet 行为回归测试。
//
// 覆盖的是状态机与生命周期：定时器、监听器、姿态调度、抛掷物理链的启停。
// 这些 bug 的共同点是只在特定时序下出现（正好抛飞的瞬间正好又抓住、元素被移除
// 之后、hold 态刚进入时），手工在浏览器里点很难复现，改坏了也不会立刻看出来。
//
// **测不了什么**：jsdom 没有布局引擎，offsetWidth/offsetHeight 恒为 0，所以
// 一切尺寸相关的行为（#showFrame 的 fit 计算、climb/stretch 被压小那类问题）
// 这里完全看不见，仍然只能在真浏览器里截图核对。
//
// 跑法：npm i && npm test
// 想确认某条用例是否真有判别力，可以把旧版 webpet.js 放进一个目录，
// 用 WEBPET_DIR=/path/to/old npm test 对着旧代码跑，该红的必须红。

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PKG = process.env.WEBPET_DIR
  ? fileURLToPath(new URL(`file://${process.env.WEBPET_DIR}/`))
  : fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${PKG}manifest.json`, 'utf8'));

const dom = new JSDOM('<!doctype html><body></body>', {
  pretendToBeVisual: true,          // 提供 requestAnimationFrame
  url: 'https://web-pet.test/',     // opaque origin 下 sessionStorage 不可用
});
const { window } = dom;

// 统计 window / document 上的监听器增减，用来验证 disconnectedCallback 真的解绑。
const winListeners = new Map();
const docListeners = new Map();
function countingListeners(target, tally) {
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (t, f, o) => { tally.set(t, (tally.get(t) || 0) + 1); add(t, f, o); };
  target.removeEventListener = (t, f, o) => { tally.set(t, (tally.get(t) || 0) - 1); remove(t, f, o); };
}
countingListeners(window, winListeners);
countingListeners(window.document, docListeners);

// jsdom 不会真的加载 file:// 下的图片和音频，全部打桩。
class FakeImage {
  set src(v) { this._src = v; queueMicrotask(() => this.onload?.()); }
  get src() { return this._src; }
}
class FakeAudio {
  constructor(src) { this.src = src; }
  play() { return Promise.resolve(); }
  pause() {}
}
window.fetch = async () => ({ ok: true, status: 200, json: async () => structuredClone(manifest) });
window.Image = FakeImage;
window.Audio = FakeAudio;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.Element.prototype.setPointerCapture = function () {};
window.Element.prototype.releasePointerCapture = function () {};
const setViewport = (w, h) => {
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, 'innerWidth', { value: w, writable: true, configurable: true });
    Object.defineProperty(target, 'innerHeight', { value: h, writable: true, configurable: true });
  }
};
setViewport(1440, 900);

// 注意：不要把 jsdom 的 performance 复制到 globalThis —— 它的 IDL 包装会自我
// 递归直接爆栈。Node 自带的 performance 完全够用。
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event',
  'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'Image', 'Audio', 'fetch',
  'sessionStorage', 'Element', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { value: window[key], writable: true, configurable: true });
}
globalThis.addEventListener = window.addEventListener;
globalThis.removeEventListener = window.removeEventListener;

await import(`file://${PKG}webpet.js`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pos = (el) => el.style.transform;
const state = (el) => el.getAttribute('state');
const listeners = () => `resize=${winListeners.get('resize')} visibilitychange=${docListeners.get('visibilitychange')}`;

// 轮询等待某个姿态出现。不要用固定 sleep 卡时间点：姿态时长依赖 manifest 的
// cycleMs/holdMs，用例之间又会互相影响起始状态，写死时间会让用例变得脆弱、
// 甚至在旧版本上因为跑到别的分支而"空过"。
async function waitForState(el, want, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (state(el) === want) return true;
    await sleep(100);
  }
  return false;
}

function pointer(el, type, props) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, button: 0, ...props });
  el.shadowRoot.querySelector('.stage').dispatchEvent(event);
}

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// ---------------------------------------------------------------- 挂载
const pet = window.document.createElement('web-pet');
window.document.body.append(pet);
await new Promise((r) => pet.addEventListener('webpet-ready', r, { once: true }));
check('初始化完成并进入 idle', state(pet) === 'idle', `state=${state(pet)}`);
check('window/document 监听各挂一份',
  winListeners.get('resize') === 1 && docListeners.get('visibilitychange') === 1, listeners());

// ---------------------------------------------------------------- 抛掷物理链
// 从屏幕中间往左上甩。jsdom 没有布局，宠物初始贴在右下边界，在那儿起抛会立刻
// 撞墙加落地，观察不到飞行。
function throwFromCenter() {
  pointer(pet, 'pointerdown', { clientX: 700, clientY: 450 });
  for (let i = 0; i <= 5; i++) {
    pointer(pet, 'pointermove', { clientX: 700 - i * 20, clientY: 450 - i * 20 });
  }
  pointer(pet, 'pointerup', { clientX: 600, clientY: 350 });
}

throwFromCenter();
await sleep(80);
const flying = pos(pet);
await sleep(80);
check('抛掷正在飞行', pos(pet) !== flying, `${flying} -> ${pos(pet)}`);

// 飞行途中重新抓住：物理链必须停，否则 #runThrow 与 #dragMove 同时写 #x/#y，
// 宠物会从手里飞走；松手时还会叠出第二条链，重力算两遍。
pointer(pet, 'pointerdown', { clientX: 620, clientY: 300 });
const grabbed = pos(pet);
await sleep(300);
check('抓住后物理链停止（位置不再被抛掷改写）', pos(pet) === grabbed, `${grabbed} -> ${pos(pet)}`);
pointer(pet, 'pointerup', { clientX: 620, clientY: 300 });
await sleep(50);

throwFromCenter();
await sleep(80);
const midFlight = pos(pet);
pet.pause();
await sleep(300);
check('暂停后抛掷链停止', pos(pet) === midFlight, `${midFlight} -> ${pos(pet)}`);
pet.resume();
await sleep(50);

// ---------------------------------------------------------------- 位移与姿态的配合
// 走路是 #wander 里的 rAF 循环在推 #x，换姿态走的是 #play，两者本来毫无联动，
// 所以走路途中切到静止姿态后位移还在继续（"已经是农民揣了还在平移"）。
// 放在这里是因为 resume() 刚把宠物送回 idle 并重新武装了调度器，起点干净。
// 这里**不打桩 Math.random**：#wander 靠它抽游荡目标，固定值会让每次都抽到同一
// 个坐标，走到之后距离恒为 0、永远触发 minDist 回退，测出来的是打桩的退化而不是
// 产品行为。改用单击进入 walk（点击循环 idle→walk→run→lie→…）。
const realRandom = Math.random;
const xOf = (el) => Number(pos(el).match(/translate3d\((-?\d+)px/)[1]);
// 点击后要轮询着等，不能固定 sleep 一次就采样：idle 过渡只有 0.2–0.5 秒，自动
// 调度器会在两次点击之间插进新姿态，固定采样很容易正好错过目标姿态。
async function clickUntil(want, tries = 14) {
  for (let i = 0; i < tries; i++) {
    if (state(pet) === want) return true;
    pointer(pet, 'click', {});   // 第一次可能被 #suppressClick 吞掉，多点几次
    const deadline = Date.now() + 600;   // 含单击 260ms 防抖
    while (Date.now() < deadline) {
      if (state(pet) === want) return true;
      await sleep(20);
    }
  }
  return state(pet) === want;
}

check('单击可以进入 walk', await clickUntil('walk'), `state=${state(pet)}`);
const walkFrom = pos(pet);
await sleep(250);
check('走路时确实在平移', pos(pet) !== walkFrom, `${walkFrom} -> ${pos(pet)}`);

// 连点穿过位移姿态：旧的 rAF 循环会各自 re-arm，落到静止姿态后必须一个都不剩。
let clicks = 0;
while (['walk', 'run'].includes(state(pet)) && clicks < 6) {
  pointer(pet, 'click', {});
  await sleep(400);
  clicks += 1;
}
const settled = state(pet);
const settledAt = pos(pet);
await sleep(400);
check('连点穿过 walk/run 落到静止姿态后不再平移',
  !['walk', 'run'].includes(settled) && pos(pet) === settledAt,
  `--${clicks}击--> ${settled}，${settledAt} -> ${pos(pet)}`);

// 一趟游荡至少走满 MIN_WANDER_DIST（walk 60px），否则就是"刚走两步就切换"。
// 用真随机测不出来：碰巧抽到远目标就过了。这里给一个确定性的抽签序列——前两次
// 都落在脚边，第三次才够远。修复前只抽一次，直接走 0 步就换姿态；修复后会重抽。
// jsdom 里 stage.offsetWidth 恒为 0，#wander 走 180 的回退值，于是
// target = 12 + 180/2 + r * (1440 - 180 - 24) = 102 + r * 1236。
const TARGET_BASE = 102;
const TARGET_SPAN = 1236;
const rFor = (targetX) => (targetX - TARGET_BASE) / TARGET_SPAN;
await pet.play('idle');
await sleep(150);
const originX = xOf(pet);
const farX = originX < 700 ? originX + 420 : originX - 420;
const rNear = rFor(originX);
const rFar = rFor(farX);
if (rNear < 0 || rNear > 1 || rFar < 0 || rFar > 1) {
  check('一趟 walk 要么走满 60px 要么不走', false, `用例前置条件不成立：x=${originX}`);
} else {
  let draws = 0;
  Math.random = () => (draws++ < 2 ? rNear : rFar);
  const gotWalk = await clickUntil('walk', 4);
  const startX = xOf(pet);
  const deadline = Date.now() + 25000;
  while (state(pet) === 'walk' && Date.now() < deadline) await sleep(80);
  const walked = Math.abs(xOf(pet) - startX);
  Math.random = realRandom;
  check('一趟 walk 要么走满 60px 要么不走', walked === 0 || walked >= 60,
    `抽签 ${draws} 次，走了 ${walked}px${gotWalk ? '' : '（未进入 walk）'}`);
}

// 点击游标：walk 最短 0.72 秒就走完并自动回到 idle。手速稍慢，下一次点击看到的就是
// idle，若从 idle 推进就又会选中 walk —— 永远在 walk↔idle 之间打转，点不到后面的姿态。
// 点击游标：走完/爬完都会自动回到 idle 过渡态，此时再点击必须沿着循环往下推进，
// 而不是从头开始（旧版从 idle 推进永远得到 walk，于是卡在 walk↔idle 之间打转）。
//
// Math.random 打桩成 1：过渡取满 0.5s，且 #pickAutoPose 的 roll 会耗尽所有权重、
// 落回 idle —— 宠物就一直停在过渡态，自动调度器不会插进来打乱游标，用例才确定。
// 用 lie / loaf / groom 这几个长姿态，避开 walk 的最短距离回退带来的不确定性。
Math.random = () => 1;
await pet.play('lie');
await sleep(200);
pointer(pet, 'click', {});
await sleep(500);
const afterFirst = state(pet);
await pet.play('idle');
await sleep(200);
pointer(pet, 'click', {});
await sleep(500);
const afterSecond = state(pet);
Math.random = realRandom;
check('回到过渡态后再点击按游标推进，而不是从头开始',
  afterFirst === 'loaf' && afterSecond === 'groom',
  `lie --点击--> ${afterFirst} --(回 idle 后)点击--> ${afterSecond}，期望 loaf / groom`);

// 真实浏览器里一次点击是 pointerdown → pointerup → click，前两个会走
// #dragStart / #dragEnd。只派发 click 会漏掉这条路径上的 bug。
function realClick(x = 700, y = 450) {
  pointer(pet, 'pointerdown', { clientX: x, clientY: y });
  pointer(pet, 'pointerup', { clientX: x, clientY: y });
  pointer(pet, 'click', {});
}

// 按下会中止游荡。若此时立刻重新排程，过渡最短 200ms 比单击 260ms 的防抖还短，
// 自动调度就会抢在点击生效之前插进一个随机姿态，把点击游标带偏 —— 表现为
// 单击切到跑步，两百毫秒后变成别的姿态，像是"跑步姿态丢了"。
// Math.random 打桩成 0：过渡取最短 200ms，必定早于 240ms 的观察窗。
check('再次进入 walk（真实指针序列）', await clickUntil('walk'), `state=${state(pet)}`);
Math.random = () => 0;
const inserted = [];
const recorder = (e) => inserted.push(`${e.detail.state}@${Date.now() - clickAt}ms`);
pet.addEventListener('webpet-statechange', recorder);
const clickAt = Date.now();
realClick();
await sleep(240);
pet.removeEventListener('webpet-statechange', recorder);
Math.random = realRandom;
check('按下到点击生效之间不会被自动调度插队',
  inserted.filter((s) => !s.startsWith('idle@')).length === 0,
  `插入了 ${inserted.join(' ') || '无'}`);

// 6px 阈值必须同时管住位置：只管状态的话，按下时几像素的手抖会让宠物平移，
// 姿态却还停在舔毛、睡觉上。
await pet.play('lie');
await sleep(250);
const beforeJitter = pos(pet);
pointer(pet, 'pointerdown', { clientX: 700, clientY: 450 });
pointer(pet, 'pointermove', { clientX: 703, clientY: 451 });
pointer(pet, 'pointerup', { clientX: 703, clientY: 451 });
await sleep(150);
check('按下时 6px 内的抖动不会挪动宠物',
  pos(pet) === beforeJitter, `${beforeJitter} -> ${pos(pet)}`);

// 走路途中切到静止姿态：位移必须立刻停，姿态也不能被 #wander 覆盖回 idle。
check('第三次进入 walk', await clickUntil('walk'), `state=${state(pet)}`);
await sleep(250);
await pet.play('loaf');
const loafAt = pos(pet);
await sleep(400);
check('切到农民揣后停止平移', pos(pet) === loafAt, `${loafAt} -> ${pos(pet)}`);
check('农民揣没有被 #wander 覆盖回 idle', state(pet) === 'loaf', `state=${state(pet)}`);

// 被打断后自动循环必须还活着，否则宠物就永久卡在这个姿态。
// loaf 现在是 8–20 秒（对齐桌面端），加上 1–3 秒过渡，给 30 秒预算。
const loopAlive = await (async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (state(pet) !== 'loaf') return true;
    await sleep(200);
  }
  return false;
})();
check('打断后自动姿态循环仍在运转', loopAlive, `state=${state(pet)}`);


// ---------------------------------------------------------------- hold 态停留时长
// hold 态没有 cycleMs，靠 holdMs / HOLD_DURATIONS 决定停留多久；缺了就会被
// 调度器的 1–3 秒过渡直接换走，睡觉的 zzz 一轮 2.8s 都放不完。
Math.random = () => 0.65;   // 落在 sleep 权重区间 58.8–70.4
check('自动姿态抽到 sleep', await waitForState(pet, 'sleep', 20000), `state=${state(pet)}`);
// 不要在固定时间点采样：旧版 9 秒到期回 idle 后 2.3 秒又会抽回 sleep，采样点很容易
// 撞上"还在 sleep"而误判为通过。直接量一次连续停留时长。
const sleepStart = Date.now();
while (state(pet) === 'sleep' && Date.now() - sleepStart < 60000) await sleep(200);
const slept = Date.now() - sleepStart;
const wokeTo = state(pet);
check('sleep 连续停留 20 秒以上（桌面端 20–45s）', slept >= 20000, `实测 ${(slept / 1000).toFixed(1)}s`);
// 睡醒 80% 直接接伸懒腰，且不经过 idle 过渡。这段判断以前写在 #pickAutoPose 里，
// 而抽签发生在过渡之后、#state 早已是 idle，条件永远不成立（死代码）。
// Math.random 此处被打桩成 0.65 < 0.8，所以必定命中。
check('睡醒直接接伸懒腰（不经过 idle）', wokeTo === 'stretch', `sleep -> ${wokeTo}`);

// idle 只是动作之间的过渡，压到 0.2–0.5 秒。桌面端是 1–3 秒，网页版刻意偏离。
Math.random = realRandom;
const bridges = [];
for (let i = 0; i < 6 && bridges.length < 3; i++) {
  if (!(await waitForState(pet, 'idle', 30000))) break;
  const from = Date.now();
  while (state(pet) === 'idle' && Date.now() - from < 5000) await sleep(20);
  const held = Date.now() - from;
  if (held < 5000) bridges.push(held);
}
check('idle 过渡不超过 0.5 秒',
  bridges.length > 0 && bridges.every((ms) => ms <= 700),
  `实测 ${bridges.map((m) => `${m}ms`).join(' / ') || '(没抓到)'}（含 20ms 轮询误差）`);
Math.random = realRandom;

// ---------------------------------------------------------------- 生命周期
pet.remove();
await sleep(50);
check('卸载后 window/document 监听归零',
  winListeners.get('resize') === 0 && docListeners.get('visibilitychange') === 0, listeners());

window.document.body.append(pet);
await sleep(50);
check('重挂载后监听仍是各一份',
  winListeners.get('resize') === 1 && docListeners.get('visibilitychange') === 1, listeners());
const afterRemount = state(pet);
await sleep(4000);
check('重挂载后自动姿态循环恢复', state(pet) !== null, `${afterRemount} -> ${state(pet)}`);
pet.remove();

// ---------------------------------------------------------------- 移动端
// walk/run/climb 都是位移姿态，移动端应全部排除（README：移动端不游荡）。
setViewport(400, 800);
const mobile = window.document.createElement('web-pet');
window.document.body.append(mobile);
await new Promise((r) => mobile.addEventListener('webpet-ready', r, { once: true }));
const seen = new Set();
mobile.addEventListener('webpet-statechange', (e) => seen.add(e.detail.state));
// walk/run 过滤后剩余权重合计 85，climb 占开头的 0–9；r=0.05 → roll=4.25，
// 只要 climb 没被排除就必定抽中它。
Math.random = () => 0.05;
await sleep(6000);
Math.random = realRandom;
const moving = [...seen].filter((s) => ['walk', 'run', 'climb'].includes(s));
check('移动端未出现 walk/run/climb', moving.length === 0, `实际出现: ${[...seen].join(',') || '(无)'}`);
mobile.remove();

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} 通过`);
process.exit(passed === results.length ? 0 : 1);

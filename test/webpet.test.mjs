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
const realRandom = Math.random;
Math.random = () => 0.02;   // 自动抽签落在 walk 权重区间 0–9
check('自动姿态抽到 walk', await waitForState(pet, 'walk', 8000), `state=${state(pet)}`);
const walkFrom = pos(pet);
await sleep(200);
check('走路时确实在平移', pos(pet) !== walkFrom, `${walkFrom} -> ${pos(pet)}`);

await pet.play('loaf');
const loafAt = pos(pet);
await sleep(400);
check('切到农民揣后停止平移', pos(pet) === loafAt, `${loafAt} -> ${pos(pet)}`);
check('农民揣没有被 #wander 覆盖回 idle', state(pet) === 'loaf', `state=${state(pet)}`);

// 被打断后自动循环必须还活着，否则宠物就永久卡在这个姿态了。
check('打断后自动姿态循环仍在运转',
  await waitForState(pet, 'walk', 12000), `12s 内是否回到 walk：state=${state(pet)}`);

// 连续点击穿过多个位移姿态：旧的 rAF 循环会各自 re-arm，必须只剩一个在跑。
const entered = state(pet);
// 单击循环是 idle→walk→run→lie→…，点到落进静止姿态为止。次数不写死：
// #suppressClick 可能被前面的拖拽用例置位，第一次点击会被吞掉。
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
  entered === 'walk' && !['walk', 'run'].includes(settled) && pos(pet) === settledAt,
  `${entered} --${clicks}击--> ${settled}，${settledAt} -> ${pos(pet)}`);
Math.random = realRandom;

// ---------------------------------------------------------------- hold 态停留时长
// hold 态没有 cycleMs，靠 holdMs / HOLD_DURATIONS 决定停留多久；缺了就会被
// 调度器的 1–3 秒过渡直接换走，睡觉的 zzz 一轮 2.8s 都放不完。
Math.random = () => 0.65;   // 落在 sleep 权重区间 58.8–70.4
check('自动姿态抽到 sleep', await waitForState(pet, 'sleep', 12000), `state=${state(pet)}`);
await sleep(5000);
check('sleep 停留超过 5 秒', state(pet) === 'sleep', `5s 后 state=${state(pet)}`);
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

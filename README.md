# web-pet

浏览器桌宠组件。序列帧动画 + 自发行为 + 可拖拽，原生 Web Component，零依赖。

## 特性

- `<web-pet>` 自定义元素，Shadow DOM 自封装，即插即用
- 13 种姿态：待机、走路、跑步、趴卧、农民揣、睡觉、理毛、伸懒腰、攀爬、观望、卖萌、摔落
- 自发行为：随机游荡、爬墙、摔落、姿态切换
- 交互：单击切姿态、双击卖萌+咕噜声、拖拽移动
- 响应式：移动端不游荡，仅静止姿态
- 无障碍：尊重 `prefers-reduced-motion`

## 使用

把整个目录放到网站的静态资源路径下，然后：

```html
<web-pet></web-pet>
<script type="module" src="/path/to/webpet/webpet.js"></script>
```

资源路径由 `import.meta.url` 自动解析，`webpet.js` 与 `manifest.json`、`assets/` 必须在同一目录。

### 在 Next.js / React 中使用

```tsx
'use client'
import { useEffect } from 'react'

export function WebPet({ paused }: { paused?: boolean }) {
  useEffect(() => {
    if (!customElements.get('web-pet')) {
      const s = document.createElement('script')
      s.type = 'module'
      s.src = '/webpet/webpet.js'
      document.head.appendChild(s)
    }
  }, [])
  return <web-pet paused={paused || undefined} />
}
```

### 属性

| 属性 | 说明 |
|------|------|
| `paused` | 暂停并隐藏宠物 |
| `size` | 基准尺寸（px），默认桌面 130、移动 80 |
| `home-x` | 初始横向落点（**仅 ≥700px**），百分比（`"56%"`，相对视口宽）或像素（`"420"`）。默认右下角 |
| `home-y` | 初始纵向落点，同上。这是**姿态底边的基线**，也就是宠物脚踩的那条线 |
| `home-x-mobile` | 移动端（<700px）的横向落点。不写则用底部默认落点 |
| `home-y-mobile` | 移动端的纵向落点，同上 |

**移动端只认 `-mobile` 那一对，桌面的 `home-x` / `home-y` 在窄屏一律忽略。** 两端版式
差异大，桌面上挑好的落点搬到窄屏往往正好压住正文。组件在 700px 处已经分了尺寸与
行为（移动端不游荡），落点沿用同一条分界。

这几个属性只决定**初始**落点：之后宠物照样会自己游荡、爬墙，也能被拖走。写错格式
回退到默认落点，宿主页面改坏了不至于把宠物摆到视口外面。

### 事件

| 事件 | 说明 |
|------|------|
| `webpet-ready` | 加载完成 |
| `webpet-statechange` | 姿态切换 |

## 集成方式

作为 git submodule 引入：

```bash
git submodule add https://github.com/leeyo921/web-pet.git public/webpet
```

宿主更新到新版本后，记得同步 `<script src>` 上的 `?v=` 查询串，否则浏览器会继续用
缓存里的旧 `webpet.js`。

## 开发

运行时零依赖；jsdom 只是测试用的 devDependency。

```bash
npm install
npm test
```

`test/webpet.test.mjs` 覆盖状态机与生命周期：抛掷物理链能否被拖拽/暂停/卸载中断、
window 监听器是否解绑、hold 态停留时长、移动端是否排除位移姿态。这些时序 bug 手工
很难复现，改动 `webpet.js` 后务必跑一遍。

jsdom 没有布局引擎（`offsetWidth` 恒为 0），**尺寸相关的行为测不到**——`#showFrame`
的 fit 计算、各姿态视觉大小是否一致，仍然只能在真浏览器里核对。

## 资源

- 146 帧 WebP 透明图（2.88 MB）
- 1 个咕噜声 MP3（42.7 KB）
- manifest.json 记录每帧尺寸与 heightScale

### 素材从哪来

`assets/` 和 `manifest.json` 是生成产物，不要手改——`heightScale`、`areaScale`、
`runtimeScale` 都是按 DeskPet 的姿态元数据和 `pose-visual-policy.json` 算出来的，
手改的数值下次导出就没了。导出脚本在桌宠仓库：

```bash
# 在 deskpet 仓库里
WEBPET_DIR=~/code/pawra-saas/public/webpet node scripts/export-webpet-assets.mjs
```

生成后在本仓库 commit + push，再让各宿主 bump gitlink 并同步 `?v=`。

### 姿态停留时长

在 `webpet.js` 的 `DURATIONS` 里，与桌面端 DeskPet 的 `DURATIONS`（`src/main.js`）
逐项对齐。这是**行为参数不是素材参数**，所以和桌面端一样放代码里，不进 manifest。

| 姿态 | 停留 | | 姿态 | 停留 |
|---|---|---|---|---|
| sleep / sleep2 | 20–45s | | groom | 6.5–12s |
| lie / loaf | 8–20s | | play | 5–9s |
| watch | 6–15s | | stretch | 4s |
| nuzzle | 4.1–4.3s | | **idle（过渡）** | **0.2–0.5s** |

多帧姿态在这段时间里持续循环。`cycleMs` 只决定一轮动画多长，不再兼任停留时长——
早期版本两者混用，等于每个姿态只播一遍就走，睡觉睡 3 秒、理毛只梳一遍。

**idle 过渡是唯一刻意偏离桌面端的参数**（桌面端 `DURATIONS.bridge` 是 1–3 秒）。
桌宠是全天候后台陪伴，动作之间站着缓两秒很自然；网页访客往往只停留几十秒，过渡
占掉的每一秒都是"宠物在发呆"。压到 0.2–0.5 秒后，过渡时间占比从 12.4% 降到 2.3%。

睡醒有 80% 概率直接接伸懒腰（`STRETCH_AFTER_SLEEP`），**不经过过渡态**，与桌面端
一致。这个判断必须放在停留时长到期的那一刻；早期版本写在 `#pickAutoPose` 里，而抽签
发生在过渡之后、`#state` 早已是 idle，条件永远不成立，是死代码。

### 单击循环

`walk → run → lie → loaf → groom → sleep2 → sleep → stretch → play → watch → climb`
（11 个真姿态，**不含 idle**）。组件记一个游标：当前是真姿态就从它往下推进，处于
过渡态（idle / drag / react / fall）时从上次点选的位置继续。

两点都不能省。idle 不在循环里，是因为它只停留 0.2–0.5 秒，点到它眨眼就被自动调度器
抽走，下一次点击又从那个随机姿态重新对齐，循环被打乱。游标不能省，是因为 walk 最短
0.72 秒就走完并自动回到 idle，手速稍慢时下一次点击看到的就是过渡态——若从过渡态
从头推进，就永远在 walk↔idle 之间打转。

### 游荡距离

`MIN_WANDER_DIST`：walk 至少 60px、run 至少 200px，同 DeskPet。目标点抽太近就重抽，
抽 8 次仍然太近说明视口里没地方可走，放弃游荡改成 idle。没有这个下限时随机目标
可能就落在脚边，表现为"刚走两步就切换姿态"。

### 地面基线

舞台底边就是地面，但素材主体未必贴着画布底边（loaf 底部留白 3.7%、watch 2.4%），
直接摆会浮空 3px 左右。导出脚本把每帧的底部留白比例写成 `groundPad`，组件按它把
画布往下压，各姿态的脚才落在同一条线上。

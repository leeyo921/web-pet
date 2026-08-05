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

动画姿态用 `cycleMs`（正好放完一轮）决定停留多久。`hold: true` 的静止姿态没有
`cycleMs`，改用 `holdMs`；manifest 不写 `holdMs` 时回退到 `webpet.js` 里的
`HOLD_DURATIONS` 默认值（睡觉 9s、农民揣 6s）。两者都没有的姿态只会停留调度器
的 1–3 秒过渡，对静止姿态来说太短——睡觉的 zzz 动画一轮就要 2.8 秒。

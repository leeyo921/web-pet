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

## 资源

- 146 帧 WebP 透明图（2.88 MB）
- 1 个咕噜声 MP3（42.7 KB）
- manifest.json 记录每帧尺寸与 heightScale

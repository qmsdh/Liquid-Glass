# 🫧 Liquid Glass · 液态玻璃

> 给你的网站加上 iOS 风格的**液态玻璃**：圆角边缘折射背后的内容、RGB 色散、跟手高光、多层内阴影。
> **WebGL 驱动**，不支持时**自动降级**为 CSS/SVG。单文件、零依赖，复制过去就能用。

- ✅ 一个 JS 文件 `liquid-glass.js`，样式自动注入，不用另外引 CSS
- ✅ 给元素加一个 class 就变成玻璃，圆角、大小、数量随意
- ✅ 浏览器不支持 WebGL / 着色器出错 / GPU 上下文丢失 → 自动切到 CSS 降级，不会白屏
- ✅ 支持自定义背景（图片、纯色、自己用 Canvas 画）、拖动玻璃、动态内容（React/Vue 都行）

---

## 目录

1. [3 步快速接入](#1-3-步快速接入)
2. [完整最小示例（可直接复制）](#2-完整最小示例可直接复制)
3. [它是怎么工作的（通俗版）](#3-它是怎么工作的通俗版)
4. [配置项](#4-配置项)
5. [HTML / CSS 约定](#5-html--css-约定)
6. [换背景](#6-换背景)
7. [API](#7-api)
8. [WebGL 与 CSS 降级对照](#8-webgl-与-css-降级对照)
9. [在 React / Vue 里使用](#9-在-react--vue-里使用)
10. [常见问题](#10-常见问题)
11. [已知限制](#11-已知限制)

---

## 1. 3 步快速接入

### 第 1 步：引入 JS

下载 [`liquid-glass.js`](./liquid-glass.js) 放进你的项目，或者直接走 CDN（把用户名和仓库名换成你自己的，建议锁定版本号 tag）：

```html
<script src="https://cdn.jsdelivr.net/gh/qmsdh/Liquid-Glass/liquid-glass.js"></script>
```

> 脚本放在 `</body>` 前面；或者加 `defer`，再在 `DOMContentLoaded` 之后调用。

### 第 2 步：给要变成玻璃的元素加 class

```html
<div class="liquid-glass">我是一块玻璃</div>
<button class="liquid-glass">我也是</button>
```

圆角用 CSS 变量控制（也可以直接写你自己的 `border-radius`）：

```css
.my-button { --lg-radius: 999px; }   /* 胶囊 */
```

### 第 3 步：初始化

```html
<script>
  LiquidGlass.init({ text: 'h1,h2,p' })   // 列出“在玻璃背后、需要被折射”的页面文字
</script>
```

完事。🎉 想要更省事，连这一行 JS 都能省：

```html
<script src="liquid-glass.js" data-auto data-text="h1,h2,p"></script>
```

---

## 2. 完整最小示例（可直接复制）

存成 `index.html`，和 `liquid-glass.js` 放在同一目录，双击打开：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
  body{margin:0;min-height:100vh;color:#fff;font-family:system-ui,"PingFang SC",sans-serif;
       display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:48px 20px}
  .card{padding:28px 36px;max-width:420px;line-height:1.7}
</style>
</head>
<body>
  <h1>Hello, Liquid Glass</h1>
  <div class="liquid-glass card">这是一块液态玻璃，边缘会折射背后的内容。</div>

  <script src="liquid-glass.js"></script>
  <script>LiquidGlass.init({ text: 'h1' })</script>
</body>
</html>
```

仓库里的 [`example.html`](./example.html) 还多了按钮和可拖动的小玻璃。

---

## 3. 它是怎么工作的（通俗版）

真实的玻璃之所以好看，是因为**它会把背后的东西“扭”一下**——边缘最明显。浏览器的 CSS 没法稳定做到这点（`backdrop-filter: url()` 只有 Chromium 认），所以本库换了个思路：

1. **整个页面背景画在一张全屏 `<canvas>` 上**（WebGL），它固定在最底层。
2. **你的页面文字被“拍照”**：库把 DOM 里的文字按真实排版位置逐字画到一张 2D 画布，当作纹理交给显卡。DOM 里的文字变透明，但依然能选中、能被搜索、读屏软件也能读。
3. **玻璃元素本身是透明的“占位框”**：库每帧读一下它们的位置、大小、圆角，告诉着色器“这里有块玻璃”。显卡逐像素计算：边缘折射、三色通道分离、高光、内阴影，画在背景上。
4. 你的 DOM 元素正常叠在 canvas 之上，所以点击、悬停、拖动、滚动都和平时一样。

```
最底层  <canvas>：背景 + 页面文字 + 玻璃（折射/高光/阴影）
上   层  你的 DOM：布局、点击、输入框……（文字在玻璃区域由 canvas 绘制）
```

> 如果 WebGL 不可用，库会改用 **CSS + SVG**：Chromium 用 SVG 位移滤镜做真折射，其它浏览器用毛玻璃（blur）。见 [第 8 节](#8-webgl-与-css-降级对照)。

---

## 4. 配置项

`LiquidGlass.init(options)` 全部可选：

| 选项 | 默认值 | 说明 |
|---|---|---|
| `glass` | `'.liquid-glass'` | 哪些元素变成玻璃（任意 CSS 选择器，可逗号分隔多个） |
| `text` | `''` | **玻璃背后**需要被折射的页面文字，如 `'h1,h2,p,li'`。不写则页面文字不参与折射 |
| `background` | `'blobs'` | 背景。`'blobs'` 默认网格 + 光斑；图片地址；`'#0b1020'` 纯色；`{draw(ctx,w,h){}}` 自己画。详见[第 6 节](#6-换背景) |
| `strength` | `90` | 折射强度（像素），0 ~ 160 比较合适 |
| `mode` | `'lens'` | `'lens'` 折射（最好看）· `'frost'` 磨砂（更省性能）· `'ripple'` 水波 |
| `vignette` | `0.45` | 自定义背景图四角压暗程度，`0` 不压暗 |
| `maxGlass` | `12` | 同屏最多几块玻璃，上限 32 |
| `maxDpr` | `2` | 渲染分辨率上限；设备发烫/掉帧就改成 `1` |
| `liveText` | `false` | 玻璃里/背后的文字有 CSS 动画或过渡时设为 `true`（每帧重绘文字，更费电） |
| `takeOverBackground` | `true` | 把 `html`、`body` 背景设为透明，交给本库绘制 |
| `injectCSS` | `true` | 自动注入样式。设为 `false` 则需要你自己写样式 |
| `forceFallback` | `false` | 调试用：强制走 CSS 降级，看看降级效果 |
| `onPaint` | `null` | 高级：`function(ctx, layer, {dpr})`，往文字层再画点自己的东西 |

`<script data-auto>` 支持的 data 属性：`data-glass`、`data-text`、`data-background`、`data-strength`、`data-mode`、`data-vignette`、`data-live-text`。

---

## 5. HTML / CSS 约定

### 元素 class / 属性

| 写法 | 作用 |
|---|---|
| `class="liquid-glass"` | 变成玻璃（默认选择器，可用 `glass` 选项改） |
| `data-lg-top` | **最上层玻璃**：能折射所有内容（包括别的玻璃里的文字）。它自己的文字由 DOM 绘制，适合做可拖动的浮球、导航栏 |
| `data-lg-dom` | 玻璃里的某个子元素，文字**留给 DOM 自己画**（不被折射，但保证清晰、可交互） |

### CSS 变量（写在你自己的样式里，随时能覆盖）

| 变量 | 默认 | 说明 |
|---|---|---|
| `--lg-radius` | `28px` | 圆角。直接写 `border-radius` 也行，库读的是实际渲染出来的圆角 |
| `--lg-shadow` | `0 18px 40px rgba(0,0,0,.35)` | 玻璃外阴影 |

### 四条“别踩坑”规则

1. **页面背景交给库。** 库会让 `html/body` 背景透明，真正的背景由它画（见[第 6 节](#6-换背景)）。不要给 `body`、外层容器再设不透明背景色/图，否则会把玻璃盖住。
2. **玻璃里的原生控件**（`<input>`、`<button>`、`<select>`）文字由浏览器自己画，不会被折射，但能正常使用。
3. **玻璃里的文字别用渐变文字（`background-clip:text`）或 `text-shadow`**，Canvas 画不出来。
4. **玻璃背后要被折射的文字**，记得写进 `text` 选项，否则它只是普通 DOM 文字，会盖在玻璃上面。

---

## 6. 换背景

玻璃要“折射”的东西必须在 canvas 里，所以背景得通过库来设置：

```js
// 1) 默认：深色网格 + 三个会漂浮的彩色光斑（什么都不写就是它）
LiquidGlass.init({ background: 'blobs' })

// 2) 一张图（cover 铺满）
LiquidGlass.init({ background: '/img/bg.jpg' })

// 3) 纯色
LiquidGlass.init({ background: '#0b1020' })

// 4) 自己用 Canvas 画（比如渐变）
LiquidGlass.init({
  background: {
    draw(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, '#5e5ce6'); g.addColorStop(1, '#ec4899')
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
    }
  }
})

// 5) 运行时随时切换
const lg = LiquidGlass.init()
lg.setBackground('/img/another.jpg')
```

> **图片跨域**：如果图片放在别的域名（比如图床），服务器必须返回 `Access-Control-Allow-Origin` 头，否则 WebGL 不允许读取，会提示警告并回退到默认背景。同域图片没有这个问题。

> **颜色建议**：高光和内阴影是白色叠加，**中深色、有颜色变化的背景**效果最好。纯白背景上玻璃会不明显。

---

## 7. API

```js
const lg = LiquidGlass.init(options)
```

| 方法 / 属性 | 说明 |
|---|---|
| `lg.renderer` | 当前渲染器：`'webgl'` 或 `'css'`（降级了就是 `'css'`） |
| `lg.setStrength(n)` | 改折射强度 |
| `lg.setMode('lens' \| 'frost' \| 'ripple')` | 切换效果 |
| `lg.setBackground(bg)` | 切换背景，参数同 `background` 选项 |
| `lg.refresh()` | 手动重新扫描元素并重绘文字（一般不需要，见下） |
| `lg.destroy()` | 完全卸载：移除画布、样式、监听，恢复页面 |

静态工具：

| 方法 | 说明 |
|---|---|
| `LiquidGlass.supported()` | 当前浏览器是否支持 WebGL |
| `LiquidGlass.draggable(el)` | 让一个 `position:fixed` 的玻璃可拖动（鼠标 + 触摸），返回取消函数 |

**动态内容不用手动刷新**：库内部监听了 DOM 变化（增删元素、改文字），自动重新扫描和重绘。只有当文字被 CSS 动画/过渡改变位置时，才需要 `liveText: true`。

**可拖动玻璃示例：**

```html
<div class="liquid-glass" id="orb" data-lg-top
     style="position:fixed; left:50%; top:30vh; width:180px; height:100px; margin-left:-90px; --lg-radius:46px; z-index:40">
  拖动我
</div>
<script>LiquidGlass.draggable(document.getElementById('orb'))</script>
```

---

## 8. WebGL 与 CSS 降级对照

库启动时自动检测，**不需要你写任何判断代码**：

| 情况 | 使用的渲染器 | 效果 |
|---|---|---|
| 支持 WebGL（绝大多数现代浏览器） | **WebGL**（`lg.renderer === 'webgl'`） | 完整效果：真实折射、色散、高光、内阴影，Safari / Firefox 也一样 |
| 无 WebGL，Chromium 内核（Chrome / Edge） | **CSS + SVG 位移滤镜** | 真实边缘折射 + 色散，高光/边框用 CSS 画 |
| 无 WebGL，其它浏览器 | **CSS 毛玻璃** | `blur + saturate` 毛玻璃 + CSS 高光/边框 |
| 连 `backdrop-filter` 都不支持 | **半透明白底** | 轻微半透明，保证内容可读 |

另外两种情况也会自动降级：**着色器编译失败**、**运行中 GPU 上下文丢失**（切后台、显卡驱动重启）——页面会无缝切到 CSS 方案，不会白屏。

想亲眼看看降级效果？

```js
LiquidGlass.init({ forceFallback: true })
```

---

## 9. 在 React / Vue 里使用

> 注意：请使用 `import './liquid-glass.js'`（副作用引入，挂到 `window.LiquidGlass`），**不要**写 `import LiquidGlass from ...`，这个文件没有 ES 默认导出。
> 服务端渲染（Next / Nuxt）下只能在客户端生命周期里调用，不要在模块顶层调用。

**React**

```jsx
import { useEffect } from 'react'
import './liquid-glass.js'

export default function App() {
  useEffect(() => {
    const lg = window.LiquidGlass.init({ text: 'h1,p' })
    return () => lg.destroy()          // 卸载时清理（StrictMode 双调用也安全）
  }, [])

  return (
    <>
      <h1>Hello</h1>
      <div className="liquid-glass" style={{ padding: 28 }}>玻璃</div>
    </>
  )
}
```

**Vue 3**

```vue
<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import './liquid-glass.js'

let lg
onMounted(() => { lg = window.LiquidGlass.init({ text: 'h1,p' }) })
onBeforeUnmount(() => lg && lg.destroy())
</script>

<template>
  <h1>Hello</h1>
  <div class="liquid-glass" style="padding:28px">玻璃</div>
</template>
```

路由切换、列表增删导致玻璃数量变化时，库会自动识别，不需要重新 `init`。

---

## 10. 常见问题

**Q：我加了 class，但看不到玻璃，页面一片黑 / 一片白？**
先打开控制台看有没有 `[LiquidGlass]` 开头的警告。再检查：① `body` 或外层容器有没有不透明背景；② 容器有没有 `z-index` + `position` 把 canvas（在最底层）盖住；③ 脚本是不是在 `<body>` 存在之前就调用了 `init()`。

**Q：玻璃背后的文字没被折射，而是盖在玻璃上面？**
那段文字没写进 `text` 选项。比如标题是 `h1`、正文是 `p`，就写 `text: 'h1,p'`。

**Q：文字出现重影 / 变粗？**
一般是同一段文字被两处样式重复渲染。检查它是否同时匹配了 `text` 选项和 `glass` 选项（库会自动避免，但如果你自己又加了 `text-shadow` 就会重影）。

**Q：我有一个固定在页面上的 `<img>` / `<video>`，为什么玻璃没折射它？**
WebGL 方案里，**被折射的只有「背景」和「列在 `text` 里的文字」**，普通 DOM 元素（图片、视频、iframe）是画在 canvas 上面的，折射不到。需要折射图片请把它作为 `background`，或者在 `draw()` 里把图画进去。

**Q：滚动时有点卡？**
把 `maxDpr` 设成 `1`，减少玻璃数量，或者把 `mode` 改成 `'frost'`。玻璃越大、数量越多，显卡负担越重。

**Q：手机发热？**
同上。另外，页面不可见时（切后台）渲染会自动暂停。

**Q：动态加载的内容（Ajax、路由）能用吗？**
可以，库监听了 DOM 变化。如果你是通过 `style` 直接改位置（没有改 DOM 内容），玻璃的位置每帧都会重新读取，同样没问题；只有文字的位置被动画改变时才需要 `liveText: true`。

**Q：能给多块玻璃不同的圆角、大小吗？**
可以，每块玻璃的位置、尺寸、圆角都是独立读取的。

**Q：怎么确认当前用的是 WebGL 还是降级？**
`LiquidGlass.init().renderer` 返回 `'webgl'` 或 `'css'`；`<html>` 上也会带 `lg-on`（WebGL）或 `lg-off`（降级）class，方便你针对性写 CSS。

---

## 11. 已知限制

- 同屏玻璃上限 **32 块**（默认 12），超出的不会生效，控制台会警告。
- 被折射的只有**背景和 `text` 指定的文字**（见上文）。
- 玻璃里的原生控件（输入框、按钮、下拉框）不参与折射，但可正常使用。
- 渐变文字、`text-shadow`、`-webkit-text-stroke` 等特殊文字效果在 canvas 里不会绘制。
- 高光为白色叠加，浅色/纯白背景上效果会弱。
- CSS 降级在非 Chromium 浏览器上没有边缘折射，只有毛玻璃。

---

## 许可证

MIT © 秋名山

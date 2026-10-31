/*!
 * liquid-glass.js  v1.0.0
 * WebGL 液态玻璃（圆角边缘折射 + RGB 色散 + 高光/内阴影），不支持 WebGL 时自动降级为 CSS/SVG。
 * 单文件、零依赖、MIT 协议。
 *
 * 最简用法：
 *   <script src="liquid-glass.js"></script>
 *   <script>LiquidGlass.init();</script>          // 给元素加上 class="liquid-glass" 即可
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.LiquidGlass = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const VERSION = '1.0.0'
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const MODES = { lens: 2, frost: 0, ripple: 1 }          // 折射（默认）/ 磨砂 / 水波
  const SKIP = 'button,textarea,select,option,[data-lg-dom]' // 玻璃里这些元素的文字留给 DOM 自己画

  const DEFAULTS = {
    glass: '.liquid-glass',     // 哪些元素要变成玻璃（CSS 选择器）
    text: '',                  // 玻璃“背后”需要被折射的页面文字，如 'h1,h2,p'
    background: 'blobs',       // 背景：'blobs' | 图片地址 | '#颜色' | {image|color|draw} | <img>/<canvas>
    strength: 90,              // 折射强度（像素，0~160 比较合适）
    mode: 'lens',              // 'lens' 折射 | 'frost' 磨砂 | 'ripple' 水波
    vignette: 0.45,            // 背景图四角压暗程度，0 = 不压暗
    maxGlass: 12,              // 同屏最多几块玻璃（最大 32）
    maxDpr: 2,                 // 渲染分辨率上限，卡的话改成 1
    liveText: false,           // 文字有 CSS 动画/过渡时设为 true（每帧重绘文字，更费电）
    takeOverBackground: true,  // 把 html/body 背景设为透明，交给本库绘制
    injectCSS: true,           // 自动注入所需样式
    forceFallback: false,      // 调试用：强制走 CSS 降级
    onPaint: null              // 高级：function(ctx, layer, {dpr}) 自己往文字层再画点东西
  }

  /* ====================================================================
   * 样式：全部注入一个 <style>，放在 <head> 最前面，你自己的 CSS 永远能覆盖它
   * ==================================================================== */
  const CSS = `
.lg-canvas{position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none}
:where(.lg-glass){position:relative}
:where(.liquid-glass){border-radius:var(--lg-radius,28px);box-shadow:var(--lg-shadow,0 18px 40px rgba(0,0,0,.35))}
html.lg-takeover,html.lg-takeover body{background:transparent!important}

/* ---- WebGL 模式：玻璃里/被折射的文字交给 GL 画，DOM 文字变透明但仍可选中 ---- */
.lg-on .lg-gx{-webkit-text-fill-color:transparent;text-shadow:none}
.lg-on .lg-gx :is(input,textarea,select,button,[data-lg-dom]){-webkit-text-fill-color:currentColor}

/* ---- CSS 降级模式 ---- */
.lg-bg{display:none}
.lg-off .lg-bg{display:block;position:fixed;inset:0;z-index:-1;overflow:hidden;background:#07070d}
.lg-off .lg-bg-blobs{background:repeating-linear-gradient(90deg,rgba(255,255,255,.07) 0 2px,transparent 2px 72px),repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 2px,transparent 2px 72px),#07070d}
.lg-blob{position:absolute;border-radius:50%;filter:blur(30px);opacity:.9;animation:lg-drift 22s ease-in-out infinite alternate}
.lg-b1{width:46vmax;height:46vmax;left:-12vmax;top:-10vmax;background:#5e5ce6}
.lg-b2{width:40vmax;height:40vmax;right:-10vmax;top:10vh;background:#ec4899;animation-delay:-8s}
.lg-b3{width:36vmax;height:36vmax;left:25vw;bottom:-14vmax;background:#06b6d4;animation-delay:-15s}
@keyframes lg-drift{to{transform:translate(8vmax,6vmax) scale(1.15)}}
@media (prefers-reduced-motion:reduce){.lg-blob{animation:none}}
.lg-off .lg-glass{isolation:isolate;background:transparent}
.lg-off .lg-glass::before{content:"";position:absolute;inset:0;z-index:-2;border-radius:inherit;
 -webkit-backdrop-filter:blur(16px) saturate(1.6);
 backdrop-filter:var(--lg-lens,blur(16px)) blur(.5px) saturate(1.6) brightness(1.1)}
.lg-off .lg-glass::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;
 background:radial-gradient(260px circle at var(--mx,30%) var(--my,0%),rgba(255,255,255,.28),transparent 60%),radial-gradient(130% 70% at 50% 0%,rgba(255,255,255,.22),transparent 45%);
 border:1px solid rgba(255,255,255,.14);border-top-color:rgba(255,255,255,.7);border-bottom-color:rgba(255,255,255,.04);
 box-shadow:inset 1px 1px 1px rgba(255,255,255,.55),inset -1px -1px 1px rgba(255,255,255,.12),inset 0 10px 18px -8px rgba(255,255,255,.35),inset 0 -8px 16px -8px rgba(255,255,255,.18)}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
 .lg-off .lg-glass::before{background:rgba(255,255,255,.14)}}
`

  /* ====================================================================
   * 着色器（和 Demo 同一套算法；顶层玻璃用 uInfo.w 标记）
   * ==================================================================== */
  const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'

  const fragmentShader = MAX => `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define MAX ${MAX}
uniform vec2 uRes;uniform float uDpr,uStrength,uBgOn,uVig;uniform int uMode,uCount;uniform vec3 uPhase;
uniform sampler2D uPage,uGlassTx,uBgTex;
uniform vec4 uRect[MAX];uniform vec4 uInfo[MAX];
uniform vec2 uBgScale,uBgOff;
float sdb(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.)+length(max(q,0.))-r;}
float ph(float z){return 1./(1.+exp(-1.702*z));}
float hs(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hs(i),hs(i+vec2(1.,0.)),f.x),mix(hs(i+vec2(0.,1.)),hs(i+1.),f.x),f.y);}
vec3 sat(vec3 c,float s){return clamp(mix(vec3(dot(c,vec3(.213,.715,.072))),c,s),0.,1.);}
float ins(vec2 q,vec2 h,float rd,vec2 o,float sp,float sg,float al){return al*ph(sdb(q-o,h-1.-sp,max(rd-1.-sp,0.))/sg);}
/* 背景：自定义图片/颜色 或 默认的网格 + 三个漂浮光斑 */
vec3 bg(vec2 c){
 vec2 W=uRes/uDpr;
 if(uBgOn>.5){vec2 d=c/W-.5;return texture2D(uBgTex,(c-uBgOff)*uBgScale).rgb*(1.-uVig*dot(d,d));}
 float v=max(W.x,W.y)/100.;vec3 o=vec3(7.,7.,13.)/255.;
 o=mix(o,vec3(1.),1.-pow(.93,step(mod(c.x,72.),2.)+step(mod(W.y-c.y,72.),2.)));
 vec2 d=vec2(8.,6.)*v;
 o=mix(o,vec3(94.,92.,230.)/255.,.9*(1.-ph((length(c-(vec2(11.,13.)*v+d*uPhase.x))-23.*v*(1.+.15*uPhase.x))/30.)));
 o=mix(o,vec3(236.,72.,153.)/255.,.9*(1.-ph((length(c-(vec2(W.x-10.*v,.1*W.y+20.*v)+d*uPhase.y))-20.*v*(1.+.15*uPhase.y))/30.)));
 o=mix(o,vec3(6.,182.,212.)/255.,.9*(1.-ph((length(c-(vec2(.25*W.x+18.*v,W.y-4.*v)+d*uPhase.z))-18.*v*(1.+.15*uPhase.z))/30.)));
 return o;}
/* 场景 = 背景 + 页面文字 + （可选）其他玻璃里的文字 */
vec3 sc(vec2 c,bool g){vec3 o=bg(c);vec4 t=texture2D(uPage,c*uDpr/uRes);o=o*(1.-t.a)+t.rgb;
 if(g){t=texture2D(uGlassTx,c*uDpr/uRes);o=o*(1.-t.a)+t.rgb;}return o;}
vec3 blur(vec2 c,float s,bool g){vec3 a=vec3(0.);
 for(int i=0;i<16;i++){float f=float(i)+.5,r=s*1.6*sqrt(f/16.),t=f*2.4;a+=sc(c+r*vec2(cos(t),sin(t)),g);}return a/16.;}
vec3 shade(vec4 rc,vec4 inf,bool tp,vec2 c){
 vec2 h=rc.zw*.5,q=c-rc.xy-h;float rd=min(inf.x,min(h.x,h.y)),sd=sdb(q,h,rd);
 vec2 a=abs(q)-h+rd;
 vec2 n=(a.x>0.||a.y>0.)?sign(q)*normalize(max(a,0.)):(a.x>a.y?vec2(sign(q.x),0.):vec2(0.,sign(q.y)));
 vec3 col;
 if(uMode==0)col=sat(blur(c,24.,tp),1.8);
 else if(uMode==1){vec2 l=(c-rc.xy)*vec2(.005,.01);col=sat(blur(c+15.*(vec2(vn(l+3.),vn(l+9.))-.5),4.,tp),1.6);}
 else{
  float bz=max(10.,min(rd*1.1,min(rc.z,rc.w)/2.2)),u=clamp(-sd/bz,0.,1.),mg=1.-sqrt(1.-(1.-u)*(1.-u));
  vec2 o=-n*mg*uStrength*.498;                 /* 凸透镜剖面：边缘最强，向内取样 */
  col=vec3(sc(c+o*1.02,tp).r,sc(c+o,tp).g,sc(c+o*.98,tp).b);   /* RGB 色散 */
  col=min(sat(col,1.6)*1.1,1.);}
 /* 质感层：鼠标高光 + 顶部高光 + 1px 渐变边框 + 四层内阴影 */
 vec2 l=q+h;
 float A=1.-(1.-.28*(1.-clamp(length(l-inf.yz)/156.,0.,1.)))*(1.-.22*(1.-clamp(length((l-vec2(h.x,0.))/(rc.zw*vec2(1.3,.7)))/.45,0.,1.)));
 float t=smoothstep(-.05,.05,abs(n.y)-abs(n.x));
 A=1.-(1.-A)*(1.-mix(.14,n.y<0.?.7:.04,t)*clamp((sd+1.)*uDpr+.5,0.,1.));
 float ip=clamp((-1.-sd)*uDpr+.5,0.,1.);
 A=1.-(1.-A)*(1.-ip*ins(q,h,rd,vec2(1.),0.,.5,.55))*(1.-ip*ins(q,h,rd,vec2(-1.),0.,.5,.12))
   *(1.-ip*ins(q,h,rd,vec2(0.,10.),-8.,9.,.35))*(1.-ip*ins(q,h,rd,vec2(0.,-8.),-8.,8.,.18));
 return mix(col,vec3(1.),A);}
void main(){
 vec2 c=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uDpr;vec3 col=vec3(0.);bool hit=false;
 for(int i=0;i<MAX;i++){
  if(i>=uCount)break;
  vec4 r=uRect[i];vec2 h=r.zw*.5;float rd=min(uInfo[i].x,min(h.x,h.y)),sd=sdb(c-r.xy-h,h,rd);
  if(sd<.5/uDpr){
   bool top=uInfo[i].w>.5;
   col=shade(r,uInfo[i],top,c);                   /* 顶层玻璃：能折射所有内容（含其他玻璃里的文字） */
   if(!top){vec4 t=texture2D(uGlassTx,c*uDpr/uRes);col=col*(1.-t.a)+t.rgb;}  /* 普通玻璃：自身文字清晰叠在上面 */
   float cv=clamp(.5-sd*uDpr,0.,1.);if(cv<1.)col=mix(sc(c,true),col,cv);
   hit=true;break;}
 }
 if(!hit)col=sc(c,true);
 gl_FragColor=vec4(col,1.);}`

  /* ====================================================================
   * 小工具
   * ==================================================================== */
  const mkCanvas = (w, h) => {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    return { c, x: c.getContext('2d') }
  }

  function normBg (b) {
    if (!b || b === 'blobs') return { type: 'blobs' }
    if (typeof b === 'string') {
      return /^\s*(#|rgb|hsl)/i.test(b) ? { type: 'color', color: b } : { type: 'image', src: b }
    }
    if ((typeof HTMLImageElement !== 'undefined' && b instanceof HTMLImageElement) ||
        (typeof HTMLCanvasElement !== 'undefined' && b instanceof HTMLCanvasElement)) return { type: 'source', el: b }
    if (b.image) return { type: 'image', src: b.image }
    if (b.color) return { type: 'color', color: b.color }
    if (typeof b.draw === 'function') return { type: 'draw', draw: b.draw }
    return { type: 'blobs' }
  }

  /** 浏览器是否支持 WebGL（不创建正式画布，只是探测） */
  function supported () {
    try { return !!document.createElement('canvas').getContext('webgl') } catch (e) { return false }
  }

  /** 让一个 position:fixed/absolute 的元素可以被鼠标/手指拖动。返回取消函数。 */
  function draggable (el) {
    let on = false, ox = 0, oy = 0
    el.style.touchAction = 'none'; el.style.cursor = 'grab'; el.style.userSelect = 'none'
    const down = e => {
      on = true; const b = el.getBoundingClientRect(); ox = e.clientX - b.left; oy = e.clientY - b.top
      el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'
    }
    const move = e => {
      if (!on) return
      el.style.margin = '0'; el.style.right = 'auto'; el.style.bottom = 'auto'
      el.style.left = (e.clientX - ox) + 'px'; el.style.top = (e.clientY - oy) + 'px'
    }
    const up = () => { on = false; el.style.cursor = 'grab' }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
    }
  }

  let current = null

  /* ====================================================================
   * 主入口
   * ==================================================================== */
  function init (userOpts) {
    if (!document.body) {
      throw new Error('[LiquidGlass] document.body 还不存在：请把脚本放在 </body> 前，或在 DOMContentLoaded 之后调用 init()')
    }
    if (current) current.destroy()

    const o = Object.assign({}, DEFAULTS, userOpts)
    o.maxGlass = Math.max(1, Math.min(o.maxGlass | 0, 32))

    const html = document.documentElement
    const body = document.body
    const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches

    let alive = true
    let renderer = null              // 'webgl' | 'css'
    let strength = +o.strength || 0
    let mode = o.mode
    let dirty = true                 // 文字层需要重绘
    let needScan = true              // 需要重新扫描元素
    let raf = 0
    let D = 1

    let list = []                    // 当前生效的玻璃元素（顶层玻璃排在最前）
    let pageEls = []                 // 需要被折射的页面文字元素
    const marked = new Set()         // 我们加过 lg-gx 的元素
    const mouse = new WeakMap()      // 每块玻璃各自的鼠标位置

    /* ---------- 注入样式 ---------- */
    let styleEl = null
    if (o.injectCSS) {
      styleEl = document.createElement('style')
      styleEl.setAttribute('data-liquid-glass', '')
      styleEl.textContent = CSS
      document.head.insertBefore(styleEl, document.head.firstChild)
    }
    if (o.takeOverBackground) html.classList.add('lg-takeover')

    /* ---------- 收集元素 ---------- */
    function collect () {
      const all = [...document.querySelectorAll(o.glass)]
      const isTop = e => e.hasAttribute('data-lg-top')
      list = all.filter(isTop).concat(all.filter(e => !isTop(e))).slice(0, o.maxGlass)
      if (all.length > o.maxGlass) {
        console.warn(`[LiquidGlass] 页面上有 ${all.length} 块玻璃，超过 maxGlass=${o.maxGlass}，多余的不会生效`)
      }
      pageEls = o.text ? [...document.querySelectorAll(o.text)].filter(e => !e.closest(o.glass)) : []

      const next = new Set(pageEls)
      list.forEach(e => { e.classList.add('lg-glass'); if (!isTop(e)) next.add(e) })
      marked.forEach(e => { if (!next.has(e)) e.classList.remove('lg-gx') })
      next.forEach(e => e.classList.add('lg-gx'))
      marked.clear(); next.forEach(e => marked.add(e))
    }

    /* ---------- 指针：每块玻璃各记各的高光位置 ---------- */
    function onPointerMove (e) {
      const g = e.target.closest && e.target.closest(o.glass)
      if (!g) return
      const b = g.getBoundingClientRect()
      const mx = e.clientX - b.left, my = e.clientY - b.top
      mouse.set(g, [mx, my])
      if (renderer === 'css') { g.style.setProperty('--mx', mx + 'px'); g.style.setProperty('--my', my + 'px') }
    }
    document.addEventListener('pointermove', onPointerMove, { passive: true })

    /* ---------- 背景（WebGL / CSS 共用的“解析”部分） ---------- */
    let bgSpec = normBg(o.background)
    let bgRes = null                 // null = 默认光斑；否则 {type, source, w, h, css?, color?}
    let bgToken = 0

    function resolveBg (s, done) {
      if (s.type === 'blobs') return done(null)
      if (s.type === 'image') {
        const im = new Image()
        im.crossOrigin = 'anonymous'
        im.onload = () => done({ type: 'image', source: im, w: im.naturalWidth || 1, h: im.naturalHeight || 1, css: 'url("' + s.src + '")' })
        im.onerror = () => console.warn('[LiquidGlass] 背景图加载失败（跨域图片需要服务器返回 CORS 头）：' + s.src)
        im.src = s.src
        return
      }
      if (s.type === 'color') {
        if (renderer === 'css') return done({ type: 'color', source: null, w: 1, h: 1, color: s.color })
        const k = mkCanvas(1, 1); k.x.fillStyle = s.color; k.x.fillRect(0, 0, 1, 1)
        return done({ type: 'color', source: k.c, w: 1, h: 1, color: s.color })
      }
      if (s.type === 'draw') {
        const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight), k = mkCanvas(w, h)
        s.draw(k.x, w, h)
        let css = ''
        if (renderer === 'css') { try { css = 'url(' + k.c.toDataURL() + ')' } catch (e) { /* 忽略 */ } }
        return done({ type: 'draw', source: k.c, w, h, css })
      }
      // 直接传了 <img> / <canvas>
      const el = s.el
      let css = ''
      try { css = el.src ? 'url("' + el.src + '")' : 'url(' + el.toDataURL() + ')' } catch (e) { /* 忽略 */ }
      done({ type: 'source', source: el, w: el.naturalWidth || el.width || 1, h: el.naturalHeight || el.height || 1, css })
    }

    function applyBg () {
      const token = ++bgToken
      resolveBg(bgSpec, r => {
        if (!alive || token !== bgToken) return
        bgRes = r
        if (renderer === 'webgl') glCommitBg()
        else if (renderer === 'css') cssCommitBg()
      })
    }

    /* ====================================================================
     * WebGL 渲染器
     * ==================================================================== */
    let canvas = null, gl = null, prog = null, bgTex = null
    let pageL = null, glassL = null
    let rects = null, infos = null
    let U = {}
    let bgOn = 0, bgSX = 1, bgSY = 1, bgOX = 0, bgOY = 0

    function startGL () {
      const c = document.createElement('canvas')
      const g = c.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' })
      if (!g) return false

      const compile = (type, src) => {
        const s = g.createShader(type)
        g.shaderSource(s, src); g.compileShader(s)
        if (!g.getShaderParameter(s, g.COMPILE_STATUS)) { console.warn('[LiquidGlass] 着色器编译失败：', g.getShaderInfoLog(s)); return null }
        return s
      }
      const vs = compile(g.VERTEX_SHADER, VS)
      const fs = compile(g.FRAGMENT_SHADER, fragmentShader(o.maxGlass))
      if (!vs || !fs) return false
      const p = g.createProgram()
      g.attachShader(p, vs); g.attachShader(p, fs); g.linkProgram(p)
      if (!g.getProgramParameter(p, g.LINK_STATUS)) { console.warn('[LiquidGlass] 着色器链接失败'); return false }

      gl = g; prog = p; canvas = c
      canvas.className = 'lg-canvas'
      canvas.setAttribute('aria-hidden', 'true')
      body.insertBefore(canvas, body.firstChild)

      gl.useProgram(prog)
      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
      const ap = gl.getAttribLocation(prog, 'a')
      gl.enableVertexAttribArray(ap)
      gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0)

      ;['uRes', 'uDpr', 'uStrength', 'uBgOn', 'uVig', 'uMode', 'uCount', 'uPhase', 'uBgScale', 'uBgOff']
        .forEach(n => { U[n] = gl.getUniformLocation(prog, n) })
      U.rect = gl.getUniformLocation(prog, 'uRect[0]')
      U.info = gl.getUniformLocation(prog, 'uInfo[0]')
      gl.uniform1i(gl.getUniformLocation(prog, 'uPage'), 0)
      gl.uniform1i(gl.getUniformLocation(prog, 'uGlassTx'), 1)
      gl.uniform1i(gl.getUniformLocation(prog, 'uBgTex'), 2)
      gl.uniform1f(U.uVig, +o.vignette)

      rects = new Float32Array(o.maxGlass * 4)
      infos = new Float32Array(o.maxGlass * 4)

      const setTex = unit => {
        gl.activeTexture(gl.TEXTURE0 + unit)
        const t = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        return t
      }
      const layer = unit => { const k = mkCanvas(1, 1); k.t = setTex(unit); return k }
      pageL = layer(0)     // 页面文字层
      glassL = layer(1)    // 玻璃内文字层
      bgTex = setTex(2)    // 自定义背景
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([10, 10, 18, 255]))

      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (alive) switchToCss() })
      return true
    }

    function glResize () {
      D = Math.min(devicePixelRatio || 1, o.maxDpr)
      const w = Math.max(1, Math.round(innerWidth * D)), h = Math.max(1, Math.round(innerHeight * D))
      canvas.width = pageL.c.width = glassL.c.width = w
      canvas.height = pageL.c.height = glassL.c.height = h
      gl.viewport(0, 0, w, h)
      if (bgRes) { if (bgSpec.type === 'draw') applyBg(); else fitBg() }
      dirty = true
    }

    function fitBg () {                // 背景图 cover 适配
      const W = innerWidth, H = innerHeight, s = Math.max(W / bgRes.w, H / bgRes.h)
      const dw = bgRes.w * s, dh = bgRes.h * s
      bgSX = 1 / dw; bgSY = 1 / dh; bgOX = (W - dw) / 2; bgOY = (H - dh) / 2
    }

    function glCommitBg () {
      if (!bgRes) { bgOn = 0; dirty = true; return }
      try {
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bgTex)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgRes.source)
        fitBg(); bgOn = 1
      } catch (err) {
        console.warn('[LiquidGlass] 背景无法上传到 WebGL（跨域图片需要服务器返回 CORS 头），已改用默认背景', err)
        bgOn = 0
      }
      dirty = true
    }

    /* 把 DOM 文字逐字按真实排版位置画进 2D 画布，再当纹理交给 GL */
    function textNodes (els) {
      const set = new Set()
      els.forEach(el => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let n
        while ((n = w.nextNode())) {
          if (!n.nodeValue.trim()) continue
          const p = n.parentElement
          if (!p) continue
          const ctl = p.closest(SKIP)
          if (ctl && ctl !== el && el.contains(ctl)) continue   // 玻璃里的按钮/输入框文字交给 DOM
          set.add(n)
        }
      })
      return set
    }

    function paintLayer (L, els, name, unit) {
      const x = L.x
      x.setTransform(1, 0, 0, 1, 0, 0)
      x.clearRect(0, 0, L.c.width, L.c.height)
      x.setTransform(D, 0, 0, D, 0, 0)
      const rg = document.createRange(), vw = innerWidth, vh = innerHeight
      textNodes(els).forEach(n => {
        const par = n.parentElement, cs = getComputedStyle(par)
        if (cs.visibility === 'hidden' || cs.display === 'none') return
        rg.selectNodeContents(n)
        const bb = rg.getBoundingClientRect()
        if (bb.bottom < -60 || bb.top > vh + 60 || bb.right < -60 || bb.left > vw + 60) return   // 屏外不画
        x.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
        x.fillStyle = cs.color
        x.globalAlpha = Math.min(1, Math.max(0, parseFloat(cs.opacity) || 1))
        x.textBaseline = 'alphabetic'
        const asc = x.measureText('Hg').fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8
        const up = cs.textTransform === 'uppercase', low = cs.textTransform === 'lowercase'
        const s = n.nodeValue
        let i = 0
        for (const ch of s) {
          const len = ch.length
          if (!/\s/.test(ch)) {
            rg.setStart(n, i); rg.setEnd(n, i + len)
            const b = rg.getClientRects()[0]
            if (b) x.fillText(up ? ch.toUpperCase() : low ? ch.toLowerCase() : ch, b.left, b.top + asc)
          }
          i += len
        }
        x.globalAlpha = 1
      })
      if (o.onPaint) o.onPaint(x, name, { dpr: D })
      if (!L.c.width || !L.c.height) return
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, L.t)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, L.c)
    }

    const radiusOf = (el, w, h) => {
      const v = getComputedStyle(el).borderTopLeftRadius
      let r = parseFloat(v) || 0
      if (v.indexOf('%') > -1) r = r / 100 * Math.min(w, h)
      return r
    }
    const bounce = (t, d) => { let x = ((t + d) / 22) % 2; if (x > 1) x = 2 - x; return x * x * (3 - 2 * x) }  // 22s 往返缓动

    function frame (ms) {
      if (!alive || renderer !== 'webgl') return
      raf = requestAnimationFrame(frame)
      if (needScan) { collect(); needScan = false; dirty = true }
      if (dirty || o.liveText) {
        paintLayer(pageL, pageEls, 'page', 0)
        paintLayer(glassL, list.filter(e => !e.hasAttribute('data-lg-top')), 'glass', 1)
        dirty = false
      }
      rects.fill(0); infos.fill(0)
      list.forEach((el, i) => {
        const b = el.getBoundingClientRect()
        const m = mouse.get(el) || [b.width * 0.3, 0]
        rects.set([b.left, b.top, b.width, b.height], i * 4)
        infos.set([radiusOf(el, b.width, b.height), m[0], m[1], el.hasAttribute('data-lg-top') ? 1 : 0], i * 4)
      })
      const t = ms / 1000
      gl.uniform2f(U.uRes, canvas.width, canvas.height)
      gl.uniform1f(U.uDpr, D)
      gl.uniform1f(U.uStrength, strength)
      gl.uniform1i(U.uMode, MODES[mode] != null ? MODES[mode] : 2)
      gl.uniform1i(U.uCount, list.length)
      gl.uniform3f(U.uPhase, reduceMotion ? 0 : bounce(t, 0), reduceMotion ? 0 : bounce(t, 8), reduceMotion ? 0 : bounce(t, 15))
      gl.uniform4fv(U.rect, rects)
      gl.uniform4fv(U.info, infos)
      gl.uniform1f(U.uBgOn, bgOn)
      gl.uniform2f(U.uBgScale, bgSX, bgSY)
      gl.uniform2f(U.uBgOff, bgOX, bgOY)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    /* ====================================================================
     * CSS / SVG 降级渲染器
     *   Chromium：backdrop-filter:url(#svg) 做真实折射
     *   其它浏览器：blur + saturate 毛玻璃
     * ==================================================================== */
    let bgEl = null, svgEl = null, defsEl = null, lensRO = null, scanTimer = 0, uid = 0
    const lensOK = /Chrome\/|Edg\//.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
    const filters = new Map()
    const DISP = 0.02

    function makeMap (w, h, r, bezel) {          // 画一张“位移贴图”：边缘按凸透镜曲线向内偏移
      const k = mkCanvas(w, h), img = k.x.createImageData(w, h), d = img.data
      r = Math.min(r, w / 2, h / 2)
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const px = Math.abs(i + 0.5 - w / 2) - (w / 2 - r), py = Math.abs(j + 0.5 - h / 2) - (h / 2 - r)
          const dist = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - r
          const u = Math.min(1, Math.max(0, -dist / bezel)), mag = 1 - Math.sqrt(1 - (1 - u) * (1 - u))
          let nx, ny
          if (px > 0 || py > 0) { nx = Math.sign(i + 0.5 - w / 2) * Math.max(px, 0); ny = Math.sign(j + 0.5 - h / 2) * Math.max(py, 0) }
          else if (px > py) { nx = Math.sign(i + 0.5 - w / 2); ny = 0 }
          else { nx = 0; ny = Math.sign(j + 0.5 - h / 2) }
          const l = Math.hypot(nx, ny) || 1, p = (j * w + i) * 4
          d[p] = 128 - (nx / l) * mag * 127; d[p + 1] = 128 - (ny / l) * mag * 127; d[p + 2] = 128; d[p + 3] = 255
        }
      }
      k.x.putImageData(img, 0, 0)
      return k.c.toDataURL()
    }

    function buildFilter (el) {
      const id = 'lg-lens-' + (uid++)
      const f = document.createElementNS(SVG_NS, 'filter')
      f.id = id
      f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '100%'); f.setAttribute('height', '100%')
      f.setAttribute('color-interpolation-filters', 'sRGB')
      const ch = (a, v, r) => `<feColorMatrix in="${a}" type="matrix" values="${v}" result="${r}"/>`
      f.innerHTML = `<feImage result="map" x="0" y="0" preserveAspectRatio="none"/>
        <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" result="dR"/>
        <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" result="dG"/>
        <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" result="dB"/>
        ${ch('dR', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', 'r')}${ch('dG', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', 'g')}${ch('dB', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', 'b')}
        <feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>`
      defsEl.appendChild(f)
      filters.set(el, { f, img: f.querySelector('feImage'), d: [...f.querySelectorAll('feDisplacementMap')] })
      el.style.setProperty('--lg-lens', `url(#${id})`)
      lensRO.observe(el)
    }

    function refreshFilter (el) {
      const rec = filters.get(el)
      if (!rec) return
      const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight)
      if (!w || !h) return
      const r = Math.min(radiusOf(el, w, h), w / 2, h / 2)
      const bezel = Math.max(10, Math.min(r * 1.1, Math.min(w, h) / 2.2))
      rec.img.setAttribute('width', w); rec.img.setAttribute('height', h)
      rec.img.setAttribute('href', makeMap(w, h, r, bezel))
      setScale(rec)
    }

    function setScale (rec) {
      rec.d[0].setAttribute('scale', strength * (1 + DISP))
      rec.d[1].setAttribute('scale', strength)
      rec.d[2].setAttribute('scale', strength * (1 - DISP))
    }

    function scanCss () {
      if (!lensOK) return
      list.forEach(el => { if (!filters.has(el)) buildFilter(el) })
      filters.forEach((rec, el) => {
        if (list.indexOf(el) < 0) { lensRO.unobserve(el); rec.f.remove(); el.style.removeProperty('--lg-lens'); filters.delete(el) }
      })
    }

    function cssCommitBg () {
      if (!bgEl) return
      bgEl.style.background = ''
      if (!bgRes) {
        bgEl.className = 'lg-bg lg-bg-blobs'
        bgEl.innerHTML = '<i class="lg-blob lg-b1"></i><i class="lg-blob lg-b2"></i><i class="lg-blob lg-b3"></i>'
        return
      }
      bgEl.className = 'lg-bg'
      bgEl.innerHTML = ''
      if (bgRes.type === 'color') bgEl.style.background = bgRes.color
      else if (bgRes.css) bgEl.style.background = `linear-gradient(rgba(0,0,0,.28),rgba(0,0,0,.28)),${bgRes.css} center/cover no-repeat`
    }

    function startCss () {
      renderer = 'css'
      html.classList.remove('lg-on'); html.classList.add('lg-off')
      bgEl = document.createElement('div')
      bgEl.setAttribute('aria-hidden', 'true')
      body.insertBefore(bgEl, body.firstChild)
      if (lensOK) {
        svgEl = document.createElementNS(SVG_NS, 'svg')
        svgEl.setAttribute('width', '0'); svgEl.setAttribute('height', '0')
        svgEl.setAttribute('aria-hidden', 'true'); svgEl.style.position = 'absolute'
        defsEl = document.createElementNS(SVG_NS, 'defs')
        svgEl.appendChild(defsEl)
        body.insertBefore(svgEl, body.firstChild)
        lensRO = new ResizeObserver(es => es.forEach(e => refreshFilter(e.target)))
      }
      collect(); scanCss()
      cssCommitBg(); applyBg()
    }

    function switchToCss () {            // WebGL 上下文丢失时：无缝切到降级模式
      if (renderer === 'css') return
      cancelAnimationFrame(raf)
      if (canvas) canvas.remove()
      canvas = null; gl = null
      startCss()
    }

    /* ====================================================================
     * 启动
     * ==================================================================== */
    if (!o.forceFallback && startGL()) {
      renderer = 'webgl'
      html.classList.add('lg-on')
      glResize()
      collect(); needScan = false
      applyBg()
      raf = requestAnimationFrame(frame)
    } else {
      startCss()
    }

    /* ---------- 全局监听 ---------- */
    const onResize = () => { if (renderer === 'webgl') glResize() }
    const onScroll = () => { dirty = true }
    addEventListener('resize', onResize)
    addEventListener('scroll', onScroll, { passive: true })
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { dirty = true })

    const bodyRO = new ResizeObserver(() => { dirty = true })
    bodyRO.observe(body)

    const mo = new MutationObserver(() => {      // 内容变化（含 SPA 动态插入）：重新扫描 + 重绘文字
      needScan = true; dirty = true
      if (renderer === 'css') { clearTimeout(scanTimer); scanTimer = setTimeout(() => { if (alive) { collect(); scanCss() } }, 50) }
    })
    mo.observe(body, { childList: true, subtree: true, characterData: true })

    /* ====================================================================
     * 对外 API
     * ==================================================================== */
    const api = {
      version: VERSION,
      get renderer () { return renderer },       // 'webgl' | 'css'
      get canvas () { return canvas },
      get strength () { return strength },
      setStrength (v) {
        strength = +v || 0; dirty = true
        if (renderer === 'css') filters.forEach(setScale)
      },
      setMode (m) { if (m in MODES) mode = m },
      setBackground (b) { bgSpec = normBg(b); applyBg() },
      refresh () {
        needScan = true; dirty = true
        if (renderer === 'css') { collect(); scanCss(); filters.forEach((r, el) => refreshFilter(el)) }
      },
      destroy () {
        if (!alive) return
        alive = false
        cancelAnimationFrame(raf); clearTimeout(scanTimer)
        document.removeEventListener('pointermove', onPointerMove)
        removeEventListener('resize', onResize); removeEventListener('scroll', onScroll)
        mo.disconnect(); bodyRO.disconnect(); if (lensRO) lensRO.disconnect()
        marked.forEach(e => e.classList.remove('lg-gx'))
        document.querySelectorAll('.lg-glass').forEach(e => { e.classList.remove('lg-glass'); e.style.removeProperty('--lg-lens'); e.style.removeProperty('--mx'); e.style.removeProperty('--my') })
        if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext() }
        ;[canvas, bgEl, svgEl, styleEl].forEach(n => n && n.remove())
        html.classList.remove('lg-on', 'lg-off', 'lg-takeover')
        if (current === api) current = null
      }
    }
    current = api
    return api
  }

  /* ====================================================================
   * <script src="liquid-glass.js" data-auto data-text="h1,p"></script> 自动初始化
   * ==================================================================== */
  const script = typeof document !== 'undefined' ? document.currentScript : null
  if (script && script.hasAttribute('data-auto')) {
    const d = script.dataset, cfg = {}
    if (d.glass) cfg.glass = d.glass
    if (d.text) cfg.text = d.text
    if (d.background) cfg.background = d.background
    if (d.strength) cfg.strength = +d.strength
    if (d.mode) cfg.mode = d.mode
    if (d.vignette) cfg.vignette = +d.vignette
    if (d.liveText === 'true') cfg.liveText = true
    const go = () => init(cfg)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go)
    else go()
  }

  return { version: VERSION, init, supported, draggable }
})

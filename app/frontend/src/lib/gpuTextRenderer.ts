// Minimal WebGL2 text renderer for the in-house editor.
//
// Glyphs are rasterized once into a texture atlas (an offscreen 2D canvas)
// and drawn as instanced textured quads — the same "texture atlas" approach
// xterm's WebGL addon uses. Solid quads (line highlight, selection, cursor)
// are drawn with a second, texture-less instanced program.

const VS_TEXT = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_pos;
layout(location=2) in vec2 a_size;
layout(location=3) in vec4 a_uv;
layout(location=4) in vec4 a_color;
uniform vec2 u_resolution;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec2 px = a_pos + a_corner * a_size;
  vec2 clip = (px / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, a_corner);
  v_color = a_color;
}`

const FS_TEXT = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_atlas;
out vec4 outColor;
void main() {
  float a = texture(u_atlas, v_uv).r;
  outColor = vec4(v_color.rgb, v_color.a * a);
}`

const VS_RECT = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_pos;
layout(location=2) in vec2 a_size;
layout(location=3) in vec4 a_color;
uniform vec2 u_resolution;
out vec4 v_color;
void main() {
  vec2 px = a_pos + a_corner * a_size;
  vec2 clip = (px / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`

const FS_RECT = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() { outColor = v_color; }`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error('shader compile error: ' + log)
  }
  return sh
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const prog = gl.createProgram()!
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc)
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog)
    throw new Error('program link error: ' + log)
  }
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  return prog
}

export interface RGBA { r: number; g: number; b: number; a: number }

export function hexToRgba(hex: string, alpha = 1): RGBA {
  const h = hex.replace('#', '')
  const r = parseInt(h.length >= 6 ? h.slice(0, 2) : h[0] + h[0], 16) / 255
  const g = parseInt(h.length >= 6 ? h.slice(2, 4) : h[1] + h[1], 16) / 255
  const b = parseInt(h.length >= 6 ? h.slice(4, 6) : h[2] + h[2], 16) / 255
  return { r, g, b, a: alpha }
}

interface GlyphInfo { u0: number; v0: number; u1: number; v1: number }

const ATLAS_SIZE = 2048

export class GpuTextRenderer {
  private gl: WebGL2RenderingContext
  private textProg: WebGLProgram
  private rectProg: WebGLProgram
  private quadBuf: WebGLBuffer
  private textInstBuf: WebGLBuffer
  private rectInstBuf: WebGLBuffer
  private textVao: WebGLVertexArrayObject
  private rectVao: WebGLVertexArrayObject
  private atlasTex: WebGLTexture
  private atlasCanvas: OffscreenCanvas | HTMLCanvasElement
  private atlasCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  private glyphs = new Map<string, GlyphInfo>()
  private nextCol = 0
  private nextRow = 0

  cellWidth = 8
  cellHeight = 18
  fontSize = 13
  fontFamily = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, monospace"

  private textInstances: number[] = []
  private rectInstances: number[] = []

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
    if (!gl) throw new Error('WebGL2 not supported')
    this.gl = gl

    this.textProg = link(gl, VS_TEXT, FS_TEXT)
    this.rectProg = link(gl, VS_RECT, FS_RECT)

    // Base quad: two triangles covering [0,1]x[0,1], shared by both programs.
    const quad = new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1])
    this.quadBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)

    this.textInstBuf = gl.createBuffer()!
    this.rectInstBuf = gl.createBuffer()!

    this.textVao = this.setupVao(this.textInstBuf, [
      { loc: 1, size: 2 }, // pos
      { loc: 2, size: 2 }, // size
      { loc: 3, size: 4 }, // uv
      { loc: 4, size: 4 }, // color
    ])
    this.rectVao = this.setupVao(this.rectInstBuf, [
      { loc: 1, size: 2 }, // pos
      { loc: 2, size: 2 }, // size
      { loc: 3, size: 4 }, // color
    ])

    // Glyph atlas: white-on-transparent glyphs; sampled as an alpha mask.
    if (typeof OffscreenCanvas !== 'undefined') {
      this.atlasCanvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE)
      this.atlasCtx = this.atlasCanvas.getContext('2d')!
    } else {
      const c = document.createElement('canvas')
      c.width = ATLAS_SIZE; c.height = ATLAS_SIZE
      this.atlasCanvas = c
      this.atlasCtx = c.getContext('2d')!
    }
    this.atlasTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, ATLAS_SIZE, ATLAS_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, null)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  private setupVao(instBuf: WebGLBuffer, fields: { loc: number; size: number }[]): WebGLVertexArrayObject {
    const gl = this.gl
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const stride = fields.reduce((s, f) => s + f.size, 0) * 4
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf)
    let offset = 0
    for (const f of fields) {
      gl.enableVertexAttribArray(f.loc)
      gl.vertexAttribPointer(f.loc, f.size, gl.FLOAT, false, stride, offset)
      gl.vertexAttribDivisor(f.loc, 1)
      offset += f.size * 4
    }
    gl.bindVertexArray(null)
    return vao
  }

  // Sets the monospace font and measures the fixed cell size. Re-running this
  // clears the atlas (cheap — only the visible glyph set gets rebuilt).
  setFont(fontFamily: string, fontSize: number) {
    this.fontFamily = fontFamily
    this.fontSize = fontSize
    this.atlasCtx.font = `${fontSize}px ${fontFamily}`
    const m = this.atlasCtx.measureText('M')
    this.cellWidth = Math.max(1, Math.round(m.width))
    this.cellHeight = Math.round(fontSize * 1.5)
    this.glyphs.clear()
    this.nextCol = 0
    this.nextRow = 0
    this.atlasCtx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)
    // Pre-warm printable ASCII so the first frame has no per-glyph upload churn.
    for (let c = 33; c < 127; c++) this.ensureGlyph(String.fromCharCode(c))
    this.uploadAtlas()
  }

  private ensureGlyph(ch: string): GlyphInfo {
    let g = this.glyphs.get(ch)
    if (g) return g
    if (ch === ' ' || ch === '\t') {
      g = { u0: 0, v0: 0, u1: 0, v1: 0 }
      this.glyphs.set(ch, g)
      return g
    }
    const cols = Math.floor(ATLAS_SIZE / this.cellWidth)
    if (this.nextCol >= cols) { this.nextCol = 0; this.nextRow++ }
    const px = this.nextCol * this.cellWidth
    const py = this.nextRow * this.cellHeight
    this.nextCol++

    const ctx = this.atlasCtx
    ctx.font = `${this.fontSize}px ${this.fontFamily}`
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'top'
    ctx.fillText(ch, px, py + this.cellHeight * 0.15)

    g = {
      u0: px / ATLAS_SIZE, v0: py / ATLAS_SIZE,
      u1: (px + this.cellWidth) / ATLAS_SIZE, v1: (py + this.cellHeight) / ATLAS_SIZE,
    }
    this.glyphs.set(ch, g)
    return g
  }

  private uploadAtlas() {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
    const img = this.atlasCtx.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE)
    // Atlas is drawn as white-on-transparent; the red channel == alpha coverage.
    const red = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE)
    for (let i = 0; i < red.length; i++) red[i] = img.data[i * 4 + 3]
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, ATLAS_SIZE, ATLAS_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, red)
  }

  resize(widthPx: number, heightPx: number, dpr: number) {
    this.canvas.width = Math.max(1, Math.round(widthPx * dpr))
    this.canvas.height = Math.max(1, Math.round(heightPx * dpr))
    this.canvas.style.width = `${widthPx}px`
    this.canvas.style.height = `${heightPx}px`
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
  }

  beginFrame(bg: RGBA) {
    const gl = this.gl
    gl.clearColor(bg.r, bg.g, bg.b, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.textInstances = []
    this.rectInstances = []
  }

  // Queue a solid rectangle (line highlight, selection, cursor). x/y/w/h in CSS px.
  drawRect(x: number, y: number, w: number, h: number, color: RGBA) {
    this.rectInstances.push(x, y, w, h, color.r, color.g, color.b, color.a)
  }

  // Queue one glyph at cell position (x,y in CSS px, top-left of the cell).
  drawGlyph(x: number, y: number, ch: string, color: RGBA) {
    if (ch === ' ' || ch === '\t' || ch === '') return
    const g = this.ensureGlyph(ch)
    if (g.u1 === g.u0) return
    const needsUpload = !this.glyphs.has(ch)
    this.textInstances.push(
      x, y, this.cellWidth, this.cellHeight,
      g.u0, g.v0, g.u1, g.v1,
      color.r, color.g, color.b, color.a,
    )
    if (needsUpload) this.uploadAtlas()
  }

  // Queue a string starting at cell (x,y), one glyph per cell width.
  drawText(x: number, y: number, text: string, color: RGBA) {
    let cx = x
    let newGlyphs = false
    for (const ch of text) {
      if (ch !== ' ' && ch !== '\t') {
        if (!this.glyphs.has(ch)) newGlyphs = true
        const g = this.ensureGlyph(ch)
        if (g.u1 !== g.u0) {
          this.textInstances.push(
            cx, y, this.cellWidth, this.cellHeight,
            g.u0, g.v0, g.u1, g.v1,
            color.r, color.g, color.b, color.a,
          )
        }
      }
      cx += this.cellWidth
    }
    if (newGlyphs) this.uploadAtlas()
  }

  endFrame() {
    const gl = this.gl
    const res: [number, number] = [this.canvas.width, this.canvas.height]
    const dpr = this.canvas.width / parseFloat(this.canvas.style.width || '1')

    if (this.rectInstances.length) {
      gl.useProgram(this.rectProg)
      gl.uniform2f(gl.getUniformLocation(this.rectProg, 'u_resolution'), res[0], res[1])
      gl.bindVertexArray(this.rectVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstBuf)
      const data = scaleInstances(this.rectInstances, 8, dpr)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.rectInstances.length / 8)
    }

    if (this.textInstances.length) {
      gl.useProgram(this.textProg)
      gl.uniform2f(gl.getUniformLocation(this.textProg, 'u_resolution'), res[0], res[1])
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
      gl.uniform1i(gl.getUniformLocation(this.textProg, 'u_atlas'), 0)
      gl.bindVertexArray(this.textVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.textInstBuf)
      const data = scaleInstances(this.textInstances, 12, dpr, [0, 1, 2, 3])
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.textInstances.length / 12)
    }
    gl.bindVertexArray(null)
  }
}

// Scales position/size fields (the first 4 floats of each instance, or the
// indices listed in `posSizeIdx`) from CSS px to device px.
function scaleInstances(arr: number[], stride: number, dpr: number, posSizeIdx = [0, 1, 2, 3]): Float32Array {
  if (dpr === 1) return new Float32Array(arr)
  const out = new Float32Array(arr)
  for (let i = 0; i < out.length; i += stride) {
    for (const idx of posSizeIdx) out[i + idx] *= dpr
  }
  return out
}

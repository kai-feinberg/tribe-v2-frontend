import './style.css'

type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

type JobRecord = {
  job_id: string
  status: JobStatus
  created_at?: string
  started_at?: string
  completed_at?: string
  error?: string | null
}

type ResultJson = {
  job_id: string
  status: string
  input: { text_chars: number }
  model?: { name?: string; source?: string }
  mesh?: { vertex_count?: number; surface?: string }
  prediction: {
    dtype: string
    shape: [number, number]
    normalized: boolean
  }
  time: {
    indices: number[]
    seconds: number[]
    durations_seconds: number[]
  }
  network_traces?: Record<string, number[]>
  heuristic_axes?: Record<string, number[]>
  summary: {
    global_mean_abs_by_timestep: number[]
    note?: string
  }
  events: { count: number }
}

type Region = {
  name: string
  start: number
  end: number
  color: string
  description: string
}

type RegionScore = Region & {
  score: number
  series: number[]
}

const REGIONS: Region[] = [
  {
    name: 'Visual cortex',
    start: 0,
    end: 0.15,
    color: '#2b7de9',
    description: 'Visual imagery, object cues, scene language',
  },
  {
    name: 'Auditory cortex',
    start: 0.15,
    end: 0.3,
    color: '#d95c39',
    description: 'Speech rhythm, sound-related imagery',
  },
  {
    name: 'Language areas',
    start: 0.3,
    end: 0.45,
    color: '#7a68d8',
    description: 'Lexical and syntactic processing',
  },
  {
    name: 'Prefrontal attention',
    start: 0.45,
    end: 0.62,
    color: '#129b72',
    description: 'Control, attention, goal tracking',
  },
  {
    name: 'Temporal memory',
    start: 0.62,
    end: 0.78,
    color: '#b1711e',
    description: 'Semantic memory and association',
  },
  {
    name: 'Limbic emotion',
    start: 0.78,
    end: 1,
    color: '#cf4a7d',
    description: 'Affective and motivational salience',
  },
]

const els = {
  apiBase: byId<HTMLInputElement>('api-base'),
  token: byId<HTMLInputElement>('bearer-token'),
  text: byId<HTMLTextAreaElement>('prompt-text'),
  run: byId<HTMLButtonElement>('run-button'),
  sample: byId<HTMLButtonElement>('sample-button'),
  status: byId<HTMLElement>('status'),
  statusDetail: byId<HTMLElement>('status-detail'),
  jobId: byId<HTMLElement>('job-id'),
  elapsed: byId<HTMLElement>('elapsed'),
  meta: byId<HTMLElement>('metadata'),
  regionGrid: byId<HTMLElement>('region-grid'),
  resultPanel: byId<HTMLElement>('result-panel'),
  timelineCanvas: byId<HTMLCanvasElement>('timeline-canvas'),
  brainCanvas: byId<HTMLCanvasElement>('brain-canvas'),
  timestep: byId<HTMLInputElement>('timestep'),
  timestepLabel: byId<HTMLElement>('timestep-label'),
  note: byId<HTMLElement>('result-note'),
  rawJson: byId<HTMLPreElement>('raw-json'),
}

const state: {
  result?: ResultJson
  preds?: Float32Array
  regionScores: RegionScore[]
  selectedTimestep: number
  poll?: number
  startedAt?: number
} = {
  regionScores: [],
  selectedTimestep: 0,
}

els.apiBase.value = localStorage.getItem('tribeApiBase') || '/api'
els.token.value = localStorage.getItem('tribeBearerToken') || ''

els.run.addEventListener('click', () => void submitText())
els.sample.addEventListener('click', () => {
  els.text.value =
    'Picture a creator opening with a sharp question, then moving through a vivid example, a surprising data point, and a concise call to action. The pacing is calm at first, then becomes more emotionally direct and visually concrete.'
})
els.timestep.addEventListener('input', () => {
  state.selectedTimestep = Number(els.timestep.value)
  renderAll()
})

void loadMetadata()
renderEmpty()

async function submitText() {
  const text = els.text.value.trim()
  if (!text) {
    setStatus('Needs input', 'Paste text before running inference.')
    return
  }

  localStorage.setItem('tribeApiBase', els.apiBase.value.trim())
  localStorage.setItem('tribeBearerToken', els.token.value.trim())
  resetResult()
  setBusy(true)
  setStatus('Submitting', 'Creating a text prediction job...')
  state.startedAt = Date.now()

  try {
    const job = await apiFetch<JobRecord>('/predict/text', {
      method: 'POST',
      body: JSON.stringify({ text }),
      headers: { 'Content-Type': 'application/json' },
    })
    els.jobId.textContent = job.job_id
    pollJob(job.job_id)
  } catch (error) {
    setBusy(false)
    setStatus('Request failed', readableError(error))
  }
}

function pollJob(jobId: string) {
  window.clearInterval(state.poll)
  state.poll = window.setInterval(() => void checkJob(jobId), 3000)
  void checkJob(jobId)
}

async function checkJob(jobId: string) {
  try {
    const job = await apiFetch<JobRecord>(`/jobs/${jobId}`)
    updateElapsed()
    if (job.status === 'queued' || job.status === 'running') {
      setStatus(job.status === 'queued' ? 'Queued' : 'Running', 'The CPU worker is processing one job at a time.')
      return
    }
    window.clearInterval(state.poll)
    if (job.status === 'failed') {
      setBusy(false)
      setStatus('Failed', job.error || 'The API reported a failed job.')
      return
    }
    setStatus('Fetching result', 'Downloading reduced metadata and prediction blob...')
    await loadResult(jobId)
    setBusy(false)
    setStatus('Complete', 'Prediction ready.')
  } catch (error) {
    window.clearInterval(state.poll)
    setBusy(false)
    setStatus('Polling failed', readableError(error))
  }
}

async function loadResult(jobId: string) {
  const result = await apiFetch<ResultJson>(`/jobs/${jobId}/result.json`)
  const blob = await apiFetch<ArrayBuffer>(`/jobs/${jobId}/preds.norm.f16.bin`, undefined, 'arrayBuffer')
  state.result = result
  state.preds = decodeFloat16Array(blob)
  state.selectedTimestep = 0
  state.regionScores = computeRegionScores(result, state.preds)
  els.timestep.max = String(Math.max(0, result.prediction.shape[0] - 1))
  els.timestep.value = '0'
  els.resultPanel.hidden = false
  els.rawJson.textContent = JSON.stringify(result, null, 2)
  renderAll()
}

async function loadMetadata() {
  try {
    const data = await apiFetch<Record<string, unknown>>('/metadata')
    els.meta.textContent = JSON.stringify(data, null, 2)
  } catch {
    els.meta.textContent = 'Metadata will appear after the API is reachable.'
  }
}

function computeRegionScores(result: ResultJson, preds: Float32Array): RegionScore[] {
  const [timesteps, vertices] = result.prediction.shape
  if (!timesteps || !vertices || preds.length !== timesteps * vertices) return []

  const globalMax = Math.max(...sampleAbsMeans(preds, timesteps, vertices), 1e-8)
  return REGIONS.map((region) => {
    const half = Math.floor(vertices / 2)
    const start = Math.floor(half * region.start)
    const end = Math.max(start + 1, Math.floor(half * region.end))
    const series: number[] = []
    for (let t = 0; t < timesteps; t += 1) {
      let sum = 0
      let count = 0
      const row = t * vertices
      for (let v = start; v < end; v += 1) {
        sum += Math.abs(preds[row + v]) + Math.abs(preds[row + half + v])
        count += 2
      }
      series.push(count ? sum / count / globalMax : 0)
    }
    const score = series.reduce((acc, value) => acc + value, 0) / Math.max(1, series.length)
    return { ...region, score, series }
  }).sort((a, b) => b.score - a.score)
}

function sampleAbsMeans(preds: Float32Array, timesteps: number, vertices: number): number[] {
  const means: number[] = []
  const stride = Math.max(1, Math.floor(vertices / 1024))
  for (let t = 0; t < timesteps; t += 1) {
    let sum = 0
    let count = 0
    const row = t * vertices
    for (let v = 0; v < vertices; v += stride) {
      sum += Math.abs(preds[row + v])
      count += 1
    }
    means.push(count ? sum / count : 0)
  }
  return means
}

function renderAll() {
  const result = state.result
  if (!result) return
  const t = Math.min(state.selectedTimestep, result.prediction.shape[0] - 1)
  const seconds = Math.max(0, result.time.seconds[t] ?? t)
  els.timestepLabel.textContent = `TR ${t + 1}/${result.prediction.shape[0]} at ${seconds.toFixed(1)}s`
  els.note.textContent =
    result.summary.note ||
    'Region scores are approximate frontend reductions until the API exposes atlas-backed Yeo7 and Destrieux outputs.'
  els.statusDetail.textContent = `${result.prediction.shape[0]} timesteps, ${result.prediction.shape[1].toLocaleString()} vertices, ${result.events.count} events`
  renderCards(t)
  renderTimeline(t)
  renderBrain(t)
}

function renderCards(t: number) {
  els.regionGrid.innerHTML = state.regionScores
    .map((region) => {
      const current = region.series[t] ?? 0
      const pct = Math.max(0, Math.min(100, region.score * 100))
      const currentPct = Math.max(0, Math.min(100, current * 100))
      return `
        <article class="region-card">
          <div class="region-head">
            <span class="swatch" style="background:${region.color}"></span>
            <div>
              <h3>${escapeHtml(region.name)}</h3>
              <p>${escapeHtml(region.description)}</p>
            </div>
          </div>
          <strong>${pct.toFixed(1)}</strong>
          <div class="meter" style="--meter:${pct}%;--color:${region.color}"><span></span></div>
          <small>Current timestep ${currentPct.toFixed(1)}</small>
        </article>
      `
    })
    .join('')
}

function renderTimeline(selected: number) {
  const result = state.result
  const canvas = els.timelineCanvas
  if (!result) return
  const ctx = get2d(canvas)
  const width = canvas.width = canvas.clientWidth * devicePixelRatio
  const height = canvas.height = canvas.clientHeight * devicePixelRatio
  ctx.scale(devicePixelRatio, devicePixelRatio)
  const w = width / devicePixelRatio
  const h = height / devicePixelRatio
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#f7f7f3'
  ctx.fillRect(0, 0, w, h)

  const series = result.summary.global_mean_abs_by_timestep
  const max = Math.max(...series, 1e-8)
  drawSeries(ctx, series.map((value) => value / max), '#111827', 24, h - 30, w)
  state.regionScores.slice(0, 4).forEach((region, index) => {
    drawSeries(ctx, region.series, region.color, 24 + index * 5, h - 36 - index * 5, w)
  })

  const x = series.length <= 1 ? 0 : (selected / (series.length - 1)) * w
  ctx.strokeStyle = '#dc2626'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x, h)
  ctx.stroke()
  ctx.fillStyle = '#374151'
  ctx.font = '12px ui-monospace, monospace'
  ctx.fillText('global + top region traces', 12, 18)
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  series: number[],
  color: string,
  top: number,
  bottom: number,
  width: number,
) {
  if (series.length < 2) return
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  series.forEach((value, index) => {
    const x = (index / (series.length - 1)) * width
    const y = bottom - Math.max(0, Math.min(1, value)) * (bottom - top)
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
}

function renderBrain(t: number) {
  const canvas = els.brainCanvas
  const ctx = get2d(canvas)
  const width = canvas.width = canvas.clientWidth * devicePixelRatio
  const height = canvas.height = canvas.clientHeight * devicePixelRatio
  ctx.scale(devicePixelRatio, devicePixelRatio)
  const w = width / devicePixelRatio
  const h = height / devicePixelRatio
  ctx.clearRect(0, 0, w, h)

  const cx = w / 2
  const cy = h / 2
  const brainW = Math.min(w * 0.74, 560)
  const brainH = Math.min(h * 0.72, 250)
  drawHemisphere(ctx, cx - brainW * 0.27, cy, brainW * 0.48, brainH, false, t)
  drawHemisphere(ctx, cx + brainW * 0.27, cy, brainW * 0.48, brainH, true, t)
  ctx.fillStyle = '#6b7280'
  ctx.font = '12px ui-monospace, monospace'
  ctx.fillText('Approximate cortical bands from normalized fsaverage5 vertex blob', 18, h - 18)
}

function drawHemisphere(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  right: boolean,
  t: number,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(right ? 1 : -1, 1)
  ctx.beginPath()
  ctx.moveTo(-w * 0.45, h * 0.08)
  ctx.bezierCurveTo(-w * 0.54, -h * 0.44, w * 0.22, -h * 0.62, w * 0.48, -h * 0.1)
  ctx.bezierCurveTo(w * 0.68, h * 0.28, w * 0.16, h * 0.58, -w * 0.32, h * 0.36)
  ctx.bezierCurveTo(-w * 0.48, h * 0.28, -w * 0.5, h * 0.18, -w * 0.45, h * 0.08)
  ctx.closePath()
  ctx.fillStyle = '#ece8dd'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = '#c8c1b5'
  ctx.stroke()
  ctx.clip()

  state.regionScores.forEach((region, index) => {
    const intensity = Math.max(0, Math.min(1, region.series[t] ?? region.score))
    const x = -w * 0.42 + (index / Math.max(1, REGIONS.length - 1)) * w * 0.82
    const y = Math.sin(index * 1.4) * h * 0.17
    const radius = (0.15 + intensity * 0.24) * Math.min(w, h)
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, hexToRgba(region.color, 0.84))
    gradient.addColorStop(1, hexToRgba(region.color, 0))
    ctx.fillStyle = gradient
    ctx.fillRect(-w, -h, w * 2, h * 2)
  })

  ctx.globalAlpha = 0.22
  ctx.strokeStyle = '#514b45'
  ctx.lineWidth = 2
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath()
    ctx.moveTo(-w * 0.35 + i * w * 0.12, -h * 0.32)
    ctx.bezierCurveTo(-w * 0.52 + i * w * 0.15, -h * 0.06, -w * 0.24 + i * w * 0.12, h * 0.14, -w * 0.32 + i * w * 0.14, h * 0.34)
    ctx.stroke()
  }
  ctx.restore()
}

function renderEmpty() {
  els.regionGrid.innerHTML = REGIONS.map((region) => `
    <article class="region-card muted-card">
      <div class="region-head">
        <span class="swatch" style="background:${region.color}"></span>
        <div>
          <h3>${escapeHtml(region.name)}</h3>
          <p>${escapeHtml(region.description)}</p>
        </div>
      </div>
      <strong>--</strong>
      <div class="meter" style="--meter:0%;--color:${region.color}"><span></span></div>
      <small>Waiting for prediction</small>
    </article>
  `).join('')
}

function resetResult() {
  window.clearInterval(state.poll)
  state.result = undefined
  state.preds = undefined
  state.regionScores = []
  state.selectedTimestep = 0
  els.jobId.textContent = '--'
  els.elapsed.textContent = '--'
  els.resultPanel.hidden = true
  els.rawJson.textContent = ''
  renderEmpty()
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  mode: 'json' | 'arrayBuffer' = 'json',
): Promise<T> {
  const base = els.apiBase.value.trim().replace(/\/$/, '')
  const url = `${base}${path}`
  const headers = new Headers(init?.headers)
  const token = els.token.value.trim()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${body}`)
  }
  return (mode === 'arrayBuffer' ? response.arrayBuffer() : response.json()) as Promise<T>
}

function decodeFloat16Array(buffer: ArrayBuffer): Float32Array {
  const input = new Uint16Array(buffer)
  const output = new Float32Array(input.length)
  for (let i = 0; i < input.length; i += 1) {
    output[i] = halfToFloat(input[i])
  }
  return output
}

function halfToFloat(value: number): number {
  const sign = (value & 0x8000) ? -1 : 1
  const exponent = (value >> 10) & 0x1f
  const fraction = value & 0x03ff
  if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024)
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024)
}

function setBusy(busy: boolean) {
  els.run.disabled = busy
  els.run.textContent = busy ? 'Running...' : 'Run text inference'
}

function setStatus(status: string, detail: string) {
  els.status.textContent = status
  els.statusDetail.textContent = detail
}

function updateElapsed() {
  if (!state.startedAt) return
  els.elapsed.textContent = `${Math.round((Date.now() - state.startedAt) / 1000)}s`
}

function get2d(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is unavailable.')
  return ctx
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '')
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}

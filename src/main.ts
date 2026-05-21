import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

type JobRecord = {
  job_id: string
  status: JobStatus
  created_at?: string
  started_at?: string
  completed_at?: string
  error?: string | null
  phase?: string
  phase_detail?: string
  progress_percent?: number
  processed_segments?: number | null
  total_segments?: number | null
  kept_segments?: number | null
  logs_tail?: string[]
}

type ResultJson = {
  job_id: string
  status: string
  created_at?: string
  started_at?: string
  completed_at?: string
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
  cognitive_domains?: {
    scores: Record<string, number>
    time_series: Record<string, number[]>
    descriptions?: Record<string, string>
    metadata?: Record<string, unknown>
  }
  interpretive_axes?: {
    scores: Record<string, number>
    time_series: Record<string, number[]>
    metadata?: {
      interpretive?: boolean
      warning?: string
      [key: string]: unknown
    }
  }
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
  category: 'domain' | 'axis'
  interpretive?: boolean
}

type StoredRun = {
  jobId: string
  status: JobStatus
  apiBase: string
  textPreview: string
  textChars: number
  createdAt: string
  updatedAt: string
  elapsedSeconds?: number
  result?: ResultJson
  predictionBinBase64?: string
  error?: string | null
}

type MeshData = {
  vL: Float32Array
  fL: Uint32Array
  sL: Float32Array
  vR: Float32Array
  fR: Uint32Array
  sR: Float32Array
  nVL: number
  nVR: number
}

type BrainHemi = {
  mesh: THREE.Mesh
  colors: Float32Array
  sulc: Float32Array
  smin: number
  span: number
  nV: number
}

type BrainViewer = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  hemis: BrainHemi[]
  resizeObserver: ResizeObserver
}

const HISTORY_KEY = 'tribeRunHistory.v1'
const MAX_HISTORY = 12

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
  progressFill: byId<HTMLElement>('progress-fill'),
  progressMeta: byId<HTMLElement>('progress-meta'),
  jobId: byId<HTMLElement>('job-id'),
  elapsed: byId<HTMLElement>('elapsed'),
  lastUpdate: byId<HTMLElement>('last-update'),
  historyList: byId<HTMLElement>('history-list'),
  clearHistory: byId<HTMLButtonElement>('clear-history-button'),
  meta: byId<HTMLElement>('metadata'),
  regionGrid: byId<HTMLElement>('region-grid'),
  resultPanel: byId<HTMLElement>('result-panel'),
  timelineCanvas: byId<HTMLCanvasElement>('timeline-canvas'),
  brainCanvas: byId<HTMLCanvasElement>('brain-canvas'),
  brainThreshold: byId<HTMLInputElement>('brain-threshold'),
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
  activeJobId?: string
  activeTextPreview?: string
  brain?: BrainViewer
} = {
  regionScores: [],
  selectedTimestep: 0,
}

els.apiBase.value = localStorage.getItem('tribeApiBase') || '/api'
els.token.value = localStorage.getItem('tribeBearerToken') || ''

els.run.addEventListener('click', () => void submitText())
els.clearHistory.addEventListener('click', clearHistory)
els.sample.addEventListener('click', () => {
  els.text.value =
    'Picture a creator opening with a sharp question, then moving through a vivid example, a surprising data point, and a concise call to action. The pacing is calm at first, then becomes more emotionally direct and visually concrete.'
})
els.timestep.addEventListener('input', () => {
  state.selectedTimestep = Number(els.timestep.value)
  renderAll()
})
els.brainThreshold.addEventListener('input', () => renderBrain(state.selectedTimestep))

void loadMetadata()
renderEmpty()
renderHistory()
resumeNewestUnfinishedRun()

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
  state.activeTextPreview = text.slice(0, 140)

  try {
    const job = await apiFetch<JobRecord>('/predict/text', {
      method: 'POST',
      body: JSON.stringify({ text }),
      headers: { 'Content-Type': 'application/json' },
    })
    els.jobId.textContent = job.job_id
    state.activeJobId = job.job_id
    upsertRun({
      jobId: job.job_id,
      status: job.status,
      apiBase: currentApiBase(),
      textPreview: state.activeTextPreview,
      textChars: text.length,
      createdAt: job.created_at || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
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
    renderProgress(job)
    if (job.status === 'queued' || job.status === 'running') {
      setStatus(
        job.status === 'queued' ? 'Queued' : 'Running',
        job.phase_detail || 'The CPU worker is processing one job at a time.',
      )
      upsertRun({
        jobId,
        status: job.status,
        apiBase: currentApiBase(),
        textPreview: existingRun(jobId)?.textPreview || state.activeTextPreview || 'Text run',
        textChars: existingRun(jobId)?.textChars || 0,
        createdAt: job.created_at || existingRun(jobId)?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        elapsedSeconds: elapsedSeconds(),
      })
      return
    }
    window.clearInterval(state.poll)
    if (job.status === 'failed') {
      setBusy(false)
      setStatus('Failed', job.error || 'The API reported a failed job.')
      upsertRun({
        jobId,
        status: 'failed',
        apiBase: currentApiBase(),
        textPreview: existingRun(jobId)?.textPreview || state.activeTextPreview || 'Text run',
        textChars: existingRun(jobId)?.textChars || 0,
        createdAt: job.created_at || existingRun(jobId)?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        elapsedSeconds: elapsedSeconds(),
        error: job.error,
      })
      return
    }
    setStatus('Fetching result', 'Downloading reduced metadata and prediction blob...')
    await loadResult(jobId)
    setBusy(false)
    setStatus('Complete', 'Prediction ready.')
    els.progressFill.style.width = '100%'
    els.progressMeta.textContent = '100% · completed'
  } catch (error) {
    window.clearInterval(state.poll)
    setBusy(false)
    setStatus('Polling failed', readableError(error))
  }
}

async function loadResult(jobId: string) {
  const result = await apiFetch<ResultJson>(`/jobs/${jobId}/result.json`)
  const blob = await apiFetch<ArrayBuffer>(`/jobs/${jobId}/preds.norm.f16.bin`, undefined, 'arrayBuffer')
  applyResult(result, blob)
  upsertRun({
    jobId,
    status: 'completed',
    apiBase: currentApiBase(),
    textPreview: existingRun(jobId)?.textPreview || state.activeTextPreview || 'Text run',
    textChars: result.input.text_chars,
    createdAt: result.created_at || existingRun(jobId)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    elapsedSeconds: elapsedSecondsFromResult(result) ?? elapsedSeconds(),
    result,
    predictionBinBase64: arrayBufferToBase64(blob),
  })
}

function applyResult(result: ResultJson, blob: ArrayBuffer) {
  state.result = result
  state.preds = decodeFloat16Array(blob)
  state.activeJobId = result.job_id
  state.selectedTimestep = 0
  state.regionScores = computeRegionScores(result, state.preds)
  els.timestep.max = String(Math.max(0, result.prediction.shape[0] - 1))
  els.timestep.value = '0'
  els.resultPanel.hidden = false
  els.rawJson.textContent = JSON.stringify(result, null, 2)
  els.jobId.textContent = result.job_id
  els.elapsed.textContent = `${elapsedSecondsFromResult(result) ?? elapsedSeconds()}s`
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
  if (result.cognitive_domains?.scores && Object.keys(result.cognitive_domains.scores).length) {
    const descriptions = result.cognitive_domains.descriptions || {}
    const domains = Object.entries(result.cognitive_domains.scores)
      .filter(([name]) => name !== 'Overall Impact')
      .map(([name, score], index) => ({
        name,
        start: 0,
        end: 1,
        color: palette(index),
        description: descriptions[name] || 'Atlas-backed cognitive domain from predicted activation.',
        score,
        series: result.cognitive_domains?.time_series?.[name] || [],
        category: 'domain' as const,
      }))

    const axes = Object.entries(result.interpretive_axes?.scores || {}).map(([name, score], index) => ({
      name,
      start: 0,
      end: 1,
      color: palette(index + domains.length),
      description: 'Interpretive proxy derived from cognitive-domain activation. Not a direct emotion measurement.',
      score,
      series: result.interpretive_axes?.time_series?.[name] || [],
      category: 'axis' as const,
      interpretive: true,
    }))
    return [...domains, ...axes].sort((a, b) => b.score - a.score)
  }

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
    return { ...region, score, series, category: 'domain' as const }
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
    'Destrieux cognitive domains and interpretive proxy axes are included when exposed by the API. Yeo7 network reductions remain a future extension.'
  els.statusDetail.textContent = `${result.prediction.shape[0]} timesteps, ${result.prediction.shape[1].toLocaleString()} vertices, ${result.events.count} events`
  els.lastUpdate.textContent = formatTime(new Date())
  renderCards(t)
  renderTimeline(t)
  renderBrain(t)
}

function renderProgress(job: JobRecord) {
  const pct = Math.max(0, Math.min(100, job.progress_percent ?? 0))
  els.progressFill.style.width = `${pct}%`
  const segmentText =
    job.total_segments && job.processed_segments != null
      ? ` · ${job.processed_segments}/${job.total_segments} segments`
      : ''
  els.progressMeta.textContent = `${pct}% · ${job.phase || job.status}${segmentText}`
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
          <small>${region.interpretive ? 'Interpretive proxy' : 'Atlas domain'} · current ${currentPct.toFixed(1)}</small>
        </article>
      `
    })
    .join('')
}

function palette(index: number) {
  const colors = ['#2b7de9', '#d95c39', '#129b72', '#7a68d8', '#b1711e', '#cf4a7d', '#1d8a99', '#96532f', '#4f7b2d', '#a43f63', '#5260c8', '#c18415', '#475569']
  return colors[index % colors.length]
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
  if (!state.preds || !state.result) return
  if (!hasWebgl()) {
    drawFallbackBrain(t)
    return
  }
  if (!state.brain) {
    void initBrainViewer()
      .then(() => applyBrainColors(t))
      .catch(() => drawFallbackBrain(t))
    return
  }
  applyBrainColors(t)
}

function hasWebgl() {
  const canvas = document.createElement('canvas')
  return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
}

async function initBrainViewer() {
  const mesh = await fetchMesh(`${currentApiBase()}/mesh/fsaverage5.bin`)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf8f5ed)
  const width = els.brainCanvas.clientWidth || 800
  const height = els.brainCanvas.clientHeight || 360
  const camera = new THREE.PerspectiveCamera(35, width / height, 1, 5000)
  const renderer = new THREE.WebGLRenderer({ canvas: els.brainCanvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  const controls = new OrbitControls(camera, els.brainCanvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.1
  scene.add(new THREE.AmbientLight(0xffffff, 0.65))
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9)
  keyLight.position.set(80, 140, 220)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xd4e1ff, 0.35)
  fillLight.position.set(-120, -60, 120)
  scene.add(fillLight)

  const hemis = [
    buildHemi(mesh.vL, mesh.fL, mesh.sL, mesh.nVL, scene),
    buildHemi(mesh.vR, mesh.fR, mesh.sR, mesh.nVR, scene),
  ]
  const box = new THREE.Box3()
  hemis.forEach((hemi) => box.expandByObject(hemi.mesh))
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3()).length()
  controls.target.copy(center)
  camera.position.set(center.x, center.y + size * 0.08, center.z + size * 1.08)
  camera.lookAt(center)

  const resizeObserver = new ResizeObserver(() => {
    const nextWidth = els.brainCanvas.clientWidth || width
    const nextHeight = els.brainCanvas.clientHeight || height
    renderer.setSize(nextWidth, nextHeight, false)
    camera.aspect = nextWidth / nextHeight
    camera.updateProjectionMatrix()
  })
  resizeObserver.observe(els.brainCanvas)

  state.brain = { scene, camera, renderer, controls, hemis, resizeObserver }
  const loop = () => {
    if (!state.brain) return
    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(loop)
  }
  loop()
}

function drawFallbackBrain(t: number) {
  if (!state.preds || !state.result) return
  state.brain?.resizeObserver.disconnect()
  state.brain = undefined
  const canvas = els.brainCanvas
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(320, Math.floor(rect.width || canvas.clientWidth || 760))
  const height = Math.max(260, Math.floor(rect.height || canvas.clientHeight || 340))
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#f8f5ed'
  ctx.fillRect(0, 0, width, height)

  const [timesteps, vertices] = state.result.prediction.shape
  const idx = Math.max(0, Math.min(timesteps - 1, t))
  const rowStart = idx * vertices
  const half = Math.floor(vertices / 2)
  const threshold = Number(els.brainThreshold.value)
  const left = sampleActivationBuckets(rowStart, 0, half, 9)
  const right = sampleActivationBuckets(rowStart, half, vertices - half, 9)

  drawHemisphereFallback(ctx, width * 0.35, height * 0.52, width * 0.24, height * 0.34, left, threshold, 'L')
  drawHemisphereFallback(ctx, width * 0.65, height * 0.52, width * 0.24, height * 0.34, right, threshold, 'R')

  ctx.fillStyle = '#6b6257'
  ctx.font = '12px ui-monospace, monospace'
  ctx.fillText('2D fallback active: WebGL is unavailable in this browser session.', 18, height - 18)
}

function sampleActivationBuckets(rowStart: number, offset: number, length: number, buckets: number) {
  if (!state.preds) return []
  const values: number[] = []
  const bucketSize = Math.max(1, Math.floor(length / buckets))
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = rowStart + offset + bucket * bucketSize
    const end = Math.min(rowStart + offset + length, start + bucketSize)
    let peak = 0
    let count = 0
    for (let i = start; i < end; i += 29) {
      peak = Math.max(peak, state.preds[i] || 0)
      count += 1
    }
    values.push(count ? peak : 0)
  }
  return values
}

function drawHemisphereFallback(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  values: number[],
  threshold: number,
  label: string,
) {
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.clip()
  const sulci = 16
  for (let i = 0; i < sulci; i += 1) {
    const y = cy - ry + (i / (sulci - 1)) * ry * 2
    const shade = i % 2 ? '#d7d0c4' : '#eee8dc'
    ctx.strokeStyle = shade
    ctx.lineWidth = 9
    ctx.beginPath()
    ctx.moveTo(cx - rx * 0.9, y)
    ctx.bezierCurveTo(cx - rx * 0.35, y - 18, cx + rx * 0.35, y + 18, cx + rx * 0.9, y)
    ctx.stroke()
  }
  const points = [
    [-0.45, -0.45], [0, -0.5], [0.42, -0.38],
    [-0.55, 0], [-0.02, 0.03], [0.5, 0.05],
    [-0.38, 0.45], [0.08, 0.5], [0.48, 0.38],
  ]
  values.forEach((value, index) => {
    if (value < threshold) return
    const point = points[index] || [0, 0]
    const intensity = (value - threshold) / Math.max(1e-9, 1 - threshold)
    const [r, g, b] = fireColor(intensity)
    const radius = 22 + intensity * 48
    const gradient = ctx.createRadialGradient(
      cx + point[0] * rx,
      cy + point[1] * ry,
      0,
      cx + point[0] * rx,
      cy + point[1] * ry,
      radius,
    )
    gradient.addColorStop(0, `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.88)`)
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx + point[0] * rx, cy + point[1] * ry, radius, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.restore()
  ctx.strokeStyle = '#9d9284'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#28231f'
  ctx.font = '700 13px ui-monospace, monospace'
  ctx.fillText(label, cx - 4, cy + 4)
}

function buildHemi(
  verts: Float32Array,
  faces: Uint32Array,
  sulc: Float32Array,
  nV: number,
  scene: THREE.Scene,
): BrainHemi {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  geometry.setIndex(new THREE.BufferAttribute(faces, 1))
  geometry.computeVertexNormals()
  const colors = new Float32Array(nV * 3)
  const smin = Math.min(...sulc)
  const smax = Math.max(...sulc)
  const span = Math.max(1e-9, smax - smin)
  for (let i = 0; i < nV; i += 1) {
    const base = sulcBase(sulc[i], smin, span)
    colors[i * 3] = base
    colors[i * 3 + 1] = base
    colors[i * 3 + 2] = base
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  scene.add(mesh)
  return { mesh, colors, sulc, smin, span, nV }
}

function applyBrainColors(t: number) {
  if (!state.brain || !state.preds || !state.result) return
  const [timesteps, vertices] = state.result.prediction.shape
  const idx = Math.max(0, Math.min(timesteps - 1, t))
  const threshold = Number(els.brainThreshold.value)
  let cursor = 0
  for (const hemi of state.brain.hemis) {
    for (let i = 0; i < hemi.nV; i += 1) {
      const activation = state.preds[idx * vertices + cursor + i] || 0
      const color = activation < threshold
        ? [sulcBase(hemi.sulc[i], hemi.smin, hemi.span), sulcBase(hemi.sulc[i], hemi.smin, hemi.span), sulcBase(hemi.sulc[i], hemi.smin, hemi.span)]
        : fireColor((activation - threshold) / Math.max(1e-9, 1 - threshold))
      hemi.colors[i * 3] = color[0]
      hemi.colors[i * 3 + 1] = color[1]
      hemi.colors[i * 3 + 2] = color[2]
    }
    const colorAttr = hemi.mesh.geometry.getAttribute('color') as THREE.BufferAttribute
    colorAttr.needsUpdate = true
    cursor += hemi.nV
  }
}

function sulcBase(value: number, min: number, span: number) {
  const t = (value - min) / span
  return 0.38 + (1 - t) * 0.38
}

function fireColor(value: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, value))
  if (t < 0.33) return [t / 0.33, 0.05, 0.02]
  if (t < 0.66) return [1, (t - 0.33) / 0.33, 0.03]
  return [1, 1, (t - 0.66) / 0.34]
}

async function fetchMesh(url: string): Promise<MeshData> {
  const buffer = await fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Mesh request failed: ${response.status}`)
    return response.arrayBuffer()
  })
  const view = new DataView(buffer)
  let offset = 0
  const nVL = view.getUint32(offset, true); offset += 4
  const nFL = view.getUint32(offset, true); offset += 4
  const nVR = view.getUint32(offset, true); offset += 4
  const nFR = view.getUint32(offset, true); offset += 4
  const vL = new Float32Array(buffer, offset, nVL * 3); offset += nVL * 3 * 4
  const fL = new Uint32Array(buffer, offset, nFL * 3); offset += nFL * 3 * 4
  const sL = new Float32Array(buffer, offset, nVL); offset += nVL * 4
  const vR = new Float32Array(buffer, offset, nVR * 3); offset += nVR * 3 * 4
  const fR = new Uint32Array(buffer, offset, nFR * 3); offset += nFR * 3 * 4
  const sR = new Float32Array(buffer, offset, nVR)
  return { vL, fL, sL, vR, fR, sR, nVL, nVR }
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
  els.lastUpdate.textContent = '--'
  els.progressFill.style.width = '0%'
  els.progressMeta.textContent = '0% · waiting'
  els.resultPanel.hidden = true
  els.rawJson.textContent = ''
  renderEmpty()
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  mode: 'json' | 'arrayBuffer' = 'json',
): Promise<T> {
  const base = currentApiBase().replace(/\/$/, '')
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
  els.lastUpdate.textContent = formatTime(new Date())
}

function resumeNewestUnfinishedRun() {
  const run = getHistory().find((item) => item.status === 'queued' || item.status === 'running')
  if (!run) return
  els.apiBase.value = run.apiBase || els.apiBase.value
  els.jobId.textContent = run.jobId
  state.activeJobId = run.jobId
  state.activeTextPreview = run.textPreview
  state.startedAt = Date.now() - (run.elapsedSeconds || 0) * 1000
  setBusy(true)
  setStatus('Resuming', `Checking unfinished job from ${formatDateTime(run.updatedAt)}.`)
  pollJob(run.jobId)
}

function getHistory(): StoredRun[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(runs: StoredRun[]) {
  const trimmed = runs
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_HISTORY)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
  } catch {
    const lighter = trimmed.map((run) => ({ ...run, predictionBinBase64: undefined }))
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(lighter))
    } catch {
      const metadataOnly = lighter.map((run) => ({ ...run, result: undefined }))
      localStorage.setItem(HISTORY_KEY, JSON.stringify(metadataOnly.slice(0, 6)))
    }
  }
  renderHistory()
}

function upsertRun(run: StoredRun) {
  const runs = getHistory().filter((item) => item.jobId !== run.jobId)
  saveHistory([{ ...existingRun(run.jobId), ...run }, ...runs])
}

function existingRun(jobId: string): StoredRun | undefined {
  return getHistory().find((run) => run.jobId === jobId)
}

function renderHistory() {
  const runs = getHistory()
  if (!runs.length) {
    els.historyList.innerHTML = '<p class="note">Completed and in-progress jobs will appear here.</p>'
    return
  }
  els.historyList.innerHTML = runs
    .map((run) => `
      <article class="history-item" data-job-id="${escapeHtml(run.jobId)}">
        <button class="history-main" type="button" data-history-open="${escapeHtml(run.jobId)}">
          <span class="history-title">${escapeHtml(run.textPreview || run.jobId)}</span>
          <span class="history-meta">${escapeHtml(run.status)} · ${run.textChars || 0} chars · ${formatDateTime(run.updatedAt)}</span>
        </button>
        <button class="history-delete" type="button" data-history-delete="${escapeHtml(run.jobId)}" aria-label="Delete ${escapeHtml(run.jobId)}">×</button>
      </article>
    `)
    .join('')

  els.historyList.querySelectorAll<HTMLButtonElement>('[data-history-open]').forEach((button) => {
    button.addEventListener('click', () => void openStoredRun(button.dataset.historyOpen || ''))
  })
  els.historyList.querySelectorAll<HTMLButtonElement>('[data-history-delete]').forEach((button) => {
    button.addEventListener('click', () => deleteRun(button.dataset.historyDelete || ''))
  })
}

async function openStoredRun(jobId: string) {
  const run = existingRun(jobId)
  if (!run) return
  els.apiBase.value = run.apiBase || els.apiBase.value
  els.jobId.textContent = run.jobId
  els.elapsed.textContent = run.elapsedSeconds ? `${run.elapsedSeconds}s` : '--'
  els.lastUpdate.textContent = formatDateTime(run.updatedAt)

  if (run.status === 'completed' && run.result && run.predictionBinBase64) {
    setStatus('Loaded saved run', 'Result restored from local storage.')
    els.progressFill.style.width = '100%'
    els.progressMeta.textContent = '100% · completed'
    applyResult(run.result, base64ToArrayBuffer(run.predictionBinBase64))
    return
  }

  if (run.status === 'completed') {
    setStatus('Fetching saved run', 'Prediction blob was not stored locally, trying the API.')
    await loadResult(run.jobId)
    setStatus('Complete', 'Prediction ready.')
    return
  }

  if (run.status === 'failed') {
    resetResult()
    els.jobId.textContent = run.jobId
    setStatus('Failed', run.error || 'This saved job failed.')
    return
  }

  resetResult()
  els.jobId.textContent = run.jobId
  state.startedAt = Date.now() - (run.elapsedSeconds || 0) * 1000
  setBusy(true)
  setStatus('Resuming', 'Polling saved in-progress job.')
  pollJob(run.jobId)
}

function deleteRun(jobId: string) {
  saveHistory(getHistory().filter((run) => run.jobId !== jobId))
  if (state.activeJobId === jobId) {
    resetResult()
    setStatus('Idle', 'Deleted the active saved run.')
  }
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY)
  renderHistory()
}

function currentApiBase() {
  return els.apiBase.value.trim() || '/api'
}

function elapsedSeconds() {
  if (!state.startedAt) return 0
  return Math.round((Date.now() - state.startedAt) / 1000)
}

function elapsedSecondsFromResult(result: ResultJson): number | undefined {
  const start = Date.parse(result.started_at || result.created_at || '')
  const end = Date.parse(result.completed_at || '')
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined
  return Math.max(0, Math.round((end - start) / 1000))
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function base64ToArrayBuffer(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'unknown'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function get2d(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is unavailable.')
  return ctx
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

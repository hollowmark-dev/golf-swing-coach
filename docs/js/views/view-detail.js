import { getSession, getLandmarks, getMetrics, getAdvice, listMetricsForAngle } from '../db.js';
import { getVideoBlob } from '../storage-opfs.js';
import { METRIC_CONFIG } from '../advice/rules-full.js';

const MIN_TREND_POINTS = 2;

function drawSparkline(canvas, values, highlightIndex) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (values.length === 0) return;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 6;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const yFor = (v) => h - pad - ((v - min) / range) * (h - pad * 2);

  ctx.strokeStyle = '#5fd97a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = yFor(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  values.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = yFor(v);
    const isCurrent = i === highlightIndex;
    ctx.beginPath();
    ctx.fillStyle = isCurrent ? '#eaf0ea' : '#2f7a45';
    ctx.arc(x, y, isCurrent ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

export async function init(root, sessionId) {
  const titleEl = root.querySelector('#detail-title');
  const videoEl = root.querySelector('#detail-video');
  const canvasEl = root.querySelector('#detail-overlay');
  const jumpImpactBtn = root.querySelector('#detail-jump-impact');
  const metricsEl = root.querySelector('#detail-metrics');
  const trendsEl = root.querySelector('#detail-trends');
  const adviceEl = root.querySelector('#detail-advice');
  const ctx = canvasEl.getContext('2d');

  if (!sessionId) {
    titleEl.textContent = 'セッションが指定されていません';
    return;
  }

  const session = await getSession(sessionId);
  if (!session) {
    titleEl.textContent = 'セッションが見つかりませんでした';
    return;
  }

  const date = new Date(session.createdAt);
  titleEl.textContent = date.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });

  const [videoFile, frames, metrics, advice, angleHistory] = await Promise.all([
    getVideoBlob(sessionId),
    getLandmarks(sessionId),
    getMetrics(sessionId),
    getAdvice(sessionId),
    listMetricsForAngle(session.cameraAngle), // 除外なし = 同一アングルのdone済み全セッション(自分自身含む)
  ]);

  let objectUrl = null;
  if (videoFile) {
    objectUrl = URL.createObjectURL(videoFile);
    videoEl.src = objectUrl;
  } else {
    videoEl.replaceWith(document.createTextNode('動画データが見つかりませんでした。'));
  }

  if (session.impactTimestampMs != null && videoFile) {
    jumpImpactBtn.hidden = false;
    jumpImpactBtn.addEventListener('click', () => {
      videoEl.currentTime = session.impactTimestampMs / 1000;
      videoEl.pause();
    });
  }

  function resizeCanvas() {
    canvasEl.width = videoEl.clientWidth;
    canvasEl.height = videoEl.clientHeight;
  }
  videoEl.addEventListener('loadedmetadata', resizeCanvas);
  window.addEventListener('resize', resizeCanvas);

  function findNearestFrame(tMs) {
    if (!frames || frames.length === 0) return null;
    let nearest = frames[0];
    let bestDiff = Math.abs(frames[0].tMs - tMs);
    for (const frame of frames) {
      const diff = Math.abs(frame.tMs - tMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = frame;
      }
    }
    return nearest;
  }

  function drawSkeleton() {
    if (!frames || canvasEl.width === 0) return;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    const frame = findNearestFrame(videoEl.currentTime * 1000);
    if (!frame) return;
    ctx.fillStyle = '#5fd97a';
    for (const point of frame.points) {
      if (point == null) continue;
      const x = point.x * canvasEl.width;
      const y = point.y * canvasEl.height;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  videoEl.addEventListener('timeupdate', drawSkeleton);
  videoEl.addEventListener('seeked', drawSkeleton);

  // ---- 指標一覧 ----
  const metricRows = METRIC_CONFIG.filter((config) => metrics && metrics[config.key] != null).map(
    (config) => `
      <dt>${config.label}</dt>
      <dd>${metrics[config.key].toFixed(config.decimals)}${config.unit}</dd>
    `
  );
  metricsEl.innerHTML =
    metricRows.length > 0 ? `<dl>${metricRows.join('')}</dl>` : '<p>指標を算出できませんでした。</p>';

  // ---- トレンド(同一撮影アングルの過去セッションとの推移) ----
  // listMetricsForAngleはcreatedAt降順(新しい順)で返るため、グラフ用に古い順へ反転する。
  const chronological = [...angleHistory].reverse();
  const trendCards = METRIC_CONFIG.map((config) => {
    const points = chronological
      .map((entry, index) => ({ value: entry.values && entry.values[config.key], index }))
      .filter((p) => p.value != null);
    if (points.length < MIN_TREND_POINTS) return null;

    const currentEntryIndex = chronological.findIndex((entry) => entry.sessionId === sessionId);
    const highlightIndex = points.findIndex((p) => p.index === currentEntryIndex);

    return { config, values: points.map((p) => p.value), highlightIndex };
  }).filter(Boolean);

  if (trendCards.length === 0) {
    trendsEl.innerHTML = '';
  } else {
    trendsEl.innerHTML = trendCards
      .map(
        ({ config }) => `
          <div class="trend-card">
            <div class="trend-label">
              <span>${config.label}の推移</span>
            </div>
            <canvas data-metric="${config.key}" width="300" height="48"></canvas>
          </div>
        `
      )
      .join('');

    for (const { config, values, highlightIndex } of trendCards) {
      const canvas = trendsEl.querySelector(`canvas[data-metric="${config.key}"]`);
      if (canvas) drawSparkline(canvas, values, highlightIndex);
    }
  }

  // ---- アドバイス ----
  const ruleBased = advice && advice.ruleBased ? advice.ruleBased : [];
  if (ruleBased.length > 0) {
    adviceEl.innerHTML = `
      <h3>アドバイス</h3>
      <ul>
        ${ruleBased
          .map(
            (item) => `
              <li>
                <div>${item.text}</div>
                ${item.drill ? `<div class="drill">🏌️ ${item.drill}</div>` : ''}
              </li>
            `
          )
          .join('')}
      </ul>
    `;
  } else {
    adviceEl.innerHTML = '<p>アドバイスがまだありません。</p>';
  }

  return function cleanup() {
    window.removeEventListener('resize', resizeCanvas);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}

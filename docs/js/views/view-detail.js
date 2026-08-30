import { getSession, getLandmarks, getMetrics, getAdvice } from '../db.js';
import { getVideoBlob } from '../storage-opfs.js';

export async function init(root, sessionId) {
  const titleEl = root.querySelector('#detail-title');
  const videoEl = root.querySelector('#detail-video');
  const canvasEl = root.querySelector('#detail-overlay');
  const metricsEl = root.querySelector('#detail-metrics');
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

  const [videoFile, frames, metrics, advice] = await Promise.all([
    getVideoBlob(sessionId),
    getLandmarks(sessionId),
    getMetrics(sessionId),
    getAdvice(sessionId),
  ]);

  let objectUrl = null;
  if (videoFile) {
    objectUrl = URL.createObjectURL(videoFile);
    videoEl.src = objectUrl;
  } else {
    videoEl.replaceWith(document.createTextNode('動画データが見つかりませんでした。'));
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

  if (metrics && metrics.headVerticalRangeNorm != null) {
    metricsEl.innerHTML = `
      <dl>
        <dt>頭部の上下動</dt>
        <dd>${metrics.headVerticalRangeNorm.toFixed(3)}</dd>
      </dl>
    `;
  } else {
    metricsEl.innerHTML = '<p>指標を算出できませんでした。</p>';
  }

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

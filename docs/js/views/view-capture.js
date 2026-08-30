import { createSession, updateSessionStatus, saveMetrics, saveLandmarks, saveAdvice, listMetricsForAngle } from '../db.js';
import { saveVideoBlob } from '../storage-opfs.js';
import { analyzeVideo } from '../pose/pose-client.js';
import { computeBasicMetrics } from '../metrics/metrics-basic.js';
import { generateBasicAdvice } from '../advice/rules-basic.js';

export function init(root) {
  const form = root.querySelector('#capture-form');
  const fileInput = root.querySelector('#video-input');
  const angleSelect = root.querySelector('#camera-angle');
  const noteInput = root.querySelector('#capture-note');
  const submitBtn = root.querySelector('#capture-submit');
  const statusEl = root.querySelector('#capture-status');
  const resultEl = root.querySelector('#capture-result');

  function setStatus(message, isError = false) {
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.classList.toggle('status-error', isError);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file) return;

    submitBtn.disabled = true;
    resultEl.hidden = true;
    setStatus('保存しています…');

    const cameraAngle = angleSelect.value;
    let session;
    try {
      session = await createSession({ cameraAngle, note: noteInput.value });
      await saveVideoBlob(session.id, file);

      await updateSessionStatus(session.id, 'analyzing');
      setStatus('骨格を抽出しています(初回はモデルの読み込みに時間がかかります)…');

      const frames = await analyzeVideo(file, {
        onProgress: (message) => setStatus(message),
      });

      await saveLandmarks(session.id, frames);

      const metrics = computeBasicMetrics(frames);
      await saveMetrics(session.id, metrics);

      const previous = await listMetricsForAngle(cameraAngle, session.id);
      const advice = generateBasicAdvice(metrics, previous);
      await saveAdvice(session.id, { ruleBased: advice });

      await updateSessionStatus(session.id, 'done');

      setStatus('解析が完了しました。');
      resultEl.hidden = false;
      resultEl.innerHTML = `
        <p><strong>結果を保存しました。</strong></p>
        <p><a href="#detail/${session.id}">詳細を見る →</a></p>
      `;
      form.reset();
    } catch (err) {
      console.error(err);
      if (session) await updateSessionStatus(session.id, 'error');
      setStatus(`エラーが発生しました: ${err.message || err}`, true);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

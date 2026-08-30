import {
  createSession,
  updateSessionStatus,
  updateSessionImpact,
  saveMetrics,
  saveLandmarks,
  saveAdvice,
  listMetricsForAngle,
} from '../db.js';
import { saveVideoBlob, deleteVideoBlob } from '../storage-opfs.js';
import { analyzeVideo } from '../pose/pipeline.js';
import { detectImpactTimestamp } from '../audio/impact-detect.js';
import { computeFullMetrics, computeTempoRatio } from '../metrics/metrics-full.js';
import { generateFullAdvice } from '../advice/rules-full.js';

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

  // 解析中に端末が自動でスリープ/画面ロックしてしまうと、ブラウザがタブの処理を
  // 大幅に遅延・停止させることがある。画面がロックされる主な原因である「無操作
  // による自動スリープ」だけは、Wake Lockでこの間だけ防ぐ。
  // (ユーザーが手動で電源ボタンを押す・他アプリに切り替える場合は防げない。
  //  これはOS/ブラウザ側の省電力制御であり、Web側からは制御できない領域)
  let wakeLock = null;

  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (err) {
      console.warn('wake lock request failed', err);
    }
  }

  async function releaseWakeLock() {
    if (!wakeLock) return;
    try {
      await wakeLock.release();
    } catch (err) {
      // すでに解放済み等は無視してよい
    }
    wakeLock = null;
  }

  // タブが再びフォアグラウンドに戻った際、Wake Lockは自動では再取得されない
  // (仕様上、非表示になった時点で自動解放される)ため、解析中であれば取り直す。
  let analyzing = false;
  document.addEventListener('visibilitychange', () => {
    if (analyzing && document.visibilityState === 'visible' && !wakeLock) {
      acquireWakeLock();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file) return;

    submitBtn.disabled = true;
    resultEl.hidden = true;
    setStatus('保存しています…');

    const cameraAngle = angleSelect.value;
    let session;
    analyzing = true;
    await acquireWakeLock();
    try {
      session = await createSession({ cameraAngle, note: noteInput.value });
      await saveVideoBlob(session.id, file);

      await updateSessionStatus(session.id, 'analyzing');
      setStatus('骨格を抽出しています(初回はモデルの読み込みに時間がかかります)…');

      // 骨格抽出(動画)と、インパクト音の検出(音声)は互いに独立した処理なので
      // 並行して実行する。
      const [frames, impactTimestampMs] = await Promise.all([
        analyzeVideo(file, { onProgress: (message) => setStatus(message) }),
        detectImpactTimestamp(file),
      ]);

      await saveLandmarks(session.id, frames);
      if (impactTimestampMs != null) {
        await updateSessionImpact(session.id, impactTimestampMs);
      }

      const metrics = computeFullMetrics(frames);
      metrics.tempoRatio = computeTempoRatio(frames, impactTimestampMs);
      await saveMetrics(session.id, metrics);

      const previous = await listMetricsForAngle(cameraAngle, session.id);
      const advice = generateFullAdvice(metrics, previous);
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
      if (session) {
        await updateSessionStatus(session.id, 'error');
        // Phase 1には再解析機能がないため、失敗したセッションの動画をOPFSに
        // 残しても使い道がない。孤立データとして残らないよう削除しておく。
        try {
          await deleteVideoBlob(session.id);
        } catch (cleanupErr) {
          console.warn('failed to clean up orphaned video blob', cleanupErr);
        }
      }
      setStatus(`エラーが発生しました: ${err.message || err}`, true);
    } finally {
      submitBtn.disabled = false;
      analyzing = false;
      await releaseWakeLock();
    }
  });
}

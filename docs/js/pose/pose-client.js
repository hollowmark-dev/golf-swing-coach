// メインスレッドからpose-worker.jsを呼び出すためのPromiseラッパー。
// onProgressコールバックで途中経過(何フレーム処理したか等)を受け取れる。

export function analyzeVideo(blob, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pose-worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
      const { type } = event.data;
      if (type === 'progress') {
        if (onProgress) onProgress(event.data.message);
      } else if (type === 'done') {
        worker.terminate();
        resolve(event.data.frames);
      } else if (type === 'error') {
        worker.terminate();
        reject(new Error(event.data.message));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    blob
      .arrayBuffer()
      .then((videoBuffer) => {
        worker.postMessage({ type: 'analyze', videoBuffer, mimeType: blob.type }, [videoBuffer]);
      })
      .catch(reject);
  });
}

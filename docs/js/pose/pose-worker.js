// Web Worker: 動画ファイル(ArrayBuffer)を受け取り、
//   1. mp4box.js でmp4コンテナをデマルチプレクスしてエンコード済みチャンクを取り出す
//   2. WebCodecs VideoDecoder でデコードしてVideoFrameを得る
//   3. MediaPipe Tasks Vision の PoseLandmarker で骨格を抽出する
// という3段のパイプラインを実行する。
//
// [Phase 1の最重要検証ポイント]
// Android実機のスロー撮影(120/240fps)がどのコーデック/コンテナで出力されるかは
// 機種依存のため、このファイルは実際のスマホの動画ファイルで単独検証してから
// 他のビューと繋ぐこと。うまく動かない場合はこのファイル内のログ(postMessageのprogress)
// を頼りに、どの段階(demux/decode/pose推定)で失敗しているかを切り分ける。

import { PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/+esm';
import MP4Box from 'https://cdn.jsdelivr.net/npm/mp4box/+esm';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm';

let poseLandmarkerPromise = null;

function getPoseLandmarker() {
  if (!poseLandmarkerPromise) {
    poseLandmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      try {
        return await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
        });
      } catch (err) {
        // 一部の端末/ブラウザではGPUデリゲートが不安定なためCPUにフォールバックする。
        postProgress('GPUデリゲートの初期化に失敗したためCPUで再試行します');
        return PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
        });
      }
    })();
  }
  return poseLandmarkerPromise;
}

function postProgress(message) {
  self.postMessage({ type: 'progress', message });
}

// avcC/hvcC等のdescriptionボックスをVideoDecoder.configure用に抽出する。
// (WebCodecs公式サンプルで使われている定番パターン)
function getDescription(mp4boxFile, trackId) {
  const track = mp4boxFile.getTrackById(trackId);
  for (const entry of track.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // 先頭8バイト(ボックスヘッダー)は除く
    }
  }
  throw new Error('動画のコーデック情報(avcC/hvcC)が見つかりませんでした');
}

async function analyzeVideo(arrayBuffer, mimeType) {
  postProgress('動画ファイルを解析しています(コンテナ解析)…');

  const poseLandmarker = await getPoseLandmarker();
  const results = [];
  let frameCount = 0;
  let decodeError = null;

  const mp4boxFile = MP4Box.createFile();

  const decodedDone = new Promise((resolve, reject) => {
    let decoder = null;
    let videoTrackInfo = null;

    mp4boxFile.onError = (err) => reject(new Error(`mp4box error: ${err}`));

    mp4boxFile.onReady = (info) => {
      videoTrackInfo = info.videoTracks && info.videoTracks[0];
      if (!videoTrackInfo) {
        reject(new Error('動画トラックが見つかりませんでした(音声のみのファイルの可能性があります)'));
        return;
      }

      postProgress(`動画情報を検出しました(${videoTrackInfo.video.width}x${videoTrackInfo.video.height}, ${info.duration}ms相当)`);

      let description;
      try {
        description = getDescription(mp4boxFile, videoTrackInfo.id);
      } catch (err) {
        reject(err);
        return;
      }

      decoder = new VideoDecoder({
        output: (frame) => {
          frameCount += 1;
          const timestampMs = frame.timestamp / 1000;
          try {
            const detection = poseLandmarker.detectForVideo(frame, timestampMs);
            const landmarks = detection.landmarks && detection.landmarks[0] ? detection.landmarks[0] : [];
            results.push({
              tMs: timestampMs,
              points: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? null })),
            });
          } catch (err) {
            // 1フレームの姿勢推定失敗で全体を止めない。ログだけ残す。
            console.warn('pose detection failed for frame', frameCount, err);
          } finally {
            frame.close();
          }
          if (frameCount % 10 === 0) {
            postProgress(`骨格を抽出中… ${frameCount}フレーム処理済み`);
          }
        },
        error: (err) => {
          decodeError = err;
        },
      });

      decoder.configure({
        codec: videoTrackInfo.codec,
        codedWidth: videoTrackInfo.video.width,
        codedHeight: videoTrackInfo.video.height,
        description,
      });

      mp4boxFile.setExtractionOptions(videoTrackInfo.id, null, { nbSamples: Infinity });
      mp4boxFile.start();
    };

    mp4boxFile.onSamples = (trackId, ref, samples) => {
      for (const sample of samples) {
        if (!decoder || decoder.state !== 'configured') continue;
        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (sample.cts * 1_000_000) / sample.timescale,
          duration: (sample.duration * 1_000_000) / sample.timescale,
          data: sample.data,
        });
        try {
          decoder.decode(chunk);
        } catch (err) {
          reject(err);
          return;
        }
      }
    };

    mp4boxFile.onFlush = async () => {
      try {
        if (decoder && decoder.state === 'configured') {
          await decoder.flush();
        }
        if (decodeError) {
          reject(decodeError);
        } else {
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    };
  });

  arrayBuffer.fileStart = 0;
  mp4boxFile.appendBuffer(arrayBuffer);
  mp4boxFile.flush();

  await decodedDone;

  if (results.length === 0) {
    throw new Error('骨格を1フレームも抽出できませんでした。動画の形式が対応していない可能性があります。');
  }

  postProgress(`骨格抽出が完了しました(合計${results.length}フレーム)`);
  return results;
}

self.onmessage = async (event) => {
  const { type, videoBuffer, mimeType } = event.data;
  if (type !== 'analyze') return;

  try {
    const frames = await analyzeVideo(videoBuffer, mimeType);
    self.postMessage({ type: 'done', frames });
  } catch (err) {
    console.error('pose-worker analyze failed', err);
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};

// 動画ファイル(Blob)を受け取り、
//   1. mp4box.js でmp4コンテナをデマルチプレクスしてエンコード済みチャンクを取り出す
//   2. WebCodecs VideoDecoder でデコードしてVideoFrameを得る
//   3. MediaPipe Tasks Vision の PoseLandmarker で骨格を抽出する
// という3段のパイプラインを実行する。
//
// [メインスレッドで実行している理由]
// 当初はWeb Worker(type: 'module')内で実行する設計だったが、MediaPipe Tasks
// Visionの内部実装が(モジュールワーカーでは使えない)importScripts()に依存して
// おり、"Module scripts don't support importScripts()" で失敗することが実機検証
// 前のローカル検証で判明した。回避策(クラシックワーカー化・UMDバンドルの利用等)
// より、まずメインスレッドで動くことを優先しPhase 1はここで実行する。
// WebCodecsのデコードはコールバックベースで非同期に進むため、単純な同期ループに
// よるUIフリーズにはならない。
//
// [Phase 1の最重要検証ポイント]
// Android実機のスロー撮影(120/240fps)がどのコーデック/コンテナで出力されるかは
// 機種依存のため、このファイルは実際のスマホの動画ファイルで単独検証してから
// 他のビューと繋ぐこと。うまく動かない場合はonProgressで渡される途中経過ログを
// 頼りに、どの段階(demux/decode/pose推定)で失敗しているかを切り分ける。

import { PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/+esm';
import { createFile as createMp4BoxFile, DataStream } from 'https://cdn.jsdelivr.net/npm/mp4box/+esm';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm';

// モジュールスコープでキャッシュすることで、2回目以降のcaptureではモデルの
// 再ダウンロード・再初期化が発生しない。
let poseLandmarkerPromise = null;

// PoseLandmarker.detectForVideo()は、同一インスタンスに対して渡す
// タイムスタンプが常に単調増加していることを要求する(そうでないと
// "INVALID_ARGUMENT"で全フレーム失敗する)。上記のモデルキャッシュにより
// 複数の動画で同じインスタンスを使い回すため、各動画内の相対時刻(0msから
// 始まる)をそのまま渡すと2本目以降で必ず巻き戻ってしまう。そのため、
// MediaPipeに渡す時刻だけは動画をまたいで単調増加するカウンタを別途使う。
let nextDetectTimestampMs = 0;

function getPoseLandmarker(onProgress) {
  if (!poseLandmarkerPromise) {
    poseLandmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      // GPU(WebGL)デリゲートは高速だが、一部のブラウザ(例: プライバシー保護の
      // ためWebGLの挙動を制限するBrave)では初期化がエラーにならず無限に応答が
      // 返ってこない(ハングする)ことが実機検証で確認された。エラーにならない
      // 以上try/catchによるフォールバックも機能しないため、Phase 1では最初から
      // CPUデリゲートのみを使い、確実に動くことを優先する。
      onProgress('姿勢推定モデルを準備しています…');
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO',
      });
    })();
  }
  return poseLandmarkerPromise;
}

// avcC/hvcC等のdescriptionボックスをVideoDecoder.configure用に抽出する。
// (WebCodecs公式サンプルで使われている定番パターン)
function getDescription(mp4boxFile, trackId) {
  const track = mp4boxFile.getTrackById(trackId);
  for (const entry of track.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // 先頭8バイト(ボックスヘッダー)は除く
    }
  }
  throw new Error('動画のコーデック情報(avcC/hvcC)が見つかりませんでした');
}

// mp4box.js + WebCodecsのこのパイプラインはISO-BMFF(mp4/mov)のみ対応。
// <input accept="video/*"> は形式を制限しないため、対応外のコンテナ(webm等)を
// mp4boxに渡すと「mp4box error」という分かりにくいエラーになってしまう。
// 事前にチェックして分かりやすいエラーメッセージを出す。
const SUPPORTED_MIME_PREFIXES = ['video/mp4', 'video/quicktime'];

function assertSupportedContainer(mimeType) {
  if (!mimeType) return; // 型が取得できない場合はmp4box側の判定に委ねる
  if (SUPPORTED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return;
  throw new Error(
    `対応していない動画形式です(${mimeType})。スマホの純正カメラアプリで撮影したMP4/MOV形式の動画を使用してください。`
  );
}

/**
 * @param {Blob} blob
 * @param {{ onProgress?: (message: string) => void }} [options]
 * @returns {Promise<Array<{tMs:number, points:Array<{x:number,y:number,z:number,visibility:number|null}>}>>}
 */
export async function analyzeVideo(blob, { onProgress = () => {} } = {}) {
  assertSupportedContainer(blob.type);
  onProgress('動画ファイルを解析しています(コンテナ解析)…');

  const poseLandmarker = await getPoseLandmarker(onProgress);
  const results = [];
  let frameCount = 0;
  let decodeError = null;
  let decoder = null;
  let videoTrackInfo = null;

  const mp4boxFile = createMp4BoxFile();

  // mp4box.jsには「全サンプルの処理が終わった」ことを通知するコールバックは
  // 存在しない(onFlushというイベントは実在しない)。ここではonReady(または
  // onError)が呼ばれた時点までしか待たない。実際のデコード完了は、この後
  // 別途 VideoDecoder.flush() を明示的に待つことで検知する。
  const readyOrError = new Promise((resolve, reject) => {
    mp4boxFile.onError = (err) => reject(new Error(`mp4box error: ${err}`));

    mp4boxFile.onReady = (info) => {
      videoTrackInfo = info.videoTracks && info.videoTracks[0];
      if (!videoTrackInfo) {
        reject(new Error('動画トラックが見つかりませんでした(音声のみのファイルの可能性があります)'));
        return;
      }

      onProgress(`動画情報を検出しました(${videoTrackInfo.video.width}x${videoTrackInfo.video.height}, ${info.duration}ms相当)`);

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
          const timestampMs = frame.timestamp / 1000; // 動画内の相対時刻(保存・UI表示用)
          const detectTimestampMs = nextDetectTimestampMs++; // MediaPipe向けの単調増加タイムスタンプ
          try {
            const detection = poseLandmarker.detectForVideo(frame, detectTimestampMs);
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
            onProgress(`骨格を抽出中… ${frameCount}フレーム処理済み`);
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

      // デコーダの設定・サンプル抽出の開始まで完了した時点で「準備完了」とする。
      // 実際のデコード完了(全フレームの処理)はこの後、decoder.flush()を
      // 明示的に待って検知する(下記参照)。
      resolve();
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
          // この時点でreadyOrErrorは既に解決済みの可能性があるため、
          // ここでrejectしても呼び出し元には伝わらない。decodeErrorに
          // 記録し、後段のdecoder.flush()待ちの後でまとめて判定する。
          if (!decodeError) decodeError = err;
        }
      }
    };
  });

  const arrayBuffer = await blob.arrayBuffer();
  arrayBuffer.fileStart = 0;
  mp4boxFile.appendBuffer(arrayBuffer);
  mp4boxFile.flush();

  await readyOrError;

  // mp4box.js自体には「全サンプルの処理が終わった」ことを通知する仕組みが
  // ないため、WebCodecs側のVideoDecoder.flush()を明示的に待つことで
  // 全フレームのデコード完了(=outputコールバックが出尽くしたこと)を検知する。
  try {
    if (decoder && decoder.state === 'configured') {
      await decoder.flush();
    }
  } catch (err) {
    if (!decodeError) decodeError = err;
  }

  if (decodeError) {
    throw decodeError instanceof Error ? decodeError : new Error(String(decodeError));
  }

  if (results.length === 0) {
    throw new Error('骨格を1フレームも抽出できませんでした。動画の形式が対応していない可能性があります。');
  }

  onProgress(`骨格抽出が完了しました(合計${results.length}フレーム)`);
  return results;
}

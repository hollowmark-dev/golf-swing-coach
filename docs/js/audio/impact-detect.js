// 動画の音声トラックから、インパクト(打撃音)らしき瞬間を推定する。
//
// 単純に「動画全体で最も音量が大きい瞬間」をインパクトとみなす。打撃音は
// 短時間の鋭いピークになりやすく、素振りや会話などの持続音より際立つことが
// 多いため、Phase 2ではこの単純な方式から始める(誤検出の抑制はPhase 3以降で
// 検討)。音声トラックが無い動画では null を返す(呼び出し側で必須にしない)。

const WINDOW_MS = 10; // 短時間RMSエネルギーを計算する窓の長さ

/**
 * @param {Blob} blob
 * @returns {Promise<number|null>} インパクトと推定される時刻(動画先頭からのms)。検出できない場合はnull。
 */
export async function detectImpactTimestamp(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  const audioCtx = new AudioContextClass();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (err) {
      // 音声トラックが無い/デコードできない動画は珍しくないため、
      // エラーにはせず「検出できなかった」として扱う。
      return null;
    }

    const sampleRate = audioBuffer.sampleRate;
    const windowSize = Math.max(1, Math.floor((sampleRate * WINDOW_MS) / 1000));

    // 複数チャンネルがある場合は最初のチャンネルのみを見る(Phase 2では簡易実装)。
    const channelData = audioBuffer.getChannelData(0);

    let maxEnergy = 0;
    let maxIndex = 0;
    for (let i = 0; i < channelData.length; i += windowSize) {
      let sum = 0;
      const end = Math.min(i + windowSize, channelData.length);
      for (let j = i; j < end; j++) {
        sum += channelData[j] * channelData[j];
      }
      const energy = sum / (end - i);
      if (energy > maxEnergy) {
        maxEnergy = energy;
        maxIndex = i;
      }
    }

    if (maxEnergy <= 0) return null; // 完全な無音等

    return (maxIndex / sampleRate) * 1000;
  } finally {
    await audioCtx.close();
  }
}

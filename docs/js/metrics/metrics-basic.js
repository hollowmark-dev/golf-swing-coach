// ランドマーク時系列から簡易指標を算出する純関数群。
// Phase 1では「頭部の上下動」1指標のみ。指標の拡充はPhase 2で行う。
//
// MediaPipe Poseのランドマークインデックス:
//   0: 鼻, 11: 左肩, 12: 右肩, 23: 左腰, 24: 右腰

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function hasLandmark(points, index) {
  return Array.isArray(points) && points.length > index && points[index] != null;
}

/**
 * @param {Array<{tMs:number, points:Array<{x:number,y:number,z:number,visibility:number|null}>}>} frames
 * @returns {{ headVerticalRangeNorm: number|null, sampleFrameCount: number }}
 */
export function computeBasicMetrics(frames) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return { headVerticalRangeNorm: null, sampleFrameCount: 0 };
  }

  const noseYs = [];
  const torsoLengths = [];

  for (const frame of frames) {
    const points = frame.points;
    if (!hasLandmark(points, NOSE)) continue;
    noseYs.push(points[NOSE].y);

    if (
      hasLandmark(points, LEFT_SHOULDER) &&
      hasLandmark(points, RIGHT_SHOULDER) &&
      hasLandmark(points, LEFT_HIP) &&
      hasLandmark(points, RIGHT_HIP)
    ) {
      const shoulderMid = midpoint(points[LEFT_SHOULDER], points[RIGHT_SHOULDER]);
      const hipMid = midpoint(points[LEFT_HIP], points[RIGHT_HIP]);
      const torsoLength = distance(shoulderMid, hipMid);
      if (torsoLength > 0) torsoLengths.push(torsoLength);
    }
  }

  if (noseYs.length < 2 || torsoLengths.length === 0) {
    return { headVerticalRangeNorm: null, sampleFrameCount: frames.length };
  }

  const rangeRaw = Math.max(...noseYs) - Math.min(...noseYs);
  const avgTorsoLength = torsoLengths.reduce((sum, v) => sum + v, 0) / torsoLengths.length;

  return {
    // 胴の長さで正規化することで、カメラとの距離の違いにある程度頑健にする。
    headVerticalRangeNorm: rangeRaw / avgTorsoLength,
    sampleFrameCount: frames.length,
  };
}

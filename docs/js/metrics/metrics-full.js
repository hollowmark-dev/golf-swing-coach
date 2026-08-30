// ランドマーク時系列から実用的な指標を算出する純関数群(Phase 2)。
// 単眼2Dカメラで妥当に測れる指標に限定する(肩腰の回転角・脊柱の3D角度などは
// 対象外)。低信頼度のランドマークは除外し、外れ値に強いようパーセンタイル
// ベースの範囲計算を使う(Phase 1のheadVerticalRangeNormが一部フレームの
// 誤検出で異常値になった反省を踏まえた設計)。
//
// MediaPipe Poseのランドマークインデックス:
//   0: 鼻, 11/12: 左右肩, 15/16: 左右手首, 23/24: 左右腰, 25/26: 左右膝, 27/28: 左右足首

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const LEFT_KNEE = 25;
const RIGHT_KNEE = 26;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;

const MIN_VISIBILITY = 0.5;

function isVisible(point) {
  return point != null && (point.visibility == null || point.visibility >= MIN_VISIBILITY);
}

function hasLandmark(points, index) {
  return Array.isArray(points) && points.length > index && isVisible(points[index]);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDeg(a, b, c) {
  // bを頂点とする角a-b-cの角度(度)。2D座標のみで完結するため、
  // 3D的な回転角とは異なりカメラアングルに対して比較的頑健。
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const magAB = Math.hypot(abx, aby);
  const magCB = Math.hypot(cbx, cby);
  if (magAB === 0 || magCB === 0) return null;
  const cos = Math.max(-1, Math.min(1, (abx * cbx + aby * cby) / (magAB * magCB)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * p)));
  return sortedValues[idx];
}

// 単純な最小-最大ではなく10-90パーセンタイルの範囲を使うことで、
// 単一フレームの骨格誤検出による異常値の影響を抑える。
function percentileRange(values, lowP = 0.1, highP = 0.9) {
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const low = percentile(sorted, lowP);
  const high = percentile(sorted, highP);
  if (low == null || high == null) return null;
  return high - low;
}

function torsoLength(points) {
  if (
    !hasLandmark(points, LEFT_SHOULDER) ||
    !hasLandmark(points, RIGHT_SHOULDER) ||
    !hasLandmark(points, LEFT_HIP) ||
    !hasLandmark(points, RIGHT_HIP)
  ) {
    return null;
  }
  const shoulderMid = midpoint(points[LEFT_SHOULDER], points[RIGHT_SHOULDER]);
  const hipMid = midpoint(points[LEFT_HIP], points[RIGHT_HIP]);
  const length = distance(shoulderMid, hipMid);
  return length > 0 ? length : null;
}

function wristMidpoint(points) {
  if (hasLandmark(points, LEFT_WRIST) && hasLandmark(points, RIGHT_WRIST)) {
    return midpoint(points[LEFT_WRIST], points[RIGHT_WRIST]);
  }
  if (hasLandmark(points, LEFT_WRIST)) return points[LEFT_WRIST];
  if (hasLandmark(points, RIGHT_WRIST)) return points[RIGHT_WRIST];
  return null;
}

/**
 * @param {Array<{tMs:number, points:Array}>} frames
 * @returns {{
 *   sampleFrameCount: number,
 *   headVerticalRangeNorm: number|null,
 *   kneeFlexRangeDeg: number|null,
 *   handPathLengthNorm: number|null,
 * }}
 */
export function computeFullMetrics(frames) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return { sampleFrameCount: 0, headVerticalRangeNorm: null, kneeFlexRangeDeg: null, handPathLengthNorm: null };
  }

  const torsoLengths = [];
  const noseYs = [];
  const kneeAngles = [];
  const wristPositions = [];

  for (const frame of frames) {
    const points = frame.points;

    const torso = torsoLength(points);
    if (torso != null) torsoLengths.push(torso);

    if (hasLandmark(points, NOSE)) noseYs.push(points[NOSE].y);

    if (hasLandmark(points, LEFT_HIP) && hasLandmark(points, LEFT_KNEE) && hasLandmark(points, LEFT_ANKLE)) {
      const angle = angleDeg(points[LEFT_HIP], points[LEFT_KNEE], points[LEFT_ANKLE]);
      if (angle != null) kneeAngles.push(angle);
    }
    if (hasLandmark(points, RIGHT_HIP) && hasLandmark(points, RIGHT_KNEE) && hasLandmark(points, RIGHT_ANKLE)) {
      const angle = angleDeg(points[RIGHT_HIP], points[RIGHT_KNEE], points[RIGHT_ANKLE]);
      if (angle != null) kneeAngles.push(angle);
    }

    const wrist = wristMidpoint(points);
    if (wrist) wristPositions.push(wrist);
  }

  const avgTorsoLength =
    torsoLengths.length > 0 ? torsoLengths.reduce((sum, v) => sum + v, 0) / torsoLengths.length : null;

  const headRange = percentileRange(noseYs);
  const headVerticalRangeNorm = avgTorsoLength != null && headRange != null ? headRange / avgTorsoLength : null;

  const kneeFlexRangeDeg = percentileRange(kneeAngles);

  let handPathLengthNorm = null;
  if (wristPositions.length >= 2 && avgTorsoLength != null) {
    let pathLength = 0;
    for (let i = 1; i < wristPositions.length; i++) {
      pathLength += distance(wristPositions[i - 1], wristPositions[i]);
    }
    handPathLengthNorm = pathLength / avgTorsoLength;
  }

  return {
    sampleFrameCount: frames.length,
    headVerticalRangeNorm,
    kneeFlexRangeDeg,
    handPathLengthNorm,
  };
}

// テンポ比(バックスイング所要時間 ÷ ダウンスイング所要時間)。
// 「トップ」はインパクトより前で手首が最も高い(y座標最小)時点と推定する。
// インパクト時刻(audio/impact-detect.jsで検出)が無いと算出できない。
/**
 * @param {Array<{tMs:number, points:Array}>} frames
 * @param {number|null} impactTimestampMs
 * @returns {number|null}
 */
export function computeTempoRatio(frames, impactTimestampMs) {
  if (!Array.isArray(frames) || frames.length < 3 || impactTimestampMs == null) return null;

  const beforeImpact = frames.filter((f) => f.tMs <= impactTimestampMs);
  if (beforeImpact.length < 2) return null;

  let topFrame = null;
  let minY = Infinity;
  for (const frame of beforeImpact) {
    const wrist = wristMidpoint(frame.points);
    if (wrist && wrist.y < minY) {
      minY = wrist.y;
      topFrame = frame;
    }
  }
  if (!topFrame) return null;

  const addressTMs = frames[0].tMs;
  const backswingMs = topFrame.tMs - addressTMs;
  const downswingMs = impactTimestampMs - topFrame.tMs;
  if (backswingMs <= 0 || downswingMs <= 0) return null;

  return backswingMs / downswingMs;
}

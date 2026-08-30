// 指標→助言テキストへの簡易ルールベース変換(純関数)。
// Phase 1では「頭部の上下動」のみを見て、過去の同一撮影アングルのセッションとの
// 相対比較でアドバイスを出す。絶対的な「理想値」とは比較しない。

const IMPROVEMENT_THRESHOLD = 0.9; // 過去平均の90%以下なら改善とみなす
const WORSENING_THRESHOLD = 1.15; // 過去平均の115%以上なら悪化とみなす

/**
 * @param {{headVerticalRangeNorm: number|null}} currentMetrics
 * @param {Array<{values: {headVerticalRangeNorm: number|null}}>} previousMetricsList 同一cameraAngleの過去セッション
 * @returns {Array<{text: string, drill: string|null}>}
 */
export function generateBasicAdvice(currentMetrics, previousMetricsList) {
  const advice = [];
  const current = currentMetrics && currentMetrics.headVerticalRangeNorm;

  if (current == null) {
    advice.push({
      text: '骨格を十分な精度で検出できませんでした。全身が映るように撮影し直すと、より正確な分析ができます。',
      drill: null,
    });
    return advice;
  }

  const previousValues = (previousMetricsList || [])
    .map((m) => m.values && m.values.headVerticalRangeNorm)
    .filter((v) => v != null);

  if (previousValues.length === 0) {
    advice.push({
      text: `今回の頭の上下動の指標値は ${current.toFixed(3)} でした。同じ撮影アングルでもう1本撮ると、次回から過去の自分との比較ができるようになります。`,
      drill: null,
    });
    return advice;
  }

  const avgPrevious = previousValues.reduce((sum, v) => sum + v, 0) / previousValues.length;
  const ratio = current / avgPrevious;

  if (ratio <= IMPROVEMENT_THRESHOLD) {
    advice.push({
      text: `頭の上下動が過去平均より小さくなっています(過去平均比 ${(ratio * 100).toFixed(0)}%)。良い傾向です。`,
      drill: '今の感覚を維持するため、同じテンポで素振りを10回行いましょう。',
    });
  } else if (ratio >= WORSENING_THRESHOLD) {
    advice.push({
      text: `頭の上下動が過去平均より大きくなっています(過去平均比 ${(ratio * 100).toFixed(0)}%)。`,
      drill: '壁に頭を軽く付けた状態で素振りをする「ヘッドスティルドリル」がおすすめです。頭の位置を動かさない感覚を確認しましょう。',
    });
  } else {
    advice.push({
      text: `頭の上下動は過去平均とほぼ同じ水準です(過去平均比 ${(ratio * 100).toFixed(0)}%)。安定しています。`,
      drill: null,
    });
  }

  return advice;
}

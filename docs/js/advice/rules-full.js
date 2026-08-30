// 指標→助言テキストへのルールベース変換(Phase 2、複数指標対応)。
// 過去の同一撮影アングルのセッション(status: 'done'のみ)との相対比較で
// アドバイスを出す。絶対的な「理想値」とは比較しない(撮影距離・アングルの
// 違いで指標の絶対値は変わりうるため)。

const IMPROVEMENT_THRESHOLD = 0.9; // 過去平均の90%以下なら改善とみなす
const WORSENING_THRESHOLD = 1.15; // 過去平均の115%以上なら悪化とみなす

// higherIsWorse: true = 値が大きいほど改善余地あり、false = 小さいほど改善余地あり、
// null = 良し悪しの方向性が一概に言えない指標(中立に「変化」だけ伝える)
// view-detail.jsの指標表示・トレンド表示でもラベル/桁数/単位を再利用する。
export const METRIC_CONFIG = [
  {
    key: 'headVerticalRangeNorm',
    label: '頭の上下動',
    decimals: 3,
    unit: '',
    higherIsWorse: true,
    worseDrill:
      '壁に軽く頭を付けた状態で素振りをする「ヘッドスティルドリル」がおすすめです。頭の位置を動かさない感覚を確認しましょう。',
    betterDrill: '今の感覚を維持するため、同じテンポで素振りを10回行いましょう。',
  },
  {
    key: 'kneeFlexRangeDeg',
    label: '膝の曲げ伸ばし量',
    decimals: 1,
    unit: '°',
    higherIsWorse: true,
    worseDrill:
      '前傾姿勢と膝の高さをキープしたまま体重移動する素振り(スクワットキープドリル)を試してみましょう。',
    betterDrill: '下半身が安定しています。この感覚を大切にしましょう。',
  },
  {
    key: 'handPathLengthNorm',
    label: '手元の軌道の大きさ',
    decimals: 3,
    unit: '',
    higherIsWorse: null,
  },
  {
    key: 'tempoRatio',
    label: 'テンポ比(バックスイング:ダウンスイング)',
    decimals: 2,
    unit: '',
    higherIsWorse: null,
  },
];

/**
 * @param {Record<string, number|null>} currentMetrics
 * @param {Array<{values: Record<string, number|null>}>} previousMetricsList 同一cameraAngle・status='done'の過去セッション
 * @returns {Array<{text: string, drill: string|null}>}
 */
export function generateFullAdvice(currentMetrics, previousMetricsList) {
  const advice = [];
  const previousValues = previousMetricsList || [];
  let anyMetricComputed = false;

  for (const config of METRIC_CONFIG) {
    const current = currentMetrics ? currentMetrics[config.key] : null;
    if (current == null) continue;
    anyMetricComputed = true;

    const history = previousValues
      .map((m) => m.values && m.values[config.key])
      .filter((v) => v != null);

    const currentLabel = `${config.label}: ${current.toFixed(config.decimals)}${config.unit}`;

    if (history.length === 0) {
      advice.push({
        text: `${currentLabel}(過去データなし。同じ撮影アングルでもう1本撮ると比較できるようになります)`,
        drill: null,
      });
      continue;
    }

    const avg = history.reduce((sum, v) => sum + v, 0) / history.length;
    const ratio = avg !== 0 ? current / avg : null;
    const pctLabel = ratio != null ? `過去平均比${(ratio * 100).toFixed(0)}%` : '過去平均との比較不可';

    if (config.higherIsWorse === true && ratio != null) {
      if (ratio <= IMPROVEMENT_THRESHOLD) {
        advice.push({ text: `${currentLabel}(${pctLabel}、良い傾向です)`, drill: config.betterDrill || null });
      } else if (ratio >= WORSENING_THRESHOLD) {
        advice.push({ text: `${currentLabel}(${pctLabel}、やや大きくなっています)`, drill: config.worseDrill || null });
      } else {
        advice.push({ text: `${currentLabel}(${pctLabel}、安定しています)`, drill: null });
      }
    } else {
      // 良し悪しの方向性を判定しない指標は、変化の大きさだけを中立に伝える。
      advice.push({ text: `${currentLabel}(${pctLabel})`, drill: null });
    }
  }

  if (!anyMetricComputed) {
    advice.push({
      text: '骨格を十分な精度で検出できませんでした。全身が映るように撮影し直すと、より正確な分析ができます。',
      drill: null,
    });
  }

  return advice;
}

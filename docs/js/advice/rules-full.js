// 指標→助言テキストへのルールベース変換(Phase 2、複数指標対応)。
//
// 指標のほとんどは、過去の同一撮影アングルのセッション(status: 'done'のみ)との
// 相対比較でアドバイスを出す(絶対的な「理想値」とは比較しない。撮影距離・
// アングルの違いで指標の絶対値は変わりうるため)。
//
// 例外は「テンポ比」。これは撮影角度・距離に依存しない(位置ではなく時間だけを
// 見ている)指標であり、かつ「プロは概ね3:1に収まる」という複数の研究・書籍で
// 裏付けのある目安値が存在するため、この指標だけは固定の目安値(benchmark)との
// 比較を行う。

const IMPROVEMENT_THRESHOLD = 0.9; // 過去平均の90%以下なら改善とみなす
const WORSENING_THRESHOLD = 1.15; // 過去平均の115%以上なら悪化とみなす

// compareMode: 'self' = 過去の自分との相対比較、'benchmark' = 固定の目安値との比較
// higherIsWorse: true = 値が大きいほど改善余地あり、null = 良し悪しの方向性が
// 一概に言えない指標(中立に「変化」だけ伝える)。compareMode:'benchmark'では未使用。
// view-detail.jsの指標表示・トレンド表示でもラベル/桁数/単位を再利用する。
export const METRIC_CONFIG = [
  {
    key: 'headVerticalRangeNorm',
    label: '頭の上下動',
    decimals: 3,
    unit: '',
    compareMode: 'self',
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
    compareMode: 'self',
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
    compareMode: 'self',
    higherIsWorse: null,
  },
  {
    key: 'tempoRatio',
    label: 'テンポ比(バックスイング:ダウンスイング)',
    decimals: 2,
    unit: '',
    compareMode: 'benchmark',
    benchmark: 3.0,
    benchmarkTolerance: 0.4, // 2.6〜3.4程度は「近い」とみなす
    benchmarkNote: 'プロは概ね3:1に収まるとされています',
  },
];

function selfComparisonAdvice(config, current, history) {
  const currentLabel = `${config.label}: ${current.toFixed(config.decimals)}${config.unit}`;

  if (history.length === 0) {
    return {
      text: `${currentLabel}(過去データなし。同じ撮影アングルでもう1本撮ると比較できるようになります)`,
      drill: null,
    };
  }

  const avg = history.reduce((sum, v) => sum + v, 0) / history.length;
  const ratio = avg !== 0 ? current / avg : null;
  const pctLabel = ratio != null ? `過去平均比${(ratio * 100).toFixed(0)}%` : '過去平均との比較不可';

  if (config.higherIsWorse === true && ratio != null) {
    if (ratio <= IMPROVEMENT_THRESHOLD) {
      return { text: `${currentLabel}(${pctLabel}、良い傾向です)`, drill: config.betterDrill || null };
    }
    if (ratio >= WORSENING_THRESHOLD) {
      return { text: `${currentLabel}(${pctLabel}、やや大きくなっています)`, drill: config.worseDrill || null };
    }
    return { text: `${currentLabel}(${pctLabel}、安定しています)`, drill: null };
  }

  // 良し悪しの方向性を判定しない指標は、変化の大きさだけを中立に伝える。
  return { text: `${currentLabel}(${pctLabel})`, drill: null };
}

function benchmarkAdvice(config, current) {
  const currentLabel = `${config.label}: ${current.toFixed(config.decimals)}:1(${config.benchmarkNote})`;
  const diff = current - config.benchmark;

  if (Math.abs(diff) <= config.benchmarkTolerance) {
    return { text: `${currentLabel}。理想的なテンポに近いです。`, drill: null };
  }
  if (diff > 0) {
    // バックスイングに対してダウンスイングが相対的に速い(切り返しが急、など)
    return {
      text: `${currentLabel}。バックスイングに対してダウンスイングがやや速い可能性があります。`,
      drill: 'トップで一瞬「間」を作るイメージで、切り返しを急がない素振りをしてみましょう。',
    };
  }
  // バックスイングが相対的に速い
  return {
    text: `${currentLabel}。バックスイングが速すぎる可能性があります。`,
    drill: '「1、2、3」とカウントしながら、ゆったり大きく振り上げる素振りをしてみましょう。',
  };
}

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

    if (config.compareMode === 'benchmark') {
      advice.push(benchmarkAdvice(config, current));
      continue;
    }

    const history = previousValues
      .map((m) => m.values && m.values[config.key])
      .filter((v) => v != null);
    advice.push(selfComparisonAdvice(config, current, history));
  }

  if (!anyMetricComputed) {
    advice.push({
      text: '骨格を十分な精度で検出できませんでした。全身が映るように撮影し直すと、より正確な分析ができます。',
      drill: null,
    });
  }

  return advice;
}

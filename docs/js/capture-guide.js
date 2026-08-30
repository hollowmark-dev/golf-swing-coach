// カメラ位置合わせ用のライブビューガイド。
//
// スマホのスロー撮影モードはブラウザから直接は使えない(純正カメラアプリの
// 専用機能のため)。そこで、実際の録画は純正カメラアプリに任せつつ、
// 「毎回同じ位置・角度で撮る」ための位置決めだけをこの画面で行う2段階方式にする:
//   1. このライブビューで頭の高さ・ボール位置の目印にカメラ/三脚を合わせる
//   2. その位置のまま純正カメラアプリに切り替えてスロー撮影する
//   3. アプリに戻り、撮影した動画をファイル選択で取り込む

let activeStream = null;

export async function openCaptureGuide(overlayEl, videoEl) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch (err) {
    throw new Error(`カメラを起動できませんでした: ${err.message || err}`);
  }
  activeStream = stream;
  videoEl.srcObject = stream;
  overlayEl.hidden = false;
}

export function closeCaptureGuide(overlayEl) {
  overlayEl.hidden = true;
  if (activeStream) {
    for (const track of activeStream.getTracks()) track.stop();
    activeStream = null;
  }
}

// カメラ位置合わせ用のライブビューガイド。
//
// スマホのスロー撮影モードはブラウザから直接は使えない(純正カメラアプリの
// 専用機能のため)。そこで、実際の録画は純正カメラアプリに任せつつ、
// 「毎回同じ位置・角度で撮る」ための位置決めだけをこの画面で行う2段階方式にする:
//   1. このライブビューで頭の高さ・ボール位置の目印にカメラ/三脚を合わせる
//   2. その位置のまま純正カメラアプリに切り替えてスロー撮影する
//   3. アプリに戻り、撮影した動画をファイル選択で取り込む

const GET_USER_MEDIA_TIMEOUT_MS = 10000;

let activeStream = null;

function withTimeout(promise, ms, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function openCaptureGuide(overlayEl, videoEl) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('このブラウザはカメラ機能に対応していません。');
  }

  let stream;
  try {
    stream = await withTimeout(
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
      GET_USER_MEDIA_TIMEOUT_MS,
      'カメラの起動がタイムアウトしました。ブラウザの設定でカメラの許可がブロックされていないか確認してください。'
    );
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

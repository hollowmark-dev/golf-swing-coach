// カメラ位置合わせ用のライブビューガイド。
//
// スマホのスロー撮影モードはブラウザから直接は使えない(純正カメラアプリの
// 専用機能のため)。そこで、実際の録画は純正カメラアプリに任せつつ、
// 「毎回同じ位置・角度で撮る」ための位置決めだけをこの画面で行う2段階方式にする:
//   1. このライブビューで頭の高さ・ボール位置の目印にカメラ/三脚を合わせる
//   2. その位置のまま純正カメラアプリに切り替えてスロー撮影する
//   3. アプリに戻り、撮影した動画をファイル選択で取り込む

const GET_USER_MEDIA_TIMEOUT_MS = 10000;
const VIDEO_READY_TIMEOUT_MS = 4000;

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

// videoEl.play()を試み、実際に映像が出た(videoWidthが確定した)ことまで
// 確認する。play()自体は成功してもフレームがまだ来ていないことがあるため、
// loadedmetadata/timeupdateのいずれかを待ってから幅を見る。
async function playAndVerify(videoEl) {
  await videoEl.play();

  if (videoEl.videoWidth > 0) return true;

  await Promise.race([
    new Promise((resolve) => videoEl.addEventListener('loadedmetadata', resolve, { once: true })),
    new Promise((resolve) => videoEl.addEventListener('timeupdate', resolve, { once: true })),
    new Promise((resolve) => setTimeout(resolve, VIDEO_READY_TIMEOUT_MS)),
  ]);

  return videoEl.videoWidth > 0;
}

export async function openCaptureGuide(overlayEl, videoEl, onWarning) {
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
  // 一部のブラウザは要素が非表示(display:none)のままだと映像パイプラインの
  // 準備を後回しにすることがあるため、srcObjectを設定する前に先に表示状態にする。
  overlayEl.hidden = false;
  videoEl.srcObject = stream;

  // 動画タップでも再生を試せるようにしておく(自動再生がブロックされる環境向け
  // のフォールバック。muted指定済みなので通常のブラウザでは自動再生されるはず)。
  videoEl.onclick = () => {
    videoEl.play().catch((err) => console.warn('guide video manual play() failed', err));
  };

  let ok = false;
  try {
    ok = await playAndVerify(videoEl);
  } catch (err) {
    console.warn('guide video play() failed', err);
  }

  if (!ok && onWarning) {
    onWarning('カメラ映像が表示されない場合は、映像エリアをタップしてみてください。');
  }
}

export function closeCaptureGuide(overlayEl) {
  const videoEl = overlayEl.querySelector('video');
  if (videoEl) videoEl.onclick = null;
  overlayEl.hidden = true;
  if (activeStream) {
    for (const track of activeStream.getTracks()) track.stop();
    activeStream = null;
  }
}

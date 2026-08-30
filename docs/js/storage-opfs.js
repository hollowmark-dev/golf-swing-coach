// OPFS(Origin Private File System)への動画Blobの保存/読み出しを担当する。

const VIDEO_DIR = 'videos';

async function getVideoDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(VIDEO_DIR, { create: true });
}

function extensionFromMimeType(mimeType) {
  if (!mimeType) return 'mp4';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('quicktime')) return 'mov';
  if (mimeType.includes('webm')) return 'webm';
  return 'mp4';
}

// ブラウザがOPFS/永続化に対応していない、または許可が下りなくても
// アプリ自体は使えるようにするため、失敗はthrowせずbooleanで返す。
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    return await navigator.storage.persist();
  } catch (err) {
    console.warn('navigator.storage.persist() に失敗しました', err);
    return false;
  }
}

export function videoFileName(sessionId, mimeType) {
  return `${sessionId}.${extensionFromMimeType(mimeType)}`;
}

export async function saveVideoBlob(sessionId, blob) {
  const dir = await getVideoDir();
  const fileName = videoFileName(sessionId, blob.type);
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  return fileName;
}

export async function getVideoBlob(sessionId, mimeTypeHint) {
  const dir = await getVideoDir();
  // sessionId保存時の拡張子が分からない場合に備え、候補を順に試す。
  const candidates = mimeTypeHint
    ? [videoFileName(sessionId, mimeTypeHint)]
    : ['mp4', 'mov', 'webm'].map((ext) => `${sessionId}.${ext}`);

  for (const fileName of candidates) {
    try {
      const fileHandle = await dir.getFileHandle(fileName);
      return await fileHandle.getFile();
    } catch (err) {
      if (err.name !== 'NotFoundError') throw err;
    }
  }
  return null;
}

export async function deleteVideoBlob(sessionId) {
  const dir = await getVideoDir();
  for (const ext of ['mp4', 'mov', 'webm']) {
    try {
      await dir.removeEntry(`${sessionId}.${ext}`);
    } catch (err) {
      if (err.name !== 'NotFoundError') throw err;
    }
  }
}

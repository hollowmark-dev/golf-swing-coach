import { listSessions, deleteSession } from '../db.js';
import { deleteVideoBlob } from '../storage-opfs.js';

const ANGLE_LABEL = { front: '正面', behind: '後方', other: 'その他' };
const STATUS_LABEL = { pending: '保存中', analyzing: '解析中', done: '', error: 'エラー' };

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function init(root) {
  const listEl = root.querySelector('#history-list');
  const emptyHint = root.querySelector('#history-empty-hint');

  async function renderList() {
    const sessions = await listSessions();

    if (sessions.length === 0) {
      emptyHint.hidden = false;
      listEl.hidden = true;
      listEl.innerHTML = '';
      return;
    }
    emptyHint.hidden = true;
    listEl.hidden = false;

    listEl.innerHTML = sessions
      .map((session) => {
        const date = new Date(session.createdAt);
        const dateLabel = date.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
        const angleLabel = ANGLE_LABEL[session.cameraAngle] || session.cameraAngle;
        const statusLabel = STATUS_LABEL[session.status] || session.status;
        return `
          <li class="session-item">
            <a href="#detail/${session.id}">
              <div class="session-date">${dateLabel}${statusLabel ? ' (' + statusLabel + ')' : ''}</div>
              <div class="session-meta">${angleLabel}${session.note ? ' ・ ' + escapeHtml(session.note) : ''}</div>
            </a>
            <button type="button" class="session-delete" data-session-id="${session.id}" aria-label="削除">削除</button>
          </li>
        `;
      })
      .join('');
  }

  listEl.addEventListener('click', async (event) => {
    const button = event.target.closest('.session-delete');
    if (!button) return;
    event.preventDefault();

    const sessionId = button.dataset.sessionId;
    if (!confirm('この記録を削除しますか?(動画・解析結果はすべて削除され、元に戻せません)')) return;

    button.disabled = true;
    try {
      await deleteVideoBlob(sessionId);
      await deleteSession(sessionId);
      await renderList();
    } catch (err) {
      console.error('failed to delete session', err);
      alert(`削除に失敗しました: ${err.message || err}`);
      button.disabled = false;
    }
  });

  await renderList();
}

import { listSessions } from '../db.js';

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

  const sessions = await listSessions();

  if (sessions.length === 0) {
    emptyHint.hidden = false;
    listEl.hidden = true;
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
        <li>
          <a href="#detail/${session.id}">
            <div class="session-date">${dateLabel}${statusLabel ? ' (' + statusLabel + ')' : ''}</div>
            <div class="session-meta">${angleLabel}${session.note ? ' ・ ' + escapeHtml(session.note) : ''}</div>
          </a>
        </li>
      `;
    })
    .join('');
}

// IndexedDBラッパー。スキーマ定義とCRUDのみを担当する。
// 将来のフィールド追加に備え、ストア構造は極力シンプルなkeyPathのみで構成している。

import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@8/+esm';

const DB_NAME = 'golf-swing-coach';
const DB_VERSION = 1;
const SETTINGS_KEY = 'app';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('landmarks')) {
          db.createObjectStore('landmarks', { keyPath: 'sessionId' });
        }
        if (!db.objectStoreNames.contains('metrics')) {
          db.createObjectStore('metrics', { keyPath: 'sessionId' });
        }
        if (!db.objectStoreNames.contains('advice')) {
          db.createObjectStore('advice', { keyPath: 'sessionId' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      },
    });
  }
  return dbPromise;
}

function newSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- sessions ----

export async function createSession({ cameraAngle, note }) {
  const db = await getDB();
  const session = {
    id: newSessionId(),
    createdAt: new Date().toISOString(),
    cameraAngle: cameraAngle || 'other',
    note: note || '',
    status: 'pending', // pending -> analyzing -> done -> error
    impactTimestampMs: null,
  };
  await db.put('sessions', session);
  return session;
}

export async function updateSessionStatus(sessionId, status) {
  const db = await getDB();
  const session = await db.get('sessions', sessionId);
  if (!session) return;
  session.status = status;
  await db.put('sessions', session);
}

export async function getSession(sessionId) {
  const db = await getDB();
  return db.get('sessions', sessionId);
}

export async function listSessions() {
  const db = await getDB();
  const all = await db.getAll('sessions');
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// ---- landmarks ----

export async function saveLandmarks(sessionId, frames) {
  const db = await getDB();
  await db.put('landmarks', { sessionId, frames });
}

export async function getLandmarks(sessionId) {
  const db = await getDB();
  const record = await db.get('landmarks', sessionId);
  return record ? record.frames : null;
}

// ---- metrics ----

export async function saveMetrics(sessionId, values) {
  const db = await getDB();
  await db.put('metrics', { sessionId, values });
}

export async function getMetrics(sessionId) {
  const db = await getDB();
  const record = await db.get('metrics', sessionId);
  return record ? record.values : null;
}

export async function listMetricsForAngle(cameraAngle, excludeSessionId) {
  const sessions = await listSessions();
  const db = await getDB();
  const results = [];
  for (const session of sessions) {
    if (session.id === excludeSessionId) continue;
    if (session.cameraAngle !== cameraAngle) continue;
    if (session.status !== 'done') continue; // 失敗/未完了セッションの指標は比較対象に含めない
    const record = await db.get('metrics', session.id);
    if (record) {
      results.push({ sessionId: session.id, createdAt: session.createdAt, values: record.values });
    }
  }
  return results;
}

// ---- advice ----

export async function saveAdvice(sessionId, advice) {
  const db = await getDB();
  const existing = (await db.get('advice', sessionId)) || { sessionId, ruleBased: [], llm: null };
  await db.put('advice', { ...existing, ...advice, sessionId });
}

export async function getAdvice(sessionId) {
  const db = await getDB();
  return db.get('advice', sessionId);
}

// ---- settings ----

export async function getSettings() {
  const db = await getDB();
  const settings = await db.get('settings', SETTINGS_KEY);
  return settings || { apiKey: null, model: null, appVersion: '0.1.0-phase1' };
}

export async function saveSettings(partial) {
  const db = await getDB();
  const current = await getSettings();
  const next = { ...current, ...partial };
  await db.put('settings', next, SETTINGS_KEY);
  return next;
}

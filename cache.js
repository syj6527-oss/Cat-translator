// ============================================================
// 🐱 Translator v1.1.0 - cache.js
// IndexedDB 영구 캐시: 유사 문장 매칭, Thought 캐싱, 통계
// ============================================================

import { normalizeText } from './utils.js';

const DB_NAME = 'CatTranslatorCache';
const DB_VERSION = 2;
const STORE_TRANSLATIONS = 'translations';
const STORE_STATS = 'stats';
const EXPIRY_DAYS = 30;
const CACHE_KEY_VERSION = 'raw-v4';

let db = null;
let stats = { hits: 0, misses: 0, tokensSaved: 0 };

// ─── DB 초기화 ──────────────────────────────────────
export async function initCache() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_TRANSLATIONS)) {
                const store = database.createObjectStore(STORE_TRANSLATIONS, { keyPath: 'key' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('normalized', 'normalized', { unique: false });
            }
            if (!database.objectStoreNames.contains(STORE_STATS)) {
                database.createObjectStore(STORE_STATS, { keyPath: 'id' });
            }
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            loadStats().then(() => {
                cleanExpired();
                resolve(db);
            });
        };
        request.onerror = () => reject(request.error);
    });
}

// ─── 통계 로드/저장 ──────────────────────────────────
async function loadStats() {
    try {
        const tx = db.transaction(STORE_STATS, 'readonly');
        const store = tx.objectStore(STORE_STATS);
        const result = await promisifyRequest(store.get('session'));
        if (result) {
            stats = { ...stats, ...result.data };
        }
    } catch (e) { /* 첫 실행 시 무시 */ }
}

async function saveStats() {
    try {
        const tx = db.transaction(STORE_STATS, 'readwrite');
        const store = tx.objectStore(STORE_STATS);
        store.put({ id: 'session', data: stats, timestamp: Date.now() });
    } catch (e) { /* 무시 */ }
}

export function getStats() {
    const total = stats.hits + stats.misses;
    const hitRate = total > 0 ? Math.round((stats.hits / total) * 100) : 0;
    return {
        hits: stats.hits,
        misses: stats.misses,
        tokensSaved: stats.tokensSaved,
        hitRate
    };
}

function normalizeSourceForKey(text) {
    return String(text || '').replace(/\r\n/g, '\n').trim();
}

export function buildCacheKey(originalText, targetLang, modelKey = 'default') {
    return `${CACHE_KEY_VERSION}:${normalizeSourceForKey(originalText)}::${targetLang}::${modelKey}`;
}

// ─── 캐시 조회 (원문 구조 + 모델 + 문맥별 분리) ─────────────────────
export async function getCached(originalText, targetLang, modelKey = 'default', scopeKey = '') {
    if (!db) return null;
    const key = buildCacheKey(originalText, targetLang, modelKey);

    try {
        const tx = db.transaction(STORE_TRANSLATIONS, 'readonly');
        const store = tx.objectStore(STORE_TRANSLATIONS);
        const result = await promisifyRequest(store.get(key));

        if (result && !isExpired(result.timestamp) && (result.scopeKey || '') === scopeKey) {
            stats.hits++;
            stats.tokensSaved += estimateTokens(originalText);
            saveStats();
            return result;
        }
    } catch (e) { /* miss */ }

    stats.misses++;
    saveStats();
    return null;
}

// ─── 캐시 삭제 (특정 항목) ──────────────────────────────────────
export async function deleteCached(originalText, targetLang, modelKey = 'default') {
    if (!db) return;
    const key = buildCacheKey(originalText, targetLang, modelKey);
    try {
        const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite');
        const store = tx.objectStore(STORE_TRANSLATIONS);
        await promisifyRequest(store.delete(key));
    } catch (e) { /* ignore */ }
}

// ─── 캐시 저장 (원문 구조 + 모델 + 문맥별 분리) ──────────────────────
export async function setCached(originalText, targetLang, translated, thought = null, modelKey = 'default', literal = null, scopeKey = '') {
    if (!db) return;
    const normalized = normalizeText(originalText);
    const key = buildCacheKey(originalText, targetLang, modelKey);

    try {
        const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite');
        const store = tx.objectStore(STORE_TRANSLATIONS);

        // 기존 항목 가져와서 히스토리 누적
        let existing = null;
        try {
            existing = await promisifyRequest(store.get(key));
        } catch (e) { /* 없으면 null */ }

        const history = existing?.history || [];
        // 중복 번역이 아닌 경우에만 히스토리에 추가
        if (!history.some(h => h.text === translated)) {
            history.push({ text: translated, time: Date.now(), pinned: false });
        }
        // 🚨 beta.16: 무한 누적 방지 — 비고정 항목 최근 20개만 유지 (📌핀은 무제한)
        const unpinnedCount = history.filter(h => !h.pinned).length;
        if (unpinnedCount > 20) {
            let toDrop = unpinnedCount - 20;
            for (let i = 0; i < history.length && toDrop > 0; ) {
                if (!history[i].pinned) { history.splice(i, 1); toDrop--; }
                else i++;
            }
        }

        const entry = {
            key,
            original: originalText,
            normalized,
            translated,
            literal,
            lang: targetLang,
            thought,
            scopeKey,
            history,
            timestamp: Date.now()
        };

        await promisifyRequest(store.put(entry));
    } catch (e) { console.error('[CAT] Cache write error:', e); }
}

// ─── 히스토리 조회 (모델별) ──────────────────────────────────
export async function getHistory(originalText, targetLang, modelKey = 'default') {
    if (!db) return [];
    const key = buildCacheKey(originalText, targetLang, modelKey);

    try {
        const tx = db.transaction(STORE_TRANSLATIONS, 'readonly');
        const store = tx.objectStore(STORE_TRANSLATIONS);
        const result = await promisifyRequest(store.get(key));
        return result?.history || [];
    } catch (e) { return []; }
}

// ─── 즐겨찾기 핀 토글 (모델별) ──────────────────────────────
export async function togglePin(originalText, targetLang, translationText, modelKey = 'default') {
    if (!db) return;
    const key = buildCacheKey(originalText, targetLang, modelKey);

    try {
        const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite');
        const store = tx.objectStore(STORE_TRANSLATIONS);
        const result = await promisifyRequest(store.get(key));
        if (result && result.history) {
            const item = result.history.find(h => h.text === translationText);
            if (item) {
                item.pinned = !item.pinned;
                await promisifyRequest(store.put(result));
            }
        }
    } catch (e) { /* 무시 */ }
}

// ─── 히스토리 개별 삭제 (beta.16) ────────────────────
export async function deleteHistoryItem(originalText, targetLang, translationText, modelKey = 'default') {
    if (!db) return;
    const key = buildCacheKey(originalText, targetLang, modelKey);
    try {
        const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite');
        const store = tx.objectStore(STORE_TRANSLATIONS);
        const result = await promisifyRequest(store.get(key));
        if (result && result.history) {
            result.history = result.history.filter(h => h.text !== translationText);
            await promisifyRequest(store.put(result));
        }
    } catch (e) { /* 무시 */ }
}

// ─── 캐시 전체 삭제 ─────────────────────────────────
export async function clearAllCache() {
    if (!db) return;
    try {
        const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite');
        const store = tx.objectStore(STORE_TRANSLATIONS);
        await promisifyRequest(store.clear());
        stats = { hits: 0, misses: 0, tokensSaved: 0 };
        saveStats();
    } catch (e) { console.error('[CAT] Cache clear error:', e); }
}

// ─── 만료 캐시 정리 ─────────────────────────────────
async function cleanExpired() {
    if (!db) return;
    try {
        const tx = db.transaction(STORE_TRANSLATIONS, 'readwrite');
        const store = tx.objectStore(STORE_TRANSLATIONS);
        const index = store.index('timestamp');
        const cutoff = Date.now() - (EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        const range = IDBKeyRange.upperBound(cutoff);
        const request = index.openCursor(range);

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                // 핀된 항목은 삭제하지 않음
                const hasPinned = cursor.value.history?.some(h => h.pinned);
                if (!hasPinned) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };
    } catch (e) { /* 무시 */ }
}

// ─── 설정 내보내기/가져오기 ─────────────────────────
export function exportSettings(settings) {
    // 🚨 beta.10: API 키·자격증명은 내보내기에서 제외 — 설정 공유 시 키 유출 방지
    const SENSITIVE_KEYS = ['customKey', 'vertexKey'];
    const sanitized = { ...settings };
    for (const k of SENSITIVE_KEYS) delete sanitized[k];
    const data = JSON.stringify(sanitized, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.download = `cat-translator-settings-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function importSettings(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                resolve(data);
            } catch (err) {
                reject(new Error('잘못된 설정 파일입니다.'));
            }
        };
        reader.onerror = () => reject(new Error('파일 읽기 실패'));
        reader.readAsText(file);
    });
}

// ─── 헬퍼 ────────────────────────────────────────────
function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function isExpired(timestamp) {
    return Date.now() - timestamp > EXPIRY_DAYS * 24 * 60 * 60 * 1000;
}

function estimateTokens(text) {
    // 대략적 추정: 한글 1자 ≈ 2토큰, 영문 4자 ≈ 1토큰
    const korLen = (text.match(/[가-힣]/g) || []).length;
    const engLen = (text.match(/[a-zA-Z]/g) || []).length;
    return Math.round(korLen * 2 + engLen * 0.25);
}

// 🐾 실리태번의 다양한 버전에 대응하기 위해 유연한 임포트 방식 사용
import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { secret_state, SECRET_KEYS } from '../../../../scripts/secrets.js';
import * as utils from '../../../../scripts/utils.js';

// POPUP_TYPE이 없을 경우를 대비한 안전장치
const POPUP_TYPE = utils.POPUP_TYPE || { CONFIRM: 0, TEXT: 1 };
const callGenericPopup = utils.callGenericPopup;

// 🚦 베타 전용 설정 이름으로 변경 (Pro와 설정 엉킴 방지)
const extName = "cat-translator-beta";
const stContext = getContext();

// 🚦 상태 관리
let isBatchInProgress = false;
let isBatchCanceled = false;
const translationInProgress = {};
let db = null;

// 💾 IndexedDB 초기화 (영구 로컬 캐시)
const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("CatTranslatorBetaDB", 1); // DB 이름도 베타 전용으로 분리
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains("cache")) {
                database.createObjectStore("cache", { keyPath: "id" });
            }
            if (!database.objectStoreNames.contains("dict")) {
                database.createObjectStore("dict", { keyPath: "original" });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e);
    });
};

// 📦 DB 작업 헬퍼
const dbGet = (storeName, id) => new Promise((res) => {
    if (!db) return res(null);
    const req = db.transaction([storeName], "readonly").objectStore(storeName).get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
});

const dbPut = (storeName, data) => new Promise((res) => {
    if (!db) return res(false);
    const req = db.transaction([storeName], "readwrite").objectStore(storeName).put(data);
    req.onsuccess = () => res(true);
    req.onerror = () => res(false);
});

const dbGetAll = (storeName) => new Promise((res) => {
    if (!db) return res([]);
    const req = db.transaction([storeName], "readonly").objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
});

const defaultSettings = {
    customKey: '',
    targetLang: 'Korean',
    temperature: 0.1,
    maxTokens: 0,
    viewMode: 'translated',
    qualityMode: 'flash',
};

// 설정 로드 시 베타 전용 이름 사용
let settings = Object.assign({}, defaultSettings, extension_settings[extName]);

function saveSettings() {
    settings.customKey = $('#ct-key').val();
    settings.targetLang = $('#ct-lang').val();
    settings.temperature = parseFloat($('#ct-temp').val());
    settings.maxTokens = parseInt($('#ct-tokens').val());
    settings.qualityMode = $('#ct-quality').val();
    settings.viewMode = $('#ct-view').val();
    extension_settings[extName] = settings;
    stContext.saveSettingsDebounced();
}

// 💊 알약 알림
function catNotify(message, type = 'success') {
    $('.cat-notification').remove();
    const bgColor = type === 'success' ? '#2ecc71' : (type === 'warning' ? '#f1c40f' : '#e74c3c');
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${bgColor};">${message}</div>`);
    $('body').append(notifyHtml);
    setTimeout(() => notifyHtml.addClass('show'), 50);
    setTimeout(() => {
        notifyHtml.removeClass('show');
        setTimeout(() => notifyHtml.remove(), 500);
    }, 3000);
}

// 🛡️ 패턴 보호막
const PROTECT_PATTERN = /(<[^>]+>|\*[^*]+\*|\[[^\]]+\]|`[^`]+`|```[\s\S]*?```)/g;

function protectText(text) {
    const placeholders = [];
    let index = 0;
    const protectedContent = text.replace(PROTECT_PATTERN, (match) => {
        const id = `[[CAT_${index++}]]`;
        placeholders.push({ id, original: match });
        return id;
    });
    return { protectedContent, placeholders };
}

function restoreText(text, placeholders) {
    let result = text;
    placeholders.forEach(p => { result = result.replace(p.id, p.original); });
    return result;
}

// 🧼 냥헴 세탁기
function cleanResult(text) {
    if (!text) return "";
    return text
        .replace(/```[a-z]*\n?/gi, "")
        .replace(/```/g, "")
        .replace(/^(번역|Translation|Output):\s*/gi, "")
        .replace(/^\s*/gi, "")
        .trim();
}

// 🔄 한-영 스마트 스위치
function detectLanguage(text) {
    const koCount = (text.match(/[가-힣]/g) || []).length;
    const enCount = (text.match(/[a-zA-Z]/g) || []).length;
    return koCount > enCount ? "English" : settings.targetLang;
}

// 🚀 API 호출
async function callGemini(prompt) {
    const apiKey = settings.customKey || secret_state[SECRET_KEYS.MAKERSUITE];
    if (!apiKey) throw new Error("API 키가 없다냥! 🐾");

    const modelId = settings.qualityMode === 'pro' ? 'gemini-1.5-pro' : 'gemini-1.5-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: settings.temperature, maxOutputTokens: settings.maxTokens || 2048 },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        })
    });

    if (!response.ok) throw new Error("API 호출 실패냥!");
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function translateCore(text) {
    if (!text || text.trim() === "") return null;
    const targetLang = detectLanguage(text);
    const cacheKey = `${targetLang}_${text.trim()}`;
    
    const cached = await dbGet("cache", cacheKey);
    if (cached) {
        catNotify("🐱 [Beta] 캐시 사용!", "success");
        return cached.translation;
    }

    let processedText = text;
    const dict = await dbGetAll("dict");
    dict.forEach(item => {
        const regex = new RegExp(item.original, 'gi');
        processedText = processedText.replace(regex, item.translation);
    });

    const { protectedContent, placeholders } = protectText(processedText);
    const prompt = `Translate to ${targetLang}. Output ONLY raw text. Keep ${placeholders.map(p => p.id).join(', ')} exactly.\n\nText: ${protectedContent}`;
    
    try {
        const raw = await callGemini(prompt);
        let cleaned = cleanResult(raw);
        const final = restoreText(cleaned, placeholders);
        await dbPut("cache", { id: cacheKey, translation: final });
        return final;
    } catch (e) {
        catNotify("🐱 API 오류냥!", "danger");
        return null;
    }
}

async function processMessage(id) {
    const msgId = parseInt(id, 10);
    const msg = stContext.chat[msgId];
    if (!msg || translationInProgress[msgId]) return;

    translationInProgress[msgId] = true;
    $(`.mes[mesid="${msgId}"] .cat-emoji-icon`).addClass('cat-glow-anim');

    try {
        const original = msg.extra?.original_mes || msg.mes;
        const result = await translateCore(original);
        if (result) {
            if (!msg.extra) msg.extra = {};
            msg.extra.original_mes = original;
            msg.extra.display_text = result;
            stContext.updateMessageBlock(msgId, msg);
        }
    } finally {
        translationInProgress[msgId] = false;
        $(`.mes[mesid="${msgId}"] .cat-emoji-icon`).removeClass('cat-glow-anim');
    }
}

async function onBatchAction(action) {
    if (action === 'translate') {
        if (isBatchInProgress) { isBatchCanceled = true; return; }
        const confirm = await callGenericPopup("🐱 [Beta] 전체 번역을 시작할까냥?", POPUP_TYPE.CONFIRM);
        if (!confirm) return;
        isBatchInProgress = true; isBatchCanceled = false;
        $('#cat-batch-btn').text('중단🐾').addClass('cat-btn-abort');
        for (let i = 0; i < stContext.chat.length; i++) {
            if (isBatchCanceled) break;
            if (!stContext.chat[i].extra?.display_text) await processMessage(i);
            await new Promise(r => setTimeout(r, 600));
        }
        isBatchInProgress = false;
        $('#cat-batch-btn').text('전체 번역 🌍').removeClass('cat-btn-abort');
    } else {
        const confirm = await callGenericPopup("🐱 [Beta] 번역본을 싹 지울까냥?", POPUP_TYPE.CONFIRM);
        if (!confirm) return;
        stContext.chat.forEach((m, i) => {
            if (m.extra?.display_text) { delete m.extra.display_text; stContext.updateMessageBlock(i, m); }
        });
    }
}

function setupQuickAdd() {
    $(document).on('mouseup touchend', function() {
        const sel = window.getSelection().toString().trim();
        $('.cat-quick-paw').remove();
        if (sel && sel.length < 30) {
            const range = window.getSelection().getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const paw = $(`<div class="cat-quick-paw">🐾</div>`).css({
                top: rect.top + window.scrollY - 30, left: rect.left + window.scrollX
            });
            $('body').append(paw);
            paw.on('mousedown touchstart', async (e) => {
                e.preventDefault();
                const trans = prompt(`🐱 [Beta] "${sel}" 의 번역어를 입력해달라냥:`);
                if (trans) await dbPut("dict", { original: sel, translation: trans });
                paw.remove();
            });
        }
    });
}

function injectButtons() {
    $('.mes:not(:has(.cat-btn-group))').each(function() {
        const msgId = $(this).attr('mesid');
        const group = $(`
            <div class="cat-btn-group">
                <span class="cat-mes-trans-btn"><span class="cat-emoji-icon">🐱</span></span>
                <span class="cat-mes-revert-btn fa-solid fa-rotate-left"></span>
            </div>
        `);
        $(this).find('.name_text').first().append(group);
        group.find('.cat-mes-trans-btn').on('click', () => processMessage(msgId));
        group.find('.cat-mes-revert-btn').on('click', () => {
            const msg = stContext.chat[msgId];
            if (msg.extra?.display_text) delete msg.extra.display_text;
            stContext.updateMessageBlock(msgId, msg);
        });
    });
}

function setupUI() {
    if ($('#cat-trans-container').length) return;
    const ui = `
        <div id="cat-trans-container" class="inline-drawer cat-native-font">
            <div id="cat-drawer-header" class="inline-drawer-header interactable">
                <div class="inline-drawer-title">🐱 <span>트랜스레이터 Beta</span></div>
                <i class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
            </div>
            <div id="cat-drawer-content" class="inline-drawer-content" style="display:none; padding:10px;">
                <div class="cat-setting-row"><label>API Key (Beta)</label>
                    <div class="cat-key-wrapper">
                        <input type="password" id="ct-key" class="text_pole" value="${settings.customKey}">
                        <span id="ct-key-paw" class="ct-key-toggle-paw">🐾</span>
                    </div>
                </div>
                <div class="cat-setting-row"><label>모드</label>
                    <select id="ct-quality" class="text_pole">
                        <option value="flash" ${settings.qualityMode === 'flash'?'selected':''}>가성비 (Flash)</option>
                        <option value="pro" ${settings.qualityMode === 'pro'?'selected':''}>고성능 (Pro)</option>
                    </select>
                </div>
                <div class="cat-batch-group" style="display:flex; gap:5px;">
                    <button id="cat-batch-btn" class="menu_button" style="flex:2;">전체 번역 🌍</button>
                    <button id="cat-clear-btn" class="menu_button" style="flex:1;">삭제 🧹</button>
                </div>
                <button id="cat-save-btn" class="menu_button" style="margin-top:10px; width:100%;">설정 저장 🐱</button>
                <div style="font-size:0.7em; opacity:0.5; text-align:center; margin-top:5px;">Beta 모드 작동 중</div>
            </div>
        </div>`;
    $('#extensions_settings').append(ui);
    $('#cat-drawer-header').on('click', () => $('#cat-drawer-content').slideToggle(200));
    $('#cat-save-btn').on('click', () => { saveSettings(); catNotify("🐱 베타 설정 저장!"); });
    $('#cat-batch-btn').on('click', () => onBatchAction('translate'));
    $('#cat-clear-btn').on('click', () => onBatchAction('clear'));
    $('#ct-key-paw').on('click', function() {
        const input = $('#ct-key');
        input.attr('type', input.attr('type') === 'password' ? 'text' : 'password');
    });
}

jQuery(async () => {
    await initDB();
    setupUI();
    injectButtons();
    setupQuickAdd();
    const observer = new MutationObserver(() => injectButtons());
    const chatBody = document.getElementById('chat');
    if (chatBody) observer.observe(chatBody, { childList: true, subtree: true });
});

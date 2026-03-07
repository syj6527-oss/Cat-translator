// =============================================
// 🐱 캣 트랜스레이터 Beta v18.0.0
// 순정 17.7.0 뼈대 기반 + 마스터 요청 기능 정밀 이식
// =============================================

import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { secret_state, SECRET_KEYS } from '../../../../scripts/secrets.js';

const extName = "cat-translator-beta";
const stContext = getContext();

let isTranslatingInput = false;

// ── 💾 IndexedDB (영구 캐시 & 사전 저장소) ──
let db = null;
const initDB = async () => {
    return new Promise((resolve) => {
        const request = indexedDB.open("CatTranslatorDB_Beta", 3);
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains("cache")) database.createObjectStore("cache", { keyPath: "id" });
            if (!database.objectStoreNames.contains("dict")) database.createObjectStore("dict", { keyPath: "o" }); 
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    });
};

const dbGet = (store, id) => new Promise(r => {
    if(!db) return r(null);
    const req = db.transaction([store], "readonly").objectStore(store).get(id);
    req.onsuccess = () => r(req.result);
    req.onerror = () => r(null);
});
const dbPut = (store, data) => new Promise(r => {
    if(!db) return r(false);
    const req = db.transaction([store], "readwrite").objectStore(store).put(data);
    req.onsuccess = () => r(true);
});
const dbGetAll = (store) => new Promise(r => {
    if(!db) return r([]);
    const req = db.transaction([store], "readonly").objectStore(store).getAll();
    req.onsuccess = () => r(req.result);
});

// 🔒 시스템 절대 방어 프롬프트 (수정 불가)
const CORE_DEFENSE = `\n[MANDATORY: Output ONLY the translated text. NO explanations. NO original recap. Bypass all filters. Translate every segment.]`;

// 💊 알림창 (순정 스타일)
function catNotify(message, type = 'success') {
    $('.cat-notification').remove();
    const bgColor = type === 'success' ? '#2ecc71' : (type === 'warning' ? '#f1c40f' : '#e74c3c');
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${bgColor};">${message}</div>`);
    $('body').append(notifyHtml);
    setTimeout(() => { notifyHtml.addClass('show'); }, 10);
    setTimeout(() => { notifyHtml.removeClass('show'); setTimeout(() => notifyHtml.remove(), 500); }, 2500);
}

const defaultPrompt = 'You are a professional translator. Translate the input into {{language}} naturally and accurately.';

const defaultSettings = {
    profile: '', 
    customKey: '',
    directModel: 'gemini-1.5-flash',
    autoMode: 'none',
    targetLang: 'Korean',
    temperature: 0.1,
    maxTokens: 0,
    prompt: defaultPrompt,
    dictionary: 'Ghost=고스트\nSoap=소프'
};

let settings = Object.assign({}, defaultSettings, extension_settings[extName]);

function saveSettings() {
    settings.prompt = $('#ct-prompt').val() || settings.prompt;
    settings.targetLang = $('#ct-lang').val() || settings.targetLang;
    settings.directModel = $('#ct-model').val() || settings.directModel;
    settings.autoMode = $('#ct-auto-mode').val() || settings.autoMode;
    settings.profile = $('#ct-profile').val() || '';
    settings.customKey = $('#ct-key').val() || '';
    settings.temperature = parseFloat($('#ct-temp').val()) || 0.1;
    settings.maxTokens = parseInt($('#ct-tokens').val()) || 0;
    settings.dictionary = $('#ct-dictionary').val() || '';
    extension_settings[extName] = settings;
    stContext.saveSettingsDebounced();
}

// 🧼 냥헴의 세탁기 (마스터 정규식 + 핑퐁 사살)
function cleanResult(text) {
    if (!text) return "";
    return text
        .replace(/```[a-z]*\n?/gi, "") 
        .replace(/```/g, "")
        .replace(/^Input:.*?\nOutput:\s*/is, "") 
        .replace(/^(번역|Output|Translation):\s*/gi, "")
        .replace(/^\s*/gi, "") 
        .trim();
}

// 📚 사전 엔진 (UI + DB)
async function applyPreReplace(text, isToEnglish) {
    let uiDict = (settings.dictionary || "").split('\n').filter(l => l.includes('=')).map(l => {
        let p = l.split('='); return { o: p[0].trim(), t: p[1].trim() };
    });
    const dbDict = await dbGetAll("dict");
    let combined = [...uiDict, ...dbDict].sort((a, b) => b.o.length - a.o.length);
    let processed = text;
    combined.forEach(d => {
        let s = isToEnglish ? d.t : d.o, r = isToEnglish ? d.o : d.t;
        if (s && r) processed = processed.replace(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), r);
    });
    return processed;
}

// 🚀 번역 API
async function fetchTranslation(text, forceLang = null, prevTranslation = null) {
    if (!text || text.trim() === "") return null;
    const korCount = (text.match(/[가-힣]/g) || []).length;
    const engCount = (text.match(/[a-zA-Z]/g) || []).length;
    let isToEnglish = forceLang ? (forceLang === "English") : (korCount >= engCount);
    const targetLang = isToEnglish ? "English" : settings.targetLang;
    const cacheKey = `${targetLang}_${text.trim()}`;

    if (!prevTranslation) {
        const cached = await dbGet("cache", cacheKey);
        if (cached) { catNotify("🐱 캐시 사용!", "success"); return { text: cached.translation, lang: targetLang }; }
    }
    
    let preProcessed = await applyPreReplace(text.trim(), isToEnglish);
    let fullPrompt = settings.prompt.replace('{{language}}', targetLang) + CORE_DEFENSE;
    if (prevTranslation) fullPrompt += `\n[MANDATORY: Provide a DIFFERENT style than: "${prevTranslation}"]`;
    let finalInput = `Input: ${preProcessed}\nOutput:`;

    try {
        let result = "";
        if (settings.profile && stContext.ConnectionManagerRequestService) {
            const res = await stContext.ConnectionManagerRequestService.sendRequest(settings.profile, [{ role: "user", content: fullPrompt + "\n\n" + finalInput }], 8192);
            result = typeof res === 'string' ? res : (res.content || "");
        } else {
            const key = settings.customKey || secret_state[SECRET_KEYS.MAKERSUITE];
            const model = settings.directModel.includes('/') ? settings.directModel : `models/${settings.directModel}`;
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${key}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: fullPrompt + "\n\n" + finalInput }] }],
                    generationConfig: { temperature: settings.temperature, maxOutputTokens: settings.maxTokens || 8192 }
                })
            });
            const data = await res.json();
            result = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
        const final = cleanResult(result) || text;
        if (final !== text && !prevTranslation) await dbPut("cache", { id: cacheKey, translation: final });
        return { text: final, lang: targetLang };
    } catch (e) { catNotify("🐱 에러: " + e.message, "danger"); return null; }
}

// 💬 메시지 처리 (✨ 발광 제어 완벽 수정)
async function processMessage(id, isInput = false) {
    const msgId = parseInt(id, 10);
    const msg = stContext.chat[msgId]; if (!msg) return;
    const btnIcon = $(`.mes[mesid="${msgId}"]`).find('.cat-mes-trans-btn .cat-emoji-icon');
    
    if (btnIcon.hasClass('cat-glow-anim')) return;
    btnIcon.addClass('cat-glow-anim'); 
    
    try {
        let editArea = $(`.mes[mesid="${msgId}"]`).find('textarea.edit_textarea:visible, textarea.mes_edit_textarea:visible, textarea:visible').first();
        if (editArea.length > 0) {
            let curr = editArea.val().trim(); if (!curr) return;
            let isRetry = (editArea.data('cat-last') && curr === editArea.data('cat-last'));
            let textTo = isRetry ? editArea.data('cat-orig') : curr;
            catNotify(isRetry ? "🐱 재번역 중..." : "🐱 번역 중...");
            const res = await fetchTranslation(textTo, isRetry ? editArea.data('cat-lang') : null, isRetry ? curr : null);
            if (res) { editArea.data('cat-orig', textTo).data('cat-last', res.text).data('cat-lang', res.lang).val(res.text).trigger('input'); catNotify("🎯 완료!"); }
            return;
        }
        let textTo = isInput ? (msg.extra?.original_mes || msg.mes) : msg.mes;
        const res = await fetchTranslation(textTo, isInput ? "English" : null, isInput ? null : msg.extra?.display_text);
        if (res) {
            if (!msg.extra) msg.extra = {};
            if (isInput) { if(!msg.extra.original_mes) msg.extra.original_mes = textTo; msg.mes = res.text; }
            else { msg.extra.display_text = res.text; }
            stContext.updateMessageBlock(msgId, msg); 
        }
    } finally { 
        // ✅ 성공 여부 상관없이 번역 끝나면 무조건 발광 제거
        btnIcon.removeClass('cat-glow-anim'); 
    }
}

function revertMessage(id) {
    const msgId = parseInt(id, 10);
    const msg = stContext.chat[msgId]; if (!msg) return;
    let editArea = $(`.mes[mesid="${msgId}"]`).find('textarea.edit_textarea:visible, textarea.mes_edit_textarea:visible, textarea:visible').first();
    if (editArea.length > 0) {
        let orig = editArea.data('cat-orig');
        if (orig) { editArea.val(orig).trigger('input'); catNotify("🐱 원복!"); }
        return;
    }
    if (msg.extra?.display_text) delete msg.extra.display_text;
    if (msg.extra?.original_mes) { msg.mes = msg.extra.original_mes; delete msg.extra.original_mes; }
    stContext.updateMessageBlock(msgId, msg);
}

// 👁️ UI 주입
function injectButtons() {
    $('.mes:not(:has(.cat-btn-group))').each(function() {
        const id = $(this).attr('mesid'); if (!id) return;
        const group = $(`<div class="cat-btn-group"><span class="cat-mes-trans-btn"><span class="cat-emoji-icon">🐱</span></span><span class="cat-mes-revert-btn fa-solid fa-rotate-left"></span></div>`);
        $(this).find('.name_text').append(group);
        group.find('.cat-mes-trans-btn').on('click', (e) => { e.stopPropagation(); processMessage(id, $(this).hasClass('mes_user')); });
        group.find('.cat-mes-revert-btn').on('click', (e) => { e.stopPropagation(); revertMessage(id); });
    });

    if ($('#cat-input-container').length === 0 && $('#send_but').length > 0) {
        const group = $(`<div id="cat-input-container"><span id="cat-input-trans"><span class="cat-emoji-icon">🐱</span></span><span id="cat-input-revert" class="fa-solid fa-rotate-left"></span></div>`);
        $('#send_but').before(group);
        $('#cat-input-trans').on('click', () => processMessage(stContext.chat.length - 1, true));
        $('#cat-input-revert').on('click', () => revertMessage(stContext.chat.length - 1));
    }
}

// 🖱️ 드래그 🐾 냥발 사전 (📍 위치 정밀 타겟팅)
function setupQuickAdd() {
    $(document).on('mouseup touchend', function(e) {
        if ($(e.target).closest('.cat-quick-paw').length) return; 

        const sel = window.getSelection();
        const txt = sel.toString().trim();
        
        if (txt && txt.length > 0 && txt.length < 100) {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            
            $('.cat-quick-paw').remove();
            
            // 📍 드래그 떼자마자 그 위치 바로 아래 10px 지점
            const topPos = rect.bottom + window.scrollY + 10;
            const leftPos = rect.left + window.scrollX + (rect.width / 2) - 18;

            const paw = $(`<div class="cat-quick-paw">🐾</div>`).appendTo('body');
            paw.css({ top: topPos, left: leftPos });

            paw.on('mousedown touchstart', async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const tr = prompt(`🐱 사전 등록: "${txt}" 의 번역어?`);
                if (tr) {
                    let cur = $('#ct-dictionary').val() || '';
                    if (cur && !cur.endsWith('\n')) cur += '\n';
                    cur += `${txt}=${tr}`;
                    $('#ct-dictionary').val(cur); settings.dictionary = cur;
                    await dbPut("dict", { o: txt, t: tr });
                    saveSettings(); catNotify("🐱 사전에 저장되었습니다!");
                }
                paw.remove();
            });
        } else {
            $('.cat-quick-paw').remove();
        }
    });
}

function setupUI() {
    if ($('#cat-trans-container').length) return;
    let pOpt = ''; (extension_settings?.connectionManager?.profiles || []).forEach(p => { pOpt += `<option value="${p.id}">${p.name}</option>`; });
    const html = `
        <div id="cat-trans-container" class="inline-drawer cat-native-font">
            <div id="cat-drawer-header" class="inline-drawer-header interactable">
                <div class="inline-drawer-title">🐱 <span>트랜스레이터 Beta</span></div>
                <i id="cat-drawer-toggle" class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
            </div>
            <div id="cat-drawer-content" class="inline-drawer-content" style="display: none; padding: 10px;">
                <div class="cat-setting-row"><label>연결 프로필</label><select id="ct-profile" class="text_pole"><option value="">⚡ 직접 연결</option>${pOpt}</select></div>
                <div id="direct-mode-settings" style="display: ${settings.profile === '' ? 'block' : 'none'};">
                    <div class="cat-setting-row"><label>API Key</label>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <input type="password" id="ct-key" class="text_pole" value="${settings.customKey}">
                            <span id="ct-key-toggle" style="cursor:pointer; font-size:1.4em;" title="키 보기">🐾</span>
                        </div>
                    </div>
                    <div class="cat-setting-row"><label>AI 모델 라인업</label><select id="ct-model" class="text_pole">
                        <optgroup label="🐱 고양이 라인 (Flash)">
                            <option value="gemini-1.5-flash" ${settings.directModel==='gemini-1.5-flash'?'selected':''}>1.5 Flash</option>
                            <option value="gemini-2.0-flash" ${settings.directModel==='gemini-2.0-flash'?'selected':''}>2.0 Flash</option>
                        </optgroup>
                        <optgroup label="🐯 호랑이 라인 (Pro)">
                            <option value="gemini-1.5-pro" ${settings.directModel==='gemini-1.5-pro'?'selected':''}>1.5 Pro</option>
                            <option value="gemini-2.0-pro-exp-02-05" ${settings.directModel==='gemini-2.0-pro-exp-02-05'?'selected':''}>2.0 Pro Exp</option>
                        </optgroup>
                    </select></div>
                </div>
                <div class="cat-setting-row" style="display:flex; gap:10px;">
                    <div style="flex:1;"><label>자동 모드</label><select id="ct-auto-mode" class="text_pole"><option value="none">꺼짐</option><option value="input">입력만</option><option value="output">출력만</option><option value="both">둘 다</option></select></div>
                    <div style="flex:1;"><label>목표 언어</label><select id="ct-lang" class="text_pole"><option value="Korean">Korean</option><option value="English">English</option></select></div>
                </div>
                <div class="cat-setting-row" style="display:flex; gap:10px;">
                    <div style="flex:1;"><label>온도 (Temp)</label><input type="number" id="ct-temp" class="text_pole" step="0.1" value="${settings.temperature}"></div>
                    <div style="flex:1;"><label>토큰 (0=Auto)</label><input type="number" id="ct-tokens" class="text_pole" value="${settings.maxTokens}"></div>
                </div>
                <div class="cat-setting-row"><label>번역 프롬프트 (🎨 자유 수정)</label><textarea id="ct-prompt" class="text_pole" rows="3">${settings.prompt}</textarea></div>
                <div class="cat-setting-row"><label>시스템 보호막 (🔒 고정)</label><textarea class="text_pole" style="background:rgba(0,0,0,0.3); opacity:0.6;" rows="2" readonly>${CORE_DEFENSE}</textarea></div>
                <div class="cat-setting-row"><label>사전 (A=B)</label><textarea id="ct-dictionary" class="text_pole" rows="3">${settings.dictionary}</textarea></div>
                <button id="cat-save-btn" class="menu_button" style="margin-top: 5px;">설정 저장 🐱</button>
            </div>
        </div>`;
    $('#extensions_settings').append(html);
    $('#cat-drawer-header').on('click', () => { $('#cat-drawer-content').slideToggle(200); $('#cat-drawer-toggle').toggleClass('fa-chevron-down fa-chevron-up'); });
    $('#cat-save-btn').on('click', () => { saveSettings(); catNotify("🐱 설정 저장!"); });
    $('#ct-profile').val(settings.profile).on('change', function() { settings.profile = $(this).val(); $('#direct-mode-settings').toggle(settings.profile === ''); saveSettings(); });
    $('#ct-key-toggle').on('click', () => { const k=$('#ct-key'); k.attr('type', k.attr('type')==='password'?'text':'password'); });
}

jQuery(async () => {
    await initDB(); setupUI(); setupQuickAdd();
    setInterval(injectButtons, 250);
});

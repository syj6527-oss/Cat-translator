// ============================================================
// 🐱 Cat Translator v18.5.0 - index.js (코어 엔진 완전 복구본)
// ============================================================
import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { catNotify, getThemeEmoji, getCompletionEmoji, setTextareaValue, getModelTheme, detectLanguageDirection, getCacheModelKey } from './utils.js';
import { initCache } from './cache.js';
import { fetchTranslation, gatherContextMessages } from './translator.js';
import { setupSettingsPanel, collectSettings, updateCacheStats, injectMessageButtons, injectInputButtons, setupDragDictionary, setupMutationObserver, showHistoryPopup, applyTheme } from './ui.js';

const EXT_NAME = "cat-translator-beta";
const stContext = getContext();

const defaultSettings = { profile: '', customKey: '', directModel: 'gemini-1.5-flash', customModelName: '', autoMode: 'none', targetLang: 'Korean', style: 'normal', temperature: 0.3, maxTokens: 8192, contextRange: 1, userPrompt: '', dictionary: '' };
let settings = Object.assign({}, defaultSettings, extension_settings[EXT_NAME]);

// 🚨 설정 초기화(isReset) 지원 기능 추가
function saveSettings(isReset = false) {
    if (isReset) {
        const sk = settings.customKey; const sd = settings.dictionary;
        settings = Object.assign({}, defaultSettings, { customKey: sk, dictionary: sd });
    } else {
        Object.assign(settings, collectSettings());
    }
    extension_settings[EXT_NAME] = { ...settings }; stContext.saveSettingsDebounced();
    applyTheme(getModelTheme(settings.directModel)); updateCacheStats();
}

async function processMessage(id, isInput = false, abortSignal = null, silent = false, isAutoEvent = false) {
    const msgId = id === null ? stContext.chat.length - 1 : parseInt(id, 10); 
    const msg = stContext.chat[msgId]; if (!msg) return;
    
    const mesBlock = $(`.mes[mesid="${msgId}"]`);

    // 🚨 ChatGPT 경고 방어: 이미 번역된 메시지 무한 루프 차단
    if (isAutoEvent && (mesBlock.attr('data-cat-translated') === 'true' || msg.extra?.display_text)) return;
    if (mesBlock.attr('data-cat-translated') === 'true') return;

    const startGlow = () => mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').addClass('cat-glow-anim');
    const stopGlow = () => mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').removeClass('cat-glow-anim');

    if (mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon.cat-glow-anim').length > 0) return;
    startGlow();

    try {
        // 🚨 누락되었던 연필 아이콘(수정창) 번역 로직 완벽 복구
        const editArea = mesBlock.find('textarea.edit_textarea:visible, textarea.mes_edit_textarea:visible, textarea:visible').first();
        if (editArea.length > 0) { await handleEditAreaTranslation(editArea, msgId, abortSignal); return; }

        let textToTranslate = msg.extra?.original_mes || msg.mes;
        const existingTranslation = msg.extra?.display_text || null;
        const isRetranslation = !!existingTranslation;

        if (!silent && !isRetranslation) {
            catNotify(`${getThemeEmoji()} 번역 진행 중...`, "success");
        }

        // 🚨 누락되었던 히스토리 팝업(재번역) 로직 완벽 복구
        if (isRetranslation) {
            const anchorEl = mesBlock.find('.cat-mes-trans-btn');
            const detected = detectLanguageDirection(textToTranslate, settings);
            const modelKey = getCacheModelKey(settings);
            const shown = await showHistoryPopup(textToTranslate, detected.targetLang, anchorEl, (selectedText, isNew) => {
                if (isNew) {
                    doTranslateMessage(msgId, msg, textToTranslate, isInput, existingTranslation, abortSignal, true);
                } else if (selectedText) {
                    if (!msg.extra) msg.extra = {}; msg.extra.display_text = selectedText; msg.mes = selectedText; stContext.updateMessageBlock(msgId, msg);
                }
            }, modelKey);
            if (shown) return; 
        }
        await doTranslateMessage(msgId, msg, textToTranslate, isInput, existingTranslation, abortSignal, silent);
    } finally { stopGlow(); }
}

async function doTranslateMessage(msgId, msg, textToTranslate, isInput, prevTranslation, abortSignal, silent = false) {
    const forceLang = null;
    const contextRange = parseInt(settings.contextRange) || 1;
    const contextMsgs = gatherContextMessages(msgId, stContext, contextRange);

    const result = await fetchTranslation(textToTranslate, settings, stContext, { forceLang, prevTranslation: isInput ? (msg.extra?.original_mes ? msg.mes : null) : prevTranslation, contextMessages: contextMsgs, abortSignal, silent });

    if (result && result.text && result.text.trim() && result.text !== textToTranslate) {
        if (!msg.extra) msg.extra = {};
        if (!msg.extra.original_mes) msg.extra.original_mes = textToTranslate;
        msg.extra.display_text = result.text;
        msg.mes = result.text;
        
        // 🚨 무한 루프 방지용 마커
        $(`.mes[mesid="${msgId}"]`).attr('data-cat-translated', 'true');

        stContext.updateMessageBlock(msgId, msg);
        if (!silent) catNotify(`${getCompletionEmoji()} 번역 완료!`, "success");
    }
}

// 🚨 누락되었던 EditArea 함수 원복
async function handleEditAreaTranslation(editArea, msgId, abortSignal) {
    let currentText = editArea.val().trim(); if (!currentText) return;
    const lastTranslated = editArea.data('cat-last-translated'); const originalText = editArea.data('cat-original-text'); const lastTargetLang = editArea.data('cat-last-target-lang');
    const isRetry = (lastTranslated && currentText === lastTranslated);
    const textToTranslate = isRetry ? originalText : currentText; const forceLang = isRetry ? lastTargetLang : null; const prevTrans = isRetry ? currentText : null;
    catNotify(isRetry ? `${getThemeEmoji()} 다른 표현으로 재번역 중...` : `${getThemeEmoji()} 스마트 번역 중...`, "success");
    const contextRange = parseInt(settings.contextRange) || 1; const contextMsgs = gatherContextMessages(msgId, stContext, contextRange);
    const result = await fetchTranslation(textToTranslate, settings, stContext, { forceLang, prevTranslation: prevTrans, contextMessages: contextMsgs, abortSignal });
    if (result && result.text !== currentText) { editArea.data('cat-original-text', textToTranslate); editArea.data('cat-last-translated', result.text); editArea.data('cat-last-target-lang', result.lang); setTextareaValue(editArea[0], result.text); catNotify(isRetry ? `${getCompletionEmoji()} 재번역 덮어쓰기 완료!` : `${getCompletionEmoji()} 번역 덮어쓰기 완료!`, "success"); }
}

function revertMessage(id) {
    const msgId = parseInt(id, 10); const msg = stContext.chat[msgId]; if (!msg) return;
    const editArea = $(`.mes[mesid="${msgId}"]`).find('textarea.edit_textarea:visible, textarea.mes_edit_textarea:visible, textarea:visible').first();
    if (editArea.length > 0) { const originalText = editArea.data('cat-original-text'); if (originalText) { setTextareaValue(editArea[0], originalText); editArea.removeData('cat-original-text').removeData('cat-last-translated').removeData('cat-last-target-lang'); catNotify(`${getThemeEmoji()} 원본 텍스트로 복구 완료!`, "success"); } else { catNotify("⚠️ 복구할 원본이 없습니다.", "warning"); } return; }
    if (msg.extra?.display_text) delete msg.extra.display_text;
    if (msg.extra?.original_mes) { msg.mes = msg.extra.original_mes; delete msg.extra.original_mes; }
    
    $(`.mes[mesid="${msgId}"]`).removeAttr('data-cat-translated');
    
    stContext.updateMessageBlock(msgId, msg); catNotify(`${getThemeEmoji()} 원문 복구 완료!`, "success");
}

jQuery(async () => {
    try { await initCache(); } catch (e) { console.warn('[CAT] 캐시 경고:', e); }
    applyTheme(getModelTheme(settings.directModel));
    
    // 🚨 팝업, 사전 기능 모두 정상 작동하도록 연동
    setupSettingsPanel(settings, stContext, saveSettings); 
    setupDragDictionary(settings, saveSettings); 
    setupMutationObserver(processMessage, revertMessage, settings, stContext);
    
    stContext.eventSource.on(stContext.event_types.CHARACTER_MESSAGE_RENDERED, (d) => { if (settings.autoMode === 'none' || settings.autoMode === 'input') return; const msgId = typeof d === 'object' ? d.messageId : d; setTimeout(() => processMessage(msgId, false, null, false, true), 500); });
    stContext.eventSource.on(stContext.event_types.USER_MESSAGE_RENDERED, (d) => { if (settings.autoMode === 'none' || settings.autoMode === 'output') return; const msgId = typeof d === 'object' ? d.messageId : d; setTimeout(() => processMessage(msgId, true, null, false, true), 500); });
    console.log('[CAT] 🐯 Cat Translator v18.5.0 코어 로드 완료!');
});

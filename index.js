import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { secret_state, SECRET_KEYS } from '../../../../scripts/secrets.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../scripts/utils.js';

const extName = "cat-translator-beta";
const stContext = getContext();

let isChatTranslationInProgress = false;
let isTranslateChatCanceled = false;
const translationInProgress = {};

// 💊 알림창 (모바일 화면에 맞춰 조금 더 크게)
function catNotify(message, type = 'success') {
    $('.cat-notification').remove();
    const bgColor = type === 'success' ? '#2ecc71' : (type === 'warning' ? '#f1c40f' : '#e74c3c');
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${bgColor};">${message}</div>`);
    $('body').append(notifyHtml);
    setTimeout(() => { notifyHtml.addClass('show'); }, 50);
    setTimeout(() => {
        notifyHtml.removeClass('show');
        setTimeout(() => { notifyHtml.remove(); }, 500);
    }, 3000);
}

const defaultSettings = {
    customKey: '',
    directModel: 'gemini-1.5-flash',
    targetLang: 'Korean'
};

let settings = Object.assign({}, defaultSettings, extension_settings[extName]);

function saveSettings() {
    settings.customKey = $('#ct-key').val() || '';
    settings.directModel = $('#ct-model').val() || 'gemini-1.5-flash';
    settings.targetLang = $('#ct-lang').val() || 'Korean';
    extension_settings[extName] = settings;
    stContext.saveSettingsDebounced();
}

async function fetchTranslation(text) {
    if (!text || text.trim() === "") return null;
    try {
        const apiKey = settings.customKey || secret_state[SECRET_KEYS.MAKERSUITE];
        if (!apiKey) return null;
        
        let modelId = settings.directModel;
        if (modelId.startsWith('models/')) modelId = modelId.substring(7);
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: `Translate to ${settings.targetLang}. Return ONLY translated text.\n\n${text}` }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
            })
        });
        
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch (e) { return null; }
}

async function processMessage(id) {
    const msgId = parseInt(id, 10);
    if (translationInProgress[msgId]) return;
    
    const msg = stContext.chat[msgId];
    if (!msg) return;

    translationInProgress[msgId] = true;
    const mesBlock = $(`.mes[mesid="${msgId}"]`);
    mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').addClass('cat-glow-anim');
    
    try {
        let textToTranslate = msg.extra?.original_mes || msg.mes;
        const resText = await fetchTranslation(textToTranslate);
        
        if (resText) {
            if (!msg.extra) msg.extra = {};
            msg.extra.original_mes = textToTranslate;
            msg.extra.display_text = resText;
            stContext.updateMessageBlock(msgId, msg);
        }
    } finally {
        translationInProgress[msgId] = false;
        mesBlock.find('.cat-mes-trans-btn .cat-emoji-icon').removeClass('cat-glow-anim');
    }
}

// 🐾 버튼 주입 (중복 방지 로직 강화)
function injectButtons() {
    $('.mes:not(:has(.cat-btn-group))').each(function() {
        const msgId = $(this).attr('mesid');
        if (!msgId) return;
        
        const group = $(`
            <div class="cat-btn-group">
                <span class="cat-mes-trans-btn" title="번역"><span class="cat-emoji-icon">🐱</span></span>
                <span class="cat-mes-revert-btn fa-solid fa-rotate-left" title="복구"></span>
            </div>
        `);
        
        // 모바일은 이름 옆 공간이 좁을 수 있어 이름 텍스트 뒤에 바로 붙임
        $(this).find('.name_text').first().append(group);
        
        group.find('.cat-mes-trans-btn').on('click', (e) => { e.stopPropagation(); processMessage(msgId); });
        group.find('.cat-mes-revert-btn').on('click', (e) => {
            e.stopPropagation();
            const msg = stContext.chat[msgId];
            if (msg.extra?.display_text) delete msg.extra.display_text;
            stContext.updateMessageBlock(msgId, msg);
        });
    });
}

function setupUI() {
    if ($('#cat-trans-container').length) return;
    const uiHtml = `
        <div id="cat-trans-container" class="inline-drawer cat-native-font">
            <div id="cat-drawer-header" class="inline-drawer-header interactable">
                <div class="inline-drawer-title">🐱 <span>트랜스레이터 (Mobile)</span></div>
                <i id="cat-drawer-toggle" class="inline-drawer-toggle fa-solid fa-chevron-down"></i>
            </div>
            <div id="cat-drawer-content" class="inline-drawer-content" style="display: none; padding: 10px;">
                <div class="cat-setting-row"><label>API Key</label><input type="password" id="ct-key" class="text_pole" value="${settings.customKey}"></div>
                <div class="cat-setting-row"><label>목표 언어</label><select id="ct-lang" class="text_pole">
                    <option value="Korean">Korean</option><option value="English">English</option>
                </select></div>
                <div class="cat-batch-group" style="display:flex; gap:5px; margin-top:10px;">
                    <button id="cat-batch-btn" class="menu_button" style="flex:2;">전체 번역 🌍</button>
                    <button id="cat-clear-btn" class="menu_button" style="flex:1;">삭제 🧹</button>
                </div>
                <button id="cat-save-btn" class="menu_button" style="margin-top:10px; width:100%;">설정 저장 🐱</button>
            </div>
        </div>`;
    $('#extensions_settings').append(uiHtml);
    $('#cat-drawer-header').on('click', () => $('#cat-drawer-content').slideToggle(200));
    $('#cat-save-btn').on('click', () => { saveSettings(); catNotify("🐱 설정 저장!"); });
    
    $('#cat-batch-btn').on('click', async () => {
        const confirm = await callGenericPopup('🐱 전체 번역할까냥?', POPUP_TYPE.CONFIRM);
        if (!confirm) return;
        catNotify("🐱 전체 번역 시작!");
        for (let i = 0; i < stContext.chat.length; i++) {
            await processMessage(i);
            await new Promise(r => setTimeout(r, 400));
        }
    });

    $('#cat-clear-btn').on('click', async () => {
        const confirm = await callGenericPopup('🐱 번역을 지울까냥?', POPUP_TYPE.CONFIRM);
        if (!confirm) return;
        stContext.chat.forEach((m, idx) => {
            if (m.extra?.display_text) { delete m.extra.display_text; stContext.updateMessageBlock(idx, m); }
        });
        catNotify("🐱 삭제 완료!");
    });
}

jQuery(() => {
    setupUI();
    injectButtons();

    // 🕵️ MutationObserver: 화면이 바뀔 때마다 버튼 주입 (모바일 필수)
    const observer = new MutationObserver(() => {
        injectButtons();
    });

    const chatBody = document.getElementById('chat');
    if (chatBody) {
        observer.observe(chatBody, { childList: true, subtree: true });
    }
});

// ============================================================
// 🐱 Cat Translator v18.3.2 - index.js
// ============================================================
import { extension_settings, getContext } from '../../../../scripts/extensions.js';
import { getModelTheme } from './utils.js';
import { initCache } from './cache.js';
import { setupSettingsPanel, collectSettings, updateCacheStats, setupMutationObserver, applyTheme } from './ui.js';

const EXT_NAME = "cat-translator-beta";
const stContext = getContext();

const defaultSettings = { profile: '', customKey: '', directModel: 'gemini-1.5-flash', autoMode: 'none', targetLang: 'Korean', style: 'normal', temperature: 0.3, maxTokens: 8192, contextRange: 1, userPrompt: '', dictionary: '' };
let settings = Object.assign({}, defaultSettings, extension_settings[EXT_NAME]);

function saveSettings() {
    const collected = collectSettings(); Object.assign(settings, collected);
    extension_settings[EXT_NAME] = { ...settings }; stContext.saveSettingsDebounced();
    applyTheme(getModelTheme(settings.directModel)); updateCacheStats();
}

jQuery(async () => {
    try { 
        await initCache(); 
        applyTheme(getModelTheme(settings.directModel));
        // 설정창 강제 주입
        setupSettingsPanel(settings, stContext, saveSettings); 
        // UI 관찰자 및 버튼 주입 시작
        setupMutationObserver(null, null, settings, stContext); 
        console.log('[CAT] 🐯 Cat Translator v18.3.2 통합본 로드 완료!');
    } catch (e) { console.error('[CAT] 로드 에러:', e); }
});

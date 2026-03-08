// ============================================================
// 🐱 Cat Translator v18.3.7 - utils.js
// ============================================================

export function getThemeEmoji() {
    const theme = document.body.getAttribute('data-cat-theme');
    return theme === 'tiger' ? '🐯' : '🐱';
}

export function getCompletionEmoji() {
    const theme = document.body.getAttribute('data-cat-theme');
    return theme === 'tiger' ? '🍖' : '🐟';
}

export function catNotify(message, type = 'success') {
    $('.cat-notification').remove();
    const emoji = getThemeEmoji();
    const colors = { success: '#2ecc71', warning: '#f39c12', error: '#e74c3c', progress: '#f39c12' };
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${colors[type] || colors.success};">${message}</div>`);
    $('body').append(notifyHtml);
    requestAnimationFrame(() => notifyHtml.addClass('show'));
    setTimeout(() => { notifyHtml.removeClass('show'); setTimeout(() => notifyHtml.remove(), 500); }, 2500);
}

// 🚨 상태창 보존의 핵심: 불필요한 정규식 제거
export function cleanResult(text) {
    if (!text) return "";
    let cleaned = text.replace(/^(번역|Translation|Output|Result):\s*/gi, "");
    const wholeCodeBlockMatch = cleaned.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
    if (wholeCodeBlockMatch) cleaned = wholeCodeBlockMatch[1];
    
    // 🚨 절대 주의: YAML 들여쓰기를 부수는 공백 제거 로직을 완전히 삭제함!
    return cleaned.trim();
}

export function getCacheModelKey(settings) {
    if (settings.profile) return `profile:${settings.profile}`;
    return settings.directModel || 'default';
}

export function getModelTheme(modelName) {
    if (!modelName) return 'cat';
    const lower = modelName.toLowerCase();
    return (lower.includes('pro') || lower.includes('tiger')) ? 'tiger' : 'cat';
}

export function detectLanguageDirection(text, settings) {
    const korCount = (text.match(/[가-힣]/g) || []).length;
    const engCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (korCount >= engCount) return { isToEnglish: true, targetLang: 'English' };
    return { isToEnglish: false, targetLang: settings.targetLang || 'Korean' };
}

export function setTextareaValue(el, value) {
    const ns = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (ns) ns.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}


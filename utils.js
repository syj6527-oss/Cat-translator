// ============================================================
// 🙀 Translator Beta v1.0.5-beta.7 - utils.js
// 유틸리티: 알림, 정규식 세탁기, HTML/CSS 방어, 언어 감지
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
    // 같은 내용 중복 알림 방지
    const existing = $('.cat-notification');
    let isDuplicate = false;
    existing.each(function() { if ($(this).text() === message) isDuplicate = true; });
    if (isDuplicate) return existing.first();
    
    // 최대 3개까지만 스택, 오래된 것부터 제거
    if (existing.length >= 3) existing.first().removeClass('show').remove();
    
    const emoji = getThemeEmoji();
    const colors = { success: '#2ecc71', warning: '#f39c12', error: '#e74c3c', progress: '#f39c12', autosave: '#1e8449' };
    const bgColor = colors[type] || colors.success;
    const displayMsg = message.replace(/^(🐱|🐯)\s*/, `${emoji} `);
    const notifyHtml = $(`<div class="cat-notification cat-native-font" style="background-color: ${bgColor};">${displayMsg}</div>`);
    $('body').append(notifyHtml);
    
    // 스택 위치 계산: 기존 알림들 아래에 쌓기
    const _recalcStack = () => {
        let topOffset = 20;
        $('.cat-notification.show').each(function() {
            $(this).css('top', topOffset + 'px');
            topOffset += $(this).outerHeight() + 8;
        });
    };
    
    requestAnimationFrame(() => { notifyHtml.addClass('show'); _recalcStack(); });

    if (type !== 'progress') {
        setTimeout(() => {
            notifyHtml.removeClass('show');
            setTimeout(() => { notifyHtml.remove(); _recalcStack(); }, 500);
        }, 2500);
    }
    return notifyHtml;
}

export function catNotifyProgress(message, onAbort) {
    const el = catNotify(message, 'progress');
    if (onAbort) {
        el.css({ cursor: 'pointer', pointerEvents: 'auto' });
        el.on('click', () => { onAbort(); el.removeClass('show'); setTimeout(() => el.remove(), 500); });
    }
    return el;
}

// 🚨 정밀 클리너: AI가 추가한 래핑만 제거, 원본 코드블록/YAML 보존!
export function cleanResult(text, originalText = null, structureProtection = null) {
    if (!text) return "";
    
    // AI가 앞에 붙이는 "번역:" 등 접두어 제거
    let cleaned = text;
    const responsePrefix = /^(번역|Translation|Output|Input|Result):\s*/i;
    if (!originalText || !responsePrefix.test(originalText.trimStart())) {
        cleaned = cleaned.replace(responsePrefix, "");
    }
    
    // 🚨 추론/사고 과정 텍스트 자동 제거 (Gemini Pro 모델이 종종 출력)
    // 영어 추론 단락만 정확히 제거 (한국어가 시작되는 지점까지만)
    // 핵심 마커: "Let's break down", "I have completed", "I will now proceed" 등
    const reasoningStartMarkers = /^(Let'?s break down|I have completed|I will now proceed|I have identified|Based on the directives|Let me translate|I do not need further|Looking at the (text|source|context)|Analyzing the (text|source|context)|First, let me|To translate this|Here is my analysis)/i;
    
    if (reasoningStartMarkers.test(cleaned)) {
        // 추론 시작 → 한국어/일본어/중국어가 시작되는 첫 위치까지 잘라냄
        const targetLangMatch = cleaned.match(/[\u3131-\uD79D\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/);
        if (targetLangMatch) {
            const targetIdx = targetLangMatch.index;
            // 추론 단락이 한국어 시작 직전까지만 차지하는지 검증
            // (영어가 50자 이상 + 한국어 시작 → 추론 제거)
            const beforeTarget = cleaned.substring(0, targetIdx);
            if (beforeTarget.length > 30 && /[a-zA-Z]/.test(beforeTarget)) {
                cleaned = cleaned.substring(targetIdx);
                console.log('[CAT] 🧹 추론 텍스트 제거됨');
            }
        }
    }
    cleaned = cleaned.trim();
    
    // AI가 응답 전체를 코드블록으로 감싼 경우만 벗기기
    const wholeCodeBlockMatch = cleaned.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/i);
    const originalHasCodeFence = originalText && /```/.test(originalText);
    const wrapperContainsProtectedToken = wholeCodeBlockMatch &&
        hasProtectedMarkerVariant(wholeCodeBlockMatch[1], structureProtection);
    if (wholeCodeBlockMatch && (!originalHasCodeFence || wrapperContainsProtectedToken)) {
        const inner = wholeCodeBlockMatch[1];
        if (!inner.includes('```')) {
            cleaned = inner;
            if (wrapperContainsProtectedToken) {
                console.log('[CAT] 🧹 모델이 응답 전체에 추가한 코드펜스 제거');
            }
        }
    }
    
    // 🚨 AI 거부/오류 응답 감지 (도구 거부, 검색 강제, 정책 거부 등)
    if (originalText) {
        const refusalPatterns = [
            /Google 검색을 수행해야|구글 검색을 수행해야/i,
            /도구 사용을 강제하는|도구를 사용해야/i,
            /이 작업을 수행할 수 없습니다|작업을 수행할 수 없어요|작업을 수행하기 어렵/i,
            /I (cannot|can'?t|am unable to) (perform|complete|fulfill|do|process) (this|that)/i,
            /I (need|must|have) to (search|use) (Google|the web|a tool)/i,
            /I'?m unable to (assist|help) with/i,
            /I cannot provide|I can'?t provide/i,
            /violates? (my|the|content) (guidelines|policy|policies)/i,
            /죄송하지만.*수행할 수 없|죄송합니다.*도와드릴 수 없/i,
            /사용자 사양을 준수하면서/i,
        ];
        // 거부 패턴이 본문 시작 100자 안에 있으면 거부 응답으로 판정
        const startSegment = cleaned.substring(0, 200);
        for (const pattern of refusalPatterns) {
            if (pattern.test(startSegment)) {
                console.warn('[CAT] 🚨 AI 거부 응답 감지. 결과 폐기 → 재번역 필요.');
                return "";
            }
        }
    }
    
    // 🚨 AI 생성모드 감지: 번역이 아닌 RP 이어쓰기/시스템 프롬프트 번역 방지
    if (originalText) {
        const ratio = cleaned.length / originalText.length;
        // 비율 3배 초과 + 시스템 프롬프트 패턴 감지 → 오염된 결과
        const systemPatterns = /\[ABSOLUTE DIRECTIVE|\[SYSTEM|\[OOC|\[IMPORTANT|DO NOT narrate|DO NOT summarize|DO NOT break|Write the full simulation|as an unbroken narrative|maintaining their established voice/i;
        if (ratio > 3 && systemPatterns.test(cleaned)) {
            console.warn('[CAT] 🚨 AI 생성모드 감지: 시스템 프롬프트 오염. 결과 폐기.');
            return "";
        }
        // 비율 4배 초과 → 이어쓰기 의심
        if (ratio > 4) {
            console.warn(`[CAT] ⚠️ 번역 결과 비정상 길이 (${ratio.toFixed(1)}배). 원문 기준 잘라냄.`);
            const cutPoint = originalText.length * 3;
            cleaned = cleaned.substring(0, cutPoint);
            const lastSentence = cleaned.match(/.*[.!?。！？」』\])\n]/s);
            if (lastSentence) cleaned = lastSentence[0];
        }
        // 🚨 번역 잘림 감지: 결과가 원문 대비 너무 짧으면 경고
        if (ratio < 0.3 && originalText.length > 200) {
            console.warn(`[CAT] ⚠️ 번역 결과가 짧음 (${(ratio * 100).toFixed(0)}%). 잘렸을 수 있음.`);
        }
    }
    
    // 줄바꿈 정리 (원본 구조 보존하면서)
    cleaned = cleaned.replace(/\r\n/g, "\n");
    
    // 🚨 문단 구조 보존: 원문과 비교해서 문단 수 부족하면 경고
    const originalHasLockedStructure = originalText &&
        (/```/.test(originalText) || /<\/?[a-zA-Z][^>]*>/.test(originalText) || /^(?:---|___|\*\*\*)\s*$/m.test(originalText));
    if (originalText && originalText.length > 200 && !originalHasLockedStructure) {
        const origParagraphs = originalText.split(/\n{2,}/).filter(p => p.trim().length > 0);
        const transParagraphs = cleaned.split(/\n{2,}/).filter(p => p.trim().length > 0);
        
        // 원문 3문단 이상인데 번역이 1문단으로 합쳐졌으면 명확한 실패
        if (origParagraphs.length >= 3 && transParagraphs.length === 1) {
            console.warn(`[CAT] ⚠️ 문단 구조 파괴: 원문 ${origParagraphs.length}문단 → 번역 1문단`);
            
            // 자동 복구 시도: 문장 끝 패턴 (.!? + 다음 대문자/대사)로 분할 후 원문 비율 맞춤
            cleaned = restoreParagraphStructure(cleaned, origParagraphs.length);
        } else if (origParagraphs.length >= 3 && transParagraphs.length < origParagraphs.length * 0.5) {
            console.warn(`[CAT] ⚠️ 문단 수 부족: 원문 ${origParagraphs.length}문단 → 번역 ${transParagraphs.length}문단`);
        }
    }
    
    // 🚨 따옴표 균형 검사 및 자동 복구
    cleaned = balanceQuotes(cleaned, originalText);
    
    return cleaned.trim();
}

// 번역 대상의 구조 문법은 토큰으로 잠그고, 사람에게 읽히는 내용만 모델에 노출한다.
// 모델이 토큰을 누락하거나 순서를 바꾸면 복원 단계에서 결과를 거부한다.
export function protectTranslationStructure(text) {
    const source = String(text || '').replace(/\r\n/g, '\n');
    let namespace = 'CATFMT';
    while (source.includes(`@@${namespace}_`)) namespace += 'X';
    
    const tokens = [];
    const addToken = (value, type) => {
        const marker = `@@${namespace}_${String(tokens.length).padStart(4, '0')}@@`;
        tokens.push({ marker, value, type });
        return marker;
    };
    
    // 실제 펜스를 숨겨 모델이 코드로 취급해 내부 번역을 건너뛰는 것을 막는다.
    let protectedText = source.replace(/```[^\n]*\n[\s\S]*?```/g, (block) => {
        const firstBreak = block.indexOf('\n');
        const closeIndex = block.lastIndexOf('```');
        if (firstBreak < 0 || closeIndex <= firstBreak) return block;
        
        const opening = block.slice(0, firstBreak);
        const inner = block.slice(firstBreak + 1, closeIndex);
        const closing = block.slice(closeIndex);
        const protectedLines = inner.split('\n').map((line) => {
            const lineAnchor = addToken('', 'code-line');
            if (!line) return lineAnchor;
            
            const indent = line.match(/^[\t ]*/)?.[0] || '';
            const body = line.slice(indent.length);
            const indentToken = indent ? addToken(indent, 'indent') : '';
            
            if (/^(?:---|___|\*\*\*)\s*$/.test(body)) {
                return lineAnchor + addToken(line, 'whole-line');
            }
            return lineAnchor + indentToken + body;
        }).join('\n');
        
        return `${addToken(opening, 'fence')}\n${protectedLines}${addToken(closing, 'fence')}`;
    });
    
    // 태그 속성, 매크로, 주석 경계는 번역시키지 않는다.
    protectedText = protectedText.replace(
        /<!--|-->|<\/?[a-zA-Z][^>]*>|\{\{[\s\S]*?\}\}/g,
        (value) => addToken(value, 'inline')
    );
    
    // 코드블럭 밖의 정규식 트리거용 구분선도 원문 그대로 보존한다.
    protectedText = protectedText.replace(
        /^(?:[\t ]*)(?:---|___|\*\*\*)(?:[\t ]*)$/gm,
        (value) => addToken(value, 'whole-line')
    );
    
    const expectedMarkers = tokens
        .map(token => ({ marker: token.marker, index: protectedText.indexOf(token.marker) }))
        .filter(item => item.index >= 0)
        .sort((a, b) => a.index - b.index)
        .map(item => item.marker);
    
    return {
        text: protectedText,
        source,
        namespace,
        tokens,
        expectedMarkers,
        // 🚨 beta.9: 마커 사이 구간별 텍스트 유무 패턴 — 복원 시 대조해 "블록 경계를 넘는 밀림" 감지
        segmentPattern: computeSegmentPattern(protectedText, expectedMarkers),
        hasStructure: expectedMarkers.length > 0
    };
}

// 마커 순서대로 텍스트를 잘라 각 구간에 실제 내용(문자·숫자)이 있는지 boolean 배열로
export function computeSegmentPattern(text, markers) {
    const pattern = [];
    let rest = String(text || '');
    for (const marker of markers) {
        const idx = rest.indexOf(marker);
        if (idx < 0) { pattern.push(/[가-힣a-zA-Z0-9]/.test(rest)); return pattern; }
        pattern.push(/[가-힣a-zA-Z0-9]/.test(rest.slice(0, idx)));
        rest = rest.slice(idx + marker.length);
    }
    pattern.push(/[가-힣a-zA-Z0-9]/.test(rest));
    return pattern;
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createProtectedMarkerPattern(marker, flags = '') {
    const match = String(marker || '').match(/^@@(.+)_([0-9]{4})@@$/);
    if (!match) return new RegExp(escapeRegExp(marker), flags);
    
    const namespace = escapeRegExp(match[1]);
    const index = escapeRegExp(match[2]);
    return new RegExp(
        `\\\\?@\\s*\\\\?@\\s*${namespace}\\s*_\\s*${index}\\s*\\\\?@\\s*\\\\?@`,
        flags
    );
}

function hasProtectedMarkerVariant(text, protection) {
    if (!protection?.expectedMarkers?.length) return false;
    const source = String(text || '');
    return protection.expectedMarkers.some(marker =>
        createProtectedMarkerPattern(marker, 'i').test(source)
    );
}

function normalizeProtectedStructureResponse(text, protection) {
    if (!protection?.hasStructure) return String(text || '');
    
    let normalized = String(text || '');
    for (const marker of protection.expectedMarkers) {
        normalized = normalized.replace(createProtectedMarkerPattern(marker, 'gi'), marker);
        
        const escapedMarker = escapeRegExp(marker);
        const wrappers = [
            new RegExp('`{1,3}[\\t ]*' + escapedMarker + '[\\t ]*`{1,3}', 'g'),
            new RegExp('\\*\\*[\\t ]*' + escapedMarker + '[\\t ]*\\*\\*', 'g'),
            new RegExp('__[\\t ]*' + escapedMarker + '[\\t ]*__', 'g'),
            new RegExp('<code>[\\t ]*' + escapedMarker + '[\\t ]*</code>', 'gi')
        ];
        for (const wrapper of wrappers) {
            normalized = normalized.replace(wrapper, marker);
        }
    }
    
    // 모델이 구조 토큰 사이에 공백/개행만 덧붙인 경우 원래 간격으로 되돌린다.
    // 번역 텍스트가 끼어 있으면 손대지 않아 누락이나 재배치를 숨기지 않는다.
    for (let i = 0; i < protection.expectedMarkers.length - 1; i++) {
        const current = protection.expectedMarkers[i];
        const next = protection.expectedMarkers[i + 1];
        const sourceCurrent = protection.text.indexOf(current);
        const sourceNext = protection.text.indexOf(next, sourceCurrent + current.length);
        if (sourceCurrent < 0 || sourceNext < 0) continue;
        
        const sourceGap = protection.text.slice(sourceCurrent + current.length, sourceNext);
        if (!/^\s*$/.test(sourceGap)) continue;
        
        const currentIndex = normalized.indexOf(current);
        const nextIndex = normalized.indexOf(next, currentIndex + current.length);
        if (currentIndex < 0 || nextIndex < 0) continue;
        if (normalized.indexOf(current, currentIndex + current.length) >= 0 ||
            normalized.indexOf(next, nextIndex + next.length) >= 0) {
            continue;
        }
        
        const outputGap = normalized.slice(currentIndex + current.length, nextIndex);
        if (!/^\s*$/.test(outputGap) || outputGap === sourceGap) continue;
        normalized = normalized.slice(0, currentIndex + current.length) +
            sourceGap +
            normalized.slice(nextIndex);
    }
    
    return normalized;
}

export function restoreTranslationStructure(text, protection) {
    if (!protection?.hasStructure) {
        return { ok: true, text: String(text || ''), reason: null };
    }
    
    const rawOutput = String(text || '');
    const output = normalizeProtectedStructureResponse(rawOutput, protection);
    if (output !== rawOutput) {
        console.log('[CAT] 🔧 모델별 구조 토큰 표기 차이 자동 복구');
    }
    let previousIndex = -1;
    for (const marker of protection.expectedMarkers) {
        const firstIndex = output.indexOf(marker);
        if (firstIndex < 0) {
            return { ok: false, text: null, reason: `구조 토큰 누락: ${marker}` };
        }
        if (output.indexOf(marker, firstIndex + marker.length) >= 0) {
            return { ok: false, text: null, reason: `구조 토큰 중복: ${marker}` };
        }
        if (firstIndex <= previousIndex) {
            return { ok: false, text: null, reason: `구조 토큰 순서 변경: ${marker}` };
        }
        previousIndex = firstIndex;
    }
    
    const markerPattern = new RegExp(`@@${protection.namespace}_\\d{4}@@`, 'g');
    const outputMarkers = output.match(markerPattern) || [];
    if (outputMarkers.length !== protection.expectedMarkers.length) {
        return { ok: false, text: null, reason: '알 수 없는 구조 토큰이 추가되었거나 삭제됨' };
    }
    
    // 🚨 beta.9: 세그먼트 패턴 대조 — 마커 순서가 맞아도 텍스트가 블록 경계를 넘어
    // 이동하면(예: 상태창 앞 대사가 상태창 뒤로 밀림) 원문에서 비어있던 구간에
    // 내용이 생기거나 내용 있던 구간이 비게 됨 → 밀림으로 판정해 거부 (재시도 유도)
    if (Array.isArray(protection.segmentPattern)) {
        const outPattern = computeSegmentPattern(output, protection.expectedMarkers);
        for (let i = 0; i < protection.segmentPattern.length; i++) {
            if (protection.segmentPattern[i] !== outPattern[i]) {
                const kind = protection.segmentPattern[i] ? '구간 내용 소실' : '빈 구간에 텍스트 침입';
                return { ok: false, text: null, reason: `텍스트가 블록 경계를 넘어 이동함 (${kind}, 구간 ${i})` };
            }
        }
    }
    
    let restored = output;
    for (const token of protection.tokens) {
        restored = restored.replace(token.marker, token.value);
    }

    const validation = validateTranslationStructure(protection.source, restored);
    if (validation.repairedKeys > 0) {
        console.log(`[CAT] 🔧 구조 키 ${validation.repairedKeys}개 자동 복원`);
    }
    if (!validation.ok) {
        return { ok: false, text: null, reason: validation.reason };
    }
    return {
        ok: true,
        text: validation.text,
        reason: null,
        boundaryRecovery: validation.boundaryRecovery || null
    };
}

export function restoreTranslationTokens(text, protection) {
    if (!protection?.hasStructure) {
        return { ok: true, text: String(text || ''), reason: null };
    }
    
    let restored = normalizeProtectedStructureResponse(text, protection);
    for (const token of protection.tokens) {
        restored = restored.split(token.marker).join(token.value);
    }
    
    const unresolved = new RegExp(`@@${protection.namespace}_\\d{4}@@`).test(restored);
    if (unresolved) {
        return { ok: false, text: null, reason: '직역 파트에 복원되지 않은 구조 토큰이 남음' };
    }
    return { ok: true, text: restored, reason: null };
}

export function validateTranslationStructure(source, output) {
    const sourceText = String(source || '');
    const normalized = repairStructuredKeyPrefixes(sourceText, String(output || ''));
    const parity = compareProtectedStructure(sourceText, normalized.text);
    if (!parity.ok) {
        const recovered = recoverBoundaryContextLeak(sourceText, normalized.text);
        if (recovered) {
            return {
                ok: true,
                reason: null,
                text: recovered.text,
                repairedKeys: recovered.repairedKeys,
                boundaryRecovery: recovered.boundaryRecovery
            };
        }
    }
    return {
        ...parity,
        text: normalized.text,
        repairedKeys: normalized.repairedKeys,
        boundaryRecovery: null
    };
}

// 일부 모델이 이전 문맥의 완결된 정보블럭을 현재 번역 앞뒤에 붙이는 경우만 복구한다.
// 내부 삽입이나 후보가 둘 이상인 응답은 원문 일부를 잘못 버릴 수 있으므로 그대로 거부한다.
function recoverBoundaryContextLeak(source, output) {
    const sourceMatches = getStructureMatches(source);
    const outputMatches = getStructureMatches(output);
    if (sourceMatches.length === 0 || outputMatches.length <= sourceMatches.length) {
        return null;
    }

    const candidates = new Map();
    const lastOffset = outputMatches.length - sourceMatches.length;
    for (let offset = 0; offset <= lastOffset; offset++) {
        let signatureMatches = true;
        for (let i = 0; i < sourceMatches.length; i++) {
            if (outputMatches[offset + i].value !== sourceMatches[i].value) {
                signatureMatches = false;
                break;
            }
        }
        if (!signatureMatches) continue;

        const hasPrefix = offset > 0;
        const suffixIndex = offset + sourceMatches.length;
        const hasSuffix = suffixIndex < outputMatches.length;
        if (!hasPrefix && !hasSuffix) continue;

        const start = hasPrefix ? outputMatches[offset - 1].end : 0;
        const end = hasSuffix ? outputMatches[suffixIndex].index : output.length;
        const removedPrefix = hasPrefix ? output.slice(0, start) : '';
        const removedSuffix = hasSuffix ? output.slice(end) : '';
        const prefixBlocks = hasPrefix ? countCompleteBoundaryFenceBlocks(removedPrefix) : 0;
        const suffixBlocks = hasSuffix ? countCompleteBoundaryFenceBlocks(removedSuffix) : 0;
        if (hasPrefix && prefixBlocks === 0) continue;
        if (hasSuffix && suffixBlocks === 0) continue;

        const candidateText = output.slice(start, end).trim();
        const normalized = repairStructuredKeyPrefixes(source, candidateText);
        const parity = compareProtectedStructure(source, normalized.text);
        if (!parity.ok) continue;

        candidates.set(normalized.text, {
            text: normalized.text,
            repairedKeys: normalized.repairedKeys,
            boundaryRecovery: {
                removedPrefix: hasPrefix,
                removedSuffix: hasSuffix,
                removedFenceBlocks: prefixBlocks + suffixBlocks
            }
        });
    }

    return candidates.size === 1 ? [...candidates.values()][0] : null;
}

function countCompleteBoundaryFenceBlocks(fragment) {
    const text = String(fragment || '');
    const fenceMarkers = text.match(/```[^\n]*/g) || [];
    const completeBlocks = text.match(/```[^\n]*\n[\s\S]*?```/g) || [];
    if (completeBlocks.length === 0 || fenceMarkers.length !== completeBlocks.length * 2) {
        return 0;
    }
    return completeBlocks.length;
}

function compareProtectedStructure(source, output) {
    const sourceSignature = getStructureSignature(source);
    const outputSignature = getStructureSignature(output);
    if (sourceSignature.length !== outputSignature.length) {
        return {
            ok: false,
            reason: `구조 요소 개수 불일치: ${sourceSignature.length}→${outputSignature.length}`
        };
    }
    for (let i = 0; i < sourceSignature.length; i++) {
        if (sourceSignature[i] !== outputSignature[i]) {
            return { ok: false, reason: `구조 요소 변경: ${sourceSignature[i]}→${outputSignature[i]}` };
        }
    }
    
    const sourceBlocks = getFencedBlockShapes(source);
    const outputBlocks = getFencedBlockShapes(output);
    if (sourceBlocks.length !== outputBlocks.length) {
        return { ok: false, reason: `코드블럭 개수 불일치: ${sourceBlocks.length}→${outputBlocks.length}` };
    }
    for (let i = 0; i < sourceBlocks.length; i++) {
        const src = sourceBlocks[i];
        const out = outputBlocks[i];
        if (src.lines.length !== out.lines.length) {
            return { ok: false, reason: `코드블럭 ${i + 1} 줄 수 불일치: ${src.lines.length}→${out.lines.length}` };
        }
        for (let lineIndex = 0; lineIndex < src.lines.length; lineIndex++) {
            const srcLine = src.lines[lineIndex];
            const outLine = out.lines[lineIndex];
            const srcIndent = srcLine.match(/^[\t ]*/)?.[0] || '';
            const outIndent = outLine.match(/^[\t ]*/)?.[0] || '';
            if (srcIndent !== outIndent) {
                return { ok: false, reason: `코드블럭 ${i + 1} 들여쓰기 변경 (${lineIndex + 1}행)` };
            }
            if (!srcLine.trim() && outLine.trim()) {
                return { ok: false, reason: `코드블럭 ${i + 1} 빈 줄 변경 (${lineIndex + 1}행)` };
            }
            
            const keyPrefix = getStructuredKeyPrefix(srcLine, src.language);
            if (keyPrefix && !outLine.startsWith(keyPrefix)) {
                return { ok: false, reason: `코드블럭 ${i + 1} 키 변경 (${lineIndex + 1}행)` };
            }
        }
    }

    const sourceLayout = getStructureLayout(source);
    const outputLayout = getStructureLayout(output);
    if (sourceLayout.regions !== outputLayout.regions) {
        return {
            ok: false,
            reason: `구조 요소 배치 개수 불일치: ${sourceLayout.regions}→${outputLayout.regions}`
        };
    }
    for (let i = 0; i < sourceLayout.contentGaps.length; i++) {
        if (sourceLayout.contentGaps[i] !== outputLayout.contentGaps[i]) {
            return { ok: false, reason: `구조 요소 위치 변경 (${i + 1}구간)` };
        }
    }
    return { ok: true, reason: null };
}

function getStructureSignature(text) {
    return getStructureMatches(text).map(item => item.value);
}

function getStructureMatches(text) {
    const matches = [];
    const patterns = [
        /```[^\n]*/g,
        /<!--|-->|<\/?[a-zA-Z][^>]*>|\{\{[\s\S]*?\}\}/g,
        /^(?:[\t ]*)(?:---|___|\*\*\*)(?:[\t ]*)$/gm
    ];
    patterns.forEach((pattern) => {
        for (const match of String(text || '').matchAll(pattern)) {
            matches.push({
                index: match.index,
                end: match.index + match[0].length,
                value: match[0]
            });
        }
    });
    return matches.sort((a, b) => a.index - b.index);
}

function getFencedBlockShapes(text) {
    return [...String(text || '').matchAll(/```([^\n]*)\n([\s\S]*?)```/g)]
        .map(match => {
            const openingLength = match[0].indexOf('\n') + 1;
            const contentStart = match.index + openingLength;
            return {
                language: normalizeFenceLanguage(match[1]),
                lines: match[2].split('\n'),
                contentStart,
                contentEnd: contentStart + match[2].length
            };
        });
}

function normalizeFenceLanguage(info) {
    return String(info || '').trim().split(/\s+/)[0].toLowerCase();
}

function repairStructuredKeyPrefixes(source, output) {
    const sourceBlocks = getFencedBlockShapes(source);
    const outputBlocks = getFencedBlockShapes(output);
    if (sourceBlocks.length !== outputBlocks.length) {
        return { text: output, repairedKeys: 0 };
    }

    let normalized = String(output || '');
    let repairedKeys = 0;
    const replacements = [];

    for (let blockIndex = 0; blockIndex < sourceBlocks.length; blockIndex++) {
        const src = sourceBlocks[blockIndex];
        const out = outputBlocks[blockIndex];
        if (src.language !== out.language || src.lines.length !== out.lines.length) continue;

        const fixedLines = [...out.lines];
        let blockChanged = false;
        for (let lineIndex = 0; lineIndex < src.lines.length; lineIndex++) {
            const sourcePrefix = getStructuredKeyPrefix(src.lines[lineIndex], src.language);
            if (!sourcePrefix || fixedLines[lineIndex].startsWith(sourcePrefix)) continue;

            const outputPrefix = getStructuredKeyPrefix(fixedLines[lineIndex], out.language, true);
            if (!outputPrefix) continue;
            fixedLines[lineIndex] = sourcePrefix + fixedLines[lineIndex].slice(outputPrefix.length);
            repairedKeys++;
            blockChanged = true;
        }

        if (blockChanged) {
            replacements.push({
                start: out.contentStart,
                end: out.contentEnd,
                text: fixedLines.join('\n')
            });
        }
    }

    replacements.sort((a, b) => b.start - a.start);
    for (const replacement of replacements) {
        normalized = normalized.slice(0, replacement.start) +
            replacement.text +
            normalized.slice(replacement.end);
    }
    return { text: normalized, repairedKeys };
}

function getStructureLayout(text) {
    const source = String(text || '');
    const regions = [...source.matchAll(
        /```[^\n]*\n[\s\S]*?```|<!--|-->|<\/?[a-zA-Z][^>]*>|\{\{[\s\S]*?\}\}|^(?:[\t ]*)(?:---|___|\*\*\*)(?:[\t ]*)$/gm
    )];
    const contentGaps = [];
    let cursor = 0;
    
    for (const region of regions) {
        contentGaps.push(/\S/.test(source.slice(cursor, region.index)));
        cursor = region.index + region[0].length;
    }
    contentGaps.push(/\S/.test(source.slice(cursor)));
    
    return { regions: regions.length, contentGaps };
}

function getStructuredKeyPrefix(line, language, allowTightValue = false) {
    if (/^(?:json|jsonc|json5)$/.test(language)) {
        const jsonKey = line.match(/^(\s*"(?:(?:\\.)|[^"\\])+"\s*:\s*)/);
        if (jsonKey) return jsonKey[1];
        if (language !== 'json') {
            const json5Key = line.match(/^(\s*[\p{L}_$][\p{L}\p{N}_$.-]*\s*:\s*)/u);
            return json5Key ? json5Key[1] : null;
        }
        return null;
    }

    if (/^(?:yaml|yml)$/.test(language)) {
        const yamlKey = allowTightValue
            ? line.match(
                /^(\s*(?:-\s*)?(?:(?:"(?:(?:\\.)|[^"\\])*"|'(?:''|[^'])*')|[\p{L}_][\p{L}\p{N}_. -]{0,79})\s*:\s*)/u
            )
            : line.match(
                /^(\s*(?:-\s*)?(?:(?:"(?:(?:\\.)|[^"\\])*"|'(?:''|[^'])*')|[\p{L}_][\p{L}\p{N}_. -]{0,79})\s*:(?:[ \t]+|$))/u
            );
        return yamlKey ? yamlKey[1] : null;
    }

    return null;
}

// 🚨 문단 구조 자동 복구 (한 덩어리로 합쳐진 경우)
function restoreParagraphStructure(text, targetParagraphCount) {
    // 대사 시작/종료 + 묘사 전환 패턴으로 분할
    // 1. 닫는 따옴표 뒤 + 한국어 시작 → 문단 경계
    // 2. 한국어 종결 뒤 + 여는 따옴표 → 문단 경계
    
    // 자연스러운 분할 후보 위치 (점수 부여)
    const candidates = [];
    const len = text.length;
    
    // 패턴 1: "..." 다음 문장 (대사 종료 후 묘사)
    for (let m of text.matchAll(/(["」』])\s+([가-힣A-Z])/g)) {
        candidates.push({ pos: m.index + m[1].length, score: 3 });
    }
    
    // 패턴 2: 문장 끝(다.) 다음 대사 (묘사 종료 후 대사)
    for (let m of text.matchAll(/([다요까네])\.\s+(["「『])/g)) {
        candidates.push({ pos: m.index + 2, score: 3 });
    }
    
    // 패턴 3: 일반 문장 종료 (다./요./까?)
    for (let m of text.matchAll(/([다요까네])\.\s+([가-힣])/g)) {
        candidates.push({ pos: m.index + 2, score: 1 });
    }
    
    if (candidates.length === 0) return text; // 분할 불가
    
    // 후보 정렬 (위치 순)
    candidates.sort((a, b) => a.pos - b.pos);
    
    // 목표 문단 수에 가장 가까운 분할점 선택
    const breakCount = targetParagraphCount - 1;
    if (candidates.length < breakCount) return text; // 후보가 부족
    
    // 균등 분할 위치 계산
    const ideal = [];
    for (let i = 1; i <= breakCount; i++) {
        ideal.push((len * i) / targetParagraphCount);
    }
    
    // 각 ideal 위치에 가장 가까운 후보 선택
    const breakPoints = [];
    const used = new Set();
    for (const idealPos of ideal) {
        let best = null;
        let bestDist = Infinity;
        for (let i = 0; i < candidates.length; i++) {
            if (used.has(i)) continue;
            const dist = Math.abs(candidates[i].pos - idealPos) - candidates[i].score * 30;
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        }
        if (best !== null) {
            breakPoints.push(candidates[best].pos);
            used.add(best);
        }
    }
    
    breakPoints.sort((a, b) => a - b);
    
    // 분할점에 \n\n 삽입
    let result = '';
    let last = 0;
    for (const bp of breakPoints) {
        result += text.substring(last, bp) + '\n\n';
        last = bp;
    }
    result += text.substring(last);
    
    console.log(`[CAT] 🔧 문단 자동 복구: 1개 → ${targetParagraphCount}개`);
    return result;
}

// 🚨 따옴표 균형 검사 및 복구
function balanceQuotes(text, originalText) {
    // 영어 따옴표: " (smart quotes는 별도)
    // 한국어 따옴표: "", 「」, 『』
    
    const countQuotes = (s, pattern) => (s.match(pattern) || []).length;
    
    // 1. 첫 줄 대사 따옴표 누락 복구
    // 원문 첫 줄이 "..." 패턴인데 번역 첫 줄이 따옴표 없이 시작하면 복구
    if (originalText) {
        const origFirstLine = originalText.split(/\n/)[0]?.trim();
        const transFirstLine = text.split(/\n/)[0]?.trim();
        
        if (origFirstLine && transFirstLine) {
            const origStartsWithQuote = /^["「『]/.test(origFirstLine);
            const transStartsWithQuote = /^["「『]/.test(transFirstLine);
            
            // 원문은 따옴표로 시작, 번역은 안 그러면 → 첫 따옴표 추가
            if (origStartsWithQuote && !transStartsWithQuote) {
                // 한국어 따옴표 ㅍ스타일 매칭
                const quoteChar = origFirstLine[0];
                const targetQuote = quoteChar === '"' ? '"' : quoteChar;
                text = targetQuote + text;
                console.log(`[CAT] 🔧 첫 줄 따옴표 복구: ${targetQuote} 추가`);
            }
        }
    }
    
    // 2. 따옴표 균형 검사 (열린 vs 닫힌)
    // ASCII 따옴표는 양방향이라 짝수면 OK
    const ascii = countQuotes(text, /"/g);
    if (ascii % 2 !== 0) {
        // 홀수 → 마지막에 " 추가 (닫는 따옴표 누락 가능성)
        text = text.trimEnd() + '"';
        console.log(`[CAT] 🔧 ASCII 따옴표 균형 복구: 닫는 " 추가`);
    }
    
    // 한국어 큰따옴표
    const koOpen = countQuotes(text, /"/g);
    const koClose = countQuotes(text, /"/g);
    if (koOpen > koClose) {
        text = text.trimEnd() + '"';
        console.log(`[CAT] 🔧 한국어 따옴표 균형 복구: 닫는 " 추가`);
    } else if (koClose > koOpen) {
        // 닫는 게 더 많음 → 맨 앞에 열린 따옴표 추가
        text = '"' + text;
        console.log(`[CAT] 🔧 한국어 따옴표 균형 복구: 여는 " 앞에 추가`);
    }
    
    return text;
}

export function getCacheModelKey(settings) {
    let key;
    if (settings.profile) key = `profile:${settings.profile}`;
    else key = settings.directModel || 'default';
    
    const dialogueMode = settings.dialogueBilingual || 'off';
    const literalMode = settings.literalBilingual === 'on' ? 'on' : 'off';
    const style = settings.style || 'normal';
    const temperature = Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.3;
    const promptHash = hashCacheSetting(settings.userPrompt || '');
    const dictionaryHash = hashCacheSetting(settings.dictionary || '');
    const contextRange = Number.isFinite(Number(settings.contextRange)) ? Number(settings.contextRange) : 1;
    
    return `${key}::cache-v3::dialogue:${dialogueMode}::literal:${literalMode}` +
        `::style:${style}::temp:${temperature}::context:${contextRange}` +
        `::prompt:${promptHash}::dict:${dictionaryHash}`;
}

function hashCacheSetting(value) {
    let hash = 0x811c9dc5;
    const normalized = String(value).replace(/\r\n/g, '\n').trim();
    for (let i = 0; i < normalized.length; i++) {
        hash ^= normalized.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

export function getModelTheme(modelName) {
    if (!modelName) return 'cat';
    const lower = modelName.toLowerCase();
    if (lower.includes('pro') || lower.includes('프로') || lower.includes('호랑이') || lower.includes('tiger')) return 'tiger';
    if (lower.includes('flash') || lower.includes('플래') || lower.includes('플레') || lower.includes('고양이') || lower.includes('cat')) return 'cat';
    if (lower.includes('vertex')) {
        if (lower.includes('pro')) return 'tiger';
        return 'cat';
    }
    return 'cat';
}

// 🚨 언어 감지용 메타 토큰 제거: ooc/rp 약어, {{매크로}}, <태그>, URL이
// 짧은 인풋의 언어 비율을 왜곡하는 것 방지 (감지/경고 판정 공용)
export function stripMetaForDetection(text) {
    return String(text || '')
        .replace(/\{\{[^}]*\}\}/g, '')                          // {{char}}, {{user}} 등 매크로
        .replace(/<[^>]{1,30}>/g, '')                           // <user>, <char> 등 태그
        .replace(/\b(ooc|OOC|rp|RP|ic|IC|btw|ps|PS|ai|AI)\b/g, '') // RP 메타 약어
        .replace(/https?:\/\/\S+/g, '');                        // URL
}

export function analyzeLanguage(text) {
    const stripped = stripMetaForDetection(text);
    const chars = {
        Korean: (stripped.match(/[가-힣]/g) || []).length,
        English: (stripped.match(/[a-zA-Z]/g) || []).length,
        Japanese: (stripped.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length,
        Chinese: (stripped.match(/[\u4E00-\u9FFF]/g) || []).length
    };
    const words = {
        Korean: (stripped.match(/[가-힣]+/g) || []).length,
        English: (stripped.match(/[a-zA-Z]+/g) || []).length,
        Japanese: (stripped.match(/[\u3040-\u309F\u30A0-\u30FF]+/g) || []).length,
        Chinese: chars.Chinese
    };
    const scores = {
        Korean: words.Korean + chars.Korean / 2.5,
        English: words.English + chars.English / 5,
        Japanese: words.Japanese + chars.Japanese / 2,
        Chinese: chars.Chinese / 1.5
    };
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const totalScore = ranked.reduce((sum, [, score]) => sum + score, 0);
    const dominant = totalScore > 0 ? ranked[0][0] : null;
    const confidence = totalScore > 0 ? ranked[0][1] / totalScore : 0;

    return {
        stripped,
        chars,
        words,
        scores,
        dominant,
        confidence,
        total: Object.values(chars).reduce((sum, count) => sum + count, 0)
    };
}

export function isClearlyLanguage(textOrAnalysis, language, minConfidence = 0.72) {
    const analysis = typeof textOrAnalysis === 'string'
        ? analyzeLanguage(textOrAnalysis)
        : textOrAnalysis;
    if (!analysis || !language || analysis.total === 0) return false;

    const chars = analysis.chars?.[language] || 0;
    const words = analysis.words?.[language] || 0;
    const competingChars = Object.entries(analysis.chars || {})
        .filter(([key]) => key !== language)
        .reduce((sum, [, count]) => sum + count, 0);

    if (chars === 0) return false;
    if (competingChars === 0 && chars >= 2) return true;
    if (analysis.dominant !== language) return false;
    if (words >= 2 && analysis.confidence >= minConfidence) return true;
    return chars >= 4 && analysis.confidence >= Math.max(0.82, minConfidence);
}

export function getInputTargetLanguage(settings = {}) {
    const dialogueMap = { 'ko-en': 'English', 'ko-ja': 'Japanese', 'ko-zh': 'Chinese' };
    const dialogueMode = settings.dialogueBilingual || 'off';
    if (dialogueMap[dialogueMode]) return dialogueMap[dialogueMode];

    const bidirectionalMode = settings.bidirectional || 'off';
    if (dialogueMap[bidirectionalMode]) return dialogueMap[bidirectionalMode];

    const configuredTarget = settings.targetLang || 'Korean';
    return configuredTarget === 'Korean' ? 'English' : configuredTarget;
}

export function resolveInputTranslationDirection(text, settings = {}) {
    const analysis = analyzeLanguage(text);
    const targetLang = getInputTargetLanguage(settings);
    return {
        targetLang,
        sourceLanguage: analysis.dominant,
        shouldTranslate: analysis.total > 0 && !isClearlyLanguage(analysis, targetLang),
        analysis
    };
}

export function detectLanguageDirection(text, settings) {
    // 🚨 언어 감지 전 메타 토큰 제거: ooc/rp/매크로 같은 영문 토큰이
    // "ooc: rp 중단하고 답변해" 같은 짧은 한국어 인풋의 비율을 왜곡하는 것 방지
    const analysis = analyzeLanguage(text);
    const korCount = analysis.chars.Korean;
    const engCount = analysis.chars.English;
    const jpCount = analysis.chars.Japanese;
    const cnCount = analysis.chars.Chinese;
    const total = korCount + engCount + jpCount + cnCount;

    if (total === 0) return { isToEnglish: false, targetLang: settings.targetLang };
    const korRatio = korCount / total; const engRatio = engCount / total;
    const jpRatio = jpCount / total; const cnRatio = cnCount / total;
    const bidir = settings.bidirectional || 'off';

    // 양방향 꺼짐 → 무조건 목표 언어로만
    if (bidir === 'off') {
        return { isToEnglish: false, targetLang: settings.targetLang };
    }

    // 한↔영
    if (bidir === 'ko-en') {
        if (isClearlyLanguage(analysis, 'Korean')) return { isToEnglish: true, targetLang: 'English' };
        if (isClearlyLanguage(analysis, 'English')) return { isToEnglish: false, targetLang: 'Korean' };
        // 🚨 혼합 텍스트 (둘 다 0.7 미달): 우세한 쪽을 원문으로 판정
        // 한글이 영문보다 많으면 한국어 원문 → 영어로, 반대면 영어 원문 → 한국어로
        if (korCount > 0 && korCount >= engCount) return { isToEnglish: true, targetLang: 'English' };
        if (engCount > korCount) return { isToEnglish: false, targetLang: 'Korean' };
    }

    // 한↔일
    if (bidir === 'ko-ja') {
        if (isClearlyLanguage(analysis, 'Korean')) return { isToEnglish: false, targetLang: 'Japanese' };
        if (isClearlyLanguage(analysis, 'Japanese', 0.6)) return { isToEnglish: false, targetLang: 'Korean' };
    }

    // 한↔중
    if (bidir === 'ko-zh') {
        if (isClearlyLanguage(analysis, 'Korean')) return { isToEnglish: false, targetLang: 'Chinese' };
        if (isClearlyLanguage(analysis, 'Chinese', 0.6)) return { isToEnglish: false, targetLang: 'Korean' };
    }

    return { isToEnglish: false, targetLang: settings.targetLang };
}

export function applyPreReplace(text, dictionary, isToEnglish) { return applyPreReplaceWithCount(text, dictionary, isToEnglish).swapped; }
export function applyPreReplaceWithCount(text, dictionary, isToEnglish) {
    if (!dictionary || dictionary.trim() === "") return { swapped: text, matchCount: 0 };
    const lines = dictionary.split('\n').filter(l => l.includes('='));
    if (lines.length === 0) return { swapped: text, matchCount: 0 };

    let result = text; let matchCount = 0;
    lines.sort((a, b) => b.split('=')[0].length - a.split('=')[0].length);

    lines.forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const orig = parts[0].trim(); const trans = parts.slice(1).join('=').trim();
            const searchStr = isToEnglish ? trans : orig; const replaceStr = isToEnglish ? orig : trans;
            if (searchStr && replaceStr) {
                const escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // 🚨 영문 단어는 word boundary 적용 (bro가 broken 안에서 매칭되는 것 방지)
                const isLatinWord = /^[a-zA-Z]/.test(searchStr) && /[a-zA-Z]$/.test(searchStr);
                const pattern = isLatinWord ? `\\b${escaped}\\b` : escaped;
                const regex = new RegExp(pattern, 'gi'); const matches = result.match(regex);
                if (matches) { matchCount += matches.length; result = result.replace(regex, replaceStr); }
            }
        }
    });
    return { swapped: result, matchCount };
}

export function normalizeText(text) {
    if (!text) return "";
    return text.toLowerCase().replace(/[^a-z가-힣0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, '').trim();
}

export function setTextareaValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (nativeSetter) nativeSetter.call(el, value); else el.value = value;
    $(el).val(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}

// 🚨 캐릭터별 말투 패턴 분석 (정규식 기반, 비용 0)
export function analyzeSpeechPatterns(contextMessages) {
    if (!contextMessages || contextMessages.length === 0) return null;
    
    const speakerData = {};
    contextMessages.forEach(msg => {
        const speaker = msg.speaker || msg.name || 'Unknown';
        const text = msg.voiceText || msg.text || msg.mes || '';
        if (!text) return;
        
        if (!speakerData[speaker]) {
            speakerData[speaker] = { texts: [], totalLen: 0, hasKorean: 0, hasEnglish: 0, profanityCount: 0,
                shortSentences: 0, longSentences: 0, banmal: 0, jondaetmal: 0,
                scottishMarkers: 0, irishMarkers: 0, britishMarkers: 0, texanMarkers: 0 };
        }
        const d = speakerData[speaker];
        d.texts.push(text);
        d.totalLen += text.length;
        
        // 언어 감지
        if (/[가-힣]/.test(text)) d.hasKorean++;
        if (/[a-zA-Z]{3,}/.test(text)) d.hasEnglish++;
        
        // 욕설 감지 (한/영)
        if (/씨발|좆|개새끼|병신|fuck|shit|bitch|bastard|damn/gi.test(text)) d.profanityCount++;
        
        // 문장 길이 (대화만)
        const dialogues = text.match(/"[^"]+"/g) || [];
        dialogues.forEach(d_text => {
            const wordCount = d_text.split(/\s+/).length;
            if (wordCount < 8) speakerData[speaker].shortSentences++;
            else if (wordCount > 20) speakerData[speaker].longSentences++;
        });
        
        // 한국어 어미 (반말/존댓말) - 정확한 패턴만 매칭
        // 반말: -야, -어, -지, -다 + 종결 (단 -다음 같은 것 제외)
        const speechText = dialogues.length > 0 ? dialogues.join(' ') : text;
        const banmalEndings = (speechText.match(/[다어야지네군](?=[.!?\s"」』]|$)/g) || []).length;
        const jondaetmalEndings = (speechText.match(/요(?=[.!?\s"」』]|$)|습니다|입니다|시오|십시오|세요/g) || []).length;
        // 반말이 존댓말로 오탐되는 케이스 보정
        const correctedBanmal = Math.max(0, banmalEndings - jondaetmalEndings);
        d.banmal += correctedBanmal;
        d.jondaetmal += jondaetmalEndings;
        
        // 영어 사투리 마커
        if (/\b(aye|lass|laddie|wee|bonnie|bairn|cannae|dinnae|wouldnae)\b/gi.test(text)) d.scottishMarkers++;
        if (/\b(begorrah|wee|grand|craic|after.*ing|tis|sure and)\b/gi.test(text)) d.irishMarkers++;
        if (/\b(bloody|bloke|blimey|innit|cheers mate|brilliant|reckon)\b/gi.test(text)) d.britishMarkers++;
        if (/\b(y'all|reckon|fixin'|ain't|howdy|partner|yonder)\b/gi.test(text)) d.texanMarkers++;
    });
    
    // 패턴 요약 생성
    const patterns = [];
    Object.entries(speakerData).forEach(([speaker, d]) => {
        if (d.texts.length === 0) return;
        const traits = [];
        const avgLen = d.totalLen / d.texts.length;
        
        // 언어
        if (d.hasKorean > 0 && d.hasEnglish > 0) traits.push('mixed Korean/English');
        else if (d.hasKorean > d.hasEnglish) traits.push('primarily Korean');
        else traits.push('primarily English');
        
        // 사투리 마커
        if (d.scottishMarkers > 0) traits.push('Scottish dialect markers (aye/lass/wee)');
        if (d.irishMarkers > 0) traits.push('Irish dialect markers');
        if (d.britishMarkers > 0) traits.push('British slang (bloody/bloke)');
        if (d.texanMarkers > 0) traits.push('Texan/Southern markers');
        
        // 문장 스타일
        if (d.shortSentences > d.longSentences * 2) traits.push('terse/short sentences');
        else if (d.longSentences > d.shortSentences * 2) traits.push('elaborate/long sentences');
        
        // 욕설
        if (d.profanityCount > 0) traits.push(`uses profanity (${d.profanityCount}x)`);
        
        // 한국어 어미
        if (d.hasKorean > 0) {
            if (d.banmal > d.jondaetmal * 2) traits.push('Korean: 반말 (informal)');
            else if (d.jondaetmal > d.banmal * 2) traits.push('Korean: 존댓말 (formal)');
            else if (d.banmal > 0 || d.jondaetmal > 0) traits.push('Korean: mixed formality');
        }
        
        if (traits.length > 0) patterns.push(`- ${speaker}: ${traits.join(', ')}`);
    });
    
    return patterns.length > 0 ? patterns.join('\n') : null;
}

// ============================================================
// 🔍 직역 병기 (Literal Appendix) 헬퍼
// ============================================================

// AI 출력에서 자연번역 / 직역 파트 분리
// 마커가 없으면 { natural: 전체, literal: null } — 우아한 실패
export function splitLiteralAppendix(text) {
    if (!text) return { natural: text, literal: null };
    const markerRe = /\n?\s*<{2,3}\s*CAT_LITERAL\s*>{2,3}\s*\n?/i;
    const m = text.match(markerRe);
    if (!m) return { natural: text, literal: null };
    const idx = m.index;
    const natural = text.slice(0, idx).trim();
    const literal = text.slice(idx + m[0].length).trim();
    // 직역 파트가 비어있으면 (토큰 잘림 등) 자연번역만
    if (!literal) return { natural, literal: null };
    // 자연번역 파트에 마커 잔재가 또 있으면 제거 (모델 이중 출력 방어)
    return { natural: natural.replace(markerRe, '').trim(), literal };
}

// 직역 텍스트 → 접이식 <details> HTML (ST 네이티브 렌더, 탭 이벤트 JS 불필요)
// 직역 파트가 "» 원문 / 직역" 교차 짝 형식이면 줄 단위 스타일링으로 번갈아 표시
// 형식이 아니면(모델이 무시) originalText로 기존 2블럭(원문 통짜+직역 통짜) 폴백
export function buildLiteralDetailsHtml(literalText, originalText = null) {
    const escapeHtml = (s) => String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const lines = String(literalText).split('\n');
    const hasPairs = lines.some(l => /^»\s?/.test(l.trim()));
    
    if (hasPairs) {
        // 교차 짝 렌더 — 네이티브 태그 구조 (p=짝 간격, em=원문 이탤릭, br=짝 내부 줄바꿈)
        // ST 새니타이저가 class를 벗기거나 CSS가 캐시돼도 브라우저 기본 스타일로 간격·구분 유지됨
        const pairs = [];
        let cur = null;
        for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            const m = t.match(/^»\s?(.*)$/);
            if (m) {
                if (cur) pairs.push(cur);
                cur = { orig: m[1], lit: [] };
            } else if (cur) {
                cur.lit.push(t);
            } else {
                // » 앞에 떠도는 줄 → 자체 짝으로 (원문 없이)
                pairs.push({ orig: null, lit: [t] });
            }
        }
        if (cur) pairs.push(cur);
        const body = pairs.map(p => {
            const litHtml = p.lit.map(escapeHtml).join('<br>');
            if (p.orig !== null) {
                return `<p class="cat-literal-pair"><em class="cat-literal-orig">${escapeHtml(p.orig)}</em><br>${litHtml}</p>`;
            }
            return `<p class="cat-literal-pair">${litHtml}</p>`;
        }).join('');
        return `<details class="cat-literal"><summary>🔍 원문·직역 보기</summary><div class="cat-literal-body">${body}</div></details>`;
    }
    
    // 폴백: 짝 형식 아님 → 원문 통짜 + 직역 통짜 2블럭
    const litHtml = escapeHtml(literalText).replace(/\n/g, '<br>');
    if (originalText) {
        const origHtml = escapeHtml(originalText).replace(/\n/g, '<br>');
        return `<details class="cat-literal"><summary>🔍 원문·직역 보기</summary><div class="cat-literal-body"><div class="cat-literal-label">📜 원문</div><div class="cat-literal-orig">${origHtml}</div><div class="cat-literal-label">🔍 직역</div><div>${litHtml}</div></div></details>`;
    }
    return `<details class="cat-literal"><summary>🔍 직역 보기</summary><div class="cat-literal-body">${litHtml}</div></details>`;
}

// display_text에서 직역 details 블록 제거 (재번역 prevTranslation 오염 방지용)
export function stripLiteralDetails(text) {
    if (!text) return text;
    return text.replace(/\s*<details class="cat-literal">[\s\S]*?<\/details>\s*/g, '').trim();
}

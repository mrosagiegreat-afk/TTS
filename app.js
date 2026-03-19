const PLACEHOLDER_TEXT = "Upload a book to start reading or paste your text here...";

const shortcuts = {
    Space: "Play/Pause",
    "Ctrl + Right": "Skip forward 10%",
    "Ctrl + Left": "Skip back 10%",
    "Ctrl + Up": "Speed up",
    "Ctrl + Down": "Slow down",
    "Ctrl + B": "Add bookmark",
    "Ctrl + F": "Search",
    "Ctrl + S": "Save position",
    Esc: "Stop reading"
};

const appState = {
    hasBookLoaded: false,
    currentFileType: null,
    currentFileName: "",
    currentBookId: null,
    pendingRecentBookId: null,
    pdfPages: [],
    readingStartIndex: 0,
    currentBookText: "",
    chapters: [],
    emotionMode: true,
    autoScrollEnabled: false
};

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function showLoading(message) {
    const overlay = document.getElementById("loadingOverlay");
    const text = document.getElementById("loadingText");
    if (message && text) text.innerText = message;
    if (overlay) overlay.style.display = "flex";
}

function hideLoading() {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) overlay.style.display = "none";
}

function escapeHtml(text) {
    return (text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatTextAsHtml(text) {
    const normalized = (text || "")
        .replace(/\r\n?/g, "\n")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
    if (!normalized) return "";
    const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (!paragraphs.length) {
        return `<p>${escapeHtml(normalized).replace(/\n/g, "<br>")}</p>`;
    }
    return paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("\n");
}

function renderBookText(text) {
    const html = formatTextAsHtml(text);
    const target = document.getElementById("bookContent");
    target.innerHTML = html || `<p>${PLACEHOLDER_TEXT}</p>`;
}

function getCurrentReadableText() {
    return appState.currentBookText || (document.getElementById("bookContent").innerText || "").trim();
}

function scrollBookToIndex(index, textLength) {
    const content = document.getElementById("bookContent");
    const ratio = textLength ? clamp(index / textLength, 0, 1) : 0;
    const maxScroll = Math.max(content.scrollHeight - content.clientHeight, 0);
    content.scrollTop = maxScroll * ratio;
}

function updateStartPositionLabel() {
    const label = document.getElementById("startPositionLabel");
    if (!label) return;
    const text = getCurrentReadableText();
    if (!text || appState.readingStartIndex <= 0) {
        label.innerText = "Start point: beginning";
        return;
    }
    const percent = Math.round((appState.readingStartIndex / Math.max(text.length, 1)) * 100);
    label.innerText = `Start point: ${percent}%`;
}

function saveCurrentPosition() {
    if (!appState.hasBookLoaded || !appState.currentBookId) return;
    const text = getCurrentReadableText();
    if (!text) return;
    const currentIndex = clamp(
        typeof voiceManager.currentAbsoluteChar === "number" ? voiceManager.currentAbsoluteChar : appState.readingStartIndex,
        0,
        Math.max(text.length - 1, 0)
    );
    const positionPercent = text.length ? (currentIndex / text.length) * 100 : 0;
    readingPosition.savePosition(appState.currentBookId, {
        charIndex: currentIndex,
        position: positionPercent,
        textLength: text.length,
        bookTitle: appState.currentFileName
    });
}

function setReadingStartIndex(index) {
    const text = getCurrentReadableText();
    if (!text) return;
    appState.readingStartIndex = clamp(Math.floor(index), 0, Math.max(text.length - 1, 0));
    const percent = (appState.readingStartIndex / Math.max(text.length, 1)) * 100;
    document.getElementById("progressFill").style.width = `${percent}%`;
    updateStartPositionLabel();
    scrollBookToIndex(appState.readingStartIndex, text.length);
    saveCurrentPosition();
}

function getCharIndexFromPoint(container, clientX, clientY) {
    let range = null;
    if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
        const position = document.caretPositionFromPoint(clientX, clientY);
        if (position) {
            range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
            range.collapse(true);
        }
    }
    if (!range || !container.contains(range.startContainer)) return null;
    const preRange = document.createRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
}

class TextCleaner {
    cleanText(text) {
        return (text || "")
            .replace(/l(?=[A-Z])/g, "I")
            .replace(/([A-Za-z])0([A-Za-z])/g, "$1O$2")
            .replace(/rn/g, "m")
            .replace(/(\d)\.(\d)/g, "$1 point $2")
            .replace(/\b(\d+)\b/g, (match) => this.numberToWords(parseInt(match, 10)))
            .replace(/\bDr\./g, "Doctor")
            .replace(/\bMr\./g, "Mister")
            .replace(/\bMrs\./g, "Misses")
            .replace(/\bProf\./g, "Professor")
            .replace(/\bwon't\b/gi, "will not")
            .replace(/\bcan't\b/gi, "cannot")
            .replace(/\bit's\b/gi, "it is")
            .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, "$1 $2 $3")
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    numberToWords(num) {
        const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
        return Number.isFinite(num) && words[num] ? words[num] : String(num);
    }
}

class ReadingPosition {
    constructor() {
        this.positions = JSON.parse(localStorage.getItem("readingPositions") || "{}");
    }

    savePosition(bookId, payload) {
        if (!bookId) return;
        this.positions[bookId] = {
            ...this.positions[bookId],
            ...payload,
            timestamp: Date.now(),
            bookTitle: payload.bookTitle || this.positions[bookId]?.bookTitle || "Unknown Book"
        };
        localStorage.setItem("readingPositions", JSON.stringify(this.positions));
        this.showRecentBooks();
    }

    loadPosition(bookId) {
        return this.positions[bookId] || null;
    }

    showRecentBooks() {
        const holder = document.getElementById("recentBooks");
        if (!holder) return;
        const recent = Object.entries(this.positions)
            .sort((a, b) => b[1].timestamp - a[1].timestamp)
            .slice(0, 5);

        if (!recent.length) {
            holder.innerHTML = `<div class="voice-desc">No recent reading positions yet.</div>`;
            return;
        }

        let html = "";
        recent.forEach(([id, data]) => {
            const pct = Number.isFinite(data.position) ? Math.round(data.position) : 0;
            html += `<div class="recent-item" onclick="loadRecent('${id}')">Book: ${escapeHtml(data.bookTitle || "Unknown")} - ${pct}%</div>`;
        });
        holder.innerHTML = html;
    }
}

class BookmarkSystem {
    constructor() {
        this.bookmarks = JSON.parse(localStorage.getItem("bookmarks") || "{}");
    }

    addBookmark() {
        if (!appState.currentBookId || !appState.hasBookLoaded) {
            alert("Upload and open a book first.");
            return;
        }

        const text = getCurrentReadableText();
        const position = clamp(
            typeof voiceManager.currentAbsoluteChar === "number" ? voiceManager.currentAbsoluteChar : appState.readingStartIndex,
            0,
            Math.max(text.length - 1, 0)
        );
        const bookmark = {
            id: Date.now().toString(),
            bookId: appState.currentBookId,
            bookName: appState.currentFileName || "Current Book",
            position,
            preview: text.substring(position, position + 120),
            timestamp: new Date().toLocaleString()
        };

        if (!this.bookmarks[bookmark.bookId]) this.bookmarks[bookmark.bookId] = [];
        this.bookmarks[bookmark.bookId].push(bookmark);
        localStorage.setItem("bookmarks", JSON.stringify(this.bookmarks));
        this.displayBookmarks();
    }

    getBookmark(bookmarkId) {
        for (const [bookId, marks] of Object.entries(this.bookmarks)) {
            const found = marks.find((mark) => mark.id === String(bookmarkId));
            if (found) return { ...found, bookId };
        }
        return null;
    }

    displayBookmarks() {
        const panel = document.getElementById("bookmarksPanel");
        if (!panel) return;
        let html = "";

        const entries = Object.entries(this.bookmarks);
        if (!entries.length) {
            panel.innerHTML = `<div class="voice-desc">No bookmarks yet.</div>`;
            return;
        }

        entries.forEach(([, marks]) => {
            marks.forEach((mark) => {
                const preview = escapeHtml(mark.preview || "").slice(0, 110);
                html += `
                    <div class="bookmark-item" onclick="jumpToBookmark('${mark.id}')">
                        <small>${escapeHtml(mark.timestamp)}</small>
                        <div>${escapeHtml(mark.bookName)}</div>
                        <p>${preview}...</p>
                    </div>
                `;
            });
        });
        panel.innerHTML = html;
    }
}

class SmartPause {
    constructor() {
        this.lastPosition = 0;
        this.pauseTimer = null;
        this.pausedBySmart = false;
    }

    detectUserActivity() {
        return;
    }

    pauseWithUndo() {
        return;
    }

    showUndoNotification() {
        return;
    }

    resumeIfInactive() {
        return;
    }
}

class DictionaryLookup {
    async defineWord(word) {
        try {
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
            const data = await response.json();
            if (Array.isArray(data) && data[0]) {
                const firstDef = data[0]?.meanings?.[0]?.definitions?.[0];
                if (firstDef) {
                    return { definition: firstDef.definition || "", example: firstDef.example || "" };
                }
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    showTooltip(x, y, html) {
        const tooltip = document.getElementById("definitionTooltip");
        if (!tooltip) return;
        tooltip.innerHTML = html;
        tooltip.style.left = `${x + 12}px`;
        tooltip.style.top = `${y + 12}px`;
        tooltip.style.display = "block";
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            tooltip.style.display = "none";
        }, 9000);
    }

    showDefinition() {
        const content = document.getElementById("bookContent");
        content.addEventListener("dblclick", async (event) => {
            const selection = window.getSelection().toString().trim();
            if (!selection || selection.length > 32) return;
            const definition = await this.defineWord(selection);
            if (definition) {
                this.showTooltip(
                    event.clientX,
                    event.clientY,
                    `<strong>${escapeHtml(selection)}</strong><br>${escapeHtml(definition.definition)}<br><em>${escapeHtml(definition.example || "")}</em>`
                );
            }
        });

        document.addEventListener("click", (event) => {
            const tooltip = document.getElementById("definitionTooltip");
            if (tooltip && !tooltip.contains(event.target)) {
                tooltip.style.display = "none";
            }
        });
    }
}

class SpeedTraining {
    constructor() {
        this.speedHistory = JSON.parse(localStorage.getItem("speedHistory") || "[]");
    }

    recordPause() {
        this.speedHistory.push({
            timestamp: Date.now(),
            speed: parseFloat(document.getElementById("rate").value)
        });
        this.speedHistory = this.speedHistory.slice(-50);
        localStorage.setItem("speedHistory", JSON.stringify(this.speedHistory));
    }

    pauseFrequency() {
        const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
        const recent = this.speedHistory.filter((entry) => entry.timestamp >= tenMinutesAgo);
        return recent.length / 50;
    }

    adaptiveSpeed() {
        const rateInput = document.getElementById("rate");
        const currentSpeed = parseFloat(rateInput.value);
        if (this.pauseFrequency() < 0.1 && currentSpeed < 2.0) {
            const updated = Math.min(currentSpeed + 0.1, 2);
            rateInput.value = updated.toFixed(1);
            document.getElementById("rateValue").innerText = `${updated.toFixed(1)}x`;
        }
    }
}

class EmotionalReading {
    constructor() {
        this.emotionMarkers = {
            "!": { rate: 1.1, pitch: 1.2 },
            "?": { rate: 0.9, pitch: 1.1 },
            "...": { rate: 0.7, pitch: 0.9 },
            ".": { rate: 1.0, pitch: 1.0 }
        };
        this.cancelRequested = false;
    }

    cancel() {
        this.cancelRequested = true;
    }

    analyzeSentence(sentence) {
        const trimmed = sentence.trim();
        let key = ".";
        if (trimmed.endsWith("...")) key = "...";
        else if (trimmed.endsWith("!")) key = "!";
        else if (trimmed.endsWith("?")) key = "?";
        return {
            ...this.emotionMarkers[key],
            text: sentence
        };
    }

    async readWithEmotion(text, voice, baseRate, onProgress, onFinish) {
        this.cancelRequested = false;
        const sentences = (text.match(/[^.!?]+(?:\.\.\.|[.!?])?/g) || [text]).map((s) => s.trim()).filter(Boolean);
        let consumed = 0;

        for (const sentence of sentences) {
            if (this.cancelRequested) break;
            const config = this.analyzeSentence(sentence);
            const utterance = new SpeechSynthesisUtterance(config.text);
            utterance.voice = voice;
            utterance.rate = clamp(config.rate * baseRate, 0.5, 2);
            utterance.pitch = config.pitch;

            utterance.onboundary = (event) => {
                if (typeof event.charIndex === "number") onProgress(consumed + event.charIndex);
            };

            window.speechSynthesis.speak(utterance);

            await new Promise((resolve) => {
                utterance.onend = resolve;
                utterance.onerror = resolve;
            });

            consumed += sentence.length + 1;
        }

        if (typeof onFinish === "function") onFinish();
    }
}

class ReadingModes {
    constructor() {
        this.restore();
    }

    restore() {
        if (localStorage.getItem("darkMode") === "true") document.body.classList.add("dark-mode");
        if (localStorage.getItem("focusMode") === "true") document.body.classList.add("focus-mode");
        if (localStorage.getItem("highContrast") === "true") document.body.classList.add("high-contrast");
        if (localStorage.getItem("dyslexiaMode") === "true") {
            document.body.style.fontFamily = "OpenDyslexic, Arial, sans-serif";
        }
    }

    toggleDarkMode() {
        document.body.classList.toggle("dark-mode");
        localStorage.setItem("darkMode", document.body.classList.contains("dark-mode"));
    }

    toggleFocusMode() {
        document.body.classList.toggle("focus-mode");
        localStorage.setItem("focusMode", document.body.classList.contains("focus-mode"));
    }

    toggleDyslexiaFont() {
        const enabled = localStorage.getItem("dyslexiaMode") === "true";
        if (enabled) {
            document.body.style.fontFamily = "";
            localStorage.setItem("dyslexiaMode", "false");
        } else {
            document.body.style.fontFamily = "OpenDyslexic, Arial, sans-serif";
            localStorage.setItem("dyslexiaMode", "true");
        }
    }

    increaseContrast() {
        document.body.classList.toggle("high-contrast");
        localStorage.setItem("highContrast", document.body.classList.contains("high-contrast"));
    }
}

class AutoScroll {
    constructor() {
        this.scrollInterval = null;
    }

    startAutoScroll() {
        this.stopAutoScroll();
        if (!appState.autoScrollEnabled) return;
        const content = document.getElementById("bookContent");
        const words = (content.innerText || "").split(/\s+/).filter(Boolean).length;
        if (!words) return;
        const wordsPerMinute = 150 * parseFloat(document.getElementById("rate").value);
        const pixelsPerSecond = (content.scrollHeight / words) * (wordsPerMinute / 60);
        this.scrollInterval = setInterval(() => {
            content.scrollBy({ top: pixelsPerSecond / 10, behavior: "smooth" });
        }, 100);
    }

    stopAutoScroll() {
        if (this.scrollInterval) {
            clearInterval(this.scrollInterval);
            this.scrollInterval = null;
        }
    }
}

class VoiceManager {
    constructor() {
        this.voices = [];
        this.selectedVoice = null;
        this.currentUtterance = null;
        this.totalLength = 0;
        this.startOffset = 0;
        this.currentAbsoluteChar = 0;
        this.stopRequested = false;
        this.readSessionId = 0;
        this.currentHighlightElement = null;
        this.progressTimer = null;
        this.lastBoundaryAt = 0;
        this.syntheticChar = 0;

        const isiPhoneLike = /iPhone|iPad|iPod/i.test(navigator.userAgent) && !window.MSStream;
        const isiPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
        this.isIOS = isiPhoneLike || isiPadOS;

        this.allowedVoiceNames = this.isIOS ? null : [
            "Google US English",
            "Google UK English Female",
            "Google UK English Male"
        ];
    }

    async initialize() {
        return new Promise((resolve) => {
            window.speechSynthesis.onvoiceschanged = () => {
                this.loadVoices();
                resolve();
            };
            setTimeout(() => {
                this.loadVoices();
                resolve();
            }, 600);
        });
    }

    loadVoices() {
        this.voices = window.speechSynthesis.getVoices();
        this.displayVoices();
    }

    displayVoices() {
        const grid = document.getElementById("voiceGrid");
        let voicesToShow = [];
        if (this.isIOS) {
            voicesToShow = this.voices.filter((voice) => (voice.lang || "").toLowerCase().startsWith("en"));
            if (!voicesToShow.length) voicesToShow = this.voices.slice();
        } else {
            voicesToShow = (this.allowedVoiceNames || [])
                .map((name) => this.voices.find((voice) => voice.name === name))
                .filter(Boolean);
        }

        if (!voicesToShow.length) {
            grid.innerHTML = this.isIOS
                ? `<div class="voice-desc">No voices available in this browser.</div>`
                : `<div class="voice-desc">Google premium voices are not available in this browser.</div>`;
            this.selectedVoice = null;
            return;
        }

        let html = "";
        voicesToShow.forEach((voice) => {
            let badgeClass = "badge-premium";
            let badgeText = "GOOGLE PREMIUM";
            if (this.isIOS) {
                const isSiriLike = /samantha|siri|aaron|allison|sandy|tom/i.test(voice.name || "");
                badgeClass = isSiriLike ? "badge-neural" : "badge-standard";
                badgeText = isSiriLike ? "SIRI" : "IOS VOICE";
            }

            const voiceMode = voice.localService ? "Local" : "Cloud";
            html += `<div class="voice-card" data-voice-name="${voice.name}"><div class="voice-name">${voice.name}</div><div class="voice-desc">${voice.lang} - ${voiceMode}</div><div class="voice-badge ${badgeClass}">${badgeText}</div></div>`;
        });
        grid.innerHTML = html;

        document.querySelectorAll(".voice-card").forEach((card) => {
            card.addEventListener("click", () => this.selectVoice(card.dataset.voiceName));
        });

        const selectedStillAvailable = voicesToShow.some((voice) => this.selectedVoice && voice.name === this.selectedVoice.name);
        if (!selectedStillAvailable) {
            let defaultVoice = voicesToShow[0];
            if (this.isIOS) {
                defaultVoice = voicesToShow.find((voice) => /samantha|siri/i.test(voice.name || "")) || voicesToShow[0];
            }
            if (defaultVoice) this.selectVoice(defaultVoice.name, false);
        }
    }

    selectVoice(voiceName, shouldTest = true) {
        this.selectedVoice = this.voices.find((voice) => voice.name === voiceName) || null;
        document.querySelectorAll(".voice-card").forEach((card) => {
            card.classList.remove("selected");
            if (card.dataset.voiceName === voiceName) card.classList.add("selected");
        });
        if (shouldTest) this.testVoice();
    }

    testVoice() {
        if (!this.selectedVoice) return;
        const testMsg = new SpeechSynthesisUtterance("Hello, I am ready to read your book.");
        testMsg.voice = this.selectedVoice;
        testMsg.rate = 0.9;
        window.speechSynthesis.speak(testMsg);
    }

    clearHighlight() {
        const current = this.currentHighlightElement;
        if (!current) return;

        if (current.classList && current.classList.contains("reading-block")) {
            current.classList.remove("reading-block");
        } else {
            const parent = current.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(current.textContent || ""), current);
                parent.normalize();
            }
        }
        this.currentHighlightElement = null;
    }

    startProgressFallback(sessionId, baseRate) {
        this.stopProgressFallback();
        this.lastBoundaryAt = 0;
        this.syntheticChar = this.startOffset;
        const charsPerSecond = Math.max(6, 14 * baseRate);
        this.progressTimer = window.setInterval(() => {
            if (sessionId !== this.readSessionId || this.stopRequested) {
                this.stopProgressFallback();
                return;
            }
            if (!window.speechSynthesis.speaking || window.speechSynthesis.paused) return;
            if (Date.now() - this.lastBoundaryAt < 300) return;
            this.syntheticChar = Math.max(this.syntheticChar, this.currentAbsoluteChar);
            this.syntheticChar = clamp(this.syntheticChar + (charsPerSecond * 0.12), this.startOffset, this.totalLength);
            this.updateProgress(Math.floor(this.syntheticChar));
        }, 120);
    }

    stopProgressFallback() {
        if (this.progressTimer) {
            clearInterval(this.progressTimer);
            this.progressTimer = null;
        }
    }

    findNodeAtCharIndex(container, targetIndex) {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        const probe = document.createRange();
        probe.selectNodeContents(container);
        let node = null;
        let lastTextNode = null;

        while ((node = walker.nextNode())) {
            const value = node.nodeValue || "";
            if (!value.length) continue;
            lastTextNode = node;
            probe.setEnd(node, value.length);
            const endIndex = probe.toString().length;
            const startIndex = endIndex - value.length;
            if (targetIndex < endIndex || targetIndex < startIndex) {
                return {
                    node,
                    offset: clamp(targetIndex - startIndex, 0, Math.max(value.length - 1, 0))
                };
            }
        }

        if (!lastTextNode) return null;
        return {
            node: lastTextNode,
            offset: Math.max((lastTextNode.nodeValue || "").length - 1, 0)
        };
    }

    getBlockRangeForIndex(text, index) {
        const safeText = text || "";
        const len = safeText.length;
        if (!len) return null;

        const target = clamp(index, 0, len - 1);
        let start = target;
        while (start > 0) {
            const prev = safeText[start - 1];
            if (/[.!?]/.test(prev)) break;
            if (safeText[start - 1] === "\n" && safeText[start] === "\n") break;
            start -= 1;
        }
        while (start < len && /\s/.test(safeText[start])) start += 1;

        let end = target + 1;
        while (end < len) {
            const prev = safeText[end - 1];
            if (/[.!?]/.test(prev)) break;
            if (safeText[end - 1] === "\n" && safeText[end] === "\n") break;
            end += 1;
        }
        while (end < len && /["'”’)\]]/.test(safeText[end])) end += 1;
        while (end < len && /\s/.test(safeText[end])) end += 1;

        if (start >= end) end = Math.min(start + 1, len);
        return { start, end };
    }

    highlightCurrentBlock(currentCharIndex) {
        const content = document.getElementById("bookContent");
        if (!content) return;
        const visibleText = content.innerText || "";
        if (!visibleText.trim() || visibleText.trim() === PLACEHOLDER_TEXT) {
            this.clearHighlight();
            return;
        }

        const targetIndex = clamp(Math.floor(currentCharIndex), 0, Math.max(visibleText.length - 1, 0));
        const location = this.findNodeAtCharIndex(content, targetIndex);
        if (!location || !location.node) return;

        let block = location.node.parentElement;
        while (block && block !== content && !/^(P|LI|BLOCKQUOTE|DIV|H1|H2|H3|H4|H5|H6)$/i.test(block.tagName)) {
            block = block.parentElement;
        }
        if (!block || block === content) block = location.node.parentElement;
        if (!block) return;
        if (this.currentHighlightElement === block) return;

        this.clearHighlight();
        block.classList.add("reading-block");
        this.currentHighlightElement = block;
        block.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    updateProgress(currentCharIndex) {
        this.currentAbsoluteChar = clamp(currentCharIndex, 0, Math.max(this.totalLength - 1, 0));
        const progress = (this.currentAbsoluteChar / Math.max(this.totalLength, 1)) * 100;
        document.getElementById("progressFill").style.width = `${clamp(progress, 0, 100)}%`;
        this.highlightCurrentBlock(this.currentAbsoluteChar);
        saveCurrentPosition();
    }

    async readBook(text, startIndex = 0) {
        if (!this.selectedVoice) {
            alert("Please select a voice first.");
            return;
        }

        const renderedText = (document.getElementById("bookContent")?.innerText || "").replace(/\r\n?/g, "\n");
        const fallbackText = (text || "").replace(/\r\n?/g, "\n");
        const sourceText = renderedText.trim() ? renderedText : fallbackText;
        if (!sourceText.trim()) {
            alert("No readable content found.");
            return;
        }

        const safeStart = clamp(Math.floor(startIndex), 0, Math.max(sourceText.length - 1, 0));
        const fromStart = sourceText.slice(safeStart);
        const firstReadable = fromStart.search(/\S/);
        if (firstReadable < 0) {
            alert("The selected start point is too close to the end.");
            return;
        }
        const actualStart = safeStart + firstReadable;
        const textToRead = sourceText.slice(actualStart);

        this.stopRequested = true;
        this.readSessionId += 1;
        const sessionId = this.readSessionId;
        emotionalReading.cancel();
        window.speechSynthesis.cancel();
        autoScroll.stopAutoScroll();
        this.clearHighlight();
        this.stopRequested = false;
        this.currentUtterance = null;

        this.totalLength = sourceText.length;
        this.startOffset = actualStart;
        this.currentAbsoluteChar = actualStart;

        const onStart = () => {
            if (sessionId !== this.readSessionId || this.stopRequested) return;
            document.getElementById("voiceWave").style.display = "flex";
            this.updateProgress(this.startOffset);
            this.startProgressFallback(sessionId, baseRate);
            autoScroll.startAutoScroll();
        };

        const onEnd = () => {
            if (sessionId !== this.readSessionId) return;
            document.getElementById("voiceWave").style.display = "none";
            autoScroll.stopAutoScroll();
            this.stopProgressFallback();
            this.updateProgress(this.totalLength);
            this.clearHighlight();
            speedTraining.adaptiveSpeed();
            this.currentUtterance = null;
        }

        const baseRate = parseFloat(document.getElementById("rate").value);
        if (appState.emotionMode) {
            onStart();
            await emotionalReading.readWithEmotion(
                textToRead,
                this.selectedVoice,
                baseRate,
                (relativeChar) => {
                    if (sessionId !== this.readSessionId || this.stopRequested) return;
                    this.lastBoundaryAt = Date.now();
                    this.updateProgress(this.startOffset + relativeChar);
                },
                onEnd
            );
            return;
        }

        this.currentUtterance = new SpeechSynthesisUtterance(textToRead);
        this.currentUtterance.voice = this.selectedVoice;
        this.currentUtterance.rate = baseRate;
        this.currentUtterance.pitch = 1;
        this.currentUtterance.volume = 1;
        this.currentUtterance.onstart = onStart;
        this.currentUtterance.onboundary = (event) => {
            if (sessionId !== this.readSessionId || this.stopRequested) return;
            if (typeof event.charIndex === "number") {
                this.lastBoundaryAt = Date.now();
                this.syntheticChar = this.startOffset + event.charIndex;
                this.updateProgress(this.startOffset + event.charIndex);
            }
        };
        this.currentUtterance.onend = onEnd;
        this.currentUtterance.onerror = (event) => {
            if (sessionId !== this.readSessionId) return;
            console.error("Speech error:", event);
            document.getElementById("voiceWave").style.display = "none";
            autoScroll.stopAutoScroll();
            this.stopProgressFallback();
            this.clearHighlight();
            this.currentUtterance = null;
        };

        window.speechSynthesis.speak(this.currentUtterance);
    }
}

class FileHandler {
    async readFile(file) {
        const extension = (file.name.split(".").pop() || "").toLowerCase();
        if (extension === "pdf") return this.readPDF(file);
        if (extension === "epub") return this.readEpub(file);
        if (extension === "docx") return this.readDocx(file);
        return this.readText(file);
    }

    async readText(file) {
        const text = textCleaner.cleanText(await file.text());
        return { type: "txt", text };
    }

    async extractPdfPageText(page) {
        const textContent = await page.getTextContent();
        const items = textContent.items || [];
        let lastY = null;
        let line = "";
        const lines = [];
        items.forEach((item) => {
            const part = (item.str || "").trim();
            if (!part) return;
            const y = item.transform ? item.transform[5] : null;
            if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
                if (line.trim()) lines.push(line.trim());
                line = part;
            } else {
                line += (line ? " " : "") + part;
            }
            lastY = y;
        });
        if (line.trim()) lines.push(line.trim());
        return textCleaner.cleanText(lines.join("\n"));
    }

    async readPDF(file) {
        if (!window.pdfjsLib) throw new Error("PDF.js failed to load.");
        const data = await file.arrayBuffer();
        const task = window.pdfjsLib.getDocument({ data: new Uint8Array(data) });
        const pdf = await task.promise;
        const pages = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            showLoading(`Parsing PDF page ${pageNumber} of ${pdf.numPages}...`);
            const page = await pdf.getPage(pageNumber);
            const pageText = await this.extractPdfPageText(page);
            pages.push(pageText.trim());
        }
        return { type: "pdf", text: pages.join("\n\n"), pages };
    }

    async readEpub(file) {
        if (!window.ePub) throw new Error("EPUB parser failed to load.");
        const data = await file.arrayBuffer();
        const book = window.ePub(data);
        await book.ready;
        const spineItems = (book.spine && book.spine.spineItems) ? book.spine.spineItems : [];
        const sections = [];

        for (let index = 0; index < spineItems.length; index++) {
            const section = spineItems[index];
            showLoading(`Parsing EPUB section ${index + 1} of ${spineItems.length}...`);
            const contents = await section.load(book.load.bind(book));
            let text = "";
            if (section.document && section.document.body) {
                text = section.document.body.innerText || section.document.body.textContent || "";
            } else if (contents && contents.body) {
                text = contents.body.innerText || contents.body.textContent || "";
            } else if (typeof contents === "string") {
                const temp = document.createElement("div");
                temp.innerHTML = contents;
                text = temp.innerText || temp.textContent || "";
            }
            section.unload();
            const cleaned = textCleaner.cleanText(text);
            if (cleaned.trim()) sections.push(cleaned.trim());
        }

        if (typeof book.destroy === "function") book.destroy();
        return { type: "epub", text: sections.join("\n\n") };
    }

    async readDocx(file) {
        if (!window.mammoth) throw new Error("DOCX parser failed to load.");
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        const text = textCleaner.cleanText(result.value || "");
        return { type: "docx", text };
    }
}

const textCleaner = new TextCleaner();
const readingPosition = new ReadingPosition();
const bookmarkSystem = new BookmarkSystem();
const speedTraining = new SpeedTraining();
const emotionalReading = new EmotionalReading();
const readingModes = new ReadingModes();
const autoScroll = new AutoScroll();
const voiceManager = new VoiceManager();
const fileHandler = new FileHandler();
const smartPause = new SmartPause();
const dictionaryLookup = new DictionaryLookup();

window.readingModes = readingModes;

function buildBookId(file) {
    return `${file.name}_${file.size}_${file.lastModified}`;
}

function applySavedPosition(saved) {
    if (!saved) return;
    const text = getCurrentReadableText();
    if (!text) return;
    const index = Number.isFinite(saved.charIndex)
        ? clamp(saved.charIndex, 0, Math.max(text.length - 1, 0))
        : clamp(Math.floor(((saved.position || 0) / 100) * text.length), 0, Math.max(text.length - 1, 0));
    setReadingStartIndex(index);
}

function buildTextChapters(text) {
    const chapters = [];
    const lines = (text || "").split("\n");
    let cursor = 0;
    lines.forEach((line) => {
        const trimmed = line.trim();
        if (/^(chapter|part|section)\b/i.test(trimmed)) {
            chapters.push({ title: trimmed.slice(0, 80), index: cursor });
        }
        cursor += line.length + 1;
    });

    if (!chapters.length && text.length) {
        const chunk = Math.max(1, Math.floor(text.length / 8));
        for (let i = 0; i < text.length; i += chunk) {
            chapters.push({ title: `Section ${chapters.length + 1}`, index: i });
        }
    }
    appState.chapters = chapters.slice(0, 30);
}

function buildPdfChapters() {
    let cursor = 0;
    appState.chapters = appState.pdfPages.map((pageText, idx) => {
        const chapter = {
            title: `Page ${idx + 1}`,
            index: cursor
        };
        cursor += (pageText || "").length + 2;
        return chapter;
    });
}

function renderChapterList() {
    const holder = document.getElementById("chapterList");
    if (!holder) return;
    if (!appState.chapters.length) {
        holder.innerHTML = `<div class="voice-desc">No chapters detected.</div>`;
        return;
    }
    let html = "";
    appState.chapters.forEach((chapter) => {
        html += `<div onclick="jumpToChapter(${chapter.index})">${escapeHtml(chapter.title)}</div>`;
    });
    holder.innerHTML = html;
}

function jumpToChapter(target) {
    setReadingStartIndex(target);
    if (window.speechSynthesis.speaking || window.speechSynthesis.paused) {
        stopReading();
        readAloud();
    }
}

function toggleQuickNav() {
    const panel = document.getElementById("quickNav");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    readingPosition.showRecentBooks();
    bookmarkSystem.displayBookmarks();
    renderChapterList();
}

function searchInBook() {
    const query = (document.getElementById("searchInput").value || "").trim().toLowerCase();
    if (!query) return;

    const text = getCurrentReadableText().toLowerCase();
    const index = text.indexOf(query);
    if (index >= 0) setReadingStartIndex(index);
    else alert("Search text not found.");
}

function showShortcuts() {
    const panel = document.getElementById("shortcutsPanel");
    let html = "";
    Object.entries(shortcuts).forEach(([key, desc]) => {
        html += `<div><kbd>${escapeHtml(key)}</kbd> - ${escapeHtml(desc)}</div>`;
    });
    panel.innerHTML = html;
    panel.style.display = panel.style.display === "none" ? "block" : "none";
}

function toggleEmotionMode() {
    appState.emotionMode = !appState.emotionMode;
    const button = document.getElementById("emotionToggle");
    if (!button) return;
    button.classList.toggle("mode-on", appState.emotionMode);
    button.innerHTML = `<span>Mood</span> ${appState.emotionMode ? "Emotion On" : "Emotion Off"}`;
}

function toggleAutoScrollMode() {
    appState.autoScrollEnabled = !appState.autoScrollEnabled;
    const button = document.getElementById("autoScrollToggle");
    if (button) button.innerText = appState.autoScrollEnabled ? "Auto Scroll On" : "Auto Scroll Off";
    if (!appState.autoScrollEnabled) autoScroll.stopAutoScroll();
}

function addBookmark() {
    bookmarkSystem.addBookmark();
}

function loadRecent(bookId) {
    const data = readingPosition.loadPosition(bookId);
    if (!data) return;
    if (!appState.currentBookId || appState.currentBookId !== bookId) {
        appState.pendingRecentBookId = bookId;
        alert("Upload this same book file to restore that saved position.");
        return;
    }
    applySavedPosition(data);
}

function jumpToBookmark(bookmarkId) {
    const mark = bookmarkSystem.getBookmark(bookmarkId);
    if (!mark) return;
    if (!appState.currentBookId || appState.currentBookId !== mark.bookId) {
        alert("Load the same book file for this bookmark first.");
        return;
    }
    setReadingStartIndex(mark.position || 0);
    if (window.speechSynthesis.speaking || window.speechSynthesis.paused) {
        stopReading();
        readAloud();
    }
}

function undoSmartPause() {
    setReadingStartIndex(smartPause.lastPosition || 0);
    smartPause.pausedBySmart = false;
    const notice = document.getElementById("undoNotice");
    if (notice) notice.style.display = "none";
    readAloud();
}

async function processFile(file) {
    if (!file) return;
    const maxSizeBytes = 100 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
        alert("File is too large. Maximum allowed size is 100MB.");
        return;
    }

    const extension = (file.name.split(".").pop() || "").toUpperCase();
    const uploadIcon = document.getElementById("uploadIcon");
    if (uploadIcon) uploadIcon.innerText = extension || "TXT";

    try {
        showLoading(`Parsing ${extension || "file"}...`);
        const parsed = await fileHandler.readFile(file);
        const content = (parsed && parsed.text ? parsed.text : "").trim();
        if (!content) throw new Error("No readable text found in this file.");

        appState.hasBookLoaded = true;
        appState.currentFileType = parsed.type;
        appState.currentFileName = file.name;
        appState.currentBookId = buildBookId(file);
        appState.readingStartIndex = 0;
        appState.currentBookText = content;

        if (parsed.type === "pdf") {
            appState.pdfPages = parsed.pages || [];
            renderBookText(content);
            buildPdfChapters();
            renderChapterList();
            appState.readingStartIndex = 0;
            updateStartPositionLabel();
            document.getElementById("progressFill").style.width = "0%";
        } else {
            appState.pdfPages = [];
            renderBookText(content);
            buildTextChapters(content);
            renderChapterList();
            appState.readingStartIndex = 0;
            updateStartPositionLabel();
            document.getElementById("progressFill").style.width = "0%";
        }

        const saved = readingPosition.loadPosition(appState.currentBookId);
        if (saved) applySavedPosition(saved);
        if (appState.pendingRecentBookId && appState.pendingRecentBookId === appState.currentBookId) {
            const pending = readingPosition.loadPosition(appState.pendingRecentBookId);
            if (pending) applySavedPosition(pending);
            appState.pendingRecentBookId = null;
        }

        readingPosition.showRecentBooks();
        bookmarkSystem.displayBookmarks();
    } catch (error) {
        console.error("Error reading file:", error);
        alert(error.message || "Error reading file. Please try again.");
    } finally {
        hideLoading();
        queueReaderPanelHeightSync();
    }
}

function readAloud() {
    const text = getCurrentReadableText();
    if (!appState.hasBookLoaded || !text || text === PLACEHOLDER_TEXT) {
        alert("Please upload a book before starting read aloud.");
        return;
    }
    voiceManager.readBook(text, appState.readingStartIndex);
}

function pauseReading() {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        autoScroll.stopAutoScroll();
        speedTraining.recordPause();
        saveCurrentPosition();
    }
}

function resumeReading() {
    if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        autoScroll.startAutoScroll();
    }
}

function stopReading() {
    voiceManager.stopRequested = true;
    voiceManager.readSessionId += 1;
    emotionalReading.cancel();
    window.speechSynthesis.cancel();
    voiceManager.stopProgressFallback();
    autoScroll.stopAutoScroll();
    voiceManager.clearHighlight();
    voiceManager.currentUtterance = null;
    document.getElementById("voiceWave").style.display = "none";
    saveCurrentPosition();
}

function seekToPosition(event) {
    const text = getCurrentReadableText();
    if (!text) return;
    const progressBar = document.getElementById("progressBar");
    const rect = progressBar.getBoundingClientRect();
    const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setReadingStartIndex(Math.floor(text.length * percent));
    if (window.speechSynthesis.speaking || window.speechSynthesis.paused) {
        stopReading();
        readAloud();
    }
}

function skipByPercent(deltaPercent) {
    const text = getCurrentReadableText();
    if (!text) return;
    const delta = Math.floor(text.length * deltaPercent);
    setReadingStartIndex(appState.readingStartIndex + delta);
    if (window.speechSynthesis.speaking || window.speechSynthesis.paused) {
        stopReading();
        readAloud();
    }
}

function adjustRate(delta) {
    const input = document.getElementById("rate");
    const next = clamp(parseFloat(input.value) + delta, 0.5, 2.0);
    input.value = next.toFixed(1);
    document.getElementById("rateValue").innerText = `${next.toFixed(1)}x`;
}

function handleKeyboardShortcuts(event) {
    const target = event.target;
    const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key === " ") {
        event.preventDefault();
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) pauseReading();
        else if (window.speechSynthesis.paused) resumeReading();
        else readAloud();
        return;
    }

    if (event.key === "Escape") {
        event.preventDefault();
        stopReading();
        return;
    }

    if (isTyping && !(event.ctrlKey && ["s", "b", "f"].includes(event.key.toLowerCase()))) return;

    if (event.ctrlKey && event.key === "ArrowRight") {
        event.preventDefault();
        skipByPercent(0.1);
    } else if (event.ctrlKey && event.key === "ArrowLeft") {
        event.preventDefault();
        skipByPercent(-0.1);
    } else if (event.ctrlKey && event.key === "ArrowUp") {
        event.preventDefault();
        adjustRate(0.1);
    } else if (event.ctrlKey && event.key === "ArrowDown") {
        event.preventDefault();
        adjustRate(-0.1);
    } else if (event.ctrlKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        addBookmark();
    } else if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        toggleQuickNav();
        const search = document.getElementById("searchInput");
        if (search) search.focus();
    } else if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveCurrentPosition();
        readingPosition.showRecentBooks();
    }
}

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const bookContent = document.getElementById("bookContent");
const leftColumn = document.querySelector(".left-column");
const readerPanel = document.querySelector(".reader-panel");
const installAppBtn = document.getElementById("installAppBtn");
let scrollInactivityTimer = null;
let readerHeightRaf = null;
let deferredInstallPrompt = null;

function syncReaderPanelHeight() {
    if (!leftColumn || !readerPanel) return;
    if (window.matchMedia("(max-width: 1260px)").matches) {
        readerPanel.style.height = "";
        readerPanel.style.maxHeight = "";
        return;
    }
    const leftHeight = Math.ceil(leftColumn.getBoundingClientRect().height);
    if (leftHeight <= 0) return;
    readerPanel.style.height = `${leftHeight}px`;
    readerPanel.style.maxHeight = `${leftHeight}px`;
}

function queueReaderPanelHeightSync() {
    if (readerHeightRaf) cancelAnimationFrame(readerHeightRaf);
    readerHeightRaf = requestAnimationFrame(() => {
        readerHeightRaf = null;
        syncReaderPanelHeight();
    });
}

function setupInstallPrompt() {
    if (!installAppBtn) return;
    if (window.matchMedia("(display-mode: standalone)").matches) {
        installAppBtn.style.display = "none";
    }

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        installAppBtn.style.display = "inline-flex";
    });

    installAppBtn.addEventListener("click", async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        try {
            await deferredInstallPrompt.userChoice;
        } catch (error) {
            // no-op
        }
        deferredInstallPrompt = null;
        installAppBtn.style.display = "none";
    });

    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        installAppBtn.style.display = "none";
    });
}

function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch((error) => {
            console.warn("Service worker registration failed:", error);
        });
    });
}

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
    const file = event.dataTransfer.files[0];
    if (file) await processFile(file);
});

fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) await processFile(file);
});

bookContent.addEventListener("click", (event) => {
    const text = getCurrentReadableText();
    if (!text) return;
    const index = getCharIndexFromPoint(bookContent, event.clientX, event.clientY);
    if (index !== null) setReadingStartIndex(index);
});

bookContent.addEventListener("scroll", () => {
    bookContent.classList.add("scrolling");
    clearTimeout(scrollInactivityTimer);
    scrollInactivityTimer = setTimeout(() => {
        bookContent.classList.remove("scrolling");
    }, 700);
});

document.getElementById("rate").addEventListener("input", (event) => {
    document.getElementById("rateValue").innerText = `${event.target.value}x`;
    queueReaderPanelHeightSync();
});

document.addEventListener("keydown", handleKeyboardShortcuts);
window.addEventListener("resize", queueReaderPanelHeightSync);

if (leftColumn && "ResizeObserver" in window) {
    const leftColumnResizeObserver = new ResizeObserver(() => {
        queueReaderPanelHeightSync();
    });
    leftColumnResizeObserver.observe(leftColumn);
}

readingPosition.showRecentBooks();
bookmarkSystem.displayBookmarks();
showShortcuts();
document.getElementById("shortcutsPanel").style.display = "none";
voiceManager.initialize().then(() => {
    queueReaderPanelHeightSync();
});
dictionaryLookup.showDefinition();
updateStartPositionLabel();
queueReaderPanelHeightSync();
setupInstallPrompt();
registerServiceWorker();

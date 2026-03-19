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
    autoScrollEnabled: false,
    iosPlaybackActive: false,
    iosPlaybackSessionId: 0,
    iosPlaybackNextIndex: 0,
    iosPlaybackChunkStart: 0
};

const isiPhoneLikeDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) && !window.MSStream;
const isiPadOSDevice = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
const isIOSDevice = isiPhoneLikeDevice || isiPadOSDevice;
const IOS_EDGE_WINDOW_CHARS = 4200;

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
    updateChapterSelection();
    scrollBookToIndex(appState.readingStartIndex, text.length);
    saveCurrentPosition();
}

function updateChapterSelection() {
    if (!appState.chapters.length) return;
    const current = Math.max(0, Math.floor(appState.readingStartIndex || 0));
    let activeChapterIndex = appState.chapters[0].index;
    appState.chapters.forEach((chapter) => {
        if (chapter.index <= current) activeChapterIndex = chapter.index;
    });
    document.querySelectorAll("[data-chapter-index]").forEach((item) => {
        const itemIndex = Number(item.dataset.chapterIndex);
        const isActive = itemIndex === activeChapterIndex;
        item.classList.toggle("active", isActive);
        if (isActive && item.closest("#readerPageList")) {
            item.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
    });
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

// ==================== MICROSOFT EDGE TTS FOR IOS ====================
class EdgeTTS {
    constructor() {
        this.ws = null;
        this.audioContext = null;
        this.currentSource = null;
        this.audioQueue = [];
        this.isSpeaking = false;
        this.isPlayingChunk = false;
        this.audioStarted = false;
        this.receivedAudioChunk = false;
        this.currentText = "";
        this.audioWatchdog = null;
        this.currentVoice = "en-US-JennyNeural";
        this.rate = 1.0;
        this.onStart = null;
        this.onEnd = null;
        this.onBoundary = null;

        this.availableVoices = [
            { id: "en-US-JennyNeural", name: "Jenny (US Female)", desc: "Warm, natural, best for novels" },
            { id: "en-US-GuyNeural", name: "Guy (US Male)", desc: "Deep, authoritative, clear" },
            { id: "en-US-AriaNeural", name: "Aria (US Female)", desc: "Energetic, expressive" },
            { id: "en-US-ChristopherNeural", name: "Christopher (US Male)", desc: "Friendly, conversational" },
            { id: "en-US-EricNeural", name: "Eric (US Male)", desc: "Professional, calm" },
            { id: "en-GB-SoniaNeural", name: "Sonia (UK Female)", desc: "British, elegant, warm" },
            { id: "en-GB-RyanNeural", name: "Ryan (UK Male)", desc: "British, professional" },
            { id: "en-AU-NatashaNeural", name: "Natasha (AU Female)", desc: "Australian, friendly" }
        ];
    }

    async primeAudioContext() {
        if (!this.audioContext || this.audioContext.state === "closed") {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === "suspended") {
            try {
                await this.audioContext.resume();
            } catch (error) {
                // iOS can reject resume before a trusted gesture; we retry on the next tap.
            }
        }
    }

    async speak(text, voiceId = this.currentVoice, rate = 1.0) {
        if (!text || text.length < 10) return;

        this.stop(true);
        await this.primeAudioContext();
        this.currentText = text;
        this.currentVoice = voiceId;
        this.rate = rate;
        this.audioQueue = [];
        this.isSpeaking = true;
        this.isPlayingChunk = false;
        this.audioStarted = false;
        this.receivedAudioChunk = false;

        try {
            const ws = new WebSocket("wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4");
            this.ws = ws;

            ws.onopen = () => {
                const config = {
                    context: {
                        synthesis: {
                            audio: {
                                metadataoptions: {
                                    sentenceBoundaryEnabled: false,
                                    wordBoundaryEnabled: true
                                },
                                outputFormat: "audio-24khz-48kbitrate-mono-mp3"
                            }
                        }
                    }
                };

                ws.send(JSON.stringify({
                    command: "synthesis.context",
                    config
                }));

                const chunks = this.splitText(text, 300);
                chunks.forEach((chunk, index) => {
                    ws.send(JSON.stringify({
                        command: "synthesis.chunk",
                        chunk: {
                            text: chunk,
                            voice: voiceId,
                            rate,
                            pitch: "0%",
                            volume: "0%"
                        },
                        id: index
                    }));
                });

                clearTimeout(this.audioWatchdog);
                this.audioWatchdog = window.setTimeout(() => {
                    if (this.isSpeaking && !this.receivedAudioChunk && !this.audioStarted) {
                        this.fallbackToSystemVoice(text, rate);
                    }
                }, 1800);
            };

            ws.onmessage = (event) => {
                if (event.data instanceof Blob) {
                    event.data.arrayBuffer().then((buffer) => {
                        if (!this.isSpeaking) return;
                        this.receivedAudioChunk = true;
                        this.audioQueue.push(buffer);
                        this.playNext();
                    }).catch(() => {});
                    return;
                }
                if (event.data instanceof ArrayBuffer) {
                    this.receivedAudioChunk = true;
                    this.audioQueue.push(event.data);
                    this.playNext();
                    return;
                }
                if (typeof event.data !== "string") return;

                let data;
                try {
                    data = JSON.parse(event.data);
                } catch (e) {
                    return;
                }

                if (data.command === "audio.metadata") {
                    if (this.onBoundary && data.metadata && Array.isArray(data.metadata.words)) {
                        data.metadata.words.forEach((word) => {
                            this.onBoundary(word.text, word.offset, word.duration);
                        });
                    }
                } else if (data.command === "audio.output" && data.audio) {
                    this.receivedAudioChunk = true;
                    const audioData = this.base64ToArrayBuffer(data.audio);
                    this.audioQueue.push(audioData);
                    this.playNext();
                } else if (data.command === "synthesis.end") {
                    if (!this.receivedAudioChunk && !this.audioStarted) {
                        this.fallbackToSystemVoice(text, rate);
                        return;
                    }
                    this.finish();
                }
            };

            ws.onerror = (error) => {
                console.error("Edge TTS WebSocket error:", error);
                this.fallbackToSystemVoice(text, rate);
            };

            ws.onclose = () => {
                if (this.isSpeaking && !this.receivedAudioChunk && !this.audioStarted) {
                    this.fallbackToSystemVoice(text, rate);
                    return;
                }
                if (!this.audioQueue.length && !this.isPlayingChunk) {
                    this.finish();
                }
            };
        } catch (error) {
            console.error("Edge TTS failed:", error);
            this.fallbackToSystemVoice(text, rate);
        }
    }

    playNext() {
        if (!this.isSpeaking || this.isPlayingChunk || this.audioQueue.length === 0) return;

        if (!this.audioContext || this.audioContext.state === "closed") {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (this.audioContext.state === "suspended") {
            this.audioContext.resume()
                .then(() => this.playNext())
                .catch(() => {});
            this.isPlayingChunk = false;
            return;
        }

        const audioData = this.audioQueue.shift();
        this.isPlayingChunk = true;

        this.audioContext.decodeAudioData(audioData.slice(0), (buffer) => {
            if (!this.isSpeaking || !this.audioContext) {
                this.isPlayingChunk = false;
                return;
            }

            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioContext.destination);
            this.currentSource = source;

            source.onended = () => {
                if (this.currentSource === source) this.currentSource = null;
                this.isPlayingChunk = false;
                if (!this.isSpeaking && !this.audioQueue.length) {
                    this.finish();
                    return;
                }
                this.playNext();
            };

            if (!this.audioStarted) {
                this.audioStarted = true;
                if (this.onStart) this.onStart();
            }
            source.start();
        }, () => {
            this.isPlayingChunk = false;
            this.playNext();
        });
    }

    splitText(text, maxLength) {
        const chunks = [];
        let start = 0;

        while (start < text.length) {
            let end = Math.min(start + maxLength, text.length);

            if (end < text.length) {
                const periodPos = text.lastIndexOf(". ", end);
                const questionPos = text.lastIndexOf("? ", end);
                const exclaimPos = text.lastIndexOf("! ", end);
                const newlinePos = text.lastIndexOf("\n\n", end);

                const breakPos = Math.max(periodPos, questionPos, exclaimPos, newlinePos);
                if (breakPos > start) {
                    end = breakPos + 1;
                } else {
                    const lastSpace = text.lastIndexOf(" ", end);
                    if (lastSpace > start) end = lastSpace;
                }
            }

            chunks.push(text.slice(start, end));
            start = end;
        }

        return chunks;
    }

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    finish() {
        if (!this.isSpeaking) return;
        if (!this.audioStarted && this.currentText) {
            this.fallbackToSystemVoice(this.currentText, this.rate);
            return;
        }
        this.isSpeaking = false;
        clearTimeout(this.audioWatchdog);
        this.audioWatchdog = null;

        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            this.ws.close();
            this.ws = null;
        }

        if (this.onEnd) this.onEnd();
    }

    stop(keepAudioContext = false) {
        this.isSpeaking = false;
        this.isPlayingChunk = false;
        this.audioStarted = false;
        this.receivedAudioChunk = false;
        clearTimeout(this.audioWatchdog);
        this.audioWatchdog = null;

        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch (error) {
                // ignore
            }
            try {
                this.currentSource.disconnect();
            } catch (error) {
                // ignore
            }
            this.currentSource = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (!keepAudioContext && this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }

        this.audioQueue = [];
    }

    fallbackToSystemVoice(text, rate) {
        console.warn("Edge TTS unavailable, using system voice");
        this.stop(true);
        this.isSpeaking = true;
        this.audioStarted = false;
        this.receivedAudioChunk = true;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);

        const voices = window.speechSynthesis.getVoices();
        const decentVoice = voices.find((v) =>
            v.name.includes("Samantha") ||
            v.name.includes("Allison") ||
            v.name.includes("Aaron")
        );

        if (decentVoice) utterance.voice = decentVoice;
        utterance.rate = rate;
        utterance.onstart = () => {
            this.audioStarted = true;
            if (this.onStart) this.onStart();
        };
        utterance.onend = () => {
            this.isSpeaking = false;
            if (this.onEnd) this.onEnd();
        };
        utterance.onerror = () => {
            this.isSpeaking = false;
            if (this.onEnd) this.onEnd();
        };
        window.speechSynthesis.speak(utterance);
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

        this.isIOS = isIOSDevice;

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
        const voiceGridDesktop = document.getElementById("voiceGrid");
        const voiceGridMobile = document.getElementById("voiceGridMobile");
        const grids = [voiceGridDesktop, voiceGridMobile].filter(Boolean);
        if (!grids.length) return;

        if (this.isIOS && edgeTTS && Array.isArray(edgeTTS.availableVoices) && edgeTTS.availableVoices.length) {
            setupIOSVoiceGrid();
            return;
        }

        let voicesToShow = [];
        if (this.isIOS) {
            voicesToShow = this.voices.filter((v) => ((v.lang || "").startsWith("en")));
            if (voicesToShow.length === 0) voicesToShow = this.voices;
        } else {
            voicesToShow = (this.allowedVoiceNames || [])
                .map((name) => this.voices.find((v) => v.name === name))
                .filter(Boolean);
        }

        if (voicesToShow.length === 0) {
            grids.forEach((grid) => {
                grid.innerHTML = `<div class="voice-desc">No suitable voices found.</div>`;
            });
            this.selectedVoice = null;
            return;
        }

        let html = "";
        voicesToShow.forEach((voice) => {
            const badgeClass = this.isIOS ? "badge-standard" : "badge-premium";
            const badgeText = this.isIOS ? "IOS VOICE" : "GOOGLE PREMIUM";

            html += `<div class="voice-card" data-voice-name="${voice.name}">
                <div class="voice-name">${voice.name}</div>
                <div class="voice-desc">${voice.lang} - ${voice.localService ? "Local" : "Cloud"}</div>
                <div class="voice-badge ${badgeClass}">${badgeText}</div>
            </div>`;
        });
        grids.forEach((grid) => {
            grid.innerHTML = html;
        });

        document.querySelectorAll("#voiceGrid .voice-card, #voiceGridMobile .voice-card").forEach((card) => {
            card.addEventListener("click", () => this.selectVoice(card.dataset.voiceName));
        });

        const defaultVoice = voicesToShow[0];
        if (defaultVoice) {
            this.selectVoice(defaultVoice.name, false);
        }
    }

    selectVoice(voiceName, shouldTest = true) {
        this.selectedVoice = this.voices.find((voice) => voice.name === voiceName) || null;
        document.querySelectorAll(".voice-card").forEach((card) => {
            card.classList.remove("selected");
            if (card.dataset.voiceName === voiceName) card.classList.add("selected");
        });
        closeHeaderMenus();
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
        // Highlight is intentionally disabled.
        void currentCharIndex;
    }

    updateProgress(currentCharIndex) {
        this.currentAbsoluteChar = clamp(currentCharIndex, 0, Math.max(this.totalLength - 1, 0));
        appState.readingStartIndex = this.currentAbsoluteChar;
        const progress = (this.currentAbsoluteChar / Math.max(this.totalLength, 1)) * 100;
        document.getElementById("progressFill").style.width = `${clamp(progress, 0, 100)}%`;
        updateStartPositionLabel();
        updateChapterSelection();
        scrollBookToIndex(this.currentAbsoluteChar, Math.max(this.totalLength, 1));
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
let edgeTTS = null;

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
    const quickNavHolder = document.getElementById("chapterList");
    const readerHolder = document.getElementById("readerPageList");
    if (!quickNavHolder && !readerHolder) return;

    if (!appState.chapters.length) {
        if (quickNavHolder) quickNavHolder.innerHTML = `<div class="voice-desc">No chapters detected.</div>`;
        if (readerHolder) readerHolder.innerHTML = `<div class="voice-desc">No pages yet.</div>`;
        return;
    }

    if (quickNavHolder) {
        let quickHtml = "";
        appState.chapters.forEach((chapter) => {
            quickHtml += `<div data-chapter-index="${chapter.index}" onclick="jumpToChapter(${chapter.index})">${escapeHtml(chapter.title)}</div>`;
        });
        quickNavHolder.innerHTML = quickHtml;
    }

    if (readerHolder) {
        let readerHtml = "";
        appState.chapters.forEach((chapter, idx) => {
            const pageNumber = idx + 1;
            readerHtml += `<button class="reader-page-item" type="button" data-chapter-index="${chapter.index}" aria-label="${escapeHtml(chapter.title)}" title="${escapeHtml(chapter.title)}" onclick="jumpToChapter(${chapter.index})">${pageNumber}</button>`;
        });
        readerHolder.innerHTML = readerHtml;
    }

    updateChapterSelection();
}

function jumpToChapter(target) {
    setReadingStartIndex(target);
    if (isAnyReaderPlaybackActive()) {
        stopReading();
        readAloud();
    }
}

function closeHeaderMenus(exceptId = null) {
    ["voicesMenu", "playMenu", "toolsMenu", "settingsMenu"].forEach((id) => {
        if (id === exceptId) return;
        const menu = document.getElementById(id);
        if (menu) menu.classList.remove("open");
    });
}

function toggleHeaderMenu(menuId, event) {
    if (event) event.stopPropagation();
    const target = document.getElementById(menuId);
    if (!target) return;
    const shouldOpen = !target.classList.contains("open");
    closeHeaderMenus();
    target.classList.toggle("open", shouldOpen);
}

function playbackMenuAction(action) {
    closeHeaderMenus();
    if (action === "start") {
        readAloud();
        return;
    }
    if (action === "pause") {
        pauseReading();
        return;
    }
    if (action === "resume") {
        resumeReading();
        return;
    }
    if (action === "stop") {
        stopReading();
    }
}

function openUploadPage() {
    const page = document.getElementById("uploadPage");
    if (!page) return;
    page.classList.add("active");
    closeHeaderMenus();
    const quickNav = document.getElementById("quickNav");
    const shortcuts = document.getElementById("shortcutsPanel");
    if (quickNav) quickNav.style.display = "none";
    if (shortcuts) shortcuts.style.display = "none";
}

function closeUploadPage() {
    const page = document.getElementById("uploadPage");
    if (!page) return;
    page.classList.remove("active");
}

function focusReaderPanel() {
    const panel = document.querySelector(".reader-panel");
    if (!panel) return;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getIOSPlaybackWindow(sourceText, startIndex) {
    if (!sourceText) return null;
    const safeStart = clamp(Math.floor(startIndex), 0, Math.max(sourceText.length - 1, 0));
    let endIndex = Math.min(safeStart + IOS_EDGE_WINDOW_CHARS, sourceText.length);
    if (endIndex < sourceText.length) {
        const slice = sourceText.slice(safeStart, endIndex);
        const breakAt = Math.max(
            slice.lastIndexOf("\n\n"),
            slice.lastIndexOf(". "),
            slice.lastIndexOf("? "),
            slice.lastIndexOf("! "),
            slice.lastIndexOf("; ")
        );
        if (breakAt > Math.floor(IOS_EDGE_WINDOW_CHARS * 0.45)) {
            endIndex = safeStart + breakAt + 1;
        } else {
            const lastSpace = slice.lastIndexOf(" ");
            if (lastSpace > Math.floor(IOS_EDGE_WINDOW_CHARS * 0.45)) endIndex = safeStart + lastSpace;
        }
    }
    if (endIndex <= safeStart) endIndex = Math.min(safeStart + Math.max(1200, Math.floor(IOS_EDGE_WINDOW_CHARS * 0.7)), sourceText.length);
    const windowText = sourceText.slice(safeStart, endIndex).trim();
    if (!windowText) return null;
    return { windowText, endIndex };
}

function playIOSPlaybackChunk(sessionId, startIndex) {
    if (!isIOSDevice || !edgeTTS || !appState.iosPlaybackActive || sessionId !== appState.iosPlaybackSessionId) return;
    const text = getCurrentReadableText();
    if (!text || text === PLACEHOLDER_TEXT) {
        appState.iosPlaybackActive = false;
        return;
    }

    const windowPayload = getIOSPlaybackWindow(text, startIndex);
    if (!windowPayload) {
        appState.iosPlaybackActive = false;
        const wave = document.getElementById("voiceWave");
        if (wave) wave.style.display = "none";
        return;
    }

    appState.iosPlaybackChunkStart = clamp(Math.floor(startIndex), 0, Math.max(text.length - 1, 0));
    appState.iosPlaybackNextIndex = clamp(windowPayload.endIndex, 0, text.length);
    appState.readingStartIndex = appState.iosPlaybackChunkStart;
    voiceManager.totalLength = text.length;
    voiceManager.updateProgress(appState.iosPlaybackChunkStart);
    updateStartPositionLabel();
    updateChapterSelection();
    edgeTTS.speak(windowPayload.windowText, edgeTTS.currentVoice, parseFloat(document.getElementById("rate").value));
}

function continueIOSPlayback() {
    if (!isIOSDevice || !edgeTTS || !appState.iosPlaybackActive) {
        const wave = document.getElementById("voiceWave");
        if (wave) wave.style.display = "none";
        autoScroll.stopAutoScroll();
        return;
    }
    const text = getCurrentReadableText();
    if (text && text.length) {
        const reachedIndex = clamp(Math.floor(appState.iosPlaybackNextIndex || 0), 0, Math.max(text.length - 1, 0));
        voiceManager.totalLength = text.length;
        voiceManager.updateProgress(reachedIndex);
    }
    if (!text || appState.iosPlaybackNextIndex >= text.length) {
        appState.iosPlaybackActive = false;
        autoScroll.stopAutoScroll();
        const wave = document.getElementById("voiceWave");
        if (wave) wave.style.display = "none";
        if (text && text.length) {
            appState.readingStartIndex = text.length - 1;
            voiceManager.totalLength = text.length;
            voiceManager.updateProgress(text.length - 1);
            updateStartPositionLabel();
            updateChapterSelection();
        }
        speedTraining.adaptiveSpeed();
        return;
    }
    const activeSession = appState.iosPlaybackSessionId;
    const nextStart = appState.iosPlaybackNextIndex;
    window.setTimeout(() => {
        if (!appState.iosPlaybackActive || appState.iosPlaybackSessionId !== activeSession) return;
        playIOSPlaybackChunk(activeSession, nextStart);
    }, 24);
}

function setupIOSEdgeTTS() {
    if (!isIOSDevice) return;
    edgeTTS = new EdgeTTS();
    edgeTTS.onStart = () => {
        const wave = document.getElementById("voiceWave");
        if (wave) wave.style.display = "flex";
    };
    edgeTTS.onEnd = () => {
        continueIOSPlayback();
    };
    edgeTTS.onBoundary = () => {
        // Word boundary offsets from this transport are not reliable char indexes.
    };
    setTimeout(setupIOSVoiceGrid, 500);
}

function setupIOSVoiceGrid() {
    if (!isIOSDevice || !edgeTTS) return;

    const voiceGrid = document.getElementById("voiceGrid");
    const voiceGridMobile = document.getElementById("voiceGridMobile");
    if (!voiceGrid && !voiceGridMobile) return;

    let html = "";
    edgeTTS.availableVoices.forEach((voice) => {
        const isDefault = voice.id === edgeTTS.currentVoice;
        html += `
            <div class="voice-card ${isDefault ? "selected" : ""}" data-edge-voice="${voice.id}">
                <div class="voice-name">${voice.name}</div>
                <div class="voice-desc">${voice.desc}</div>
                <div class="voice-badge badge-neural">EDGE NEURAL</div>
            </div>
        `;
    });

    if (voiceGrid) voiceGrid.innerHTML = html;
    if (voiceGridMobile) voiceGridMobile.innerHTML = html;

    document.querySelectorAll("[data-edge-voice]").forEach((card) => {
        card.addEventListener("click", () => {
            appState.iosPlaybackActive = false;
            appState.iosPlaybackSessionId += 1;
            document.querySelectorAll("[data-edge-voice]").forEach((c) => c.classList.remove("selected"));
            card.classList.add("selected");
            edgeTTS.currentVoice = card.dataset.edgeVoice;
            edgeTTS.speak("Hello, I am ready to read your book.", card.dataset.edgeVoice, 0.9);
            closeHeaderMenus();
        });
    });
}

function iosReadAloud() {
    const text = getCurrentReadableText();
    if (!edgeTTS || !appState.hasBookLoaded || !text || text === PLACEHOLDER_TEXT) {
        alert("Please upload a book first.");
        return;
    }

    appState.iosPlaybackSessionId += 1;
    appState.iosPlaybackActive = true;
    window.speechSynthesis.cancel();
    const safeStart = clamp(Math.floor(appState.readingStartIndex || 0), 0, Math.max(text.length - 1, 0));
    appState.iosPlaybackNextIndex = safeStart;
    const activeSession = appState.iosPlaybackSessionId;
    edgeTTS.primeAudioContext().finally(() => {
        if (!appState.iosPlaybackActive || appState.iosPlaybackSessionId !== activeSession) return;
        playIOSPlaybackChunk(activeSession, safeStart);
    });
    closeHeaderMenus();
}

function isAnyReaderPlaybackActive() {
    const edgeSpeaking = Boolean(isIOSDevice && edgeTTS && (edgeTTS.isSpeaking || appState.iosPlaybackActive));
    return edgeSpeaking || window.speechSynthesis.speaking || window.speechSynthesis.paused;
}

function toggleQuickNav() {
    const panel = document.getElementById("quickNav");
    const shouldOpen = panel.style.display === "none";
    panel.style.display = shouldOpen ? "block" : "none";
    if (shouldOpen) closeHeaderMenus();
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
    const shouldOpen = panel.style.display === "none";
    panel.style.display = shouldOpen ? "block" : "none";
    if (shouldOpen) closeHeaderMenus();
}

function toggleEmotionMode() {
    appState.emotionMode = !appState.emotionMode;
    const isOn = appState.emotionMode;
    const primary = document.getElementById("emotionToggle");
    if (primary) {
        primary.classList.toggle("mode-on", isOn);
        primary.innerHTML = `<span>Mood</span> ${isOn ? "Emotion On" : "Emotion Off"}`;
    }
    document.querySelectorAll(".emotion-toggle").forEach((button) => {
        button.classList.toggle("mode-on", isOn);
        if (button.id === "emotionToggle") return;
        button.innerText = `Mood Emotion ${isOn ? "On" : "Off"}`;
    });
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
    if (isAnyReaderPlaybackActive()) {
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
    appState.iosPlaybackActive = false;
    appState.iosPlaybackSessionId += 1;
    if (edgeTTS) edgeTTS.stop();
    window.speechSynthesis.cancel();
    autoScroll.stopAutoScroll();
    voiceManager.stopProgressFallback();
    voiceManager.clearHighlight();
    document.getElementById("voiceWave").style.display = "none";

    const maxSizeBytes = 100 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
        alert("File is too large. Maximum allowed size is 100MB.");
        return;
    }

    const extension = (file.name.split(".").pop() || "").toUpperCase();
    document.querySelectorAll("[data-upload-icon]").forEach((icon) => {
        icon.innerText = extension || "TXT";
    });

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
        closeUploadPage();
        closeHeaderMenus();
        focusReaderPanel();
    } catch (error) {
        console.error("Error reading file:", error);
        alert(error.message || "Error reading file. Please try again.");
    } finally {
        hideLoading();
        queueReaderPanelHeightSync();
    }
}

function readAloud() {
    closeHeaderMenus();
    const text = getCurrentReadableText();
    if (!appState.hasBookLoaded || !text || text === PLACEHOLDER_TEXT) {
        alert("Please upload a book before starting read aloud.");
        return;
    }

    if (isIOSDevice && edgeTTS) {
        iosReadAloud();
        return;
    }

    voiceManager.readBook(text, appState.readingStartIndex);
}

function pauseReading() {
    closeHeaderMenus();
    if (isIOSDevice && edgeTTS && (edgeTTS.isSpeaking || appState.iosPlaybackActive)) {
        appState.iosPlaybackActive = false;
        appState.iosPlaybackSessionId += 1;
        edgeTTS.stop();
        autoScroll.stopAutoScroll();
        document.getElementById("voiceWave").style.display = "none";
        saveCurrentPosition();
        return;
    }

    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        autoScroll.stopAutoScroll();
        speedTraining.recordPause();
        saveCurrentPosition();
    }
}

function resumeReading() {
    closeHeaderMenus();
    if (isIOSDevice && edgeTTS) {
        iosReadAloud();
        return;
    }

    if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
    }
}

function stopReading() {
    closeHeaderMenus();
    appState.iosPlaybackActive = false;
    if (isIOSDevice && edgeTTS) {
        appState.iosPlaybackSessionId += 1;
        edgeTTS.stop();
        window.speechSynthesis.cancel();
        voiceManager.stopRequested = true;
        voiceManager.readSessionId += 1;
        emotionalReading.cancel();
        voiceManager.stopProgressFallback();
        autoScroll.stopAutoScroll();
        voiceManager.clearHighlight();
        voiceManager.currentUtterance = null;
        document.getElementById("voiceWave").style.display = "none";
        saveCurrentPosition();
        return;
    }

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
    if (isAnyReaderPlaybackActive()) {
        stopReading();
        readAloud();
    }
}

function skipByPercent(deltaPercent) {
    const text = getCurrentReadableText();
    if (!text) return;
    const delta = Math.floor(text.length * deltaPercent);
    setReadingStartIndex(appState.readingStartIndex + delta);
    if (isAnyReaderPlaybackActive()) {
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

    if (event.key === "Escape" && uploadPage && uploadPage.classList.contains("active")) {
        event.preventDefault();
        closeUploadPage();
        return;
    }

    if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key === " ") {
        event.preventDefault();
        if (isIOSDevice && edgeTTS && (edgeTTS.isSpeaking || appState.iosPlaybackActive)) pauseReading();
        else if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) pauseReading();
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
const dropZoneFull = document.getElementById("dropZoneFull");
const fileInput = document.getElementById("fileInput");
const bookContent = document.getElementById("bookContent");
const readerPageList = document.getElementById("readerPageList");
const leftColumn = document.querySelector(".left-column");
const readerPanel = document.querySelector(".reader-panel");
const installAppBtn = document.getElementById("installAppBtn");
const engineHeader = document.getElementById("engineHeader");
const quickNavPanel = document.getElementById("quickNav");
const shortcutsPanel = document.getElementById("shortcutsPanel");
const uploadPage = document.getElementById("uploadPage");
let scrollInactivityTimer = null;
let pageListScrollInactivityTimer = null;
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

if (dropZoneFull) {
    dropZoneFull.addEventListener("click", () => fileInput.click());
    dropZoneFull.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropZoneFull.classList.add("dragover");
    });
    dropZoneFull.addEventListener("dragleave", () => dropZoneFull.classList.remove("dragover"));
    dropZoneFull.addEventListener("drop", async (event) => {
        event.preventDefault();
        dropZoneFull.classList.remove("dragover");
        const file = event.dataTransfer.files[0];
        if (file) await processFile(file);
    });
}

fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) await processFile(file);
    event.target.value = "";
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

if (readerPageList) {
    readerPageList.addEventListener("scroll", () => {
        readerPageList.classList.add("scrolling");
        clearTimeout(pageListScrollInactivityTimer);
        pageListScrollInactivityTimer = setTimeout(() => {
            readerPageList.classList.remove("scrolling");
        }, 700);
    });
}

document.getElementById("rate").addEventListener("input", (event) => {
    document.getElementById("rateValue").innerText = `${event.target.value}x`;
    queueReaderPanelHeightSync();
});

document.addEventListener("keydown", handleKeyboardShortcuts);
window.addEventListener("resize", queueReaderPanelHeightSync);

document.addEventListener("click", (event) => {
    const target = event.target;

    if (engineHeader && !engineHeader.contains(target)) {
        closeHeaderMenus();
    }

    if (
        quickNavPanel &&
        quickNavPanel.style.display !== "none" &&
        !quickNavPanel.contains(target) &&
        !target.closest("[data-open-quicknav]")
    ) {
        quickNavPanel.style.display = "none";
    }

    if (
        shortcutsPanel &&
        shortcutsPanel.style.display !== "none" &&
        !shortcutsPanel.contains(target) &&
        !target.closest("[data-open-shortcuts]")
    ) {
        shortcutsPanel.style.display = "none";
    }
});

document.querySelectorAll(".engine-dropdown .mini-btn").forEach((button) => {
    button.addEventListener("click", () => {
        window.setTimeout(() => closeHeaderMenus(), 0);
    });
});

if (uploadPage) {
    uploadPage.addEventListener("click", (event) => {
        if (event.target === uploadPage) closeUploadPage();
    });
}

if (leftColumn && "ResizeObserver" in window) {
    const leftColumnResizeObserver = new ResizeObserver(() => {
        queueReaderPanelHeightSync();
    });
    leftColumnResizeObserver.observe(leftColumn);
}

readingPosition.showRecentBooks();
bookmarkSystem.displayBookmarks();
if (shortcutsPanel) shortcutsPanel.style.display = "none";
setupIOSEdgeTTS();
voiceManager.initialize().then(() => {
    queueReaderPanelHeightSync();
});
dictionaryLookup.showDefinition();
updateStartPositionLabel();
renderChapterList();
queueReaderPanelHeightSync();
setupInstallPrompt();
registerServiceWorker();

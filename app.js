// ================= CONFIGURATION =================
const CONFIG = {
  quotes: [
    {text: "The future depends on what you do today.", author: "Mahatma Gandhi"},
    {text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson"},
    {text: "Time is what we want most, but what we use worst.", author: "William Penn"},
    {text: "Your time is limited, don't waste it living someone else's life.", author: "Steve Jobs"},
    {text: "The key is in not spending time, but in investing it.", author: "Stephen R. Covey"},
    {text: "Lost time is never found again.", author: "Benjamin Franklin"},
    {text: "The two most powerful warriors are patience and time.", author: "Leo Tolstoy"},
    {text: "Time you enjoy wasting is not wasted time.", author: "Marthe Troly-Curtin"},
    {text: "Better three hours too soon than a minute too late.", author: "William Shakespeare"},
    {text: "Time is the most valuable thing a man can spend.", author: "Theophrastus"},
    {text: "The present time has one advantage over every other - it is our own.", author: "Charles Caleb Colton"},
    {text: "Time is the school in which we learn, time is the fire in which we burn.", author: "Delmore Schwartz"},
    {text: "Take care of the minutes and the hours will take care of themselves.", author: "Earl of Chesterfield"},
    {text: "Time is the longest distance between two places.", author: "Tennessee Williams"},
    {text: "You may delay, but time will not.", author: "Benjamin Franklin"},
    {text: "Time flies over us, but leaves its shadow behind.", author: "Nathaniel Hawthorne"},
    {text: "The only reason for time is so that everything doesn't happen at once.", author: "Albert Einstein"},
    {text: "Time is a created thing. To say 'I don't have time,' is like saying, 'I don't want to.'", author: "Lao Tzu"},
    {text: "Time is the wisest counselor of all.", author: "Pericles"},
    {text: "The perfect moment is this one.", author: "Jon Kabat-Zinn"},
    {text: "Time is the coin of your life. It is the only coin you have, and only you can determine how it will be spent.", author: "Carl Sandburg"},
    {text: "This time, like all times, is a very good one, if we but know what to do with it.", author: "Ralph Waldo Emerson"},
    {text: "Time is what determines the value of everything.", author: "Leandro Taub"},
    {text: "The great dividing line between success and failure can be expressed in five words: 'I did not have time.'", author: "Franklin Field"},
    {text: "Time is the most undefinable yet paradoxical of things; the past is gone, the future is not come, and the present becomes the past even while we attempt to define it.", author: "Charles Caleb Colton"},
    {text: "Time management is an oxymoron. Time is beyond our control, and the clock keeps ticking regardless of how we lead our lives.", author: "Rory Vaden"},
    {text: "Time = life; therefore, waste your time and waste of your life, or master your time and master your life.", author: "Alan Lakein"},
    {text: "Until we can manage time, we can manage nothing else.", author: "Peter Drucker"},
    {text: "The bad news is time flies. The good news is you're the pilot.", author: "Michael Altshuler"},
    {text: "You will never find time for anything. If you want time, you must make it.", author: "Charles Buxton"},
    {text: "Time is the scarcest resource and unless it is managed nothing else can be managed.", author: "Peter Drucker"},
    {text: "The way we spend our time defines who we are.", author: "Jonathan Estrin"},
    {text: "The common man is not concerned about the passage of time, the man of talent is driven by it.", author: "Arthur Schopenhauer"},
    {text: "The present time is precious. We cannot afford to waste it.", author: "Dalai Lama"},
    {text: "Time you invest in yourself compounds into a better future.", author: "Unknown"},
    {text: "Every minute you spend in planning saves 10 minutes in execution.", author: "Brian Tracy"},
    {text: "The shorter way to do many things is to do only one thing at a time.", author: "Wolfgang Amadeus Mozart"},
    {text: "Time is the longest distance between two places.", author: "Tennessee Williams"},
    {text: "The only time you should ever look back is to see how far you've come.", author: "Unknown"},
    {text: "Your most valuable resource is not time, but attention.", author: "Maura Thomas"}
  ],
  defaultTargetDay: 0, // Sunday
  defaultTargetTime: "00:00",
  defaultTimezone: "Africa/Lagos"
};

// ================= STATE =================
let state = {
  targetDay: parseInt(localStorage.getItem('targetDay')) || CONFIG.defaultTargetDay,
  targetTime: localStorage.getItem('targetTime') || CONFIG.defaultTargetTime,
  timezone: localStorage.getItem('timezone') || CONFIG.defaultTimezone,
  soundEnabled: localStorage.getItem('soundEnabled') !== 'false',
  notificationsEnabled: localStorage.getItem('notificationsEnabled') === 'true',
  usedQuotes: JSON.parse(localStorage.getItem('usedQuotes')) || [],
  lastHourAlert: null,
  deferredPrompt: null,
  lastUpdate: performance.now(),
  countdownData: {
    totalMinutes: 0,
    seconds: 0,
    milliseconds: 0
  }
};

// ================= DOM ELEMENTS =================
const elements = {
  display: document.getElementById('display'),
  quoteText: document.getElementById('quoteText'),
  quoteAuthor: document.getElementById('quoteAuthor'),
  periodStart: document.getElementById('periodStart'),
  periodEnd: document.getElementById('periodEnd'),
  nowTime: document.getElementById('nowTime'),
  timezoneDisplay: document.getElementById('timezoneDisplay'),
  
  // Settings
  targetDay: document.getElementById('targetDay'),
  targetTime: document.getElementById('targetTime'),
  timezone: document.getElementById('timezone'),
  soundToggle: document.getElementById('soundToggle'),
  notificationsToggle: document.getElementById('notificationsToggle'),
  settingsToggle: document.getElementById('settingsToggle'),
  settingsPanel: document.getElementById('settingsPanel'),
  
  // Buttons
  refreshQuote: document.getElementById('refreshQuote'),
  shareBtn: document.getElementById('shareBtn'),
  soundTestBtn: document.getElementById('soundTestBtn'),
  resetBtn: document.getElementById('resetBtn'),
  themeToggle: document.getElementById('themeToggle'),
  installBtn: document.getElementById('installBtn'),
  installBtnHeader: document.getElementById('installBtnHeader'),
  installPrompt: document.getElementById('installPrompt')
};

// ================= HIGH PRECISION COUNTDOWN =================
function getPeriodBoundaries() {
  const now = new Date();
  const nowInTz = new Date(now.toLocaleString("en-US", {timeZone: state.timezone}));
  
  // Calculate start (previous target day/time)
  const start = new Date(nowInTz);
  const currentDay = nowInTz.getDay();
  const daysSinceTarget = (currentDay - state.targetDay + 7) % 7;
  
  start.setDate(start.getDate() - daysSinceTarget);
  const [hours, minutes] = state.targetTime.split(':').map(Number);
  start.setHours(hours, minutes, 0, 0);
  
  // If we've passed the target time today, start is previous occurrence
  if (start > nowInTz) {
    start.setDate(start.getDate() - 7);
  }
  
  // Calculate end (next target day/time)
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  
  return { start, end, now: nowInTz };
}

function calculateCountdown() {
  const { end, now } = getPeriodBoundaries();
  let diff = end - now;
  
  if (diff < 0) {
    // If we've passed the end, recalculate for next period
    const nextEnd = new Date(end);
    nextEnd.setDate(nextEnd.getDate() + 7);
    diff = nextEnd - now;
  }
  
  const totalMinutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  const milliseconds = diff % 1000;
  
  // Update state for smooth animation
  state.countdownData = {
    totalMinutes,
    seconds,
    milliseconds,
    rawDiff: diff
  };
  
  return { totalMinutes, seconds, milliseconds, diff };
}

function formatCountdown(minutes, seconds, milliseconds) {
  return `${String(minutes).padStart(5, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

// ================= SMOOTH ANIMATION LOOP =================
function animateCountdown(currentTime) {
  // Calculate delta time for smooth updates
  const delta = currentTime - state.lastUpdate;
  state.lastUpdate = currentTime;
  
  // Recalculate countdown
  const { totalMinutes, seconds, milliseconds, diff } = calculateCountdown();
  
  // Apply smooth decrement to milliseconds
  let smoothMilliseconds = milliseconds;
  if (diff > 0) {
    // For smooth animation, we subtract based on time passed
    smoothMilliseconds = Math.max(0, milliseconds - (delta % 1000));
  }
  
  // Format and display
  elements.display.textContent = formatCountdown(totalMinutes, seconds, Math.floor(smoothMilliseconds));
  
  // Check for hour milestones
  checkHourMilestone(totalMinutes, seconds);
  
  // Continue animation
  requestAnimationFrame(animateCountdown);
}

// ================= QUOTE SYSTEM =================
function getRandomQuote() {
  const availableQuotes = CONFIG.quotes.filter(q => !state.usedQuotes.includes(q.text));
  
  if (availableQuotes.length === 0) {
    // Reset used quotes but keep last 2
    const keepLastTwo = state.usedQuotes.slice(-2);
    state.usedQuotes = keepLastTwo.map(text => CONFIG.quotes.find(q => q.text === text)?.text).filter(Boolean);
    return getRandomQuote();
  }
  
  const quote = availableQuotes[Math.floor(Math.random() * availableQuotes.length)];
  state.usedQuotes.push(quote.text);
  localStorage.setItem('usedQuotes', JSON.stringify(state.usedQuotes));
  return quote;
}

function updateQuote() {
  const quote = getRandomQuote();
  elements.quoteText.textContent = `"${quote.text}"`;
  elements.quoteAuthor.textContent = `— ${quote.author}`;
}

// ================= SOUND SYSTEM =================
function playHourSound() {
  if (!state.soundEnabled) return;
  
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2);
    
    showToast("Hour milestone reached!", "success");
  } catch (error) {
    console.log("Audio context not supported");
  }
}

function checkHourMilestone(minutes, seconds) {
  const hours = Math.floor(minutes / 60);
  
  // Check for exact hour milestone (minutes divisible by 60 AND seconds at 0)
  if (state.lastHourAlert !== hours && minutes % 60 === 0 && seconds === 0 && minutes > 0) {
    state.lastHourAlert = hours;
    playHourSound();
  }
}

// ================= UI UPDATES =================
function updateInfoCards() {
  const { start, end, now } = getPeriodBoundaries();
  const options = { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit', 
    minute: '2-digit' 
  };
  
  elements.periodStart.textContent = start.toLocaleString('en-US', { ...options, timeZone: state.timezone });
  elements.periodEnd.textContent = end.toLocaleString('en-US', { ...options, timeZone: state.timezone });
  
  // Update current time more frequently
  const timeOptions = { 
    ...options, 
    second: '2-digit',
    timeZone: state.timezone 
  };
  elements.nowTime.textContent = now.toLocaleString('en-US', timeOptions);
  
  // Update timezone display
  const tzName = state.timezone.split('/')[1] || state.timezone;
  const offset = now.getTimezoneOffset();
  const timezoneStr = `${tzName} (GMT${offset <= 0 ? '+' : ''}${-offset/60})`;
  elements.timezoneDisplay.textContent = timezoneStr;
}

// ================= SETTINGS =================
function initSettings() {
  // Load settings
  elements.targetDay.value = state.targetDay;
  elements.targetTime.value = state.targetTime;
  elements.timezone.value = state.timezone;
  elements.soundToggle.checked = state.soundEnabled;
  elements.notificationsToggle.checked = state.notificationsEnabled;
  
  // Event listeners
  elements.targetDay.addEventListener('change', (e) => {
    state.targetDay = parseInt(e.target.value);
    localStorage.setItem('targetDay', state.targetDay);
    updateInfoCards();
    state.lastHourAlert = null; // Reset hour tracking
  });
  
  elements.targetTime.addEventListener('change', (e) => {
    state.targetTime = e.target.value;
    localStorage.setItem('targetTime', state.targetTime);
    updateInfoCards();
    state.lastHourAlert = null;
  });
  
  elements.timezone.addEventListener('change', (e) => {
    state.timezone = e.target.value;
    localStorage.setItem('timezone', state.timezone);
    updateInfoCards();
    state.lastHourAlert = null;
  });
  
  elements.soundToggle.addEventListener('change', (e) => {
    state.soundEnabled = e.target.checked;
    localStorage.setItem('soundEnabled', state.soundEnabled);
  });
  
  elements.notificationsToggle.addEventListener('change', (e) => {
    state.notificationsEnabled = e.target.checked;
    localStorage.setItem('notificationsEnabled', state.notificationsEnabled);
    if (state.notificationsEnabled && 'Notification' in window) {
      Notification.requestPermission();
    }
  });
  
  // Toggle settings panel
  elements.settingsToggle.addEventListener('click', () => {
    elements.settingsPanel.classList.toggle('active');
  });
}

// ================= THEME =================
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
  
  elements.themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
  });
}

function updateThemeIcon(theme) {
  const icon = elements.themeToggle.querySelector('i');
  icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

// ================= PWA INSTALL =================
function initPWA() {
  // Listen for install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    elements.installPrompt.style.display = 'flex';
    elements.installBtnHeader.style.display = 'grid';
  });
  
  // Install button handlers
  const installHandler = async () => {
    if (!state.deferredPrompt) return;
    
    state.deferredPrompt.prompt();
    const { outcome } = await state.deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      showToast('Tic2Tic installed!', 'success');
      elements.installPrompt.style.display = 'none';
    }
    
    state.deferredPrompt = null;
  };
  
  elements.installBtn?.addEventListener('click', installHandler);
  elements.installBtnHeader?.addEventListener('click', installHandler);
  
  // Hide install prompt if installed
  window.addEventListener('appinstalled', () => {
    elements.installPrompt.style.display = 'none';
    elements.installBtnHeader.style.display = 'none';
    state.deferredPrompt = null;
  });
}

// ================= UTILITIES =================
function showToast(message, type = '') {
  // Remove existing toast
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i>
    <span>${message}</span>
  `;
  
  document.body.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'fadeOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }
  }, 3000);
  
  // Add fadeOut animation if not exists
  if (!document.querySelector('#fadeOutStyle')) {
    const style = document.createElement('style');
    style.id = 'fadeOutStyle';
    style.textContent = `
      @keyframes fadeOut {
        from { opacity: 1; transform: translate(-50%, 0); }
        to { opacity: 0; transform: translate(-50%, 10px); }
      }
    `;
    document.head.appendChild(style);
  }
}

// ================= INITIALIZATION =================
function init() {
  // Initialize all systems
  initTheme();
  initSettings();
  initPWA();
  updateQuote();
  
  // Start animation loop
  state.lastUpdate = performance.now();
  requestAnimationFrame(animateCountdown);
  
  // Update info cards every second
  setInterval(updateInfoCards, 1000);
  updateInfoCards();
  
  // Button events
  elements.refreshQuote.addEventListener('click', updateQuote);
  
  elements.shareBtn.addEventListener('click', () => {
    const text = `⏳ ${elements.display.textContent} until next target | Tic2Tic`;
    navigator.clipboard.writeText(text);
    showToast('Countdown copied!');
  });
  
  elements.soundTestBtn.addEventListener('click', playHourSound);
  
  elements.resetBtn.addEventListener('click', () => {
    state.lastHourAlert = null;
    showToast('Countdown refreshed');
  });
  
  // Request notification permission if needed
  if (state.notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ================= SERVICE WORKER =================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.log('ServiceWorker registration failed:', err);
    });
  });
}

// Start the app
document.addEventListener('DOMContentLoaded', init);

// Export for debugging
window.getCountdownData = () => {
  return calculateCountdown();
};

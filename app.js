class ReverseWorldClock {
    constructor() {
        this.selectedTimezone = 'Africa/Lagos';
        this.is24Hour = true;
        this.isDarkMode = true;
        this.lastUpdateTime = Date.now();
        this.intervalId = null;
        this.notificationPermission = false;
        
        this.init();
    }
    
    init() {
        // Load saved preferences
        this.loadPreferences();
        
        // Initialize components
        this.setupEventListeners();
        this.updateAll();
        
        // Start the clock
        this.startClock();
        
        // Initialize calendar
        this.generateCalendar();
        
        console.log('Reverse World Clock initialized with Nigerian timezone');
    }
    
    startClock() {
        // Update every 10ms for smooth milliseconds
        this.intervalId = setInterval(() => this.updateAll(), 10);
    }
    
    updateAll() {
        this.updateReverseClock();
        this.updateNormalTime();
        this.updateDate();
        this.updateTimezoneInfo();
        this.updateProgressBar();
        this.updateLastUpdate();
    }
    
    calculateReverseTime(date) {
        // Get time in selected timezone
        const timeString = date.toLocaleTimeString('en-US', {
            timeZone: this.selectedTimezone,
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        // Extract hours, minutes, seconds
        const [hours, minutes, seconds] = timeString.split(':').map(Number);
        const milliseconds = date.getMilliseconds();
        
        // Calculate total milliseconds from start of day
        const totalMsInDay = 24 * 60 * 60 * 1000;
        const currentMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
        
        // Calculate reverse time
        const reverseMs = totalMsInDay - currentMs;
        
        // Convert back to hours, minutes, seconds, milliseconds
        let reverseHours = Math.floor(reverseMs / 3600000);
        let reverseMinutes = Math.floor((reverseMs % 3600000) / 60000);
        let reverseSeconds = Math.floor((reverseMs % 60000) / 1000);
        let reverseMilliseconds = reverseMs % 1000;
        
        // Handle edge case at midnight
        if (reverseHours === 24) {
            reverseHours = 23;
            reverseMinutes = 59;
            reverseSeconds = 59;
            reverseMilliseconds = 999;
        }
        
        return {
            hours: reverseHours,
            minutes: reverseMinutes,
            seconds: reverseSeconds,
            milliseconds: reverseMilliseconds,
            totalMs: reverseMs
        };
    }
    
    updateReverseClock() {
        const now = new Date();
        const reverseTime = this.calculateReverseTime(now);
        
        // Format time
        const format = (num) => num.toString().padStart(2, '0');
        const formatMs = (num) => num.toString().padStart(3, '0').slice(0, 2);
        
        // Update display
        document.getElementById('reverseClock').innerHTML = 
            `${format(reverseTime.hours)}:${format(reverseTime.minutes)}:${format(reverseTime.seconds)}` +
            `.<span class="milliseconds">${formatMs(reverseTime.milliseconds)}</span>`;
        
        document.getElementById('reverseTimeDisplay').textContent = 
            `${format(reverseTime.hours)}:${format(reverseTime.minutes)}:${format(reverseTime.seconds)}`;
    }
    
    updateNormalTime() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', {
            timeZone: this.selectedTimezone,
            hour12: !this.is24Hour,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        document.getElementById('normalTime').textContent = `Normal Time: ${timeString}`;
        document.getElementById('normalTimeDisplay').textContent = timeString;
    }
    
    updateDate() {
        const now = new Date();
        const options = {
            timeZone: this.selectedTimezone,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        
        const dateString = now.toLocaleDateString('en-US', options);
        document.getElementById('currentDate').textContent = dateString;
    }
    
    updateTimezoneInfo() {
        const now = new Date();
        
        // Get timezone offset
        const timezoneOffset = now.toLocaleTimeString('en-US', {
            timeZone: this.selectedTimezone,
            timeZoneName: 'longOffset'
        }).split(', ')[1];
        
        // Get current time in timezone
        const localTime = now.toLocaleTimeString('en-US', {
            timeZone: this.selectedTimezone,
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        document.getElementById('timezoneName').textContent = this.selectedTimezone;
        document.getElementById('timezoneOffset').textContent = timezoneOffset;
        document.getElementById('localTime').textContent = `Local: ${localTime}`;
    }
    
    updateProgressBar() {
        const now = new Date();
        const reverseTime = this.calculateReverseTime(now);
        const progress = (reverseTime.totalMs / (24 * 60 * 60 * 1000)) * 100;
        document.getElementById('dayProgress').style.width = `${progress}%`;
    }
    
    generateCalendar() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        
        // Update month display
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
        document.getElementById('calendarMonth').textContent = `${monthNames[month]} ${year}`;
        
        // Get first day and number of days
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = now.getDate();
        
        // Generate calendar
        const calendarElement = document.getElementById('calendar');
        calendarElement.innerHTML = '';
        
        // Add day headers
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        days.forEach(day => {
            const header = document.createElement('div');
            header.className = 'calendar-header';
            header.textContent = day;
            calendarElement.appendChild(header);
        });
        
        // Add empty days for first week
        for (let i = 0; i < firstDay; i++) {
            const emptyDay = document.createElement('div');
            emptyDay.className = 'calendar-day other-month';
            calendarElement.appendChild(emptyDay);
        }
        
        // Add days of the month
        for (let day = 1; day <= daysInMonth; day++) {
            const dayElement = document.createElement('div');
            dayElement.className = 'calendar-day';
            dayElement.textContent = day;
            
            if (day === today) {
                dayElement.classList.add('today');
            }
            
            calendarElement.appendChild(dayElement);
        }
    }
    
    setupEventListeners() {
        // Timezone selection
        document.getElementById('timezoneSelect').addEventListener('change', (e) => {
            this.selectedTimezone = e.target.value;
            this.updateAll();
            this.showNotification(`Timezone changed to ${this.selectedTimezone}`);
        });
        
        // Fullscreen button
        document.getElementById('fullscreenBtn').addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        });
        
        // Theme toggle
        document.getElementById('themeBtn').addEventListener('click', () => {
            this.toggleTheme();
        });
        
        // Notifications
        document.getElementById('notificationBtn').addEventListener('click', () => {
            this.requestNotificationPermission();
        });
        
        // Save as App
        document.getElementById('saveBtn').addEventListener('click', () => {
            this.showSaveInstructions();
        });
        
        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.updateAll();
            }
        });
    }
    
    toggleTheme() {
        this.isDarkMode = !this.isDarkMode;
        const themeBtn = document.getElementById('themeBtn');
        
        if (this.isDarkMode) {
            document.documentElement.style.setProperty('--primary', '#1a1a2e');
            document.documentElement.style.setProperty('--secondary', '#16213e');
            themeBtn.innerHTML = '<i class="fas fa-moon"></i> Dark Mode';
        } else {
            document.documentElement.style.setProperty('--primary', '#f0f0f0');
            document.documentElement.style.setProperty('--secondary', '#ffffff');
            themeBtn.innerHTML = '<i class="fas fa-sun"></i> Light Mode';
        }
        
        this.savePreferences();
    }
    
    async requestNotificationPermission() {
        if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            this.notificationPermission = permission === 'granted';
            
            if (this.notificationPermission) {
                this.showNotification('Notifications enabled!');
                document.getElementById('notificationBtn').innerHTML = 
                    '<i class="fas fa-bell-slash"></i> Disable Notifications';
            }
        }
    }
    
    showNotification(message) {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.style.display = 'block';
        
        setTimeout(() => {
            notification.style.display = 'none';
        }, 3000);
    }
    
    showSaveInstructions() {
        const instructions = `
        To install this as an app:
        
        On iPhone/iPad:
        1. Tap the Share button
        2. Scroll down and tap "Add to Home Screen"
        3. Name it "Reverse Clock" and tap Add
        
        On Android:
        1. Tap the menu (3 dots)
        2. Tap "Add to Home Screen"
        3. Name it and tap Add
        
        On Windows/Mac:
        1. In Chrome/Edge, click the install icon in address bar
        2. Or go to Settings > More tools > Create shortcut
        3. Check "Open as window" and click Create
        `;
        
        alert(instructions);
    }
    
    updateLastUpdate() {
        const now = Date.now();
        const diff = Math.floor((now - this.lastUpdateTime) / 1000);
        
        if (diff > 5) {
            document.getElementById('lastUpdate').textContent = 
                `Last updated: ${diff} seconds ago`;
        }
    }
    
    savePreferences() {
        const preferences = {
            timezone: this.selectedTimezone,
            is24Hour: this.is24Hour,
            isDarkMode: this.isDarkMode
        };
        
        localStorage.setItem('reverseClockPrefs', JSON.stringify(preferences));
    }
    
    loadPreferences() {
        const saved = localStorage.getItem('reverseClockPrefs');
        
        if (saved) {
            const preferences = JSON.parse(saved);
            this.selectedTimezone = preferences.timezone || 'Africa/Lagos';
            this.is24Hour = preferences.is24Hour !== false;
            this.isDarkMode = preferences.isDarkMode !== false;
            
            // Update UI
            document.getElementById('timezoneSelect').value = this.selectedTimezone;
        }
    }
    
    destroy() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.reverseClock = new ReverseWorldClock();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (window.reverseClock) {
        window.reverseClock.destroy();
    }
});

// PWA Support - Make it installable
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

// Add manifest for PWA
const manifestLink = document.createElement('link');
manifestLink.rel = 'manifest';
manifestLink.href = '/manifest.json';
document.head.appendChild(manifestLink);

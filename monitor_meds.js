// --- Medicine Tracker Logic ---
// BUG FIX #9: Declare as window.medicines everywhere, never bare `medicines`
window.medicines = JSON.parse(localStorage.getItem('medicines')) || [];

// Pending alarm timers: { medId: timeoutHandle }
const medicineMissedTimers = {};

// DOM Elements
const medNameInput = document.getElementById('medName');
const medTimeInput = document.getElementById('medTime');
const btnAddMed = document.getElementById('btnAddMed');
const medicineList = document.getElementById('medicineList');
// NOTE: btnEmailMeds listener is ONLY in monitor_export.js (BUG FIX #2)
// alertSound is already defined in monitor.js

// Add Medicine
btnAddMed.addEventListener('click', () => {
    const name = medNameInput.value.trim();
    const time = medTimeInput.value;

    if (!name || !time) {
        alert('Please enter both medicine name and time.');
        return;
    }

    const med = {
        id: Date.now(),
        name,
        time,
        taken: false,
        lastTakenDate: null
    };

    // BUG FIX #9: Always use window.medicines
    window.medicines.push(med);
    saveMedicines();
    renderMedicines();
    medNameInput.value = '';
    medTimeInput.value = '';
});

// Render Medicines
function renderMedicines() {
    medicineList.innerHTML = '';

    // Sort by time
    window.medicines.sort((a, b) => a.time.localeCompare(b.time));

    window.medicines.forEach(med => {
        const div = document.createElement('div');
        div.className = `medicine-item ${med.taken ? 'taken' : ''}`;
        div.id = `med-${med.id}`;

        div.innerHTML = `
            <div class="med-info">
                <span class="med-name">${med.name}</span>
                <span class="med-time">${formatTime(med.time)}</span>
            </div>
            <div class="med-actions">
                <div class="checkbox-custom ${med.taken ? 'checked' : ''}" onclick="toggleMedicine(${med.id})">
                    <i class="fa-solid fa-check"></i>
                </div>
                <button class="icon-btn" onclick="removeMedicine(${med.id})" style="color:var(--accent-red);">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        medicineList.appendChild(div);
    });
}

// Toggle Medicine Taken Status
window.toggleMedicine = function (id) {
    // BUG FIX #9: Use window.medicines
    const med = window.medicines.find(m => m.id === id);
    if (med) {
        med.taken = !med.taken;
        if (med.taken) {
            med.lastTakenDate = new Date().toISOString().split('T')[0];
            stopMedicineAlarm(med.id);
            // Cancel the missed-medicine Telegram timer
            if (medicineMissedTimers[med.id]) {
                clearTimeout(medicineMissedTimers[med.id]);
                delete medicineMissedTimers[med.id];
            }
            logEvent(`Medicine Taken: ${med.name}`, 'normal');
        } else {
            med.lastTakenDate = null;
        }
        saveMedicines();
        renderMedicines();
    }
};

// Remove Medicine (BUG FIX #1: use window.medicines, not local reassignment)
window.removeMedicine = function (id) {
    if (confirm('Delete this medicine schedule?')) {
        window.medicines = window.medicines.filter(m => m.id !== id);
        saveMedicines();
        renderMedicines();
    }
};

// Save to LocalStorage
function saveMedicines() {
    localStorage.setItem('medicines', JSON.stringify(window.medicines));
}

// Format Time (HH:mm -> 12h format)
function formatTime(timeStr) {
    const [hour, minute] = timeStr.split(':');
    const h = parseInt(hour);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minute} ${ampm}`;
}

// Alarm Logic
setInterval(() => {
    const now = new Date();
    const currentTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    // Daily reset at midnight (BUG FIX for feature #10 overlap: handled here for meds)
    if (currentTime === '00:00') {
        window.medicines.forEach(m => { m.taken = false; });
        saveMedicines();
        renderMedicines();
    }

    // BUG FIX #9: Use window.medicines
    window.medicines.forEach(med => {
        if (med.time === currentTime && !med.taken) {
            triggerMedicineAlarm(med.id, med.name);
        }
    });
}, 1000);

function triggerMedicineAlarm(id, name) {
    const el = document.getElementById(`med-${id}`);
    if (el && !el.classList.contains('alarm-active')) {
        el.classList.add('alarm-active');
        alertSound.play().catch(e => { });
        if (Notification.permission === "granted") {
            new Notification("Medicine Reminder", { body: `Time to take: ${name}` });
        }

        // NEW FEATURE #11: Schedule missed-medicine Telegram alert after 5 minutes
        if (!medicineMissedTimers[id]) {
            medicineMissedTimers[id] = setTimeout(() => {
                const med = window.medicines.find(m => m.id === id);
                if (med && !med.taken) {
                    sendTelegramMessage(`💊 *${med.name}* not confirmed taken. Scheduled at ${formatTime(med.time)}.`);
                    logEvent(`Medicine Missed: ${med.name}`, 'eating');
                }
                delete medicineMissedTimers[id];
            }, 5 * 60 * 1000); // 5 minutes
        }
    }
}

function stopMedicineAlarm(id) {
    const el = document.getElementById(`med-${id}`);
    if (el) {
        el.classList.remove('alarm-active');
    }
}

// Request Notification Permission
if (Notification.permission !== "granted") {
    Notification.requestPermission();
}

// Initial Render
renderMedicines();

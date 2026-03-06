// --- Medicine Tracker Logic ---
window.medicines = JSON.parse(localStorage.getItem('medicines')) || []; // Make it global

// DOM Elements
const medNameInput = document.getElementById('medName');
const medTimeInput = document.getElementById('medTime');
const btnAddMed = document.getElementById('btnAddMed');
const medicineList = document.getElementById('medicineList');
const btnEmailMeds = document.getElementById('btnEmailMeds');
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

    medicines.push(med);
    saveMedicines();
    renderMedicines();
    medNameInput.value = '';
    medTimeInput.value = '';
});

// Render Medicines
function renderMedicines() {
    medicineList.innerHTML = '';

    // Sort by time
    medicines.sort((a, b) => a.time.localeCompare(b.time));

    medicines.forEach(med => {
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
    const med = medicines.find(m => m.id === id);
    if (med) {
        med.taken = !med.taken;
        if (med.taken) {
            med.lastTakenDate = new Date().toISOString().split('T')[0];
            stopMedicineAlarm(med.id);
            logEvent(`Medicine Taken: ${med.name}`, 'normal');
        } else {
            med.lastTakenDate = null;
        }
        saveMedicines();
        renderMedicines();
    }
};

// Remove Medicine
window.removeMedicine = function (id) {
    if (confirm('Delete this medicine schedule?')) {
        medicines = medicines.filter(m => m.id !== id);
        saveMedicines();
        renderMedicines();
    }
};

// Save to LocalStorage
function saveMedicines() {
    localStorage.setItem('medicines', JSON.stringify(medicines));
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

    // Reset "taken" status at midnight
    if (currentTime === '00:00') {
        medicines.forEach(m => m.taken = false);
        saveMedicines();
        renderMedicines();
    }

    medicines.forEach(med => {
        if (med.time === currentTime && !med.taken) {
            triggerMedicineAlarm(med.id);
        }
    });
}, 1000);

function triggerMedicineAlarm(id) {
    const el = document.getElementById(`med-${id}`);
    if (el && !el.classList.contains('alarm-active')) {
        el.classList.add('alarm-active');
        // Play sound
        alertSound.play().catch(e => { });
        // Browser notification
        if (Notification.permission === "granted") {
            new Notification("Medicine Reminder", { body: "Time to take your medicine!" });
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

// Email/Export Logic
btnEmailMeds.addEventListener('click', () => {
    let csvContent = "Medicine,Time,Status,Last Taken\n";
    medicines.forEach(med => {
        csvContent += `${med.name},${med.time},${med.taken ? 'Taken' : 'Pending'},${med.lastTakenDate || 'N/A'}\n`;
    });

    const subject = "Medicine Report - MedGuard";
    const body = encodeURIComponent("Here is the current medicine schedule and status:\n\n" + csvContent);

    // Open default mail client
    const serviceId = localStorage.getItem('emailServiceId');
    const templateId = localStorage.getItem('emailTemplateId');

    if (!serviceId || !templateId) {
        alert('Please configure EmailJS Service ID and Template ID in Settings first.');
        return;
    }

    const templateParams = {
        to_name: "Caregiver", // You might want to make this dynamic too
        message: csvContent,
        reply_to: "noreply@medguard.com"
    };

    emailjs.send(serviceId, templateId, templateParams)
        .then(function (response) {
            console.log('SUCCESS!', response.status, response.text);
            alert('Medicine Report Sent Successfully!');
        }, function (error) {
            console.log('FAILED...', error);
            alert('Failed to send email: ' + JSON.stringify(error));
        });
});

// Initial Render
renderMedicines();

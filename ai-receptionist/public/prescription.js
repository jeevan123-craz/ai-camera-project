/* ════════════════════════════════════════════════
   MedGuard AI — prescription.js
   Handles: Prescription Lookup, Download, Blinkit Order
   ════════════════════════════════════════════════ */

'use strict';

// ── State ──
let currentPrescription = null;

// ── DOM helpers ──
const $ = id => document.getElementById(id);

// ════════════════════════════════════════════════
// STEP 1: Fetch Prescription
// ════════════════════════════════════════════════
async function fetchPrescription() {
    const name = $('patientNameInput').value.trim();
    if (!name) {
        showError('Please enter your full name to look up your prescription.');
        return;
    }

    // Reset UI
    hideError();
    $('rxCard').style.display = 'none';
    $('rxLoading').style.display = 'flex';
    $('lookupBtn').disabled = true;
    $('lookupBtn').textContent = 'Searching…';

    try {
        const res = await fetch(`/api/prescription/${encodeURIComponent(name)}`);
        const data = await res.json();

        if (!res.ok || data.error) {
            throw new Error(data.error || 'No prescription found for this name.');
        }

        currentPrescription = data;
        renderPrescription(data);

    } catch (err) {
        showError('❌ ' + (err.message || 'Could not fetch prescription. Please check your name and try again.'));
    } finally {
        $('rxLoading').style.display = 'none';
        $('lookupBtn').disabled = false;
        $('lookupBtn').textContent = '🔍 Find Prescription';
    }
}

// ════════════════════════════════════════════════
// STEP 2: Render Prescription Card
// ════════════════════════════════════════════════
function renderPrescription(rx) {
    // Header date
    const now = new Date();
    $('rxDate').textContent = 'Issued: ' + now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    // Meta fields
    $('rxPatientName').textContent = rx.patientName || '—';
    $('rxApptDate').textContent    = rx.appointmentDate
        ? new Date(rx.appointmentDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';
    $('rxDoctor').textContent    = rx.doctorName  || '—';
    $('rxDiagnosis').textContent = rx.diagnosis   || '—';

    // Medicines
    const medIcons = ['💊', '🔵', '🟡', '🔴', '🟢', '⚪'];
    const medList = $('rxMedicinesList');
    medList.innerHTML = '';

    if (!rx.medicines || !rx.medicines.length) {
        medList.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0;">No medicines listed.</p>';
    } else {
        rx.medicines.forEach((med, i) => {
            const row = document.createElement('div');
            row.className = 'medicine-row';
            row.innerHTML = `
                <div class="med-name"><span class="med-icon">${medIcons[i % medIcons.length]}</span>${escHtml(med.name)}</div>
                <div class="med-dosage">${escHtml(med.dosage || '—')}</div>
                <div class="med-duration">${escHtml(med.duration || '—')}</div>
                <div class="med-instructions">${escHtml(med.instructions || '—')}</div>
            `;
            medList.appendChild(row);
        });
    }

    // Doctor's notes
    $('rxDoctorNotes').textContent = rx.doctorNotes || 'No additional notes from the doctor.';

    // Show card
    $('rxCard').style.display = 'block';
    $('rxCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ════════════════════════════════════════════════
// Download / Print Prescription
// ════════════════════════════════════════════════
function downloadPrescription() {
    window.print();
}

// ════════════════════════════════════════════════
// Blinkit Modal
// ════════════════════════════════════════════════
function openBlinkitModal() {
    if (!currentPrescription) return;

    // Populate medicine list in modal
    const medNames = (currentPrescription.medicines || [])
        .map((m, i) => `${i + 1}. ${m.name} — ${m.dosage}`)
        .join('\n');
    $('blinkitMedList').textContent = medNames || 'No medicines listed.';

    // Reset modal state
    $('blinkitFormView').style.display = 'block';
    $('blinkitSuccess').style.display  = 'none';
    $('deliveryAddress').value = '';
    $('deliveryPhone').value   = '';
    hideBlinkitError();

    $('blinkitModal').classList.add('open');
}

function closeBlinkitModal() {
    $('blinkitModal').classList.remove('open');
}

// Close modal on overlay click
$('blinkitModal').addEventListener('click', function(e) {
    if (e.target === this) closeBlinkitModal();
});

// ════════════════════════════════════════════════
// Place Blinkit Order
// ════════════════════════════════════════════════
async function placeBlinkitOrder() {
    const address = $('deliveryAddress').value.trim();
    const phone   = $('deliveryPhone').value.trim();

    if (!address) { showBlinkitError('Please enter your delivery address.'); return; }
    if (!phone)   { showBlinkitError('Please enter your phone number.'); return; }
    if (!/^[+\d][\d\s\-]{8,14}$/.test(phone)) {
        showBlinkitError('Please enter a valid phone number (e.g. +91 98765 43210).');
        return;
    }

    hideBlinkitError();
    $('placeOrderBtn').disabled    = true;
    $('placeOrderBtn').textContent = '⏳ Placing Order…';

    try {
        const payload = {
            patientName:  currentPrescription.patientName,
            medicines:    currentPrescription.medicines || [],
            address,
            phone,
            doctorName:   currentPrescription.doctorName,
            diagnosis:    currentPrescription.diagnosis,
        };

        const res  = await fetch('/api/blinkit-order', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok || data.error) throw new Error(data.error || 'Order failed.');

        // Show success view
        $('blinkitFormView').style.display = 'none';
        $('blinkitSuccess').style.display  = 'block';

        // Disable the Blinkit button on the main card (order already placed)
        $('blinkitBtn').disabled    = true;
        $('blinkitBtn').textContent = '✅ Order Placed';

    } catch (err) {
        showBlinkitError('⚠️ ' + (err.message || 'Something went wrong. Please try again.'));
    } finally {
        $('placeOrderBtn').disabled    = false;
        $('placeOrderBtn').textContent = '⚡ Place Order — Deliver to My Address';
    }
}

// ════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════
function showError(msg) {
    const el = $('rxError');
    el.textContent = msg;
    el.style.display = 'block';
}
function hideError() { $('rxError').style.display = 'none'; }

function showBlinkitError(msg) {
    const el = $('blinkitError');
    el.textContent = msg;
    el.style.display = 'block';
}
function hideBlinkitError() { $('blinkitError').style.display = 'none'; }

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

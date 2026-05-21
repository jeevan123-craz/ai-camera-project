// EmailJS integration for exporting medicine schedule
// BUG FIX #3: EmailJS is initialized ONLY in monitor.js (settings save).
// This file only hooks up the button — no extra emailjs.init() call.

// BUG FIX #2: Only ONE click listener on btnEmailMeds (this file owns it).
document.addEventListener('DOMContentLoaded', () => {
    const btnEmailMeds = document.getElementById('btnEmailMeds');
    if (btnEmailMeds) {
        btnEmailMeds.addEventListener("click", exportMedicinesViaEmailJS);
    }
});

function exportMedicinesViaEmailJS() {
    const meds = window.medicines || [];
    // Format as a simple HTML table
    let medTable = '<table border="1" cellpadding="4" cellspacing="0"><tr><th>Medicine</th><th>Time</th><th>Status</th><th>Last Taken</th></tr>';
    meds.forEach(med => {
        medTable += `<tr>
            <td>${med.name}</td>
            <td>${med.time}</td>
            <td>${med.taken ? 'Taken' : 'Pending'}</td>
            <td>${med.lastTakenDate || 'N/A'}</td>
        </tr>`;
    });
    medTable += '</table>';

    console.log("Medicine Table Sent:", medTable);

    const serviceId = localStorage.getItem('emailServiceId') || 'YOUR_SERVICE_ID';
    const templateId = localStorage.getItem('emailTemplateId') || 'YOUR_TEMPLATE_ID';

    if (!serviceId || serviceId === 'YOUR_SERVICE_ID' || !templateId || templateId === 'YOUR_TEMPLATE_ID') {
        alert('Please configure EmailJS Service ID and Template ID in Settings first.');
        return;
    }

    const templateParams = { medicines: medTable };

    emailjs.send(serviceId, templateId, templateParams)
        .then(() => alert('Email sent!'))
        .catch(error => alert('Failed to send email: ' + (error.text || error)));
}

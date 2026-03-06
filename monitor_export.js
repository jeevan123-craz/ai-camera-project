// EmailJS integration for exporting medicine schedule

// Load EmailJS SDK and initialize after it's loaded
var script = document.createElement('script');
script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js";
script.onload = function() {
    // Initialize EmailJS with your public key
    emailjs.init({
        publicKey: localStorage.getItem('emailPublicKey') || 'YOUR_PUBLIC_KEY'
    });

    // Hook up the button after SDK is loaded
    const btnEmailMeds = document.getElementById('btnEmailMeds');
    if (btnEmailMeds) {
        btnEmailMeds.addEventListener("click", exportMedicinesViaEmailJS);
    }
};
document.head.appendChild(script);

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

    // Log to check if table is empty
    console.log("Medicine Table Sent:", medTable);

    // Prepare EmailJS params
    const serviceId = localStorage.getItem('emailServiceId') || 'YOUR_SERVICE_ID';
    const templateId = localStorage.getItem('emailTemplateId') || 'YOUR_TEMPLATE_ID';

    const templateParams = {
        medicines: medTable
    };

    emailjs.send(serviceId, templateId, templateParams)
        .then(response => alert('Email sent!'))
        .catch(error => alert('Failed to send email: ' + error.text));
}

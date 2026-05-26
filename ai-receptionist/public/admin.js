async function fetchAppointments() {
    try {
        const tbody = document.getElementById('appointments-body');
        tbody.innerHTML = '<tr><td colspan="4" class="loading-state">Syncing with Google Calendar...</td></tr>';
        
        const response = await fetch('/api/appointments');
        const appointments = await response.json();
        
        // Update Stats
        document.getElementById('total-bookings').innerText = appointments.length;
        
        const today = new Date().toDateString();
        const todayCount = appointments.filter(a => new Date(a.time).toDateString() === today).length;
        document.getElementById('today-bookings').innerText = todayCount;
        document.getElementById('upcoming-bookings').innerText = appointments.length - todayCount;

        // Render Table
        if (appointments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="loading-state">No appointments found.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        appointments.forEach(apt => {
            const tr = document.createElement('tr');
            
            // Format Date
            const dateObj = new Date(apt.time);
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            tr.innerHTML = `
                <td><strong>${apt.patientName}</strong></td>
                <td>${dateStr} <br><span style="color: #94a3b8; font-size: 0.85rem">${timeStr}</span></td>
                <td>${apt.reason}</td>
                <td><span class="status-badge">Confirmed</span></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Failed to load appointments", err);
        document.getElementById('appointments-body').innerHTML = '<tr><td colspan="4" class="loading-state" style="color:#ef4444">Error loading data.</td></tr>';
    }
}

// Auto-refresh every 30 seconds
setInterval(fetchAppointments, 30000);

// Initial load
fetchAppointments();

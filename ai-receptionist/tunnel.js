/**
 * MedGuard AI - Cloudflare Tunnel Script
 * Exposes localhost:3000 to a public HTTPS URL
 * Phone can connect from ANY network (mobile data, different WiFi, etc.)
 * 
 * Usage: node tunnel.js
 * No Cloudflare account needed - uses free quick tunnels
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const TUNNEL_URL_FILE = path.join(__dirname, '.tunnel-url');

function startTunnel() {
    console.log('🚇 Starting Cloudflare Tunnel...');
    console.log(`   Exposing localhost:${PORT} to the internet\n`);

    // Try cloudflared from PATH, or common install locations
    const cloudflaredPaths = [
        'cloudflared',
        path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe'),
        path.join(process.env.PROGRAMFILES || '', 'cloudflared', 'cloudflared.exe'),
        'C:\\cloudflared\\cloudflared.exe'
    ];

    let cloudflaredCmd = 'cloudflared';
    
    const tunnel = spawn(cloudflaredCmd, [
        'tunnel', '--url', `http://localhost:${PORT}`,
        '--no-autoupdate'
    ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
    });

    let tunnelUrl = null;

    function processOutput(data) {
        const output = data.toString();
        
        // Look for the tunnel URL in the output
        const urlMatch = output.match(/https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/);
        if (urlMatch && !tunnelUrl) {
            tunnelUrl = urlMatch[0];
            
            // Save tunnel URL to file
            fs.writeFileSync(TUNNEL_URL_FILE, tunnelUrl);
            
            console.log('═══════════════════════════════════════════════════');
            console.log('  🌐 TUNNEL ACTIVE');
            console.log('═══════════════════════════════════════════════════');
            console.log(`  Public URL:  ${tunnelUrl}`);
            console.log(`  WebSocket:   ${tunnelUrl.replace('https:', 'wss:')}`);
            console.log('');
            console.log('  📱 Enter this URL in your Android app Settings');
            console.log('     to connect from any network!');
            console.log('═══════════════════════════════════════════════════\n');
        }

        // Log other output for debugging
        if (output.trim() && !output.includes('INF')) {
            // Only show important messages, skip info-level noise
        }
    }

    tunnel.stdout.on('data', processOutput);
    tunnel.stderr.on('data', processOutput);

    tunnel.on('error', (err) => {
        if (err.code === 'ENOENT') {
            console.error('❌ cloudflared not found!');
            console.error('');
            console.error('   Install it:');
            console.error('   Windows: winget install Cloudflare.cloudflared');
            console.error('   Or download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
            console.error('');
            console.error('   After installing, restart this script.');
        } else {
            console.error('❌ Tunnel error:', err.message);
        }
    });

    tunnel.on('close', (code) => {
        console.log(`\n🔄 Tunnel closed (code ${code}). Restarting in 5s...`);
        // Clean up URL file
        try { fs.unlinkSync(TUNNEL_URL_FILE); } catch {}
        setTimeout(startTunnel, 5000);
    });

    // Cleanup on exit
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down tunnel...');
        tunnel.kill();
        try { fs.unlinkSync(TUNNEL_URL_FILE); } catch {}
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        tunnel.kill();
        try { fs.unlinkSync(TUNNEL_URL_FILE); } catch {}
        process.exit(0);
    });
}

startTunnel();

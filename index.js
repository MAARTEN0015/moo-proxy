const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;

// Cache dla IP
let cachedIP = null;
// Licznik aktywnych połączeń
let activeConnections = 0;
let totalConnections = 0;

function getExternalIP() {
    return new Promise((resolve) => {
        if (cachedIP) {
            resolve(cachedIP);
            return;
        }
        https.get('https://api.ipify.org', (resp) => {
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => {
                cachedIP = data.trim();
                resolve(cachedIP);
            });
        }).on('error', () => resolve('unknown'));
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Endpoint /ip
    if (req.url === '/ip') {
        const ip = await getExternalIP();
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(ip);
        return;
    }

    // Endpoint /stats - pokaż statystyki
    if (req.url === '/stats') {
        const ip = await getExternalIP();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ip: ip,
            active: activeConnections,
            total: totalConnections,
            maxSlots: 2
        }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (clientWs, req) => {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const target = params.get('target');

    if (!target) {
        clientWs.close(1008, 'Missing target URL');
        return;
    }

    activeConnections++;
    totalConnections++;

    let serverWs = null;
    let closed = false;

    const cleanup = () => {
        if (closed) return;
        closed = true;

        activeConnections = Math.max(0, activeConnections - 1);

        if (
            serverWs &&
            (serverWs.readyState === WebSocket.OPEN ||
             serverWs.readyState === WebSocket.CONNECTING)
        ) {
            try {
                serverWs.close();
            } catch {}
        }
    };

    console.log(
        `[PROXY] client connected (active=${activeConnections})`
    );

    try {
        console.log('[PROXY] target:', target);

        serverWs = new WebSocket(target, {
            headers: {
                Origin: 'https://moomoo.io',
                'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
            },
            handshakeTimeout: 10000
        });
    } catch (err) {
        console.error('[PROXY] upstream creation failed:', err);
        cleanup();

        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1011, 'Upstream connection failed');
        }

        return;
    }

    serverWs.binaryType = 'arraybuffer';

    serverWs.on('open', () => {
        console.log('[PROXY] upstream connected');
    });

    serverWs.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
            try {
                clientWs.send(data, { binary: isBinary });
            } catch (err) {
                console.error('[PROXY] client send failed:', err.message);
            }
        }
    });

    serverWs.on('close', (code, reason) => {
        const text = reason ? reason.toString() : '';

        console.warn(
            `[PROXY] upstream closed: code=${code} reason=${text}`
        );

        cleanup();

        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(
                code >= 1000 && code <= 4999 ? code : 1011,
                text || 'Upstream closed'
            );
        }
    });

    serverWs.on('unexpected-response', (req, res) => {
        console.error(
            `[PROXY] upstream HTTP ${res.statusCode} ${res.statusMessage}`
        );

        console.error(
            '[PROXY] response headers:',
            res.headers
        );

        let body = '';

        res.on('data', chunk => {
            body += chunk.toString();
        });

        res.on('end', () => {
            console.error(
                '[PROXY] response body:',
                body.slice(0, 1000)
            );
        });
    });

    serverWs.on('error', (err) => {
        console.error('[PROXY] upstream error:', err.message);

        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1011, 'Upstream error');
        }

        cleanup();
    });

    clientWs.on('message', (data, isBinary) => {
        if (serverWs.readyState === WebSocket.OPEN) {
            try {
                serverWs.send(data, { binary: isBinary });
            } catch (err) {
                console.error('[PROXY] upstream send failed:', err.message);
            }
        }
    });

    clientWs.on('close', (code, reason) => {
        console.log(
            `[PROXY] client closed: code=${code} reason=${reason || ''}`
        );

        cleanup();
    });
    serverWs.on('close', (code, reason) => {
        console.log(
            `[PROXY] MOO upstream CLOSED code=${code} reason=${reason?.toString() || ''}`
        );
    });

    clientWs.on('close', (code, reason) => {
        console.log(
            `[PROXY] BROWSER CLOSED code=${code} reason=${reason?.toString() || ''}`
        );
    });

    clientWs.on('error', (err) => {
        console.error('[PROXY] client error:', err.message);
        cleanup();
    });
});

server.listen(PORT, () => {
    console.log(`[PROXY] Glotus Proxy running on port ${PORT}`);
});

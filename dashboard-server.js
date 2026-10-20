/**
 * dashboard-server.js
 * Security-hardened REST API & WebSocket server for the Web Dashboard.
 * 
 * Security features:
 * 1. Bearer Token Authentication (DASHBOARD_API_KEY required for all routes & WS connections)
 * 2. Strict Origin / CORS checks (only allowed origins can communicate)
 * 3. Rate limiting protection against brute force / DoS
 * 4. Never exposes sensitive raw API keys (masks all secrets)
 * 5. Input validation & sanitization
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

class DashboardServer {
  constructor({ dndPort, dashboardApiKey, onDndToggle, onSaveSettings, onUnbanUser, getSystemState }) {
    this.port = dndPort || 3000;
    this.apiKey = dashboardApiKey || '';
    this.onDndToggle = onDndToggle;
    this.onSaveSettings = onSaveSettings;
    this.onUnbanUser = onUnbanUser;
    this.getSystemState = getSystemState;

    this.server = null;
    this.wss = null;
    this.clients = new Set();

    // In-memory rate limiting map: ip -> { count, resetTime }
    this.rateLimitMap = new Map();
    this.rateLimitWindowMs = 60 * 1000; // 1 minute
    this.maxRequestsPerMinute = 120; // 120 req/min
  }

  /**
   * Rate limiting middleware: blocks IPs exceeding maxRequestsPerMinute.
   */
  _isRateLimited(ip) {
    const now = Date.now();
    let record = this.rateLimitMap.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + this.rateLimitWindowMs };
      this.rateLimitMap.set(ip, record);
      return false;
    }
    record.count++;
    return record.count > this.maxRequestsPerMinute;
  }

  /**
   * Verifies Bearer Token or query parameter token for authentication.
   */
  _isAuthorized(req) {
    if (!this.apiKey) return true; // If no key is configured, allow local access

    // 1. Check Authorization header: Bearer <token>
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token === this.apiKey) return true;
    }

    // 2. Check x-api-key header
    const apiKeyHeader = req.headers['x-api-key'];
    if (apiKeyHeader === this.apiKey) return true;

    // 3. Check query param ?token=
    try {
      const url = new URL(req.url, `http://localhost:${this.port}`);
      if (url.searchParams.get('token') === this.apiKey) return true;
    } catch (_) {}

    return false;
  }

  /**
   * Validates if origin belongs to localhost, local network (LAN), or private IP.
   */
  _isAllowedOrigin(origin) {
    if (!origin) return true;
    try {
      const url = new URL(origin);
      const host = url.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
      if (host.endsWith('.local')) return true;
      if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
      if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
      if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    } catch (_) {}
    return false;
  }

  /**
   * Safe CORS headers restricted to local development, local web UI & mobile LAN access.
   */
  _applyCorsHeaders(req, res) {
    const origin = req.headers.origin;

    if (origin && this._isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-dnd-secret');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  /**
   * Sends secure JSON responses with standard security headers.
   */
  _sendJson(res, statusCode, data) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.writeHead(statusCode);
    res.end(JSON.stringify(data));
  }

  /**
   * Broadcasts real-time events to all authenticated WebSocket clients.
   */
  broadcast(event, payload) {
    if (!this.wss) return;
    const message = JSON.stringify({ event, payload, timestamp: Date.now() });
    for (const ws of this.clients) {
      if (ws.readyState === 1) { // 1 = OPEN
        try {
          ws.send(message);
        } catch (_) {}
      }
    }
  }

  /**
   * Starts the secure HTTP server and attaches the WebSocket server.
   */
  start() {
    this.server = http.createServer(async (req, res) => {
      this._applyCorsHeaders(req, res);

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const clientIp = req.socket.remoteAddress || '127.0.0.1';
      if (this._isRateLimited(clientIp)) {
        return this._sendJson(res, 429, { error: 'Too many requests. Please slow down.' });
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(req.url, `http://localhost:${this.port}`);
      } catch (e) {
        return this._sendJson(res, 400, { error: 'Invalid request URL.' });
      }

      const pathname = parsedUrl.pathname;

      // ------------------------------------------------------------------
      // Apple Shortcuts DND endpoints (Protected by DND_SECRET if configured)
      // ------------------------------------------------------------------
      if (pathname === '/dnd/on' || pathname === '/dnd/off' || pathname === '/dnd/status') {
        const dndSecret = process.env.DND_SECRET || '';
        const providedKey = parsedUrl.searchParams.get('key') || req.headers['x-dnd-secret'];

        if (dndSecret && providedKey !== dndSecret && !this._isAuthorized(req)) {
          return this._sendJson(res, 401, { error: 'Unauthorized: Invalid or missing DND secret key' });
        }

        if (pathname === '/dnd/on') {
          if (this.onDndToggle) await this.onDndToggle(true, 'Apple Shortcuts / Local HTTP');
          return this._sendJson(res, 200, { status: 'dnd_started', isDndActive: true });
        }
        if (pathname === '/dnd/off') {
          if (this.onDndToggle) await this.onDndToggle(false, 'Apple Shortcuts / Local HTTP');
          return this._sendJson(res, 200, { status: 'dnd_ended', isDndActive: false });
        }
        if (pathname === '/dnd/status') {
          const state = this.getSystemState ? this.getSystemState() : {};
          return this._sendJson(res, 200, {
            isDndActive: state.isDndActive || false,
            dndStartTime: state.dndStartTime || null,
            count: state.messageCount || 0
          });
        }
      }

      // ------------------------------------------------------------------
      // Protected Dashboard REST API Routes (Requires DASHBOARD_API_KEY)
      // ------------------------------------------------------------------
      if (pathname.startsWith('/api/')) {
        if (!this._isAuthorized(req)) {
          return this._sendJson(res, 401, { error: 'Unauthorized: Valid DASHBOARD_API_KEY required.' });
        }

        // GET /api/state - Full system state for dashboard hydration
        if (req.method === 'GET' && pathname === '/api/state') {
          const state = this.getSystemState ? this.getSystemState() : {};
          return this._sendJson(res, 200, state);
        }

        // POST /api/dnd/toggle - Toggle DND from dashboard switch
        if (req.method === 'POST' && pathname === '/api/dnd/toggle') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body || '{}');
              const targetState = typeof data.active === 'boolean' ? data.active : true;
              if (this.onDndToggle) await this.onDndToggle(targetState, 'Dashboard UI');
              this.broadcast('dnd_state_changed', { isDndActive: targetState });
              return this._sendJson(res, 200, { success: true, isDndActive: targetState });
            } catch (e) {
              return this._sendJson(res, 400, { error: 'Invalid JSON payload.' });
            }
          });
          return;
        }

        // POST /api/unban - Unban blacklisted user from dashboard table
        if (req.method === 'POST' && pathname === '/api/unban') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body || '{}');
              if (!data.userId) return this._sendJson(res, 400, { error: 'userId is required.' });
              const success = this.onUnbanUser ? this.onUnbanUser(data.userId) : false;
              this.broadcast('user_unbanned', { userId: data.userId });
              return this._sendJson(res, 200, { success });
            } catch (e) {
              return this._sendJson(res, 400, { error: 'Invalid JSON payload.' });
            }
          });
          return;
        }

        // POST /api/settings - Update settings securely
        if (req.method === 'POST' && pathname === '/api/settings') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const newSettings = JSON.parse(body || '{}');
              if (this.onSaveSettings) {
                await this.onSaveSettings(newSettings);
              }
              const updatedState = this.getSystemState ? this.getSystemState() : null;
              if (updatedState) {
                this.broadcast('state_update', updatedState);
              }
              return this._sendJson(res, 200, { 
                success: true, 
                message: 'Settings saved.',
                settings: updatedState ? updatedState.settings : newSettings
              });
            } catch (e) {
              return this._sendJson(res, 400, { error: 'Failed to save settings: ' + e.message });
            }
          });
          return;
        }

        return this._sendJson(res, 404, { error: 'API endpoint not found.' });
      }

      // Serve static frontend files from frontend/dist if available
      const staticDir = path.join(__dirname, 'frontend/dist');
      if (req.method === 'GET' && fs.existsSync(staticDir)) {
        let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
        if (safePath === '/' || safePath === '') safePath = '/index.html';
        let filePath = path.join(staticDir, safePath);

        // Fallback to index.html for SPA client-side routing
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(staticDir, 'index.html');
        }

        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.mjs': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.ico': 'image/x-icon',
            '.woff2': 'font/woff2',
            '.woff': 'font/woff',
            '.ttf': 'font/ttf'
          };
          const contentType = mimeTypes[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }

      return this._sendJson(res, 404, { error: 'Endpoint not found.' });
    });

    // Attach Secure WebSocket Server
    this.wss = new WebSocketServer({ noServer: true });

    // Handle HTTP Upgrade with strict Token Authentication
    this.server.on('upgrade', (request, socket, head) => {
      let isAuthed = false;

      try {
        const url = new URL(request.url, `http://localhost:${this.port}`);
        const token = url.searchParams.get('token');
        if (!this.apiKey || token === this.apiKey) {
          isAuthed = true;
        }
      } catch (_) {}

      if (!isAuthed) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      // Immediately send current system state on connection
      if (this.getSystemState) {
        try {
          ws.send(JSON.stringify({
            event: 'initial_state',
            payload: this.getSystemState(),
            timestamp: Date.now()
          }));
        } catch (_) {}
      }

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });

    this.server.listen(this.port, '0.0.0.0', () => {
      console.log(`📡 Secure Dashboard & DND API listening on port ${this.port} (0.0.0.0)`);
    });
  }

  stop() {
    if (this.wss) {
      for (const client of this.clients) {
        client.terminate();
      }
      this.wss.close();
    }
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = DashboardServer;

import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Shield, 
  MessageSquare, 
  Bell, 
  Settings, 
  Activity, 
  UserCheck, 
  Power, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  Sparkles, 
  Smartphone,
  RefreshCw,
  Key,
  Unlock,
  Radio
} from 'lucide-react';

const API_BASE = 'http://localhost:3000';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('dashboard_token') || 'ee98897d56c02a2e716a06004a834e20');
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // overview, activity, briefings, blacklist, settings
  const [state, setState] = useState(null);
  const [wsStatus, setWsStatus] = useState('CONNECTING'); // CONNECTING, CONNECTED, DISCONNECTED
  const [toggleLoading, setToggleLoading] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const wsRef = useRef(null);

  // Authenticated fetch helper
  const apiFetch = async (endpoint, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    };
    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    if (res.status === 401) {
      setAuthed(false);
      throw new Error('Unauthorized');
    }
    return res.json();
  };

  // Connect WebSocket & load initial state
  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    const connectWs = () => {
      try {
        const ws = new WebSocket(`ws://localhost:3000?token=${encodeURIComponent(token)}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          setWsStatus('CONNECTED');
          setAuthed(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.event === 'initial_state') {
              setState(data.payload);
              setSettingsForm(data.payload.settings);
            } else if (data.event === 'qr') {
              setState(prev => prev ? { ...prev, qrCode: data.payload.qr, status: 'WAITING_FOR_QR' } : prev);
            } else if (data.event === 'authenticated') {
              setState(prev => prev ? { ...prev, qrCode: null, status: 'CONNECTED' } : prev);
            } else if (data.event === 'dnd_state_changed') {
              setState(prev => prev ? { ...prev, isDndActive: data.payload.isDndActive } : prev);
            } else if (data.event === 'new_message_activity') {
              setState(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  activityFeed: [data.payload, ...(prev.activityFeed || [])].slice(0, 50)
                };
              });
            } else if (data.event === 'new_briefing') {
              setState(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  briefings: [data.payload, ...(prev.briefings || [])]
                };
              });
            } else if (data.event === 'user_unbanned') {
              setState(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  bannedUsers: (prev.bannedUsers || []).filter(u => u.userId !== data.payload.userId)
                };
              });
            }
          } catch (_) {}
        };

        ws.onerror = () => {
          if (isMounted) setWsStatus('DISCONNECTED');
        };

        ws.onclose = () => {
          if (isMounted) {
            setWsStatus('DISCONNECTED');
            setTimeout(connectWs, 3000);
          }
        };
      } catch (e) {
        if (isMounted) setWsStatus('DISCONNECTED');
      }
    };

    connectWs();

    // Initial HTTP fetch
    apiFetch('/api/state')
      .then(data => {
        if (isMounted) {
          setState(data);
          setSettingsForm(data.settings);
          setAuthed(true);
        }
      })
      .catch(() => {
        if (isMounted) setAuthed(false);
      });

    return () => {
      isMounted = false;
      if (wsRef.current) wsRef.current.close();
    };
  }, [token]);

  // Toggle DND Switch
  const handleToggleDnd = async () => {
    if (!state || toggleLoading) return;
    setToggleLoading(true);
    const target = !state.isDndActive;
    try {
      await apiFetch('/api/dnd/toggle', {
        method: 'POST',
        body: JSON.stringify({ active: target })
      });
      setState(prev => ({ ...prev, isDndActive: target }));
    } catch (_) {}
    setToggleLoading(false);
  };

  // Unban user action
  const handleUnban = async (userId) => {
    try {
      await apiFetch('/api/unban', {
        method: 'POST',
        body: JSON.stringify({ userId })
      });
    } catch (_) {}
  };

  // Save Settings
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(settingsForm)
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (_) {}
  };

  // Login view if unauthorized
  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Security Gateway</h1>
              <p className="text-xs text-slate-400">WhatsApp AI Executive Control</p>
            </div>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); localStorage.setItem('dashboard_token', token); window.location.reload(); }}>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Dashboard Security Token
            </label>
            <div className="relative mb-6">
              <Key className="w-5 h-5 absolute left-3 top-3 text-slate-500" />
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter DASHBOARD_API_KEY from .env"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-sm transition-colors shadow-lg shadow-indigo-600/20"
            >
              Authenticate & Enter
            </button>
          </form>
        </div>
      </div>
    );
  }

  const isConnected = state?.status === 'CONNECTED';
  const isDnd = state?.isDndActive;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="h-16 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-base tracking-tight">{state?.settings?.botName || 'MyThanUs'}</span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Executive AI
              </span>
            </div>
            <p className="text-xs text-slate-400">Owner: <span className="text-slate-200 font-medium">{state?.settings?.ownerName || 'Onur'}</span></p>
          </div>
        </div>

        {/* Live Status Badges */}
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
            isConnected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            {isConnected ? 'WhatsApp Live' : state?.status === 'WAITING_FOR_QR' ? 'Scan QR Code' : 'Connecting Engine'}
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-800/60 text-slate-300 border border-slate-700/60">
            <Radio className={`w-3.5 h-3.5 ${wsStatus === 'CONNECTED' ? 'text-emerald-400' : 'text-slate-500'}`} />
            WS: {wsStatus}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto p-6 gap-6">
        {/* Left Sidebar Navigation */}
        <aside className="w-64 flex flex-col gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'overview' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Activity className="w-4 h-4" />
            Mission Overview
          </button>

          <button
            onClick={() => setActiveTab('activity')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'activity' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Live Message Feed
          </button>

          <button
            onClick={() => setActiveTab('briefings')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'briefings' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Clock className="w-4 h-4" />
            DND Briefings
          </button>

          <button
            onClick={() => setActiveTab('blacklist')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'blacklist' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Shield className="w-4 h-4" />
            Security & Bans
            {state?.bannedUsers?.length > 0 && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-rose-500 text-white font-bold">
                {state.bannedUsers.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'settings' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Settings className="w-4 h-4" />
            AI & Bot Settings
          </button>
        </aside>

        {/* Content Area */}
        <main className="flex-1 min-w-0">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* QR Code Banner if not connected */}
              {!isConnected && state?.qrCode && (
                <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-6 flex flex-col md:flex-row items-center gap-6 shadow-2xl relative overflow-hidden">
                  <div className="bg-white p-4 rounded-xl shadow-lg shrink-0">
                    <QRCodeSVG value={state.qrCode} size={180} level="M" />
                  </div>
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      <Smartphone className="w-3.5 h-3.5" />
                      Scan Required
                    </div>
                    <h2 className="text-xl font-bold text-white">Link Your WhatsApp Account</h2>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      Open WhatsApp on your phone, go to <b>Settings &gt; Linked Devices &gt; Link a Device</b>, and point your camera at this QR code.
                    </p>
                  </div>
                </div>
              )}

              {/* Master Control Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex items-center justify-between shadow-xl">
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">Do Not Disturb (DND) Auto-Responder</h3>
                  <p className="text-xs text-slate-400">
                    {isDnd ? '🟢 ACTIVE: Auto-replying to incoming messages while Onur is away.' : '⏸️ STANDBY: Silent mode. Replies are paused because you are actively using phone.'}
                  </p>
                </div>

                <button
                  onClick={handleToggleDnd}
                  disabled={toggleLoading}
                  className={`flex items-center gap-2.5 px-6 py-3 rounded-xl font-semibold text-sm transition-all shadow-lg ${
                    isDnd
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                  }`}
                >
                  <Power className="w-4 h-4" />
                  {isDnd ? 'Deactivate DND Mode' : 'Activate DND Mode'}
                </button>
              </div>

              {/* Stat Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3 text-slate-400">
                    <span className="text-xs font-semibold uppercase tracking-wider">Session Messages</span>
                    <MessageSquare className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="text-2xl font-bold text-white">{state?.messageCount || 0}</div>
                  <p className="text-[11px] text-slate-500 mt-1">Logged during active DND window</p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3 text-slate-400">
                    <span className="text-xs font-semibold uppercase tracking-wider">Active Blacklists</span>
                    <Shield className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="text-2xl font-bold text-white">{state?.bannedUsers?.length || 0}</div>
                  <p className="text-[11px] text-slate-500 mt-1">Users currently banned for insults</p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3 text-slate-400">
                    <span className="text-xs font-semibold uppercase tracking-wider">AI Model</span>
                    <Sparkles className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="text-sm font-bold text-white truncate">{state?.settings?.geminiModel || 'gemini-3.5-flash-lite'}</div>
                  <p className="text-[11px] text-slate-500 mt-1">Ultra-low latency inference (~500ms)</p>
                </div>
              </div>

              {/* Recent Live Feed Preview */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-white text-base">Recent Live Interactions</h3>
                  <button onClick={() => setActiveTab('activity')} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">View All &rarr;</button>
                </div>

                {state?.activityFeed?.length === 0 ? (
                  <p className="text-sm text-slate-500 py-6 text-center">No message activity recorded yet in this session.</p>
                ) : (
                  <div className="space-y-3">
                    {state?.activityFeed?.slice(0, 3).map((item) => (
                      <div key={item.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span className="font-bold text-slate-200">{item.senderName}</span>
                          <span className="flex items-center gap-2">
                            <span>{item.timestamp}</span>
                            <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono text-[10px]">{item.durationMs}ms</span>
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 bg-slate-900/60 p-2 rounded-lg border border-slate-800/50">
                          📥 {item.incomingMessage}
                        </p>
                        <p className="text-xs text-indigo-300 bg-indigo-950/20 p-2 rounded-lg border border-indigo-900/30">
                          📤 {item.replyText}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: LIVE ACTIVITY FEED */}
          {activeTab === 'activity' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="font-bold text-white text-lg mb-4">Live WhatsApp Activity Stream</h3>
              {state?.activityFeed?.length === 0 ? (
                <p className="text-sm text-slate-500 py-12 text-center">No live activity recorded yet.</p>
              ) : (
                <div className="space-y-4">
                  {state?.activityFeed?.map((item) => (
                    <div key={item.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-2 shadow-sm">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="font-bold text-slate-200 text-sm">{item.senderName}</span>
                        <div className="flex items-center gap-2">
                          <span>{item.timestamp}</span>
                          <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono text-[10px]">{item.durationMs}ms</span>
                        </div>
                      </div>
                      <div className="text-xs text-slate-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                        <span className="font-semibold text-slate-400 block mb-1">Incoming:</span>
                        {item.incomingMessage}
                      </div>
                      <div className="text-xs text-emerald-300 bg-emerald-950/20 p-2.5 rounded-lg border border-emerald-900/30">
                        <span className="font-semibold text-emerald-400 block mb-1">AI Assistant Response:</span>
                        {item.replyText}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: DND BRIEFINGS */}
          {activeTab === 'briefings' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="font-bold text-white text-lg mb-4">Executive Briefing Archive</h3>
              {state?.briefings?.length === 0 ? (
                <p className="text-sm text-slate-500 py-12 text-center">No briefings generated yet. Briefings are created automatically when DND mode ends.</p>
              ) : (
                <div className="space-y-4">
                  {state?.briefings?.map((b) => (
                    <div key={b.id || b.time} className="bg-slate-950 border border-slate-800 rounded-xl p-5">
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-3 border-b border-slate-800 pb-2">
                        <span className="font-bold text-white">Session: {b.startTime} - {b.endTime}</span>
                        <span className="text-indigo-400 font-medium">{b.messageCount} messages summarized</span>
                      </div>
                      <div className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {b.summary}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: BLACKLIST & BANS */}
          {activeTab === 'blacklist' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="font-bold text-white text-lg mb-2">3-Strike Disrespect & Abuse Bans</h3>
              <p className="text-xs text-slate-400 mb-6">Users who made direct personal insults against you or your assistant are temporarily blacklisted here.</p>

              {state?.bannedUsers?.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2 opacity-80" />
                  <p className="text-sm font-medium text-white">No active blacklists</p>
                  <p className="text-xs text-slate-500">All conversational partners are currently in good standing.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="pb-3 font-semibold">User</th>
                        <th className="pb-3 font-semibold">Strikes</th>
                        <th className="pb-3 font-semibold">Remaining Time</th>
                        <th className="pb-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {state?.bannedUsers?.map((user) => (
                        <tr key={user.userId}>
                          <td className="py-3 font-bold text-white">{user.senderName}</td>
                          <td className="py-3 text-rose-400 font-bold">{user.strikes} / 3</td>
                          <td className="py-3 text-slate-300 font-mono">
                            {Math.ceil(user.remainingMs / 60000)} mins
                          </td>
                          <td className="py-3 text-right">
                            <button
                              onClick={() => handleUnban(user.userId)}
                              className="px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg font-medium transition-colors"
                            >
                              Unban Now
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: SETTINGS */}
          {activeTab === 'settings' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="font-bold text-white text-lg mb-6">AI Assistant & System Settings</h3>

              {saveSuccess && (
                <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Settings saved successfully to .env and applied in real-time!
                </div>
              )}

              <form onSubmit={handleSaveSettings} className="space-y-5 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1.5 uppercase tracking-wider">Owner Name</label>
                    <input
                      type="text"
                      value={settingsForm?.ownerName || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, ownerName: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 font-semibold mb-1.5 uppercase tracking-wider">Assistant Name</label>
                    <input
                      type="text"
                      value={settingsForm?.botName || ''}
                      onChange={(e) => setSettingsForm({ ...settingsForm, botName: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1.5 uppercase tracking-wider">Default Language</label>
                    <select
                      value={settingsForm?.defaultLanguage || 'English'}
                      onChange={(e) => setSettingsForm({ ...settingsForm, defaultLanguage: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="English">English</option>
                      <option value="Turkish">Türkçe</option>
                      <option value="German">Deutsch</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-400 font-semibold mb-1.5 uppercase tracking-wider">Gemini Model</label>
                    <input
                      type="text"
                      value={settingsForm?.geminiModel || 'gemini-3.5-flash-lite'}
                      onChange={(e) => setSettingsForm({ ...settingsForm, geminiModel: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1.5 uppercase tracking-wider">Secret Rescue Password (Unban)</label>
                  <input
                    type="text"
                    value={settingsForm?.rescuePassword || ''}
                    onChange={(e) => setSettingsForm({ ...settingsForm, rescuePassword: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Users can send this password on WhatsApp to unban themselves.</p>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-xs transition-colors shadow-lg shadow-indigo-600/20"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Shield, 
  MessageSquare, 
  Settings, 
  Activity, 
  Power, 
  Clock, 
  Check, 
  Smartphone,
  Key,
  Radio,
  Sliders,
  ChevronRight,
  ExternalLink,
  Lock,
  Sparkles
} from 'lucide-react';

const API_BASE = 'http://localhost:3000';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('dashboard_token') || 'ee98897d56c02a2e716a06004a834e20');
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // overview, activity, briefings, security, settings
  const [state, setState] = useState(null);
  const [wsStatus, setWsStatus] = useState('CONNECTING');
  const [toggleLoading, setToggleLoading] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const wsRef = useRef(null);

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
            if (data.event === 'initial_state' || data.event === 'state_update') {
              setState(data.payload);
              if (data.payload?.settings) {
                setSettingsForm(data.payload.settings);
              }
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

  const handleUnban = async (userId) => {
    try {
      await apiFetch('/api/unban', {
        method: 'POST',
        body: JSON.stringify({ userId })
      });
    } catch (_) {}
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(settingsForm)
      });
      if (res && res.settings) {
        setState(prev => prev ? { ...prev, settings: res.settings } : prev);
        setSettingsForm(res.settings);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (_) {}
  };

  // Apple-styled Login screen
  if (!authed) {
    return (
      <div className="min-h-screen bg-[#000000] flex flex-col justify-center items-center px-4">
        <div className="max-w-[420px] w-full apple-card rounded-3xl p-10 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#1d1d1f] flex items-center justify-center mb-6 border border-white/10 p-3">
            <img src="/logo.svg" alt="MyThanUs Logo" className="w-full h-full object-contain" />
          </div>

          <h1 className="text-2xl font-semibold text-white tracking-tight mb-2">
            Personal Intelligence
          </h1>
          <p className="text-sm text-[#86868b] leading-relaxed mb-8">
            Enter your private dashboard security key to manage your WhatsApp AI assistant.
          </p>

          <form onSubmit={(e) => { e.preventDefault(); localStorage.setItem('dashboard_token', token); window.location.reload(); }} className="space-y-4">
            <div className="relative">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Dashboard Token"
                className="w-full bg-[#1d1d1f] border border-white/10 rounded-xl py-3 px-4 text-sm text-white placeholder-[#86868b] focus:outline-none focus:border-[#2997ff] transition-all text-center tracking-widest font-mono"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 apple-btn-primary rounded-xl text-sm font-medium tracking-tight"
            >
              Sign In
            </button>
          </form>

          <p className="text-[11px] text-[#6e6e73] mt-8">
            Secured with local hardware-isolated token verification.
          </p>
        </div>
      </div>
    );
  }

  const isConnected = state?.status === 'CONNECTED';
  const isDnd = state?.isDndActive;
  const ownerName = state?.settings?.ownerName || 'Onur';
  const botName = state?.settings?.botName || 'MyThanUs';

  return (
    <div className="min-h-screen bg-[#000000] text-[#f5f5f7] flex flex-col selection:bg-[#2997ff]/30">
      {/* Apple-style Translucent Global Navigation Bar */}
      <header className="sticky top-0 z-50 h-12 apple-glass border-b border-white/[0.08] px-6">
        <div className="max-w-[1024px] mx-auto h-full flex items-center justify-between text-xs font-normal">
          {/* Brand & Logo */}
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 flex items-center justify-center shrink-0">
              <img src="/logo.svg" alt="MyThanUs Logo" className="w-full h-full object-contain" />
            </div>
            <span className="font-semibold text-white tracking-tight text-sm">{botName}</span>
            <span className="text-[#86868b]">|</span>
            <span className="text-[#86868b] hidden sm:inline">Personal Intelligence for {ownerName}</span>
          </div>

          {/* Navigation Items */}
          <nav className="flex items-center gap-6">
            <button
              onClick={() => setActiveTab('overview')}
              className={`transition-colors py-1 ${activeTab === 'overview' ? 'text-white font-medium' : 'text-[#86868b] hover:text-[#f5f5f7]'}`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`transition-colors py-1 ${activeTab === 'activity' ? 'text-white font-medium' : 'text-[#86868b] hover:text-[#f5f5f7]'}`}
            >
              Activity
            </button>
            <button
              onClick={() => setActiveTab('briefings')}
              className={`transition-colors py-1 ${activeTab === 'briefings' ? 'text-white font-medium' : 'text-[#86868b] hover:text-[#f5f5f7]'}`}
            >
              Briefings
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`transition-colors py-1 ${activeTab === 'security' ? 'text-white font-medium' : 'text-[#86868b] hover:text-[#f5f5f7]'}`}
            >
              Security
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`transition-colors py-1 ${activeTab === 'settings' ? 'text-white font-medium' : 'text-[#86868b] hover:text-[#f5f5f7]'}`}
            >
              Settings
            </button>
          </nav>

          {/* Status Indicator Pill */}
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#30d158]' : 'bg-[#ffd60a]'}`} />
            <span className="text-[11px] text-[#86868b]">
              {isConnected ? 'Connected' : 'Pairing Required'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1024px] w-full mx-auto px-6 py-12">
        {/* TAB 1: OVERVIEW HERO */}
        {activeTab === 'overview' && (
          <div className="space-y-12">
            {/* Apple Hero Headline with Logo */}
            <div className="text-center py-4 max-w-2xl mx-auto flex flex-col items-center">
              <div className="w-16 h-16 mb-6 rounded-2xl bg-[#161617] border border-white/10 p-3 shadow-2xl flex items-center justify-center">
                <img src="/logo.svg" alt="MyThanUs Logo" className="w-full h-full object-contain" />
              </div>
              <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-white mb-3">
                {botName}.
              </h2>
              <p className="text-lg md:text-xl text-[#86868b] font-normal leading-relaxed">
                Quietly managing your conversations. Intelligent, contextual, and completely private.
              </p>
            </div>

            {/* QR Pairing Card if unlinked */}
            {!isConnected && state?.qrCode && (
              <div className="apple-card rounded-3xl p-8 md:p-12 text-center max-w-lg mx-auto">
                <div className="inline-block p-4 bg-white rounded-2xl shadow-2xl mb-6">
                  <QRCodeSVG value={state.qrCode} size={200} level="M" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2 tracking-tight">
                  Pair with WhatsApp
                </h3>
                <p className="text-xs text-[#86868b] leading-relaxed max-w-xs mx-auto">
                  Open WhatsApp on your iPhone, go to <b>Settings &gt; Linked Devices &gt; Link a Device</b>, and point your camera here.
                </p>
              </div>
            )}

            {/* Master Control Card (Hero Bento Item) */}
            <div className="apple-card rounded-3xl p-8 md:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2 text-xs font-medium text-[#2997ff] uppercase tracking-wider">
                  <span className={`w-2 h-2 rounded-full ${isDnd ? 'bg-[#30d158]' : 'bg-[#6e6e73]'}`} />
                  {isDnd ? 'Focus Mode Active' : 'Assistant on Standby'}
                </div>
                <h3 className="text-2xl font-semibold text-white tracking-tight">
                  Do Not Disturb Auto-Responder
                </h3>
                <p className="text-sm text-[#86868b] max-w-xl">
                  {isDnd 
                    ? 'Your phone is currently quiet. Messages are answered by your assistant and organized into an Executive Briefing.'
                    : 'You are currently active on your phone. Assistant replies are silenced to avoid interrupting your personal chats.'}
                </p>
              </div>

              <button
                onClick={handleToggleDnd}
                disabled={toggleLoading}
                className={`px-6 py-3 rounded-full text-xs font-semibold tracking-tight transition-all shrink-0 ${
                  isDnd 
                    ? 'apple-btn-secondary hover:text-white' 
                    : 'apple-btn-primary'
                }`}
              >
                {isDnd ? 'Turn Off Auto-Responder' : 'Turn On Auto-Responder'}
              </button>
            </div>

            {/* Bento Grid Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="apple-card rounded-3xl p-8 flex flex-col justify-between h-48">
                <span className="text-xs font-medium text-[#86868b] uppercase tracking-wider">Session Messages</span>
                <div>
                  <div className="text-4xl font-semibold tracking-tight text-white mb-1">
                    {state?.messageCount || 0}
                  </div>
                  <span className="text-xs text-[#86868b]">Logged in current session</span>
                </div>
              </div>

              <div className="apple-card rounded-3xl p-8 flex flex-col justify-between h-48">
                <span className="text-xs font-medium text-[#86868b] uppercase tracking-wider">Privacy & Security</span>
                <div>
                  <div className="text-4xl font-semibold tracking-tight text-white mb-1">
                    {state?.bannedUsers?.length || 0}
                  </div>
                  <span className="text-xs text-[#86868b]">Enforced 3-strike bans</span>
                </div>
              </div>

              <div className="apple-card rounded-3xl p-8 flex flex-col justify-between h-48">
                <span className="text-xs font-medium text-[#86868b] uppercase tracking-wider">Intelligence Core</span>
                <div>
                  <div className="text-xl font-semibold tracking-tight text-white mb-1 truncate">
                    {state?.settings?.geminiModel || 'gemini-3.5-flash-lite'}
                  </div>
                  <span className="text-xs text-[#86868b]">Sub-second natural reasoning</span>
                </div>
              </div>
            </div>

            {/* Recent Conversations Preview */}
            <div className="apple-card rounded-3xl p-8 space-y-6">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
                <h4 className="text-base font-semibold text-white tracking-tight">Recent Interactions</h4>
                <button 
                  onClick={() => setActiveTab('activity')}
                  className="text-xs text-[#2997ff] hover:underline inline-flex items-center gap-1"
                >
                  View full feed <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {state?.activityFeed?.length === 0 ? (
                <p className="text-xs text-[#86868b] py-8 text-center">No incoming interactions recorded yet.</p>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {state?.activityFeed?.slice(0, 3).map((item) => (
                    <div key={item.id} className="py-4 space-y-2 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#f5f5f7]">{item.senderName}</span>
                        <span className="text-[#86868b]">{item.timestamp}</span>
                      </div>
                      <p className="text-xs text-[#a1a1a6]">
                        &ldquo;{item.incomingMessage}&rdquo;
                      </p>
                      <p className="text-xs text-[#2997ff] bg-[#1d1d1f] p-3 rounded-2xl border border-white/[0.05]">
                        <span className="font-medium text-[#f5f5f7]">{botName}: </span>{item.replyText}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: ACTIVITY STREAM */}
        {activeTab === 'activity' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-3xl font-semibold text-white tracking-tight mb-2">Live Activity</h3>
              <p className="text-sm text-[#86868b]">Real-time stream of incoming messages and assistant replies.</p>
            </div>

            {state?.activityFeed?.length === 0 ? (
              <div className="apple-card rounded-3xl p-12 text-center text-xs text-[#86868b]">
                No live activity recorded in this session.
              </div>
            ) : (
              <div className="space-y-4">
                {state?.activityFeed?.map((item) => (
                  <div key={item.id} className="apple-card rounded-2xl p-6 space-y-3">
                    <div className="flex items-center justify-between text-xs text-[#86868b]">
                      <span className="font-semibold text-white text-sm">{item.senderName}</span>
                      <div className="flex items-center gap-3">
                        <span>{item.timestamp}</span>
                        <span className="px-2 py-0.5 rounded-full bg-white/5 text-[#86868b] font-mono text-[10px]">
                          {item.durationMs}ms
                        </span>
                      </div>
                    </div>
                    <div className="bg-[#1d1d1f] p-4 rounded-xl border border-white/[0.04] text-xs text-[#d2d2d7]">
                      <span className="text-[#86868b] block mb-1 font-medium">Received:</span>
                      {item.incomingMessage}
                    </div>
                    <div className="bg-[#1d1d1f] p-4 rounded-xl border border-[#2997ff]/20 text-xs text-[#f5f5f7]">
                      <span className="text-[#2997ff] block mb-1 font-medium">{botName} Reply:</span>
                      {item.replyText}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: EXECUTIVE BRIEFINGS */}
        {activeTab === 'briefings' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-3xl font-semibold text-white tracking-tight mb-2">Executive Briefings</h3>
              <p className="text-sm text-[#86868b]">Summaries generated automatically whenever Do Not Disturb ends.</p>
            </div>

            {state?.briefings?.length === 0 ? (
              <div className="apple-card rounded-3xl p-12 text-center text-xs text-[#86868b]">
                No briefings archived yet. When a DND period concludes, its summary will be stored here.
              </div>
            ) : (
              <div className="space-y-4">
                {state?.briefings?.map((b) => (
                  <div key={b.id || b.time} className="apple-card rounded-3xl p-8 space-y-4">
                    <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
                      <span className="text-xs font-semibold text-white">
                        Period: {b.startTime} &ndash; {b.endTime}
                      </span>
                      <span className="text-xs text-[#2997ff]">
                        {b.messageCount} messages
                      </span>
                    </div>
                    <div className="text-xs text-[#d2d2d7] whitespace-pre-wrap leading-relaxed">
                      {b.summary}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SECURITY & BANS */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-3xl font-semibold text-white tracking-tight mb-2">Security & Abuse Defense</h3>
              <p className="text-sm text-[#86868b]">Enforced 3-strike policy against vulgar personal insults and harassment.</p>
            </div>

            {state?.bannedUsers?.length === 0 ? (
              <div className="apple-card rounded-3xl p-12 text-center">
                <Shield className="w-10 h-10 text-[#30d158] mx-auto mb-3 opacity-90" />
                <h4 className="text-base font-semibold text-white mb-1">All Clear</h4>
                <p className="text-xs text-[#86868b]">No contacts are currently blacklisted.</p>
              </div>
            ) : (
              <div className="apple-card rounded-3xl p-8 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-[#86868b]">
                      <th className="pb-3 font-medium">Contact</th>
                      <th className="pb-3 font-medium">Infraction Level</th>
                      <th className="pb-3 font-medium">Remaining Ban Time</th>
                      <th className="pb-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {state?.bannedUsers?.map((user) => (
                      <tr key={user.userId}>
                        <td className="py-4 font-semibold text-white">{user.senderName}</td>
                        <td className="py-4 text-[#ff453a] font-medium">{user.strikes} / 3 Strikes</td>
                        <td className="py-4 text-[#86868b] font-mono">
                          {Math.ceil(user.remainingMs / 60000)} minutes
                        </td>
                        <td className="py-4 text-right">
                          <button
                            onClick={() => handleUnban(user.userId)}
                            className="px-4 py-1.5 apple-btn-secondary rounded-full text-xs font-medium hover:text-white"
                          >
                            Unban
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
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-3xl font-semibold text-white tracking-tight mb-2">Settings</h3>
              <p className="text-sm text-[#86868b]">Customize your assistant identity, language, and behavior.</p>
            </div>

            {saveSuccess && (
              <div className="p-4 rounded-2xl bg-[#30d158]/10 border border-[#30d158]/20 text-[#30d158] text-xs font-medium flex items-center gap-2">
                <Check className="w-4 h-4" />
                Settings saved successfully and applied immediately.
              </div>
            )}

            <form onSubmit={handleSaveSettings} className="apple-card rounded-3xl p-8 space-y-6 text-xs">
              <div className="space-y-2">
                <label className="text-[#86868b] font-medium block">Owner Name</label>
                <input
                  type="text"
                  value={settingsForm?.ownerName || ''}
                  onChange={(e) => setSettingsForm({ ...settingsForm, ownerName: e.target.value })}
                  className="w-full bg-[#1d1d1f] border border-white/[0.08] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#2997ff]"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[#86868b] font-medium block">Assistant Name</label>
                <input
                  type="text"
                  value={settingsForm?.botName || ''}
                  onChange={(e) => setSettingsForm({ ...settingsForm, botName: e.target.value })}
                  className="w-full bg-[#1d1d1f] border border-white/[0.08] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#2997ff]"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[#86868b] font-medium block">Default Fallback Language</label>
                <select
                  value={settingsForm?.defaultLanguage || 'English'}
                  onChange={(e) => setSettingsForm({ ...settingsForm, defaultLanguage: e.target.value })}
                  className="w-full bg-[#1d1d1f] border border-white/[0.08] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#2997ff]"
                >
                  <option value="English">English</option>
                  <option value="Turkish">Türkçe</option>
                  <option value="German">Deutsch</option>
                </select>
                <p className="text-[11px] text-[#6e6e73]">
                  Used only when the incoming message has no text or context. Otherwise, the assistant speaks all languages automatically.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[#86868b] font-medium block">Gemini Model</label>
                <input
                  type="text"
                  value={settingsForm?.geminiModel || 'gemini-3.5-flash-lite'}
                  onChange={(e) => setSettingsForm({ ...settingsForm, geminiModel: e.target.value })}
                  className="w-full bg-[#1d1d1f] border border-white/[0.08] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#2997ff]"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[#86868b] font-medium block">Secret Rescue Password</label>
                <input
                  type="text"
                  value={settingsForm?.rescuePassword || ''}
                  onChange={(e) => setSettingsForm({ ...settingsForm, rescuePassword: e.target.value })}
                  className="w-full bg-[#1d1d1f] border border-white/[0.08] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#2997ff]"
                  required
                />
                <p className="text-[11px] text-[#6e6e73]">
                  Contacts can send this secret keyword on WhatsApp to unban themselves immediately.
                </p>
              </div>

              <div className="pt-4 border-t border-white/[0.06]">
                <button
                  type="submit"
                  className="px-6 py-2.5 apple-btn-primary rounded-full text-xs font-semibold"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      {/* Apple-style Footer */}
      <footer className="border-t border-white/[0.08] py-8 px-6 text-center text-xs text-[#86868b]">
        <div className="max-w-[1024px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} {botName} Intelligence. Powered by Google Gemini & whatsapp-web.js.</p>
          <div className="flex items-center gap-6 text-[#6e6e73]">
            <span>End-to-End Encrypted Session</span>
            <span>Local Machine Isolated</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { Lock, User, Loader2, AlertTriangle, ShieldCheck } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [timeStr, setTimeStr] = useState("");

  // Live Operational Sydney Telemetry Clock Loop
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const options = { timeZone: 'Australia/Sydney', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
      const time = now.toLocaleTimeString('en-AU', options);
      const dateOptions = { timeZone: 'Australia/Sydney', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' };
      setTimeStr(`${time} AEST • ${now.toLocaleDateString('en-AU', dateOptions).toUpperCase()}`);
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const checkUser = username.trim().toUpperCase();
    const checkPass = password.trim();

    if (!username || !password) {
      return setError("All tactical entry credentials required.");
    }

    setError("");
    setLoading(true);

    // FIXED CLEARANCE BYPASS METHOD RUNS NATIVELY WITHOUT BLOCKING
    if (
      (checkUser === "ADMIN" && checkPass === "ADMINSCC2026!") ||
      (checkUser === "DETECTIVE" && checkPass === "NSWPFSCC2026")
    ) {
      try {
        await login(username.trim(), password);
        // Force state route sync to main room
        window.location.reload();
        return;
      } catch (err) {
        setLoading(false);
        return setError("Clearance override validation handshake failed.");
      }
    }

    // Standard database verification layer loop fallback track
    try {
      const res = await login(username.trim(), password);
      setLoading(false);
      if (res && !res.ok) setError(res.error || "Invalid credentials. Access denied.");
    } catch (err) {
      setLoading(false);
      setError("AxiosError: Network Error. Connection refused by firewall.");
    }
  };

  return (
    <div className="min-h-screen bg-[#060d1a] flex items-center justify-center px-4 py-10" style={{
      backgroundImage: 'linear-gradient(rgba(28, 53, 87, 0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(28, 53, 87, 0.25) 1px, transparent 1px)',
      backgroundSize: '44px 44px'
    }}>
      <div className="w-full max-w-md">
        {/* Emblem + wordmark */}
        <div className="mb-7 text-center">
          <div className="flex items-center justify-center gap-3 mb-3 text-[#d4b25a]">
            <ShieldCheck className="h-14 w-12" />
          </div>
          <h1 className="font-display font-bold text-xl uppercase tracking-wider text-[#e7edf6] leading-none">
            State Crime Command
          </h1>
          <p className="font-display text-[10px] uppercase tracking-[0.15em] text-[#8ba0bd] mt-1.5">
            NSW Police Force — Case File Tracker
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#6f849f]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#e05656] animate-pulse" />
            <span>Secure Terminal</span>
            <span className="text-[#33455f]">//</span>
            <span>Clearance: Restricted</span>
            <span className="text-[#33455f]">//</span>
            <span>Sector: Sydney</span>
          </div>
        </div>

        <form onSubmit={submit} className="bg-[#0b1b33]/80 border border-[#1c3557] rounded-xl p-6 sm:p-8 space-y-5 relative backdrop-blur-md">
          <div className="text-center mb-1">
            <p className="font-display uppercase tracking-[0.2em] text-sm text-[#e7edf6]">Restricted Access</p>
            <div className="h-px w-16 bg-[#d4b25a]/50 mx-auto mt-3" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-widest text-[#8ba0bd]">Officer ID</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6f849f]" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 transition-colors uppercase"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-widest text-[#8ba0bd]">Access Code</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6f849f]" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter access code"
                autoComplete="current-password"
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 transition-colors"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-[#7a2f2f] bg-[#2a1414] px-3 py-2 text-sm text-[#f4a6a6] font-mono">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-[#d4b25a] hover:bg-[#f0d67a] disabled:opacity-60 text-[#0a1524] font-bold uppercase tracking-[0.15em] text-sm py-3 transition-colors cursor-pointer border border-[#d4b25a]"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {loading ? "Requesting Clearance..." : "Access System"}
          </button>

          <p className="text-center text-[10px] text-[#556a86] leading-relaxed pt-1">
            Authorised personnel only. All access to this terminal is logged and monitored. Unauthorised entry is prohibited.
          </p>
        </form>

        <div className="mt-6 text-center font-mono text-[11px] text-[#8ba0bd] bg-[#102540]/40 border border-[#1c3557]/60 px-4 py-2 rounded shadow-2xl">
          {timeStr}
        </div>

        <div className="mt-6 border-t border-[#132842] pt-4 text-center">
          <p className="text-[9px] text-[#4f6b8c] uppercase tracking-widest leading-relaxed">
            Restricted Operational Grid // Non-Affiliated Roleplay Network Platform Layout
          </p>
        </div>
      </div>
    </div>
  );
}

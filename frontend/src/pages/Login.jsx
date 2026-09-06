import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Lock, User, Loader2, AlertTriangle, ShieldCheck } from "lucide-react";
import LiveClock from "@/components/LiveClock";
import { Brand, Disclaimer } from "@/components/Brand";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await login(username.trim(), password);
    setLoading(false);
    if (!res.ok) setError(res.error || "Invalid credentials. Access denied.");
  };

  return (
    <div className="scc-grid-bg min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md scc-fade-up">
        {/* Emblem + wordmark */}
        <div className="mb-7">
          <Brand variant="stacked" />
          <div className="mt-4 flex items-center justify-center gap-2 font-mono-scc text-[10px] uppercase tracking-[0.18em] text-[#6f849f]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#e05656] scc-blink" />
            <span>Secure Terminal</span>
            <span className="text-[#33455f]">//</span>
            <span>Clearance: Restricted</span>
            <span className="text-[#33455f]">//</span>
            <span>Sector: Sydney</span>
          </div>
        </div>

        <form onSubmit={submit} className="scc-panel rounded-xl p-6 sm:p-8 space-y-5 relative scc-corners" data-testid="login-form">
          <span className="c tl" /><span className="c tr" /><span className="c bl" /><span className="c br" />
          <div className="text-center mb-1">
            <p className="font-display uppercase tracking-[0.2em] text-sm text-[#e7edf6]">Restricted Access</p>
            <div className="h-px w-16 bg-[#d4b25a]/50 mx-auto mt-3" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-widest text-[#8ba0bd]">Officer ID</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6f849f]" />
              <input
                data-testid="login-username-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 focus:ring-1 focus:ring-[#d4b25a]/40 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-widest text-[#8ba0bd]">Access Code</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6f849f]" />
              <input
                data-testid="login-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter access code"
                autoComplete="current-password"
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 focus:ring-1 focus:ring-[#d4b25a]/40 transition-colors"
              />
            </div>
          </div>

          {error && (
            <div
              data-testid="login-error"
              className="flex items-center gap-2 rounded-md border border-[#7a2f2f] bg-[#2a1414] px-3 py-2 text-sm text-[#f4a6a6]"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            data-testid="login-submit-button"
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-[#d4b25a] hover:bg-[#f0d67a] disabled:opacity-60 text-[#0a1524] font-display font-600 uppercase tracking-[0.15em] text-sm py-3 transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {loading ? "Verifying" : "Access System"}
          </button>

          <p className="text-center text-[10px] text-[#556a86] leading-relaxed pt-1">
            Authorised personnel only. All access to this terminal is logged and monitored.
            Unauthorised entry is prohibited.
          </p>
        </form>

        <div className="mt-6 flex justify-center opacity-80">
          <LiveClock />
        </div>

        <div className="mt-6 border-t border-[#132842] pt-4">
          <Disclaimer className="text-center" />
        </div>
      </div>
    </div>
  );
}

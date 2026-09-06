import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Shield, Lock, User, AlertCircle } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await login(username, password);
    if (!res.ok) {
      setError(res.error || "Invalid intelligence credentials");
      setLoading(false);
    }
  };

  return (
    <div className="scc-grid-bg min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0b1b33]/90 border border-[#1c3557] rounded-lg p-6 shadow-2xl backdrop-blur-md relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[2px] bg-[#d4b25a]" />
        
        <div className="flex flex-col items-center gap-2 mb-6">
          <Shield className="h-12 w-10 text-[#d4b25a]" />
          <h1 className="font-display font-bold text-xl uppercase tracking-wider text-[#e7edf6] text-center">
            State Crime Command
          </h1>
          <p className="font-display text-xs uppercase tracking-[0.2em] text-[#8ba0bd]">
            Intelligence Login Portal
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-[#2a1b1b] border border-[#5c2424] rounded p-3 flex items-center gap-2 text-sm text-[#f1a8a8]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-wider text-[#8ba0bd] font-medium">
              Badge / Username
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#4f6b8c]" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full bg-[#102540] border border-[#1c3557] rounded pl-10 pr-3 py-2 text-sm text-[#e7edf6] focus:outline-none focus:border-[#d4b25a] font-mono transition-colors"
                placeholder="ENTER BADGE ID"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-wider text-[#8ba0bd] font-medium">
              Access Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#4f6b8c]" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#102540] border border-[#1c3557] rounded pl-10 pr-3 py-2 text-sm text-[#e7edf6] focus:outline-none focus:border-[#d4b25a] font-mono transition-colors"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#d4b25a] hover:bg-[#c29f47] disabled:bg-[#d4b25a]/50 text-[#0b1b33] font-display font-bold uppercase tracking-widest text-xs py-2.5 rounded transition-colors shadow-lg cursor-pointer mt-2"
          >
            {loading ? "AUTHORISING ACCESS..." : "REQUEST CLEARANCE"}
          </button>
        </form>
      </div>
    </div>
  );
}

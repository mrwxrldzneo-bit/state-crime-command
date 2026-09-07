import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  Lock,
  User,
  Loader2,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

function playSuccessSound(audioContext) {
  try {
    if (!audioContext) return;

    const now = audioContext.currentTime;

    const master = audioContext.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    master.connect(audioContext.destination);

    // Initial system click
    const click = audioContext.createOscillator();
    const clickGain = audioContext.createGain();

    click.type = "square";
    click.frequency.setValueAtTime(900, now);

    clickGain.gain.setValueAtTime(0.08, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    click.connect(clickGain);
    clickGain.connect(master);

    click.start(now);
    click.stop(now + 0.05);

    // Rising electronic sweep
    const sweep = audioContext.createOscillator();
    const sweepGain = audioContext.createGain();

    sweep.type = "sine";
    sweep.frequency.setValueAtTime(420, now + 0.03);
    sweep.frequency.exponentialRampToValueAtTime(880, now + 0.22);

    sweepGain.gain.setValueAtTime(0.0001, now + 0.03);
    sweepGain.gain.exponentialRampToValueAtTime(0.055, now + 0.08);
    sweepGain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + 0.25
    );

    sweep.connect(sweepGain);
    sweepGain.connect(master);

    sweep.start(now + 0.03);
    sweep.stop(now + 0.27);

    // Main confirmation note
    const confirm = audioContext.createOscillator();
    const confirmGain = audioContext.createGain();

    confirm.type = "sine";
    confirm.frequency.setValueAtTime(784, now + 0.23);
    confirm.frequency.setValueAtTime(1047, now + 0.36);

    confirmGain.gain.setValueAtTime(0.0001, now + 0.23);
    confirmGain.gain.exponentialRampToValueAtTime(
      0.09,
      now + 0.25
    );
    confirmGain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + 0.58
    );

    confirm.connect(confirmGain);
    confirmGain.connect(master);

    confirm.start(now + 0.23);
    confirm.stop(now + 0.6);

    // Low tactical confirmation
    const bass = audioContext.createOscillator();
    const bassGain = audioContext.createGain();

    bass.type = "triangle";
    bass.frequency.setValueAtTime(220, now + 0.24);

    bassGain.gain.setValueAtTime(0.0001, now + 0.24);
    bassGain.gain.exponentialRampToValueAtTime(
      0.045,
      now + 0.27
    );
    bassGain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + 0.55
    );

    bass.connect(bassGain);
    bassGain.connect(master);

    bass.start(now + 0.24);
    bass.stop(now + 0.57);

    setTimeout(() => {
      audioContext.close().catch(() => {});
    }, 800);
  } catch (error) {
    console.warn("Unable to play confirmation sound:", error);
  }
}

export default function Login() {
  const authContext = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [timeStr, setTimeStr] = useState("");
  const [dateStr, setDateStr] = useState("");

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();

      const timeOptions = {
        timeZone: "Australia/Sydney",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      };

      const dateOptions = {
        timeZone: "Australia/Sydney",
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      };

      setTimeStr(
        now.toLocaleTimeString("en-AU", timeOptions)
      );

      setDateStr(
        now
          .toLocaleDateString("en-AU", dateOptions)
          .toUpperCase()
      );
    };

    updateClock();

    const interval = setInterval(updateClock, 1000);

    return () => clearInterval(interval);
  }, []);

  const submit = async (event) => {
    event.preventDefault();

    const checkUser = username.trim().toUpperCase();
    const checkPass = password.trim();

    if (!username || !password) {
      setError("All tactical entry credentials required.");
      return;
    }

    setError("");
    setLoading(true);

    // Create/resume the AudioContext immediately from the
    // user's click so browser autoplay restrictions don't
    // block the confirmation sound later.
    let audioContext = null;

    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (AudioContextClass) {
        audioContext = new AudioContextClass();

        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
      }
    } catch (audioError) {
      console.warn(
        "Unable to initialise confirmation audio:",
        audioError
      );
    }

    /*
     * Keep the existing development credentials for the RP
     * environment. The authentication context remains the
     * primary authentication path.
     */

    if (
      (checkUser === "ADMIN" &&
        checkPass === "ADMINSCC2026!") ||
      (checkUser === "DETECTIVE" &&
        checkPass === "NSWPFSCC2026")
    ) {
      try {
        const loginFunc =
          authContext?.login ||
          authContext?.loginUser ||
          authContext?.signIn;

        if (typeof loginFunc === "function") {
          await loginFunc(username.trim(), password);
        } else {
          localStorage.setItem(
            "scc_token",
            "clearance_approved_bypass_token"
          );

          localStorage.setItem(
            "user",
            JSON.stringify({
              username: checkUser,
              role: checkUser,
            })
          );
        }

        playSuccessSound(audioContext);

        setTimeout(() => {
          window.location.href = "/cases";
        }, 650);

        return;
      } catch (err) {
        audioContext?.close().catch(() => {});

        setLoading(false);

        setError(
          err?.response?.data?.detail ||
            err?.response?.data?.message ||
            err?.message ||
            "Authentication failed. Access denied."
        );

        return;
      }
    }

    try {
      const loginFunc =
        authContext?.login ||
        authContext?.loginUser ||
        authContext?.signIn;

      if (typeof loginFunc !== "function") {
        audioContext?.close().catch(() => {});

        setLoading(false);
        setError(
          "Authentication service layer error. Access method unavailable."
        );

        return;
      }

      const result = await loginFunc(
        username.trim(),
        password
      );

      setLoading(false);

      if (result && result.ok === false) {
        audioContext?.close().catch(() => {});

        setError(
          result.error ||
            "Invalid credentials. Access denied."
        );

        return;
      }

      playSuccessSound(audioContext);

      setTimeout(() => {
        window.location.href = "/cases";
      }, 650);
    } catch (err) {
      audioContext?.close().catch(() => {});

      setLoading(false);

      setError(
        err?.response?.data?.detail ||
          err?.response?.data?.message ||
          `Database Error: ${
            err?.message || "Authentication request failed."
          }`
      );
    }
  };

  return (
    <div
      className="min-h-screen bg-[#020813] flex items-center justify-center px-4 py-10 relative font-sans antialiased text-[#e7edf6]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(20, 35, 60, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(20, 35, 60, 0.4) 1px, transparent 1px)",
        backgroundSize: "36px 36px",
      }}
    >
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-[#030d1e]/40 to-[#020813]" />

      <div className="w-full max-w-md flex flex-col items-center relative z-10">
        <div className="mb-7 relative flex flex-col items-center w-full">
          <div className="relative p-2 flex items-center justify-center mb-4">
            <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[#556a86]/40" />
            <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[#556a86]/40" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-[#556a86]/40" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-[#556a86]/40" />

            <svg
              className="h-16 w-16 drop-shadow-[0_0_15px_rgba(212,178,90,0.4)]"
              viewBox="0 0 64 64"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M32 2L39.5 18.5L57 20L44 32.5L47.5 50.5L32 41.5L16.5 50.5L20 32.5L7 20L24.5 18.5L32 2Z"
                fill="#0b1b33"
                stroke="#d4b25a"
                strokeWidth="2"
                strokeLinejoin="round"
              />

              <circle
                cx="32"
                cy="27"
                r="10"
                stroke="#d4b25a"
                strokeWidth="1.5"
              />

              <path
                d="M32 21V33M26 27H38"
                stroke="#d4b25a"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>

          <h1 className="font-sans font-bold text-2xl text-center uppercase tracking-[0.14em] text-[#e7edf6] leading-none">
            State Crime Command
          </h1>

          <p className="font-sans text-[10px] text-center font-bold uppercase tracking-[0.25em] text-[#8ba0bd] mt-2">
            NSW Police Force
          </p>

          <p className="font-mono text-[9px] text-center uppercase tracking-[0.15em] text-[#6f849f] mt-1.5">
            Case File Tracker
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

        <form
          onSubmit={submit}
          className="w-full bg-[#071326]/75 border border-[#142c4d] rounded-sm p-6 sm:p-8 space-y-5 relative shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] backdrop-blur-md"
        >
          <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-[#4f6785]" />
          <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 border-[#4f6785]" />
          <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 border-[#4f6785]" />
          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-[#4f6785]" />

          <div className="text-center mb-1">
            <p className="font-sans font-medium uppercase tracking-[0.2em] text-sm text-[#e7edf6]">
              Restricted Access
            </p>

            <div className="h-px w-16 bg-[#d4b25a]/50 mx-auto mt-3" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-widest text-[#8ba0bd] block font-medium">
              Officer ID
            </label>

            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6f849f]" />

              <input
                type="text"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                placeholder="ENTER USERNAME"
                autoComplete="username"
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 transition-colors uppercase tracking-wider font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-widest text-[#8ba0bd] block font-medium">
              Access Code
            </label>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6f849f]" />

              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="ENTER ACCESS CODE"
                autoComplete="current-password"
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 transition-colors tracking-wider font-mono"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-[#7f2f38] bg-[#3a1117]/40 px-3 py-2.5 text-xs text-[#f0a4aa]">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[#d4b25a] text-[#071326] py-2.5 text-sm font-bold uppercase tracking-widest transition-all hover:bg-[#e2c46f] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying clearance...
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Access System
              </>
            )}
          </button>

          <p className="text-[9px] text-center text-[#556a86] uppercase tracking-wider">
            Authorised personnel only. All access to this
            terminal is logged and monitored. Unauthorised
            entry is prohibited.
          </p>

          <div className="border-t border-[#142c4d] pt-4 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6f849f]">
              <span>{timeStr}</span>
              <span className="mx-2 text-[#33455f]">•</span>
              <span>AEST</span>
              <span className="mx-2 text-[#33455f]">•</span>
              <span>Sydney</span>
            </div>

            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#556a86] mt-1">
              {dateStr}
            </div>
          </div>
        </form>

        <p className="mt-5 max-w-md text-center text-[8px] leading-relaxed text-[#43556e]">
          Unofficial fan-made roleplay tool. Not affiliated
          with or endorsed by the New South Wales Police Force.
          Crests and names belong to their respective owners
          and are used for non-commercial roleplay only.
        </p>
      </div>
    </div>
  );
}
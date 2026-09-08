import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";

import {
  Lock,
  User,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Radio,
  CheckCircle2,
  Activity,
  KeyRound,
} from "lucide-react";

function playSuccessSound(audioContext) {
  try {
    if (!audioContext) return;

    const now = audioContext.currentTime;

    const master = audioContext.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.20, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    master.connect(audioContext.destination);

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

    const sweep = audioContext.createOscillator();
    const sweepGain = audioContext.createGain();

    sweep.type = "sine";
    sweep.frequency.setValueAtTime(420, now + 0.03);
    sweep.frequency.exponentialRampToValueAtTime(880, now + 0.22);

    sweepGain.gain.setValueAtTime(0.0001, now + 0.03);
    sweepGain.gain.exponentialRampToValueAtTime(0.055, now + 0.08);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

    sweep.connect(sweepGain);
    sweepGain.connect(master);

    sweep.start(now + 0.03);
    sweep.stop(now + 0.27);

    const confirm = audioContext.createOscillator();
    const confirmGain = audioContext.createGain();

    confirm.type = "sine";
    confirm.frequency.setValueAtTime(784, now + 0.23);
    confirm.frequency.setValueAtTime(1047, now + 0.36);

    confirmGain.gain.setValueAtTime(0.0001, now + 0.23);
    confirmGain.gain.exponentialRampToValueAtTime(0.09, now + 0.25);
    confirmGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);

    confirm.connect(confirmGain);
    confirmGain.connect(master);

    confirm.start(now + 0.23);
    confirm.stop(now + 0.6);

    const bass = audioContext.createOscillator();
    const bassGain = audioContext.createGain();

    bass.type = "triangle";
    bass.frequency.setValueAtTime(220, now + 0.24);

    bassGain.gain.setValueAtTime(0.0001, now + 0.24);
    bassGain.gain.exponentialRampToValueAtTime(0.045, now + 0.27);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    bass.connect(bassGain);
    bassGain.connect(master);

    bass.start(now + 0.24);
    bass.stop(now + 0.57);

    window.setTimeout(() => {
      audioContext.close().catch(() => {});
    }, 800);
  } catch (error) {
    console.warn("Unable to play confirmation sound:", error);
  }
}

function TacticalCrest() {
  return (
    <div className="relative flex items-center justify-center p-3">
      <div className="absolute inset-0 rounded-[1.25rem] border border-[#d4b25a]/20 bg-[#d4b25a]/[0.025] shadow-[0_0_45px_rgba(212,178,90,0.08)]" />

      <img
        src="https://i.postimg.cc/nr2YrNNY/nswpf-logo.png"
        alt="NSW Police Force logo"
        className="relative h-28 w-28 object-contain drop-shadow-[0_0_22px_rgba(212,178,90,0.28)]"
      />
    </div>
  );
}

const TIMELINE = [
  "AUTHENTICATING OPERATOR",
  "VERIFYING CLEARANCE",
  "LINKING SESSION AUDIT",
  "ESTABLISHING SECURE TERMINAL",
];

export default function Login() {
  const authContext = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [officerId, setOfficerId] = useState(() => {
    try {
      return localStorage.getItem("scc_officer_id") || "";
    } catch {
      return "";
    }
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [timelineStep, setTimelineStep] = useState(-1);
  const [timeStr, setTimeStr] = useState("");
  const [dateStr, setDateStr] = useState("");

  useEffect(() => {
    try {
      document.documentElement.style.backgroundColor = "#0b1728";
      document.body.style.backgroundColor = "#0b1728";
    } catch {
      // Best-effort protection against a white route-transition frame.
    }

    return () => {
      try {
        document.documentElement.style.backgroundColor = "#0b1728";
        document.body.style.backgroundColor = "#0b1728";
      } catch {
        // Ignore styling cleanup failures.
      }
    };
  }, []);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();

      setTimeStr(
        now.toLocaleTimeString("en-AU", {
          timeZone: "Australia/Sydney",
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );

      setDateStr(
        now
          .toLocaleDateString("en-AU", {
            timeZone: "Australia/Sydney",
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })
          .toUpperCase()
      );
    };

    updateClock();

    const interval = setInterval(updateClock, 1000);

    return () => clearInterval(interval);
  }, []);

  const timezoneLabel = useMemo(() => {
    try {
      const parts = new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Sydney",
        timeZoneName: "short",
      }).formatToParts(new Date());

      return (
        parts.find((part) => part.type === "timeZoneName")?.value ||
        "AEST"
      );
    } catch {
      return "AEST";
    }
  }, [timeStr]);

  useEffect(() => {
    if (!loading) {
      return undefined;
    }

    setTimelineStep(0);

    const timers = TIMELINE.slice(1).map((_, index) =>
      window.setTimeout(
        () => setTimelineStep(index + 1),
        1050 * (index + 1)
      )
    );

    return () => timers.forEach(clearTimeout);
  }, [loading]);

  const submit = async (event) => {
    event.preventDefault();

    if (loading) {
      return;
    }

    const normalizedUsername = username.trim().toUpperCase();
    const normalizedOfficerId = officerId.trim().toUpperCase();

    if (
      !normalizedUsername ||
      !password ||
      !normalizedOfficerId
    ) {
      setError(
        "USERNAME, ACCESS CODE AND OPERATOR IDENTIFICATION ARE REQUIRED."
      );
      return;
    }

    setError("");
    setLoading(true);
    setTimelineStep(0);

    const authenticationStartedAt = performance.now();
    const minimumAuthenticationMs = 4200;

    try {
      localStorage.setItem(
        "scc_officer_id",
        normalizedOfficerId
      );
    } catch {
      // Browser storage is optional.
    }

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

    try {
      const result = await authContext.login(
        normalizedUsername,
        password,
        normalizedOfficerId
      );

      if (!result || result.ok !== true) {
        audioContext?.close().catch(() => {});

        setLoading(false);
        setTimelineStep(-1);

        setError(
          result?.error ||
            "INVALID CREDENTIALS. ACCESS DENIED."
        );

        return;
      }

      try {
        localStorage.setItem(
          "scc_officer_id",
          normalizedOfficerId
        );

        localStorage.setItem(
          "scc_username",
          normalizedUsername
        );

        if (result.user?.role) {
          localStorage.setItem(
            "scc_role",
            String(result.user.role)
          );
        }

        if (result.user?.officer_id) {
          localStorage.setItem(
            "scc_officer_id",
            String(result.user.officer_id)
          );
        }
      } catch {
        // Browser storage is optional.
      }

      const elapsed =
        performance.now() - authenticationStartedAt;

      const remaining = Math.max(
        0,
        minimumAuthenticationMs - elapsed
      );

      await new Promise((resolve) =>
        window.setTimeout(resolve, remaining)
      );

      setTimelineStep(TIMELINE.length - 1);

      playSuccessSound(audioContext);

      try {
        document.documentElement.style.backgroundColor =
          "#0b1728";

        document.body.style.backgroundColor = "#0b1728";
      } catch {
        // Visual transition protection is best-effort.
      }

      window.setTimeout(() => {
        if (typeof authContext.completeLogin === "function") {
          authContext.completeLogin();
        }

        window.location.href = "/cases";
      }, 350);
    } catch (err) {
      audioContext?.close().catch(() => {});

      setLoading(false);
      setTimelineStep(-1);

      setError(
        err?.response?.data?.detail ||
          err?.response?.data?.message ||
          err?.message ||
          "AUTHENTICATION FAILED. ACCESS DENIED."
      );
    }
  };

  return (
    <div
      className="min-h-screen bg-[#0b1728] flex items-center justify-center px-4 py-8 relative font-sans antialiased text-[#e7edf6] overflow-hidden"
      style={{
        backgroundImage:
          "radial-gradient(circle at 50% 20%, rgba(212,178,90,0.07), transparent 30%), linear-gradient(rgba(35,53,78,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(35,53,78,0.22) 1px, transparent 1px)",
        backgroundSize:
          "auto, 36px 36px, 36px 36px",
      }}
    >
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_25%,rgba(0,0,0,0.62)_100%)]" />

      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-[70vw] bg-gradient-to-r from-transparent via-[#d4b25a]/30 to-transparent" />

      <div className="w-full max-w-xl flex flex-col items-center relative z-10">
        <div className="mb-6 flex flex-col items-center text-center">
          <TacticalCrest />

          <h1 className="mt-3 text-2xl sm:text-3xl font-black uppercase tracking-[0.14em] text-[#f0f4fa]">
            State Crime Command
          </h1>

          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.3em] text-[#aab8cb]">
            NSW Police Force · Case File Tracker
          </p>

          <div className="mt-4 flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.18em] text-[#647894]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#d4b25a] shadow-[0_0_10px_rgba(212,178,90,0.65)] animate-pulse" />

            <span>Secure Terminal</span>

            <span className="text-[#344761]">//</span>

            <span>Restricted Clearance</span>

            <span className="text-[#344761]">//</span>

            <span>Sydney Sector</span>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="w-full rounded-2xl border border-[#60718a]/25 bg-[#152b43]/78 p-5 sm:p-7 backdrop-blur-2xl shadow-[0_30px_90px_-30px_rgba(0,0,0,0.95)] relative overflow-hidden"
        >
          <div className="absolute inset-[1px] rounded-[15px] border border-white/[0.035] pointer-events-none" />

          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-px bg-gradient-to-r from-transparent via-[#d4b25a]/55 to-transparent" />

          <div className="relative space-y-5">
            <div className="text-center pb-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d4b25a]/15 bg-[#d4b25a]/[0.04] px-3 py-1.5">
                <KeyRound className="h-3.5 w-3.5 text-[#d4b25a]" />

                <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#d8e0eb]">
                  Restricted Access
                </span>
              </div>

              <p className="mt-2 text-[9px] font-mono uppercase tracking-[0.16em] text-[#61738b]">
                Authorised operational personnel only
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0b7]">
                Username
              </label>

              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6e819b]" />

                <input
                  type="text"
                  value={username}
                  onChange={(event) =>
                    setUsername(event.target.value)
                  }
                  placeholder="ENTER USERNAME"
                  autoComplete="username"
                  disabled={loading}
                  className="w-full rounded-xl border border-[#294766]/65 bg-[#f4f7fb] pl-11 pr-4 py-3.5 text-sm font-mono uppercase tracking-[0.12em] text-[#070e17] placeholder:text-[#65758a] caret-[#070e17] outline-none transition-all focus:border-[#d4b25a]/70 focus:ring-4 focus:ring-[#d4b25a]/[0.08] disabled:opacity-50"
                  style={{ WebkitTextFillColor: "#070e17", caretColor: "#070e17" }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0b7]">
                Access Code
              </label>

              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6e819b]" />

                <input
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  placeholder="ENTER ACCESS CODE"
                  autoComplete="current-password"
                  disabled={loading}
                  className="w-full rounded-xl border border-[#294766]/65 bg-[#f4f7fb] pl-11 pr-4 py-3.5 text-sm font-mono tracking-[0.12em] text-[#070e17] placeholder:text-[#65758a] caret-[#070e17] outline-none transition-all focus:border-[#d4b25a]/70 focus:ring-4 focus:ring-[#d4b25a]/[0.08] disabled:opacity-50"
                  style={{ WebkitTextFillColor: "#070e17", caretColor: "#070e17" }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0b7]">
                Officer ID / Callsign
              </label>

              <div className="relative">
                <Radio className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6e819b]" />

                <input
                  type="text"
                  value={officerId}
                  onChange={(event) =>
                    setOfficerId(
                      event.target.value.toUpperCase()
                    )
                  }
                  placeholder="ENTER OFFICER ID / CALLSIGN"
                  autoComplete="off"
                  disabled={loading}
                  className="w-full rounded-xl border border-[#294766]/65 bg-[#f4f7fb] pl-11 pr-4 py-3.5 text-sm font-mono uppercase tracking-[0.1em] text-[#070e17] placeholder:text-[#65758a] caret-[#070e17] outline-none transition-all focus:border-[#d4b25a]/70 focus:ring-4 focus:ring-[#d4b25a]/[0.08] disabled:opacity-50"
                  style={{ WebkitTextFillColor: "#070e17", caretColor: "#070e17" }}
                />
              </div>

              <p className="pl-1 text-[8px] font-mono uppercase tracking-[0.14em] text-[#52647b]">
                Operator identification for session auditing
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-[#8d3a45]/45 bg-[#3a1117]/35 px-3.5 py-3 text-xs text-[#f1aab1]">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />

                <span className="font-mono uppercase tracking-wide leading-relaxed">
                  {error}
                </span>
              </div>
            )}

            {loading && (
              <div className="rounded-xl border border-[#52647d]/20 bg-[#10243a]/62 px-4 py-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-[#73869f]">
                    Clearance Processing
                  </span>

                  <span className="text-[9px] font-mono text-[#d4b25a]">
                    {Math.min(
                      100,
                      (timelineStep + 1) * 25
                    )}
                    %
                  </span>
                </div>

                <div className="space-y-2">
                  {TIMELINE.map((step, index) => {
                    const complete = index < timelineStep;
                    const active = index === timelineStep;

                    return (
                      <div
                        key={step}
                        className="flex items-center gap-2.5"
                      >
                        {complete ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-[#72d69b]" />
                        ) : active ? (
                          <Loader2 className="h-3.5 w-3.5 text-[#d4b25a] animate-spin" />
                        ) : (
                          <span className="h-3.5 w-3.5 rounded-full border border-[#344761]" />
                        )}

                        <span
                          className={`text-[9px] font-mono uppercase tracking-[0.12em] ${
                            complete
                              ? "text-[#72d69b]"
                              : active
                                ? "text-[#d4b25a]"
                                : "text-[#52647b]"
                          }`}
                        >
                          {step}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl border border-[#e3c875]/70 bg-gradient-to-b from-[#e3c875] to-[#c59e40] text-[#06101b] py-3.5 text-xs font-black uppercase tracking-[0.2em] transition-all hover:brightness-110 hover:shadow-[0_0_28px_rgba(212,178,90,0.18)] disabled:opacity-55 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing Clearance...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Access System
                </>
              )}
            </button>

            <div className="grid grid-cols-3 gap-2 text-center pt-1">
              <div className="rounded-lg border border-[#52647d]/15 bg-[#07111e]/35 py-2">
                <Activity className="h-3.5 w-3.5 mx-auto text-[#667a95]" />

                <p className="mt-1 text-[7px] font-mono uppercase tracking-wider text-[#52647b]">
                  Audit
                </p>
              </div>

              <div className="rounded-lg border border-[#52647d]/15 bg-[#07111e]/35 py-2">
                <ShieldCheck className="h-3.5 w-3.5 mx-auto text-[#667a95]" />

                <p className="mt-1 text-[7px] font-mono uppercase tracking-wider text-[#52647b]">
                  Secure
                </p>
              </div>

              <div className="rounded-lg border border-[#52647d]/15 bg-[#07111e]/35 py-2">
                <Radio className="h-3.5 w-3.5 mx-auto text-[#667a95]" />

                <p className="mt-1 text-[7px] font-mono uppercase tracking-wider text-[#52647b]">
                  Session
                </p>
              </div>
            </div>

            <p className="text-[8px] text-center text-[#4e6078] uppercase tracking-[0.12em] leading-relaxed">
              Authorised personnel only. All access is logged and monitored.
            </p>

            <div className="border-t border-[#52647d]/15 pt-4 text-center">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#6a7d96]">
                <span>{timeStr}</span>

                <span className="mx-2 text-[#344761]">
                  •
                </span>

                <span>{timezoneLabel}</span>

                <span className="mx-2 text-[#344761]">
                  •
                </span>

                <span>Sydney</span>
              </div>

              <div className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#4e6078] mt-1">
                {dateStr}
              </div>
            </div>
          </div>
        </form>

        <p className="mt-4 max-w-lg text-center text-[7px] leading-relaxed text-[#3e5067]">
          Unofficial fan-made roleplay tool. Not affiliated with or endorsed by the New South Wales Police Force. Names, marks and insignia remain the property of their respective owners and are used here for non-commercial roleplay.
        </p>
      </div>
    </div>
  );
}
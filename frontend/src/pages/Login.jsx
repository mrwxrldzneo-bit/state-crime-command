import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import {
  Lock,
  User,
  BadgeCheck,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";

const AUTH_STAGES = [
  {
    progress: 0,
    code: "00",
    text: "VERIFYING OFFICER CREDENTIALS",
  },
  {
    progress: 25,
    code: "01",
    text: "VALIDATING CLEARANCE LEVEL",
  },
  {
    progress: 50,
    code: "02",
    text: "ESTABLISHING SECURE SESSION",
  },
  {
    progress: 75,
    code: "03",
    text: "VERIFYING COMMAND ACCESS",
  },
  {
    progress: 100,
    code: "04",
    text: "AUTHENTICATION COMPLETE",
  },
];

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function playAccessGrantedSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) {
      return;
    }

    const audioContext = new AudioContext();

    const oscillatorOne = audioContext.createOscillator();
    const oscillatorTwo = audioContext.createOscillator();

    const gainOne = audioContext.createGain();
    const gainTwo = audioContext.createGain();

    oscillatorOne.type = "sine";
    oscillatorTwo.type = "sine";

    oscillatorOne.frequency.setValueAtTime(520, audioContext.currentTime);

    oscillatorOne.frequency.linearRampToValueAtTime(
      760,
      audioContext.currentTime + 0.18,
    );

    oscillatorTwo.frequency.setValueAtTime(
      740,
      audioContext.currentTime + 0.18,
    );

    oscillatorTwo.frequency.linearRampToValueAtTime(
      988,
      audioContext.currentTime + 0.36,
    );

    gainOne.gain.setValueAtTime(0.0001, audioContext.currentTime);

    gainOne.gain.exponentialRampToValueAtTime(
      0.12,
      audioContext.currentTime + 0.02,
    );

    gainOne.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime + 0.45,
    );

    gainTwo.gain.setValueAtTime(0.0001, audioContext.currentTime + 0.18);

    gainTwo.gain.exponentialRampToValueAtTime(
      0.1,
      audioContext.currentTime + 0.2,
    );

    gainTwo.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime + 0.65,
    );

    oscillatorOne.connect(gainOne);
    gainOne.connect(audioContext.destination);

    oscillatorTwo.connect(gainTwo);
    gainTwo.connect(audioContext.destination);

    oscillatorOne.start();
    oscillatorTwo.start(audioContext.currentTime + 0.18);

    oscillatorOne.stop(audioContext.currentTime + 0.45);
    oscillatorTwo.stop(audioContext.currentTime + 0.65);

    oscillatorTwo.addEventListener("ended", () => {
      audioContext.close().catch(() => {});
    });
  } catch (error) {
    console.warn("Access granted sound could not be played:", error);
  }
}

export default function Login() {
  const authContext = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [officerId, setOfficerId] = useState("");

  const [error, setError] = useState("");

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const [accessGranted, setAccessGranted] = useState(false);

  const [timeStr, setTimeStr] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [logLines, setLogLines] = useState([]);

  /*
   * Sydney clock
   */
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

      setTimeStr(now.toLocaleTimeString("en-AU", timeOptions));

      const dateOptions = {
        timeZone: "Australia/Sydney",
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      };

      setDateStr(now.toLocaleDateString("en-AU", dateOptions).toUpperCase());
    };

    updateClock();

    const interval = setInterval(updateClock, 1000);

    return () => clearInterval(interval);
  }, []);

  /*
   * Authentication event log
   */
  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString("en-AU", {
      hour12: false,
    });

    setLogLines((previous) => [...previous, `[${timestamp}] ${message}`]);
  };

  /*
   * Visual authentication sequence.
   *
   * 00% → 25% → 50% → 75% → 100%
   */
  const runAuthenticationSequence = async () => {
    for (let index = 0; index < AUTH_STAGES.length; index++) {
      const stage = AUTH_STAGES[index];

      setStageIndex(index);
      setProgress(stage.progress);

      addLog(`${stage.code} ${stage.text}... PROCESSING`);

      await sleep(850);

      addLog(`${stage.code} ${stage.text}... COMPLETE`);

      if (index < AUTH_STAGES.length - 1) {
        await sleep(250);
      }
    }

    setProgress(100);
    setStageIndex(AUTH_STAGES.length - 1);
    setAccessGranted(true);

    addLog("SECURE SESSION ESTABLISHED");
    addLog("ACCESS GRANTED — COMMAND TERMINAL READY");

    playAccessGrantedSound();

    await sleep(1100);

    /*
     * Update AuthContext using the real authenticated session.
     */
    if (typeof authContext?.completeLogin === "function") {
      authContext.completeLogin();
    }

    /*
     * Navigate directly to the protected cases page.
     */
    navigate("/cases", { replace: true });
  };

  /*
   * Form submission
   */
  const submit = async (e) => {
    e.preventDefault();

    if (loading) {
      return;
    }

    const cleanUsername = username.trim();
    const cleanPassword = password.trim();
    const cleanOfficerId = officerId.trim();

    if (!cleanUsername || !cleanPassword || !cleanOfficerId) {
      setError("Username, access code, and officer ID are required.");
      return;
    }

    setError("");
    setLoading(true);
    setProgress(0);
    setStageIndex(0);
    setAccessGranted(false);
    setLogLines([]);

    try {
      const loginFunc =
        authContext?.login || authContext?.loginUser || authContext?.signIn;

      if (typeof loginFunc !== "function") {
        throw new Error("Authentication service layer unavailable.");
      }

      addLog("AUTHENTICATION REQUEST INITIALISED");
      addLog("OFFICER IDENTIFIER RECORDED");

      /*
       * REAL BACKEND AUTHENTICATION
       *
       * Username + access code are verified by the
       * backend. Officer ID is stored with the session
       * for operator/audit identification.
       */
      const result = await Promise.race([
        loginFunc(cleanUsername, cleanPassword, cleanOfficerId),

        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: false,
              error: "Authentication request timed out.",
            });
          }, 15000);
        }),
      ]);

      if (!result?.ok) {
        setLoading(false);
        setProgress(0);
        setStageIndex(0);
        setAccessGranted(false);
        setLogLines([]);

        setError(result?.error || "Invalid credentials. Access denied.");

        return;
      }

      addLog("DATABASE CREDENTIALS VERIFIED");

      addLog("OFFICER IDENTIFIER ACCEPTED");

      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });

      await runAuthenticationSequence();
    } catch (err) {
      console.error("SCC authentication error:", err);

      setLoading(false);
      setProgress(0);
      setStageIndex(0);
      setAccessGranted(false);
      setLogLines([]);

      setError(err?.message || "Authentication service unavailable.");
    }
  };

  /*
   * SECURE AUTHENTICATION TERMINAL
   */
  if (loading) {
    const currentStage = AUTH_STAGES[stageIndex] || AUTH_STAGES[0];

    return (
      <div
        className="min-h-screen bg-[#020813] flex items-center justify-center px-4 relative font-sans antialiased text-[#e7edf6]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(20, 35, 60, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(20, 35, 60, 0.4) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
        }}
      >
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-[#030d1e]/40 to-[#020813]" />

        <div className="w-full max-w-2xl relative z-10">
          <div className="border border-[#142c4d] bg-[#071326]/90 rounded-sm shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)] backdrop-blur-md overflow-hidden">
            {/* TERMINAL HEADER */}
            <div className="border-b border-[#142c4d] px-5 py-4 flex items-center justify-between">
              <div>
                <p className="font-bold uppercase tracking-[0.18em] text-sm">
                  State Crime Command
                </p>

                <p className="font-mono text-[9px] text-[#6f849f] uppercase tracking-[0.15em] mt-1">
                  Secure Authentication Terminal
                </p>
              </div>

              <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-[#6f849f]">
                <span className="h-2 w-2 rounded-full bg-[#d4b25a] animate-pulse" />
                SECURE
              </div>
            </div>

            {/* TERMINAL BODY */}
            <div className="p-6 sm:p-8">
              {/* AUTH STATUS */}
              <div className="text-center mb-8">
                {!accessGranted ? (
                  <>
                    <Loader2 className="h-8 w-8 text-[#d4b25a] animate-spin mx-auto mb-4" />

                    <h1 className="text-xl font-bold uppercase tracking-[0.2em]">
                      Authenticating...
                    </h1>

                    <p className="font-mono text-[10px] text-[#6f849f] uppercase tracking-[0.18em] mt-2">
                      Please wait while your clearance is verified
                    </p>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-10 w-10 text-[#d4b25a] mx-auto mb-4" />

                    <h1 className="text-xl font-bold uppercase tracking-[0.2em] text-[#d4b25a]">
                      Access Granted
                    </h1>

                    <p className="font-mono text-[10px] text-[#8ba0bd] uppercase tracking-[0.18em] mt-2">
                      Secure command session authorised
                    </p>
                  </>
                )}
              </div>

              {/* PROGRESS BAR */}
              <div className="mb-6">
                <div className="flex justify-between items-end mb-2 font-mono">
                  <span className="text-[10px] text-[#6f849f] uppercase tracking-widest">
                    Authentication Progress
                  </span>

                  <span className="text-sm font-bold text-[#d4b25a]">
                    {String(progress).padStart(2, "0")}%
                  </span>
                </div>

                <div className="h-2 bg-[#081222] border border-[#1c3557] overflow-hidden">
                  <div
                    className="h-full bg-[#d4b25a] transition-all duration-700 ease-out"
                    style={{
                      width: `${progress}%`,
                    }}
                  />
                </div>
              </div>

              {/* CURRENT STAGE */}
              {!accessGranted && (
                <div className="border border-[#142c4d] bg-[#030b17] p-4 mb-6">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-[#d4b25a]">
                      {currentStage.code}
                    </span>

                    <span className="font-mono text-xs uppercase tracking-wider text-[#e7edf6]">
                      {currentStage.text}
                    </span>

                    <span className="ml-auto">
                      <Loader2 className="h-3.5 w-3.5 text-[#d4b25a] animate-spin" />
                    </span>
                  </div>
                </div>
              )}

              {/* EVENT LOG */}
              <div className="border border-[#142c4d] bg-[#030b17] p-4 h-48 overflow-hidden">
                <div className="font-mono text-[10px] leading-6">
                  <div className="text-[#6f849f] mb-1">
                    // SCC AUTHENTICATION EVENT LOG
                  </div>

                  {logLines.map((line, index) => (
                    <div
                      key={`${line}-${index}`}
                      className={
                        line.includes("GRANTED") ||
                        line.includes("COMPLETE") ||
                        line.includes("VERIFIED") ||
                        line.includes("ACCEPTED")
                          ? "text-[#d4b25a]"
                          : "text-[#8ba0bd]"
                      }
                    >
                      {line}
                    </div>
                  ))}

                  {!accessGranted && (
                    <div className="text-[#d4b25a] animate-pulse">_</div>
                  )}
                </div>
              </div>

              {/* TERMINAL FOOTER */}
              <div className="mt-6 flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-[#556a86]">
                <span>NSWPF // SCC</span>
                <span>RESTRICTED CLEARANCE</span>
                <span>SYDNEY</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /*
   * LOGIN SCREEN
   */
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
        {/* BRANDING */}
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

        {/* LOGIN FORM */}
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

          {/* USERNAME */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-widest text-[#8ba0bd] block font-medium">
              Username
            </label>

            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6f849f]" />

              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);

                  if (error) {
                    setError("");
                  }
                }}
                placeholder="ENTER USERNAME"
                autoComplete="username"
                disabled={loading}
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 transition-colors uppercase tracking-wider font-mono disabled:opacity-60"
              />
            </div>
          </div>

          {/* ACCESS CODE */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-widest text-[#8ba0bd] block font-medium">
              Access Code
            </label>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6f849f]" />

              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);

                  if (error) {
                    setError("");
                  }
                }}
                placeholder="ENTER ACCESS CODE"
                autoComplete="current-password"
                disabled={loading}
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 transition-colors tracking-wider font-mono disabled:opacity-60"
              />
            </div>
          </div>

          {/* OFFICER ID / CALLSIGN */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-widest text-[#8ba0bd] block font-medium">
              Officer ID / Callsign
            </label>

            <div className="relative">
              <BadgeCheck className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6f849f]" />

              <input
                type="text"
                value={officerId}
                onChange={(e) => {
                  setOfficerId(e.target.value);

                  if (error) {
                    setError("");
                  }
                }}
                placeholder="ENTER OFFICER ID / CALLSIGN"
                autoComplete="off"
                disabled={loading}
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 transition-colors uppercase tracking-wider font-mono disabled:opacity-60"
              />
            </div>

            <p className="text-[9px] text-[#556a86] font-mono uppercase tracking-wider">
              Operator identification for session auditing
            </p>
          </div>

          {/* ERROR */}
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-[#7a2f2f] bg-[#2a1414] px-3 py-2 text-sm text-[#f4a6a6] font-mono">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />

              <span>{error}</span>
            </div>
          )}

          {/* SUBMIT */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-[#d4b25a] hover:bg-[#f0d67a] disabled:opacity-60 text-[#0a1524] font-bold uppercase tracking-[0.15em] text-sm py-3 transition-colors cursor-pointer border border-[#d4b25a] shadow-lg"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}

            <span>{loading ? "Verifying clearance..." : "Access System"}</span>
          </button>

          <p className="text-center text-[10px] text-[#556a86] leading-relaxed pt-1">
            Authorised personnel only. All access to this terminal is logged and
            monitored. Unauthorised entry is prohibited.
          </p>
        </form>

        {/* FOOTER */}
        <div className="mt-6 w-full flex flex-col items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-[#556a86]">
          <span>{dateStr}</span>

          <span>{timeStr} AEST</span>

          <span className="mt-1">SCC CASE FILE TRACKER</span>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  Lock,
  User,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Radio,
  Database,
  Terminal,
  Activity,
} from "lucide-react";

function createAudioContext() {
  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return null;

    return new AudioContextClass();
  } catch (error) {
    console.warn("Unable to initialise audio:", error);
    return null;
  }
}

function playAccessGrantedSound(audioContext) {
  try {
    if (!audioContext) return;

    const now = audioContext.currentTime;

    const master = audioContext.createGain();

    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.55, now + 0.025);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);

    master.connect(audioContext.destination);

    // Initial terminal confirmation
    const terminal = audioContext.createOscillator();
    const terminalGain = audioContext.createGain();

    terminal.type = "square";
    terminal.frequency.setValueAtTime(560, now);

    terminalGain.gain.setValueAtTime(0.0001, now);
    terminalGain.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
    terminalGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    terminal.connect(terminalGain);
    terminalGain.connect(master);

    terminal.start(now);
    terminal.stop(now + 0.1);

    // Security scan
    const scan = audioContext.createOscillator();
    const scanGain = audioContext.createGain();

    scan.type = "sine";
    scan.frequency.setValueAtTime(280, now + 0.08);
    scan.frequency.exponentialRampToValueAtTime(1150, now + 0.42);

    scanGain.gain.setValueAtTime(0.0001, now + 0.08);
    scanGain.gain.exponentialRampToValueAtTime(0.2, now + 0.18);
    scanGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);

    scan.connect(scanGain);
    scanGain.connect(master);

    scan.start(now + 0.08);
    scan.stop(now + 0.48);

    // Low confirmation
    const low = audioContext.createOscillator();
    const lowGain = audioContext.createGain();

    low.type = "triangle";
    low.frequency.setValueAtTime(165, now + 0.43);

    lowGain.gain.setValueAtTime(0.0001, now + 0.43);
    lowGain.gain.exponentialRampToValueAtTime(0.18, now + 0.48);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.88);

    low.connect(lowGain);
    lowGain.connect(master);

    low.start(now + 0.43);
    low.stop(now + 0.9);

    // ACCESS GRANTED - first tone
    const confirmOne = audioContext.createOscillator();
    const confirmOneGain = audioContext.createGain();

    confirmOne.type = "sine";
    confirmOne.frequency.setValueAtTime(740, now + 0.5);

    confirmOneGain.gain.setValueAtTime(0.0001, now + 0.5);
    confirmOneGain.gain.exponentialRampToValueAtTime(0.34, now + 0.54);
    confirmOneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.83);

    confirmOne.connect(confirmOneGain);
    confirmOneGain.connect(master);

    confirmOne.start(now + 0.5);
    confirmOne.stop(now + 0.85);

    // ACCESS GRANTED - final tone
    const confirmTwo = audioContext.createOscillator();
    const confirmTwoGain = audioContext.createGain();

    confirmTwo.type = "sine";
    confirmTwo.frequency.setValueAtTime(988, now + 0.67);

    confirmTwoGain.gain.setValueAtTime(0.0001, now + 0.67);
    confirmTwoGain.gain.exponentialRampToValueAtTime(0.4, now + 0.71);
    confirmTwoGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.08);

    confirmTwo.connect(confirmTwoGain);
    confirmTwoGain.connect(master);

    confirmTwo.start(now + 0.67);
    confirmTwo.stop(now + 1.1);

    setTimeout(() => {
      audioContext.close().catch(() => {});
    }, 1500);
  } catch (error) {
    console.warn("Unable to play access sound:", error);
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
  const [authenticationStage, setAuthenticationStage] = useState(0);
  const [logLines, setLogLines] = useState([]);

  /*
   * Clock
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

  /*
   * Authentication terminal animation
   */
  useEffect(() => {
    if (!loading) return;

    const stages = [
      {
        delay: 400,
        stage: 1,
        log: "AUTH REQUEST RECEIVED",
      },
      {
        delay: 1100,
        stage: 2,
        log: "OFFICER CREDENTIALS VERIFIED",
      },
      {
        delay: 1900,
        stage: 3,
        log: "CLEARANCE LEVEL VALIDATED",
      },
      {
        delay: 2750,
        stage: 4,
        log: "SECURE SESSION ESTABLISHED",
      },
    ];

    const timers = stages.map((item) =>
      setTimeout(() => {
        setAuthenticationStage(item.stage);

        setLogLines((previous) => [
          ...previous,
          item.log,
        ]);
      }, item.delay)
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [loading]);

  /*
   * Login
   */
  const submit = async (event) => {
    event.preventDefault();

    if (loading) return;

    const cleanUsername = username.trim();

    if (!cleanUsername || !password) {
      setError("All tactical entry credentials required.");
      return;
    }

    setError("");
    setLoading(true);
    setAuthenticationStage(0);
    setLogLines([]);

    const audioContext = createAudioContext();

    try {
      /*
       * Start audio immediately from the user interaction.
       */
      if (audioContext?.state === "suspended") {
        await audioContext.resume();
      }

      /*
       * Give the AuthContext a hard timeout.
       *
       * This prevents the terminal from remaining on-screen forever
       * if the backend/API is unreachable.
       */
      const loginPromise = authContext.login(
        cleanUsername,
        password
      );

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              "Authentication server did not respond. Please try again."
            )
          );
        }, 15000);
      });

      const result = await Promise.race([
        loginPromise,
        timeoutPromise,
      ]);

      /*
       * Backend explicitly rejected the credentials.
       */
      if (result && result.ok === false) {
        audioContext?.close().catch(() => {});

        setLoading(false);
        setAuthenticationStage(0);
        setLogLines([]);

        setError(
          result.error ||
            "Invalid credentials. Access denied."
        );

        return;
      }

      /*
       * Authentication succeeded.
       *
       * Allow the terminal animation to finish before redirecting.
       */
      await new Promise((resolve) =>
        setTimeout(resolve, 3600)
      );

      setAuthenticationStage(5);

      setLogLines((previous) => [
        ...previous,
        "COMMAND ACCESS AUTHORISED",
        "SESSION CLEARANCE: GRANTED",
      ]);

      playAccessGrantedSound(audioContext);

      /*
       * Allow the confirmation sound to finish.
       */
      await new Promise((resolve) =>
        setTimeout(resolve, 1150)
      );

      /*
       * Complete the actual application login.
       */
      if (typeof authContext.completeLogin === "function") {
        authContext.completeLogin();
      } else {
        /*
         * If completeLogin is missing, don't leave the
         * application stuck in the loading screen.
         */
        throw new Error(
          "Authentication succeeded, but the session could not be completed."
        );
      }
    } catch (err) {
      console.error("SCC LOGIN ERROR:", err);

      audioContext?.close().catch(() => {});

      setLoading(false);
      setAuthenticationStage(0);
      setLogLines([]);

      /*
       * Try to give the user the actual backend/network error.
       */
      let message =
        "Authentication failed. Access denied.";

      if (
        err?.response?.data?.detail
      ) {
        message = err.response.data.detail;
      } else if (
        err?.response?.data?.message
      ) {
        message = err.response.data.message;
      } else if (
        err?.code === "ERR_NETWORK"
      ) {
        message =
          "Unable to contact the authentication server. Check the backend connection.";
      } else if (
        err?.message?.toLowerCase().includes("network")
      ) {
        message =
          "Unable to contact the authentication server. Check the backend connection.";
      } else if (err?.message) {
        message = err.message;
      }

      setError(message);
    }
  };

  /*
   * AUTHENTICATION TERMINAL
   */
  if (loading) {
    return (
      <div
        className="min-h-screen bg-[#020813] flex items-center justify-center px-6 relative font-sans antialiased text-[#e7edf6] overflow-hidden"
        style={{
          backgroundImage:
            "linear-gradient(rgba(20, 35, 60, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(20, 35, 60, 0.4) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
        }}
      >
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-[#030d1e]/40 to-[#020813]" />

        <div className="absolute left-0 right-0 top-0 h-px bg-[#d4b25a]/30 shadow-[0_0_20px_rgba(212,178,90,0.35)] animate-[scan_3s_linear_infinite]" />

        <div className="relative z-10 w-full max-w-2xl">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-3">
              <Terminal className="h-4 w-4 text-[#d4b25a]" />

              <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-[#6f849f]">
                SCC SECURE AUTHENTICATION NODE
              </p>

              <Terminal className="h-4 w-4 text-[#d4b25a]" />
            </div>

            <h1
              className={`font-mono text-3xl sm:text-4xl font-bold uppercase tracking-[0.18em] transition-all duration-500 ${
                authenticationStage >= 5
                  ? "text-[#d4b25a] drop-shadow-[0_0_20px_rgba(212,178,90,0.35)]"
                  : "text-[#e7edf6]"
              }`}
            >
              {authenticationStage >= 5
                ? "ACCESS GRANTED"
                : "AUTHENTICATING..."}
            </h1>

            <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.25em] text-[#556a86]">
              STATE CRIME COMMAND // RESTRICTED NETWORK
            </p>
          </div>

          <div className="border border-[#142c4d] bg-[#071326]/80 backdrop-blur-md shadow-[0_25px_80px_-20px_rgba(0,0,0,0.9)]">
            <div className="flex items-center justify-between border-b border-[#142c4d] px-4 py-3 bg-[#081528]">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-[#d4b25a]" />

                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#8ba0bd]">
                  AUTHENTICATION PROTOCOL
                </span>
              </div>

              <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-[#d4b25a]">
                NODE: SYD-04
              </span>
            </div>

            <div className="p-5 sm:p-7">
              <div className="mb-7">
                <div className="flex justify-between mb-2">
                  <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#556a86]">
                    SYSTEM PROGRESS
                  </span>

                  <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#d4b25a]">
                    {authenticationStage >= 5
                      ? "100%"
                      : `${Math.min(
                          authenticationStage * 24,
                          88
                        )}%`}
                  </span>
                </div>

                <div className="h-1 bg-[#0b1b33] border border-[#142c4d] overflow-hidden">
                  <div
                    className="h-full bg-[#d4b25a] transition-all duration-700 ease-out shadow-[0_0_12px_rgba(212,178,90,0.5)]"
                    style={{
                      width:
                        authenticationStage >= 5
                          ? "100%"
                          : `${Math.min(
                              authenticationStage * 24,
                              88
                            )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                {[
                  {
                    icon: Radio,
                    text: "Verifying officer credentials",
                  },
                  {
                    icon: Lock,
                    text: "Validating clearance level",
                  },
                  {
                    icon: Database,
                    text: "Establishing secure session",
                  },
                  {
                    icon: ShieldCheck,
                    text: "Synchronising command access",
                  },
                ].map((item, index) => {
                  const Icon = item.icon;
                  const stage = index + 1;

                  const complete =
                    authenticationStage >= stage;

                  return (
                    <div
                      key={item.text}
                      className={`flex items-center gap-3 border px-3 py-3 transition-all duration-500 ${
                        complete
                          ? "border-[#d4b25a]/25 bg-[#d4b25a]/[0.035] text-[#d4b25a]"
                          : "border-[#102440] text-[#43556e]"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />

                      <span className="font-mono text-[9px] uppercase tracking-[0.15em]">
                        {item.text}
                      </span>

                      <span className="ml-auto font-mono text-[8px] uppercase tracking-wider">
                        {complete ? (
                          <span className="flex items-center gap-2">
                            <CheckCircle2 className="h-3 w-3" />
                            VERIFIED
                          </span>
                        ) : stage === authenticationStage + 1 ? (
                          <span className="animate-pulse">
                            PROCESSING
                          </span>
                        ) : (
                          "PENDING"
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#142c4d] mt-7 border border-[#142c4d]">
                {[
                  ["SECURE CHANNEL", "ACTIVE"],
                  ["AUTH NODE", "SYD-04"],
                  ["CLEARANCE", "RESTRICTED"],
                  [
                    "SESSION",
                    authenticationStage >= 5
                      ? "AUTHORISED"
                      : "PENDING",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="bg-[#071326] px-3 py-3"
                  >
                    <p className="font-mono text-[7px] uppercase tracking-[0.16em] text-[#556a86]">
                      {label}
                    </p>

                    <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#8ba0bd] mt-1">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-7 border border-[#142c4d] bg-[#040b15]">
                <div className="flex items-center gap-2 border-b border-[#142c4d] px-3 py-2">
                  <Terminal className="h-3 w-3 text-[#556a86]" />

                  <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#556a86]">
                    SECURITY EVENT LOG
                  </span>
                </div>

                <div className="p-3 min-h-[92px] font-mono text-[8px] uppercase tracking-[0.12em]">
                  {logLines.map((line, index) => (
                    <div
                      key={`${line}-${index}`}
                      className="flex gap-3 py-1 text-[#6f849f]"
                    >
                      <span className="text-[#33455f]">
                        [{String(index + 1).padStart(2, "0")}]
                      </span>

                      <span
                        className={
                          authenticationStage >= 5 &&
                          index >= logLines.length - 2
                            ? "text-[#d4b25a]"
                            : ""
                        }
                      >
                        {line}
                      </span>
                    </div>
                  ))}

                  {authenticationStage < 5 && (
                    <div className="flex gap-2 py-1 text-[#43556e]">
                      <span>&gt;</span>

                      <span className="animate-pulse">
                        AWAITING PROTOCOL RESPONSE...
                      </span>
                    </div>
                  )}

                  {authenticationStage >= 5 && (
                    <div className="flex gap-2 py-1 text-[#d4b25a]">
                      <span>&gt;</span>

                      <span className="animate-pulse">
                        CLEARANCE VERIFIED // REDIRECTING
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full animate-pulse ${
                      authenticationStage >= 5
                        ? "bg-[#d4b25a]"
                        : "bg-[#e05656]"
                    }`}
                  />

                  <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#556a86]">
                    {authenticationStage >= 5
                      ? "COMMAND ACCESS AUTHORISED"
                      : "SECURE TERMINAL // PLEASE WAIT"}
                  </span>
                </div>

                <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-[#43556e]">
                  {timeStr} // AEST // SYDNEY
                </div>
              </div>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes scan {
            0% {
              transform: translateY(0);
              opacity: 0;
            }

            10% {
              opacity: 1;
            }

            90% {
              opacity: 1;
            }

            100% {
              transform: translateY(100vh);
              opacity: 0;
            }
          }
        `}</style>
      </div>
    );
  }

  /*
   * NORMAL LOGIN SCREEN
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
                disabled={loading}
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 transition-colors uppercase tracking-wider font-mono disabled:opacity-60"
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
                disabled={loading}
                className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 transition-colors tracking-wider font-mono disabled:opacity-60"
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
            <ShieldCheck className="h-4 w-4" />
            Authenticate
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

      <style>{`
        @keyframes scan {
          0% {
            transform: translateY(0);
            opacity: 0;
          }

          10% {
            opacity: 1;
          }

          90% {
            opacity: 1;
          }

          100% {
            transform: translateY(100vh);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
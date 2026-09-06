import { useEffect, useState } from "react";

// Live-updating Sydney date & time clock.
export default function LiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const opts = { timeZone: "Australia/Sydney" };
  const date = now.toLocaleDateString("en-AU", {
    ...opts,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const time = now.toLocaleTimeString("en-AU", {
    ...opts,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return (
    <div className="text-right" data-testid="live-clock">
      <div className="font-mono-scc text-lg sm:text-xl text-[#f0d67a] tabular-nums tracking-wider">
        {time}
        <span className="ml-2 text-[10px] align-middle text-[#8ba0bd]">AEST · SYDNEY</span>
      </div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-[#8ba0bd] mt-0.5">{date}</div>
    </div>
  );
}

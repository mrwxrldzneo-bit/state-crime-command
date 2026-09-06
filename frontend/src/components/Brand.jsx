// NSWPF crest emblem + wordmark used across login and dashboard.
function Crest({ className = "" }) {
  return (
    <img
      src="/nswpf-logo.png"
      alt="New South Wales Police Force crest"
      className={`object-contain drop-shadow-[0_0_10px_rgba(212,178,90,0.25)] ${className}`}
      draggable={false}
    />
  );
}

export function Brand({ variant = "inline" }) {
  if (variant === "stacked") {
    return (
      <div className="flex flex-col items-center text-center" data-testid="brand-stacked">
        <div className="relative scc-corners">
          <span className="c tl" /><span className="c tr" /><span className="c bl" /><span className="c br" />
          <div className="scc-scanbox h-28 w-28 sm:h-32 sm:w-32 rounded-full flex items-center justify-center bg-[#060d1a]/60 ring-1 ring-[#d4b25a]/30">
            <Crest className="h-[86%] w-[86%]" />
          </div>
        </div>
        <h1 className="font-display text-3xl sm:text-4xl mt-6 text-[#f0d67a] uppercase tracking-[0.12em] leading-none">
          State Crime Command
        </h1>
        <p className="text-[12px] uppercase tracking-[0.3em] text-[#8ba0bd] mt-3">NSW Police Force</p>
        <p className="text-[11px] uppercase tracking-[0.28em] text-[#6f849f] mt-1.5">Case File Tracker</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3" data-testid="brand-inline">
      <div className="scc-scanbox h-12 w-12 rounded-full flex items-center justify-center bg-[#060d1a]/60 ring-1 ring-[#d4b25a]/30 shrink-0">
        <Crest className="h-[86%] w-[86%]" />
      </div>
      <div className="leading-tight">
        <h1 className="font-display uppercase tracking-[0.1em] text-[#f0d67a] text-lg sm:text-xl leading-none">
          State Crime Command
        </h1>
        <p className="text-[10px] uppercase tracking-[0.22em] text-[#8ba0bd] mt-1">NSW Police Force</p>
        <p className="text-[10px] uppercase tracking-[0.22em] text-[#6f849f] mt-0.5">Case File Tracker</p>
      </div>
    </div>
  );
}

export function Disclaimer({ className = "" }) {
  return (
    <p className={`text-[10px] leading-relaxed text-[#556a86] ${className}`} data-testid="legal-disclaimer">
      Unofficial fan-made roleplay tool. Not affiliated with or endorsed by the New South Wales Police Force.
      Crests and names belong to their respective owners and are used for non-commercial roleplay only.
    </p>
  );
}

export const STATUS_META = {
  pending: {
    label: "Pending Review",
    short: "PENDING",
    text: "text-[#f0d67a]",
    bg: "bg-[#3a2f12]",
    ring: "ring-[#d4b25a]/40",
    dot: "bg-[#d4b25a]",
  },
  opened: {
    label: "Opened",
    short: "OPENED",
    text: "text-[#79e0a4]",
    bg: "bg-[#0f2e1e]",
    ring: "ring-[#3fae6b]/40",
    dot: "bg-[#3fae6b]",
  },
  closed: {
    label: "Closed",
    short: "CLOSED",
    text: "text-[#a8b6c9]",
    bg: "bg-[#1a2740]",
    ring: "ring-[#41597e]/50",
    dot: "bg-[#6b7d99]",
  },
};

export function StatusBadge({ status, className = "" }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ${m.bg} ${m.text} ${m.ring} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

export const PRIORITY_META = {
  routine: { label: "Routine", text: "text-[#a8b6c9]", dot: "bg-[#6b7d99]", ring: "ring-[#41597e]/50", bg: "bg-[#18263e]" },
  urgent: { label: "Urgent", text: "text-[#f0d67a]", dot: "bg-[#d4b25a]", ring: "ring-[#d4b25a]/40", bg: "bg-[#332911]" },
  "high-risk": { label: "High-Risk", text: "text-[#f0a1a1]", dot: "bg-[#e05656]", ring: "ring-[#c0392b]/50", bg: "bg-[#2e1414]" },
};

export function PriorityDot({ priority, withLabel = false, className = "" }) {
  const m = PRIORITY_META[priority] || PRIORITY_META.routine;
  if (!withLabel) {
    return (
      <span
        title={`Priority: ${m.label}`}
        data-testid={`priority-dot-${priority}`}
        className={`inline-block h-2.5 w-2.5 rounded-full ${m.dot} ${priority === "high-risk" ? "scc-live-dot" : ""} ${className}`}
      />
    );
  }
  return (
    <span
      data-testid={`priority-badge-${priority}`}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ${m.bg} ${m.text} ${m.ring} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

export function formatDateTime(iso) {  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-AU", {
      timeZone: "Australia/Sydney",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "../context/AuthContext";
import api from "../lib/api";

import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  Pencil,
  FilePlus2,
  FileText,
  FolderOpen,
  History,
  LogOut,
  MessageCircle,
  Radio,
  Search,
  Send,
  Shield,
  Trash2,
  X,
} from "lucide-react";

const CASE_CACHE_KEY = "scc_vault_cases";
const NSWPF_LOGO_URL = "https://i.postimg.cc/nr2YrNNY/nswpf-logo.png";
const CASE_BANNER_URL =
  "https://i.postimg.cc/kgknJR43/Screenshot-2026-09-08-at-6-29-32-AM.png";
const SYSTEM_FOOTER_URL =
  "https://i.postimg.cc/2S368f7w/Screenshot-2026-09-08-at-6-28-15-AM.png";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "opened", label: "Opened" },
  { key: "closed", label: "Closed" },
  { key: "denied", label: "Denied" },
];

const DIVISIONS = [
  "Organised Crime Squad",
  "Strike Force Raptor",
  "Both",
];

const PRIORITIES = [
  "routine",
  "urgent",
  "high-risk",
];

function buildLocalProfessionalSummary(caseData) {
  const clean = (value) => {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    if (!text) return "";
    const sentence = text.charAt(0).toUpperCase() + text.slice(1);
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  };

  const basis = clean(caseData?.request_basis || caseData?.synopsis);
  const known = clean(caseData?.known_information);
  const objective = clean(caseData?.investigation_objective);
  const parts = [];

  if (basis) {
    parts.push(
      `This investigation was authorised following command review of the submitted grounds. ${basis}`
    );
  }
  if (known) {
    parts.push(
      `At the time of authorisation, the recorded known information was as follows: ${known}`
    );
  }
  if (objective) {
    parts.push(
      `The stated investigative objective is recorded as follows: ${objective}`
    );
  }

  return parts.join("\n\n") || "Investigation authorised following command review.";
}

function buildLocalEvidenceRegister(caseData, approvedBy, approvedAt) {
  const suffix = String(caseData?.case_id || "SCC").split("-").pop();
  return (Array.isArray(caseData?.supporting_material)
    ? caseData.supporting_material
    : []
  )
    .filter((item) => item?.description || item?.reference_url)
    .map((item, index) => ({
      evidence_id: `EVD-${suffix}-${String(index + 1).padStart(3, "0")}`,
      type: item?.type || "Other",
      description: item?.description || "",
      reference_url: item?.reference_url || "",
      submitted_by: caseData?.created_by || "Unknown",
      submitted_at: caseData?.created_at || approvedAt,
      registered_at: approvedAt,
      registered_by: approvedBy,
      source: "initial_submission",
    }));
}

const MATRIX_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*+=?/<>";

async function sccRemoteRequest(
  method,
  path,
  data,
  timeout = 30000
) {
  return api.request({
    method: String(method || "GET").toLowerCase(),
    url: path,
    timeout,
    ...(data !== undefined ? { data } : {}),
  });
}

let sharedAudioContext = null;

function getAudioContext() {
  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    if (
      !sharedAudioContext ||
      sharedAudioContext.state === "closed"
    ) {
      sharedAudioContext = new AudioContextClass();
    }

    if (sharedAudioContext.state === "suspended") {
      sharedAudioContext.resume().catch(() => {});
    }

    return sharedAudioContext;
  } catch (error) {
    console.warn("SCC audio unavailable:", error);
    return null;
  }
}

function playTypeClick() {
  const audioContext = getAudioContext();

  if (!audioContext) {
    return;
  }

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  // Softer mechanical terminal tick — deliberately quieter and less harsh.
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(1850, now);
  oscillator.frequency.exponentialRampToValueAtTime(
    1180,
    now + 0.018
  );

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.018, now + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);

  oscillator.start(now);
  oscillator.stop(now + 0.028);
}

function playSuccessSound() {
  const audioContext = getAudioContext();

  if (!audioContext) {
    return;
  }

  const now = audioContext.currentTime;
  const master = audioContext.createGain();

  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(
    0.11,
    now + 0.015
  );
  master.gain.exponentialRampToValueAtTime(
    0.0001,
    now + 0.55
  );

  master.connect(audioContext.destination);

  [520, 760, 1040].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = now + index * 0.09;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      0.32,
      start + 0.008
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + 0.17
    );

    oscillator.connect(gain);
    gain.connect(master);

    oscillator.start(start);
    oscillator.stop(start + 0.19);
  });
}

function dedupeCases(caseList) {
  const map = new Map();

  for (const item of Array.isArray(caseList) ? caseList : []) {
    const caseId = String(item?.case_id || "").trim();
    const fallbackKey =
      item?.backend_id ||
      item?.id ||
      item?.client_request_id ||
      item?.case_uid ||
      item?._id;

    const key = caseId || String(fallbackKey || "").trim();

    if (!key) {
      continue;
    }

    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      continue;
    }

    const existingTime = new Date(
      existing?.updated_at ||
      existing?.created_at ||
      0
    ).getTime();

    const incomingTime = new Date(
      item?.updated_at ||
      item?.created_at ||
      0
    ).getTime();

    map.set(
      key,
      incomingTime >= existingTime
        ? { ...existing, ...item }
        : { ...item, ...existing }
    );
  }

  return Array.from(map.values()).sort((a, b) => {
    const aTime = new Date(
      a?.updated_at || a?.created_at || 0
    ).getTime();

    const bTime = new Date(
      b?.updated_at || b?.created_at || 0
    ).getTime();

    return bTime - aTime;
  });
}

function readCachedCases() {
  try {
    const raw = localStorage.getItem(CASE_CACHE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    const deduped = dedupeCases(parsed);

    if (
      Array.isArray(parsed) &&
      deduped.length !== parsed.length
    ) {
      localStorage.setItem(
        CASE_CACHE_KEY,
        JSON.stringify(deduped)
      );
    }

    return deduped;
  } catch (error) {
    console.warn("Unable to read SCC vault cache:", error);
    return [];
  }
}

function writeCachedCases(nextCases) {
  try {
    const deduped = dedupeCases(nextCases);

    localStorage.setItem(
      CASE_CACHE_KEY,
      JSON.stringify(deduped)
    );
  } catch (error) {
    console.warn("Unable to write SCC vault cache:", error);
  }
}

function createInternalId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function generateDisplayCaseId(existingCases) {
  const year = new Date().getFullYear();
  let highest = 0;

  for (const caseData of existingCases) {
    const caseId = String(caseData?.case_id || "");
    const match = caseId.match(
      new RegExp(`^SCC-${year}-(\\d+)$`)
    );

    if (!match) {
      continue;
    }

    highest = Math.max(
      highest,
      Number.parseInt(match[1], 10) || 0
    );
  }

  return `SCC-${year}-${String(highest + 1).padStart(
    3,
    "0"
  )}`;
}

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

function getCaseKey(caseData) {
  return (
    caseData?.backend_id ||
    caseData?.id ||
    caseData?.case_uid ||
    caseData?._id ||
    ""
  );
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildCaseDiscordEmbeds(caseData) {
  return [
    {
      image: {
        url: CASE_BANNER_URL,
      },
    },
    {
      title: "STATE CRIME COMMAND // CASE DOSSIER",
      description:
        "A new case file has been logged through the **SCC Case Tracker**.",
      fields: [
        {
          name: "CASE ID",
          value: caseData.case_id,
          inline: true,
        },
        {
          name: "OPERATION NAME",
          value: caseData.name,
          inline: true,
        },
        {
          name: "LEAD INVESTIGATOR",
          value: caseData.lead_investigator,
          inline: true,
        },
        {
          name: "DIVISION",
          value: caseData.division,
          inline: true,
        },
        {
          name: "PRIORITY",
          value: String(caseData.priority).toUpperCase(),
          inline: true,
        },
        {
          name: "OFFICER ID / CALLSIGN",
          value: caseData.officer_id || "NOT RECORDED",
          inline: true,
        },
        {
          name: "SYNOPSIS",
          value: caseData.synopsis || "No synopsis supplied.",
          inline: false,
        },
      ],
    },
    {
      image: {
        url: SYSTEM_FOOTER_URL,
      },
      timestamp: new Date().toISOString(),
    },
  ];
}

function mergeCaseLists(localCases, remoteCases) {
  return dedupeCases([
    ...(Array.isArray(localCases) ? localCases : []),
    ...(Array.isArray(remoteCases) ? remoteCases : []),
  ]).map((item) => ({
    ...item,
    backend_id:
      item?.backend_id ||
      item?.id ||
      null,
    sync_status:
      item?.backend_id || item?.id
        ? "synced"
        : item?.sync_status || "local",
  }));
}

function randomMatrixChar() {
  return MATRIX_CHARS[
    Math.floor(Math.random() * MATRIX_CHARS.length)
  ];
}

function scrambleString(value) {
  return String(value || "")
    .split("")
    .map((character) => {
      if (character === " ") {
        return " ";
      }

      if (character === "-" || character === "/" || character === ":") {
        return character;
      }

      return randomMatrixChar();
    })
    .join("");
}

function ScrambleText({
  value,
  nonce,
  className = "",
}) {
  const finalValue = String(value ?? "");
  const [displayValue, setDisplayValue] = useState(finalValue);

  useEffect(() => {
    setDisplayValue(finalValue);

    if (!nonce) {
      return undefined;
    }

    const startedAt = performance.now();
    const duration = 150;

    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;

      if (elapsed >= duration) {
        window.clearInterval(timer);
        setDisplayValue(finalValue);
        return;
      }

      const progress = elapsed / duration;

      setDisplayValue(
        finalValue
          .split("")
          .map((character, index) => {
            if (
              character === " " ||
              character === "-" ||
              character === "/" ||
              character === ":"
            ) {
              return character;
            }

            const revealThreshold =
              (index + 1) /
              Math.max(finalValue.length, 1);

            return progress > revealThreshold
              ? character
              : randomMatrixChar();
          })
          .join("")
      );
    }, 25);

    return () => {
      window.clearInterval(timer);
    };
  }, [finalValue, nonce]);

  return (
    <span className={className}>
      {displayValue}
    </span>
  );
}

function GlassPanel({
  children,
  className = "",
}) {
  return (
    <div
      className={[
        "backdrop-blur-md",
        "bg-[#11243a]/68",
        "border border-[#1b324d]/80",
        "rounded-2xl",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_22px_70px_-42px_rgba(0,0,0,0.95)]",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status || "pending").toLowerCase();

  const styles = {
    pending:
      "bg-[#3a2f12]/85 border-[#665522] text-[#f0d67a]",
    opened:
      "bg-[#0f2e1e]/85 border-[#245d3d] text-[#79e0a4]",
    closed:
      "bg-[#172238]/90 border-[#2b4265] text-[#a8b6c9]",
    denied:
      "bg-[#2a1414]/90 border-[#6b2929] text-[#f08080]",
  };

  return (
    <span
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[9px] font-mono font-bold uppercase tracking-wider ${
        styles[normalized] || styles.pending
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {normalized}
    </span>
  );
}

function HeaderClock() {
  const [timeText, setTimeText] = useState("");
  const [dateText, setDateText] = useState("");
  const [zoneText, setZoneText] = useState("");

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();

      const timeParts = new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Sydney",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "short",
      }).formatToParts(now);

      const hour = timeParts.find((part) => part.type === "hour")?.value || "00";
      const minute = timeParts.find((part) => part.type === "minute")?.value || "00";
      const second = timeParts.find((part) => part.type === "second")?.value || "00";
      const zone =
        timeParts.find((part) => part.type === "timeZoneName")?.value || "AEST";

      setTimeText(`${hour}:${minute}:${second}`);
      setZoneText(zone.toUpperCase());

      setDateText(
        new Intl.DateTimeFormat("en-AU", {
          timeZone: "Australia/Sydney",
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        })
          .format(now)
          .toUpperCase()
      );
    };

    updateClock();
    const interval = window.setInterval(updateClock, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 flex-col items-center pointer-events-none">
      <div className="font-mono text-base font-bold tracking-[0.18em] text-[#d4b25a]">
        {timeText}
        <span className="ml-2 text-[10px] font-normal tracking-[0.16em] text-[#8196b2]">
          {zoneText} · SYDNEY
        </span>
      </div>

      <div className="mt-1 text-[9px] font-mono uppercase tracking-[0.28em] text-[#7186a0]">
        {dateText}
      </div>
    </div>
  );
}



function FullSupportWaiting({
  caseId,
  onClose,
  onEnd,
  ending,
  countdown,
}) {
  return (
    <div className="h-full min-h-0 flex flex-col bg-[#081321]/96">
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.26em] text-[#d4b25a]">
            Live Support
          </p>
          <p className="mt-1 text-sm font-bold tracking-[0.08em] text-[#e7edf6]">
            {caseId}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEnd}
            disabled={ending}
            className="px-3 py-2 rounded-xl border border-[#6b2929] bg-[#2a1414]/70 text-[9px] font-mono uppercase tracking-wider text-[#f08080] hover:bg-[#391919] disabled:opacity-50"
          >
            {countdown !== null
              ? `Ending ${countdown}`
              : ending
                ? "Ending..."
                : "End Chat"}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[#7186a0] hover:text-white hover:bg-[#142a42]/80"
            title="Hide Live Support"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-8">
        <div className="text-center">
          <div className="relative mx-auto h-16 w-16">
            <div className="absolute inset-0 rounded-full border border-[#d4b25a]/20 animate-ping" />
            <div className="absolute inset-2 rounded-full border border-[#d4b25a]/35 animate-pulse" />
            <div className="absolute inset-[22px] rounded-full bg-[#d4b25a]/90 shadow-[0_0_28px_rgba(212,178,90,0.22)]" />
          </div>

          <p className="mt-7 text-[11px] font-mono uppercase tracking-[0.32em] text-[#d4b25a] animate-pulse">
            Waiting for support
          </p>

          <p className="mt-3 text-[11px] leading-relaxed text-[#7186a0]">
            Your request has been sent to command.
            <br />
            This chat will open when a Support Agent replies.
          </p>

          <div className="mt-5 flex items-center justify-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#607793] animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#607793] animate-pulse [animation-delay:180ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#607793] animate-pulse [animation-delay:360ms]" />
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-14 text-center">
      <FolderOpen className="h-8 w-8 mx-auto text-[#365574]" />
      <p className="mt-3 text-xs font-mono uppercase tracking-[0.2em] text-[#7087a4]">
        No case files match this view
      </p>
      <p className="mt-1 text-[11px] text-[#536983]">
        Create a case file or switch ledger filters.
      </p>
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <label className="block mb-2 text-[10px] font-mono uppercase tracking-[0.17em] text-[#8ba0bd]">
      {children}
    </label>
  );
}

const INPUT_CLASS =
  "w-full bg-[#050b12] text-white placeholder:text-[#52647a] border border-[#1b324d]/80 rounded-xl px-3.5 py-3 outline-none focus:border-[#4f6785] focus:ring-1 focus:ring-[#294766]/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition";

export default function Dashboard() {
  const auth = useAuth();
  const user = auth?.user || null;
  const logout = auth?.logout;

  const normalizedRole = normalizeRole(user?.role);
  const isUserAdmin = normalizedRole === "ADMIN";
  const isUserDetective = normalizedRole === "DETECTIVE";
  const hasCaseAccess =
    isUserAdmin || isUserDetective;

  const operatorName =
    user?.username ||
    (() => {
      try {
        return JSON.parse(
          localStorage.getItem("scc_user") || "{}"
        )?.username;
      } catch {
        return "";
      }
    })() ||
    "UNKNOWN OPERATOR";

  const officerId =
    user?.officer_id ||
    localStorage.getItem("scc_officer_id") ||
    (() => {
      try {
        return JSON.parse(
          localStorage.getItem("scc_user") || "{}"
        )?.officer_id;
      } catch {
        return "";
      }
    })() ||
    "NOT RECORDED";

  const [cases, setCases] = useState(() => readCachedCases());
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [shuffleNonce, setShuffleNonce] = useState(0);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formError, setFormError] = useState("");

  const [caseName, setCaseName] = useState("");
  const [leadInvestigator, setLeadInvestigator] = useState("");
  const [division, setDivision] = useState(DIVISIONS[0]);
  const [priority, setPriority] = useState(PRIORITIES[0]);
  const [discordLink, setDiscordLink] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [requestBasis, setRequestBasis] = useState("");
  const [knownInformation, setKnownInformation] = useState("");
  const [investigationObjective, setInvestigationObjective] = useState("");
  const [supportingMaterial, setSupportingMaterial] = useState([]);

  const [selectedCase, setSelectedCase] = useState(null);
  const [commandChangeMode, setCommandChangeMode] = useState("no");
  const [reviewName, setReviewName] = useState("");
  const [reviewLead, setReviewLead] = useState("");
  const [reviewDivision, setReviewDivision] = useState(DIVISIONS[0]);
  const [reviewPriority, setReviewPriority] = useState(PRIORITIES[0]);
  const [reviewBasis, setReviewBasis] = useState("");
  const [reviewKnownInformation, setReviewKnownInformation] = useState("");
  const [reviewObjective, setReviewObjective] = useState("");
  const [reviewActionError, setReviewActionError] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [caseNote, setCaseNote] = useState("");
  const [caseNoteError, setCaseNoteError] = useState("");
  const [isSavingCaseNote, setIsSavingCaseNote] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState("overview");
  const [logAction, setLogAction] = useState("");
  const [logInformation, setLogInformation] = useState("");
  const [logOutcome, setLogOutcome] = useState("");
  const [logRelated, setLogRelated] = useState("");
  const [evidenceType, setEvidenceType] = useState("Screenshot / Image");
  const [evidenceDescription, setEvidenceDescription] = useState("");
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [personnelName, setPersonnelName] = useState("");
  const [commandRequestType, setCommandRequestType] = useState("priority_change");
  const [commandRequestValue, setCommandRequestValue] = useState("");
  const [commandRequestDetails, setCommandRequestDetails] = useState("");
  const [commandNote, setCommandNote] = useState("");
  const [closureSummary, setClosureSummary] = useState("");

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editCase, setEditCase] = useState(null);
  const [editName, setEditName] = useState("");
  const [editLeadInvestigator, setEditLeadInvestigator] = useState("");
  const [editDivision, setEditDivision] = useState(DIVISIONS[0]);
  const [editPriority, setEditPriority] = useState(PRIORITIES[0]);
  const [editDiscordLink, setEditDiscordLink] = useState("");
  const [editSynopsis, setEditSynopsis] = useState("");
  const [editError, setEditError] = useState("");

  const [isDenyOpen, setIsDenyOpen] = useState(false);
  const [denyTargetCase, setDenyTargetCase] = useState(null);
  const [denialReason, setDenialReason] = useState("");
  const [denialError, setDenialError] = useState("");

  const [chatCase, setChatCase] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatError, setChatError] = useState("");
  const [helpSent, setHelpSent] = useState(false);
  const [chatDiscordUrl, setChatDiscordUrl] = useState("");
  const [chatSessionActive, setChatSessionActive] = useState(false);
  const [endingSupport, setEndingSupport] = useState(false);
  const [supportEndingAt, setSupportEndingAt] = useState("");
  const [supportEndCountdown, setSupportEndCountdown] = useState(null);

  const seenDiscordMessageIdsRef = useRef(new Set());
  const supportConnectPromiseRef = useRef(null);

  const updateCases = useCallback((updater) => {
    setCases((currentCases) => {
      const nextCases =
        typeof updater === "function"
          ? updater(currentCases)
          : updater;

      const deduped = dedupeCases(nextCases);
      writeCachedCases(deduped);
      return deduped;
    });
  }, []);

  const reconcileRemoteCases = useCallback(async () => {
    try {
      const response = await sccRemoteRequest(
        "GET",
        "/cases",
        undefined,
        45000
      );

      const remoteCases = Array.isArray(response?.data)
        ? response.data
        : [];

      if (!remoteCases.length) {
        return;
      }

      updateCases((currentCases) =>
        mergeCaseLists(currentCases, remoteCases)
      );
    } catch {
      // Local vault remains authoritative if remote sync is unavailable.
    }
  }, [updateCases]);

  useEffect(() => {
    void reconcileRemoteCases();
  }, [reconcileRemoteCases]);

  const syncCreatedCase = useCallback(
    async (localCase) => {
      try {
        const response = await sccRemoteRequest(
          "POST",
          "/cases",
          {
            name: localCase.name,
            lead_investigator: localCase.lead_investigator,
            division: localCase.division,
            priority: localCase.priority,
            discord_url: localCase.discord_url,
            synopsis: localCase.synopsis,
            request_basis: localCase.request_basis || localCase.synopsis,
            known_information: localCase.known_information || "",
            investigation_objective: localCase.investigation_objective || "",
            supporting_material: Array.isArray(localCase.supporting_material)
              ? localCase.supporting_material.map(({ file, ...item }) => item)
              : [],
          },
          45000
        );

        if (!response?.data) {
          return;
        }

        let remoteCase = response.data;

        const pendingFiles = (localCase.supporting_material || []).filter((item) => item.file);
        for (const item of pendingFiles) {
          try {
            const upload = await api.post(`/cases/${remoteCase.id}/evidence`, item.file, {
              timeout: 60000,
              headers: {
                "Content-Type": item.file.type || "application/octet-stream",
                "X-SCC-Filename": item.file.name || "evidence-file",
                "X-SCC-Evidence-Type": item.type || "Other",
                "X-SCC-Description": item.description || "",
              },
            });
            if (upload?.data) remoteCase = upload.data;
          } catch (error) {
            console.error("Initial SCC evidence upload failed:", error);
          }
        }

        updateCases((currentCases) =>
          currentCases.map((item) => {
            const sameLocalCase =
              item.client_request_id ===
                localCase.client_request_id ||
              item.case_id === localCase.case_id;

            if (!sameLocalCase) {
              return item;
            }

            return {
              ...item,
              ...remoteCase,
              backend_id:
                remoteCase?.id ||
                remoteCase?.backend_id ||
                item.backend_id,
              officer_id:
                remoteCase?.officer_id ||
                item.officer_id,
              sync_status: "synced",
            };
          })
        );
      } catch {
        updateCases((currentCases) =>
          currentCases.map((item) =>
            item.client_request_id ===
            localCase.client_request_id
              ? {
                  ...item,
                  sync_status: "local",
                }
              : item
          )
        );
      }
    },
    [updateCases]
  );

  const ensureBackendCase = useCallback(
    async (caseData) => {
      if (caseData?.backend_id) {
        return caseData;
      }

      const response = await sccRemoteRequest(
        "POST",
        "/cases",
        {
          name: caseData.name,
          lead_investigator: caseData.lead_investigator,
          division: caseData.division,
          priority: caseData.priority,
          discord_url: caseData.discord_url || "",
          synopsis: caseData.synopsis || "",
          request_basis: caseData.request_basis || caseData.synopsis || "",
          known_information: caseData.known_information || "",
          investigation_objective: caseData.investigation_objective || "",
          supporting_material: Array.isArray(caseData.supporting_material)
            ? caseData.supporting_material
            : [],
        },
        45000
      );

      if (!response?.data) {
        throw new Error("Backend did not return the created case.");
      }

      const remoteCase = response.data;
      const mergedCase = {
        ...caseData,
        ...remoteCase,
        backend_id:
          remoteCase?.id ||
          remoteCase?.backend_id ||
          caseData?.backend_id ||
          null,
        officer_id:
          remoteCase?.officer_id ||
          caseData?.officer_id,
        sync_status: "synced",
      };

      updateCases((currentCases) =>
        currentCases.map((item) =>
          item.id === caseData.id ||
          item.case_id === caseData.case_id
            ? mergedCase
            : item
        )
      );

      return mergedCase;
    },
    [updateCases]
  );

  const ensureSupportSession = useCallback(
    async (caseData) => {
      const connectedCase = await ensureBackendCase(caseData);

      const caseKey =
        connectedCase?.backend_id ||
        connectedCase?.id ||
        connectedCase?.case_id;

      if (!caseKey) {
        throw new Error("Case could not be linked to the backend.");
      }

      const response = await sccRemoteRequest(
        "POST",
        `/cases/${caseKey}/help`,
        {
          message:
            "Investigator opened a live support chat session.",
          officer_id: officerId,
          username: operatorName,
          description: buildHelpDescription(connectedCase),
        },
        45000
      );

      const finalCase = {
        ...connectedCase,
        backend_id:
          connectedCase?.backend_id ||
          connectedCase?.id,
        help_session_id:
          response?.data?.session?.id ||
          connectedCase?.help_session_id ||
          null,
        help_session_active: true,
        help_discord_thread_url:
          response?.data?.discord_thread_url ||
          connectedCase?.help_discord_thread_url ||
          "",
        help_discord_status:
          response?.data?.discord_connected
            ? "connected"
            : "error",
      };

      const discordThreadUrl =
        response?.data?.discord_thread_url || "";

      updateCases((currentCases) =>
        currentCases.map((item) =>
          item.id === connectedCase.id ||
          item.case_id === connectedCase.case_id
            ? { ...item, ...finalCase }
            : item
        )
      );

      setChatCase(finalCase);
      setChatDiscordUrl(discordThreadUrl);
      setChatSessionActive(true);
      setHelpSent(Boolean(response?.data?.discord_connected));

      if (response?.data?.discord_connected) {
        setChatError("");
      } else {
        setChatError(
          response?.data?.discord_error ||
            "Discord support thread could not be created."
        );
      }

      return {
        caseData: finalCase,
        session: response?.data?.session || null,
        discordThreadUrl,
        discordConnected:
          Boolean(response?.data?.discord_connected),
      };
    },
    [
      ensureBackendCase,
      officerId,
      operatorName,
      updateCases,
    ]
  );

  const resetCreateForm = () => {
    setCaseName("");
    setLeadInvestigator("");
    setDivision(DIVISIONS[0]);
    setPriority(PRIORITIES[0]);
    setDiscordLink("");
    setSynopsis("");
    setRequestBasis("");
    setKnownInformation("");
    setInvestigationObjective("");
    setSupportingMaterial([]);
    setFormError("");
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    resetCreateForm();
  };

  const handleCreateCase = (event) => {
    event.preventDefault();

    const cleanName = caseName.trim();
    const cleanLead = leadInvestigator.trim();
    const cleanBasis = requestBasis.trim() || synopsis.trim();

    if (!cleanName) {
      setFormError("Case name is required.");
      return;
    }

    if (!cleanLead) {
      setFormError("Lead investigator is required.");
      return;
    }

    if (!cleanBasis) {
      setFormError("Basis for investigation is required.");
      return;
    }

    const existingCases = readCachedCases();
    const caseId = generateDisplayCaseId(existingCases);
    const now = new Date().toISOString();

    const createdCase = {
      id: createInternalId(),
      backend_id: null,
      client_request_id: createInternalId(),
      case_id: caseId,
      name: cleanName,
      lead_investigator: cleanLead,
      division,
      priority,
      discord_url: discordLink.trim(),
      synopsis: cleanBasis,
      request_basis: cleanBasis,
      known_information: knownInformation.trim(),
      investigation_objective: investigationObjective.trim(),
      supporting_material: supportingMaterial
        .map((item) => ({
          id: item.id || createInternalId(),
          type: item.type || "Other",
          description: String(item.description || "").trim(),
          reference_url: "",
          file: item.file || null,
        }))
        .filter((item) => item.description || item.file),
      requested_priority: priority,
      request_original: {
        name: cleanName,
        lead_investigator: cleanLead,
        division,
        priority,
        request_basis: cleanBasis,
        known_information: knownInformation.trim(),
        investigation_objective: investigationObjective.trim(),
      },
      workspace_unlocked: false,
      status: "pending",
      officer_id: String(officerId || "").trim().toUpperCase(),
      created_by: operatorName,
      created_at: now,
      updated_at: now,
      sync_status: "local",
    };

    const nextCases = [
      createdCase,
      ...existingCases.filter(
        (item) => item?.case_id !== caseId
      ),
    ];

    writeCachedCases(nextCases);
    setCases(nextCases);

    playSuccessSound();
    closeCreateModal();

    void syncCreatedCase(createdCase);
  };

  const addSupportingMaterial = () => {
    setSupportingMaterial((items) => [
      ...items,
      {
        id: createInternalId(),
        type: "Screenshot / Image",
        description: "",
        reference_url: "",
        file: null,
      },
    ]);
  };

  const updateSupportingMaterial = (id, field, value) => {
    setSupportingMaterial((items) =>
      items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const removeSupportingMaterial = (id) => {
    setSupportingMaterial((items) =>
      items.filter((item) => item.id !== id)
    );
  };

  const applyWorkspaceCase = (updated) => {
    if (!updated) return;
    setSelectedCase(updated);
    updateCases((items) => items.map((item) =>
      item.id === updated.id || item.case_id === updated.case_id ? { ...item, ...updated, backend_id: updated.id || item.backend_id } : item
    ));
  };

  const workspacePost = async (path, data) => {
    setWorkspaceBusy(true); setWorkspaceError("");
    try {
      const response = await sccRemoteRequest("POST", path, data, 60000);
      applyWorkspaceCase(response?.data);
      playSuccessSound();
      return response?.data;
    } catch (error) {
      setWorkspaceError(error?.response?.data?.detail || "Unable to complete this case action.");
      return null;
    } finally { setWorkspaceBusy(false); }
  };

  const addInvestigationEntry = async () => {
    if (!logAction.trim() || !selectedCase) return setWorkspaceError("Action taken is required.");
    const updated = await workspacePost(`/cases/${getCaseKey(selectedCase)}/investigation-log`, { action_taken: logAction, information_obtained: logInformation, outcome_further_action: logOutcome, related_records: logRelated });
    if (updated) { setLogAction(""); setLogInformation(""); setLogOutcome(""); setLogRelated(""); }
  };

  const uploadCaseEvidence = async () => {
    if (!selectedCase) return;
    if (evidenceType !== "Written Information" && !evidenceFile) return setWorkspaceError("Choose a file to upload.");
    setWorkspaceBusy(true); setWorkspaceError("");
    try {
      let response;
      if (evidenceType === "Written Information") {
        const blob = new Blob([evidenceDescription || "Written information"], { type: "text/plain" });
        response = await api.post(`/cases/${getCaseKey(selectedCase)}/evidence`, blob, { timeout: 60000, headers: { "Content-Type": "text/plain", "X-SCC-Filename": "written-information.txt", "X-SCC-Evidence-Type": evidenceType, "X-SCC-Description": evidenceDescription } });
      } else {
        response = await api.post(`/cases/${getCaseKey(selectedCase)}/evidence`, evidenceFile, { timeout: 60000, headers: { "Content-Type": evidenceFile.type || "application/octet-stream", "X-SCC-Filename": evidenceFile.name, "X-SCC-Evidence-Type": evidenceType, "X-SCC-Description": evidenceDescription } });
      }
      applyWorkspaceCase(response?.data); setEvidenceFile(null); setEvidenceDescription(""); playSuccessSound();
    } catch (error) { setWorkspaceError(error?.response?.data?.detail || "Evidence upload failed."); } finally { setWorkspaceBusy(false); }
  };

  const openEvidenceFile = async (item) => {
    try {
      const response = await api.get(`/cases/${getCaseKey(selectedCase)}/evidence/${item.evidence_id}/file`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setWorkspaceError("Unable to open this evidence file."); }
  };

  const removeEvidence = async (item) => {
    const reason = window.prompt(`Reason for removing ${item.evidence_id}:`);
    if (!reason?.trim()) return;
    await workspacePost(`/cases/${getCaseKey(selectedCase)}/evidence/${item.evidence_id}/remove`, { reason });
  };

  const assignInvestigator = async () => {
    if (!personnelName.trim()) return;
    const updated = await workspacePost(`/cases/${getCaseKey(selectedCase)}/personnel`, { investigator: personnelName.trim() });
    if (updated) setPersonnelName("");
  };

  const submitCommandRequest = async () => {
    const updated = await workspacePost(`/cases/${getCaseKey(selectedCase)}/command-requests`, { request_type: commandRequestType, requested_value: commandRequestValue, details: commandRequestDetails });
    if (updated) { setCommandRequestValue(""); setCommandRequestDetails(""); }
  };

  const decideCommandRequest = async (requestId, decision) => {
    const reason = window.prompt(`Command decision reason (${decision}):`) || "";
    await workspacePost(`/cases/${getCaseKey(selectedCase)}/command-requests/${requestId}/decision`, { decision, reason });
  };

  const toggleCommandFlag = async (flag) => {
    const current = Array.isArray(selectedCase.command_flags) ? selectedCase.command_flags : [];
    const flags = current.includes(flag) ? current.filter((x) => x !== flag) : [...current, flag];
    setWorkspaceBusy(true);
    try { const response = await sccRemoteRequest("PUT", `/cases/${getCaseKey(selectedCase)}/command-flags`, { flags }); applyWorkspaceCase(response?.data); }
    catch (error) { setWorkspaceError(error?.response?.data?.detail || "Unable to update Command flags."); } finally { setWorkspaceBusy(false); }
  };

  const addCommandNote = async () => {
    if (!commandNote.trim()) return;
    const updated = await workspacePost(`/cases/${getCaseKey(selectedCase)}/command-notes`, { note: commandNote });
    if (updated) setCommandNote("");
  };

  const requestCaseClosure = async () => {
    if (!closureSummary.trim()) return setWorkspaceError("Closure outcome summary is required.");
    const updated = await workspacePost(`/cases/${getCaseKey(selectedCase)}/closure-request`, { outcome_summary: closureSummary });
    if (updated) setClosureSummary("");
  };

  const decideClosure = async (decision) => {
    await workspacePost(`/cases/${getCaseKey(selectedCase)}/closure-request/${decision}`, {});
  };

  const handleFilterChange = (nextFilter) => {
    if (nextFilter === filter) {
      return;
    }

    playTypeClick();
    setFilter(nextFilter);
    setShuffleNonce((value) => value + 1);
  };

  const filteredCases = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return cases.filter((caseData) => {
      const status = String(
        caseData?.status || "pending"
      ).toLowerCase();

      const matchesFilter =
        filter === "all" || filter === status;

      if (!matchesFilter) {
        return false;
      }

      if (!cleanSearch) {
        return true;
      }

      const searchable = [
        caseData?.case_id,
        caseData?.name,
        caseData?.lead_investigator,
        caseData?.division,
        caseData?.officer_id,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return searchable.includes(cleanSearch);
    });
  }, [cases, filter, search]);

  const counts = useMemo(() => {
    const result = {
      pending: 0,
      opened: 0,
      closed: 0,
      denied: 0,
    };

    for (const caseData of cases) {
      const status = String(
        caseData?.status || "pending"
      ).toLowerCase();

      if (status in result) {
        result[status] += 1;
      }
    }

    return result;
  }, [cases]);

  const updateCaseStatus = async (
    caseData,
    nextStatus
  ) => {
    const now = new Date().toISOString();

    updateCases((currentCases) =>
      currentCases.map((item) =>
        item.id === caseData.id ||
        item.case_id === caseData.case_id
          ? {
              ...item,
              status: nextStatus,
              updated_at: now,
              updated_by: operatorName,
            }
          : item
      )
    );

    playSuccessSound();

    const backendKey = getCaseKey(caseData);

    if (!caseData.backend_id || !backendKey) {
      return;
    }

    try {
      if (nextStatus === "opened") {
        await sccRemoteRequest(
          "POST",
          `/cases/${backendKey}/approve`,
          {},
          30000
        );
      } else if (nextStatus === "denied") {
        await api.post(
          `/cases/${backendKey}/deny`,
          {
            denial_reason:
              "Denied from the streamlined SCC dashboard.",
          },
          { timeout: 8000 }
        );
      }
    } catch (error) {
      console.warn(
        `Backend ${nextStatus} sync unavailable:`,
        error?.message || error
      );
    }
  };

  const openEditCase = (caseData) => {
    setEditCase(caseData);
    setEditName(caseData?.name || "");
    setEditLeadInvestigator(caseData?.lead_investigator || "");
    setEditDivision(caseData?.division || DIVISIONS[0]);
    setEditPriority(caseData?.priority || PRIORITIES[0]);
    setEditDiscordLink(caseData?.discord_url || "");
    setEditSynopsis(caseData?.synopsis || "");
    setEditError("");
    setIsEditOpen(true);
  };

  const closeEditCase = () => {
    setIsEditOpen(false);
    setEditCase(null);
    setEditError("");
  };

  const handleSaveEdit = async (event) => {
    event.preventDefault();

    if (!editCase) {
      return;
    }

    const cleanName = editName.trim();
    const cleanLead = editLeadInvestigator.trim();

    if (!cleanName || !cleanLead) {
      setEditError("Case name and lead investigator are required.");
      return;
    }

    const now = new Date().toISOString();

    const updatedLocalCase = {
      ...editCase,
      name: cleanName,
      lead_investigator: cleanLead,
      division: editDivision,
      priority: editPriority,
      discord_url: editDiscordLink.trim(),
      synopsis: editSynopsis.trim(),
      updated_at: now,
      updated_by: operatorName,
    };

    updateCases((currentCases) =>
      currentCases.map((item) =>
        item.id === editCase.id ||
        item.case_id === editCase.case_id
          ? updatedLocalCase
          : item
      )
    );

    if (selectedCase?.case_id === editCase.case_id) {
      setSelectedCase(updatedLocalCase);
    }

    playSuccessSound();
    closeEditCase();

    const backendKey = editCase?.backend_id;

    if (!backendKey) {
      return;
    }

    try {
      const response = await sccRemoteRequest(
        "PUT",
        `/cases/${backendKey}`,
        {
          name: cleanName,
          lead_investigator: cleanLead,
          division: editDivision,
          priority: editPriority,
          discord_url: editDiscordLink.trim(),
          synopsis: editSynopsis.trim(),
        },
        30000
      );

      if (response?.data) {
        updateCases((currentCases) =>
          currentCases.map((item) =>
            item.id === editCase.id ||
            item.case_id === editCase.case_id
              ? {
                  ...item,
                  ...response.data,
                  backend_id: response.data.id || backendKey,
                  sync_status: "synced",
                }
              : item
          )
        );
      }
    } catch {
      // Local edit is already persisted; remote sync can recover later.
    }
  };

  const openDenyDialog = (caseData) => {
    setDenyTargetCase(caseData);
    setDenialReason("");
    setDenialError("");
    setIsDenyOpen(true);
  };

  const closeDenyDialog = () => {
    setIsDenyOpen(false);
    setDenyTargetCase(null);
    setDenialReason("");
    setDenialError("");
  };

  const handleSubmitDenial = async (event) => {
    event.preventDefault();

    if (!denyTargetCase) {
      return;
    }

    const reason = denialReason.trim();

    if (!reason) {
      setDenialError("A denial reason is required.");
      return;
    }

    const now = new Date().toISOString();

    updateCases((currentCases) =>
      currentCases.map((item) =>
        item.id === denyTargetCase.id ||
        item.case_id === denyTargetCase.case_id
          ? {
              ...item,
              status: "denied",
              denial_reason: reason,
              denied_by: operatorName,
              denied_at: now,
              updated_at: now,
            }
          : item
      )
    );

    playSuccessSound();
    closeDenyDialog();

    const backendKey = denyTargetCase?.backend_id;

    if (!backendKey) {
      return;
    }

    try {
      const response = await sccRemoteRequest(
        "POST",
        `/cases/${backendKey}/deny`,
        {
          denial_reason: reason,
        },
        30000
      );

      if (response?.data) {
        updateCases((currentCases) =>
          currentCases.map((item) =>
            item.id === denyTargetCase.id ||
            item.case_id === denyTargetCase.case_id
              ? {
                  ...item,
                  ...response.data,
                  backend_id: response.data.id || backendKey,
                  sync_status: "synced",
                }
              : item
          )
        );
      }
    } catch {
      // Local denial remains recorded even if the remote notification is delayed.
    }
  };

  const handleDeleteCase = async (caseData) => {
    const confirmed = window.confirm(
      `Permanently delete ${caseData.case_id} — ${caseData.name}?`
    );

    if (!confirmed) {
      return;
    }

    updateCases((currentCases) =>
      currentCases.filter(
        (item) =>
          item.id !== caseData.id &&
          item.case_id !== caseData.case_id
      )
    );

    if (
      selectedCase?.case_id === caseData.case_id
    ) {
      setIsDetailOpen(false);
      setSelectedCase(null);
    }

    const backendKey = caseData?.backend_id;

    if (!backendKey) {
      return;
    }

    try {
      await sccRemoteRequest(
        "DELETE",
        `/cases/${backendKey}`,
        undefined,
        30000
      );
    } catch (error) {
      console.warn(
        "Backend delete sync unavailable:",
        error?.message || error
      );
    }
  };

  const primeCommandReview = (caseData) => {
    setCommandChangeMode("no");
    setReviewName(caseData?.name || "");
    setReviewLead(caseData?.lead_investigator || "");
    setReviewDivision(caseData?.division || DIVISIONS[0]);
    setReviewPriority(caseData?.priority || PRIORITIES[0]);
    setReviewBasis(caseData?.request_basis || caseData?.synopsis || "");
    setReviewKnownInformation(caseData?.known_information || "");
    setReviewObjective(caseData?.investigation_objective || "");
    setReviewActionError("");
    setReviewSubmitting(false);
  };

  const openCaseDetail = async (caseData) => {
    setSelectedCase(caseData);
    primeCommandReview(caseData);
    setCaseNote("");
    setCaseNoteError("");
    setIsDetailOpen(true);

    const backendKey = getCaseKey(caseData);

    if (!caseData?.backend_id || !backendKey) {
      return;
    }

    try {
      const response = await sccRemoteRequest(
        "GET",
        `/cases/${backendKey}`,
        undefined,
        30000
      );

      if (response?.data) {
        const refreshed = {
          ...caseData,
          ...response.data,
          backend_id:
            response.data?.id ||
            caseData?.backend_id ||
            caseData?.id,
        };

        setSelectedCase(refreshed);
        primeCommandReview(refreshed);

        updateCases((currentCases) =>
          currentCases.map((item) =>
            item.id === caseData.id ||
            item.case_id === caseData.case_id
              ? { ...item, ...refreshed }
              : item
          )
        );
      }
    } catch {
      // Keep the cached case visible if detail refresh is unavailable.
    }
  };

  const closeCaseDetail = () => {
    setIsDetailOpen(false);
    setSelectedCase(null);
    setCaseNote("");
    setCaseNoteError("");
    setIsSavingCaseNote(false);
    setCommandChangeMode("no");
    setReviewActionError("");
    setReviewSubmitting(false);
  };

  const handleApproveFromReview = async () => {
    if (!selectedCase || !isUserAdmin || reviewSubmitting) {
      return;
    }

    const cleanName = reviewName.trim();
    const cleanLead = reviewLead.trim();
    const cleanBasis = reviewBasis.trim();

    if (commandChangeMode === "yes") {
      if (!cleanName) {
        setReviewActionError("Case name cannot be blank.");
        return;
      }
      if (!cleanLead) {
        setReviewActionError("Lead investigator cannot be blank.");
        return;
      }
      if (!cleanBasis) {
        setReviewActionError("Basis for investigation cannot be blank.");
        return;
      }
    }

    setReviewSubmitting(true);
    setReviewActionError("");

    const approvedAt = new Date().toISOString();
    const changed =
      commandChangeMode === "yes";

    const approvedCase = {
      ...selectedCase,
      ...(changed
        ? {
            name: cleanName,
            lead_investigator: cleanLead,
            division: reviewDivision,
            priority: reviewPriority,
            request_basis: cleanBasis,
            synopsis: cleanBasis,
            known_information: reviewKnownInformation.trim(),
            investigation_objective: reviewObjective.trim(),
            command_adjusted_by: operatorName,
            command_adjusted_at: approvedAt,
          }
        : {}),
      status: "opened",
      approved_by: operatorName,
      approved_at: approvedAt,
      updated_at: approvedAt,
      workspace_unlocked: true,
    };

    approvedCase.case_file = {
      created_at: approvedAt,
      created_by: operatorName,
      professional_summary: buildLocalProfessionalSummary(approvedCase),
      investigation_basis:
        approvedCase.request_basis || approvedCase.synopsis || "",
      known_information: approvedCase.known_information || "",
      investigation_objective:
        approvedCase.investigation_objective || "",
      evidence: buildLocalEvidenceRegister(
        approvedCase,
        operatorName,
        approvedAt
      ),
      investigation_log: [],
      assigned_investigators: approvedCase.lead_investigator
        ? [approvedCase.lead_investigator]
        : [],
    };

    updateCases((currentCases) =>
      currentCases.map((item) =>
        item.id === selectedCase.id ||
        item.case_id === selectedCase.case_id
          ? approvedCase
          : item
      )
    );
    setSelectedCase(approvedCase);
    playSuccessSound();

    const backendKey = getCaseKey(selectedCase);
    if (!selectedCase?.backend_id || !backendKey) {
      setReviewSubmitting(false);
      return;
    }

    try {
      const response = await sccRemoteRequest(
        "POST",
        `/cases/${backendKey}/approve`,
        changed
          ? {
              change_requested: true,
              name: cleanName,
              lead_investigator: cleanLead,
              division: reviewDivision,
              priority: reviewPriority,
              request_basis: cleanBasis,
              known_information: reviewKnownInformation.trim(),
              investigation_objective: reviewObjective.trim(),
            }
          : { change_requested: false },
        30000
      );

      if (response?.data) {
        const synced = {
          ...approvedCase,
          ...response.data,
          backend_id:
            response.data.id ||
            selectedCase.backend_id ||
            selectedCase.id,
          sync_status: "synced",
        };
        updateCases((currentCases) =>
          currentCases.map((item) =>
            item.id === selectedCase.id ||
            item.case_id === selectedCase.case_id
              ? synced
              : item
          )
        );
        setSelectedCase(synced);
      }
    } catch (error) {
      setReviewActionError(
        error?.response?.data?.detail ||
          "Case was updated locally, but command approval could not sync to the server."
      );
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleAddCaseNote = async (event) => {
    event.preventDefault();

    const note = caseNote.trim();

    if (!selectedCase || !note || isSavingCaseNote) {
      return;
    }

    const createdAt = new Date().toISOString();
    const optimisticNote = {
      id: createInternalId(),
      note,
      author: operatorName,
      kind: "note",
      created_at: createdAt,
    };

    setCaseNoteError("");
    setIsSavingCaseNote(true);

    const optimisticCase = {
      ...selectedCase,
      updated_at: createdAt,
      notes: [
        ...(Array.isArray(selectedCase?.notes)
          ? selectedCase.notes
          : []),
        optimisticNote,
      ],
    };

    setSelectedCase(optimisticCase);

    updateCases((currentCases) =>
      currentCases.map((item) =>
        item.id === selectedCase.id ||
        item.case_id === selectedCase.case_id
          ? { ...item, ...optimisticCase }
          : item
      )
    );

    setCaseNote("");

    const backendKey = getCaseKey(selectedCase);

    if (!selectedCase?.backend_id || !backendKey) {
      setIsSavingCaseNote(false);
      return;
    }

    try {
      const response = await sccRemoteRequest(
        "POST",
        `/cases/${backendKey}/notes`,
        { note },
        30000
      );

      if (response?.data) {
        const refreshed = {
          ...optimisticCase,
          ...response.data,
          backend_id:
            response.data?.id ||
            selectedCase?.backend_id,
        };

        setSelectedCase(refreshed);

        updateCases((currentCases) =>
          currentCases.map((item) =>
            item.id === selectedCase.id ||
            item.case_id === selectedCase.case_id
              ? { ...item, ...refreshed }
              : item
          )
        );
      }

      playSuccessSound();
    } catch (error) {
      setCaseNoteError(
        error?.response?.data?.detail ||
        "The note could not be synced."
      );
    } finally {
      setIsSavingCaseNote(false);
    }
  };

  const buildHelpDescription = () =>
    "An officer has requested assistance through the **SCC Case Tracker**.";

  const hydrateChatFromSession = useCallback((sessionPayload) => {
    const incoming = Array.isArray(sessionPayload?.messages)
      ? sessionPayload.messages
      : [];

    seenDiscordMessageIdsRef.current = new Set(
      incoming.map((message) => message?.id).filter(Boolean)
    );

    setChatMessages(
      incoming.map((message) => ({
        id: message?.id || createInternalId(),
        author:
          message?.source === "discord"
            ? "Support Agent"
            : message?.author ||
              message?.username ||
              "SUPPORT",
        content:
          message?.content ||
          message?.message ||
          "",
        timestamp:
          message?.timestamp ||
          message?.created_at ||
          new Date().toISOString(),
        source: message?.source || "discord",
      }))
    );

    setHelpSent(Boolean(sessionPayload?.discord_connected));
    setChatDiscordUrl(sessionPayload?.discord_thread_url || "");
    setChatError(sessionPayload?.discord_error || "");
    setChatSessionActive(
      sessionPayload?.help_session_active !== false &&
      sessionPayload?.active !== false
    );
    setSupportEndingAt(sessionPayload?.help_ending_at || "");
    setEndingSupport(
      sessionPayload?.help_discord_status === "ending" ||
      Boolean(sessionPayload?.help_ending_at)
    );
  }, []);

  const restoreExistingSupportSession = useCallback(
    async (caseData) => {
      const connectedCase = await ensureBackendCase(caseData);
      const caseKey =
        connectedCase?.backend_id ||
        connectedCase?.id ||
        connectedCase?.case_id;

      const response = await sccRemoteRequest(
        "GET",
        `/cases/${caseKey}/help/session`,
        undefined,
        30000
      );

      setChatCase({
        ...connectedCase,
        help_session_active: true,
      });
      hydrateChatFromSession(response?.data || {});
      return response?.data || {};
    },
    [ensureBackendCase, hydrateChatFromSession]
  );

  const openHelpChat = (caseData) => {
    setChatCase(caseData);
    setChatInput("");
    setChatError("");
    setIsChatOpen(true);

    const hasExistingSession =
      Boolean(caseData?.help_session_active) &&
      Boolean(caseData?.help_session_id);

    if (hasExistingSession) {
      void restoreExistingSupportSession(caseData).catch(() => {
        setChatError(
          "The saved Live Support session could not be restored from the backend."
        );
      });
      return;
    }

    setChatMessages([]);
    setHelpSent(false);
    setChatDiscordUrl("");
    setChatSessionActive(true);
    seenDiscordMessageIdsRef.current = new Set();

    const connectPromise = ensureSupportSession(caseData)
      .then((connected) => {
        hydrateChatFromSession({
          ...(connected?.session || {}),
          discord_connected: connected?.discordConnected,
          discord_thread_url: connected?.discordThreadUrl,
          help_session_active: true,
        });
        return connected;
      })
      .catch(() => {
        setChatError(
          "Live support chat is open. Discord connection could not be established."
        );
        throw new Error("Support connection failed.");
      })
      .finally(() => {
        supportConnectPromiseRef.current = null;
      });

    supportConnectPromiseRef.current = connectPromise;
    void connectPromise.catch(() => {});
  };

  const closeHelpChat = () => {
    // Closing the panel only hides it. The case-linked support session remains active.
    setIsChatOpen(false);
    setChatInput("");
  };

  const handleEndWaitingSupport = async () => {
    if (!chatCase || endingSupport) {
      return;
    }

    const confirmed = window.confirm(
      `End the Live Support session for ${chatCase.case_id}?`
    );
    if (!confirmed) {
      return;
    }

    const caseKey =
      chatCase?.backend_id ||
      chatCase?.id ||
      chatCase?.case_id;

    try {
      setEndingSupport(true);

      const response = await sccRemoteRequest(
        "POST",
        `/cases/${caseKey}/help/end`,
        {},
        30000
      );

      const endingAt =
        response?.data?.ending_at ||
        response?.data?.case?.help_ending_at ||
        "";

      setSupportEndingAt(endingAt);
      setChatSessionActive(true);

      updateCases((currentCases) =>
        currentCases.map((item) =>
          item.id === chatCase.id ||
          item.case_id === chatCase.case_id
            ? {
                ...item,
                ...(response?.data?.case || {}),
                help_session_active: true,
                help_discord_status: "ending",
                help_ending_at: endingAt,
              }
            : item
        )
      );
    } catch (error) {
      setEndingSupport(false);
      setChatError(
        error?.response?.data?.detail ||
        "Live Support could not be ended."
      );
    }
  };

  const handleEndSupportChat = async () => {
    if (!chatCase || !isUserAdmin || endingSupport) {
      return;
    }

    const confirmed = window.confirm(
      `End the Live Support session for ${chatCase.case_id}?`
    );
    if (!confirmed) {
      return;
    }

    const caseKey =
      chatCase?.backend_id ||
      chatCase?.id ||
      chatCase?.case_id;

    try {
      setEndingSupport(true);

      const response = await sccRemoteRequest(
        "POST",
        `/cases/${caseKey}/help/clear`,
        {},
        30000
      );

      const endingAt =
        response?.data?.ending_at ||
        response?.data?.case?.help_ending_at ||
        "";

      setSupportEndingAt(endingAt);
      setChatSessionActive(true);

      updateCases((currentCases) =>
        currentCases.map((item) =>
          item.id === chatCase.id ||
          item.case_id === chatCase.case_id
            ? {
                ...item,
                ...(response?.data?.case || {}),
                help_session_active: true,
                help_discord_status: "ending",
                help_ending_at: endingAt,
              }
            : item
        )
      );
    } catch (error) {
      setEndingSupport(false);
      setChatError(
        error?.response?.data?.detail ||
        "Live Support could not be ended."
      );
    }
  };

  useEffect(() => {
    if (!supportEndingAt || !chatSessionActive) {
      setSupportEndCountdown(null);
      return undefined;
    }

    let disposed = false;

    const updateCountdown = () => {
      const endMs = new Date(supportEndingAt).getTime();

      if (Number.isNaN(endMs)) {
        setSupportEndCountdown(null);
        return;
      }

      const seconds = Math.max(
        0,
        Math.ceil((endMs - Date.now()) / 1000)
      );

      setSupportEndCountdown(seconds);

      if (seconds <= 0 && !disposed) {
        updateCases((currentCases) =>
          currentCases.map((item) =>
            item.id === chatCase?.id ||
            item.case_id === chatCase?.case_id
              ? {
                  ...item,
                  help_session_active: false,
                  help_discord_status: "ended",
                  help_ending_at: null,
                }
              : item
          )
        );

        setChatSessionActive(false);
        setEndingSupport(false);

        window.setTimeout(() => {
          if (disposed) return;

          setIsChatOpen(false);
          setChatCase(null);
          setChatMessages([]);
          setChatInput("");
          setChatError("");
          setHelpSent(false);
          setChatDiscordUrl("");
          setSupportEndingAt("");
          setSupportEndCountdown(null);
          playSuccessSound();
        }, 350);
      }
    };

    updateCountdown();

    const interval = window.setInterval(
      updateCountdown,
      250
    );

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [
    supportEndingAt,
    chatSessionActive,
    chatCase?.id,
    chatCase?.case_id,
    updateCases,
  ]);


  useEffect(() => {
    if (!isChatOpen || !chatCase?.case_id) {
      return undefined;
    }

    let disposed = false;

    const pollDiscordReplies = async () => {
      try {
        const caseKey =
          chatCase?.backend_id ||
          chatCase?.id ||
          chatCase?.case_id;

        const response = await sccRemoteRequest(
          "GET",
          `/cases/${caseKey}/help/session`,
          undefined,
          30000
        );

        const payload = response?.data;

        setHelpSent(Boolean(payload?.discord_connected));
        setChatDiscordUrl(payload?.discord_thread_url || "");
        setChatSessionActive(
          payload?.help_session_active !== false &&
          payload?.active !== false
        );
        setSupportEndingAt(payload?.help_ending_at || "");
        setEndingSupport(
          payload?.help_discord_status === "ending" ||
          Boolean(payload?.help_ending_at)
        );
        if (payload?.discord_error) {
          setChatError(payload.discord_error);
        }

        const incoming = Array.isArray(payload?.messages)
          ? payload.messages.filter(
              (message) => message?.source === "discord"
            )
          : [];

        if (disposed || !incoming.length) {
          return;
        }

        setChatMessages((currentMessages) => {
          const currentIds = new Set(
            currentMessages
              .map((message) => message?.id)
              .filter(Boolean)
          );

          const additions = incoming.filter((message) => {
            const messageId =
              message?.id ||
              `${message?.author || "discord"}-${message?.timestamp || message?.created_at || ""}-${message?.content || message?.message || ""}`;

            if (
              currentIds.has(messageId) ||
              seenDiscordMessageIdsRef.current.has(messageId)
            ) {
              return false;
            }

            seenDiscordMessageIdsRef.current.add(messageId);
            return true;
          });

          if (additions.length) {
            additions.forEach(() => playTypeClick());
          }

          return [
            ...currentMessages,
            ...additions.map((message) => ({
              id:
                message?.id ||
                createInternalId(),
              author: "Support Agent",
              content:
                message?.content ||
                message?.message ||
                "",
              timestamp:
                message?.timestamp ||
                message?.created_at ||
                new Date().toISOString(),
              source: "discord",
            })),
          ];
        });
      } catch {
        // Polling failures are intentionally silent.
        // The local chat remains usable even if Discord/backend is offline.
      }
    };

    void pollDiscordReplies();

    const interval = window.setInterval(
      pollDiscordReplies,
      1000
    );

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [isChatOpen, chatCase?.case_id]);

  const handleSendChatMessage = async (event) => {
    event.preventDefault();

    const message = chatInput.trim();

    if (!message || !chatCase) {
      return;
    }

    playTypeClick();

    const localMessage = {
      id: createInternalId(),
      author: operatorName,
      content: message,
      timestamp: new Date().toISOString(),
      source: "website",
    };

    setChatMessages((currentMessages) => [
      ...currentMessages,
      localMessage,
    ]);

    setChatInput("");

    try {
      let connectedCase = chatCase;

      if (!helpSent || !connectedCase?.backend_id) {
        const existingConnection =
          supportConnectPromiseRef.current;

        const connected = existingConnection
          ? await existingConnection
          : await ensureSupportSession(connectedCase);

        connectedCase =
          connected?.caseData || connectedCase;
      }

      const caseKey =
        connectedCase?.backend_id ||
        connectedCase?.id ||
        connectedCase?.case_id;

      await sccRemoteRequest(
        "POST",
        `/cases/${caseKey}/help/chat`,
        {
          message,
          officer_id: officerId,
          username: operatorName,
        },
        30000
      );

      setChatError("");
    } catch (error) {
      console.warn(
        "Discord support delivery is temporarily unavailable:",
        error
      );
    }
  };

  const handleChatInputChange = (event) => {
    const nextValue = event.target.value;

    if (nextValue.length > chatInput.length) {
      playTypeClick();
    }

    setChatInput(nextValue);
  };

  const handleSignOut = async () => {
    try {
      if (typeof logout === "function") {
        await logout();
      }
    } finally {
      window.location.href = "/login";
    }
  };

  const hasSupportAgentReply = chatMessages.some(
    (message) => message?.source === "discord"
  );

  if (!hasCaseAccess && user) {
    return (
      <div className="min-h-screen bg-[#061321] flex items-center justify-center p-6 text-white">
        <GlassPanel className="max-w-lg w-full p-8 text-center">
          <Shield className="h-10 w-10 mx-auto text-[#d4b25a]" />
          <h1 className="mt-4 text-xl font-bold uppercase tracking-wider">
            SCC Access Restricted
          </h1>
          <p className="mt-2 text-sm text-[#8ba0bd]">
            Your account does not hold an authorised SCC role.
          </p>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#061321] text-[#e7edf6] antialiased"
      style={{
        backgroundImage:
          "linear-gradient(rgba(39,73,108,0.26) 1px, transparent 1px), linear-gradient(90deg, rgba(39,73,108,0.26) 1px, transparent 1px)",
        backgroundSize: "42px 42px",
      }}
    >
      <header className="sticky top-0 z-40 border-b border-[#294766]/80 bg-[#0a1a2b]/88 backdrop-blur-xl">
        <div className="relative max-w-7xl mx-auto px-4 md:px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl border border-[#1b324d]/80 bg-[#0d1b2a]/75 backdrop-blur-md p-1.5">
              <img
                src={NSWPF_LOGO_URL}
                alt="NSW Police Force"
                className="h-full w-full object-contain"
              />
            </div>

            <div>
              <h1 className="text-base md:text-lg font-bold uppercase tracking-[0.08em] text-[#e7edf6]">
                State Crime Command
              </h1>
              <p className="text-[9px] font-mono uppercase tracking-[0.28em] text-[#607793]">
                NSW Police Force · Case File Tracker
              </p>
            </div>
          </div>

          <HeaderClock />

          <div className="flex items-center gap-2 md:justify-end">
            <div className="hidden sm:block text-right mr-2">
              <p className="text-[11px] font-mono uppercase text-[#c4d0df]">
                {operatorName}
              </p>
              <p className="text-[9px] font-mono uppercase tracking-widest text-[#607793]">
                {normalizedRole || "UNKNOWN"} · {officerId}
              </p>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-[#1b324d]/80 bg-[#0d1b2a]/60 hover:bg-[#142a42]/80 text-xs text-[#91a3b9] hover:text-white transition"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <GlassPanel className="p-4 flex items-center gap-3">
            <div className="p-3 rounded-xl border border-[#665522] bg-[#3a2f12]/65 text-[#f0d67a]">
              <Clock3 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-mono font-bold">{counts.pending}</p>
              <p className="text-[9px] font-mono uppercase tracking-widest text-[#6f849f]">
                Pending Review
              </p>
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 flex items-center gap-3">
            <div className="p-3 rounded-xl border border-[#245d3d] bg-[#0f2e1e]/65 text-[#79e0a4]">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-mono font-bold">{counts.opened}</p>
              <p className="text-[9px] font-mono uppercase tracking-widest text-[#6f849f]">
                Opened Cases
              </p>
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 flex items-center gap-3">
            <div className="p-3 rounded-xl border border-[#2b4265] bg-[#172238]/70 text-[#a8b6c9]">
              <Archive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-mono font-bold">{counts.closed}</p>
              <p className="text-[9px] font-mono uppercase tracking-widest text-[#6f849f]">
                Closed Cases
              </p>
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 flex items-center gap-3">
            <div className="p-3 rounded-xl border border-[#6b2929] bg-[#2a1414]/70 text-[#f08080]">
              <X className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-mono font-bold">{counts.denied}</p>
              <p className="text-[9px] font-mono uppercase tracking-widest text-[#6f849f]">
                Denied Cases
              </p>
            </div>
          </GlassPanel>
        </div>

        <div className="flex flex-col lg:flex-row gap-3">
          <GlassPanel className="flex-1 p-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#57708e]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search cases, investigators, divisions, callsigns..."
                className="w-full bg-[#050b12]/85 border border-[#1b324d]/80 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-[#4f6176] outline-none focus:border-[#365574]"
              />
            </div>
          </GlassPanel>

          <GlassPanel className="p-2 flex flex-wrap items-center gap-1">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => handleFilterChange(item.key)}
                className={`px-3.5 py-2 rounded-xl text-[10px] font-mono uppercase tracking-wider transition ${
                  filter === item.key
                    ? "bg-[#d4b25a] text-[#07101b] shadow-[0_0_18px_rgba(212,178,90,0.12)]"
                    : "text-[#8ba0bd] hover:text-white hover:bg-[#142a42]/70"
                }`}
              >
                {item.label}
              </button>
            ))}
          </GlassPanel>

          <button
            type="button"
            onClick={() => {
              setFormError("");
              setIsCreateOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-[#d4b25a]/55 bg-[#d4b25a] hover:bg-[#e2c46c] text-[#07101b] text-xs font-bold uppercase tracking-wider shadow-[0_12px_35px_-18px_rgba(212,178,90,0.9)] transition"
          >
            <FilePlus2 className="h-4 w-4" />
            New Case File
          </button>
        </div>

        <GlassPanel className="overflow-hidden">
          <div className="px-4 py-3 border-b border-[#1b324d]/80 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#d4b25a]">
                SCC // Active Ledger
              </p>
              <h2 className="text-sm font-semibold uppercase tracking-wider mt-1">
                Case File Registry
              </h2>
            </div>

            <div className="text-[9px] font-mono uppercase tracking-widest text-[#617895]">
              {filteredCases.length} {filteredCases.length === 1 ? "case" : "cases"}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px]">
              <thead className="bg-[#0a1726]/70">
                <tr className="text-[9px] font-mono uppercase tracking-[0.18em] text-[#7186a0]">
                  <th className="px-4 py-3 text-left">Case ID</th>
                  <th className="px-4 py-3 text-left">Case Name</th>
                  <th className="px-4 py-3 text-left">Division</th>
                  <th className="px-4 py-3 text-left">Lead Investigator</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#14283f]">
                {filteredCases.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState />
                    </td>
                  </tr>
                ) : (
                  filteredCases.map((caseData) => (
                    <tr
                      key={caseData.id || caseData.case_id}
                      className="hover:bg-[#10233a]/38 transition"
                    >
                      <td className="px-4 py-3 text-xs font-mono text-[#d4b25a] whitespace-nowrap">
                        <ScrambleText
                          value={caseData.case_id}
                          nonce={shuffleNonce}
                        />
                      </td>

                      <td className="px-4 py-3 text-sm text-[#dbe5f0]">
                        <ScrambleText
                          value={caseData.name}
                          nonce={shuffleNonce}
                        />
                      </td>

                      <td className="px-4 py-3 text-xs text-[#91a3b9]">
                        <ScrambleText
                          value={caseData.division}
                          nonce={shuffleNonce}
                        />
                      </td>

                      <td className="px-4 py-3 text-xs text-[#aebccc]">
                        <ScrambleText
                          value={caseData.lead_investigator}
                          nonce={shuffleNonce}
                        />
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge status={caseData.status} />
                      </td>

                      <td className="px-4 py-3 text-xs text-[#7589a3] whitespace-nowrap">
                        <ScrambleText
                          value={formatDate(caseData.updated_at)}
                          nonce={shuffleNonce}
                        />
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="View case"
                            onClick={() => openCaseDetail(caseData)}
                            className="p-2 rounded-xl text-[#8ba0bd] hover:text-white hover:bg-[#142a42]/80"
                          >
                            <Eye className="h-4 w-4" />
                          </button>

                          <button
                            type="button"
                            title="Edit case"
                            onClick={() => openEditCase(caseData)}
                            className="p-2 rounded-xl text-[#8ba0bd] hover:text-white hover:bg-[#142a42]/80"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>

                          <button
                            type="button"
                            title="Request help"
                            onClick={() => openHelpChat(caseData)}
                            className="p-2 rounded-xl text-[#8ba0bd] hover:text-[#d4b25a] hover:bg-[#2d2510]/70"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </button>

                          {isUserAdmin &&
                            String(caseData.status).toLowerCase() === "pending" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openCaseDetail(caseData)
                                  }
                                  className="px-2.5 py-1.5 rounded-xl border border-[#245d3d] bg-[#0f2e1e]/60 text-[#79e0a4] text-[9px] font-mono uppercase"
                                >
                                  Review
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    openDenyDialog(caseData)
                                  }
                                  className="px-2.5 py-1.5 rounded-xl border border-[#6b2929] bg-[#2a1414]/60 text-[#f08080] text-[9px] font-mono uppercase"
                                >
                                  Deny
                                </button>
                              </>
                            )}

                          {isUserAdmin && (
                            <button
                              type="button"
                              title="Delete case"
                              onClick={() =>
                                handleDeleteCase(caseData)
                              }
                              className="p-2 rounded-xl text-[#8ba0bd] hover:text-[#f08080] hover:bg-[#2a1414]/70"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      </main>

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <GlassPanel className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-[#081321]/92">
            <div className="sticky top-0 z-10 px-5 py-4 border-b border-[#1b324d]/80 bg-[#081321]/95 backdrop-blur-xl flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#d4b25a]">
                  SCC // Case Management
                </p>
                <h2 className="text-xl font-bold uppercase tracking-wider mt-1">
                  New Investigation Request
                </h2>
              </div>

              <button
                type="button"
                onClick={closeCreateModal}
                className="p-2 rounded-xl text-[#7186a0] hover:text-white hover:bg-[#142a42]/80"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCase}>
              <div className="p-5 space-y-4">
                {formError && (
                  <div className="flex items-start gap-3 rounded-xl border border-[#6b2929] bg-[#2a1414]/80 px-4 py-3">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-[#f08080]" />
                    <p className="text-xs text-[#f4a6a6]">
                      {formError}
                    </p>
                  </div>
                )}

                <div>
                  <FieldLabel>Case Name</FieldLabel>
                  <input
                    value={caseName}
                    onChange={(event) =>
                      setCaseName(event.target.value)
                    }
                    className={INPUT_CLASS}
                    placeholder="Operation name or case title"
                    autoFocus
                  />
                </div>

                <div>
                  <FieldLabel>Lead Investigator</FieldLabel>
                  <input
                    value={leadInvestigator}
                    onChange={(event) =>
                      setLeadInvestigator(event.target.value)
                    }
                    className={INPUT_CLASS}
                    placeholder="Lead investigator"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Division Involved</FieldLabel>
                    <select
                      value={division}
                      onChange={(event) =>
                        setDivision(event.target.value)
                      }
                      className={INPUT_CLASS}
                    >
                      {DIVISIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <FieldLabel>Priority</FieldLabel>
                    <select
                      value={priority}
                      onChange={(event) =>
                        setPriority(event.target.value)
                      }
                      className={INPUT_CLASS}
                    >
                      {PRIORITIES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <FieldLabel>Basis for Investigation</FieldLabel>
                  <textarea
                    value={requestBasis}
                    onChange={(event) => {
                      setRequestBasis(event.target.value);
                      setSynopsis(event.target.value);
                    }}
                    className={`${INPUT_CLASS} min-h-[110px] resize-y`}
                    placeholder="Explain why this matter should become a formal SCC investigation..."
                  />
                </div>

                <div>
                  <FieldLabel>Known Information</FieldLabel>
                  <textarea
                    value={knownInformation}
                    onChange={(event) =>
                      setKnownInformation(event.target.value)
                    }
                    className={`${INPUT_CLASS} min-h-[90px] resize-y`}
                    placeholder="Known persons, vehicles, links between incidents, or other confirmed information..."
                  />
                </div>

                <div>
                  <FieldLabel>Investigation Objective</FieldLabel>
                  <textarea
                    value={investigationObjective}
                    onChange={(event) =>
                      setInvestigationObjective(event.target.value)
                    }
                    className={`${INPUT_CLASS} min-h-[80px] resize-y`}
                    placeholder="What should this investigation establish or progress?"
                  />
                </div>

                <GlassPanel className="p-4 bg-[#10233a]/45">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-widest text-[#d4b25a]">
                        Initial Evidence / Supporting Material
                      </p>
                      <p className="mt-1 text-xs text-[#7186a0]">
                        Add material Command should consider before authorising the investigation.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addSupportingMaterial}
                      className="px-3 py-2 rounded-xl border border-[#2b4265] bg-[#142a42]/70 text-[10px] font-mono uppercase tracking-wider text-[#c6d2e1] hover:text-white"
                    >
                      + Add Item
                    </button>
                  </div>

                  {supportingMaterial.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {supportingMaterial.map((item, index) => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-[#1b324d]/80 bg-[#07111d]/70 p-3"
                        >
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <p className="text-[10px] font-mono uppercase tracking-wider text-[#8ba0bd]">
                              Supporting Item {String(index + 1).padStart(2, "0")}
                            </p>
                            <button
                              type="button"
                              onClick={() => removeSupportingMaterial(item.id)}
                              className="p-1.5 rounded-lg text-[#7186a0] hover:text-[#f08080] hover:bg-[#2a1414]/60"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <select
                              value={item.type}
                              onChange={(event) =>
                                updateSupportingMaterial(
                                  item.id,
                                  "type",
                                  event.target.value
                                )
                              }
                              className={INPUT_CLASS}
                            >
                              <option>Screenshot / Image</option>
                              <option>Video / Clip</option>
                              <option>Document</option>
                              <option>Written Information</option>
                              <option>Other</option>
                            </select>

                            {item.type === "Written Information" ? (
                              <div className="rounded-xl border border-[#1b324d]/80 bg-[#0b1828]/65 px-3 py-2 text-xs text-[#7186a0]">
                                Written information does not require a file.
                              </div>
                            ) : (
                              <input
                                type="file"
                                accept={item.type === "Screenshot / Image" ? "image/*" : item.type === "Video / Clip" ? "video/*" : item.type === "Document" ? ".pdf,.doc,.docx,.txt,.rtf" : undefined}
                                onChange={(event) => updateSupportingMaterial(item.id, "file", event.target.files?.[0] || null)}
                                className={`${INPUT_CLASS} file:mr-3 file:rounded-lg file:border-0 file:bg-[#d4b25a] file:px-3 file:py-1 file:text-[#07101b]`}
                              />
                            )}
                          </div>

                          <textarea
                            value={item.description}
                            onChange={(event) =>
                              updateSupportingMaterial(
                                item.id,
                                "description",
                                event.target.value
                              )
                            }
                            className={`${INPUT_CLASS} min-h-[76px] resize-y mt-3`}
                            placeholder="Describe what this material shows or why it supports the request..."
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </GlassPanel>

                <GlassPanel className="p-3 bg-[#10233a]/45">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-[#7186a0]">
                    Session Audit
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs text-[#a9b8ca]">
                    <p>
                      Account:{" "}
                      <span className="text-white">
                        {operatorName}
                      </span>
                    </p>
                    <p>
                      Officer ID / Callsign:{" "}
                      <span className="text-white">
                        {officerId}
                      </span>
                    </p>
                  </div>
                </GlassPanel>
              </div>

              <div className="px-5 py-4 border-t border-[#1b324d]/80 bg-[#07111d]/85 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="px-4 py-2.5 rounded-xl border border-[#1b324d]/80 bg-[#0d1b2a]/70 text-xs font-bold uppercase tracking-wider text-[#9aabc0] hover:text-white"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl border border-[#d4b25a]/55 bg-[#d4b25a] text-[#07101b] text-xs font-bold uppercase tracking-wider hover:bg-[#e2c46c]"
                >
                  Submit for Review
                </button>
              </div>
            </form>
          </GlassPanel>
        </div>
      )}

      {isDetailOpen && selectedCase && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
          <GlassPanel className="w-full max-w-3xl max-h-[88vh] overflow-y-auto bg-[#0b1d31]/96 border-[#2b4a6b]/90">
            <div className="sticky top-0 z-20 px-5 md:px-6 py-4 bg-[#0d2238]/95 backdrop-blur-xl border-b border-[#294766]/80">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0">
                  <p className="font-mono text-sm md:text-base tracking-[0.08em] text-[#d4b25a]">
                    {selectedCase.case_id}
                  </p>

                  <h2 className="mt-2 text-2xl md:text-3xl font-bold uppercase tracking-wide text-[#f4d56a] break-words">
                    {selectedCase.name}
                  </h2>
                </div>

                <div className="flex items-start gap-3">
                  <div className="hidden sm:flex flex-col items-end gap-2">
                    <StatusBadge status={selectedCase.status} />

                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#2b4265] bg-[#172238]/85 text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-[#a8b6c9]">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {selectedCase.priority || "routine"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={closeCaseDetail}
                    className="p-2 rounded-xl text-[#8da0b8] hover:text-white hover:bg-[#142a42]/80"
                    title="Close case file"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>
              </div>

              <div className="sm:hidden mt-4 flex flex-wrap gap-2">
                <StatusBadge status={selectedCase.status} />
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#2b4265] bg-[#172238]/85 text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-[#a8b6c9]">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {selectedCase.priority || "routine"}
                </span>
              </div>
            </div>

            <div className="px-5 md:px-6 py-5">
              <div className="divide-y divide-[#1b324d]/80">
                <div className="grid grid-cols-[36px_1fr] gap-4 py-5 first:pt-0">
                  <div className="text-[#d4b25a] pt-0.5">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#8196b2]">
                      Division Involved
                    </p>
                    <p className="mt-2 text-lg text-[#e4ebf4]">
                      {selectedCase.division || "—"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-[36px_1fr] gap-4 py-5">
                  <div className="text-[#d4b25a] pt-0.5">
                    <Radio className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#8196b2]">
                      Lead Investigator
                    </p>
                    <p className="mt-2 text-lg text-[#e4ebf4]">
                      {selectedCase.lead_investigator || "—"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-[36px_1fr] gap-4 py-5">
                  <div className="text-[#d4b25a] pt-0.5">
                    <FolderOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#8196b2]">
                      Logged By
                    </p>
                    <p className="mt-2 text-lg text-[#e4ebf4]">
                      {selectedCase.created_by || "—"}
                    </p>
                    {selectedCase.officer_id && (
                      <p className="mt-1 text-xs font-mono uppercase tracking-wider text-[#607793]">
                        {selectedCase.officer_id}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-[36px_1fr] gap-4 py-5">
                  <div className="text-[#d4b25a] pt-0.5">
                    <Clock3 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#8196b2]">
                      Date Logged
                    </p>
                    <p className="mt-2 text-lg text-[#e4ebf4]">
                      {formatDate(selectedCase.created_at)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-[36px_1fr] gap-4 py-5">
                  <div className="text-[#d4b25a] pt-0.5">
                    <History className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#8196b2]">
                      Last Updated
                    </p>
                    <p className="mt-2 text-lg text-[#e4ebf4]">
                      {formatDate(
                        selectedCase.updated_at ||
                        selectedCase.created_at
                      )}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-[36px_1fr] gap-4 py-5">
                  <div className="text-[#d4b25a] pt-0.5">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#8196b2]">
                      {String(selectedCase.status || "").toLowerCase() === "pending"
                        ? "Basis for Investigation"
                        : "Authorised Investigation Summary"}
                    </p>
                    <p className="mt-2 text-base leading-relaxed text-[#d8e1ec] whitespace-pre-wrap">
                      {String(selectedCase.status || "").toLowerCase() === "pending"
                        ? selectedCase.request_basis || selectedCase.synopsis || "No basis supplied."
                        : selectedCase.case_file?.professional_summary ||
                          selectedCase.request_basis ||
                          selectedCase.synopsis ||
                          "No summary supplied."}
                    </p>
                  </div>
                </div>

                {selectedCase.known_information && (
                  <div className="grid grid-cols-[36px_1fr] gap-4 py-5">
                    <div className="text-[#d4b25a] pt-0.5">
                      <Search className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#8196b2]">
                        Known Information
                      </p>
                      <p className="mt-2 text-base leading-relaxed text-[#d8e1ec] whitespace-pre-wrap">
                        {selectedCase.known_information}
                      </p>
                    </div>
                  </div>
                )}

                {selectedCase.investigation_objective && (
                  <div className="grid grid-cols-[36px_1fr] gap-4 py-5">
                    <div className="text-[#d4b25a] pt-0.5">
                      <Radio className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#8196b2]">
                        Investigation Objective
                      </p>
                      <p className="mt-2 text-base leading-relaxed text-[#d8e1ec] whitespace-pre-wrap">
                        {selectedCase.investigation_objective}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {String(selectedCase.status || "").toLowerCase() === "pending" && (
                <div className="mt-6 rounded-xl border border-[#665522] bg-[#2d2510]/65 px-5 py-4 flex items-center gap-3">
                  <Shield className="h-5 w-5 shrink-0 text-[#d4b25a]" />
                  <p className="text-sm text-[#ead58a]">
                    Awaiting administrator approval.
                  </p>
                </div>
              )}

              {String(selectedCase.status || "").toLowerCase() === "denied" && (
                <div className="mt-6 rounded-xl border border-[#6b2929] bg-[#2a1414]/70 px-5 py-4">
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#f08080]">
                    Case Denied
                  </p>
                  <p className="mt-2 text-sm text-[#e9b0b0]">
                    {selectedCase.denial_reason || "No denial reason recorded."}
                  </p>
                </div>
              )}

              {Array.isArray(selectedCase.supporting_material) &&
                selectedCase.supporting_material.length > 0 && (
                  <div className="mt-7 rounded-xl border border-[#1b324d]/80 bg-[#0b1828]/65 p-4">
                    <div className="flex items-center gap-3">
                      <FolderOpen className="h-5 w-5 text-[#d4b25a]" />
                      <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#e7edf6]">
                        Initial Evidence / Supporting Material
                      </h3>
                    </div>
                    <div className="mt-4 space-y-3">
                      {selectedCase.supporting_material.map((item, index) => (
                        <div
                          key={item.id || `${item.type}-${index}`}
                          className="rounded-xl border border-[#1b324d]/80 bg-[#07111d]/70 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[10px] font-mono uppercase tracking-wider text-[#d4b25a]">
                              ITEM {String(index + 1).padStart(2, "0")} · {item.type || "Other"}
                            </p>
                            {item.reference_url && (
                              <a
                                href={item.reference_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] font-mono uppercase tracking-wider text-[#8ba0bd] hover:text-white"
                              >
                                View Material
                              </a>
                            )}
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-[#d8e1ec] whitespace-pre-wrap">
                            {item.description || "No description supplied."}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {isUserAdmin &&
                String(selectedCase.status || "").toLowerCase() === "pending" && (
                  <div className="mt-7 rounded-xl border border-[#665522] bg-[#2d2510]/35 p-5">
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#d4b25a]">
                      Command Review
                    </p>
                    <h3 className="mt-2 text-lg font-bold uppercase tracking-wide text-[#e7edf6]">
                      Is there anything else you want to change?
                    </h3>
                    <p className="mt-2 text-xs leading-relaxed text-[#8ba0bd]">
                      Choose No to authorise the request exactly as submitted, or Yes to adjust the case classification/details before approval.
                    </p>

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCommandChangeMode("no");
                          setReviewActionError("");
                        }}
                        className={`px-4 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider ${
                          commandChangeMode === "no"
                            ? "border-[#d4b25a]/70 bg-[#d4b25a] text-[#07101b]"
                            : "border-[#2b4265] bg-[#10233a]/70 text-[#9aabc0]"
                        }`}
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCommandChangeMode("yes");
                          setReviewActionError("");
                        }}
                        className={`px-4 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider ${
                          commandChangeMode === "yes"
                            ? "border-[#d4b25a]/70 bg-[#d4b25a] text-[#07101b]"
                            : "border-[#2b4265] bg-[#10233a]/70 text-[#9aabc0]"
                        }`}
                      >
                        Yes
                      </button>
                    </div>

                    {commandChangeMode === "yes" && (
                      <div className="mt-5 space-y-4 border-t border-[#665522]/60 pt-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <FieldLabel>Case Name</FieldLabel>
                            <input
                              value={reviewName}
                              onChange={(event) => setReviewName(event.target.value)}
                              className={INPUT_CLASS}
                            />
                          </div>
                          <div>
                            <FieldLabel>Lead Investigator</FieldLabel>
                            <input
                              value={reviewLead}
                              onChange={(event) => setReviewLead(event.target.value)}
                              className={INPUT_CLASS}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <FieldLabel>Division</FieldLabel>
                            <select
                              value={reviewDivision}
                              onChange={(event) => setReviewDivision(event.target.value)}
                              className={INPUT_CLASS}
                            >
                              {DIVISIONS.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <FieldLabel>Authorised Priority</FieldLabel>
                            <select
                              value={reviewPriority}
                              onChange={(event) => setReviewPriority(event.target.value)}
                              className={INPUT_CLASS}
                            >
                              {PRIORITIES.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-[10px] font-mono uppercase tracking-wider text-[#7186a0]">
                              Requested: {selectedCase.request_original?.priority || selectedCase.requested_priority || selectedCase.priority}
                            </p>
                          </div>
                        </div>

                        <div>
                          <FieldLabel>Basis for Investigation</FieldLabel>
                          <textarea
                            value={reviewBasis}
                            onChange={(event) => setReviewBasis(event.target.value)}
                            className={`${INPUT_CLASS} min-h-[100px] resize-y`}
                          />
                        </div>

                        <div>
                          <FieldLabel>Known Information</FieldLabel>
                          <textarea
                            value={reviewKnownInformation}
                            onChange={(event) => setReviewKnownInformation(event.target.value)}
                            className={`${INPUT_CLASS} min-h-[80px] resize-y`}
                          />
                        </div>

                        <div>
                          <FieldLabel>Investigation Objective</FieldLabel>
                          <textarea
                            value={reviewObjective}
                            onChange={(event) => setReviewObjective(event.target.value)}
                            className={`${INPUT_CLASS} min-h-[80px] resize-y`}
                          />
                        </div>
                      </div>
                    )}

                    {reviewActionError && (
                      <div className="mt-4 rounded-xl border border-[#6b2929] bg-[#2a1414]/70 px-4 py-3 text-xs text-[#f4a6a6]">
                        {reviewActionError}
                      </div>
                    )}

                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openDenyDialog(selectedCase)}
                        disabled={reviewSubmitting}
                        className="px-4 py-2.5 rounded-xl border border-[#6b2929] bg-[#2a1414]/60 text-[#f08080] text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                      >
                        Deny
                      </button>
                      <button
                        type="button"
                        onClick={handleApproveFromReview}
                        disabled={reviewSubmitting}
                        className="px-5 py-2.5 rounded-xl border border-[#245d3d] bg-[#0f2e1e]/80 text-[#79e0a4] text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                      >
                        {reviewSubmitting ? "Approving..." : "Approve Investigation"}
                      </button>
                    </div>
                  </div>
                )}

              {(["opened", "closed"].includes(String(selectedCase.status || "").toLowerCase()) || selectedCase.workspace_unlocked) && (
                <div className="mt-7 rounded-xl border border-[#1b324d]/80 bg-[#0b1828]/65 p-4">
                  <div className="flex flex-wrap gap-2 border-b border-[#1b324d]/80 pb-3">
                    {["overview","log","evidence","personnel","activity","requests", ...(isUserAdmin ? ["command"] : [])].map((tab) => (
                      <button key={tab} type="button" onClick={() => { setWorkspaceTab(tab); setWorkspaceError(""); }} className={`px-3 py-2 rounded-lg text-[10px] font-mono uppercase tracking-wider border ${workspaceTab === tab ? "border-[#d4b25a]/70 bg-[#d4b25a] text-[#07101b]" : "border-[#2b4265] bg-[#10233a]/60 text-[#9aabc0]"}`}>{tab}</button>
                    ))}
                  </div>
                  {workspaceError && <div className="mt-3 rounded-lg border border-[#6b2929] bg-[#2a1414]/60 p-3 text-xs text-[#f4a6a6]">{workspaceError}</div>}

                  {workspaceTab === "overview" && <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm text-[#cbd6e4]">
                    <div className="rounded-xl border border-[#1b324d] p-3"><span className="text-[#7186a0]">Lead Investigator</span><p className="mt-1 text-white">{selectedCase.lead_investigator}</p></div>
                    <div className="rounded-xl border border-[#1b324d] p-3"><span className="text-[#7186a0]">Authorised Priority</span><p className="mt-1 text-white uppercase">{selectedCase.priority}</p></div>
                    <div className="md:col-span-2 rounded-xl border border-[#1b324d] p-3"><span className="text-[#7186a0]">Investigation Objective</span><p className="mt-1 whitespace-pre-wrap">{selectedCase.investigation_objective || "—"}</p></div>
                  </div>}

                  {workspaceTab === "log" && <div className="mt-4 space-y-4">
                    <div className="grid md:grid-cols-2 gap-3">
                      <textarea value={logAction} onChange={(e)=>setLogAction(e.target.value)} className={`${INPUT_CLASS} min-h-[90px]`} placeholder="Action taken *" />
                      <textarea value={logInformation} onChange={(e)=>setLogInformation(e.target.value)} className={`${INPUT_CLASS} min-h-[90px]`} placeholder="Information / evidence obtained" />
                      <textarea value={logOutcome} onChange={(e)=>setLogOutcome(e.target.value)} className={`${INPUT_CLASS} min-h-[80px]`} placeholder="Outcome / further action" />
                      <textarea value={logRelated} onChange={(e)=>setLogRelated(e.target.value)} className={`${INPUT_CLASS} min-h-[80px]`} placeholder="Related records" />
                    </div>
                    <button disabled={workspaceBusy} onClick={addInvestigationEntry} className="px-4 py-2 rounded-xl bg-[#d4b25a] text-[#07101b] text-xs font-bold uppercase">Log Investigation Entry</button>
                    <div className="space-y-3">{(selectedCase.investigation_log || []).slice().reverse().map((entry,index)=><div key={entry.id || index} className="rounded-xl border border-[#1b324d] bg-[#07111d]/70 p-3"><p className="text-[10px] font-mono text-[#d4b25a]">ENTRY {String((selectedCase.investigation_log || []).length-index).padStart(3,"0")} · {formatDate(entry.date_time)} · {entry.officer}</p><p className="mt-2 text-sm text-white">{entry.action_taken}</p>{entry.information_obtained && <p className="mt-2 text-xs text-[#a9b8ca]">Information/Evidence: {entry.information_obtained}</p>}{entry.outcome_further_action && <p className="mt-1 text-xs text-[#a9b8ca]">Outcome/Further Action: {entry.outcome_further_action}</p>}{entry.related_records && <p className="mt-1 text-xs text-[#7186a0]">Related: {entry.related_records}</p>}</div>)}</div>
                  </div>}

                  {workspaceTab === "evidence" && <div className="mt-4 space-y-4">
                    <div className="grid md:grid-cols-2 gap-3"><select value={evidenceType} onChange={(e)=>setEvidenceType(e.target.value)} className={INPUT_CLASS}><option>Screenshot / Image</option><option>Video / Clip</option><option>Document</option><option>Written Information</option><option>Other</option></select>{evidenceType !== "Written Information" && <input type="file" onChange={(e)=>setEvidenceFile(e.target.files?.[0] || null)} className={INPUT_CLASS} />}</div>
                    <textarea value={evidenceDescription} onChange={(e)=>setEvidenceDescription(e.target.value)} className={`${INPUT_CLASS} min-h-[80px]`} placeholder="Evidence description" />
                    <button disabled={workspaceBusy} onClick={uploadCaseEvidence} className="px-4 py-2 rounded-xl bg-[#d4b25a] text-[#07101b] text-xs font-bold uppercase">Save Evidence to Case</button>
                    <div className="grid md:grid-cols-2 gap-3">{(selectedCase.evidence || []).filter((x)=>!x.removed).map((item)=><div key={item.evidence_id} className="rounded-xl border border-[#1b324d] bg-[#07111d]/70 p-3"><p className="text-[10px] font-mono text-[#d4b25a]">{item.evidence_id} · {item.type}</p><p className="mt-2 text-sm text-white">{item.description || item.filename || "Evidence item"}</p><p className="mt-1 text-[10px] text-[#7186a0]">{item.filename || "Written information"} · {item.uploaded_by || item.submitted_by || "Unknown"} · {formatDate(item.uploaded_at || item.submitted_at)}</p>{item.file_id && <button onClick={()=>openEvidenceFile(item)} className="mt-3 text-[10px] font-mono uppercase text-[#8ba0bd] hover:text-white">Open / Preview File</button>}{isUserAdmin && <button onClick={()=>removeEvidence(item)} className="mt-3 ml-4 text-[10px] font-mono uppercase text-[#f08080]">Remove with reason</button>}</div>)}</div>
                  </div>}

                  {workspaceTab === "personnel" && <div className="mt-4 space-y-3"><p className="text-xs text-[#7186a0]">Lead: <span className="text-white">{selectedCase.lead_investigator}</span></p>{(selectedCase.assigned_investigators || []).map((name)=><div key={name} className="rounded-lg border border-[#1b324d] px-3 py-2 text-sm text-[#d8e1ec]">{name}</div>)}{isUserAdmin && <div className="flex gap-2"><input value={personnelName} onChange={(e)=>setPersonnelName(e.target.value)} className={INPUT_CLASS} placeholder="Investigator / callsign"/><button onClick={assignInvestigator} className="px-4 rounded-xl bg-[#d4b25a] text-[#07101b] text-xs font-bold uppercase">Assign</button></div>}</div>}

                  {workspaceTab === "activity" && <div className="mt-4 space-y-2">{(selectedCase.activity_log || []).slice().reverse().map((item)=><div key={item.id} className="rounded-lg border border-[#1b324d] px-3 py-2"><p className="text-[10px] font-mono text-[#8ba0bd]">{formatDate(item.created_at)} · {item.actor}</p><p className="mt-1 text-xs text-white">{item.action}</p>{item.detail && <p className="text-xs text-[#7186a0]">{item.detail}</p>}</div>)}</div>}

                  {workspaceTab === "requests" && <div className="mt-4 space-y-4">
                    {!isUserAdmin && <div className="grid md:grid-cols-3 gap-2"><select value={commandRequestType} onChange={(e)=>setCommandRequestType(e.target.value)} className={INPUT_CLASS}><option value="priority_change">Priority Change</option><option value="additional_investigator">Additional Investigator</option><option value="general_command">Command Assistance</option></select><input value={commandRequestValue} onChange={(e)=>setCommandRequestValue(e.target.value)} className={INPUT_CLASS} placeholder="Requested value / investigator"/><input value={commandRequestDetails} onChange={(e)=>setCommandRequestDetails(e.target.value)} className={INPUT_CLASS} placeholder="Reason / details"/><button onClick={submitCommandRequest} className="px-4 py-2 rounded-xl bg-[#d4b25a] text-[#07101b] text-xs font-bold uppercase">Submit to Command</button></div>}
                    {(selectedCase.command_requests || []).slice().reverse().map((req)=><div key={req.id} className="rounded-xl border border-[#1b324d] p-3"><p className="text-[10px] font-mono text-[#d4b25a]">{req.request_type?.replaceAll("_"," ")} · {req.status}</p><p className="mt-1 text-sm text-white">{req.requested_value || req.details || "Command request"}</p>{isUserAdmin && req.status === "pending" && <div className="mt-2 flex gap-2"><button onClick={()=>decideCommandRequest(req.id,"approved")} className="text-xs text-[#79e0a4]">Approve</button><button onClick={()=>decideCommandRequest(req.id,"returned")} className="text-xs text-[#d4b25a]">Return</button><button onClick={()=>decideCommandRequest(req.id,"denied")} className="text-xs text-[#f08080]">Deny</button></div>}</div>)}
                    {String(selectedCase.status).toLowerCase() === "opened" && !isUserAdmin && <div className="border-t border-[#1b324d] pt-4"><textarea value={closureSummary} onChange={(e)=>setClosureSummary(e.target.value)} className={`${INPUT_CLASS} min-h-[80px]`} placeholder="Closure outcome summary"/><button onClick={requestCaseClosure} className="mt-2 px-4 py-2 rounded-xl border border-[#2b4265] text-xs font-bold uppercase text-white">Request Case Closure</button></div>}
                    {selectedCase.closure_request && <div className="rounded-xl border border-[#665522] bg-[#2d2510]/30 p-3"><p className="text-[10px] font-mono text-[#d4b25a]">Closure Request · {selectedCase.closure_request.status}</p><p className="mt-2 text-sm text-white">{selectedCase.closure_request.outcome_summary}</p>{isUserAdmin && selectedCase.closure_request.status === "pending" && <div className="mt-2 flex gap-3"><button onClick={()=>decideClosure("approve")} className="text-xs text-[#79e0a4]">Approve Closure</button><button onClick={()=>decideClosure("return")} className="text-xs text-[#d4b25a]">Return to Investigator</button></div>}</div>}
                  </div>}

                  {workspaceTab === "command" && isUserAdmin && <div className="mt-4 space-y-4"><div><p className="text-[10px] font-mono uppercase text-[#d4b25a]">Command Flags</p><div className="mt-2 flex flex-wrap gap-2">{["Command Attention","Restricted","Urgent Review"].map((flag)=><button key={flag} onClick={()=>toggleCommandFlag(flag)} className={`px-3 py-2 rounded-lg border text-[10px] uppercase ${selectedCase.command_flags?.includes(flag) ? "border-[#d4b25a] text-[#d4b25a]" : "border-[#2b4265] text-[#8ba0bd]"}`}>{flag}</button>)}</div></div><div><p className="text-[10px] font-mono uppercase text-[#d4b25a]">Private Command Notes</p><textarea value={commandNote} onChange={(e)=>setCommandNote(e.target.value)} className={`${INPUT_CLASS} mt-2 min-h-[80px]`} placeholder="Visible to Command only"/><button onClick={addCommandNote} className="mt-2 px-4 py-2 rounded-xl bg-[#d4b25a] text-[#07101b] text-xs font-bold uppercase">Add Command Note</button><div className="mt-3 space-y-2">{(selectedCase.command_notes || []).slice().reverse().map((note)=><div key={note.id} className="rounded-lg border border-[#665522]/50 p-3"><p className="text-xs text-white">{note.note}</p><p className="mt-1 text-[10px] text-[#7186a0]">{note.author} · {formatDate(note.created_at)}</p></div>)}</div></div></div>}
                </div>
              )}

              <div className="mt-8 pt-7 border-t border-[#1b324d]/80">
                <div className="flex items-center gap-3">
                  <History className="h-5 w-5 text-[#d4b25a]" />
                  <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#e7edf6]">
                    Case Timeline
                  </h3>
                </div>

                <form
                  onSubmit={handleAddCaseNote}
                  className="mt-5 flex flex-col sm:flex-row gap-3"
                >
                  <input
                    type="text"
                    value={caseNote}
                    onChange={(event) => {
                      setCaseNote(event.target.value);
                      if (caseNoteError) {
                        setCaseNoteError("");
                      }
                    }}
                    placeholder="Add a dated update note..."
                    className={`${INPUT_CLASS} flex-1`}
                  />

                  <button
                    type="submit"
                    disabled={!caseNote.trim() || isSavingCaseNote}
                    className="sm:w-auto px-5 py-3 rounded-xl border border-[#8a7638] bg-[#81734d] text-[#06101a] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#9b895a] transition inline-flex items-center justify-center gap-2"
                  >
                    <Send className="h-4 w-4" />
                    {isSavingCaseNote ? "Saving" : "Log"}
                  </button>
                </form>

                {caseNoteError && (
                  <p className="mt-2 text-xs text-[#f08080]">
                    {caseNoteError}
                  </p>
                )}

                <div className="mt-6 space-y-0">
                  {Array.isArray(selectedCase.notes) &&
                  selectedCase.notes.length > 0 ? (
                    [...selectedCase.notes]
                      .sort(
                        (a, b) =>
                          new Date(b?.created_at || 0).getTime() -
                          new Date(a?.created_at || 0).getTime()
                      )
                      .map((note, index) => (
                        <div
                          key={
                            note?.id ||
                            `${note?.created_at || "note"}-${index}`
                          }
                          className="relative pl-9 pb-6 last:pb-0"
                        >
                          {index < selectedCase.notes.length - 1 && (
                            <div className="absolute left-[7px] top-4 bottom-0 w-px bg-[#244766]" />
                          )}

                          <div className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border border-[#e2c46c]/40 bg-[#d4b25a]" />

                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#7186a0]">
                            <span>
                              {formatDate(note?.created_at)}
                            </span>
                            <span>·</span>
                            <span>
                              {String(note?.author || "System").toUpperCase()}
                            </span>
                            {note?.kind && (
                              <>
                                <span>·</span>
                                <span className="text-[#d4b25a]">
                                  {String(note.kind).toUpperCase()}
                                </span>
                              </>
                            )}
                          </div>

                          <p className="mt-2 text-sm leading-relaxed text-[#d8e1ec] whitespace-pre-wrap">
                            {note?.note || ""}
                          </p>
                        </div>
                      ))
                  ) : (
                    <div className="rounded-xl border border-[#1b324d]/80 bg-[#0b1828]/65 px-4 py-5 text-sm text-[#7186a0]">
                      No timeline notes have been logged yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </GlassPanel>
        </div>
      )}

      {isEditOpen && editCase && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <GlassPanel className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-[#081321]/92">
            <div className="sticky top-0 z-10 px-5 py-4 border-b border-[#1b324d]/80 bg-[#081321]/95 backdrop-blur-xl flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#d4b25a]">
                  SCC // Case Management
                </p>
                <h2 className="text-xl font-bold uppercase tracking-wider mt-1">
                  Edit Case File
                </h2>
              </div>

              <button
                type="button"
                onClick={closeEditCase}
                className="p-2 rounded-xl text-[#7186a0] hover:text-white hover:bg-[#142a42]/80"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div className="p-5 space-y-4">
                {editError && (
                  <div className="flex items-start gap-3 rounded-xl border border-[#6b2929] bg-[#2a1414]/80 px-4 py-3">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-[#f08080]" />
                    <p className="text-xs text-[#f4a6a6]">
                      {editError}
                    </p>
                  </div>
                )}

                <div>
                  <FieldLabel>Case Name</FieldLabel>
                  <input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <FieldLabel>Lead Investigator</FieldLabel>
                  <input
                    value={editLeadInvestigator}
                    onChange={(event) =>
                      setEditLeadInvestigator(event.target.value)
                    }
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Division Involved</FieldLabel>
                    <select
                      value={editDivision}
                      onChange={(event) => setEditDivision(event.target.value)}
                      className={INPUT_CLASS}
                    >
                      {DIVISIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <FieldLabel>Priority</FieldLabel>
                    <select
                      value={editPriority}
                      onChange={(event) => setEditPriority(event.target.value)}
                      className={INPUT_CLASS}
                    >
                      {PRIORITIES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <FieldLabel>Discord Case File Link</FieldLabel>
                  <input
                    value={editDiscordLink}
                    onChange={(event) => setEditDiscordLink(event.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <FieldLabel>Synopsis</FieldLabel>
                  <textarea
                    value={editSynopsis}
                    onChange={(event) => setEditSynopsis(event.target.value)}
                    className={`${INPUT_CLASS} min-h-[120px] resize-y`}
                  />
                </div>
              </div>

              <div className="px-5 py-4 border-t border-[#1b324d]/80 bg-[#07111d]/85 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeEditCase}
                  className="px-4 py-2.5 rounded-xl border border-[#1b324d]/80 bg-[#0d1b2a]/70 text-xs font-bold uppercase tracking-wider text-[#9aabc0] hover:text-white"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl border border-[#d4b25a]/55 bg-[#d4b25a] text-[#07101b] text-xs font-bold uppercase tracking-wider hover:bg-[#e2c46c]"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </GlassPanel>
        </div>
      )}

      {isDenyOpen && denyTargetCase && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <GlassPanel className="w-full max-w-lg bg-[#081321]/94 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#1b324d]/80 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#f08080]">
                  SCC // Command Review
                </p>
                <h2 className="text-lg font-bold uppercase tracking-wider mt-1">
                  Enter Denial Specifications
                </h2>
              </div>

              <button
                type="button"
                onClick={closeDenyDialog}
                className="p-2 rounded-xl text-[#7186a0] hover:text-white hover:bg-[#142a42]/80"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitDenial}>
              <div className="p-5 space-y-4">
                <p className="text-xs text-[#8ba0bd]">
                  Denying{" "}
                  <span className="text-[#d4b25a] font-mono">
                    {denyTargetCase.case_id}
                  </span>
                  . The reason will be stored on the case and sent with the Discord denial notification.
                </p>

                {denialError && (
                  <div className="flex items-start gap-3 rounded-xl border border-[#6b2929] bg-[#2a1414]/80 px-4 py-3">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-[#f08080]" />
                    <p className="text-xs text-[#f4a6a6]">
                      {denialError}
                    </p>
                  </div>
                )}

                <textarea
                  value={denialReason}
                  onChange={(event) => setDenialReason(event.target.value)}
                  className={`${INPUT_CLASS} min-h-[130px] resize-y`}
                  placeholder="Enter denial reason..."
                  maxLength={1800}
                  autoFocus
                />
              </div>

              <div className="px-5 py-4 border-t border-[#1b324d]/80 bg-[#07111d]/85 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDenyDialog}
                  className="px-4 py-2.5 rounded-xl border border-[#1b324d]/80 bg-[#0d1b2a]/70 text-xs font-bold uppercase tracking-wider text-[#9aabc0] hover:text-white"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl border border-[#6b2929] bg-[#2a1414] text-[#f08080] text-xs font-bold uppercase tracking-wider hover:bg-[#391919]"
                >
                  Deny Case
                </button>
              </div>
            </form>
          </GlassPanel>
        </div>
      )}

      {!isChatOpen && (
        <div className="fixed right-4 bottom-4 z-[55] flex flex-col items-end gap-2">
          {cases
            .filter((caseData) => Boolean(caseData?.help_session_active))
            .map((caseData) => (
              <button
                key={`support-${caseData.id || caseData.case_id}`}
                type="button"
                onClick={() => openHelpChat(caseData)}
                className="group inline-flex items-center gap-3 rounded-2xl border border-[#d4b25a]/45 bg-[#0d1b2a]/92 backdrop-blur-xl px-4 py-3 shadow-[0_18px_55px_-28px_rgba(0,0,0,0.95)] hover:bg-[#142a42]/95 transition"
                title={`Open Live Support for ${caseData.case_id}`}
              >
                <span className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-[#665522] bg-[#3a2f12]/70 text-[#f0d67a]">
                  <MessageCircle className="h-4 w-4" />
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0d1b2a] bg-[#79e0a4]" />
                </span>
                <span className="text-left">
                  <span className="block text-[9px] font-mono uppercase tracking-[0.18em] text-[#d4b25a]">
                    Live Support
                  </span>
                  <span className="block mt-0.5 text-[10px] font-mono text-[#a7b7c9]">
                    {caseData.case_id}
                  </span>
                </span>
              </button>
            ))}
        </div>
      )}

      {isChatOpen && chatCase && (
        <div className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] pointer-events-none">
          <GlassPanel className="pointer-events-auto absolute right-3 top-3 bottom-3 w-[min(460px,calc(100vw-1.5rem))] bg-[#081321]/94 overflow-hidden flex flex-col">
            {!hasSupportAgentReply && chatSessionActive ? (
              <FullSupportWaiting
                caseId={chatCase.case_id}
                onClose={closeHelpChat}
                onEnd={handleEndWaitingSupport}
                ending={endingSupport}
                countdown={supportEndCountdown}
              />
            ) : (
              <>
            <div className="px-4 py-4 border-b border-[#1b324d]/80 bg-[#0c1b2c]/92 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-[#d4b25a]" />
                  <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-[#d4b25a]">
                    Live Support Chat
                  </p>
                </div>

                <h2 className="mt-1 font-bold">
                  {chatCase.case_id}
                </h2>

                <p className="mt-1 text-[10px] text-[#7186a0]">
                  Case-linked support thread · live sync
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isUserAdmin && chatSessionActive && (
                  <button
                    type="button"
                    onClick={handleEndSupportChat}
                    disabled={endingSupport}
                    className="px-3 py-2 rounded-xl border border-[#6b2929] bg-[#2a1414]/70 text-[9px] font-mono uppercase tracking-wider text-[#f08080] hover:bg-[#391919] disabled:opacity-50"
                  >
                    {supportEndCountdown !== null
                      ? `Ending ${supportEndCountdown}`
                      : endingSupport
                        ? "Ending..."
                        : "End Support"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={closeHelpChat}
                  className="p-2 rounded-xl text-[#7186a0] hover:text-white hover:bg-[#142a42]/80"
                  title="Hide Live Support"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-[#1b324d]/70 bg-[#091522]/75">
              <p className="text-[10px] leading-relaxed text-[#a7b7c9]">
                An officer has requested assistance through the{" "}
                <strong className="text-white">
                  SCC Case Tracker
                </strong>
                .
              </p>

            </div>

            {supportEndCountdown !== null && (
              <div className="mx-4 mt-4 rounded-2xl border border-[#665522] bg-[#3a2f12]/55 px-4 py-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-[#f0d67a]">
                  Command ending Live Support
                </p>
                <p className="mt-2 text-[11px] text-[#c4d0df]">
                  Session closes in
                </p>
                <div className="mt-1 text-4xl font-mono font-bold text-[#d4b25a]">
                  {supportEndCountdown}
                </div>
                <p className="mt-2 text-[10px] text-[#7186a0]">
                  Transcript remains attached to {chatCase.case_id}.
                </p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <MessageCircle className="h-7 w-7 text-[#365574]" />
                  <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-[#607793]">
                    Live support chat ready
                  </p>
                  <p className="mt-1 text-[11px] text-[#536983]">
                    Your messages and support replies will appear here.
                  </p>
                </div>
              ) : (
                chatMessages.map((message) => {
                  const isWebsite =
                    message.source === "website";

                  return (
                    <div
                      key={message.id}
                      className={`flex ${
                        isWebsite
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl border px-3 py-2.5 ${
                          isWebsite
                            ? "bg-[#18304a]/80 border-[#365574]/80"
                            : "bg-[#0b1828]/90 border-[#1b324d]/80"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-mono uppercase tracking-wider text-[#d4b25a]">
                            {message.author}
                          </span>
                          <span className="text-[8px] text-[#536983]">
                            {formatDate(message.timestamp)}
                          </span>
                        </div>

                        <p className="mt-1 text-xs leading-relaxed text-white whitespace-pre-wrap">
                          {message.content}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form
              onSubmit={handleSendChatMessage}
              className="p-3 border-t border-[#1b324d]/80 bg-[#07111d]/90"
            >
              <div className="flex items-end gap-2">
                <textarea
                  value={chatInput}
                  onChange={handleChatInputChange}
                  disabled={supportEndCountdown !== null}
                  placeholder={
                    supportEndCountdown !== null
                      ? "Support session is ending..."
                      : "Type a support message..."
                  }
                  className={`${INPUT_CLASS} min-h-[48px] max-h-[130px] resize-y`}
                />

                <button
                  type="submit"
                  disabled={
                    !chatInput.trim() ||
                    supportEndCountdown !== null
                  }
                  className="h-12 w-12 shrink-0 rounded-xl border border-[#d4b25a]/45 bg-[#d4b25a] text-[#07101b] flex items-center justify-center hover:bg-[#e2c46c] disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
              </>
            )}
          </GlassPanel>
        </div>
      )}
    </div>
  );
}

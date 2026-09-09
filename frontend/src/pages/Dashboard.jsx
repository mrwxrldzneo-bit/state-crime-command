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
  FolderOpen,
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

function readCachedCases() {
  try {
    const raw = localStorage.getItem(CASE_CACHE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Unable to read SCC vault cache:", error);
    return [];
  }
}

function writeCachedCases(nextCases) {
  try {
    localStorage.setItem(
      CASE_CACHE_KEY,
      JSON.stringify(Array.isArray(nextCases) ? nextCases : [])
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
  const map = new Map();

  for (const item of localCases) {
    const key =
      item?.client_request_id ||
      item?.case_id ||
      getCaseKey(item);

    if (key) {
      map.set(key, item);
    }
  }

  for (const remote of remoteCases) {
    const key =
      remote?.client_request_id ||
      remote?.case_id ||
      getCaseKey(remote);

    if (!key) {
      continue;
    }

    const local = map.get(key);

    map.set(key, {
      ...(local || {}),
      ...remote,
      backend_id: remote?.id || remote?.backend_id || local?.backend_id,
      sync_status: "synced",
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    const aTime = new Date(
      a?.created_at || a?.updated_at || 0
    ).getTime();
    const bTime = new Date(
      b?.created_at || b?.updated_at || 0
    ).getTime();

    return bTime - aTime;
  });
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
        "bg-[#0d1b2a]/60",
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
      <div className="font-mono text-sm font-bold tracking-[0.18em] text-[#d4b25a]">
        {timeText}
        <span className="ml-2 text-[9px] font-normal tracking-[0.16em] text-[#7186a0]">
          {zoneText} · SYDNEY
        </span>
      </div>

      <div className="mt-1 text-[8px] font-mono uppercase tracking-[0.28em] text-[#607793]">
        {dateText}
      </div>
    </div>
  );
}


function WaitingForSupport() {
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d4b25a] opacity-50" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#d4b25a]" />
      </span>

      <span className="relative overflow-hidden text-[10px] font-mono uppercase tracking-[0.18em] text-[#9aabc0]">
        <span className="animate-pulse">
          Waiting for support
        </span>
        <span className="ml-0.5 inline-flex w-5">
          <span className="animate-pulse">...</span>
        </span>
      </span>
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

  const [selectedCase, setSelectedCase] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

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

      writeCachedCases(nextCases);
      return nextCases;
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
          },
          45000
        );

        if (!response?.data) {
          return;
        }

        const remoteCase = response.data;

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

    if (!cleanName) {
      setFormError("Case name is required.");
      return;
    }

    if (!cleanLead) {
      setFormError("Lead investigator is required.");
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
      synopsis: synopsis.trim(),
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

  const openCaseDetail = (caseData) => {
    setSelectedCase(caseData);
    setIsDetailOpen(true);
  };

  const closeCaseDetail = () => {
    setIsDetailOpen(false);
    setSelectedCase(null);
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
          message?.author ||
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
          ? payload.messages
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
              author:
                message?.author ||
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

  if (!hasCaseAccess && user) {
    return (
      <div className="min-h-screen bg-[#020813] flex items-center justify-center p-6 text-white">
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
      className="min-h-screen bg-[#020813] text-[#e7edf6] antialiased"
      style={{
        backgroundImage:
          "linear-gradient(rgba(24,47,74,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(24,47,74,0.22) 1px, transparent 1px)",
        backgroundSize: "42px 42px",
      }}
    >
      <header className="sticky top-0 z-40 border-b border-[#1b324d]/80 bg-[#06111f]/82 backdrop-blur-xl">
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
              {filteredCases.length} visible
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
                                    updateCaseStatus(
                                      caseData,
                                      "opened"
                                    )
                                  }
                                  className="px-2.5 py-1.5 rounded-xl border border-[#245d3d] bg-[#0f2e1e]/60 text-[#79e0a4] text-[9px] font-mono uppercase"
                                >
                                  Approve
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
                  New Case File Log
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
                  <FieldLabel>Discord Case File Link</FieldLabel>
                  <input
                    value={discordLink}
                    onChange={(event) =>
                      setDiscordLink(event.target.value)
                    }
                    className={INPUT_CLASS}
                    placeholder="https://discord.com/channels/..."
                  />
                </div>

                <div>
                  <FieldLabel>Synopsis</FieldLabel>
                  <textarea
                    value={synopsis}
                    onChange={(event) =>
                      setSynopsis(event.target.value)
                    }
                    className={`${INPUT_CLASS} min-h-[120px] resize-y`}
                    placeholder="Operational synopsis..."
                  />
                </div>

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
                  Create Case
                </button>
              </div>
            </form>
          </GlassPanel>
        </div>
      )}

      {isDetailOpen && selectedCase && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <GlassPanel className="w-full max-w-3xl bg-[#081321]/94 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#1b324d]/80 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.24em] text-[#d4b25a]">
                  {selectedCase.case_id}
                </p>
                <h2 className="text-xl font-bold mt-1">
                  {selectedCase.name}
                </h2>
              </div>

              <button
                type="button"
                onClick={closeCaseDetail}
                className="p-2 rounded-xl text-[#7186a0] hover:text-white hover:bg-[#142a42]/80"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <GlassPanel className="p-4">
                <p className="text-[9px] font-mono uppercase tracking-widest text-[#7186a0]">
                  Status
                </p>
                <div className="mt-2">
                  <StatusBadge status={selectedCase.status} />
                </div>
              </GlassPanel>

              <GlassPanel className="p-4">
                <p className="text-[9px] font-mono uppercase tracking-widest text-[#7186a0]">
                  Priority
                </p>
                <p className="mt-2 text-sm font-semibold uppercase">
                  {selectedCase.priority}
                </p>
              </GlassPanel>

              <GlassPanel className="p-4">
                <p className="text-[9px] font-mono uppercase tracking-widest text-[#7186a0]">
                  Lead Investigator
                </p>
                <p className="mt-2 text-sm">
                  {selectedCase.lead_investigator}
                </p>
              </GlassPanel>

              <GlassPanel className="p-4">
                <p className="text-[9px] font-mono uppercase tracking-widest text-[#7186a0]">
                  Division
                </p>
                <p className="mt-2 text-sm">
                  {selectedCase.division}
                </p>
              </GlassPanel>

              <GlassPanel className="p-4 md:col-span-2">
                <p className="text-[9px] font-mono uppercase tracking-widest text-[#7186a0]">
                  Synopsis
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#c8d4e2] whitespace-pre-wrap">
                  {selectedCase.synopsis || "No synopsis supplied."}
                </p>
              </GlassPanel>

              <GlassPanel className="p-4">
                <p className="text-[9px] font-mono uppercase tracking-widest text-[#7186a0]">
                  Created By
                </p>
                <p className="mt-2 text-sm">
                  {selectedCase.created_by || "—"}
                </p>
                <p className="mt-1 text-xs text-[#7186a0]">
                  {selectedCase.officer_id || "No callsign recorded"}
                </p>
              </GlassPanel>

              <GlassPanel className="p-4">
                <p className="text-[9px] font-mono uppercase tracking-widest text-[#7186a0]">
                  Created
                </p>
                <p className="mt-2 text-sm">
                  {formatDate(selectedCase.created_at)}
                </p>
                <p className="mt-1 text-xs text-[#7186a0]">
                  Sync: {selectedCase.sync_status || "local"}
                </p>
              </GlassPanel>

              {selectedCase.discord_url && (
                <a
                  href={selectedCase.discord_url}
                  target="_blank"
                  rel="noreferrer"
                  className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-[#665522] bg-[#2d2510]/55 px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#d4b25a] hover:bg-[#2d2510]/80"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Discord Case File
                </a>
              )}
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

              {chatSessionActive && !chatMessages.some(
                (message) => message?.source === "discord"
              ) && (
                <WaitingForSupport />
              )}
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
          </GlassPanel>
        </div>
      )}
    </div>
  );
}

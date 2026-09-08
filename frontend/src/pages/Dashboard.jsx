import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import api, { formatApiError } from "../lib/api";
import {
  LogOut,
  Search,
  FilePlus2,
  Eye,
  Pencil,
  Trash2,
  Clock3,
  FolderOpen,
  Archive,
  Shield,
  X,
  AlertTriangle,
  CheckCircle2,
  MessageCircle,
  Activity,
  User,
  ExternalLink,
  Save,
} from "lucide-react";

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

function playSuccessSound() {
  try {
    const AudioContext =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) {
      return;
    }

    const audioContext = new AudioContext();
    const now = audioContext.currentTime;

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, now);
    oscillator.frequency.setValueAtTime(988, now + 0.09);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.075, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.3);

    oscillator.addEventListener("ended", () => {
      audioContext.close().catch(() => {});
    });
  } catch (error) {
    console.warn("Unable to play confirmation sound:", error);
  }
}

function SydneyClock() {
  const [timeStr, setTimeStr] = useState("");
  const [dateStr, setDateStr] = useState("");

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

  return (
    <div className="text-center font-mono bg-[#09182d]/60 border border-[#142c4d] px-4 py-1.5 rounded-sm">
      <div className="text-xs font-bold tracking-widest text-[#e7edf6] flex items-center justify-center gap-2">
        <span>{timeStr}</span>
        <span className="text-[10px] text-[#4f6785] font-normal uppercase">
          AEST
        </span>
        <span className="text-[#1c3557]">•</span>
        <span className="text-[10px] text-[#8ba0bd] font-normal">
          {dateStr}
        </span>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="bg-[#071326]/60 border border-[#142c4d] rounded-sm p-4 flex items-center justify-between relative">
      <div className="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l border-[#4f6785]" />

      <div className="flex items-center gap-3">
        <div className={`p-3 rounded border ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>

        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd]">
            {label}
          </p>

          <p className="text-2xl font-bold font-mono text-[#e7edf6] mt-0.5">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({ message }) {
  if (!message) {
    return null;
  }

  return (
    <div className="flex items-start gap-3 bg-[#2a1414] border border-[#6b2929] rounded-sm p-3">
      <AlertTriangle className="h-4 w-4 text-[#f08080] mt-0.5 shrink-0" />

      <p className="text-xs font-mono text-[#f4a6a6]">
        {message}
      </p>
    </div>
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

export default function Dashboard() {
  const { user, logout } = useAuth();

  const [cases, setCases] = useState([]);

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const [selectedCase, setSelectedCase] = useState(null);

  const [caseName, setCaseName] = useState("");
  const [leadInvestigator, setLeadInvestigator] = useState("");
  const [division, setDivision] = useState("");
  const [priority, setPriority] = useState("routine");
  const [discordLink, setDiscordLink] = useState("");
  const [synopsis, setSynopsis] = useState("");

  const [formError, setFormError] = useState("");
  const [creatingCase, setCreatingCase] = useState(false);
  const [savingCase, setSavingCase] = useState(false);

  const [actionError, setActionError] = useState("");

  const [helpMessage, setHelpMessage] = useState("");
  const [helpError, setHelpError] = useState("");
  const [sendingHelp, setSendingHelp] = useState(false);

  const role = String(user?.role || "").toUpperCase();
  const isAdmin = role === "ADMIN";

  const officerId =
    user?.officer_id ||
    user?.officerId ||
    user?.callsign ||
    localStorage.getItem("scc_officer_id") ||
    "Officer ID not recorded";

  const operatorName =
    user?.username ||
    "OPERATOR";

  const fetchCases = useCallback(async () => {
    setLoading(true);
    setActionError("");

    try {
      const response = await api.get("/cases");

      setCases(
        Array.isArray(response.data)
          ? response.data
          : []
      );
    } catch (error) {
      console.error("Failed to load case files:", error);

      setCases([]);

      setActionError(
        formatApiError(error?.response?.data?.detail) ||
          error?.response?.data?.message ||
          "Unable to load case files."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  const resetCreateForm = () => {
    setCaseName("");
    setLeadInvestigator("");
    setDivision("");
    setPriority("routine");
    setDiscordLink("");
    setSynopsis("");
    setFormError("");
  };

  const resetEditForm = () => {
    setCaseName("");
    setLeadInvestigator("");
    setDivision("");
    setPriority("routine");
    setDiscordLink("");
    setSynopsis("");
    setFormError("");
  };

  const getCaseKey = (caseData) =>
    caseData?.id ||
    caseData?.case_id ||
    caseData?.case_uid ||
    caseData?._id;

  const getCaseId = (caseData) =>
    caseData?.id ||
    caseData?.case_id ||
    caseData?.case_uid ||
    caseData?._id ||
    "N/A";

  const getCaseName = (caseData) =>
    caseData?.name ||
    caseData?.case_name ||
    "Untitled Case";

  const getInvestigator = (caseData) =>
    caseData?.investigator ||
    caseData?.lead_investigator ||
    "Unassigned";

  const getUpdated = (caseData) =>
    caseData?.updated ||
    caseData?.updated_at ||
    caseData?.created_at ||
    "—";

  const openCreateDialog = () => {
    resetCreateForm();
    setIsCreateOpen(true);
  };

  const closeCreateDialog = () => {
    if (creatingCase) {
      return;
    }

    setIsCreateOpen(false);
    resetCreateForm();
  };

  const handleCreateCase = async (event) => {
    event.preventDefault();

    if (creatingCase) {
      return;
    }

    setFormError("");

    if (!caseName.trim()) {
      setFormError("Case Name is required.");
      return;
    }

    if (!leadInvestigator.trim()) {
      setFormError("Lead Investigator is required.");
      return;
    }

    if (!division) {
      setFormError("Division Involved is required.");
      return;
    }

    const casePayload = {
      name: caseName.trim(),
      lead_investigator: leadInvestigator.trim(),
      division,
      priority,
      discord_url: discordLink.trim(),
      synopsis: synopsis.trim(),
      status: "pending",
    };

    setCreatingCase(true);

    try {
      const response = await api.post(
        "/cases",
        casePayload
      );

      if (response?.data) {
        setCases((currentCases) => [
          response.data,
          ...currentCases,
        ]);
      } else {
        await fetchCases();
      }

      playSuccessSound();

      setIsCreateOpen(false);
      resetCreateForm();
    } catch (error) {
      console.error(
        "Failed to create case:",
        error
      );

      const detail =
        error?.response?.data?.detail;

      setFormError(
        formatApiError(detail) ||
          error?.response?.data?.message ||
          "Unable to create case file. Please try again."
      );
    } finally {
      setCreatingCase(false);
    }
  };

  const handleViewCase = async (caseData) => {
    setActionError("");

    setSelectedCase(caseData);
    setIsDetailOpen(true);

    const caseKey = getCaseKey(caseData);

    if (!caseKey) {
      return;
    }

    try {
      const response = await api.get(
        `/cases/${caseKey}`
      );

      if (response?.data) {
        setSelectedCase(response.data);
      }
    } catch (error) {
      console.warn(
        "Unable to retrieve extended case details:",
        error
      );
    }
  };

  const handleEditCase = (caseData) => {
    setSelectedCase(caseData);

    setCaseName(
      caseData?.name ||
        caseData?.case_name ||
        ""
    );

    setLeadInvestigator(
      caseData?.lead_investigator ||
        caseData?.investigator ||
        ""
    );

    setDivision(
      caseData?.division || ""
    );

    setPriority(
      caseData?.priority || "routine"
    );

    setDiscordLink(
      caseData?.discord_url || ""
    );

    setSynopsis(
      caseData?.synopsis || ""
    );

    setFormError("");
    setIsEditOpen(true);
  };

  const closeEditDialog = () => {
    if (savingCase) {
      return;
    }

    setIsEditOpen(false);
    setSelectedCase(null);
    resetEditForm();
  };

  const handleSaveCase = async (event) => {
    event.preventDefault();

    if (savingCase || !selectedCase) {
      return;
    }

    setFormError("");

    if (!caseName.trim()) {
      setFormError("Case Name is required.");
      return;
    }

    if (!leadInvestigator.trim()) {
      setFormError("Lead Investigator is required.");
      return;
    }

    if (!division) {
      setFormError("Division Involved is required.");
      return;
    }

    const caseKey = getCaseKey(selectedCase);

    if (!caseKey) {
      setFormError("Unable to determine the case identifier.");
      return;
    }

    const updatePayload = {
      name: caseName.trim(),
      lead_investigator: leadInvestigator.trim(),
      division,
      priority,
      discord_url: discordLink.trim(),
      synopsis: synopsis.trim(),
    };

    setSavingCase(true);

    try {
      const response = await api.put(
        `/cases/${caseKey}`,
        updatePayload
      );

      if (response?.data) {
        setCases((currentCases) =>
          currentCases.map((item) =>
            getCaseKey(item) === caseKey
              ? response.data
              : item
          )
        );

        setSelectedCase(response.data);
      } else {
        await fetchCases();
      }

      playSuccessSound();

      setIsEditOpen(false);
      resetEditForm();
    } catch (error) {
      console.error(
        "Failed to update case:",
        error
      );

      const detail =
        error?.response?.data?.detail;

      setFormError(
        formatApiError(detail) ||
          error?.response?.data?.message ||
          "Unable to save case file. Please try again."
      );
    } finally {
      setSavingCase(false);
    }
  };
  const handleApprove = async (caseData) => {
    if (!isAdmin) {
      return;
    }

    const caseKey = getCaseKey(caseData);

    if (!caseKey) {
      setActionError("Unable to determine the case identifier.");
      return;
    }

    const confirmed = window.confirm(
      `Approve case ${getCaseId(caseData)}?`
    );

    if (!confirmed) {
      return;
    }

    setActionError("");

    try {
      const response = await api.post(
        `/cases/${caseKey}/approve`
      );

      if (response?.data) {
        setCases((currentCases) =>
          currentCases.map((item) =>
            getCaseKey(item) === caseKey
              ? response.data
              : item
          )
        );

        setSelectedCase((currentSelectedCase) =>
          currentSelectedCase &&
          getCaseKey(currentSelectedCase) === caseKey
            ? response.data
            : currentSelectedCase
        );
      } else {
        await fetchCases();
      }

      playSuccessSound();
    } catch (error) {
      console.error(
        "Failed to approve case:",
        error
      );

      const detail =
        error?.response?.data?.detail;

      setActionError(
        formatApiError(detail) ||
          error?.response?.data?.message ||
          "Unable to approve this case."
      );
    }
  };

  const handleDeny = async (caseData) => {
    if (!isAdmin) {
      return;
    }

    const caseKey = getCaseKey(caseData);

    if (!caseKey) {
      setActionError(
        "Unable to determine the case identifier."
      );
      return;
    }

    const confirmed = window.confirm(
      `Deny case ${getCaseId(caseData)}?`
    );

    if (!confirmed) {
      return;
    }

    setActionError("");

    try {
      const response = await api.post(
        `/cases/${caseKey}/deny`
      );

      if (response?.data) {
        setCases((currentCases) =>
          currentCases.map((item) =>
            getCaseKey(item) === caseKey
              ? response.data
              : item
          )
        );

        setSelectedCase((currentSelectedCase) =>
          currentSelectedCase &&
          getCaseKey(currentSelectedCase) === caseKey
            ? response.data
            : currentSelectedCase
        );
      } else {
        await fetchCases();
      }

      playSuccessSound();
    } catch (error) {
      const detail =
        error?.response?.data?.detail;

      setActionError(
        formatApiError(detail) ||
          error?.response?.data?.message ||
          "Unable to deny this case."
      );
    }
  };

  const handleDelete = async (caseData) => {
    if (!isAdmin) {
      return;
    }

    const caseKey = getCaseKey(caseData);

    if (!caseKey) {
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete ${getCaseId(caseData)} — ${getCaseName(caseData)}?`
    );

    if (!confirmed) {
      return;
    }

    setActionError("");

    try {
      await api.delete(
        `/cases/${caseKey}`
      );

      setCases((currentCases) =>
        currentCases.filter(
          (item) =>
            getCaseKey(item) !== caseKey
        )
      );

      if (
        selectedCase &&
        getCaseKey(selectedCase) === caseKey
      ) {
        setSelectedCase(null);
        setIsDetailOpen(false);
        setIsEditOpen(false);
      }
    } catch (error) {
      console.error(
        "Failed to delete case:",
        error
      );

      const detail =
        error?.response?.data?.detail;

      setActionError(
        formatApiError(detail) ||
          error?.response?.data?.message ||
          "Unable to delete this case."
      );
    }
  };

  const openHelpDialog = (caseData) => {
    setSelectedCase(caseData);
    setHelpMessage("");
    setHelpError("");
    setIsHelpOpen(true);
  };

  const closeHelpDialog = () => {
    if (sendingHelp) {
      return;
    }

    setIsHelpOpen(false);
    setHelpMessage("");
    setHelpError("");
  };

  const handleRequestHelp = async (event) => {
    event.preventDefault();

    if (sendingHelp || !selectedCase) {
      return;
    }

    const caseKey = getCaseKey(selectedCase);

    if (!caseKey) {
      setHelpError(
        "Unable to determine the case identifier."
      );
      return;
    }

    if (!helpMessage.trim()) {
      setHelpError(
        "Please describe what assistance is required."
      );
      return;
    }

    setSendingHelp(true);
    setHelpError("");

    try {
      await api.post(
        `/cases/${caseKey}/help`,
        {
          message: helpMessage.trim(),
          officer_id: officerId,
          username: operatorName,
        }
      );

      playSuccessSound();

      setIsHelpOpen(false);
      setHelpMessage("");
      setHelpError("");
    } catch (error) {
      console.error(
        "Failed to request assistance:",
        error
      );

      const detail =
        error?.response?.data?.detail;

      setHelpError(
        formatApiError(detail) ||
          error?.response?.data?.message ||
          "Unable to send the assistance request."
      );
    } finally {
      setSendingHelp(false);
    }
  };

  const closeDetailDialog = () => {
    setIsDetailOpen(false);
    setSelectedCase(null);
  };

  const filteredCases = useMemo(() => {
    const searchValue = search
      .trim()
      .toLowerCase();

    return cases.filter((caseData) => {
      const normalizedStatus = String(
        caseData?.status || "pending"
      ).toLowerCase();

      const matchesFilter =
        filter === "all" ||
        normalizedStatus === filter;

      const caseNameValue = String(
        caseData?.name ||
          caseData?.case_name ||
          ""
      ).toLowerCase();

      const investigatorValue = String(
        caseData?.investigator ||
          caseData?.lead_investigator ||
          ""
      ).toLowerCase();

      const divisionValue = String(
        caseData?.division || ""
      ).toLowerCase();

      const caseIdValue = String(
        caseData?.id ||
          caseData?.case_id ||
          caseData?.case_uid ||
          caseData?._id ||
          ""
      ).toLowerCase();

      const matchesSearch =
        !searchValue ||
        caseNameValue.includes(searchValue) ||
        caseIdValue.includes(searchValue) ||
        investigatorValue.includes(searchValue) ||
        divisionValue.includes(searchValue);

      return (
        matchesFilter &&
        matchesSearch
      );
    });
  }, [cases, filter, search]);

  const pendingCount = cases.filter(
    (caseData) =>
      String(
        caseData?.status || ""
      ).toLowerCase() === "pending"
  ).length;

  const openedCount = cases.filter(
    (caseData) =>
      String(
        caseData?.status || ""
      ).toLowerCase() === "opened"
  ).length;

  const closedCount = cases.filter(
    (caseData) =>
      String(
        caseData?.status || ""
      ).toLowerCase() === "closed"
  ).length;

  const deniedCount = cases.filter(
    (caseData) =>
      String(
        caseData?.status || ""
      ).toLowerCase() === "denied"
  ).length;

  const getStatusStyle = (status) => {
    const normalized = String(
      status || "pending"
    ).toLowerCase();

    if (normalized === "opened") {
      return "bg-[#0f2e1e] border-[#245d3d] text-[#79e0a4]";
    }

    if (normalized === "closed") {
      return "bg-[#172238] border-[#2b4265] text-[#a8b6c9]";
    }

    if (normalized === "denied") {
      return "bg-[#2a1414] border-[#6b2929] text-[#f08080]";
    }

    return "bg-[#3a2f12] border-[#665522] text-[#f0d67a]";
  };

  const getPriorityStyle = (priorityValue) => {
    const normalized = String(
      priorityValue || ""
    ).toLowerCase();

    if (normalized === "high-risk") {
      return "bg-[#f08080]";
    }

    if (normalized === "urgent") {
      return "bg-[#f0b46d]";
    }

    return "bg-[#8ba0bd]";
  };

  const getAuditEntries = (caseData) => {
    if (Array.isArray(caseData?.audit_log)) {
      return caseData.audit_log;
    }

    if (Array.isArray(caseData?.activity)) {
      return caseData.activity;
    }

    if (Array.isArray(caseData?.audit)) {
      return caseData.audit;
    }

    return [];
  };

  return (
    <div
      className="min-h-screen bg-[#020813] font-sans antialiased text-[#e7edf6] relative overflow-x-hidden"
      style={{
        backgroundImage:
          "linear-gradient(rgba(20, 35, 60, 0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(20, 35, 60, 0.35) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }}
    >
      <header className="w-full bg-[#051122]/90 border-b border-[#142c4d] px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 sticky top-0 z-40 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-[#0a1b33] border border-[#1c3557] rounded-sm text-[#d4b25a]">
            <Shield className="h-7 w-7" />
          </div>

          <div>
            <h1 className="text-lg font-bold uppercase tracking-wider text-[#e7edf6] leading-none">
              State Crime Command
            </h1>

            <p className="text-[10px] font-mono tracking-widest text-[#8ba0bd] uppercase mt-1">
              NSW Police Force — Case File Tracker
            </p>
          </div>
        </div>

        <SydneyClock />

        <div className="flex items-center gap-3">
          <div className="text-right font-mono">
            <p className="text-xs font-bold text-[#e7edf6] uppercase">
              {operatorName}
            </p>

            <p className="text-[9px] text-[#d4b25a] tracking-widest uppercase mt-0.5">
              {user?.role || "AUTHORIZED"}
            </p>

            <p className="text-[8px] text-[#5f7592] tracking-wider uppercase mt-0.5">
              {officerId}
            </p>
          </div>

          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800 text-rose-300 text-xs rounded-md transition-colors cursor-pointer font-medium"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-6 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            icon={Clock3}
            label="Pending Review"
            value={pendingCount}
            accent="bg-amber-950/30 border-amber-800/60 text-[#d4b25a]"
          />

          <StatCard
            icon={FolderOpen}
            label="Opened Cases"
            value={openedCount}
            accent="bg-green-950/30 border-green-800/60 text-[#79e0a4]"
          />

          <StatCard
            icon={Archive}
            label="Closed Cases"
            value={closedCount}
            accent="bg-[#172238] border-[#2b4265] text-[#a8b6c9]"
          />

          <StatCard
            icon={X}
            label="Denied Cases"
            value={deniedCount}
            accent="bg-[#2a1414] border-[#6b2929] text-[#f08080]"
          />
        </div>

        {actionError && (
          <ErrorBanner message={actionError} />
        )}

        <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#4f6785]" />

            <input
              type="text"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search cases, investigators, divisions..."
              className="w-full box-border bg-[#040b17] border border-[#142c4d] rounded pl-10 pr-3 py-2.5 text-xs font-mono text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 uppercase tracking-wider"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-md border border-[#142c4d] overflow-hidden bg-[#071326]/50">
              {FILTERS.map((filterOption) => (
                <button
                  key={filterOption.key}
                  type="button"
                  onClick={() =>
                    setFilter(filterOption.key)
                  }
                  className={`px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-all cursor-pointer ${
                    filter === filterOption.key
                      ? "bg-[#d4b25a] text-[#050f1d] font-bold"
                      : "text-[#8ba0bd] hover:text-[#e7edf6] hover:bg-[#142c4d]/50"
                  }`}
                >
                  {filterOption.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={openCreateDialog}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#d4b25a] hover:bg-[#f0d67a] text-[#050f1d] font-bold text-xs uppercase tracking-widest rounded-sm transition-colors cursor-pointer border border-[#d4b25a]"
            >
              <FilePlus2 className="h-4 w-4" />
              New Case File
            </button>
          </div>
        </div>

        <div className="bg-[#071326]/60 border border-[#142c4d] rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-[#8ba0bd] border-b border-[#142c4d] bg-[#051122]/70">
                  <th className="px-4 py-3 font-medium">
                    Case ID
                  </th>

                  <th className="px-4 py-3 font-medium">
                    Case Name
                  </th>

                  <th className="px-4 py-3 font-medium hidden md:table-cell">
                    Division
                  </th>

                  <th className="px-4 py-3 font-medium hidden lg:table-cell">
                    Lead Investigator
                  </th>

                  <th className="px-4 py-3 font-medium">
                    Status
                  </th>

                  <th className="px-4 py-3 font-medium hidden xl:table-cell">
                    Updated
                  </th>

                  <th className="px-4 py-3 font-medium text-right">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-14 text-center text-[#8ba0bd]"
                    >
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-6 w-6 border-2 border-[#d4b25a]/30 border-t-[#d4b25a] rounded-full animate-spin" />

                        <span className="text-[10px] font-mono uppercase tracking-widest">
                          Loading case ledger...
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : filteredCases.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-14 text-center text-[#8ba0bd]"
                    >
                      <div className="font-mono text-[10px] uppercase tracking-widest">
                        No case files logged inside this active filter terminal branch.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredCases.map((caseData) => {
                    const status = String(
                      caseData?.status || "pending"
                    ).toLowerCase();

                    const caseKey =
                      getCaseKey(caseData);

                    return (
                      <tr
                        key={caseKey}
                        className="border-b border-[#10233d] last:border-0 hover:bg-[#0b1b30] transition-colors"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-[#d4b25a] whitespace-nowrap">
                          {getCaseId(caseData)}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${getPriorityStyle(
                                caseData?.priority
                              )}`}
                            />

                            <span className="font-semibold text-[#e7edf6]">
                              {getCaseName(caseData)}
                            </span>
                          </div>
                        </td>

                        <td className="px-4 py-3 text-[#a8b6c9] hidden md:table-cell whitespace-nowrap">
                          {caseData?.division || "—"}
                        </td>

                        <td className="px-4 py-3 text-[#a8b6c9] hidden lg:table-cell whitespace-nowrap">
                          {getInvestigator(caseData)}
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-sm border text-[9px] font-mono uppercase tracking-widest ${getStatusStyle(
                              status
                            )}`}
                          >
                            {status}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-[#8ba0bd] text-xs hidden xl:table-cell whitespace-nowrap">
                          {getUpdated(caseData)}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            <button
                              type="button"
                              title="View"
                              onClick={() =>
                                handleViewCase(caseData)
                              }
                              className="p-2 text-[#8ba0bd] hover:text-[#e7edf6] hover:bg-[#142c4d] rounded transition-colors"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              title="Edit"
                              onClick={() =>
                                handleEditCase(caseData)
                              }
                              className="p-2 text-[#8ba0bd] hover:text-[#e7edf6] hover:bg-[#142c4d] rounded transition-colors"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              title="Request Help"
                              onClick={() =>
                                openHelpDialog(caseData)
                              }
                              className="p-2 text-[#8ba0bd] hover:text-[#d4b25a] hover:bg-[#2d2510] rounded transition-colors"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                            </button>

                            {isAdmin &&
                              status === "pending" && (
                                <>
                                  <button
                                    type="button"
                                    title="Approve"
                                    onClick={() =>
                                      handleApprove(caseData)
                                    }
                                    className="px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-wider text-[#79e0a4] hover:text-[#b5f2cc] hover:bg-[#0f2e1e] border border-[#245d3d] rounded transition-colors"
                                  >
                                    Approve
                                  </button>

                                  <button
                                    type="button"
                                    title="Deny"
                                    onClick={() =>
                                      handleDeny(caseData)
                                    }
                                    className="px-2.5 py-1.5 text-[9px] font-mono uppercase tracking-wider text-[#f08080] hover:text-[#f4a6a6] hover:bg-[#2a1414] border border-[#6b2929] rounded transition-colors"
                                  >
                                    Deny
                                  </button>
                                </>
                              )}

                            {isAdmin && (
                              <button
                                type="button"
                                title="Delete"
                                onClick={() =>
                                  handleDelete(caseData)
                                }
                                className="p-2 text-[#8ba0bd] hover:text-[#f08080] hover:bg-[#2a1414] rounded transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* CREATE CASE */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#071326] border border-[#1c3557] rounded-sm shadow-2xl">
            <div className="sticky top-0 z-10 bg-[#08172a] border-b border-[#142c4d] px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#d4b25a]">
                  SCC // CASE MANAGEMENT
                </p>

                <h2 className="text-lg font-bold uppercase tracking-wider text-[#e7edf6] mt-1">
                  New Case File Log
                </h2>
              </div>

              <button
                type="button"
                onClick={closeCreateDialog}
                disabled={creatingCase}
                className="p-2 text-[#4f6785] hover:text-[#e7edf6] hover:bg-[#142c4d] rounded transition-colors disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCase}>
              <div className="p-5 space-y-5">
                <ErrorBanner message={formError} />

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Case Name
                  </label>

                  <input
                    type="text"
                    value={caseName}
                    onChange={(event) =>
                      setCaseName(event.target.value)
                    }
                    placeholder="e.g. Operation Viper"
                    disabled={creatingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 uppercase tracking-wider disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Lead Investigator
                  </label>

                  <input
                    type="text"
                    value={leadInvestigator}
                    onChange={(event) =>
                      setLeadInvestigator(event.target.value)
                    }
                    placeholder="e.g. Det. Sgt. J. Williams"
                    disabled={creatingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 tracking-wider disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Division Involved
                  </label>

                  <select
                    value={division}
                    onChange={(event) =>
                      setDivision(event.target.value)
                    }
                    disabled={creatingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 tracking-wider cursor-pointer disabled:opacity-50"
                  >
                    <option value="">
                      Select division
                    </option>

                    {DIVISIONS.map(
                      (divisionOption) => (
                        <option
                          key={divisionOption}
                          value={divisionOption}
                        >
                          {divisionOption}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Priority
                  </label>

                  <select
                    value={priority}
                    onChange={(event) =>
                      setPriority(event.target.value)
                    }
                    disabled={creatingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 tracking-wider cursor-pointer disabled:opacity-50"
                  >
                    {PRIORITIES.map(
                      (priorityOption) => (
                        <option
                          key={priorityOption}
                          value={priorityOption}
                        >
                          {priorityOption}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Discord Case File Link
                  </label>

                  <input
                    type="text"
                    value={discordLink}
                    onChange={(event) =>
                      setDiscordLink(event.target.value)
                    }
                    placeholder="discord.com..."
                    disabled={creatingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 disabled:opacity-50"
                  />

                  <p className="mt-1.5 text-[9px] font-mono text-[#4f6785]">
                    Link to the case thread in the Discord forum.
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Synopsis
                  </label>

                  <textarea
                    value={synopsis}
                    onChange={(event) =>
                      setSynopsis(event.target.value)
                    }
                    placeholder="Brief summary of the investigation..."
                    rows={4}
                    disabled={creatingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 resize-none disabled:opacity-50"
                  />
                </div>

                <div className="border border-[#142c4d] bg-[#040b17]/60 rounded-sm p-3">
                  <p className="text-[9px] font-mono uppercase tracking-wider leading-relaxed text-[#5f7592]">
                    New case files are logged as Pending Review
                    and can only be approved by an administrator.
                    Your authenticated account and officer ID are
                    used for activity tracking.
                  </p>
                </div>
              </div>

              <div className="border-t border-[#142c4d] bg-[#051122]/70 px-5 py-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeCreateDialog}
                  disabled={creatingCase}
                  className="px-4 py-2 border border-[#142c4d] hover:bg-[#142c4d]/40 text-[#8ba0bd] hover:text-[#e7edf6] rounded-sm transition-all text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={creatingCase}
                  className="px-5 py-2 bg-[#d4b25a] hover:bg-[#f0d67a] text-[#050f1d] rounded-sm transition-all text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {creatingCase ? (
                    <>
                      <span className="h-3.5 w-3.5 border-2 border-[#050f1d]/30 border-t-[#050f1d] rounded-full animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Case"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW CASE */}
      {isDetailOpen && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-[#071326] border border-[#1c3557] rounded-sm shadow-2xl">
            <div className="sticky top-0 z-10 bg-[#08172a] border-b border-[#142c4d] px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#d4b25a]">
                  SCC // CASE FILE
                </p>

                <h2 className="text-lg font-bold uppercase tracking-wider text-[#e7edf6] mt-1">
                  {getCaseName(selectedCase)}
                </h2>
              </div>

              <button
                type="button"
                onClick={closeDetailDialog}
                className="p-2 text-[#4f6785] hover:text-[#e7edf6] hover:bg-[#142c4d] rounded transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-[#040b17]/70 border border-[#142c4d] rounded-sm p-3">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                    Case ID
                  </p>

                  <p className="mt-1 font-mono text-sm text-[#d4b25a]">
                    {getCaseId(selectedCase)}
                  </p>
                </div>

                <div className="bg-[#040b17]/70 border border-[#142c4d] rounded-sm p-3">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                    Status
                  </p>

                  <span
                    className={`inline-flex mt-1 px-2 py-1 rounded-sm border text-[9px] font-mono uppercase tracking-widest ${getStatusStyle(
                      selectedCase?.status
                    )}`}
                  >
                    {selectedCase?.status || "pending"}
                  </span>
                </div>

                <div className="bg-[#040b17]/70 border border-[#142c4d] rounded-sm p-3">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                    Lead Investigator
                  </p>

                  <p className="mt-1 text-sm text-[#e7edf6]">
                    {getInvestigator(selectedCase)}
                  </p>
                </div>

                <div className="bg-[#040b17]/70 border border-[#142c4d] rounded-sm p-3">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                    Division
                  </p>

                  <p className="mt-1 text-sm text-[#e7edf6]">
                    {selectedCase?.division || "—"}
                  </p>
                </div>

                <div className="bg-[#040b17]/70 border border-[#142c4d] rounded-sm p-3">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                    Priority
                  </p>

                  <p className="mt-1 text-sm uppercase text-[#e7edf6]">
                    {selectedCase?.priority || "routine"}
                  </p>
                </div>

                <div className="bg-[#040b17]/70 border border-[#142c4d] rounded-sm p-3">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                    Created
                  </p>

                  <p className="mt-1 text-sm text-[#a8b6c9]">
                    {formatDate(selectedCase?.created_at)}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                  Synopsis
                </p>

                <div className="bg-[#040b17] border border-[#142c4d] rounded-sm p-4 min-h-[100px]">
                  <p className="text-sm text-[#c2ccda] whitespace-pre-wrap leading-relaxed">
                    {selectedCase?.synopsis ||
                      "No synopsis recorded."}
                  </p>
                </div>
              </div>

              {selectedCase?.discord_url && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Discord Case File
                  </p>

                  <a
                    href={selectedCase.discord_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-xs text-[#d4b25a] hover:text-[#f0d67a] font-mono"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Discord Case File
                  </a>
                </div>
              )}

              <div className="border-t border-[#142c4d] pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="h-4 w-4 text-[#d4b25a]" />

                  <p className="text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd]">
                    Activity / Audit Tracker
                  </p>
                </div>

                <div className="space-y-2">
                  {getAuditEntries(selectedCase).length > 0 ? (
                    getAuditEntries(selectedCase).map(
                      (entry, index) => (
                        <div
                          key={entry?.id || index}
                          className="bg-[#040b17] border border-[#142c4d] rounded-sm p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-mono uppercase text-[#e7edf6]">
                              {entry?.action ||
                                entry?.event ||
                                "Activity"}
                            </p>

                            <span className="text-[9px] font-mono text-[#4f6785]">
                              {formatDate(
                                entry?.created_at ||
                                  entry?.timestamp
                              )}
                            </span>
                          </div>

                          <p className="text-[10px] text-[#8ba0bd] mt-1">
                            Account:{" "}
                            {entry?.username ||
                              entry?.user ||
                              "Unknown"}
                          </p>

                          <p className="text-[10px] text-[#8ba0bd]">
                            Officer ID:{" "}
                            {entry?.officer_id ||
                              entry?.officerId ||
                              "Not recorded"}
                          </p>
                        </div>
                      )
                    )
                  ) : (
                    <div className="bg-[#040b17] border border-[#142c4d] rounded-sm p-3 space-y-2">
                      <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                        Recorded Case Metadata
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] font-mono">
                        <p className="text-[#8ba0bd]">
                          Created by:{" "}
                          <span className="text-[#e7edf6]">
                            {selectedCase?.created_by ||
                              "Not recorded"}
                          </span>
                        </p>

                        <p className="text-[#8ba0bd]">
                          Updated by:{" "}
                          <span className="text-[#e7edf6]">
                            {selectedCase?.updated_by ||
                              "Not recorded"}
                          </span>
                        </p>

                        <p className="text-[#8ba0bd]">
                          Created:{" "}
                          <span className="text-[#e7edf6]">
                            {formatDate(
                              selectedCase?.created_at
                            )}
                          </span>
                        </p>

                        <p className="text-[#8ba0bd]">
                          Updated:{" "}
                          <span className="text-[#e7edf6]">
                            {formatDate(
                              selectedCase?.updated_at
                            )}
                          </span>
                        </p>

                        <p className="text-[#8ba0bd]">
                          Approved by:{" "}
                          <span className="text-[#e7edf6]">
                            {selectedCase?.approved_by ||
                              "Not approved"}
                          </span>
                        </p>

                        <p className="text-[#8ba0bd]">
                          Approved:{" "}
                          <span className="text-[#e7edf6]">
                            {formatDate(
                              selectedCase?.approved_at
                            )}
                          </span>
                        </p>

                        <p className="text-[#8ba0bd]">
                          Denied by:{" "}
                          <span className="text-[#e7edf6]">
                            {selectedCase?.denied_by ||
                              "Not denied"}
                          </span>
                        </p>

                        <p className="text-[#8ba0bd]">
                          Denied:{" "}
                          <span className="text-[#e7edf6]">
                            {formatDate(
                              selectedCase?.denied_at
                            )}
                          </span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-[#142c4d] bg-[#051122]/70 px-5 py-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  openHelpDialog(selectedCase)
                }
                className="flex items-center gap-2 px-4 py-2 border border-[#665522] text-[#d4b25a] hover:bg-[#2d2510] rounded-sm text-xs font-bold uppercase tracking-wider"
              >
                <MessageCircle className="h-4 w-4" />
                Request Help
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleEditCase(selectedCase)
                  }
                  className="flex items-center gap-2 px-4 py-2 border border-[#142c4d] hover:bg-[#142c4d]/50 text-[#8ba0bd] hover:text-[#e7edf6] rounded-sm text-xs font-bold uppercase tracking-wider"
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </button>

                {isAdmin &&
                  String(
                    selectedCase?.status || ""
                  ).toLowerCase() === "pending" && (
                    <button
                      type="button"
                      onClick={() =>
                        handleApprove(selectedCase)
                      }
                      className="flex items-center gap-2 px-4 py-2 bg-[#0f2e1e] border border-[#245d3d] text-[#79e0a4] hover:bg-[#163d27] rounded-sm text-xs font-bold uppercase tracking-wider"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approve
                    </button>
                  )}

                {isAdmin &&
                  String(
                    selectedCase?.status || ""
                  ).toLowerCase() === "pending" && (
                    <button
                      type="button"
                      onClick={() =>
                        handleDeny(selectedCase)
                      }
                      className="flex items-center gap-2 px-4 py-2 bg-[#2a1414] border border-[#6b2929] text-[#f08080] hover:bg-[#391919] rounded-sm text-xs font-bold uppercase tracking-wider"
                    >
                      <X className="h-4 w-4" />
                      Deny
                    </button>
                  )}

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() =>
                      handleDelete(selectedCase)
                    }
                    className="flex items-center gap-2 px-4 py-2 bg-[#2a1414] border border-[#6b2929] text-[#f08080] hover:bg-[#391919] rounded-sm text-xs font-bold uppercase tracking-wider"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT CASE */}
      {isEditOpen && selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#071326] border border-[#1c3557] rounded-sm shadow-2xl">
            <div className="sticky top-0 z-10 bg-[#08172a] border-b border-[#142c4d] px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#d4b25a]">
                  SCC // CASE MANAGEMENT
                </p>

                <h2 className="text-lg font-bold uppercase tracking-wider text-[#e7edf6] mt-1">
                  Edit Case File
                </h2>
              </div>

              <button
                type="button"
                onClick={closeEditDialog}
                disabled={savingCase}
                className="p-2 text-[#4f6785] hover:text-[#e7edf6] hover:bg-[#142c4d] rounded transition-colors disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCase}>
              <div className="p-5 space-y-5">
                <ErrorBanner message={formError} />

                <div className="bg-[#040b17]/70 border border-[#142c4d] rounded-sm p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                      Case ID
                    </p>

                    <span className="font-mono text-xs text-[#d4b25a]">
                      {getCaseId(selectedCase)}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Case Name
                  </label>

                  <input
                    type="text"
                    value={caseName}
                    onChange={(event) =>
                      setCaseName(event.target.value)
                    }
                    disabled={savingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a]/60 disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Lead Investigator
                  </label>

                  <input
                    type="text"
                    value={leadInvestigator}
                    onChange={(event) =>
                      setLeadInvestigator(event.target.value)
                    }
                    disabled={savingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a]/60 disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Division Involved
                  </label>

                  <select
                    value={division}
                    onChange={(event) =>
                      setDivision(event.target.value)
                    }
                    disabled={savingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a]/60 disabled:opacity-50"
                  >
                    <option value="">
                      Select division
                    </option>

                    {DIVISIONS.map(
                      (divisionOption) => (
                        <option
                          key={divisionOption}
                          value={divisionOption}
                        >
                          {divisionOption}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Priority
                  </label>

                  <select
                    value={priority}
                    onChange={(event) =>
                      setPriority(event.target.value)
                    }
                    disabled={savingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a]/60 disabled:opacity-50"
                  >
                    {PRIORITIES.map(
                      (priorityOption) => (
                        <option
                          key={priorityOption}
                          value={priorityOption}
                        >
                          {priorityOption}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Discord Case File Link
                  </label>

                  <input
                    type="text"
                    value={discordLink}
                    onChange={(event) =>
                      setDiscordLink(event.target.value)
                    }
                    disabled={savingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a]/60 disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Synopsis
                  </label>

                  <textarea
                    value={synopsis}
                    onChange={(event) =>
                      setSynopsis(event.target.value)
                    }
                    rows={5}
                    disabled={savingCase}
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a]/60 resize-none disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="border-t border-[#142c4d] bg-[#051122]/70 px-5 py-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeEditDialog}
                  disabled={savingCase}
                  className="px-4 py-2 border border-[#142c4d] hover:bg-[#142c4d]/40 text-[#8ba0bd] hover:text-[#e7edf6] rounded-sm text-xs font-bold uppercase tracking-wider"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={savingCase}
                  className="flex items-center gap-2 px-5 py-2 bg-[#d4b25a] hover:bg-[#f0d67a] text-[#050f1d] rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-60"
                >
                  {savingCase ? (
                    <>
                      <span className="h-3.5 w-3.5 border-2 border-[#050f1d]/30 border-t-[#050f1d] rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REQUEST HELP */}
      {isHelpOpen && selectedCase && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#071326] border border-[#665522] rounded-sm shadow-2xl">
            <div className="border-b border-[#142c4d] px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#d4b25a]">
                  SCC // ASSISTANCE
                </p>

                <h2 className="text-lg font-bold uppercase tracking-wider text-[#e7edf6] mt-1">
                  Request Help
                </h2>
              </div>

              <button
                type="button"
                onClick={closeHelpDialog}
                disabled={sendingHelp}
                className="p-2 text-[#4f6785] hover:text-[#e7edf6] hover:bg-[#142c4d] rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRequestHelp}>
              <div className="p-5 space-y-4">
                {helpError && (
                  <ErrorBanner message={helpError} />
                )}

                <div className="bg-[#040b17]/70 border border-[#142c4d] rounded-sm p-3">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                    Assistance requested for
                  </p>

                  <p className="text-sm font-semibold text-[#e7edf6] mt-1">
                    {getCaseName(selectedCase)}
                  </p>

                  <p className="text-[10px] font-mono text-[#d4b25a] mt-1">
                    {getCaseId(selectedCase)}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-[#040b17]/70 border border-[#142c4d] rounded-sm p-3">
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-[#d4b25a]" />

                      <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                        Account
                      </p>
                    </div>

                    <p className="text-xs text-[#e7edf6] mt-1 font-mono">
                      {operatorName}
                    </p>
                  </div>

                  <div className="bg-[#040b17]/70 border border-[#142c4d] rounded-sm p-3">
                    <div className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5 text-[#d4b25a]" />

                      <p className="text-[9px] font-mono uppercase tracking-widest text-[#4f6785]">
                        Officer ID
                      </p>
                    </div>

                    <p className="text-xs text-[#e7edf6] mt-1 font-mono">
                      {officerId}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    What assistance is required?
                  </label>

                  <textarea
                    value={helpMessage}
                    onChange={(event) =>
                      setHelpMessage(event.target.value)
                    }
                    rows={5}
                    disabled={sendingHelp}
                    placeholder="Describe the assistance required..."
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 resize-none disabled:opacity-50"
                  />
                </div>

                <div className="bg-[#2d2510]/40 border border-[#665522]/60 rounded-sm p-3">
                  <p className="text-[9px] font-mono uppercase tracking-wider leading-relaxed text-[#9f8d55]">
                    This request will be sent through the SCC
                    assistance notification system and recorded
                    against your authenticated account.
                  </p>
                </div>
              </div>

              <div className="border-t border-[#142c4d] bg-[#051122]/70 px-5 py-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeHelpDialog}
                  disabled={sendingHelp}
                  className="px-4 py-2 border border-[#142c4d] hover:bg-[#142c4d]/40 text-[#8ba0bd] rounded-sm text-xs font-bold uppercase tracking-wider"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={sendingHelp}
                  className="flex items-center gap-2 px-5 py-2 bg-[#d4b25a] hover:bg-[#f0d67a] text-[#050f1d] rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-60"
                >
                  {sendingHelp ? (
                    <>
                      <span className="h-3.5 w-3.5 border-2 border-[#050f1d]/30 border-t-[#050f1d] rounded-full animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <MessageCircle className="h-4 w-4" />
                      Send Request
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
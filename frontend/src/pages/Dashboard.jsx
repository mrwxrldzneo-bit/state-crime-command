import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
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
} from "lucide-react";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "opened", label: "Opened" },
  { key: "closed", label: "Closed" },
];

function SydneyClock() {
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

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}) {
  return (
    <div className="bg-[#071326]/60 border border-[#142c4d] rounded-sm p-4 flex items-center justify-between relative">
      <div className="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l border-[#4f6785]" />

      <div className="flex items-center gap-3">
        <div
          className={`p-3 rounded border ${accent}`}
        >
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

export default function Dashboard() {
  const { user, logout } = useAuth();

  const [cases, setCases] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [caseName, setCaseName] = useState("");
  const [leadInvestigator, setLeadInvestigator] = useState("");
  const [division, setDivision] = useState("");
  const [priority, setPriority] = useState("Routine");
  const [discordLink, setDiscordLink] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [formError, setFormError] = useState("");

  const fetchCases = useCallback(async () => {
    setLoading(true);

    try {
      const res = await api.get("/cases");

      setCases(
        Array.isArray(res.data)
          ? res.data
          : []
      );
    } catch (err) {
      console.log(
        "Database connection idle. Using local operational tracking files."
      );

      setCases([
        {
          id: "SCC-2026-0891",
          name: "OPERATION VIPER",
          division: "Organised Crime Squad",
          investigator: "Det. Sgt. J. Williams",
          status: "opened",
          updated: "2 mins ago",
          priority: "High",
        },
        {
          id: "SCC-2026-1042",
          name: "STRIKE FORCE ALPHA",
          division: "Cybercrime Squad",
          investigator: "Det. Insp. C. Vance",
          status: "pending",
          updated: "Just now",
          priority: "Critical",
        },
        {
          id: "SCC-2026-0412",
          name: "OPERATION TITAN",
          division: "Homicide Squad",
          investigator: "Det. R. Cooper",
          status: "closed",
          updated: "2 days ago",
          priority: "Routine",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  const handleCreateCase = (event) => {
    event.preventDefault();

    if (
      !caseName.trim() ||
      !leadInvestigator.trim() ||
      !division
    ) {
      setFormError(
        "All core data tracking indices required."
      );
      return;
    }

    const newCase = {
      id: `SCC-2026-${Math.floor(
        1000 + Math.random() * 9000
      )}`,
      name: caseName.trim().toUpperCase(),
      division,
      investigator: leadInvestigator.trim(),
      status: "pending",
      updated: "Just now",
      priority,
      discord_link: discordLink.trim(),
      synopsis: synopsis.trim(),
    };

    setCases((currentCases) => [
      newCase,
      ...currentCases,
    ]);

    setIsCreateOpen(false);

    setCaseName("");
    setLeadInvestigator("");
    setDivision("");
    setPriority("Routine");
    setDiscordLink("");
    setSynopsis("");
    setFormError("");
  };

  const filteredCases = cases.filter((caseData) => {
    const matchesFilter =
      filter === "all" ||
      caseData.status === filter;

    const searchValue = search.toLowerCase();

    const matchesSearch =
      caseData.name
        ?.toLowerCase()
        .includes(searchValue) ||
      caseData.id
        ?.toLowerCase()
        .includes(searchValue) ||
      caseData.investigator
        ?.toLowerCase()
        .includes(searchValue) ||
      caseData.division
        ?.toLowerCase()
        .includes(searchValue);

    return matchesFilter && matchesSearch;
  });

  const pendingCount = cases.filter(
    (caseData) => caseData.status === "pending"
  ).length;

  const openedCount = cases.filter(
    (caseData) => caseData.status === "opened"
  ).length;

  const closedCount = cases.filter(
    (caseData) => caseData.status === "closed"
  ).length;

  const getStatusStyle = (status) => {
    if (status === "opened") {
      return "bg-[#0f2e1e] border-[#245d3d] text-[#79e0a4]";
    }

    if (status === "closed") {
      return "bg-[#172238] border-[#2b4265] text-[#a8b6c9]";
    }

    return "bg-[#3a2f12] border-[#665522] text-[#f0d67a]";
  };

  const getPriorityStyle = (priorityValue) => {
    if (priorityValue === "Critical") {
      return "text-[#f08080]";
    }

    if (priorityValue === "High") {
      return "text-[#f0b46d]";
    }

    if (priorityValue === "Medium") {
      return "text-[#f0d67a]";
    }

    return "text-[#8ba0bd]";
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
      {/* Top Cyber Command Intelligence Banner Header */}
      <header className="w-full bg-[#051122]/90 border-b border-[#142c4d] px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 sticky top-0 z-40 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-[#0a1b33] border border-[#1c3557] rounded-sm text-[#d4b25a]">
            <Shield className="h-7 w-7 drop-shadow-[0_0_8px_rgba(212,178,90,0.3)]" />
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
              {user?.username || "OPERATOR"}
            </p>

            <p className="text-[9px] text-[#d4b25a] tracking-widest uppercase mt-0.5">
              {user?.role || "AUTHORIZED"}
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
        {/* Metric Data Counters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        </div>

        {/* Active Filter Ledger Navigation Rail */}
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
              className="w-full bg-[#040b17] border border-[#142c4d] rounded pl-10 pr-3 py-2.5 text-xs font-mono text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 uppercase tracking-wider"
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
              onClick={() => {
                setFormError("");
                setIsCreateOpen(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#d4b25a] hover:bg-[#f0d67a] text-[#050f1d] font-bold text-xs uppercase tracking-widest rounded-sm transition-colors cursor-pointer border border-[#d4b25a]"
            >
              <FilePlus2 className="h-4 w-4" />
              New Case File
            </button>
          </div>
        </div>

        {/* Ledger Grid Data Table */}
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
                        No matching case files logged inside this active filter terminal branch.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredCases.map((caseData) => (
                    <tr
                      key={caseData.id}
                      className="border-b border-[#10233d] last:border-0 hover:bg-[#0b1b30] transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-[#d4b25a] whitespace-nowrap">
                        {caseData.id}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${getPriorityStyle(
                              caseData.priority
                            )}`}
                          />

                          <span className="font-semibold text-[#e7edf6]">
                            {caseData.name}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-[#a8b6c9] hidden md:table-cell whitespace-nowrap">
                        {caseData.division}
                      </td>

                      <td className="px-4 py-3 text-[#a8b6c9] hidden lg:table-cell whitespace-nowrap">
                        {caseData.investigator}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-sm border text-[9px] font-mono uppercase tracking-widest ${getStatusStyle(
                            caseData.status
                          )}`}
                        >
                          {caseData.status}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-[#8ba0bd] text-xs hidden xl:table-cell whitespace-nowrap">
                        {caseData.updated}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="View"
                            className="p-2 text-[#8ba0bd] hover:text-[#e7edf6] hover:bg-[#142c4d] rounded transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            title="Edit"
                            className="p-2 text-[#8ba0bd] hover:text-[#e7edf6] hover:bg-[#142c4d] rounded transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            title="Delete"
                            className="p-2 text-[#8ba0bd] hover:text-[#f08080] hover:bg-[#2a1414] rounded transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* New Case File Log Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#000000]/75 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#071326] border border-[#1c3557] rounded-sm shadow-2xl">
            {/* Modal Header */}
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
                onClick={() => {
                  setIsCreateOpen(false);
                  setFormError("");
                }}
                className="p-2 text-[#4f6785] hover:text-[#e7edf6] hover:bg-[#142c4d] rounded transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCase}>
              <div className="p-5 space-y-5">
                {/* Form Error */}
                {formError && (
                  <div className="flex items-start gap-3 bg-[#2a1414] border border-[#6b2929] rounded-sm p-3">
                    <AlertTriangle className="h-4 w-4 text-[#f08080] mt-0.5 shrink-0" />

                    <p className="text-xs font-mono text-[#f4a6a6]">
                      {formError}
                    </p>
                  </div>
                )}

                {/* Case Name */}
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
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 uppercase tracking-wider"
                  />
                </div>

                {/* Lead Investigator */}
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
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 tracking-wider"
                  />
                </div>

                {/* Division */}
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Division Involved
                  </label>

                  <select
                    value={division}
                    onChange={(event) =>
                      setDivision(event.target.value)
                    }
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 tracking-wider cursor-pointer"
                  >
                    <option value="">
                      Select division
                    </option>

                    <option value="Organised Crime Squad">
                      Organised Crime Squad
                    </option>

                    <option value="Cybercrime Squad">
                      Cybercrime Squad
                    </option>

                    <option value="Homicide Squad">
                      Homicide Squad
                    </option>

                    <option value="Counter Terrorism Command">
                      Counter Terrorism Command
                    </option>
                  </select>
                </div>

                {/* Priority */}
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    Priority
                  </label>

                  <select
                    value={priority}
                    onChange={(event) =>
                      setPriority(event.target.value)
                    }
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 tracking-wider cursor-pointer"
                  >
                    <option value="Routine">
                      Routine
                    </option>

                    <option value="Medium">
                      Medium
                    </option>

                    <option value="High">
                      High
                    </option>

                    <option value="Critical">
                      Critical
                    </option>
                  </select>
                </div>

                {/* Discord Link */}
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba0bd] mb-2">
                    📦 Discord Case File Link
                  </label>

                  <input
                    type="text"
                    value={discordLink}
                    onChange={(event) =>
                      setDiscordLink(event.target.value)
                    }
                    placeholder="discord.com..."
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20"
                  />

                  <p className="mt-1.5 text-[9px] font-mono text-[#4f6785]">
                    Link to the case thread in the Discord forum. Shown as "View Case File Here".
                  </p>
                </div>

                {/* Synopsis */}
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
                    className="w-full box-border rounded-sm bg-[#040b17] border border-[#142c4d] px-3 py-2.5 text-xs text-[#e7edf6] placeholder:text-[#384c66] focus:outline-none focus:border-[#d4b25a]/60 focus:ring-1 focus:ring-[#d4b25a]/20 resize-none"
                  />
                </div>

                <div className="border border-[#142c4d] bg-[#040b17]/60 rounded-sm p-3">
                  <p className="text-[9px] font-mono uppercase tracking-wider leading-relaxed text-[#5f7592]">
                    New case files are logged as Pending Review and become active once approved by an administrator profile handshake.
                  </p>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-[#142c4d] bg-[#051122]/70 px-5 py-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setFormError("");
                  }}
                  className="px-4 py-2 border border-[#142c4d] hover:bg-[#142c4d]/40 text-[#8ba0bd] hover:text-[#e7edf6] rounded-sm transition-all text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="px-5 py-2 bg-[#d4b25a] hover:bg-[#f0d67a] text-[#050f1d] rounded-sm transition-all text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  Create Case
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
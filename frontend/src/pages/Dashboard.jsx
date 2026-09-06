import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import api, { formatApiError } from "../lib/api";
import { toast } from "sonner";
import CaseFormDialog from "../components/CaseFormDialog";
import CaseDetailDialog from "../components/CaseDetailDialog";
import { StatusBadge, PriorityDot, formatDateTime } from "../lib/caseMeta";
import { Brand } from "../components/Brand";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import {
  LogOut,
  Search,
  FilePlus2,
  Eye,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Archive,
  Loader2,
  AlertTriangle,
} from "lucide-react";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "opened", label: "Opened" },
  { key: "closed", label: "Closed" },
];

function SydneyClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
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

function StatCard({ icon: Icon, label, value, accent, testid }) {
  return (
    <div className="scc-panel rounded-xl p-4 sm:p-5 flex items-center gap-4" data-testid={testid}>
      <div className={`h-11 w-11 rounded-lg flex items-center justify-center ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-3xl font-display font-700 tabular-nums text-[#e7edf6] leading-none">{value}</div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#8ba0bd] mt-1.5">{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, isAdmin, logout } = useAuth();
  const [cases, setCases] = useState([]);
  const [stats, setStats] = useState({ pending: 0, opened: 0, closed: 0 });
  const [config, setConfig] = useState({ divisions: [], statuses: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState("create");
  const [editing, setEditing] = useState(null);

  const [detail, setDetail] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter !== "all") params.status = filter;
      if (search.trim()) params.search = search.trim();
      const [c, s] = await Promise.all([
        api.get("/cases", { params }),
        api.get("/stats"),
      ]);
      setCases(c.data);
      setStats(s.data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed to load case files.");
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    api.get("/config").then((r) => setConfig(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(loadCases, 250);
    return () => clearTimeout(t);
  }, [loadCases]);

  const openCreate = () => {
    setFormMode("create");
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (c) => {
    setFormMode("edit");
    setEditing(c);
    setFormOpen(true);
  };

  const approve = async (c) => {
    try {
      await api.post(`/cases/${c.id}/approve`);
      toast.success(`${c.name} approved — now Opened.`);
      loadCases();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Approval failed.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/cases/${deleteTarget.id}`);
      toast.success("Case file permanently deleted.");
      setDeleteTarget(null);
      loadCases();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  const roleLabel = isAdmin ? "Administrator" : "Detective";

  return (
    <div className="scc-grid-bg min-h-screen pb-16">
      <div className="scc-classbar" data-testid="classification-bar">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-1 flex items-center justify-between gap-3 font-mono-scc text-[9px] sm:text-[10px] uppercase tracking-[0.18em] text-[#a08a4d]">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#e05656] scc-blink" /> REC · LIVE
          </span>
          <span className="hidden sm:inline text-[#8a7a4a]">Restricted // Roleplay Use Only — Unofficial · Not Affiliated with the NSW Police Force</span>
          <span className="sm:hidden text-[#8a7a4a]">Restricted // Roleplay</span>
          <span>Clearance: {isAdmin ? "Alpha" : "Bravo"}</span>
        </div>
      </div>

      <header className="border-b border-[#1c3557] bg-[#0a1524]/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <Brand variant="inline" />

          <div className="hidden md:block">
            <SydneyClock />
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-sm text-[#e7edf6] font-600" data-testid="current-user">{user?.username}</div>
              <div className={`text-[10px] uppercase tracking-widest ${isAdmin ? "text-[#f0d67a]" : "text-[#8ba0bd]"}`}>
                {roleLabel}
              </div>
            </div>
            <button
              data-testid="logout-button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#1c3557] px-3 py-2 text-xs text-[#a8b6c9] hover:bg-[#122642] hover:text-[#e7edf6] transition-colors"
            >
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
        <div className="md:hidden border-t border-[#1c3557] px-4 py-2 flex justify-center">
          <LiveClock />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-6 scc-fade-up">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            testid="stat-pending"
            icon={Clock3}
            label="Pending Review"
            value={stats.pending}
            accent="bg-[#3a2f12] text-[#f0d67a]"
          />
          <StatCard
            testid="stat-opened"
            icon={FolderOpen}
            label="Opened Cases"
            value={stats.opened}
            accent="bg-[#0f2e1e] text-[#79e0a4]"
          />
          <StatCard
            testid="stat-closed"
            icon={Archive}
            label="Closed Cases"
            value={stats.closed}
            accent="bg-[#1a2740] text-[#a8b6c9]"
          />
        </div>

        <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6f849f]" />
            <input
              data-testid="search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cases, investigators, divisions…"
              className="w-full rounded-md bg-[#081222] border border-[#1c3557] pl-10 pr-3 py-2.5 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 focus:ring-1 focus:ring-[#d4b25a]/40 transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-md border border-[#1c3557] overflow-hidden">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  data-testid={`filter-${f.key}`}
                  onClick={() => setFilter(f.key)}
                  className={`px-3.5 py-2 text-xs font-600 uppercase tracking-wider transition-colors ${
                    filter === f.key
                      ? "bg-[#d4b25a] text-[#0a1524]"
                      : "text-[#8ba0bd] hover:bg-[#122642] hover:text-[#e7edf6]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              data-testid="new-case-button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-md bg-[#d4b25a] hover:bg-[#f0d67a] text-[#0a1524] font-display font-600 uppercase tracking-wider text-sm px-4 py-2.5 transition-colors"
            >
              <FilePlus2 className="h-4 w-4" /> New Case File
            </button>
          </div>
        </div>

        <div className="scc-panel rounded-xl overflow-hidden" data-testid="cases-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-[#8ba0bd] border-b border-[#1c3557]">
                  <th className="px-4 py-3 font-500">Case ID</th>
                  <th className="px-4 py-3 font-500">Case Name</th>
                  <th className="px-4 py-3 font-500 hidden md:table-cell">Division</th>
                  <th className="px-4 py-3 font-500 hidden lg:table-cell">Lead Investigator</th>
                  <th className="px-4 py-3 font-500">Status</th>
                  <th className="px-4 py-3 font-500 hidden xl:table-cell">Updated</th>
                  <th className="px-4 py-3 font-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-[#8ba0bd]">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-[#d4b25a]" />
                    </td>
                  </tr>
                ) : cases.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-[#8ba0bd]" data-testid="no-cases">
                      No case files match the current filter.
                    </td>
                  </tr>
                ) : (
                  cases.map((c) => (
                    <tr
                      key={c.id}
                      data-testid={`case-row-${c.case_id}`}
                      onClick={() => setDetail(c)}
                      className="border-b border-[#132842] last:border-0 hover:bg-[#0e2138] cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono-scc text-xs text-[#d4b25a] whitespace-nowrap">{c.case_id}</td>
                      <td className="px-4 py-3 font-600 text-[#e7edf6]">
                        <div className="flex items-center gap-2.5">
                          <PriorityDot priority={c.priority} />
                          <span>{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#a8b6c9] hidden md:table-cell whitespace-nowrap">{c.division}</td>
                      <td className="px-4 py-3 text-[#a8b6c9] hidden lg:table-cell whitespace-nowrap">{c.lead_investigator}</td>
                      <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                      <td className="px-4 py-3 text-[#8ba0bd] text-xs hidden xl:table-cell whitespace-nowrap">
                        {formatDateTime(c.updated_at)}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            data-testid={`view-${c.case_id}`}
                            onClick={() => setDetail(c)}
                            title="View"
                            className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-[#a8b6c9] hover:bg-[#1c3557] hover:text-[#e7edf6] transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" /> <span className="hidden sm:inline">View</span>
                          </button>
                          <button
                            data-testid={`edit-${c.case_id}`}
                            onClick={() => openEdit(c)}
                            title="Edit"
                            className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-[#a8b6c9] hover:bg-[#1c3557] hover:text-[#e7edf6] transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
                          </button>
                          {isAdmin && c.status === "pending" && (
                            <button
                              data-testid={`approve-${c.case_id}`}
                              onClick={() => approve(c)}
                              title="Approve"
                              className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-[#79e0a4] hover:bg-[#0f2e1e] transition-colors"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Approve</span>
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              data-testid={`delete-${c.case_id}`}
                              onClick={() => setDeleteTarget(c)}
                              title="Delete"
                              className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-[#f4a6a6] hover:bg-[#2a1414] transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Delete</span>
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
        </div>
      </main>

      <CaseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        existing={editing}
        divisions={config.divisions}
        statuses={config.statuses}
        onSaved={loadCases}
      />

      <CaseDetailDialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)} caseData={detail} onSaved={loadCases} />

      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent data-testid="delete-dialog" className="scc-panel border-[#1c3557] text-[#e7edf6] max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wide text-[#f4a6a6] flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Delete Case File
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#c3cede]">
            Permanently delete <b className="text-[#e7edf6]">{deleteTarget?.name}</b> ({deleteTarget?.case_id})?
            This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <button
              data-testid="delete-cancel"
              onClick={() => setDeleteTarget(null)}
              className="rounded-md border border-[#1c3557] px-4 py-2 text-sm text-[#a8b6c9] hover:bg-[#122642] transition-colors"
            >
              Cancel
            </button>
            <button
              data-testid="delete-confirm"
              onClick={confirmDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-md bg-[#8f2a2a] hover:bg-[#a83636] disabled:opacity-60 text-white font-600 uppercase tracking-wider text-sm px-5 py-2 transition-colors"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilePlus2, Save, Loader2, Link2, Info } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";

const EMPTY = {
  name: "",
  lead_investigator: "",
  division: "",
  synopsis: "",
  discord_url: "",
  status: "pending",
  priority: "routine",
};

const fieldCls =
  "w-full rounded-md bg-[#081222] border border-[#1c3557] px-3 py-2 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 focus:ring-1 focus:ring-[#d4b25a]/40 transition-colors";
const labelCls = "text-[11px] uppercase tracking-widest text-[#8ba0bd] mb-1.5 block";

export default function CaseFormDialog({ open, onOpenChange, mode, existing, divisions, statuses, onSaved }) {
  const { isAdmin } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(mode === "edit" && existing ? { ...EMPTY, ...existing } : EMPTY);
    }
  }, [open, mode, existing]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || !form.lead_investigator.trim() || !form.division) {
      toast.error("Case name, lead investigator and division are required.");
      return;
    }
    setSaving(true);
    try {
      if (mode === "edit") {
        const payload = {
          name: form.name,
          lead_investigator: form.lead_investigator,
          division: form.division,
          synopsis: form.synopsis,
          discord_url: form.discord_url,
          priority: form.priority,
        };
        if (isAdmin) payload.status = form.status;
        await api.put(`/cases/${existing.id}`, payload);
        toast.success("Case file updated.");
      } else {
        await api.post("/cases", {
          name: form.name,
          lead_investigator: form.lead_investigator,
          division: form.division,
          synopsis: form.synopsis,
          discord_url: form.discord_url,
          priority: form.priority,
        });
        toast.success("Case file logged — sent for command review.");
      }
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Unable to save case file.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="case-form-dialog"
        className="scc-panel border-[#1c3557] text-[#e7edf6] max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-wider text-[#f0d67a] flex items-center gap-2">
            {mode === "edit" ? <Save className="h-5 w-5" /> : <FilePlus2 className="h-5 w-5" />}
            {mode === "edit" ? "Edit Case File" : "New Case File Log"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <label className={labelCls}>Case Name</label>
            <input
              data-testid="case-name-input"
              className={fieldCls}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Operation Viper"
            />
          </div>

          <div>
            <label className={labelCls}>Lead Investigator</label>
            <input
              data-testid="case-lead-input"
              className={fieldCls}
              value={form.lead_investigator}
              onChange={(e) => set("lead_investigator", e.target.value)}
              placeholder="e.g. Det. Sgt. J. Williams"
            />
          </div>

          <div>
            <label className={labelCls}>Division Involved</label>
            <Select value={form.division} onValueChange={(v) => set("division", v)}>
              <SelectTrigger data-testid="case-division-select" className={fieldCls + " h-auto"}>
                <SelectValue placeholder="Select division" />
              </SelectTrigger>
              <SelectContent className="bg-[#102540] border-[#1c3557] text-[#e7edf6]">
                {divisions.map((d) => (
                  <SelectItem key={d} value={d} data-testid={`division-option-${d}`} className="focus:bg-[#1c3557]">
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className={labelCls}>Priority</label>
            <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
              <SelectTrigger data-testid="case-priority-select" className={fieldCls + " h-auto"}>
                <SelectValue placeholder="Select priority" />
              </SelectTrigger>
              <SelectContent className="bg-[#102540] border-[#1c3557] text-[#e7edf6]">
                <SelectItem value="routine" className="focus:bg-[#1c3557]">Routine</SelectItem>
                <SelectItem value="urgent" className="focus:bg-[#1c3557]">Urgent</SelectItem>
                <SelectItem value="high-risk" className="focus:bg-[#1c3557]">High-Risk</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "edit" && isAdmin && (            <div>
              <label className={labelCls}>Status</label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger data-testid="case-status-select" className={fieldCls + " h-auto"}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#102540] border-[#1c3557] text-[#e7edf6]">
                  <SelectItem value="pending" className="focus:bg-[#1c3557]">Pending Review</SelectItem>
                  <SelectItem value="opened" className="focus:bg-[#1c3557]">Opened</SelectItem>
                  <SelectItem value="closed" className="focus:bg-[#1c3557]">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" /> Discord Case File Link
              </span>
            </label>
            <input
              data-testid="case-discord-input"
              className={fieldCls}
              value={form.discord_url}
              onChange={(e) => set("discord_url", e.target.value)}
              placeholder="https://discord.com/channels/..."
            />
            <p className="text-[10px] text-[#556a86] mt-1">
              Link to the case thread in the Discord forum. Shown as “View Case File Here”.
            </p>
          </div>

          <div>
            <label className={labelCls}>Synopsis</label>
            <textarea
              data-testid="case-synopsis-input"
              className={fieldCls + " min-h-[90px] resize-y"}
              value={form.synopsis}
              onChange={(e) => set("synopsis", e.target.value)}
              placeholder="Brief summary of the investigation…"
            />
          </div>

          {mode === "create" && (
            <div className="flex items-start gap-2 rounded-md border border-[#3a2f12] bg-[#241d0e] px-3 py-2 text-xs text-[#e2c878]">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              New case files are logged as <b>Pending Review</b> and become active once approved by an administrator.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            data-testid="case-form-cancel"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-[#1c3557] px-4 py-2 text-sm text-[#a8b6c9] hover:bg-[#122642] transition-colors"
          >
            Cancel
          </button>
          <button
            data-testid="case-form-submit"
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-[#d4b25a] hover:bg-[#f0d67a] disabled:opacity-60 text-[#0a1524] font-display font-600 uppercase tracking-wider text-sm px-5 py-2 transition-colors"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {mode === "edit" ? "Save Changes" : "Create Case"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

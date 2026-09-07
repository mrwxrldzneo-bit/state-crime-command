import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  StatusBadge,
  PriorityDot,
  formatDateTime,
} from "@/lib/caseMeta";

import api, {
  formatApiError,
} from "@/lib/api";

import { toast } from "sonner";

import {
  ExternalLink,
  Folder,
  User,
  Users,
  Clock,
  CalendarPlus,
  FileText,
  ShieldCheck,
  Send,
  Loader2,
  History,
  Cog,
} from "lucide-react";

function Row({
  icon: Icon,
  label,
  children,
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[#132842] last:border-0">
      <Icon className="h-4 w-4 text-[#d4b25a] mt-0.5 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-[#8ba0bd]">
          {label}
        </div>

        <div className="text-sm text-[#e7edf6] mt-0.5 break-words">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function CaseDetailDialog({
  open,
  onOpenChange,
  caseData,
  onSaved,
}) {
  const [data, setData] =
    useState(caseData);

  const [note, setNote] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  useEffect(() => {
    setData(caseData);
    setNote("");
  }, [caseData]);

  if (!data) {
    return null;
  }

  const caseId =
    data.id ||
    data.case_id ||
    data._id;

  const addNote = async () => {
    if (
      saving ||
      !note.trim()
    ) {
      return;
    }

    if (!caseId) {
      toast.error(
        "This case does not contain a valid case ID."
      );
      return;
    }

    setSaving(true);

    try {
      const response =
        await api.post(
          `/cases/${caseId}/notes`,
          {
            note: note.trim(),
          }
        );

      const updated =
        response?.data;

      if (updated) {
        setData(updated);
      } else {
        setData((current) => ({
          ...current,
          notes: [
            ...(current?.notes || []),
            {
              id: `local-${Date.now()}`,
              note: note.trim(),
              author:
                current?.created_by ||
                "Operator",
              created_at:
                new Date().toISOString(),
              kind: "user",
            },
          ],
        }));
      }

      setNote("");

      if (
        typeof onSaved ===
        "function"
      ) {
        await onSaved();
      }

      toast.success(
        "Update note added to case file."
      );
    } catch (error) {
      console.error(
        "Failed to add case note:",
        error
      );

      toast.error(
        formatApiError(
          error?.response?.data?.detail
        ) ||
          error?.response?.data?.message ||
          "Could not add note."
      );
    } finally {
      setSaving(false);
    }
  };

  const timeline = [
    ...(data.notes || []),
  ].sort(
    (a, b) =>
      new Date(
        b.created_at
      ) -
      new Date(
        a.created_at
      )
  );

  return (
    <Dialog
      open={open}
      onOpenChange={
        saving
          ? undefined
          : onOpenChange
      }
    >
      <DialogContent
        data-testid="case-detail-dialog"
        className="scc-panel border-[#1c3557] text-[#e7edf6] max-w-xl max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <div>
              <div className="font-mono-scc text-xs text-[#d4b25a]">
                {data.case_id ||
                  data.id ||
                  data._id ||
                  "N/A"}
              </div>

              <DialogTitle className="font-display uppercase tracking-wide text-[#f0d67a] text-xl mt-1">
                {data.name ||
                  data.case_name ||
                  "Untitled Case"}
              </DialogTitle>
            </div>

            <div className="flex flex-col items-end gap-2">
              <StatusBadge
                status={
                  data.status ||
                  "pending"
                }
              />

              <PriorityDot
                priority={
                  data.priority ||
                  "routine"
                }
                withLabel
              />
            </div>
          </div>
        </DialogHeader>

        <div className="mt-1">
          <Row
            icon={Users}
            label="Division Involved"
          >
            {data.division ||
              "—"}
          </Row>

          <Row
            icon={User}
            label="Lead Investigator"
          >
            {data.lead_investigator ||
              data.investigator ||
              "Unassigned"}
          </Row>

          <Row
            icon={Folder}
            label="Logged By"
          >
            {data.created_by ||
              "Unknown"}
          </Row>

          <Row
            icon={CalendarPlus}
            label="Date Logged"
          >
            {data.created_at
              ? formatDateTime(
                  data.created_at
                )
              : "—"}
          </Row>

          <Row
            icon={Clock}
            label="Last Updated"
          >
            {data.updated_at
              ? formatDateTime(
                  data.updated_at
                )
              : "—"}
          </Row>

          <Row
            icon={FileText}
            label="Synopsis"
          >
            {data.synopsis ? (
              data.synopsis
            ) : (
              <span className="text-[#556a86]">
                No synopsis recorded.
              </span>
            )}
          </Row>
        </div>

        <div
          data-testid="case-signoff"
          className={`mt-4 rounded-lg border px-4 py-3 flex items-center gap-3 ${
            data.approved_by
              ? "border-[#1e4d33] bg-[#0f2e1e]"
              : "border-[#3a2f12] bg-[#241d0e]"
          }`}
        >
          <ShieldCheck
            className={`h-5 w-5 shrink-0 ${
              data.approved_by
                ? "text-[#79e0a4]"
                : "text-[#d4b25a]"
            }`}
          />

          <div className="text-sm">
            {data.approved_by ? (
              <>
                <span className="text-[#79e0a4] font-600">
                  Approved
                </span>

                <span className="text-[#c3cede]">
                  {" "}
                  by{" "}
                  {data.approved_by}
                  {" · "}
                  {data.approved_at
                    ? formatDateTime(
                        data.approved_at
                      )
                    : "—"}
                </span>
              </>
            ) : (
              <span className="text-[#e2c878]">
                Awaiting administrator approval.
              </span>
            )}
          </div>
        </div>

        <div className="mt-4">
          {data.discord_url ? (
            <a
              data-testid="case-discord-link"
              href={
                data.discord_url
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-[#d4b25a]/50 bg-[#241d0e] hover:bg-[#2e2611] px-4 py-2.5 text-sm font-600 text-[#f0d67a] transition-colors w-full justify-center"
            >
              <ExternalLink className="h-4 w-4" />
              View Case File Here
            </a>
          ) : (
            <p className="text-center text-xs text-[#556a86]">
              No Discord case file linked.
            </p>
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-[#1c3557]">
          <div className="flex items-center gap-2 mb-3">
            <History className="h-4 w-4 text-[#d4b25a]" />

            <h3 className="font-display uppercase tracking-wider text-sm text-[#e7edf6]">
              Case Timeline
            </h3>
          </div>

          <div className="flex gap-2 mb-4">
            <input
              data-testid="add-note-input"
              value={note}
              onChange={(event) =>
                setNote(
                  event.target.value
                )
              }
              onKeyDown={(event) => {
                if (
                  event.key ===
                  "Enter"
                ) {
                  event.preventDefault();
                  addNote();
                }
              }}
              placeholder="Add a dated update note…"
              disabled={saving}
              className="flex-1 rounded-md bg-[#081222] border border-[#1c3557] px-3 py-2 text-sm text-[#e7edf6] placeholder:text-[#556a86] focus:outline-none focus:border-[#d4b25a]/70 focus:ring-1 focus:ring-[#d4b25a]/40 transition-colors disabled:opacity-50"
            />

            <button
              type="button"
              data-testid="add-note-button"
              onClick={addNote}
              disabled={
                saving ||
                !note.trim()
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-[#d4b25a] hover:bg-[#f0d67a] disabled:opacity-50 text-[#0a1524] font-600 text-sm px-3.5 py-2 transition-colors"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}

              Log
            </button>
          </div>

          <ol
            className="relative border-l border-[#1c3557] ml-1.5 space-y-4"
            data-testid="timeline-list"
          >
            {timeline.length ===
              0 && (
              <li className="ml-4 text-xs text-[#556a86]">
                No entries yet.
              </li>
            )}

            {timeline.map((entry) => (
              <li
                key={
                  entry.id ||
                  `${entry.created_at}-${entry.note}`
                }
                className="ml-4"
              >
                <span
                  className={`absolute -left-[6px] mt-1 h-3 w-3 rounded-full border-2 border-[#0a1524] ${
                    entry.kind ===
                    "system"
                      ? "bg-[#d4b25a]"
                      : "bg-[#3fae6b]"
                  }`}
                />

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono-scc text-[#8ba0bd]">
                    {entry.created_at
                      ? formatDateTime(
                          entry.created_at
                        )
                      : "—"}
                  </span>

                  <span className="text-[10px] uppercase tracking-wider text-[#6f849f]">
                    ·{" "}
                    {entry.author ||
                      "Operator"}
                  </span>

                  {entry.kind ===
                    "system" && (
                    <Cog className="h-3 w-3 text-[#d4b25a]" />
                  )}
                </div>

                <p className="text-sm text-[#d7e0ec] mt-0.5">
                  {entry.note}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}
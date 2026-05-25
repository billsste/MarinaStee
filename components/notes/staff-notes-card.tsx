"use client";

import * as React from "react";
import { Pin, PinOff, StickyNote, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateSheet, Field, Textarea } from "@/components/create-sheet";
import {
  addStaffNote,
  deleteStaffNote,
  nextStaffNoteId,
  toggleStaffNotePin,
  useStaffNotesForBoater,
} from "@/lib/client-store";
import { USERS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/*
 * Internal staff notes attached to a boater. STAFF ONLY — never appears in
 * the boater portal. Pin to keep at the top; pinned notes get a primary
 * accent so they're visually distinct.
 *
 * Default author = the first manager in USERS. In production this would be
 * the logged-in staff user.
 */
export function StaffNotesCard({ boaterId }: { boaterId: string }) {
  const notes = useStaffNotesForBoater(boaterId);
  const [addOpen, setAddOpen] = React.useState(false);

  // Pinned first, then newest-first within each group
  const sorted = notes.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.created_at < b.created_at ? 1 : -1;
  });

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <StickyNote className="size-3.5" />
          Staff notes
          {notes.length > 0 && <Badge tone="neutral" size="sm">{notes.length}</Badge>}
          <span className="text-[10px] font-normal uppercase tracking-wide text-fg-tertiary">
            Internal
          </span>
        </h3>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          + Add note
        </Button>
      </div>

      <div className="space-y-2 p-3">
        {sorted.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
            No internal notes. Pin important context (payment quirks, preferences, etc.) here so the whole team stays aligned.
          </div>
        ) : (
          sorted.map((n) => {
            const author = USERS.find((u) => u.id === n.author_user_id);
            return (
              <div
                key={n.id}
                className={cn(
                  "group rounded-[10px] border px-3 py-2.5 transition-colors",
                  n.pinned
                    ? "border-primary/30 bg-primary-soft/30"
                    : "border-hairline bg-surface-2"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] leading-5 text-fg">{n.body}</p>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => toggleStaffNotePin(n.id)}
                      className="rounded-md p-1 text-fg-subtle hover:bg-surface-3 hover:text-fg"
                      title={n.pinned ? "Unpin" : "Pin"}
                    >
                      {n.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Delete this note?")) deleteStaffNote(n.id);
                      }}
                      className="rounded-md p-1 text-fg-subtle hover:bg-surface-3 hover:text-status-danger"
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-fg-tertiary">
                  <span>{author?.name ?? "—"}</span>
                  <span>·</span>
                  <span>{new Date(n.created_at).toLocaleDateString()}</span>
                  {n.pinned && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5 text-primary">
                        <Pin className="size-2.5" /> pinned
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <AddNoteSheet open={addOpen} onOpenChange={setAddOpen} boaterId={boaterId} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AddNoteSheet({
  open,
  onOpenChange,
  boaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  boaterId: string;
}) {
  const [body, setBody] = React.useState("");
  const [pinned, setPinned] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setBody("");
      setPinned(false);
    }
  }, [open]);

  const canSubmit = body.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    // Default author = first manager in USERS for the demo. Production
    // would use the logged-in staff user.
    const author = USERS.find((u) => u.role === "manager") ?? USERS[0];
    addStaffNote({
      id: nextStaffNoteId(),
      boater_id: boaterId,
      body: body.trim(),
      author_user_id: author.id,
      created_at: new Date().toISOString(),
      pinned,
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add internal note"
      description="Visible to marina staff only. Never sent to the boater or surfaced in the portal."
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Add note
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Note" required>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Anything the team should know — payment quirks, preferences, conversations, follow-ups…"
            rows={5}
            autoFocus
          />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-fg">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="size-3.5"
          />
          Pin to top of profile
        </label>
      </div>
    </CreateSheet>
  );
}

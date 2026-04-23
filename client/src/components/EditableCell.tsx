import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { markEditing } from "@/lib/realtime";

export type EditableType = "text" | "number" | "select" | "textarea";

export interface EditableCellProps {
  rowId: string;
  field: string; // server field name (used for editing tracker only)
  value: any;
  type: EditableType;
  options?: string[]; // for select
  allowFreeEntry?: boolean; // allow "other" freeform for selects
  display?: (v: any) => React.ReactNode;
  numberStep?: string;
  numberMin?: number;
  integer?: boolean;
  align?: "left" | "right";
  className?: string;
  placeholder?: string;
  /**
   * Save handler. Should perform the PATCH and update caches.
   * Must resolve on success and reject (throw) on failure so we can show errors.
   */
  onSave: (newValue: any) => Promise<void>;
  /** Optional ref-like callback, so the page can build a focus grid. */
  registerInput?: (el: HTMLElement | null) => void;
  /** Focus-step hooks for Tab/Arrow navigation. */
  onFocusNext?: () => void;
  onFocusPrev?: () => void;
  onFocusUp?: () => void;
  onFocusDown?: () => void;
}

export function EditableCell(props: EditableCellProps) {
  const {
    rowId,
    field,
    value,
    type,
    options = [],
    allowFreeEntry,
    display,
    numberStep = "0.01",
    numberMin,
    integer,
    align = "left",
    className,
    placeholder,
    onSave,
    registerInput,
    onFocusNext,
    onFocusPrev,
    onFocusUp,
    onFocusDown,
  } = props;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>(value ?? "");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const inFlight = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Keep draft in sync when not editing
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  // Mark editing for realtime merge logic
  useEffect(() => {
    markEditing(rowId, field, editing);
    return () => markEditing(rowId, field, false);
  }, [editing, rowId, field]);

  // Expose trigger for keyboard navigation
  useEffect(() => {
    registerInput?.(triggerRef.current);
    return () => registerInput?.(null);
  }, [registerInput]);

  const beginEdit = () => {
    if (saving) return;
    setDraft(value ?? (type === "number" ? 0 : ""));
    setEditing(true);
    setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        if ("select" in el) {
          try { (el as HTMLInputElement).select(); } catch {}
        }
      }
    }, 0);
  };

  const commit = async (raw: any) => {
    if (inFlight.current) return;
    let next: any = raw;
    if (type === "number") {
      if (next === "" || next == null) {
        next = null;
      } else {
        const n = Number(next);
        if (Number.isNaN(n)) {
          setEditing(false);
          return;
        }
        next = integer ? Math.round(n) : Math.round(n * 100) / 100;
        if (numberMin != null && next < numberMin) next = numberMin;
      }
    } else if (type === "text" || type === "textarea") {
      next = typeof next === "string" ? next : "";
    }

    // Avoid saving if unchanged
    const unchanged =
      (value ?? null) === (next ?? null) ||
      (typeof value === "number" && typeof next === "number" && value === next);
    if (unchanged) {
      setEditing(false);
      return;
    }

    inFlight.current = true;
    setSaving(true);
    try {
      await onSave(next);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      setEditing(false);
    } catch (err) {
      // Let the parent's toast handle the message; revert draft locally.
      setDraft(value ?? "");
      setEditing(false);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value ?? "");
    setEditing(false);
  };

  // Display rendering
  const rendered =
    display != null ? display(value) : value === null || value === undefined || value === "" ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      String(value)
    );

  const commonTrigger = (
    <button
      ref={triggerRef}
      type="button"
      tabIndex={0}
      data-editable-cell={`${rowId}:${field}`}
      onClick={(e) => {
        e.stopPropagation();
        beginEdit();
      }}
      onFocus={() => {
        // focused but not yet editing; Enter/space will open
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          beginEdit();
        } else if (e.key === "Tab") {
          // let the browser handle it
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          onFocusDown?.();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          onFocusUp?.();
        }
      }}
      className={cn(
        "group/cell inline-flex items-center gap-1 w-full rounded px-1.5 py-0.5 text-left cursor-text",
        "hover:bg-accent/60 focus:bg-accent/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        align === "right" && "justify-end text-right tnum",
        className
      )}
    >
      <span className={cn("truncate", align === "right" && "tnum")}>{rendered}</span>
      {saving ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
      ) : savedFlash ? (
        <Check className="h-3 w-3 text-emerald-500 shrink-0" />
      ) : (
        <Pencil className="h-3 w-3 opacity-0 group-hover/cell:opacity-50 transition-opacity shrink-0" />
      )}
    </button>
  );

  // ====== Editing modes ======
  if (!editing) return commonTrigger;

  if (type === "textarea") {
    return (
      <Popover open onOpenChange={(o) => { if (!o) commit(draft); }}>
        <PopoverTrigger asChild>{commonTrigger}</PopoverTrigger>
        <PopoverContent
          className="w-[360px] p-2"
          align="start"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Textarea
            ref={(el) => { inputRef.current = el; }}
            value={draft ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit(draft);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            rows={5}
            placeholder={placeholder}
            disabled={saving}
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={() => commit(draft)} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  if (type === "select") {
    const current = draft == null ? "" : String(draft);
    const hasCustom = current && !options.includes(current);
    return (
      <Select
        open
        value={current}
        onValueChange={(v) => {
          if (v === "__custom__") {
            // switch to text-input mode inline
            const t = window.prompt("Enter custom value", current) ?? current;
            commit(t);
          } else {
            commit(v);
          }
        }}
        onOpenChange={(o) => { if (!o) setEditing(false); }}
      >
        <SelectTrigger
          className={cn("h-7 text-xs", align === "right" && "justify-end")}
          onClick={(e) => e.stopPropagation()}
        >
          <SelectValue placeholder={placeholder ?? "Select"} />
        </SelectTrigger>
        <SelectContent onClick={(e) => e.stopPropagation()}>
          {hasCustom && (
            <SelectItem value={current}>{current}</SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
          {allowFreeEntry && (
            <SelectItem value="__custom__">Custom…</SelectItem>
          )}
        </SelectContent>
      </Select>
    );
  }

  // text or number
  return (
    <input
      ref={(el) => { inputRef.current = el; }}
      type={type === "number" ? "number" : "text"}
      step={type === "number" ? numberStep : undefined}
      min={numberMin}
      value={draft ?? ""}
      placeholder={placeholder}
      onChange={(e) => setDraft(type === "number" ? e.target.value : e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(draft);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        } else if (e.key === "Tab") {
          // Save then let focus flow.
          e.preventDefault();
          (async () => {
            await commit(draft);
            if (e.shiftKey) onFocusPrev?.();
            else onFocusNext?.();
          })();
        } else if (e.key === "ArrowUp") {
          if (type === "number") return; // let input handle increment
          e.preventDefault();
          (async () => { await commit(draft); onFocusUp?.(); })();
        } else if (e.key === "ArrowDown") {
          if (type === "number") return;
          e.preventDefault();
          (async () => { await commit(draft); onFocusDown?.(); })();
        }
      }}
      disabled={saving}
      data-testid={`editable-input-${rowId}-${field}`}
      className={cn(
        "w-full h-7 rounded border border-input bg-background px-2 text-xs",
        "focus:outline-none focus:ring-1 focus:ring-ring",
        align === "right" && "text-right tnum",
        saving && "opacity-60"
      )}
    />
  );
}

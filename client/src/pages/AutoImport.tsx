import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import { RefreshCcw, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";

type AutoImportStatus = {
  enabled: boolean;
  url: string | null;
  intervalMin: number;
  lastRunAt: number | null;
  lastRunOk: boolean | null;
  lastRunMessage: string | null;
  lastInserted: number;
  lastUpdated: number;
  lastSkipped: number;
  nextRunAt: number | null;
};

export default function AutoImportPage() {
  const { toast } = useToast();
  const [urlDraft, setUrlDraft] = useState("");
  const [intervalDraft, setIntervalDraft] = useState(30);

  const statusQuery = useQuery<AutoImportStatus>({
    queryKey: ["/api/admin/auto-import"],
    refetchInterval: 10_000,
  });

  // Seed form drafts when status first loads.
  useEffect(() => {
    if (statusQuery.data) {
      if (urlDraft === "") setUrlDraft(statusQuery.data.url ?? "");
      if (intervalDraft === 30 && statusQuery.data.intervalMin !== 30) {
        setIntervalDraft(statusQuery.data.intervalMin);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data?.url, statusQuery.data?.intervalMin]);

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/auto-import/run", {});
      return res.json();
    },
    onSuccess: (data: AutoImportStatus) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/auto-import"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      if (data.lastRunOk) {
        toast({ title: "Import complete", description: data.lastRunMessage ?? "Done" });
      } else {
        toast({
          title: "Import failed",
          description: data.lastRunMessage ?? "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Run failed", description: err.message, variant: "destructive" });
    },
  });

  const configMutation = useMutation({
    mutationFn: async (patch: Partial<AutoImportStatus>) => {
      const res = await apiRequest("PATCH", "/api/admin/auto-import", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/auto-import"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const s = statusQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sync"
        title="Auto-import from Excel"
        description="Pull inventory from a Google Drive Excel file on a schedule. Existing items are updated by SKU; new items are added; everything else is left alone."
        actions={
          <Button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending || !s?.url}
            data-testid="button-run-now"
          >
            <RefreshCcw className={`h-4 w-4 mr-2 ${runMutation.isPending ? "animate-spin" : ""}`} />
            {runMutation.isPending ? "Running…" : "Run now"}
          </Button>
        }
      />

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="font-medium">Auto-import schedule</div>
                <div className="text-sm text-muted-foreground">
                  {s?.enabled
                    ? `Running every ${s.intervalMin} minutes`
                    : "Disabled"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!s?.enabled}
                onCheckedChange={(v) =>
                  configMutation.mutate({
                    enabled: v,
                    url: (urlDraft || s?.url) ?? null,
                  })
                }
                disabled={!urlDraft && !s?.url}
                data-testid="switch-enabled"
              />
              <Label className="text-sm">{s?.enabled ? "On" : "Off"}</Label>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="url">Excel share URL</Label>
            <Input
              id="url"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://drive.google.com/file/d/.../view"
              data-testid="input-url"
            />
            <div className="text-xs text-muted-foreground">
              In Google Drive: Share → "Anyone with the link can view", then paste the link here.
            </div>
          </div>

          <div className="grid gap-2 max-w-xs">
            <Label htmlFor="interval">Interval (minutes)</Label>
            <Input
              id="interval"
              type="number"
              min={5}
              max={1440}
              value={intervalDraft}
              onChange={(e) => setIntervalDraft(Number(e.target.value) || 30)}
              data-testid="input-interval"
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() =>
                configMutation.mutate({
                  url: urlDraft || null,
                  intervalMin: intervalDraft,
                })
              }
              disabled={configMutation.isPending}
              data-testid="button-save-settings"
            >
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-medium">Last run</div>
            {s?.lastRunOk === true && (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Success
              </Badge>
            )}
            {s?.lastRunOk === false && (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="h-3 w-3" /> Failed
              </Badge>
            )}
            {s?.lastRunOk === null && (
              <Badge variant="outline">Not run yet</Badge>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <Stat label="Inserted" value={s?.lastInserted ?? 0} />
            <Stat label="Updated" value={s?.lastUpdated ?? 0} />
            <Stat label="Skipped" value={s?.lastSkipped ?? 0} />
            <Stat
              label="Last run"
              value={s?.lastRunAt ? formatDateTime(s.lastRunAt) : "—"}
            />
          </div>
          {s?.lastRunMessage && (
            <div className="text-sm text-muted-foreground" data-testid="text-last-message">
              {s.lastRunMessage}
            </div>
          )}
          {s?.nextRunAt && s.enabled && (
            <div className="text-xs text-muted-foreground">
              Next run scheduled for {formatDateTime(s.nextRunAt)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-lg font-medium" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value}
      </div>
    </div>
  );
}

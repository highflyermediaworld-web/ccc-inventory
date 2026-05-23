import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { LiveStreamBanner } from "@/components/LiveStreamBanner";
import { Radio } from "lucide-react";

type LiveStatus = {
  isLive: boolean;
  platform: string;
  handle: string;
  url: string;
  title: string;
};

export default function AdminLive() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<LiveStatus>({
    queryKey: ["/api/live"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/live");
      return res.json();
    },
  });

  const [isLive, setIsLive] = useState(false);
  const [platform, setPlatform] = useState("tiktok");
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (data) {
      setIsLive(data.isLive);
      setPlatform(data.platform || "tiktok");
      setHandle(data.handle || "");
      setUrl(data.url || "");
      setTitle(data.title || "");
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<LiveStatus>) => {
      const res = await apiRequest("POST", "/api/live", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/live"] });
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: err?.message ?? "",
        variant: "destructive",
      });
    },
  });

  const handleToggle = (next: boolean) => {
    setIsLive(next);
    saveMutation.mutate({ isLive: next });
    toast({
      title: next ? "You\u2019re live" : "Live banner hidden",
      description: next
        ? "Customers will see the red banner on the shop home."
        : "Your shop is back to normal.",
    });
  };

  const handleSaveDetails = () => {
    saveMutation.mutate({ platform, handle: handle.trim(), url: url.trim(), title: title.trim() });
    toast({ title: "Saved", description: "Stream details updated." });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Live"
        title="Live stream"
        description="Pop a live-pulls banner on the customer shop the moment you go live."
      />

      {!isLoading && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" /> Go live
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between rounded-lg border bg-card p-4">
              <div>
                <div className="font-semibold">Live banner</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  When on, shows a red glowing banner on the public shop with a live-pulse dot
                  and a one-click watch button.
                </div>
              </div>
              <Switch
                checked={isLive}
                onCheckedChange={handleToggle}
                data-testid="switch-live-toggle"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="platform">Platform</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger id="platform" data-testid="select-live-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tiktok">TikTok</SelectItem>
                    <SelectItem value="twitch">Twitch</SelectItem>
                    <SelectItem value="youtube">YouTube</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="handle">Channel handle</Label>
                <Input
                  id="handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="cpulls.cards"
                  data-testid="input-live-handle"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="url">Stream URL (optional)</Label>
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.tiktok.com/@cpulls.cards/live"
                  data-testid="input-live-url"
                />
                <p className="text-[11px] text-muted-foreground">
                  Twitch & YouTube embed directly in the banner. TikTok opens in a new tab when
                  customers tap Open.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="title">Stream title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Live pulls \u2014 come hang out"
                  data-testid="input-live-title"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSaveDetails}
                disabled={saveMutation.isPending}
                data-testid="button-save-live"
              >
                Save details
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            This is what customers see on the shop home right now.
          </p>
          <LiveStreamBanner />
        </CardContent>
      </Card>
    </div>
  );
}

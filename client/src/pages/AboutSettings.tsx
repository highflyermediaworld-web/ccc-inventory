import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { resolveUploadUrl } from "@/lib/uploads";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ABOUT_LIMITS, DEFAULT_ABOUT, mergeAbout, type AboutContent } from "@shared/storefront";
import { ExternalLink, Save, RotateCcw, ImageUp, Trash2, Plus, ArrowUp, ArrowDown, MapPin, Radio, Award, Truck, ShieldCheck, HandCoins } from "lucide-react";

type AboutResponse = { source: "default" | "settings"; about: AboutContent };

const FACT_ICONS = [MapPin, Radio, Award, Truck];
const VALUE_ICONS = [ShieldCheck, Award, HandCoins];

/** Downscale to ≤1600px JPEG client-side so the upload stays small and fast. */
async function shrinkImage(file: File): Promise<{ base64: string; mediaType: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't read that image"));
      i.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    const keepPng = file.type === "image/png" && file.size < 1_500_000;
    const mediaType = keepPng ? "image/png" : "image/jpeg";
    const base64 = canvas.toDataURL(mediaType, 0.88);
    return { base64, mediaType };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function AboutSettings() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<AboutResponse>({
    queryKey: ["/api/shop/about"],
    queryFn: async () => {
      const json = (await (await apiRequest("GET", "/api/shop/about")).json()) as AboutResponse;
      return { source: json.source, about: mergeAbout(json.about) };
    },
  });

  const [form, setForm] = useState<AboutContent>(DEFAULT_ABOUT);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data || dirty) return;
    setForm(data.about);
  }, [data, dirty]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/shop/about"] });

  const save = useMutation({
    mutationFn: async (about: AboutContent) => (await apiRequest("PUT", "/api/admin/shop/about", { about })).json(),
    onSuccess: () => {
      toast({ title: "About page published", description: "Customers see the new copy now." });
      setDirty(false);
      invalidate();
    },
    onError: (err: any) => toast({ title: "Couldn't publish", description: cleanErr(err), variant: "destructive" }),
  });
  const reset = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/admin/shop/about"),
    onSuccess: () => {
      toast({ title: "Back to the built-in copy" });
      setDirty(false);
      invalidate();
    },
    onError: (err: any) => toast({ title: "Couldn't reset", description: cleanErr(err), variant: "destructive" }),
  });

  function patch(p: Partial<AboutContent>) {
    setForm((f) => ({ ...f, ...p }));
    setDirty(true);
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Pick an image file", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const { base64, mediaType } = await shrinkImage(file);
      const res = await (await apiRequest("POST", "/api/admin/shop/about/photo", { imageBase64: base64, mediaType })).json();
      patch({ photoUrl: res.url });
      toast({ title: "Photo uploaded", description: "Hit Publish to put it on the page." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: cleanErr(err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const titleBad = !form.title.trim();
  const photo = resolveUploadUrl(form.photoUrl);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Storefront"
        title="About page"
        description="The story, photo and quick facts customers read at #/about. Changes publish instantly."
        actions={
          <div className="flex flex-wrap gap-2">
            <a href="#/about" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" data-testid="button-open-about"><ExternalLink className="size-4 mr-2" /> Open About page</Button>
            </a>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !dirty || titleBad || uploading} data-testid="button-save-about">
              <Save className="size-4 mr-2" /> {save.isPending ? "Publishing…" : "Publish"}
            </Button>
          </div>
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Hero</CardTitle>
              <p className="text-sm text-muted-foreground">Top band of the page. Wrap one phrase in *asterisks* to color it gold.</p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Small label above the headline"><Input value={form.kicker} onChange={(e) => patch({ kicker: e.target.value })} maxLength={60} data-testid="input-about-kicker" /></Field>
              <Field label="Headline" hint={titleBad ? "Required" : undefined}><Input value={form.title} onChange={(e) => patch({ title: e.target.value })} maxLength={140} className={titleBad ? "border-destructive" : ""} data-testid="input-about-title" /></Field>
              <Field label="Intro"><Textarea value={form.intro} onChange={(e) => patch({ intro: e.target.value })} rows={3} maxLength={600} data-testid="input-about-intro" /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-lg">Story</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">One box per paragraph. **double asterisks** make text bold.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => patch({ story: [...form.story, ""] })} disabled={form.story.length >= ABOUT_LIMITS.story} data-testid="button-add-paragraph"><Plus className="size-4 mr-1.5" /> Paragraph</Button>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Heading"><Input value={form.storyHeading} onChange={(e) => patch({ storyHeading: e.target.value })} maxLength={80} data-testid="input-about-story-heading" /></Field>
              {form.story.map((p, i) => (
                <div key={i} className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Paragraph {i + 1}</Label>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move up" disabled={i === 0} onClick={() => patch({ story: swap(form.story, i, i - 1) })}><ArrowUp className="size-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move down" disabled={i === form.story.length - 1} onClick={() => patch({ story: swap(form.story, i, i + 1) })}><ArrowDown className="size-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="Remove paragraph" onClick={() => patch({ story: form.story.filter((_, idx) => idx !== i) })} data-testid={`button-remove-paragraph-${i}`}><Trash2 className="size-3.5" /></Button>
                    </div>
                  </div>
                  <Textarea value={p} onChange={(e) => patch({ story: form.story.map((x, idx) => (idx === i ? e.target.value : x)) })} rows={4} maxLength={1200} data-testid={`input-about-story-${i}`} />
                </div>
              ))}
              {form.story.length === 0 && <p className="text-sm text-muted-foreground">No paragraphs yet — add one above.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Quick facts</CardTitle>
              <p className="text-sm text-muted-foreground">Up to {ABOUT_LIMITS.facts} short facts beside the story. Leave a row blank to hide it.</p>
            </CardHeader>
            <CardContent className="grid gap-3">
              {Array.from({ length: ABOUT_LIMITS.facts }).map((_, i) => {
                const f = form.facts[i] ?? { title: "", sub: "" };
                const Icon = FACT_ICONS[i];
                return (
                  <div key={i} className="grid gap-2 sm:grid-cols-[28px_1fr_1.4fr] sm:items-center">
                    <Icon className="size-4 text-gold hidden sm:block" aria-hidden />
                    <Input value={f.title} onChange={(e) => patch({ facts: setAt(form.facts, i, { ...f, title: e.target.value }, ABOUT_LIMITS.facts) })} placeholder="Title" maxLength={60} data-testid={`input-about-fact-title-${i}`} />
                    <Input value={f.sub} onChange={(e) => patch({ facts: setAt(form.facts, i, { ...f, sub: e.target.value }, ABOUT_LIMITS.facts) })} placeholder="One-line detail" maxLength={120} />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Values</CardTitle>
              <p className="text-sm text-muted-foreground">Three cards under the story. Leave one blank to hide it.</p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Section heading"><Input value={form.valuesHeading} onChange={(e) => patch({ valuesHeading: e.target.value })} maxLength={80} /></Field>
              <div className="grid gap-3 md:grid-cols-3">
                {Array.from({ length: ABOUT_LIMITS.values }).map((_, i) => {
                  const v = form.values[i] ?? { title: "", body: "" };
                  const Icon = VALUE_ICONS[i];
                  return (
                    <div key={i} className="grid gap-2 rounded-md border border-border p-3">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground"><Icon className="size-3.5 text-gold" aria-hidden /> Card {i + 1}</div>
                      <Input value={v.title} onChange={(e) => patch({ values: setAt(form.values, i, { ...v, title: e.target.value }, ABOUT_LIMITS.values) })} placeholder="Title" maxLength={60} data-testid={`input-about-value-title-${i}`} />
                      <Textarea value={v.body} onChange={(e) => patch({ values: setAt(form.values, i, { ...v, body: e.target.value }, ABOUT_LIMITS.values) })} placeholder="One or two sentences" rows={3} maxLength={300} />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-lg">Closing call-out</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Heading"><Input value={form.ctaHeading} onChange={(e) => patch({ ctaHeading: e.target.value })} maxLength={80} /></Field>
              <Field label="Line under it"><Textarea value={form.ctaBody} onChange={(e) => patch({ ctaBody: e.target.value })} rows={2} maxLength={300} /></Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Photo</CardTitle>
              <p className="text-sm text-muted-foreground">Shows beside the story at a 4:5 crop. Portrait shots work best.</p>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="aspect-[4/5] w-full overflow-hidden rounded-md border border-border bg-muted flex items-center justify-center" data-testid="about-photo-preview">
                {photo ? (
                  <img src={photo} alt={form.photoAlt || "About photo"} className="h-full w-full object-cover" />
                ) : (
                  <div className="text-center text-sm text-muted-foreground px-4">
                    <ImageUp className="size-7 mx-auto mb-2 text-gold" aria-hidden />
                    No photo yet. Quick facts fill this spot until you add one.
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onPickPhoto(e.target.files?.[0])} data-testid="input-about-photo" />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="button-upload-photo">
                  <ImageUp className="size-4 mr-2" /> {uploading ? "Uploading…" : photo ? "Replace photo" : "Upload photo"}
                </Button>
                {photo && (
                  <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => patch({ photoUrl: null })} data-testid="button-remove-photo">
                    <Trash2 className="size-4 mr-2" /> Remove
                  </Button>
                )}
              </div>
              <Field label="Describe the photo (for screen readers)"><Input value={form.photoAlt} onChange={(e) => patch({ photoAlt: e.target.value })} maxLength={160} placeholder="Chris at the Chris Collects Co table" /></Field>
              <Field label="Caption (optional)"><Input value={form.photoCaption} onChange={(e) => patch({ photoCaption: e.target.value })} maxLength={160} placeholder="East Bay Card Show, 2026" /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Status</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <div className="flex justify-between"><span>Source</span><b className="text-foreground" data-testid="text-about-source">{data?.source === "settings" ? "Published from here" : "Built-in copy"}</b></div>
              <div className="flex justify-between"><span>Unsaved edits</span><b className="text-foreground">{dirty ? "Yes" : "No"}</b></div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => reset.mutate()} disabled={reset.isPending || data?.source !== "settings"} title="Discard the published copy and show the built-in one" data-testid="button-reset-about">
                <RotateCcw className="size-4 mr-1.5" /> Use built-in copy
              </Button>
              <p className="text-xs">The shop assistant chat also reads this story when it answers customers.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {hint && <span className="text-xs text-destructive">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

function setAt<T extends object>(arr: T[], i: number, value: T, max: number): T[] {
  const copy = [...arr];
  // Fill any gap with blank rows so the index lines up with the form slots.
  const blank = Object.fromEntries(Object.keys(value).map((k) => [k, ""])) as T;
  while (copy.length <= i && copy.length < max) copy.push({ ...blank });
  copy[i] = value;
  return copy.slice(0, max);
}

function cleanErr(err: any): string {
  const msg = (err?.message ?? "").replace(/^\d+:\s*/, "");
  try { return JSON.parse(msg).message ?? msg; } catch { return msg || "Try again"; }
}

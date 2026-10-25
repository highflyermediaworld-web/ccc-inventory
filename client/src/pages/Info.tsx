import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { resolveUploadUrl } from "@/lib/uploads";
import { ShopChat } from "@/components/ShopChat";
import { FAQ_GROUPS as FAQ_DATA, GAMES, CASH_PCT, TRADE_PCT, DEFAULT_ABOUT, mergeAbout, plainText, type AboutContent } from "@shared/storefront";
import {
  ArrowRight,
  Award,
  Camera,
  HandCoins,
  MapPin,
  Radio,
  ShieldCheck,
  Truck,
  Clock,
  ChevronDown,
} from "lucide-react";
import { SiTiktok, SiInstagram } from "react-icons/si";
import { BRAND_HANDLE, TIKTOK_URL, INSTAGRAM_URL } from "@/components/SocialLinks";
import "../shop.css";

/* ------------------------------------------------------------------ */
/*  Shared shell: compact storefront header + footer                   */
/* ------------------------------------------------------------------ */

const LINKS: Array<{ label: string; href: string; testId: string }> = [
  { label: "Shop", href: "#/", testId: "info-nav-shop" },
  { label: "FAQ", href: "#/faq", testId: "info-nav-faq" },
  { label: "About", href: "#/about", testId: "info-nav-about" },
];

function InfoShell({ title, kicker, intro, children, current }: { title: ReactNode; kicker: string; intro: string; children: ReactNode; current: "faq" | "about" }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${current === "faq" ? "FAQ" : "About"} · Chris Collects Co`;
    window.scrollTo({ top: 0 });
    return () => { document.title = prev; };
  }, [current]);

  return (
    <div className="pc min-h-screen flex flex-col">
      <header className="pc-header sticky top-0 z-40">
        <div className="hidden md:block border-b border-white/10">
          <div className="pc-container h-9 flex items-center justify-between text-[13px] text-white/80">
            <div className="flex items-center gap-5">
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> California · Ships nationwide</span>
              <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Orders ship within 48 hours</span>
            </div>
            <div className="flex items-center gap-1">
              <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" aria-label={`${BRAND_HANDLE} on TikTok`} className="pc-icon-btn !h-8 !w-8"><SiTiktok className="h-3.5 w-3.5" /></a>
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label={`${BRAND_HANDLE} on Instagram`} className="pc-icon-btn !h-8 !w-8"><SiInstagram className="h-3.5 w-3.5" /></a>
            </div>
          </div>
        </div>
        <div className="pc-container h-[72px] flex items-center justify-between gap-3">
          <a href="#/" className="flex items-center gap-3 shrink-0" aria-label="Chris Collects Co home">
            <img src="/logo-96.png" alt="" width={44} height={44} className="h-11 w-11 rounded-lg object-cover ring-1 ring-white/15" />
            <span className="pc-wordmark">Chris Collects<small>Co</small></span>
          </a>
          <nav className="pc-nav flex items-center gap-0 sm:gap-0.5" aria-label="Site">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} aria-current={l.href === `#/${current}` ? "page" : undefined} className={l.href === `#/${current}` ? "is-current" : undefined} data-testid={l.testId}>
                {l.label}
              </a>
            ))}
          </nav>
          <a href="#/" className="pc-btn pc-btn-sm pc-btn-red !hidden sm:!inline-flex" data-testid="info-button-shop">
            Shop the vault <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </header>

      <section className="pc-dark pc-info-hero">
        <div className="pc-container py-12 md:py-16">
          <span className="pc-kicker">{kicker}</span>
          <h1 className="pc-info-title mt-2">{title}</h1>
          <p className="pc-info-intro mt-4">{intro}</p>
        </div>
      </section>

      <main className="flex-1 pc-paper-bg">{children}</main>

      <footer className="pc-dark pc-footer">
        <div className="pc-container py-10 grid gap-8 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <img src="/logo-96.png" alt="" width={44} height={44} className="h-11 w-11 rounded-lg object-cover ring-1 ring-white/15" />
              <span className="pc-wordmark">Chris Collects<small>Co</small></span>
            </div>
            <p className="mt-4 text-sm text-white/70 pc-body leading-relaxed max-w-sm">
              A collector-run trading card shop. Pokémon, One Piece, Magic and more — bought, sold and traded directly with Chris.
            </p>
            <div className="mt-5 flex gap-2">
              <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" aria-label="TikTok" className="pc-icon-btn bg-white/10"><SiTiktok className="h-4 w-4" /></a>
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="pc-icon-btn bg-white/10"><SiInstagram className="h-4 w-4" /></a>
            </div>
          </div>
          <div>
            <h3 className="text-lg mb-3">Explore</h3>
            <ul className="grid gap-2 text-sm pc-body">
              <li><a href="#/">Shop the vault</a></li>
              <li><a href="#/faq">FAQ</a></li>
              <li><a href="#/about">About Chris Collects Co</a></li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg mb-3">Store Information</h3>
            <ul className="grid gap-2.5 text-sm pc-body text-white/78">
              <li className="flex items-start gap-2"><MapPin className="h-4 w-4 mt-0.5 shrink-0" /> Based in California · Online orders ship nationwide</li>
              <li className="flex items-start gap-2"><Truck className="h-4 w-4 mt-0.5 shrink-0" /> Orders ship within 48 hours, tracked and insured on high-value cards</li>
              <li className="flex items-start gap-2"><SiInstagram className="h-4 w-4 mt-0.5 shrink-0" /> Questions: DM {BRAND_HANDLE} on Instagram or TikTok</li>
              <li className="flex items-start gap-2"><ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" /> 100% satisfaction guarantee on every order</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="pc-container py-4 text-xs text-white/60 pc-body">© {new Date().getFullYear()} Chris Collects Co · Curated by a collector</div>
        </div>
      </footer>
      <ShopChat />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Rich text: **bold**, [label](url), {handle}                        */
/* ------------------------------------------------------------------ */

export function Rich({ text }: { text: string }) {
  const src = text.replace(/\{handle\}/g, BRAND_HANDLE);
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) parts.push(src.slice(last, m.index));
    if (m[1] !== undefined) parts.push(<b key={k++}>{m[1]}</b>);
    else parts.push(<a key={k++} href={m[3]} target="_blank" rel="noopener noreferrer">{m[2]}</a>);
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push(src.slice(last));
  return <>{parts}</>;
}

/** Hero headline: one *phrase* in asterisks renders gold. */
function Headline({ text }: { text: string }) {
  const m = /^([^*]*)\*([^*]+)\*([\s\S]*)$/.exec(text);
  if (!m) return <>{text}</>;
  return <>{m[1]}<em>{m[2]}</em>{m[3]}</>;
}

/* ------------------------------------------------------------------ */
/*  FAQ                                                                */
/* ------------------------------------------------------------------ */

const FAQ_ICONS = { buying: ShieldCheck, shipping: Truck, selling: HandCoins, shows: Radio } as const;
const FAQ_GROUPS = FAQ_DATA.map((g) => ({ ...g, icon: FAQ_ICONS[g.id] }));

export function FaqPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_GROUPS.flatMap((g) => g.items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: plainText(f.a) } }))),
  };
  return (
    <InfoShell
      current="faq"
      kicker="Help center"
      title={<>Questions, <em>answered.</em></>}
      intro="Everything about buying, selling, trading and finding Chris Collects Co in person. Can't find it here? DM us and a real person answers."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="pc-container py-10 md:py-14 grid gap-10 lg:grid-cols-[220px_1fr]">
        <nav className="pc-faq-toc" aria-label="FAQ sections">
          <span className="pc-field-label">Jump to</span>
          <ul>
            {FAQ_GROUPS.map((g) => (
              <li key={g.id}><a href={`#/faq#${g.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`faq-${g.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} data-testid={`faq-toc-${g.id}`}>{g.title}</a></li>
            ))}
          </ul>
          <a href="#/" className="pc-btn pc-btn-sm pc-btn-red mt-5 w-full justify-center" data-testid="faq-cta-sell">Sell &amp; Trade</a>
        </nav>
        <div className="grid gap-10">
          {FAQ_GROUPS.map((g) => (
            <section key={g.id} id={`faq-${g.id}`} className="scroll-mt-[96px]" data-testid={`faq-group-${g.id}`}>
              <div className="pc-sec-title">
                <h2>{g.title}</h2>
              </div>
              <div className="pc-faq-list mt-5">
                {g.items.map((f, i) => (
                  <details key={f.q} className="pc-faq" open={i === 0 && g.id === "buying"} data-testid={`faq-item-${g.id}-${i}`}>
                    <summary>
                      <span>{f.q}</span>
                      <ChevronDown className="h-5 w-5 shrink-0" aria-hidden />
                    </summary>
                    <div className="pc-faq-answer pc-body"><Rich text={f.a} /></div>
                  </details>
                ))}
              </div>
            </section>
          ))}
          <section className="pc-info-callout" data-testid="faq-contact">
            <div>
              <h2>Still have a question?</h2>
              <p className="pc-body">DM {BRAND_HANDLE} — Chris reads every message, usually within the day.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-sm pc-btn-white"><SiInstagram className="h-4 w-4" /> Instagram</a>
              <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-sm pc-btn-ghost-dark"><SiTiktok className="h-4 w-4" /> TikTok</a>
            </div>
          </section>
        </div>
      </div>
    </InfoShell>
  );
}

/* ------------------------------------------------------------------ */
/*  About                                                              */
/* ------------------------------------------------------------------ */

const FACT_ICONS = [MapPin, Radio, Award, Truck];
const VALUE_ICONS = [ShieldCheck, Award, HandCoins];

type AboutResponse = { source: "default" | "settings"; about: AboutContent };

export function useAboutContent() {
  return useQuery<AboutResponse>({
    queryKey: ["/api/shop/about"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/shop/about`, { credentials: "omit" });
      if (!res.ok) throw new Error("about load failed");
      const json = (await res.json()) as AboutResponse;
      return { source: json.source, about: mergeAbout(json.about) };
    },
    staleTime: 60_000,
    placeholderData: { source: "default", about: DEFAULT_ABOUT },
  });
}

export function AboutPage() {
  const { data } = useAboutContent();
  const about = data?.about ?? DEFAULT_ABOUT;
  const photo = resolveUploadUrl(about.photoUrl);
  const facts = about.facts.filter((f) => f.title || f.sub);
  const values = about.values.filter((v) => v.title || v.body);
  const story = about.story.filter((p) => p.trim());

  return (
    <InfoShell
      current="about"
      kicker={about.kicker || "About Chris Collects Co"}
      title={<Headline text={about.title} />}
      intro={about.intro}
    >
      <div className="pc-container py-10 md:py-14 grid gap-12">
        <section className={"grid gap-8 lg:items-start " + (photo ? "lg:grid-cols-[1fr_minmax(300px,420px)]" : "lg:grid-cols-[1.1fr_1fr]")} data-testid="about-story">
          <div>
            {about.storyHeading && <div className="pc-sec-title"><h2>{about.storyHeading}</h2></div>}
            <div className="pc-info-prose pc-body mt-5">
              {story.map((p, i) => <p key={i}><Rich text={p} /></p>)}
            </div>
            {photo && facts.length > 0 && (
              <ul className="pc-info-facts mt-8" aria-label="Quick facts">
                {facts.map((f, i) => { const Icon = FACT_ICONS[i % FACT_ICONS.length]; return (
                  <li key={i}><Icon className="h-5 w-5" aria-hidden /><div><b>{f.title}</b><span>{f.sub}</span></div></li>
                ); })}
              </ul>
            )}
          </div>
          {photo ? (
            <figure className="pc-about-photo order-first lg:order-none" data-testid="about-photo">
              <img src={photo} alt={about.photoAlt || "Chris Collects Co"} loading="lazy" />
              {about.photoCaption && <figcaption className="pc-body">{about.photoCaption}</figcaption>}
            </figure>
          ) : facts.length > 0 ? (
            <ul className="pc-info-facts" aria-label="Quick facts">
              {facts.map((f, i) => { const Icon = FACT_ICONS[i % FACT_ICONS.length]; return (
                <li key={i}><Icon className="h-5 w-5" aria-hidden /><div><b>{f.title}</b><span>{f.sub}</span></div></li>
              ); })}
            </ul>
          ) : null}
        </section>

        {values.length > 0 && (
          <section data-testid="about-values">
            {about.valuesHeading && <div className="pc-sec-title"><h2>{about.valuesHeading}</h2></div>}
            <div className="grid gap-3 md:grid-cols-3 mt-5">
              {values.map((v, i) => { const Icon = VALUE_ICONS[i % VALUE_ICONS.length]; return (
                <div key={i} className="pc-info-card">
                  <div className="pc-info-card-icon"><Icon className="h-5 w-5" /></div>
                  <h3>{v.title}</h3>
                  <p className="pc-body">{v.body}</p>
                </div>
              ); })}
            </div>
          </section>
        )}

        <section className="grid gap-8 lg:grid-cols-2" data-testid="about-games">
          <div>
            <div className="pc-sec-title"><h2>What we carry</h2></div>
            <p className="pc-sec-sub">Singles, graded slabs and sealed product across the games we actually play and collect.</p>
            <ul className="pc-info-tags mt-5" aria-label="Games">
              {GAMES.map((g) => <li key={g}>{g}</li>)}
            </ul>
          </div>
          <div>
            <div className="pc-sec-title"><h2>Selling to us</h2></div>
            <p className="pc-sec-sub">Point your camera at a card and get the number in seconds.</p>
            <ol className="pc-info-steps mt-5">
              <li><Camera className="h-4 w-4" aria-hidden /><span><b>Scan or search</b> the card in the Sell &amp; Trade calculator on the shop page.</span></li>
              <li><Award className="h-4 w-4" aria-hidden /><span>See the <b>live TCGplayer market</b> and your <b>{CASH_PCT}% cash / {TRADE_PCT}% trade</b> offer instantly.</span></li>
              <li><HandCoins className="h-4 w-4" aria-hidden /><span><b>DM or bring it to a show.</b> Chris confirms condition in hand and pays out or credits your trade.</span></li>
            </ol>
          </div>
        </section>

        <section className="pc-info-callout" data-testid="about-cta">
          <div>
            <h2>{about.ctaHeading || "Come say hi"}</h2>
            <p className="pc-body">{about.ctaBody}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="#/" className="pc-btn pc-btn-sm pc-btn-white" data-testid="about-cta-shop">Shop the vault <ArrowRight className="h-4 w-4" /></a>
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-sm pc-btn-ghost-dark"><SiInstagram className="h-4 w-4" /> Follow {BRAND_HANDLE}</a>
          </div>
        </section>
      </div>
    </InfoShell>
  );
}

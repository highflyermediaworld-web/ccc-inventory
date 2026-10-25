import { useEffect, type ReactNode } from "react";
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

const CASH_PCT = 70;
const TRADE_PCT = 80;

const LINKS: Array<{ label: string; href: string; testId: string }> = [
  { label: "Shop", href: "#/", testId: "info-nav-shop" },
  { label: "FAQ", href: "#/faq", testId: "info-nav-faq" },
  { label: "About", href: "#/about", testId: "info-nav-about" },
];

function InfoShell({ title, kicker, intro, children, current }: { title: ReactNode; kicker: string; intro: string; children: ReactNode; current: "faq" | "about" }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${current === "faq" ? "FAQ" : "About"} · CPulls Cards`;
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
        <div className="pc-container h-[72px] flex items-center justify-between gap-4">
          <a href="#/" className="flex items-center gap-3 shrink-0" aria-label="CPulls Cards home">
            <img src="/logo.jpeg" alt="" width={44} height={44} className="h-11 w-11 rounded-lg object-cover ring-1 ring-white/15" />
            <span className="pc-wordmark">CPulls<small>Cards</small></span>
          </a>
          <nav className="pc-nav flex items-center gap-0.5" aria-label="Site">
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
              <img src="/logo.jpeg" alt="" width={44} height={44} className="h-11 w-11 rounded-lg object-cover ring-1 ring-white/15" />
              <span className="pc-wordmark">CPulls<small>Cards</small></span>
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
              <li><a href="#/about">About CPulls Cards</a></li>
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
          <div className="pc-container py-4 text-xs text-white/60 pc-body">© {new Date().getFullYear()} CPulls Cards · Curated by a collector</div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FAQ                                                                */
/* ------------------------------------------------------------------ */

type Faq = { q: string; a: ReactNode; plain: string };
type FaqGroup = { id: string; title: string; icon: typeof HandCoins; items: Faq[] };

const FAQ_GROUPS: FaqGroup[] = [
  {
    id: "buying",
    title: "Buying",
    icon: ShieldCheck,
    items: [
      {
        q: "How do I buy a card?",
        plain: "Find the card in the vault, tap Buy, and leave your name and how you'd like to be contacted. Chris confirms the card is still in hand and reaches out, usually within 24 hours, to arrange payment and shipping.",
        a: <>Find the card in the vault, tap <b>Buy</b>, and leave your name and how you'd like to be contacted. Chris confirms the card is still in hand and reaches out, usually within 24 hours, to arrange payment and shipping.</>,
      },
      {
        q: "Are the photos the actual cards?",
        plain: "Yes. What you see in the listing is the exact card that ships. Grades, edges and centering are inspected in hand before anything goes up.",
        a: <>Yes. What you see in the listing is the exact card that ships. Grades, edges and centering are inspected in hand before anything goes up.</>,
      },
      {
        q: "How are prices set?",
        plain: "Every listing shows the live TCGplayer market price next to our price, and it refreshes while you browse. Our asking price follows the market; if a card is priced under market you'll see it right on the card.",
        a: <>Every listing shows the live TCGplayer market price next to our price, and it refreshes while you browse. Our asking price follows the market; if a card is priced under market you'll see it right on the card.</>,
      },
      {
        q: "What do the condition labels mean?",
        plain: "NM is Near Mint (pack-fresh or close), LP is Lightly Played (minor edge or surface wear), MP is Moderately Played (visible wear, no major damage), HP is Heavily Played and DMG is Damaged (creases, tears or water damage). Graded cards show the grading company and grade, like PSA 10 or CGC 9.5.",
        a: <><b>NM</b> is Near Mint (pack-fresh or close), <b>LP</b> is Lightly Played (minor edge or surface wear), <b>MP</b> is Moderately Played (visible wear, no major damage), <b>HP</b> is Heavily Played and <b>DMG</b> is Damaged (creases, tears or water damage). Graded cards show the grading company and grade, like PSA 10 or CGC 9.5.</>,
      },
      {
        q: "A card says Sold Out. Can I still get it?",
        plain: "Sold-out cards stay on the page so you can see what we carry. DM @cpulls.cards and we'll let you know if another copy is coming in or can be sourced for you.",
        a: <>Sold-out cards stay on the page so you can see what we carry. DM {BRAND_HANDLE} and we'll let you know if another copy is coming in or can be sourced for you.</>,
      },
    ],
  },
  {
    id: "shipping",
    title: "Shipping & guarantee",
    icon: Truck,
    items: [
      {
        q: "How fast do orders ship?",
        plain: "Orders ship within 48 hours of payment, anywhere in the United States.",
        a: <>Orders ship within 48 hours of payment, anywhere in the United States.</>,
      },
      {
        q: "How are cards packed?",
        plain: "Every card goes in a penny sleeve and toploader, then a team bag and a bubble mailer at minimum. High-value cards ship insured with tracking.",
        a: <>Every card goes in a penny sleeve and toploader, then a team bag and a bubble mailer at minimum. High-value cards ship insured with tracking.</>,
      },
      {
        q: "What if something's wrong with my order?",
        plain: "Every order carries a 100% satisfaction guarantee. If a card arrives damaged or isn't what was listed, DM @cpulls.cards with a photo and we'll make it right.",
        a: <>Every order carries a 100% satisfaction guarantee. If a card arrives damaged or isn't what was listed, DM {BRAND_HANDLE} with a photo and we'll make it right.</>,
      },
    ],
  },
  {
    id: "selling",
    title: "Selling & trading in",
    icon: HandCoins,
    items: [
      {
        q: "How much do you pay for cards?",
        plain: `We pay ${CASH_PCT}% of TCGplayer market in cash, or ${TRADE_PCT}% in trade credit toward anything in the vault. The Sell & Trade calculator on the shop page shows both numbers instantly for any card.`,
        a: <>We pay <b>{CASH_PCT}% of TCGplayer market in cash</b>, or <b>{TRADE_PCT}% in trade credit</b> toward anything in the vault. The Sell &amp; Trade calculator on the shop page shows both numbers instantly for any card.</>,
      },
      {
        q: "How does the card scanner work?",
        plain: "Tap Scan in the calculator, allow camera access, and hold your card flat inside the frame. It recognizes the card automatically, pulls the live TCGplayer price and fills in the cash and trade offer. You can also take a photo or upload one. Photos are used only to identify the card and aren't kept.",
        a: <>Tap <b>Scan</b> in the calculator, allow camera access, and hold your card flat inside the frame. It recognizes the card automatically, pulls the live TCGplayer price and fills in the cash and trade offer. You can also take a photo or upload one. Photos are used only to identify the card and aren't kept.</>,
      },
      {
        q: "Is the calculator number my final offer?",
        plain: "It's a close estimate. Final offers are based on the card in hand (condition, authenticity) and the market at that moment. Graded cards and sealed product are quoted individually.",
        a: <>It's a close estimate. Final offers are based on the card in hand (condition, authenticity) and the market at that moment. Graded cards and sealed product are quoted individually.</>,
      },
      {
        q: "How do trades work?",
        plain: "Pick the card you want from the vault, tap Trade, tell us what you've got and add photos. Chris reviews every trade personally and sends a counter, usually within 24 hours. You can also bring your binder to any show we're vending.",
        a: <>Pick the card you want from the vault, tap <b>Trade</b>, tell us what you've got and add photos. Chris reviews every trade personally and sends a counter, usually within 24 hours. You can also bring your binder to any show we're vending.</>,
      },
      {
        q: "What games do you buy?",
        plain: "Pokémon, One Piece, Magic: The Gathering, Dragon Ball Super, Yu-Gi-Oh, Riftbound and Union Arena, plus graded slabs and sealed product across those games. Not sure? Scan it or DM us.",
        a: <>Pokémon, One Piece, Magic: The Gathering, Dragon Ball Super, Yu-Gi-Oh, Riftbound and Union Arena, plus graded slabs and sealed product across those games. Not sure? Scan it or DM us.</>,
      },
    ],
  },
  {
    id: "shows",
    title: "Shows & lives",
    icon: Radio,
    items: [
      {
        q: "Where can I find you in person?",
        plain: "CPulls Cards vends at card shows around Northern California. Upcoming dates are listed on the shop page and announced first on Instagram @cpulls.cards. Bring your binder: we buy, sell and trade at every table.",
        a: <>CPulls Cards vends at card shows around Northern California. Upcoming dates are listed on the shop page and announced first on Instagram {BRAND_HANDLE}. Bring your binder: we buy, sell and trade at every table.</>,
      },
      {
        q: "Do you do live pulls?",
        plain: "Yes. We go live on TikTok at @cpulls.cards. When a stream is on, a Live banner appears at the top of the shop with a link to watch.",
        a: <>Yes. We go live on TikTok at {BRAND_HANDLE}. When a stream is on, a <b>Live</b> banner appears at the top of the shop with a link to watch.</>,
      },
      {
        q: "How do I reach you?",
        plain: "DM @cpulls.cards on Instagram or TikTok. That's the fastest way to ask about a card, a trade or a show.",
        a: <>DM {BRAND_HANDLE} on <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">Instagram</a> or <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer">TikTok</a>. That's the fastest way to ask about a card, a trade or a show.</>,
      },
    ],
  },
];

export function FaqPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_GROUPS.flatMap((g) => g.items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.plain } }))),
  };
  return (
    <InfoShell
      current="faq"
      kicker="Help center"
      title={<>Questions, <em>answered.</em></>}
      intro="Everything about buying, selling, trading and finding CPulls Cards in person. Can't find it here? DM us and a real person answers."
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
                    <div className="pc-faq-answer pc-body">{f.a}</div>
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

const GAMES = ["Pokémon", "One Piece", "Magic: The Gathering", "Dragon Ball Super", "Yu-Gi-Oh", "Riftbound", "Union Arena"];

export function AboutPage() {
  return (
    <InfoShell
      current="about"
      kicker="About CPulls Cards"
      title={<>A card shop run by a <em>collector</em>, not a warehouse.</>}
      intro="CPulls Cards is Chris — a California collector who buys, sells and trades the cards he'd want in his own binder, in person at shows across Northern California and online, every day."
    >
      <div className="pc-container py-10 md:py-14 grid gap-12">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-start" data-testid="about-story">
          <div>
            <div className="pc-sec-title"><h2>How it started</h2></div>
            <div className="pc-info-prose pc-body mt-5">
              <p>CPulls began the way most shops do: a binder that got too big. Opening packs on live streams turned into trading at local shows, trading turned into buying collections, and the vault you can shop today grew out of that — one hand-checked card at a time.</p>
              <p>It's still a one-person operation on purpose. Every card is inspected, photographed and priced by Chris. Every trade offer and every order confirmation comes from him, not a script. That's slower than a warehouse, and it's the whole point.</p>
            </div>
          </div>
          <ul className="pc-info-facts" aria-label="Quick facts">
            <li><MapPin className="h-5 w-5" aria-hidden /><div><b>Based in California</b><span>Online orders ship nationwide</span></div></li>
            <li><Radio className="h-5 w-5" aria-hidden /><div><b>Live on TikTok</b><span>Pack openings and pulls at {BRAND_HANDLE}</span></div></li>
            <li><Award className="h-5 w-5" aria-hidden /><div><b>Northern California shows</b><span>Buying, selling and trading at the table</span></div></li>
            <li><Truck className="h-5 w-5" aria-hidden /><div><b>Ships in 48 hours</b><span>Toploader, team bag, insured on high-value cards</span></div></li>
          </ul>
        </section>

        <section data-testid="about-values">
          <div className="pc-sec-title"><h2>What we stand on</h2></div>
          <div className="grid gap-3 md:grid-cols-3 mt-5">
            {[
              { Icon: ShieldCheck, title: "Every card, verified", body: "Grades, edges and centering are inspected in hand. The photo in the listing is the card that ships." },
              { Icon: Award, title: "Transparent pricing", body: "Live TCGplayer market data sits next to every price and refreshes while you browse. No guessing what a card is worth." },
              { Icon: HandCoins, title: "Fair offers, in writing", body: `${CASH_PCT}% of market in cash or ${TRADE_PCT}% in trade credit, posted on the site so you know the number before you reach out.` },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="pc-info-card">
                <div className="pc-info-card-icon"><Icon className="h-5 w-5" /></div>
                <h3>{title}</h3>
                <p className="pc-body">{body}</p>
              </div>
            ))}
          </div>
        </section>

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
            <h2>Come say hi</h2>
            <p className="pc-body">Catch a live on TikTok, find the table at the next Northern California show, or shop the vault right now.</p>
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

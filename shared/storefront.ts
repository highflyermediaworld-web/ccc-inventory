/**
 * Storefront copy shared by the public pages, the admin editors and the
 * server-side shop assistant.
 *
 *  - FAQ_GROUPS    → #/faq page and the chat assistant's knowledge
 *  - DEFAULT_ABOUT → #/about page until the owner publishes their own copy
 *                    from Admin → About page
 *
 * Rich-text convention (kept deliberately tiny): `**bold**` and
 * `[label](https://url)`; `{handle}` expands to the brand handle.
 */

export const BRAND_HANDLE = "@cpulls.cards";
export const TIKTOK_URL = "https://www.tiktok.com/@cpulls.cards";
export const INSTAGRAM_URL = "https://www.instagram.com/cpulls.cards";

export const CASH_PCT = 70;
export const TRADE_PCT = 80;

export const GAMES = ["Pokémon", "One Piece", "Magic: The Gathering", "Dragon Ball Super", "Yu-Gi-Oh", "Riftbound", "Union Arena"];

/* ------------------------------------------------------------------ */
/*  FAQ                                                                */
/* ------------------------------------------------------------------ */

export type FaqItem = { q: string; a: string };
export type FaqGroup = { id: "buying" | "shipping" | "selling" | "shows"; title: string; items: FaqItem[] };

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: "buying",
    title: "Buying",
    items: [
      {
        q: "How do I buy a card?",
        a: "Find the card in the vault, tap **Buy**, and leave your name and how you'd like to be contacted. Chris confirms the card is still in hand and reaches out, usually within 24 hours, to arrange payment and shipping.",
      },
      {
        q: "Are the photos the actual cards?",
        a: "Yes. What you see in the listing is the exact card that ships. Grades, edges and centering are inspected in hand before anything goes up.",
      },
      {
        q: "How are prices set?",
        a: "Every listing shows the live TCGplayer market price next to our price, and it refreshes while you browse. Our asking price follows the market; if a card is priced under market you'll see it right on the card.",
      },
      {
        q: "What do the condition labels mean?",
        a: "**NM** is Near Mint (pack-fresh or close), **LP** is Lightly Played (minor edge or surface wear), **MP** is Moderately Played (visible wear, no major damage), **HP** is Heavily Played and **DMG** is Damaged (creases, tears or water damage). Graded cards show the grading company and grade, like PSA 10 or CGC 9.5.",
      },
      {
        q: "A card says Sold Out. Can I still get it?",
        a: "Sold-out cards stay on the page so you can see what we carry. DM {handle} and we'll let you know if another copy is coming in or can be sourced for you.",
      },
    ],
  },
  {
    id: "shipping",
    title: "Shipping & guarantee",
    items: [
      { q: "How fast do orders ship?", a: "Orders ship within 48 hours of payment, anywhere in the United States." },
      {
        q: "How are cards packed?",
        a: "Every card goes in a penny sleeve and toploader, then a team bag and a bubble mailer at minimum. High-value cards ship insured with tracking.",
      },
      {
        q: "What if something's wrong with my order?",
        a: "Every order carries a 100% satisfaction guarantee. If a card arrives damaged or isn't what was listed, DM {handle} with a photo and we'll make it right.",
      },
    ],
  },
  {
    id: "selling",
    title: "Selling & trading in",
    items: [
      {
        q: "How much do you pay for cards?",
        a: `We pay **${CASH_PCT}% of TCGplayer market in cash**, or **${TRADE_PCT}% in trade credit** toward anything in the vault. The Sell & Trade calculator on the shop page shows both numbers instantly for any card.`,
      },
      {
        q: "How does the card scanner work?",
        a: "Tap **Scan** in the calculator, allow camera access, and hold your card flat inside the frame. It recognizes the card automatically, pulls the live TCGplayer price and fills in the cash and trade offer. You can also take a photo or upload one. Photos are used only to identify the card and aren't kept.",
      },
      {
        q: "Is the calculator number my final offer?",
        a: "It's a close estimate. Final offers are based on the card in hand (condition, authenticity) and the market at that moment. Graded cards and sealed product are quoted individually.",
      },
      {
        q: "How do trades work?",
        a: "Pick the card you want from the vault, tap **Trade**, tell us what you've got and add photos. Chris reviews every trade personally and sends a counter, usually within 24 hours. You can also bring your binder to any show we're vending.",
      },
      {
        q: "What games do you buy?",
        a: `${GAMES.join(", ")}, plus graded slabs and sealed product across those games. Not sure? Scan it or DM us.`,
      },
    ],
  },
  {
    id: "shows",
    title: "Shows & lives",
    items: [
      {
        q: "Where can I find you in person?",
        a: "CPulls Cards vends at card shows around Northern California. Upcoming dates are listed on the shop page and announced first on Instagram {handle}. Bring your binder: we buy, sell and trade at every table.",
      },
      {
        q: "Do you do live pulls?",
        a: "Yes. We go live on TikTok at {handle}. When a stream is on, a **Live** banner appears at the top of the shop with a link to watch.",
      },
      {
        q: "How do I reach you?",
        a: `DM {handle} on [Instagram](${INSTAGRAM_URL}) or [TikTok](${TIKTOK_URL}). That's the fastest way to ask about a card, a trade or a show.`,
      },
    ],
  },
];

/** Plain-text version of a rich string (for JSON-LD, the assistant, etc.). */
export function plainText(s: string): string {
  return s
    .replace(/\{handle\}/g, BRAND_HANDLE)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1");
}

/* ------------------------------------------------------------------ */
/*  About page                                                         */
/* ------------------------------------------------------------------ */

export type AboutFact = { title: string; sub: string };
export type AboutValue = { title: string; body: string };

export type AboutContent = {
  kicker: string;
  /** Hero headline. Wrap one phrase in *asterisks* to color it gold. */
  title: string;
  intro: string;
  storyHeading: string;
  /** Story paragraphs, in order. */
  story: string[];
  /** Owner photo (relative /uploads/about/… or absolute URL). */
  photoUrl: string | null;
  photoAlt: string;
  photoCaption: string;
  /** Quick facts next to the story (up to 4; icons are fixed by position). */
  facts: AboutFact[];
  valuesHeading: string;
  /** Three value cards (icons are fixed by position). */
  values: AboutValue[];
  ctaHeading: string;
  ctaBody: string;
};

export const ABOUT_LIMITS = { facts: 4, values: 3, story: 8 } as const;

export const DEFAULT_ABOUT: AboutContent = {
  kicker: "About CPulls Cards",
  title: "A card shop run by a *collector*, not a warehouse.",
  intro:
    "CPulls Cards is Chris — a California collector who buys, sells and trades the cards he'd want in his own binder, in person at shows across Northern California and online, every day.",
  storyHeading: "How it started",
  story: [
    "CPulls began the way most shops do: a binder that got too big. Opening packs on live streams turned into trading at local shows, trading turned into buying collections, and the vault you can shop today grew out of that — one hand-checked card at a time.",
    "It's still a one-person operation on purpose. Every card is inspected, photographed and priced by Chris. Every trade offer and every order confirmation comes from him, not a script. That's slower than a warehouse, and it's the whole point.",
  ],
  photoUrl: null,
  photoAlt: "Chris of CPulls Cards",
  photoCaption: "",
  facts: [
    { title: "Based in California", sub: "Online orders ship nationwide" },
    { title: "Live on TikTok", sub: `Pack openings and pulls at ${BRAND_HANDLE}` },
    { title: "Northern California shows", sub: "Buying, selling and trading at the table" },
    { title: "Ships in 48 hours", sub: "Toploader, team bag, insured on high-value cards" },
  ],
  valuesHeading: "What we stand on",
  values: [
    { title: "Every card, verified", body: "Grades, edges and centering are inspected in hand. The photo in the listing is the card that ships." },
    { title: "Transparent pricing", body: "Live TCGplayer market data sits next to every price and refreshes while you browse. No guessing what a card is worth." },
    { title: "Fair offers, in writing", body: `${CASH_PCT}% of market in cash or ${TRADE_PCT}% in trade credit, posted on the site so you know the number before you reach out.` },
  ],
  ctaHeading: "Come say hi",
  ctaBody: "Catch a live on TikTok, find the table at the next Northern California show, or shop the vault right now.",
};

/** Merge a partial saved record over the defaults so new fields never render blank. */
export function mergeAbout(saved: Partial<AboutContent> | null | undefined): AboutContent {
  if (!saved) return DEFAULT_ABOUT;
  const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
  return {
    kicker: str(saved.kicker, DEFAULT_ABOUT.kicker),
    title: str(saved.title, DEFAULT_ABOUT.title),
    intro: str(saved.intro, DEFAULT_ABOUT.intro),
    storyHeading: str(saved.storyHeading, DEFAULT_ABOUT.storyHeading),
    story: Array.isArray(saved.story) ? saved.story.filter((p): p is string => typeof p === "string") : DEFAULT_ABOUT.story,
    photoUrl: typeof saved.photoUrl === "string" && saved.photoUrl ? saved.photoUrl : null,
    photoAlt: str(saved.photoAlt, DEFAULT_ABOUT.photoAlt),
    photoCaption: str(saved.photoCaption, DEFAULT_ABOUT.photoCaption),
    facts: Array.isArray(saved.facts) ? saved.facts.slice(0, ABOUT_LIMITS.facts) : DEFAULT_ABOUT.facts,
    valuesHeading: str(saved.valuesHeading, DEFAULT_ABOUT.valuesHeading),
    values: Array.isArray(saved.values) ? saved.values.slice(0, ABOUT_LIMITS.values) : DEFAULT_ABOUT.values,
    ctaHeading: str(saved.ctaHeading, DEFAULT_ABOUT.ctaHeading),
    ctaBody: str(saved.ctaBody, DEFAULT_ABOUT.ctaBody),
  };
}

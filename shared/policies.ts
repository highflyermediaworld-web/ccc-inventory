/**
 * Store policies — shared by the storefront (#/policies/<slug>), the chat
 * assistant's knowledge and the checkout footnote.
 *
 * Text uses the same light markup as the FAQ: **bold**, [label](url),
 * {handle}, {freeShipping}, {fedexOption}, plus {taxPercent}, {email}.
 */
import { BRAND_HANDLE, CASH_PCT, GAMES, INSTAGRAM_URL, PAYMENT_METHODS_SENTENCE, TIKTOK_URL, TRADE_PCT } from "./storefront";

/** Business identity used across the policies. */
export const LEGAL_NAME = "Chris Collects Co";
export const LEGAL_STATE = "California";
/** Public contact email. Leave null until the owner picks one — pages fall back to DMs. */
export const CONTACT_EMAIL: string | null = null;
/** ISO date the policies were last revised; shown on every policy page. */
export const POLICIES_UPDATED = "2026-11-18";

/** Days a buyer has after delivery to report a problem. */
export const CLAIM_WINDOW_DAYS = 7;

export type PolicyBlock =
  | string
  | { list: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { note: string };

export type PolicySection = { heading: string; blocks: PolicyBlock[] };

export type Policy = {
  slug: string;
  title: string;
  /** One-line purpose, shown in the index and footer. */
  purpose: string;
  intro: string;
  sections: PolicySection[];
};

const DM = `DM {handle} on [Instagram](${INSTAGRAM_URL}) or [TikTok](${TIKTOK_URL})`;
const CONTACT = CONTACT_EMAIL ? `${DM}, or email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})` : DM;

export const POLICIES: Policy[] = [
  {
    slug: "terms",
    title: "Terms & Conditions",
    purpose: "Rules governing website purchases",
    intro: `The ground rules for using this site and buying, selling or trading with ${LEGAL_NAME}. Using the site or placing an order means you agree to them.`,
    sections: [
      {
        heading: "Who we are",
        blocks: [
          `${LEGAL_NAME} is a collector-run trading card shop based in ${LEGAL_STATE}, operated by Chris. We sell online through this site, in person at card shows, and on TikTok live streams at {handle}. We ship within the United States only.`,
          "You must be 18 or older to place an order or sell cards to us. Under 18? Have a parent or guardian handle the purchase or trade.",
        ],
      },
      {
        heading: "Listings, photos and prices",
        blocks: [
          "The photo on a listing is the actual card that ships, unless the listing is for sealed product or clearly states a stock image. Condition labels follow our [Condition Guide](#/policies/condition-guide).",
          "Our asking prices follow the live market: the TCGplayer market price shown beside a card is a third-party reference that refreshes while you browse, and our price may move with it. Graded slabs reference recent graded sales. A price is only locked once your payment is complete.",
          "We work hard to keep listings accurate, but a listing can occasionally be wrong — a typo in the price, a card that sold at a show minutes earlier, a quantity that's off by one. If that happens, we'll tell you right away and cancel and refund the affected item in full. We can't honor a price that's obviously an error.",
        ],
      },
      {
        heading: "Orders and payment",
        blocks: [
          "**Card checkout.** Tap Pay with card and you're taken to Stripe's secure checkout. Your order is accepted when the payment is confirmed and we've verified the card is in hand; you'll get an emailed receipt. Stripe handles your card details — we never see or store them.",
          "**Buy requests.** Tapping Buy and leaving your contact details is a request, not a purchase. Nothing is held or sold until Chris confirms availability and you've paid. We accept " + PAYMENT_METHODS_SENTENCE + ".",
          `**Sales tax.** ${LEGAL_STATE} sales tax ({taxPercent}%) is added to card checkout. Shipping is not taxed.`,
          "**Shipping.** Shipping is calculated before tax from your ZIP code, the carrier you choose and what's in the order. See the [Shipping Policy](#/policies/shipping).{freeShipping}",
          "**Cancellations.** You can cancel an order any time before it ships by messaging us. Once a tracking number exists, it's a return — see the [Return & Refund Policy](#/policies/returns).",
        ],
      },
      {
        heading: "Selling and trading cards to us",
        blocks: [
          `The Sell & Trade calculator quotes **${CASH_PCT}% of TCGplayer market in cash** or **${TRADE_PCT}% in trade credit**. Those numbers are estimates based on the card you identify and the market at that moment. A final offer is made only after Chris inspects the card in hand for condition and authenticity, and we may decline any card for any reason.`,
          "By offering a card you confirm you own it and have the right to sell it. Counterfeit, altered or stolen cards are refused, and we may report them. Trade credit has no cash value and can be used on anything in the vault.",
          "Once a sale or trade is accepted and payment or credit has been issued, it's final.",
        ],
      },
      {
        heading: "Using the site",
        blocks: [
          "The card scanner and chat assistant use AI to identify cards and answer questions. They're helpers, not guarantees — see the [Disclaimer](#/policies/disclaimer). Don't use the site to upload content you don't have rights to, to attempt fraud, or to interfere with how it runs.",
          `All card names, set names, logos and artwork belong to their respective owners (The Pokémon Company, Nintendo, Bandai, Wizards of the Coast and others). ${LEGAL_NAME} is an independent reseller and is not affiliated with or endorsed by any of them.`,
        ],
      },
      {
        heading: "Liability",
        blocks: [
          `We stand behind every order with our satisfaction guarantee (see the [Return & Refund Policy](#/policies/returns)). Beyond refunding or replacing what you paid for, ${LEGAL_NAME} isn't liable for indirect losses such as changes in a card's market value, grading outcomes, or delays caused by carriers. Nothing here limits rights you have under ${LEGAL_STATE} consumer law that can't be waived.`,
          `These terms are governed by the laws of the State of ${LEGAL_STATE}. We may update them as the shop grows; the date at the top of this page tells you when they last changed, and the version in effect when you order is the one that applies to that order.`,
        ],
      },
      { heading: "Questions", blocks: [`${CONTACT}. A real person answers, usually within the day.`] },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    purpose: "How customer information is collected and used",
    intro: "We collect only what's needed to sell you a card, ship it and answer your questions. Here's exactly what that is and where it goes.",
    sections: [
      {
        heading: "What we collect",
        blocks: [
          {
            list: [
              "**Buy and Trade requests:** your name and how to reach you (Instagram handle, phone or email), plus any card photos you attach to a trade offer.",
              "**Card checkout:** your email, shipping address and phone are collected by Stripe and shared with us so we can ship and send a receipt. Card numbers go to Stripe only — we never see them.",
              "**Shipping quotes:** the ZIP code you type in the cart. It's kept in your own browser so you don't have to retype it, and sent to us only to calculate a rate.",
              "**Card scanner:** the photo you take or upload is sent to our AI provider (Google Gemini) to identify the card, then discarded. We don't keep scanner photos.",
              "**Chat assistant:** your messages are sent to our AI provider to generate a reply, along with public shop information. Don't put payment details in the chat.",
              "**Technical basics:** our host logs standard server information (IP address, browser type, pages requested) for security and debugging. We don't run third-party advertising trackers or analytics.",
            ],
          },
          "The site stores your cart, ZIP code and carrier choice in your browser's local storage, and uses a session cookie only for the owner's admin login.",
        ],
      },
      {
        heading: "How we use it",
        blocks: [
          { list: ["To confirm, pack and ship your order and send its receipt and tracking.", "To reply to your Buy, Trade and Sell requests and questions.", "To quote shipping and calculate tax.", "To prevent fraud and keep the site working.", "To keep records we're required to keep for tax and accounting."] },
          "We don't sell or rent your information, and we don't send marketing email. If you want to hear about drops and shows, follow {handle}.",
        ],
      },
      {
        heading: "Who else sees it",
        blocks: [
          {
            list: [
              "**Stripe** — payment processing and receipts ([Stripe privacy policy](https://stripe.com/privacy)).",
              "**USPS and FedEx** — your name, address and phone appear on the shipping label and in tracking.",
              "**Google** — AI identification for the scanner and replies in the chat ([Google privacy policy](https://policies.google.com/privacy)).",
              "**Our hosting and database providers** — store the site and order records securely in the United States.",
            ],
          },
          "Price data comes from TCGplayer and graded-sale sources; no customer information is sent to them. We'll also disclose information if the law requires it.",
        ],
      },
      {
        heading: "How long we keep it",
        blocks: [
          "Order and shipment records are kept as long as needed for taxes, accounting and our guarantee (generally several years). Buy and Trade requests are kept until they're resolved and then for a reasonable period after. Scanner photos aren't kept at all; chat messages aren't tied to your identity.",
        ],
      },
      {
        heading: "Your choices and rights",
        blocks: [
          `You can ask what information we hold about you, ask us to correct it, or ask us to delete it (except records we must keep by law). ${LEGAL_STATE} residents have these rights under the CCPA; we extend them to everyone. ${CONTACT} and we'll handle it within 30 days, no account required.`,
          "The site isn't directed at children under 13 and we don't knowingly collect their information. If you believe a child has sent us details, tell us and we'll delete them.",
          "We may update this policy as the shop changes; the date at the top shows the latest revision.",
        ],
      },
    ],
  },
  {
    slug: "shipping",
    title: "Shipping Policy",
    purpose: "Shipping costs, timelines and procedures",
    intro: "Every order is packed by hand in California and on its way within 48 hours of payment. Here's what to expect from carriers, costs and timing.",
    sections: [
      {
        heading: "Where and how fast",
        blocks: [
          "We ship anywhere in the United States, including APO/FPO and PO Boxes for USPS orders. We don't ship internationally yet.",
          "Paid orders ship within **48 hours** (Monday–Saturday, excluding postal holidays). You'll get an emailed receipt when you pay and a tracking number when the label is created.",
        ],
      },
      {
        heading: "Carriers and rates",
        blocks: [
          "**USPS Ground Advantage** — 2–5 business days. The rate is USPS's current retail price for your distance zone and the weight of your order, calculated when you enter your ZIP code in the cart. One card to the Bay Area is about $8.40; a stack of slabs to the East Coast runs more.{freeShipping}",
          "{fedexOption}",
          "Shipping is shown in the cart before you pay, added before tax, and isn't taxed. The exact amount you see at checkout is what you're charged — no surprises afterward.",
        ],
      },
      {
        heading: "Packaging",
        blocks: [
          "Raw cards: penny sleeve, toploader, team bag, then a rigid cardboard sandwich inside a bubble mailer. Graded slabs: sleeved and bubble-wrapped, boxed when there are several. Sealed product: boxed with padding so corners and shrink-wrap arrive the way they left. High-value orders ship with signature confirmation and insurance.",
        ],
      },
      {
        heading: "Address accuracy",
        blocks: [
          "Please double-check your address at checkout — we ship to exactly what you enter. If a package is returned to us because of an address error, we'll reship once you cover the new postage. If you notice a mistake before the order ships, message us and we'll fix it.",
          "FedEx 2Day can't deliver to PO Boxes; choose USPS for a PO Box address.",
        ],
      },
      {
        heading: "Lost, delayed or damaged",
        blocks: [
          `Tracking stalled or a package marked delivered that hasn't arrived? Give USPS 2 extra business days (they often scan early), then ${CONTACT} and we'll open a carrier claim and make it right. Arrived damaged? Photograph the packaging and the card before you do anything else and message us within ${CLAIM_WINDOW_DAYS} days of delivery — see the [Return & Refund Policy](#/policies/returns).`,
        ],
      },
      {
        heading: "Local pickup",
        blocks: ["If you'd rather pick up at a Northern California show we're vending at, send a Buy request and mention the show — Chris will hold the card for you there with no shipping charge."],
      },
    ],
  },
  {
    slug: "returns",
    title: "Return & Refund Policy",
    purpose: "Returns, refunds and exceptions",
    intro: "Every order carries a 100% satisfaction guarantee: if a card isn't what we listed, we'll make it right. Because collectibles move with the market, that guarantee has a few clear rules.",
    sections: [
      {
        heading: "Our guarantee",
        blocks: [
          `If a card arrives damaged, isn't the card pictured, or doesn't match its listed condition under our [Condition Guide](#/policies/condition-guide), tell us within **${CLAIM_WINDOW_DAYS} days of delivery** with photos and we'll refund you in full or replace it if we have another copy — your choice. We cover return shipping when the mistake is ours.`,
        ],
      },
      {
        heading: "What's final sale",
        blocks: [
          {
            list: [
              "**Graded slabs** — the grade is set by the grading company, not us. Final sale unless the case arrives cracked or the slab isn't the one pictured (the certification number must match).",
              "**Sealed product** — final sale once the shrink-wrap or seal is broken. Damage in transit is covered: don't open it, photograph it, and message us.",
              "**Change of mind or market moves** — we can't accept returns because a card's price went down or because you found it cheaper elsewhere.",
              "**Trade-ins and buylist sales** — final once accepted and paid or credited.",
            ],
          },
        ],
      },
      {
        heading: "How to start a return",
        blocks: [
          { list: [`Message us within ${CLAIM_WINDOW_DAYS} days of delivery: ${CONTACT}. Include your order email or name and clear photos of the issue.`, "We'll confirm within one business day and, if a return is needed, send instructions and a prepaid label when the error is ours.", "Send the card back in the same sleeve and toploader (or slab case) it arrived in, securely packed. Cards returned in a different condition than they were sent can't be refunded."] },
        ],
      },
      {
        heading: "Refunds",
        blocks: [
          "Refunds go back to the original payment method once the return is received and inspected — usually within 2 business days of arrival. Card refunds then take 5–10 business days to appear, depending on your bank; Zelle, Venmo, Cash App and PayPal refunds are sent to the same account you paid from.",
          "Original shipping is refunded when the error was ours. If you cancel before the order ships, you're refunded in full, including shipping.",
        ],
      },
      {
        heading: "Cancellations",
        blocks: ["Changed your mind before it ships? Message us and we'll cancel and refund in full. Once a tracking number exists, the order is on its way and the return rules above apply."],
      },
    ],
  },
  {
    slug: "condition-guide",
    title: "Condition Guide",
    purpose: "Our card condition standards",
    intro: "Every raw card is inspected in hand — front and back, edges, corners, surface and centering — under bright light before it's listed. These are the standards behind the labels you see.",
    sections: [
      {
        heading: "Raw card grades",
        blocks: [
          {
            table: {
              head: ["Label", "Condition", "What to expect"],
              rows: [
                ["NM", "Near Mint", "Pack-fresh or close. At most a tiny edge nick or faint surface mark visible only under close inspection. No scratches, whitening or print lines that catch the eye. Our default for modern singles."],
                ["LP", "Lightly Played", "Minor wear from light handling: slight edge or corner whitening, a few light surface scratches, or minor edge wear. Still clean at arm's length. No creases or bends."],
                ["MP", "Moderately Played", "Clearly played: moderate whitening on several edges or corners, noticeable scratches or scuffs, maybe a light bend. Structurally sound — no tears, no major creases."],
                ["HP", "Heavily Played", "Significant wear: heavy whitening, deep scratches, creasing, or a small amount of edge damage. Fully intact and legible."],
                ["DMG", "Damaged", "Tears, water damage, heavy creases, writing, or missing material. Sold as filler or for the art, and priced accordingly."],
              ],
            },
          },
          "We grade conservatively. When a card is between two grades, we list the lower one. Japanese and other non-English prints are labeled with their language in the listing.",
        ],
      },
      {
        heading: "Centering, holos and print quality",
        blocks: [
          "Centering is judged separately from wear: an NM card can be off-center from the factory. Where centering is notably off, we say so in the listing. Holofoil cards show scratches more easily; we hold holos to the same standard as non-holos. Factory print lines, dimples or ink spots are noted when visible.",
        ],
      },
      {
        heading: "Graded slabs",
        blocks: [
          "Graded cards show the grading company and grade (PSA 10, CGC 9.5, BGS 9) exactly as printed on the label. The grade is the grader's opinion, not ours, and we don't re-grade. Slabs are inspected for case cracks, scratches and label damage; anything beyond light case scuffing is noted. The certification number on the slab you receive matches the one pictured.",
        ],
      },
      {
        heading: "Sealed product",
        blocks: [
          "Sealed items are factory-sealed and unweighed. We note any dented corners, torn shrink-wrap or crushed packaging in the listing. Pull rates are random and we make no claims about contents.",
        ],
      },
      {
        heading: "Cards you sell or trade to us",
        blocks: [
          `We assess your cards against the same standards. The calculator assumes NM; cards that grade LP or lower are offered at a percentage of the NM price based on condition, and we'll show you what we see. You can always decline the offer and take your cards home.`,
        ],
      },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    purpose: "How to reach us",
    intro: "Chris Collects Co is one collector, not a call center — but every message gets a real reply, usually within the day.",
    sections: [
      {
        heading: "Fastest ways to reach us",
        blocks: [
          {
            list: [
              `**Instagram** — DM {handle} at [instagram.com/cpulls.cards](${INSTAGRAM_URL}). Best for order questions, trades and show info.`,
              `**TikTok** — DM {handle} at [tiktok.com/@cpulls.cards](${TIKTOK_URL}), or catch us on a live stream.`,
              ...(CONTACT_EMAIL ? [`**Email** — [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). Use this for returns, privacy requests and anything you'd like in writing.`] : []),
              "**On the site** — the chat assistant in the corner answers common questions instantly and points anything else to Chris.",
            ],
          },
        ],
      },
      {
        heading: "What to include",
        blocks: [
          "For an order: the name or email you checked out with and the card. For a return or damage claim: photos of the card and packaging. For a trade: what you've got and what you want from the vault. The more you include, the faster the answer.",
        ],
      },
      {
        heading: "Response times",
        blocks: [
          "Messages are usually answered the same day, and always within 2 business days. Orders ship within 48 hours of payment even when Chris is at a show.",
        ],
      },
      {
        heading: "In person",
        blocks: [
          `${LEGAL_NAME} is based in ${LEGAL_STATE} and vends at card shows around Northern California. Upcoming shows are listed on the shop page and announced first on Instagram. We don't have a walk-in storefront or a public mailing address; returns are arranged by message so we can send you the right label.`,
        ],
      },
    ],
  },
  {
    slug: "disclaimer",
    title: "Disclaimer",
    purpose: "Product, pricing and grading disclosures",
    intro: "A few honest disclosures about collectibles, market prices and the tools on this site.",
    sections: [
      {
        heading: "Not affiliated",
        blocks: [
          `${LEGAL_NAME} is an independent reseller of ${GAMES.slice(0, -1).join(", ")} and ${GAMES[GAMES.length - 1]} cards and sealed product. We are not affiliated with, sponsored by or endorsed by The Pokémon Company International, Nintendo, Creatures, GAME FREAK, Bandai, Toei Animation, Shueisha, Wizards of the Coast, Hasbro, Konami, Riot Games or any other publisher. All trademarks, card names and artwork are the property of their respective owners and are used only to identify the products for sale.`,
        ],
      },
      {
        heading: "Market prices are references",
        blocks: [
          "The TCGplayer market price shown beside a listing, the Alt and graded-sale values behind slab prices, and the cash and trade numbers in the Sell & Trade calculator come from third-party data and can change by the minute. They are references, not appraisals, and we don't guarantee their accuracy or that a card will hold any particular value. Collectible prices go up and down; buy what you love.",
        ],
      },
      {
        heading: "Condition and grading",
        blocks: [
          "Raw card conditions are our good-faith assessment under the [Condition Guide](#/policies/condition-guide). Grading is partly subjective and a professional grader may reach a different conclusion; we make no guarantee about the grade a raw card will receive if you submit it. Grades on slabs are the grading company's opinion. Sealed product contents are random.",
        ],
      },
      {
        heading: "AI tools",
        blocks: [
          "The card scanner and the chat assistant are powered by AI. The scanner can misidentify a card (especially promos, alternate arts and non-English prints) and the assistant can be wrong about details — always check the card name and set it fills in, and treat its answers as a starting point. Final prices, offers and policies are the ones Chris confirms and the ones written on these pages.",
        ],
      },
      {
        heading: "Availability and errors",
        blocks: [
          "Inventory is shared with our show table and live streams, so a card can sell in person after you see it online; we'll refund immediately if that happens. We try to keep every listing accurate but can't rule out typos or photo mix-ups, and we reserve the right to correct them and cancel affected orders. Links to other sites are provided for convenience and we aren't responsible for their content.",
        ],
      },
    ],
  },
];

export function policyBySlug(slug: string): Policy | undefined {
  return POLICIES.find((p) => p.slug === slug);
}

/** Plain-text rendering of every policy for the chat assistant's knowledge. */
export function policiesPlainText(subs: { freeShipping: string; fedexOption: string; taxPercent: string }): string {
  const sub = (s: string) =>
    s
      .replace(/\{handle\}/g, BRAND_HANDLE)
      .replace(/\{freeShipping\}/g, subs.freeShipping)
      .replace(/\{fedexOption\}/g, subs.fedexOption)
      .replace(/\{taxPercent\}/g, subs.taxPercent)
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .trim();
  const block = (b: PolicyBlock): string => {
    if (typeof b === "string") return sub(b);
    if ("list" in b) return b.list.map((x) => `- ${sub(x)}`).join("\n");
    if ("note" in b) return sub(b.note);
    return b.table.rows.map((r) => r.map(sub).join(": ")).join("\n");
  };
  return POLICIES.map((p) => `## ${p.title}\n${p.sections.map((s) => `${s.heading}: ${s.blocks.map(block).filter(Boolean).join(" ")}`).join("\n")}`).join("\n\n");
}

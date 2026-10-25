/**
 * Card shows Chris Collects Co is vending at (built-in list).
 *
 * The owner can override this list from Admin → Shop settings; this file is
 * the fallback shown when nothing has been published. Dates are ISO
 * (YYYY-MM-DD). Shared between the storefront and the server so the shop
 * chat assistant can answer "where are you next?".
 */
export type CardShow = {
  name: string;
  /** ISO date, e.g. "2026-06-12" */
  start: string;
  /** ISO date for multi-day shows; omit for single-day */
  end?: string;
  /** e.g. "12 PM – 7 PM" */
  hours?: string;
  venue?: string;
  city: string;
  /** Instagram handle of the show organizer (without @) */
  host?: string;
  /** Ticket / info link */
  url?: string;
  /** Short note: free entry, what we're bringing, etc. */
  note?: string;
};

export const SHOWS: CardShow[] = [
  // --- from the @cpulls.cards bio "Upcoming Shows" list ---
  {
    name: "Hype Con Bay Area",
    start: "2026-10-31",
    end: "2026-11-01",
    hours: "Sat 11 AM – 5 PM · Sun 11 AM – 4 PM (VIP 10 AM)",
    venue: "Santa Clara Convention Center",
    city: "Santa Clara, CA",
    host: "hypeconco",
    url: "https://hypecon.co/",
    note: "Cards, collectibles, Pokémon & K-pop · kids 12 & under free",
  },
  {
    name: "East Bay Card Show",
    start: "2026-10-24",
    end: "2026-10-25",
    hours: "Sat 10 AM – 5 PM (VIP 9:30) · Sun 10 AM – 4 PM",
    venue: "San Mateo County Event Center, Fiesta Hall",
    city: "San Mateo, CA",
    host: "eastbaycardshow",
    url: "https://www.tenthinningcardshow.com/event-details/east-bay-card-show-oct-24-25",
    note: "Sports cards, Pokémon, TCG & collectibles",
  },
  {
    name: "Core 4 Friday Night Card Show",
    start: "2026-10-23",
    hours: "5 PM – 10 PM",
    venue: "Best Western Plus Heritage Inn",
    city: "Stockton, CA",
    host: "core4tcg",
  },
  // --- earlier 2026 shows from Instagram posts ---
  {
    name: "Core 4 Card Show",
    start: "2026-10-02",
    hours: "5 PM – 10 PM",
    venue: "Best Western Plus Heritage Inn",
    city: "Stockton, CA",
    host: "core4tcg",
    note: "Pokémon, One Piece & Dragon Ball Z",
  },
  {
    name: "Pokezard 916 Card Show",
    start: "2026-09-12",
    end: "2026-09-13",
    hours: "12 PM – 7 PM both days",
    venue: "2738 Sunrise Blvd",
    city: "Rancho Cordova, CA",
    host: "pokezard916",
    note: "Free entry + free parking",
  },
  {
    name: "East Bay Card Show",
    start: "2026-06-20",
    end: "2026-06-21",
    city: "Burlingame, CA",
    host: "eastbaycardshow",
  },
  {
    name: "King of Cards Trade Night",
    start: "2026-06-19",
    city: "Tracy, CA",
    host: "kingofcardstradeshow",
  },
  {
    name: "Sacramento Card Show",
    start: "2026-06-12",
    end: "2026-06-14",
    venue: "SAFE Credit Union Convention Center",
    city: "Sacramento, CA",
    host: "sacramentocardshow",
    url: "https://www.eventbrite.com/e/1986187236491",
  },
  {
    name: "Secret Stash Show",
    start: "2026-05-31",
    city: "Folsom, CA",
    host: "secretstashshow",
  },
  {
    name: "Pokezard 916 Card Show",
    start: "2026-05-30",
    city: "Sacramento, CA",
    host: "pokezard916",
  },
  {
    name: "King of Cards Trade Night @ Duelers Guild",
    start: "2026-05-29",
    city: "Tracy, CA",
    host: "kingofcardstradeshow",
  },
];

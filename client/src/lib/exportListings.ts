// CSV builders for marketplace listing exports (eBay File Exchange + TCGPlayer Pricing Tool).
import type { Inventory } from "@shared/schema";

function csvEscape(value: any): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(r.map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function mapConditionToEbay(condition?: string | null): string {
  const c = (condition ?? "").toUpperCase();
  if (c === "NM" || c === "LP") return "Near Mint or Better";
  if (c === "MP") return "Used";
  if (c === "HP" || c === "DMG") return "Used";
  if (c === "SEALED") return "New";
  if (c.startsWith("PSA") || c.startsWith("CGC") || c.startsWith("BGS")) {
    return "Graded";
  }
  return "Used";
}

function absoluteImage(url?: string | null): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window !== "undefined" && url.startsWith("/uploads/")) {
    return window.location.origin + url;
  }
  return url;
}

function descriptionHtml(item: Inventory): string {
  const bits = [
    `<h2>${item.name}</h2>`,
    `<p><strong>Set:</strong> ${item.setName}</p>`,
    item.rarity ? `<p><strong>Rarity:</strong> ${item.rarity}</p>` : "",
    item.condition ? `<p><strong>Condition:</strong> ${item.condition}</p>` : "",
    `<p><strong>Franchise:</strong> ${item.franchise}</p>`,
    `<p><strong>Category:</strong> ${item.category}</p>`,
    item.notes ? `<p>${item.notes}</p>` : "",
    "<p>Ships in a protective sleeve + top loader. See photos for exact condition.</p>",
  ];
  return bits.filter(Boolean).join("");
}

export function exportEbayCsv(items: Inventory[]) {
  const headers = [
    "Action(SiteID=US|Country=US|Currency=USD|Version=1193)",
    "Category",
    "Title",
    "Condition",
    "PicURL",
    "Description",
    "Format",
    "Duration",
    "StartPrice",
    "BuyItNowPrice",
    "Quantity",
    "Location",
    "ShippingType",
    "ShippingService-1:Option",
    "ShippingService-1:Cost",
    "DispatchTimeMax",
    "ReturnsAcceptedOption",
  ];
  const rows = items.map((i) => {
    const category = i.category === "Sealed" ? "183455" : "183454";
    const titleParts = [
      i.name,
      i.setName,
      i.rarity,
      i.condition,
      i.franchise,
      "TCG",
    ].filter(Boolean);
    const title = titleParts.join(" ").slice(0, 80); // eBay title limit
    const price = i.asking ?? i.marketValue ?? 0;
    return [
      "Add",
      category,
      title,
      mapConditionToEbay(i.condition),
      absoluteImage(i.imageUrl),
      descriptionHtml(i),
      "FixedPrice",
      "GTC",
      price,
      price,
      i.qty ?? 1,
      "California",
      "Flat",
      "USPSFirstClass",
      "0.99",
      "1",
      "ReturnsAccepted",
    ];
  });
  const csv = toCsv(headers, rows);
  triggerDownload(
    `ccc-ebay-listings-${new Date().toISOString().slice(0, 10)}.csv`,
    csv
  );
  return rows.length;
}

export function exportTcgPlayerCsv(items: Inventory[]) {
  const headers = [
    "TCGplayer Id",
    "Product Line",
    "Set Name",
    "Product Name",
    "Title",
    "Number",
    "Rarity",
    "Condition",
    "TCG Market Price",
    "TCG Direct Low",
    "TCG Low Price With Shipping",
    "TCG Low Price",
    "Total Quantity",
    "Add to Quantity",
    "TCG Marketplace Price",
    "Photo URL",
  ];
  const rows = items.map((i) => {
    const price = i.asking ?? i.marketValue ?? 0;
    return [
      "", // TCGplayer Id \u2014 user fills in post-upload
      i.franchise,
      i.setName,
      i.name,
      `${i.name} - ${i.setName}`,
      "", // Card number \u2014 not tracked in our schema
      i.rarity ?? "",
      i.condition ?? "Near Mint",
      i.marketValue ?? "",
      "",
      "",
      "",
      i.qty ?? 1,
      0,
      price,
      absoluteImage(i.imageUrl),
    ];
  });
  const csv = toCsv(headers, rows);
  triggerDownload(
    `ccc-tcgplayer-listings-${new Date().toISOString().slice(0, 10)}.csv`,
    csv
  );
  return rows.length;
}

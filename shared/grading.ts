// Graded-slab detection shared by the server (pricing) and the storefront.
//
// The inventory sheet records slabs two ways: sometimes the grade is in the
// Condition column ("PSA 10"), sometimes it's in Rarity ("PSA 10", "CGC 8.5",
// "Beckett Pristine 10") with Condition holding the label ("GEM - MT",
// "Pristine", "NM/MINT+"). Every consumer goes through gradeOfItem() so both
// layouts are read the same way.

export type GradeInfo = {
  /** Grading company, normalised: PSA | CGC | BGS | SGC | TAG | ACE | HGA | GMA */
  company: string;
  /** Numeric grade as written ("10", "9.5", "8.5") */
  grade: string;
  /** Qualifier such as "Pristine" / "Perfect" / "Black Label" when stated */
  qualifier: string | null;
  /** Short label for badges, e.g. "PSA 10", "CGC 10 Pristine", "BGS 10" */
  label: string;
};

const COMPANY_ALIASES: Record<string, string> = {
  psa: "PSA",
  cgc: "CGC",
  bgs: "BGS",
  beckett: "BGS",
  sgc: "SGC",
  tag: "TAG",
  ace: "ACE",
  hga: "HGA",
  gma: "GMA",
};

const GRADE_RE =
  /\b(psa|cgc|bgs|beckett|sgc|tag|ace|hga|gma)\b[\s:-]*(pristine|perfect|black\s*label|gem\s*(?:-\s*)?(?:mt|mint))?[\s:-]*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)\b(?:\s*(pristine|perfect|black\s*label|gem\s*(?:-\s*)?(?:mt|mint)))?/i;

/** Parse "PSA 10", "CGC 8.5", "Beckett Pristine 10", "CGC 10 Pristine" → GradeInfo. */
export function parseGrade(text: string | null | undefined): GradeInfo | null {
  if (!text) return null;
  const m = String(text).match(GRADE_RE);
  if (!m) return null;
  const company = COMPANY_ALIASES[m[1].toLowerCase()] ?? m[1].toUpperCase();
  const grade = m[3];
  const rawQual = (m[2] || m[4] || "").toLowerCase().replace(/\s+/g, " ").trim();
  let qualifier: string | null = null;
  if (/black/.test(rawQual)) qualifier = "Black Label";
  else if (/pristine/.test(rawQual)) qualifier = "Pristine";
  else if (/perfect/.test(rawQual)) qualifier = "Perfect";
  // "GEM MT" is just PSA's name for a 10 — not a distinct tier.
  const label = qualifier ? `${company} ${grade} ${qualifier}` : `${company} ${grade}`;
  return { company, grade, qualifier, label };
}

export type GradeSource = {
  condition?: string | null;
  rarity?: string | null;
  category?: string | null;
  name?: string | null;
};

/** The slab grade of an inventory item, reading Condition first, then Rarity, then the name. */
export function gradeOfItem(item: GradeSource): GradeInfo | null {
  const fromCondition = parseGrade(item.condition);
  if (fromCondition) {
    // "CGC 10" in Rarity with "Pristine" in Condition (or vice versa) — merge the qualifier.
    return fromCondition;
  }
  const fromRarity = parseGrade(item.rarity);
  if (fromRarity) {
    if (!fromRarity.qualifier) {
      const cond = String(item.condition ?? "").toLowerCase();
      if (/pristine/.test(cond)) return { ...fromRarity, qualifier: "Pristine", label: `${fromRarity.label} Pristine` };
      if (/perfect/.test(cond)) return { ...fromRarity, qualifier: "Perfect", label: `${fromRarity.label} Perfect` };
    }
    return fromRarity;
  }
  if (String(item.category ?? "").toLowerCase() === "slab") {
    const fromName = parseGrade(item.name);
    if (fromName) return fromName;
  }
  return null;
}

export function isGradedItem(item: GradeSource): boolean {
  return gradeOfItem(item) != null;
}

/**
 * Grade string Alt (alt.xyz) expects: "PSA 10", "PSA 9", "BGS 9.5", "CGC 10",
 * "CGC Pristine", "BGS Black Label", "SGC 10".
 */
export function altGradeFor(g: GradeInfo): string {
  if (g.company === "CGC" && g.grade === "10" && g.qualifier === "Pristine") return "CGC Pristine";
  if (g.company === "CGC" && g.grade === "10" && g.qualifier === "Perfect") return "CGC Perfect";
  if (g.company === "BGS" && g.grade === "10" && g.qualifier === "Black Label") return "BGS Black Label";
  return `${g.company} ${g.grade}`;
}

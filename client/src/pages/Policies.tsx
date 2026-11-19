import { useEffect } from "react";
import { useRoute } from "wouter";
import { FileText, ShieldCheck, Truck, RotateCcw, Search, MessageCircle, AlertTriangle, ArrowRight } from "lucide-react";
import { SiInstagram, SiTiktok } from "react-icons/si";
import { InfoShell, Rich } from "@/pages/Info";
import { POLICIES, POLICIES_UPDATED, policyBySlug, type PolicyBlock } from "@shared/policies";
import { BRAND_HANDLE, INSTAGRAM_URL, TIKTOK_URL } from "@shared/storefront";

const ICONS: Record<string, typeof FileText> = {
  terms: FileText,
  privacy: ShieldCheck,
  shipping: Truck,
  returns: RotateCcw,
  "condition-guide": Search,
  contact: MessageCircle,
  disclaimer: AlertTriangle,
};

function updatedLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function Block({ block }: { block: PolicyBlock }) {
  if (typeof block === "string") return <p><Rich text={block} /></p>;
  if ("list" in block) {
    return (
      <ul className="pc-policy-list">
        {block.list.map((item, i) => <li key={i}><Rich text={item} /></li>)}
      </ul>
    );
  }
  if ("note" in block) return <aside className="pc-policy-note"><Rich text={block.note} /></aside>;
  return (
    <div className="pc-policy-table-wrap">
      <table className="pc-policy-table">
        <thead><tr>{block.table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {block.table.rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row"><span className="pc-cond">{c}</span></th> : <td key={j}><Rich text={c} /></td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PoliciesPage() {
  const [, params] = useRoute("/policies/:slug");
  const slug = params?.slug ?? null;
  const policy = slug ? policyBySlug(slug) : undefined;

  useEffect(() => { window.scrollTo({ top: 0 }); }, [slug]);

  if (slug && !policy) {
    return (
      <InfoShell current="policies" kicker="Store policies" title={<>Page not <em>found.</em></>} intro="That policy doesn't exist. Pick one below.">
        <div className="pc-container py-10"><PolicyIndex /></div>
      </InfoShell>
    );
  }

  if (!policy) {
    return (
      <InfoShell
        current="policies"
        kicker="Store policies"
        title={<>Clear rules, <em>no surprises.</em></>}
        intro="How buying, selling, shipping and returns work at Chris Collects Co, in plain English. Every page here is the version that applies to your order."
      >
        <div className="pc-container py-10 md:py-14">
          <PolicyIndex />
          <p className="pc-policy-updated mt-8">Last updated {updatedLabel(POLICIES_UPDATED)}.</p>
        </div>
      </InfoShell>
    );
  }

  const Icon = ICONS[policy.slug] ?? FileText;
  const idx = POLICIES.findIndex((p) => p.slug === policy.slug);
  const next = POLICIES[(idx + 1) % POLICIES.length];

  return (
    <InfoShell current="policies" docTitle={policy.title} kicker="Store policies" title={<>{policy.title}</>} intro={policy.intro}>
      <div className="pc-container py-10 md:py-14 grid gap-10 lg:grid-cols-[240px_1fr]">
        <nav className="pc-faq-toc" aria-label="Policies">
          <span className="pc-field-label">All policies</span>
          <ul>
            {POLICIES.map((p) => (
              <li key={p.slug}>
                <a href={`#/policies/${p.slug}`} aria-current={p.slug === policy.slug ? "page" : undefined} className={p.slug === policy.slug ? "is-current" : undefined} data-testid={`policy-toc-${p.slug}`}>{p.title}</a>
              </li>
            ))}
          </ul>
          <a href="#/faq" className="pc-btn pc-btn-sm pc-btn-outline mt-5 w-full justify-center" data-testid="policy-cta-faq">Read the FAQ</a>
        </nav>

        <article className="pc-policy" data-testid={`policy-${policy.slug}`}>
          <header className="pc-policy-head">
            <Icon className="h-6 w-6" aria-hidden />
            <div>
              <div className="pc-field-label">{policy.purpose}</div>
              <p className="pc-policy-updated">Last updated {updatedLabel(POLICIES_UPDATED)}</p>
            </div>
          </header>
          {policy.sections.map((s) => (
            <section key={s.heading} className="pc-policy-section">
              <h2>{s.heading}</h2>
              <div className="pc-policy-body pc-body">
                {s.blocks.map((b, i) => <Block key={i} block={b} />)}
              </div>
            </section>
          ))}

          <section className="pc-info-callout mt-10" data-testid="policy-contact">
            <div>
              <h2>Questions about this policy?</h2>
              <p className="pc-body">DM {BRAND_HANDLE} — Chris reads every message, usually within the day.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-sm pc-btn-white"><SiInstagram className="h-4 w-4" /> Instagram</a>
              <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-sm pc-btn-ghost-dark"><SiTiktok className="h-4 w-4" /> TikTok</a>
            </div>
          </section>

          <a href={`#/policies/${next.slug}`} className="pc-policy-next" data-testid="policy-next">
            <span><small>Next</small>{next.title}</span>
            <ArrowRight className="h-5 w-5" aria-hidden />
          </a>
        </article>
      </div>
    </InfoShell>
  );
}

function PolicyIndex() {
  return (
    <div className="pc-policy-grid" data-testid="policy-index">
      {POLICIES.map((p) => {
        const Icon = ICONS[p.slug] ?? FileText;
        return (
          <a key={p.slug} href={`#/policies/${p.slug}`} className="pc-policy-card" data-testid={`policy-card-${p.slug}`}>
            <Icon className="h-5 w-5" aria-hidden />
            <div>
              <h3>{p.title}</h3>
              <p>{p.purpose}</p>
            </div>
            <ArrowRight className="h-4 w-4 pc-policy-card-arrow" aria-hidden />
          </a>
        );
      })}
    </div>
  );
}

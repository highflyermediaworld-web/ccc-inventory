import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquare, X, Send, ArrowRight } from "lucide-react";
import { SiInstagram } from "react-icons/si";
import { API_BASE } from "@/lib/queryClient";
import { BRAND_HANDLE, INSTAGRAM_URL } from "@/components/SocialLinks";

/**
 * "Ask CPulls" — floating storefront assistant.
 *
 * Talks to POST /api/shop/chat, which grounds the answer in the FAQ, About
 * copy, published shows and the live inventory. The transcript lives in
 * sessionStorage so it survives moving between Shop / FAQ / About.
 */

type Msg = { role: "user" | "assistant"; content: string; offline?: boolean };

const STORE_KEY = "cpulls-chat-v1";
const WELCOME =
  "Hey, I'm the CPulls shop assistant. Ask me about a card, how trades work, shipping, or where Chris is vending next.";
const SUGGESTIONS = ["Do you have any Charizard?", "How do trades work?", "Where's your next show?", "How fast do you ship?"];

function loadHistory(): Msg[] {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Msg[]) : [];
    return Array.isArray(parsed) ? parsed.slice(-20) : [];
  } catch {
    return [];
  }
}

export function ShopChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => loadHistory());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(() => messages.length > 0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(messages)); } catch { /* ignore */ }
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    setSeen(true);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, messages.length, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/shop/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => !m.offline).slice(-12).map(({ role, content }) => ({ role, content })) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: json?.message || "Something went wrong. Try again in a moment.", offline: true }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: String(json.reply || "") }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: `Couldn't reach the shop right now. DM ${BRAND_HANDLE} and a real person will answer.`, offline: true }]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function reset() {
    setMessages([]);
    try { sessionStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  }

  return (
    <>
      <button
        type="button"
        className={"pc-chat-fab" + (open ? " is-open" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="pc-chat-panel"
        aria-label={open ? "Close chat" : "Ask CPulls — chat with the shop"}
        data-testid="chat-fab"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <MessageSquare className="h-5 w-5" aria-hidden />}
        <span className="pc-chat-fab-label">{open ? "Close" : "Ask CPulls"}</span>
        {!seen && !open && <span className="pc-chat-dot" aria-hidden />}
      </button>

      {open && (
        <section id="pc-chat-panel" className="pc-chat" role="dialog" aria-label="Ask CPulls chat" data-testid="chat-panel">
          <header className="pc-chat-head">
            <img src="/logo.jpeg" alt="" width={36} height={36} />
            <div className="min-w-0">
              <strong>Ask CPulls</strong>
              <span>Shop assistant · answers from the vault, FAQ and show list</span>
            </div>
            <button type="button" className="pc-chat-x" onClick={() => setOpen(false)} aria-label="Close chat"><X className="h-4 w-4" /></button>
          </header>

          <div className="pc-chat-list" ref={listRef}>
            <div className="pc-chat-msg is-bot"><p>{WELCOME}</p></div>
            {messages.length === 0 && (
              <div className="pc-chat-suggest" aria-label="Suggested questions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} data-testid="chat-suggestion">{s} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={"pc-chat-msg " + (m.role === "user" ? "is-user" : "is-bot") + (m.offline ? " is-offline" : "")} data-testid={`chat-msg-${m.role}`}>
                <p>{m.content}</p>
                {m.offline && (
                  <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="pc-chat-dm"><SiInstagram className="h-3.5 w-3.5" /> DM on Instagram</a>
                )}
              </div>
            ))}
            {busy && (
              <div className="pc-chat-msg is-bot is-typing" aria-live="polite" aria-label="Assistant is typing">
                <span /><span /><span />
              </div>
            )}
          </div>

          <form className="pc-chat-form" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about a card, a trade, a show…"
              maxLength={800}
              aria-label="Your message"
              disabled={busy}
              data-testid="chat-input"
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send" data-testid="chat-send"><Send className="h-4 w-4" /></button>
          </form>
          <footer className="pc-chat-foot">
            <span>Not a person — Chris confirms every order and trade. Prices follow TCGplayer.</span>
            {messages.length > 0 && <button type="button" onClick={reset} data-testid="chat-reset">Clear</button>}
          </footer>
        </section>
      )}
    </>
  );
}

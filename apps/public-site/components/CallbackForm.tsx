import { useRef, useState, type FormEvent } from "react";
import { company, phoneHref } from "../lib/company";
import terms from "../lib/intake-terms.json";
import { requestId } from "../lib/request-id";

export default function CallbackForm({ business, service }: { business: boolean; service: string }) {
  const token = useRef("");
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const data = new FormData(event.currentTarget);
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = { name: data.get("name"), phone: data.get("phone"), description: data.get("description"),
        consent: data.has("consent"), version: terms.version, kind: business ? "business" : "home" };
      token.current ||= requestId();
      // Keep only a digest and the pending token across a refresh after a lost response.
      const pendingKey = "hm-pending-callback";
      try {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
        const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        const prior = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
        token.current = prior?.fingerprint === fingerprint && Date.now() - prior.time < 1800000 ? prior.id : requestId();
        sessionStorage.setItem(pendingKey, JSON.stringify({ fingerprint, id: token.current, time: Date.now() }));
      } catch { /* A retry in this form also works with storage disabled. */ }
      const result = await fetch("/api/callback", {
        method: "POST", credentials: "omit", cache: "no-store",
        headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ ...payload, id: token.current }),
      });
      const response = await result.json();
      if (result.ok && response.accepted === true) {
        setDone(true);
        try { sessionStorage.removeItem(pendingKey); } catch { /* Optional storage. */ }
      } else {
        setError(response.error || "Не удалось подтвердить отправку. Попробуйте ещё раз.");
      }
    } catch {
      setError("Связь прервалась. Проверьте интернет и повторите отправку.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (done) return <section className="section prose" role="status">
    <h1>Обращение принято</h1><p className="lede">Диспетчер увидит вашу задачу и перезвонит, чтобы уточнить детали.</p>
    <a className="button" href="/">На главную</a>
  </section>;
  return <section className="section intake-page">
    <div className="intake-intro"><h1>{business ? "Обсудить сотрудничество" : "Вызвать мастера"}</h1>
      <p className="lede">{business ? "Расскажите об объекте и нужных работах." : "Расскажите, что нужно сделать дома. Диспетчер уточнит стоимость и время визита."}</p>
      <a className="contact-number" href={phoneHref}>{company.phone}</a>
    </div>
    <form className="form-panel callback-form" onSubmit={submit}>
      <label>Как к вам обращаться<input name="name" autoComplete="name" maxLength={100} required /></label>
      <label>Телефон для связи<input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 (___) ___-__-__" maxLength={30} required /></label>
      <label>Что нужно сделать?<textarea name="description" minLength={3} maxLength={1200} rows={4} defaultValue={service} required /></label>
      <div className="consents"><label><input type="checkbox" name="consent" required /><span>Даю <a href="/callback-consent" target="_blank" rel="noreferrer">согласие на обработку персональных данных</a> для ответа на обращение.</span></label>
      <a className="fine" href="/privacy" target="_blank" rel="noreferrer">Политика конфиденциальности</a></div>
      {error && <p role="alert" className="form-error">{error} <a href={phoneHref}>{company.phone}</a></p>}
      <button className="button" type="submit" disabled={busy}>{busy ? "Отправляем…" : "Отправить обращение"}</button>
    </form>
  </section>;
}

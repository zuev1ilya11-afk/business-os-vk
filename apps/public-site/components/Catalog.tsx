import type { Service } from "../lib/types";
export const money = (n: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(n);
export function price(s: Service) {
  if (s.price_min === null || s.price_display_mode === "after_inspection")
    return "После уточнения";
  if (s.price_display_mode === "range" && s.price_max !== null)
    return `${money(s.price_min)} – ${money(s.price_max)}`;
  return `${s.price_display_mode === "from" ? "от " : ""}${money(s.price_min)} / ${s.unit}`;
}
export function Search({ query = "" }: { query?: string }) {
  return (
    <form className="search" action="/search" role="search">
      <label className="sr-only" htmlFor="service-query">
        Что нужно сделать?
      </label>
      <span aria-hidden="true">⌕</span>
      <input
        id="service-query"
        name="q"
        maxLength={200}
        placeholder="Например, повесить карниз"
        defaultValue={query}
      />
      <button type="submit">
        Найти <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
export function ServiceCards({ services }: { services: Service[] }) {
  return (
    <div className="service-grid">
      {services.map((s) => (
        <a className="service-card" href={"/services/" + s.slug} key={s.id}>
          <div className={"service-art " + s.category_slug}>
            <img src={s.image} alt="" width="300" height="180" loading="lazy" />
          </div>
          <div className="service-body">
            <small>{s.category}</small>
            <h3>{s.name}</h3>
            <p>{price(s)}</p>
            <span className="card-arrow" aria-hidden="true">
              ↗
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}
export function EmptyCatalog() {
  return (
    <div className="empty">
      <h2>Подберём работу по описанию</h2>
      <p>Не нашли подходящую услугу? Расскажите о задаче и приложите фото.</p>
      <a className="button" href="/order?quick=1">
        Описать задачу ↗
      </a>
    </div>
  );
}

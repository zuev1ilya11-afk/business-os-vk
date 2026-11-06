import type { GetServerSideProps } from "next";
import { useEffect } from "react";
import { Layout, Breadcrumbs } from "../components/Layout";
import {
  Search,
  ServiceCards,
  EmptyCatalog,
  price,
} from "../components/Catalog";
import OrderForm, { BusinessForm } from "../components/OrderForm";
import { company, faq } from "../lib/company";
import { articles } from "../lib/content";
import { track } from "../lib/analytics";
import { catalog, documents, apiRead } from "../lib/data";
import type { PageData, Service } from "../lib/types";
const categories = [
  "curtains",
  "plumbing",
  "electrical",
  "handyman",
  "appliances",
  "furniture",
];
const categoryTitles: Record<string, string> = {
  curtains: "Карнизы и шторы",
  plumbing: "Сантехника",
  electrical: "Электрика",
  handyman: "Мелкий ремонт",
  appliances: "Бытовая техника",
  furniture: "Мебель",
};
const categoryIcons: Record<string, string> = {
  curtains: "▥",
  plumbing: "♧",
  electrical: "ϟ",
  handyman: "⌘",
  appliances: "▣",
  furniture: "▤",
};
const known = [
  "/",
  "/services",
  "/search",
  "/order",
  "/business",
  "/how-it-works",
  "/guarantee",
  "/areas",
  "/articles",
  "/contacts",
  "/faq",
  "/login",
  "/privacy",
  "/consent",
  "/terms",
  "/maintenance",
  "/500",
  "/404",
];
export const getServerSideProps: GetServerSideProps<PageData> = async (ctx) => {
  const path =
    "/" + ((ctx.params?.slug as string[] | undefined) || []).join("/");
  let services: Service[] = [],
    docs: PageData["documents"] = [],
    reviews: PageData["reviews"] = [],
    unavailable = false;
  try {
    services = await catalog();
  } catch (e) {
    console.warn(
      "website_data_unavailable",
      e instanceof Error ? e.message : "unknown",
      (e as { cause?: { code?: string } })?.cause?.code || "",
    );
    unavailable = true;
  }
  if (
    ["/order", "/business", "/privacy", "/consent", "/terms"].includes(path) ||
    path.startsWith("/documents/")
  )
    try {
      docs = await documents();
    } catch (e) {
      console.warn(
        "website_data_unavailable",
        e instanceof Error ? e.message : "unknown",
        (e as { cause?: { code?: string } })?.cause?.code || "",
      );
      unavailable = true;
    }
  if (path === "/")
    try {
      reviews = (await apiRead("website/reviews")).reviews;
    } catch {
      /* No fake reviews when unavailable. */
    }
  const isCategory =
    path.startsWith("/categories/") &&
    services.some(
      (s) =>
        path === "/categories/" + s.category_slug ||
        path === "/categories/" + s.category_slug + "/" + s.subcategory_slug,
    );
  const isService =
    path.startsWith("/services/") &&
    services.some((s) => path === "/services/" + s.slug);
  const isArticle = articles.some(
    (a) => a.published && path === "/articles/" + a.slug,
  );
  const isDocument = docs.some((d) => path === "/documents/" + d.document);
  if (
    !known.includes(path) &&
    !isCategory &&
    !isService &&
    !isArticle &&
    !isDocument
  ) {
    if (
      unavailable &&
      (path.startsWith("/services/") || path.startsWith("/categories/"))
    ) {
      ctx.res.statusCode = 503;
    } else return { notFound: true };
  }
  if (path === "/maintenance") ctx.res.statusCode = 503;
  if (path === "/500") ctx.res.statusCode = 500;
  let matchedIds: string[] = [];
  if (path === "/search" && typeof ctx.query.q === "string")
    try {
      matchedIds = (
        await apiRead(
          "website/catalog?q=" + encodeURIComponent(ctx.query.q.slice(0, 200)),
        )
      ).services.map((s: Service) => s.id);
    } catch (e) {
      console.warn(
        "website_data_unavailable",
        e instanceof Error ? e.message : "unknown",
        (e as { cause?: { code?: string } })?.cause?.code || "",
      );
      unavailable = true;
    }
  ctx.res.setHeader("Cache-Control", "private, no-store");
  return {
    props: {
      path,
      matchedIds,
      query: typeof ctx.query.q === "string" ? ctx.query.q.slice(0, 200) : "",
      services,
      documents: docs,
      reviews,
      unavailable,
      staging: process.env.WEBSITE_ENV !== "production",
      nonce: String(ctx.req.headers["x-csp-nonce"] || ""),
      ...(path === "/order"
        ? {
            quick: ctx.query.quick === "1",
            selected:
              typeof ctx.query.service === "string" ? ctx.query.service : "",
          }
        : {}),
    },
  };
};
function FAQ({ nonce }: { nonce: string }) {
  return (
    <>
      <div className="faq-list">
        {faq.map(([q, a]) => (
          <details key={q}>
            <summary>
              {q}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
      <script
        suppressHydrationWarning
        nonce={nonce}
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faq.map(([name, text]) => ({
              "@type": "Question",
              name,
              acceptedAnswer: { "@type": "Answer", text },
            })),
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
function Process() {
  return (
    <div className="process-grid">
      {[
        [
          "01",
          "Расскажите, что нужно",
          "Выберите работы или опишите задачу своими словами.",
        ],
        [
          "02",
          "Согласуйте детали",
          "Уточним объём, стоимость и удобное время.",
        ],
        [
          "03",
          "Встречайте мастера",
          "Следите за заявкой и общайтесь с компанией в кабинете.",
        ],
      ].map(([n, t, p]) => (
        <article key={n}>
          <span className="step-number">{n}</span>
          <h3>{t}</h3>
          <p>{p}</p>
        </article>
      ))}
    </div>
  );
}
function Articles() {
  return (
    <div className="article-grid">
      {articles
        .filter((a) => a.published)
        .map((a) => (
          <a className="article-card" href={"/articles/" + a.slug} key={a.slug}>
            <img src={a.cover} alt="" width={380} height={200} loading="lazy" />
            <div>
              <small>{a.category}</small>
              <h3>{a.title}</h3>
              <p>{a.excerpt}</p>
              <span>Читать →</span>
            </div>
          </a>
        ))}
    </div>
  );
}
function CTA() {
  return (
    <section className="final-cta">
      <div>
        <span className="eyebrow">ОСТАЛОСЬ ОПИСАТЬ ЗАДАЧУ</span>
        <h2>
          Пусть дома всё
          <br />
          будет в порядке.
        </h2>
      </div>
      <a className="button light" href="/order?quick=1">
        Вызвать мастера ↗
      </a>
    </section>
  );
}
function Home({ services, reviews, nonce, unavailable }: PageData) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <i /> ПОМОЩЬ ПО ДОМУ В ПЕТЕРБУРГЕ
          </span>
          <h1>
            Большие планы.
            <br />
            <em>Маленькие</em>
            <br />
            дела по дому.
          </h1>
          <p>
            Карниз, розетка или новая полка —<br />
            поможем найти решение вашей задачи.
          </p>
          <Search />
          <div className="hero-hints">
            <span>Часто ищут:</span>
            <a href="/search?q=карниз">Повесить карниз</a>
            <a href="/search?q=кран">Течёт кран</a>
          </div>
        </div>
        <div className="hero-scene">
          <img
            src="/illustrations/home.svg"
            alt="Уютная комната с карнизом, светильником и настенной полкой"
            width="660"
            height="620"
            fetchPriority="high"
          />
          <div className="scene-note">
            <span>✓</span>
            <div>
              <b>Заботы о доме — нам</b>
              <small>А вам — время для своего</small>
            </div>
          </div>
          <div className="scene-pill">Дома хорошо.</div>
        </div>
      </section>
      <div className="promise-bar">
        <span>✓ Стоимость согласуем заранее</span>
        <span>✓ Заявка и сообщения в кабинете</span>
        <span>✓ Гарантия на работы — 1 год</span>
      </div>
      <section className="section">
        <div className="section-title">
          <div>
            <span className="eyebrow">ЧЕМ ПОМОЧЬ?</span>
            <h2>
              Дела найдутся.
              <br />
              Мастер тоже.
            </h2>
          </div>
          <a className="text-link" href="/services">
            Все услуги ↗
          </a>
        </div>
        {unavailable && (
          <p className="note">
            Каталог временно недоступен. Попробуйте обновить страницу позже.
          </p>
        )}
        <div className="category-grid">
          {categories
            .filter((id) => services.some((s) => s.category_slug === id))
            .map((id) => (
              <a
                href={"/categories/" + id}
                className={"category " + id}
                key={id}
              >
                <span className="category-icon" aria-hidden="true">
                  {categoryIcons[id]}
                </span>
                <b>{categoryTitles[id]}</b>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
        </div>
        <a className="help-banner" href="/order?quick=1">
          <span className="help-symbol">?</span>
          <div>
            <h3>Не знаете, что выбрать?</h3>
            <p>Опишите задачу. С составом работ поможем разобраться.</p>
          </div>
          <b>Описать задачу ↗</b>
        </a>
      </section>
      <section className="section compact-top">
        <div className="section-title">
          <h2>Для вашего дома</h2>
          <span className="muted">Работы из нашего каталога</span>
        </div>
        {services.length ? (
          <ServiceCards services={services.slice(0, 4)} />
        ) : (
          <EmptyCatalog />
        )}
      </section>
      <section className="how-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">БЕЗ ЛИШНИХ ХЛОПОТ</span>
            <h2>От задачи — к результату</h2>
          </div>
          <a className="text-link" href="/how-it-works">
            Как мы работаем ↗
          </a>
        </div>
        <Process />
      </section>
      <section className="section split-section">
        <div className="guarantee-panel">
          <span className="seal" aria-hidden="true">
            ✓
          </span>
          <span className="eyebrow">МОЖНО ОБРАТИТЬСЯ СНОВА</span>
          <h2>
            Гарантия
            <br />
            на работы — 1 год.
          </h2>
          <p>
            Если после выполнения появилась проблема, напишите по той же заявке.
            История работ останется под рукой.
          </p>
          <a href="/guarantee" className="text-link">
            Как обратиться по гарантии ↗
          </a>
        </div>
        <div className="business-panel">
          <span className="eyebrow">ДЛЯ КОМПАНИЙ</span>
          <h2>
            Чтобы рабочие
            <br />
            дела не стояли.
          </h2>
          <p>
            Нужны работы в офисе, магазине или на нескольких объектах?
            Расскажите о задаче — обсудим формат сотрудничества.
          </p>
          <a className="button secondary" href="/business">
            Обсудить сотрудничество ↗
          </a>
          <div className="business-lines" aria-hidden="true">
            ▤ ▥ ▤
          </div>
        </div>
      </section>
      <section className="section area-section">
        <div>
          <span className="eyebrow">РЯДОМ С ВАМИ</span>
          <h2>
            Работаем в<br />
            Санкт-Петербурге.
          </h2>
          <p>
            Укажите адрес: подтвердим возможность выезда
            <br />и согласуем удобное время.
          </p>
          <a className="text-link" href="/areas">
            Территория обслуживания ↗
          </a>
        </div>
        <img
          src="/illustrations/city.svg"
          alt="Иллюстрация петербургских домов"
          width="500"
          height="260"
          loading="lazy"
        />
      </section>
      {reviews.length > 0 && (
        <section className="section">
          <h2>После выполненных работ</h2>
          <div className="reviews">
            {reviews.map((r, i) => (
              <blockquote key={i}>
                <b>{r.rating} / 5</b>
                <p>{r.body}</p>
                <cite>{r.public_name}</cite>
              </blockquote>
            ))}
          </div>
        </section>
      )}
      <section className="section">
        <div className="section-title">
          <div>
            <span className="eyebrow">ПОЛЕЗНО ПЕРЕД ВИЗИТОМ</span>
            <h2>Немного о домашних делах</h2>
          </div>
          <a className="text-link" href="/articles">
            Все статьи ↗
          </a>
        </div>
        <Articles />
      </section>
      <section className="section faq-section">
        <div>
          <span className="eyebrow">ПОМОЖЕМ РАЗОБРАТЬСЯ</span>
          <h2>Есть вопросы?</h2>
          <p>Здесь — ответы на самые частые.</p>
        </div>
        <FAQ nonce={nonce} />
      </section>
      <CTA />
    </>
  );
}
export default function Page(
  data: PageData & { quick?: boolean; selected?: string },
) {
  const { path, services, query, nonce } = data;
  const service = services.find((s) => path === "/services/" + s.slug);
  const article = articles.find((a) => path === "/articles/" + a.slug);
  useEffect(() => {
    if (path === "/search") track("service_search", { count: services.length });
    if (service) track("service_view", { service_id: service.id });
  }, [path, service, services.length]);
  let title = "Мастер для ваших домашних дел",
    body: React.ReactNode;
  if (path === "/") body = <Home {...data} />;
  else if (path === "/order") {
    title = "Оформить заявку";
    body = (
      <div className="section">
        <Breadcrumbs items={[[title, path]]} nonce={nonce} />
        <OrderForm
          services={services}
          documents={data.documents}
          quick={data.quick}
          selected={data.selected}
          staging={data.staging}
        />
      </div>
    );
  } else if (
    path === "/services" ||
    path.startsWith("/categories/") ||
    path === "/search"
  ) {
    const parts = path.split("/"),
      category = parts[2],
      sub = parts[3];
    title =
      path === "/search"
        ? "Что нужно сделать?"
        : category
          ? categoryTitles[category] || "Услуги"
          : "Услуги для дома";
    let filtered = category
      ? services.filter(
          (s) =>
            s.category_slug === category &&
            (!sub || s.subcategory_slug === sub),
        )
      : services;
    if (path === "/search" && query)
      filtered = services.filter((s) => data.matchedIds?.includes(s.id));
    body = (
      <section className="section">
        <Breadcrumbs items={[[title, path]]} nonce={nonce} />
        <div className="page-intro">
          <span className="eyebrow">ДОМАШНИЙ МАСТЕР</span>
          <h1>{title}</h1>
          <p>Выберите работу. Состав и стоимость согласуем до выполнения.</p>
        </div>
        <Search query={query} />
        <nav className="filter-pills" aria-label="Категории">
          <a href="/services" className={!category ? "active" : ""}>
            Все услуги
          </a>
          {categories
            .filter((id) => services.some((s) => s.category_slug === id))
            .map((id) => (
              <a
                className={category === id ? "active" : ""}
                href={"/categories/" + id}
                key={id}
              >
                {categoryTitles[id]}
              </a>
            ))}
        </nav>
        {category && (
          <nav className="filter-pills" aria-label="Подкатегории">
            {Array.from(
              new Map(
                services
                  .filter((s) => s.category_slug === category)
                  .map((s) => [s.subcategory_slug, s.subcategory]),
              ).entries(),
            ).map(([slug, name]) => (
              <a
                key={slug}
                href={"/categories/" + category + "/" + slug}
                className={sub === slug ? "active" : ""}
              >
                {name}
              </a>
            ))}
          </nav>
        )}
        {path === "/search" && (
          <p className="muted">
            По запросу «{query}»: {filtered.length}
          </p>
        )}
        {data.unavailable ? (
          <div className="empty">
            <h2>Каталог временно недоступен</h2>
            <p>Обновите страницу через некоторое время.</p>
          </div>
        ) : filtered.length ? (
          <ServiceCards services={filtered} />
        ) : (
          <EmptyCatalog />
        )}
      </section>
    );
  } else if (service) {
    title = service.seo_title || service.name;
    body = (
      <section className="section">
        <Breadcrumbs
          items={[
            [service.category, "/categories/" + service.category_slug],
            [service.name, path],
          ]}
          nonce={nonce}
        />
        <div className="service-detail">
          <div className={"detail-art " + service.category_slug}>
            <img
              src={service.image}
              alt={service.name}
              width={600}
              height={450}
            />
          </div>
          <div>
            <span className="eyebrow">{service.category}</span>
            <h1>{service.name}</h1>
            <p>{service.full_description}</p>
            <div className="detail-price">{price(service)}</div>
            <p className="fine">
              {service.price_display_mode === "after_inspection"
                ? "Точную стоимость согласуем после уточнения задачи."
                : "Цена относится к указанной единице работ. Условия на объекте могут потребовать уточнения."}
            </p>
            <a className="button" href={"/order?service=" + service.id}>
              Оформить заявку ↗
            </a>
          </div>
        </div>
        <div className="detail-columns">
          <section>
            <h2>Что входит</h2>
            <p>{service.included_text}</p>
            <h2>Что согласуем отдельно</h2>
            <p>{service.excluded_text}</p>
          </section>
          <section>
            <h2>Что влияет на стоимость</h2>
            <p>
              Количество, длина и высота, материал поверхности, тип крепления,
              демонтаж и расходные материалы.
            </p>
            <h2>Выезд и время</h2>
            <p>
              Доступность адреса, условия выезда и продолжительность уточним по
              заявке.
            </p>
            {service.duration && <p>Ориентир: {service.duration}</p>}
            <p>{company.guarantee}</p>
            <a href="/guarantee">Порядок обращения</a>
          </section>
        </div>
        <script
          suppressHydrationWarning
          nonce={nonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Service",
              name: service.name,
              description: service.description,
              provider: { "@type": "Organization", name: company.name },
              areaServed: { "@type": "City", name: company.city },
            }).replace(/</g, "\\u003c"),
          }}
        />
      </section>
    );
  } else if (path === "/business") {
    title = "Для бизнеса";
    body = (
      <>
        <section className="section business-intro">
          <div>
            <span className="eyebrow">ДОМАШНИЙ МАСТЕР ДЛЯ КОМПАНИЙ</span>
            <h1>
              Работы на объекте.
              <br />
              Порядок в делах.
            </h1>
            <p>
              Офисы, магазины, салоны, управляющие и ремонтные компании. Обсудим
              задачи, объём и условия работы.
            </p>
            <div className="filter-pills">
              <span>Разовые задачи</span>
              <span>Несколько объектов</span>
              <span>Сотрудничество</span>
            </div>
            <p>
              Договор, документы, тарифы и формат обслуживания согласуются
              индивидуально. Здесь можно направить запрос без оформления обычной
              заявки.
            </p>
            {company.commercialProposal && (
              <a href={company.commercialProposal}>Коммерческое предложение</a>
            )}
          </div>
          <img
            src="/illustrations/city.svg"
            alt="Коммерческие объекты в городе"
            width={500}
            height={300}
          />
        </section>
        <section className="section business-form-wrap">
          <BusinessForm documents={data.documents} staging={data.staging} />
        </section>
      </>
    );
  } else if (path === "/articles") {
    title = "Полезные статьи";
    body = (
      <section className="section">
        <Breadcrumbs items={[[title, path]]} nonce={nonce} />
        <h1>Полезно для дома</h1>
        <p className="lede">
          Как описать задачу и подготовиться к визиту мастера.
        </p>
        <Articles />
      </section>
    );
  } else if (article) {
    title = article.title;
    body = (
      <article className="section prose">
        <Breadcrumbs
          items={[
            ["Статьи", "/articles"],
            [title, path],
          ]}
          nonce={nonce}
        />
        <span className="eyebrow">{article.category}</span>
        <h1>{title}</h1>
        <p className="lede">{article.excerpt}</p>
        <img src={article.cover} alt="" width={760} height={360} />
        {article.body.split("\n\n").map((block, i) =>
          block.startsWith("## ") ? (
            <section key={i}>
              <h2>{block.split("\n")[0].slice(3)}</h2>
              <p>{block.split("\n").slice(1).join("\n")}</p>
            </section>
          ) : (
            <p key={i}>{block}</p>
          ),
        )}
        <h2>Услуги по теме</h2>
        <ServiceCards
          services={services.filter((s) =>
            article.related_services.includes(s.slug),
          )}
        />
      </article>
    );
  } else if (path === "/faq") {
    title = "Вопросы и ответы";
    body = (
      <section className="section prose">
        <h1>{title}</h1>
        <FAQ nonce={nonce} />
      </section>
    );
  } else if (path === "/how-it-works") {
    title = "Как мы работаем";
    body = (
      <section className="section">
        <h1>Простой путь к порядку</h1>
        <Process />
        <div className="prose">
          <h2>Одна заявка — вся история</h2>
          <p>
            После подтверждения телефона заявка появится в кабинете. Компания
            уточнит задачу, предложит смету и согласует визит. Назначенный
            мастер, сообщения и изменения будут доступны в этой же карточке.
          </p>
          <h2>Изменения — с согласованием</h2>
          <p>
            Если нужны дополнительные работы, компания подготовит новую версию
            сметы. Проверьте её и подтвердите в кабинете.
          </p>
        </div>
        <CTA />
      </section>
    );
  } else if (path === "/guarantee") {
    title = "Гарантия и обращение";
    body = (
      <section className="section prose">
        <span className="eyebrow">ПОМОЩЬ ПО ВЫПОЛНЕННЫМ РАБОТАМ</span>
        <h1>{company.guarantee}</h1>
        <p>{company.guaranteeNote}</p>
        <ol className="large-list">
          <li>Откройте завершённую заявку в кабинете.</li>
          <li>Нажмите «Помощь по работе» и опишите проблему.</li>
          <li>Добавьте фотографии в заявку и удобное время связи.</li>
          <li>Ответ компании появится в истории обращения.</li>
        </ol>
        <a className="button" href={company.cabinet + "#orders"}>
          Открыть мои заявки ↗
        </a>
        <p className="fine">
          Подробные условия указываются в согласованных документах по услугам.
        </p>
      </section>
    );
  } else if (path === "/areas") {
    title = "Территория обслуживания";
    body = (
      <section className="section prose">
        <h1>Санкт-Петербург</h1>
        <img
          src="/illustrations/city.svg"
          alt="Петербургские дома — иллюстрация"
          width={760}
          height={360}
        />
        <p className="lede">
          Укажите район и точный адрес в заявке. Компания подтвердит возможность
          выезда и его условия.
        </p>
        <p>
          Не обещаем выезд по адресу до согласования. Список районов с
          отдельными тарифами пока не утверждён.
        </p>
        <a className="button" href="/order?quick=1">
          Указать адрес ↗
        </a>
      </section>
    );
  } else if (path === "/contacts") {
    title = "Контакты";
    body = (
      <section className="section prose">
        <h1>На связи по вашим делам</h1>
        <p className="lede">
          {company.name} · {company.city}
        </p>
        {company.phone && (
          <p>
            <a href={"tel:" + company.phone}>{company.phone}</a>
          </p>
        )}
        {company.email && (
          <p>
            <a href={"mailto:" + company.email}>{company.email}</a>
          </p>
        )}
        {company.address && <p>{company.address}</p>}
        <a className="button" href={company.cabinet + "#messages"}>
          Написать компании ↗
        </a>
        {!company.phone && (
          <p className="note">
            Контактный телефон, email и реквизиты будут размещены после
            подтверждения компанией.
          </p>
        )}
      </section>
    );
  } else if (path === "/login") {
    title = "Личный кабинет";
    body = (
      <section className="section prose">
        <h1>
          Ваши домашние дела
          <br />в одном месте.
        </h1>
        <p>
          Заявки, мастер, время визита, сметы и сообщения. Вход по
          подтверждённому телефону.
        </p>
        <a className="button" href={company.cabinet}>
          Войти в кабинет ↗
        </a>
      </section>
    );
  } else if (
    ["/privacy", "/consent", "/terms"].includes(path) ||
    path.startsWith("/documents/")
  ) {
    const id =
      (
        {
          "/privacy": "privacy",
          "/consent": "personal-data",
          "/terms": "services",
        } as Record<string, string>
      )[path] || path.split("/")[2];
    const doc = data.documents.find((d) => d.document === id);
    title = doc?.title || "Документ временно недоступен";
    body = (
      <section className="section prose">
        <h1>{title}</h1>
        {doc ? (
          <>
            <p className="note">
              Версия {doc.version}
              {!doc.reviewed ? " · Не утверждён для публичного запуска" : ""}
            </p>
            <div className="legal-text">{doc.body}</div>
          </>
        ) : (
          <p>Попробуйте открыть страницу позже.</p>
        )}
      </section>
    );
  } else {
    title = data.unavailable
      ? "Сервис временно недоступен"
      : path === "/maintenance"
        ? "Техническое обслуживание"
        : path === "/500"
          ? "Не удалось открыть страницу"
          : "Страница не найдена";
    body = (
      <section className="section prose">
        <h1>{title}</h1>
        <p>Попробуйте позже или вернитесь на главную.</p>
        <a className="button" href="/">
          На главную ↗
        </a>
      </section>
    );
  }
  return (
    <Layout
      title={title}
      description={service?.seo_description || article?.seo_description}
      path={path}
      nonce={nonce}
      staging={data.staging}
      noindex={[
        "/order",
        "/login",
        "/search",
        "/maintenance",
        "/500",
        "/404",
      ].includes(path)}
    >
      {body}
    </Layout>
  );
}

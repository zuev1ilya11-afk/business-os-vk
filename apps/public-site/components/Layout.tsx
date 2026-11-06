import Head from "next/head";
import { company } from "../lib/company";
import { track } from "../lib/analytics";
import type { ReactNode } from "react";
export function Layout({
  children,
  title,
  description,
  path = "/",
  staging = false,
  nonce = "",
  noindex = false,
}: {
  children: ReactNode;
  title: string;
  description?: string;
  path?: string;
  staging?: boolean;
  nonce?: string;
  noindex?: boolean;
}) {
  const canonical = company.siteUrl ? new URL(path, company.siteUrl).href : "";
  return (
    <>
      <Head>
        <title>{`${title} · ${company.name}`}</title>
        <meta
          name="description"
          content={
            description ||
            "Услуги мастеров в Санкт-Петербурге. Опишите задачу, согласуйте работы и следите за заявкой в личном кабинете."
          }
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="robots"
          content={staging || noindex ? "noindex,nofollow" : "index,follow"}
        />
        {canonical && <link rel="canonical" href={canonical} />}
        <meta property="og:title" content={`${title} · ${company.name}`} />
        <meta property="og:type" content="website" />
        {canonical && <meta property="og:url" content={canonical} />}
        <meta property="og:locale" content="ru_RU" />
        {company.siteUrl && (
          <script
            suppressHydrationWarning
            nonce={nonce}
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "Organization",
                name: company.name,
                url: company.siteUrl,
                ...(company.phone ? { telephone: company.phone } : {}),
              }).replace(/</g, "\\u003c"),
            }}
          />
        )}
      </Head>
      <a className="skip" href="#main">
        К содержанию
      </a>
      {staging && (
        <div className="stage-strip">
          Тестовая версия · заявки не вызывают реального мастера
        </div>
      )}
      <header className="header">
        <a className="brand" href="/" aria-label="Домашний мастер — главная">
          <img
            className="company-logo"
            src="/brand-logo.svg"
            width="48"
            height="48"
            alt=""
          />
          <span>
            домашний
            <br />
            <b>мастер</b>
          </span>
        </a>
        <span className="city">
          <i /> Санкт-Петербург
        </span>
        <nav aria-label="Основная навигация">
          <a href="/services">Услуги</a>
          <a href="/business">Для бизнеса</a>
          <a href="/contacts">Контакты</a>
        </nav>
        <a
          className="cabinet"
          href={company.cabinet}
          onClick={() => track("open_cabinet")}
        >
          <span aria-hidden="true">◉</span> Личный кабинет
        </a>
      </header>
      <main id="main">{children}</main>
      <footer>
        <div className="footer-top">
          <div>
            <a className="brand" href="/">
              домашний <b>мастер</b>
            </a>
            <p>
              Помогаем с делами по дому.
              <br />
              Санкт-Петербург
            </p>
          </div>
          <div>
            <b>Услуги</b>
            <a href="/services">Все услуги</a>
            <a href="/how-it-works">Как мы работаем</a>
            <a href="/guarantee">Гарантия</a>
            <a href="/areas">Районы</a>
          </div>
          <div>
            <b>Компания</b>
            <a href="/business">Для бизнеса</a>
            <a href="/articles">Полезные статьи</a>
            <a href="/faq">Вопросы и ответы</a>
            <a href="/contacts">Контакты</a>
          </div>
          <div>
            <b>На связи</b>
            {company.phone ? (
              <a
                href={"tel:" + company.phone}
                onClick={() => track("call_click")}
              >
                {company.phone}
              </a>
            ) : (
              <a href={company.cabinet + "#messages"}>Написать компании</a>
            )}
            <a href="/order?quick=1">Описать задачу →</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Домашний мастер</span>
          <a href="/privacy">Конфиденциальность</a>
          <a href="/consent">Обработка данных</a>
          <a href="/terms">Условия услуг</a>
        </div>
      </footer>
      <a className="mobile-cta" href="/order">
        Оформить заявку <span>↗</span>
      </a>
    </>
  );
}
export function Breadcrumbs({
  items,
  nonce,
}: {
  items: [string, string][];
  nonce: string;
}) {
  return (
    <>
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <a href="/">Главная</a>
        {items.map(([name, href]) => (
          <span key={href}>
            {" "}
            / <a href={href}>{name}</a>
          </span>
        ))}
      </nav>
      <script
        suppressHydrationWarning
        nonce={nonce}
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [["Главная", "/"], ...items].map(
              ([name, p], i) => ({
                "@type": "ListItem",
                position: i + 1,
                name,
                ...(company.siteUrl
                  ? { item: new URL(p, company.siteUrl).href }
                  : {}),
              }),
            ),
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}

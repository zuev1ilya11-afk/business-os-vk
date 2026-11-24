import Head from "next/head";
import type { ReactNode } from "react";
import { company, phoneHref } from "../lib/company";

const navigation = [
  ["Услуги", "/services"],
  ["Фасады", "/facades"],
  ["Наши работы", "/#works"],
  ["О компании", "/how-it-works"],
  ["Для бизнеса", "/business"],
  ["Контакты", "/contacts"],
];
export function Layout({ children, title, description, path = "/", staging = false, nonce = "", noindex = false }: {
  children: ReactNode;
  callbackReady?: boolean;
  title: string;
  description?: string;
  path?: string;
  staging?: boolean;
  nonce?: string;
  noindex?: boolean;
}) {
  const canonical = company.siteUrl ? new URL(path, company.siteUrl).href : "";
  const summary = description || "Бытовые, монтажные и фасадные работы в Санкт-Петербурге: монтаж карнизов и штор, сантехника, электрика, подключение техники, утепление и отделка фасадов.";
  return (
    <div className="hm-site">
      <Head>
        <title>{title + " · " + company.name}</title>
        <meta name="description" content={summary} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content={staging || noindex ? "noindex,nofollow" : "index,follow"} />
        {canonical && <link rel="canonical" href={canonical} />}
        <meta property="og:title" content={title + " · " + company.name} />
        <meta property="og:description" content={summary} />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content="ru_RU" />
        {canonical && <meta property="og:url" content={canonical} />}
        <link rel="icon" href="/brand-logo.svg" type="image/svg+xml" />
        {company.siteUrl && <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify({
          "@context": "https://schema.org", "@type": "HomeAndConstructionBusiness",
          name: company.name, url: company.siteUrl, telephone: company.phone,
          email: company.email, areaServed: company.city
        }).replace(/</g, "\\u003c")}} />}
      </Head>
      <a className="hm-skip" href="#main">К содержанию</a>
      {staging && <div className="hm-stage">Тестовая версия сайта</div>}
      <header className="hm-header">
        <div className="hm-shell hm-header-inner">
          <a className="hm-brand" href="/" aria-label="Домашний мастер — главная">
            <img src="/brand-house.svg" width="44" height="44" alt="" />
            <span>Домашний мастер<small>Монтаж, ремонт и фасадные работы</small></span>
          </a>
          <nav className="hm-desktop-nav" aria-label="Основная навигация">
            {navigation.map(([label, url]) => <a key={url} href={url} aria-current={path === url ? "page" : undefined}>{label}</a>)}
          </nav>
          <a className="hm-header-call" href={phoneHref}>{company.phone} <span aria-hidden="true">↗</span></a>
          <details className="hm-mobile-menu">
            <summary>Меню <span aria-hidden="true">+</span></summary>
            <nav aria-label="Мобильная навигация">
              {navigation.map(([label, url]) => <a key={url} href={url}>{label}</a>)}
              <a href={phoneHref}>{company.phone}</a>
              <a href={"mailto:" + company.email}>{company.email}</a>
            </nav>
          </details>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="hm-footer">
        <div className="hm-shell hm-footer-grid">
          <div><a className="hm-brand hm-footer-brand" href="/"><img src="/brand-house.svg" width="44" height="44" alt=""/><span>Домашний мастер</span></a><p>Монтаж, ремонт и забота о доме.<br/>Санкт-Петербург</p></div>
          <div><h2>Компания</h2><a href="/services">Услуги</a><a href="/facades">Фасадные работы</a><a href="/#works">Примеры работ</a><a href="/how-it-works">Как мы работаем</a><a href="/business">Сотрудничество</a><a href="/guarantee">Гарантия</a></div>
          <div><h2>Информация</h2><a href="/areas">Районы обслуживания</a><a href="/articles">Полезные статьи</a><a href="/faq">Вопросы и ответы</a><a href="/contacts">Контакты</a></div>
          <div><h2>Связаться</h2><a className="hm-footer-phone" href={phoneHref}>{company.phone}</a><a href={"mailto:" + company.email}>{company.email}</a><p>ИП Шагалина И.Б.</p></div>
        </div>
        <div className="hm-shell hm-footer-bottom"><span>© {new Date().getFullYear()} Домашний мастер</span><a href="/privacy">Политика конфиденциальности</a><span>Санкт-Петербург</span></div>
      </footer>
      <div className="hm-mobile-contact"><a href={phoneHref}>Позвонить <span aria-hidden="true">↗</span></a><a href={"mailto:" + company.email}>Написать <span aria-hidden="true">↗</span></a></div>
    </div>
  );
}
export function Breadcrumbs({items, nonce: _nonce}: {items: [string, string][]; nonce: string}) {
  return <nav className="hm-shell hm-breadcrumbs" aria-label="Хлебные крошки"><a href="/">Главная</a>{items.map(([name, href]) => <span key={href}> / <a href={href}>{name}</a></span>)}</nav>;
}

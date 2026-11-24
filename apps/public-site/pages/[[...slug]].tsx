import type { GetServerSideProps } from "next";
import type { ReactNode } from "react";
import { Layout, Breadcrumbs } from "../components/Layout";
import { company, phoneHref } from "../lib/company";
import serviceList from "../lib/service-list.json";
import { articles } from "../lib/content";
import SitePrivacy from "../components/SitePrivacy";

const groups = [
  { id: "curtains", name: "Карнизы и шторы", note: "Потолочные и настенные карнизы, рулонные шторы и жалюзи." },
  { id: "plumbing", name: "Сантехника", note: "Установка и замена смесителей, сантехнического оборудования." },
  { id: "electrical", name: "Электрика", note: "Монтаж светильников, замена розеток и выключателей." },
  { id: "handyman", name: "Мелкий ремонт", note: "Навеска полок, телевизоров и других предметов интерьера." },
  { id: "appliances", name: "Бытовая техника", note: "Подключение стиральных и посудомоечных машин." },
  { id: "furniture", name: "Мебель", note: "Сборка мебели и ремонт отдельных деталей." },
];
const steps = [
  ["Обсуждаем задачу", "Вы звоните или пишете нам. Уточняем, какие работы нужны, и условия монтажа."],
  ["Согласуем детали", "Обсуждаем объём, предварительную стоимость и удобное время визита."],
  ["Выполняем работу", "Мастер приезжает в согласованное время и выполняет работы."],
  ["Проверяем результат", "Вы принимаете выполненную работу. При необходимости остаёмся на связи."],
];
const questions = [
  ["Как договориться о визите?", "Позвоните или напишите нам. Расскажите, какие работы нужны, и назовите удобное время."],
  ["Как узнать стоимость?", "Стоимость зависит от объёма работ, размеров, материала основания и необходимых дополнительных операций. Уточним детали и согласуем стоимость перед началом работ."],
  ["Нужно ли покупать крепёж самостоятельно?", "Это зависит от комплекта и поверхности. Сообщите нам модель изделия и имеющиеся крепления, чтобы заранее обсудить недостающие материалы."],
  ["Что делать, если требуется демонтаж?", "Сообщите об этом при первом обращении. Демонтаж и другие дополнительные работы согласуем отдельно."],
  ["Как обратиться по гарантии?", "Позвоните в компанию, сообщите дату и адрес выполненных работ. Уточним условия и порядок дальнейших действий."],
];
const fixedPages: Record<string, string> = {
  "/": "Мастерские услуги для дома", "/services": "Наши услуги",
  "/business": "Сотрудничество", "/how-it-works": "О компании и наш подход",
  "/guarantee": "Гарантия", "/areas": "Районы обслуживания",
  "/articles": "Полезные статьи", "/contacts": "Контакты",
  "/faq": "Вопросы и ответы", "/privacy": "Политика конфиденциальности",
  "/maintenance": "Временные работы на сайте", "/500": "Временная ошибка",
};
type Props = {path: string; staging: boolean; nonce: string};
export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const path = "/" + ((ctx.params?.slug as string[] | undefined) || []).join("/");
  if (["/order", "/request", "/login", "/terms"].includes(path))
    return {redirect: {destination: "/contacts", permanent: false}};
  if (["/consent", "/callback-consent"].includes(path) || path.startsWith("/documents/"))
    return {redirect: {destination: "/privacy", permanent: false}};
  if (path === "/search") return {redirect: {destination: "/services", permanent: false}};
  const valid = Object.prototype.hasOwnProperty.call(fixedPages, path) ||
    serviceList.some(s => path === "/services/" + s.slug || path === "/categories/" + s.category_slug || path === "/categories/" + s.category_slug + "/" + s.subcategory_slug) ||
    articles.some(a => a.published && path === "/articles/" + a.slug);
  if (!valid) return {notFound: true};
  if (path === "/maintenance") ctx.res.statusCode = 503;
  if (path === "/500") ctx.res.statusCode = 500;
  ctx.res.setHeader("Cache-Control", "private, no-store");
  return {props: {path, staging: process.env.WEBSITE_ENV !== "production", nonce: String(ctx.req.headers["x-csp-nonce"] || "")}};
};
function ContactButtons({ secondary = true }: { secondary?: boolean }) {
  return <div className="hm-actions"><a className="hm-btn" href={phoneHref}>Позвонить <span aria-hidden="true">↗</span></a>{secondary && <a className="hm-btn hm-btn-outline" href={"mailto:" + company.email}>Написать на почту <span aria-hidden="true">↗</span></a>}</div>;
}
function Heading({kicker, title, children}: {kicker: string; title: string; children?: ReactNode}) {
  return <div className="hm-section-head"><div><span className="hm-kicker">{kicker}</span><h2>{title}</h2></div>{children}</div>;
}
function Categories() {
  return <div className="hm-services-grid">{groups.map((g, i) => <a className={"hm-service-card hm-service-" + g.id} key={g.id} href={"/categories/" + g.id}><div className="hm-service-top"><span className="hm-index">{String(i + 1).padStart(2,"0")}</span><span className="hm-card-arrow" aria-hidden="true">↗</span></div><img src={"/illustrations/" + g.id + ".svg"} width="104" height="104" alt="" loading="lazy"/><div><h3>{g.name}</h3><p>{g.note}</p></div></a>)}</div>;
}
function Process() {
  return <div className="hm-steps">{steps.map(([title, text],i) => <div key={title} className="hm-step"><span className="hm-index">{String(i+1).padStart(2,"0")} /</span><h3>{title}</h3><p>{text}</p></div>)}</div>;
}
function FAQ() {
  return <div className="hm-faq">{questions.map(([q,a]) => <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div>;
}
function ContactBanner() {
  return <section className="hm-contact-band"><div className="hm-shell hm-contact-inner"><div><span className="hm-kicker">СВЯЗЬ С КОМПАНИЕЙ</span><h2>Обсудим вашу задачу.</h2><p>Расскажите, что нужно установить или отремонтировать.</p></div><div><a className="hm-large-phone" href={phoneHref}>{company.phone}</a><a className="hm-mail" href={"mailto:" + company.email}>{company.email} ↗</a></div></div></section>;
}
function ArticleList() {
  return <div className="hm-article-grid">{articles.filter(a => a.published).map(a => <a className="hm-article-card" href={"/articles/" + a.slug} key={a.slug}><div className="hm-article-art"><img src={a.cover} alt="" width="100" height="100" loading="lazy"/></div><span className="hm-kicker">{a.category}</span><h3>{a.title}</h3><p>{a.excerpt}</p><span className="hm-link">Читать статью ↗</span></a>)}</div>;
}
function Home() {
  return <>
    <section className="hm-shell hm-hero">
      <div className="hm-hero-copy">
        <span className="hm-kicker hm-location"><i/> САНКТ-ПЕТЕРБУРГ · УСЛУГИ ДЛЯ ДОМА</span>
        <h1>Забота о доме.<br/><em>В деталях.</em></h1>
        <p>От установки карнизов до подключения техники. Помогаем с монтажом, ремонтом и обустройством вашего пространства.</p>
        <div className="hm-actions"><a className="hm-btn" href="/services">Наши услуги <span aria-hidden="true">↗</span></a><a className="hm-btn hm-btn-outline" href={phoneHref}>Позвонить <span aria-hidden="true">↗</span></a></div>
        <div className="hm-hero-note"><span className="hm-dot"/> Согласовываем стоимость и время до начала работ.</div>
      </div>
      <div className="hm-hero-visual"><img src="/interior.webp" alt="Светлый современный интерьер с оконным текстилем" width="960" height="960" fetchPriority="high"/><div className="hm-visual-label"><span>ДОМАШНИЙ МАСТЕР</span><span>САНКТ-ПЕТЕРБУРГ</span></div></div>
    </section>
    <div className="hm-shell hm-values"><div><span>01</span><strong>Понятные условия</strong><small>Обсуждаем объём и стоимость</small></div><div><span>02</span><strong>Аккуратный монтаж</strong><small>Учитываем особенности помещения</small></div><div><span>03</span><strong>Ответственность</strong><small>Гарантия на работы — 1 год*</small></div></div>
    <section className="hm-shell hm-section" id="services"><Heading kicker="01 / НАПРАВЛЕНИЯ" title="Что мы делаем"><a className="hm-link" href="/services">Все услуги ↗</a></Heading><Categories/></section>
    <section className="hm-about"><div className="hm-shell hm-about-inner"><div className="hm-about-art"><img src="/interior-small.webp" alt="Детали домашнего интерьера" width="540" height="540" loading="lazy"/></div><div><span className="hm-kicker">02 / О КОМПАНИИ</span><h2>Дом начинается<br/>с мелочей.</h2><p>«Домашний мастер» — сервис бытового монтажа и ремонта в Санкт-Петербурге. Наша задача — сделать организацию домашних работ понятной: обсудить детали, подобрать подходящего специалиста и согласовать визит.</p><a className="hm-btn hm-btn-outline" href="/how-it-works">Наш подход ↗</a></div></div></section>
    <section className="hm-shell hm-section"><Heading kicker="03 / ПРОЦЕСС" title="Как мы работаем"/><Process/><p className="hm-fine">* Порядок обращения и применимые условия гарантии уточняются по конкретной работе. <a href="/guarantee">Подробнее</a>.</p></section>
    <section className="hm-shell hm-section hm-partner"><div><span className="hm-kicker">04 / ПАРТНЁРАМ</span><h2>Вместе создаём<br/>качественный сервис.</h2><p>Открыты к сотрудничеству с магазинами, дизайнерами интерьера и ремонтными компаниями.</p></div><a className="hm-btn hm-btn-outline" href="/business">Для бизнеса ↗</a></section>
    <section className="hm-shell hm-section"><Heading kicker="05 / ВОПРОСЫ" title="Частые вопросы"/><FAQ/></section>
    <ContactBanner/>
  </>;
}
function Intro({title, text, kicker = "ДОМАШНИЙ МАСТЕР"}: {title:string; text?:string; kicker?:string}) {
  return <div className="hm-page-intro"><span className="hm-kicker">{kicker}</span><h1>{title}</h1>{text && <p>{text}</p>}</div>;
}
function ServiceRows({list}: {list: typeof serviceList}) {
  return <div className="hm-service-rows">{list.map(s => <a key={s.slug} href={"/services/" + s.slug}><div><h3>{s.name}</h3><p>{s.description}</p></div><span className="hm-card-arrow" aria-hidden="true">↗</span></a>)}</div>;
}
export default function Page({path, staging, nonce}: Props) {
  const service = serviceList.find(s => path === "/services/" + s.slug);
  const group = groups.find(g => path === "/categories/" + g.id || path.startsWith("/categories/" + g.id + "/"));
  const article = articles.find(a => a.published && path === "/articles/" + a.slug);
  const title = service ? service.name : group ? group.name : article ? article.title : fixedPages[path] || "Домашний мастер";
  const description = service?.description || article?.excerpt || group?.note;
  let body: ReactNode;
  if (path === "/") body = <Home/>;
  else if (path === "/privacy") body = <SitePrivacy consent={false} portal={false}/>;
  else {
    let inner: ReactNode;
    if (path === "/services") inner = <><Intro title="Наши услуги" text="Монтаж, ремонт и подключение оборудования для дома. Выберите нужное направление."/><Categories/></>;
    else if (group) {
      const sub = path.split("/")[3];
      inner = <><Intro title={group.name} text={group.note}/><ServiceRows list={serviceList.filter(s => s.category_slug === group.id && (!sub || s.subcategory_slug === sub))}/></>;
    }
    else if (service) inner = <><Intro title={service.name} text={service.description} kicker={service.category}/><div className="hm-detail"><img src={"/illustrations/" + service.category_slug + ".svg"} width="180" height="180" alt=""/><div><h2>Что важно знать</h2><p>Объём установки, необходимые материалы и дополнительные работы уточняем перед визитом.</p><p>Стоимость зависит от конкретной задачи и условий на месте.</p><ContactButtons/></div></div></>;
    else if (path === "/how-it-works") inner = <><Intro title="Работаем с вниманием к деталям." text="«Домашний мастер» — сервис бытового монтажа и ремонта в Санкт-Петербурге."/><Process/><div className="hm-prose"><h2>Наш подход</h2><p>Заранее обсуждаем объём работ, стоимость и время. После выполнения вы принимаете результат, а при необходимости можете связаться с компанией.</p></div></>;
    else if (path === "/business") inner = <><Intro title="Сотрудничество" text="Вместе с партнёрами помогаем клиентам организовать монтаж и бытовые работы."/><div className="hm-business-grid">{["Магазины и поставщики","Ремонтные компании","Дизайнеры интерьера"].map(s=><div key={s}><h2>{s}</h2><p>Обсудим формат совместной работы, перечень услуг и порядок взаимодействия.</p></div>)}</div><div className="hm-prose"><h2>Связаться по вопросам сотрудничества</h2><p>Расскажите о вашей компании и предполагаемом формате сотрудничества.</p><ContactButtons/></div></>;
    else if (path === "/contacts") inner = <><Intro title="Контакты" text="Свяжитесь с нами напрямую — по телефону или электронной почте."/><div className="hm-contact-cards"><div><span className="hm-kicker">ТЕЛЕФОН</span><a href={phoneHref}>{company.phone}</a><p>Для обсуждения работ и визита мастера.</p></div><div><span className="hm-kicker">ЭЛЕКТРОННАЯ ПОЧТА</span><a href={"mailto:" + company.email}>{company.email}</a><p>Для вопросов и делового сотрудничества.</p></div><div><span className="hm-kicker">КОМПАНИЯ</span><strong>ИП Шагалина И.Б.</strong><p>Санкт-Петербург</p></div></div></>;
    else if (path === "/guarantee") inner = <><Intro title="Гарантия на работы" text={company.guarantee}/><div className="hm-prose"><p>{company.guaranteeNote}</p><p>Если после визита возник вопрос по выполненной работе, свяжитесь с нами, сообщите дату и адрес работ. Уточним ситуацию и дальнейшие действия.</p><ContactButtons/></div></>;
    else if (path === "/areas") inner = <><Intro title="Работаем в Санкт-Петербурге" text="Возможность выезда по конкретному адресу и время визита уточняйте по телефону."/><ContactButtons/></>;
    else if (path === "/faq") inner = <><Intro title="Вопросы и ответы"/><FAQ/></>;
    else if (path === "/articles") inner = <><Intro title="Полезные статьи" text="Как подготовиться к визиту мастера и заранее обсудить детали работ."/><ArticleList/></>;
    else if (article) inner = <><Intro title={article.title} text={article.excerpt} kicker={article.category}/><article className="hm-prose">{article.body.split("\n\n").map((part,i) => {const [first,...rest] = part.split("\n");return first.startsWith("## ") ? <section key={i}><h2>{first.slice(3)}</h2><p>{rest.join(" ")}</p></section> : <p key={i}>{part}</p>;})}</article></>;
    else inner = <><Intro title={title} text="Попробуйте открыть сайт чуть позже или свяжитесь с нами по телефону."/><ContactButtons/></>;
    body = <><Breadcrumbs items={[[title,path]]} nonce={nonce}/><section className="hm-shell hm-page">{inner}</section>{path !== "/contacts" && <ContactBanner/>}</>;
  }
  return <Layout title={title} description={description} path={path} staging={staging} nonce={nonce} noindex={["/maintenance","/500"].includes(path)}>{body}</Layout>;
}

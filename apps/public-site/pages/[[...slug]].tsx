import type { GetServerSideProps } from "next";
import type { ReactNode } from "react";
import { Layout, Breadcrumbs } from "../components/Layout";
import { company, phoneHref } from "../lib/company";
import serviceList from "../lib/service-list.json";
import { articles } from "../lib/content";
import SitePrivacy from "../components/SitePrivacy";
import ApprovedHome, { ServicePhoto } from "../components/ApprovedHome";
import { BusinessDetails, CompanyProfile, FacadeDetails, FacadeHighlight, facadeDescription } from "../components/CompanyProfile";
import { CareersContent, CompanyFacts, DocumentsContent, FeedbackContent, QualitySection, TeamSection, siteFaq } from "../components/CompanyContent";

const groups = [
  { id: "curtains", name: "Карнизы и шторы", note: "Потолочные и настенные карнизы, рулонные шторы и жалюзи." },
  { id: "plumbing", name: "Сантехника", note: "Установка и замена смесителей, сантехнического оборудования." },
  { id: "electrical", name: "Электрика", note: "Монтаж светильников, замена розеток и выключателей." },
  { id: "handyman", name: "Мелкий ремонт", note: "Навеска полок, телевизоров и других предметов интерьера." },
  { id: "appliances", name: "Бытовая техника", note: "Подключение стиральных и посудомоечных машин." },
  { id: "furniture", name: "Мебель", note: "Сборка мебели и ремонт отдельных деталей." },
];
const steps = [
  ["Обсуждаем задачу", "Вы связываетесь с нами. Уточняем, какие работы нужны, и условия монтажа."],
  ["Согласуем детали", "Обсуждаем объём, предварительную стоимость и удобное время визита."],
  ["Выполняем работу", "Мастер приезжает в согласованное время и выполняет работы."],
  ["Проверяем результат", "Вы принимаете выполненную работу. При необходимости остаёмся на связи."],
];
const questions = siteFaq;
const fixedPages: Record<string, string> = {
  "/": "Бытовые, монтажные и фасадные работы", "/services": "Наши услуги", "/facades": "Фасадные работы и утепление в Санкт-Петербурге",
  "/business": "Сотрудничество", "/how-it-works": "О компании и наш подход",
  "/guarantee": "Гарантия", "/areas": "Районы обслуживания",
  "/articles": "Полезные статьи", "/contacts": "Контакты",
  "/faq": "Вопросы и ответы", "/privacy": "Политика конфиденциальности",
  "/quality": "Контроль качества", "/careers": "Сотрудничество с мастерами", "/documents": "Документы и реквизиты", "/feedback": "Отзывы и обратная связь",
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
  return <div className="hm-actions">{company.phone && <a className="hm-btn" href={phoneHref}>Позвонить <span aria-hidden="true">↗</span></a>}{(secondary || !company.phone) && <a className={company.phone?"hm-btn hm-btn-outline":"hm-btn"} href={"mailto:" + company.email}>Написать на почту <span aria-hidden="true">↗</span></a>}</div>;
}
function Categories() {
  return <div className="hm-services-grid">{groups.map((g, i) => <a className={"hm-service-card hm-service-" + g.id} key={g.id} href={"/categories/" + g.id}><div className="hm-service-top"><span className="hm-index">{String(i + 1).padStart(2,"0")}</span><span className="hm-card-arrow" aria-hidden="true">↗</span></div><ServicePhoto key={g.id} category={g.id} alt={g.name}/><div><h3>{g.name}</h3><p>{g.note}</p></div></a>)}</div>;
}
function Process() {
  return <div className="hm-steps">{steps.map(([title, text],i) => <div key={title} className="hm-step"><span className="hm-index">{String(i+1).padStart(2,"0")} /</span><h3>{title}</h3><p>{text}</p></div>)}</div>;
}
function FAQ() {
  return <div className="hm-faq">{questions.map(([q,a]) => <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div>;
}
function ContactBanner() {
  return <section className="hm-contact-band"><div className="hm-shell hm-contact-inner"><div><span className="hm-kicker">СВЯЗЬ С КОМПАНИЕЙ</span><h2>Обсудим вашу задачу.</h2><p>Расскажите, что нужно установить или отремонтировать.</p></div><div>{company.phone && <a className="hm-large-phone" href={phoneHref}>{company.phone}</a>}<a className="hm-mail" href={"mailto:" + company.email}>{company.email} ↗</a></div></div></section>;
}
function ArticleList() {
  return <div className="hm-article-grid">{articles.filter(a => a.published).map(a => <a className="hm-article-card" href={"/articles/" + a.slug} key={a.slug}><div className="hm-article-art"><img src={a.cover} alt="" width="420" height="240" loading="lazy"/></div><span className="hm-kicker">{a.category}</span><h3>{a.title}</h3><p>{a.excerpt}</p><span className="hm-link">Читать статью ↗</span></a>)}</div>;
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
  const description = path === "/facades" ? facadeDescription : service?.description || article?.excerpt || group?.note;
  let body: ReactNode;
  if (path === "/") body = <ApprovedHome/>;
  else if (path === "/privacy") body = <SitePrivacy consent={false} portal={false}/>;
  else {
    let inner: ReactNode;
    if (path === "/services") inner = <><Intro title="Наши услуги" text="Бытовой монтаж, ремонт и подключение оборудования, фасадные работы. Выберите нужное направление."/><Categories/><FacadeHighlight/></>;
    else if (path === "/facades") inner = <><Intro title="Фасадные работы и утепление" text={facadeDescription} kicker="СТРОИТЕЛЬНОЕ НАПРАВЛЕНИЕ"/><FacadeDetails/></>;
    else if (group) {
      const sub = path.split("/")[3];
      inner = <><Intro title={group.name} text={group.note}/><ServiceRows list={serviceList.filter(s => s.category_slug === group.id && (!sub || s.subcategory_slug === sub))}/></>;
    }
    else if (service) inner = <><Intro title={service.name} text={service.description} kicker={service.category}/><div className="hm-detail"><ServicePhoto key={service.category_slug} category={service.category_slug} alt={service.name}/><div><h2>Что важно знать</h2><p>Объём установки, необходимые материалы и дополнительные работы уточняем перед визитом.</p><p>Стоимость зависит от конкретной задачи и условий на месте.</p><ContactButtons/></div></div></>;
    else if (path === "/how-it-works") inner = <><Intro title="О компании «Домашний мастер»" text="Бытовые, монтажные и фасадные работы в Санкт-Петербурге."/><CompanyProfile/><CompanyFacts/><QualitySection/><TeamSection/><div className="hm-prose"><h2>Как организуем работы</h2><p>Заранее обсуждаем объём работ, стоимость и время. После выполнения вы принимаете результат, а при необходимости можете связаться с компанией.</p></div><Process/><FacadeHighlight/></>;
    else if (path === "/quality") inner = <><Intro title="Контроль качества" text="Организация работ, согласование и проверка результата."/><QualitySection/><ContactButtons/></>;
    else if (path === "/careers") inner = <><Intro title="Сотрудничество с мастерами" text="Для специалистов по бытовому монтажу и фасадных бригад."/><CareersContent/></>;
    else if (path === "/documents") inner = <><Intro title="Документы и реквизиты" text="Информация об исполнителе и документы для обсуждения сотрудничества."/><DocumentsContent/></>;
    else if (path === "/feedback") inner = <><Intro title="Отзывы и обратная связь" text="Связь с компанией после выполненных работ."/><FeedbackContent/></>;
    else if (path === "/business") inner = <><Intro title="Сотрудничество" text="Работаем с компаниями в Санкт-Петербурге: бытовой монтаж, ремонт и фасадные работы."/><BusinessDetails/></>;
    else if (path === "/contacts") inner = <><Intro title="Контакты" text={company.phone?"Свяжитесь с нами напрямую — по телефону или электронной почте.":"Свяжитесь с нами напрямую по электронной почте."}/><div className="hm-contact-cards">{company.phone && <div><span className="hm-kicker">ТЕЛЕФОН</span><a href={phoneHref}>{company.phone}</a><p>Для обсуждения работ и визита мастера.</p></div>}<div><span className="hm-kicker">ЭЛЕКТРОННАЯ ПОЧТА</span><a href={"mailto:" + company.email}>{company.email}</a><p>Для вопросов и делового сотрудничества.</p></div><div><span className="hm-kicker">КОМПАНИЯ</span><strong>ИП Шагалина И.Б.</strong><p>Санкт-Петербург</p></div></div></>;
    else if (path === "/guarantee") inner = <><Intro title="Гарантия на работы" text="На бытовые работы — 1 год с учётом применимых условий."/><div className="hm-prose"><p>{company.guaranteeNote} Гарантийные условия по фасадным работам согласовываем для конкретного объекта.</p><p>Если после визита возник вопрос по выполненной работе, свяжитесь с нами, сообщите дату и адрес работ. Уточним ситуацию и дальнейшие действия.</p><ContactButtons/></div></>;
    else if (path === "/areas") inner = <><Intro title="Работаем в Санкт-Петербурге" text="Возможность выезда по конкретному адресу и время визита уточняйте при обращении."/><ContactButtons/></>;
    else if (path === "/faq") inner = <><Intro title="Вопросы и ответы"/><FAQ/></>;
    else if (path === "/articles") inner = <><Intro title="Полезные статьи" text="Как подготовиться к визиту мастера и заранее обсудить детали работ."/><ArticleList/></>;
    else if (article) inner = <><Intro title={article.title} text={article.excerpt} kicker={article.category}/><article className="hm-prose">{article.body.split("\n\n").map((part,i) => {const [first,...rest] = part.split("\n");return first.startsWith("## ") ? <section key={i}><h2>{first.slice(3)}</h2><p>{rest.join(" ")}</p></section> : <p key={i}>{part}</p>;})}</article></>;
    else inner = <><Intro title={title} text="Попробуйте открыть сайт чуть позже или напишите нам на почту."/><ContactButtons/></>;
    body = <><Breadcrumbs items={[[title,path]]} nonce={nonce}/><section className="hm-shell hm-page">{inner}</section>{path !== "/contacts" && <ContactBanner/>}</>;
  }
  return <Layout title={title} description={description} path={path} staging={staging} nonce={nonce} noindex={["/maintenance","/500"].includes(path)}>{body}</Layout>;
}

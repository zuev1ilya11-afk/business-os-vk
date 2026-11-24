import { useState } from "react";
import { company, phoneHref } from "../lib/company";
import { CompanyProfile, FacadeHighlight, PartnerNames } from "./CompanyProfile";
import { CompanyFacts, ObjectsSection, QualitySection, TeamSection, UsefulArticles, siteFaq } from "./CompanyContent";

type Category = "curtains" | "plumbing" | "appliances" | "handyman" | "electrical" | "furniture";
const serviceCards: { id: Category; name: string; text: string; photo: string }[] = [
  {id:"curtains",name:"Карнизы и шторы",text:"Монтаж потолочных и настенных карнизов, подрезка, углы, кронштейны, рулонные шторы и жалюзи.",photo:"hero-mobile"},
  {id:"plumbing",name:"Сантехника",text:"Установка и замена смесителей, унитазов, подключение сантехнического оборудования.",photo:"plumbing"},
  {id:"appliances",name:"Бытовая техника",text:"Подключение стиральных и посудомоечных машин к подготовленным коммуникациям.",photo:"appliances"},
  {id:"handyman",name:"Мелкий ремонт",text:"Настенный монтаж, навеска полок и телевизоров, крепления и другие бытовые работы.",photo:"handyman"},
  {id:"electrical",name:"Электрика и освещение",text:"Установка светильников и люстр, замена розеток и выключателей.",photo:"electrical"},
  {id:"furniture",name:"Сборка мебели",text:"Сборка мебели по инструкции и ремонт отдельных деталей.",photo:"furniture"},
];
const gallery: { photo:string; title:string; type:Category; note:string }[] = [
  {photo:"ceiling-rail",title:"Потолочный карниз",type:"curtains",note:"Монтаж карниза с учётом материала основания и размеров окна."},
  {photo:"curtain-track",title:"Монтаж карнизов и штор",type:"curtains",note:"Настенные и потолочные системы, аккуратное размещение креплений."},
  {photo:"shower",title:"Монтаж душевого оборудования",type:"plumbing",note:"Уточнение комплектации и условий подключения перед визитом."},
  {photo:"washer",title:"Подключение стиральной машины",type:"appliances",note:"Подключение к подготовленным выводам воды и канализации."},
  {photo:"toilet",title:"Установка унитаза",type:"plumbing",note:"Монтаж на подготовленное основание и проверка соединений."},
  {photo:"faucet",title:"Замена смесителя",type:"plumbing",note:"Замена оборудования и проверка герметичности."},
  {photo:"electrical",title:"Установка светильника",type:"electrical",note:"Монтаж на существующий электрический вывод."},
  {photo:"furniture",title:"Сборка мебели",type:"furniture",note:"Сборка по инструкции производителя."},
  {photo:"shelves",title:"Навеска полок",type:"handyman",note:"Подбор креплений с учётом материала стены."},
  {photo:"tv",title:"Телевизор на стену",type:"handyman",note:"Монтаж на подходящий кронштейн."},
];
const filters = [ ["all","Все"], ["curtains","Карнизы и шторы"], ["plumbing","Сантехника"], ["appliances","Бытовая техника"], ["other","Прочие"] ];
const steps = [ ["Согласование","Уточняем задачу, объём и стоимость."], ["Выезд мастера","Договариваемся об удобном времени."], ["Выполнение","Аккуратно выполняем согласованные работы."], ["Результат","Вы принимаете работу; остаёмся на связи."] ];
const faq = siteFaq;

function Mark({name}:{name:string}) {
  const paths: Record<string, string> = {
    home:"M3 11 12 3l9 8M5 10v11h5v-6h4v6h5V10",shield:"M12 22s8-3 8-12V5l-8-3-8 3v5c0 9 8 12 8 12Zm-3-10 2 2 4-5",clock:"M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-15v5l3 2",tool:"M14 6a5 5 0 0 0-6 6l-5 5a2 2 0 0 0 3 3l5-5a5 5 0 0 0 6-6l-3 3-3-3 3-3Z",pin:"M20 9c0 6-8 12-8 12S4 15 4 9a8 8 0 1 1 16 0Zm-8 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",phone:"M7 3H4a1 1 0 0 0-1 1c0 9 8 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z",calendar:"M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M8 14h2m4 0h2m-8 3h2",check:"M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM7 12l3 3 7-7",mail:"M3 5h18v14H3zM3 6l9 7 9-7",arrow:"M4 12h15m-6-6 6 6-6 6" };
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.check}/></svg>;
}
export function ServicePhoto({category,photo,alt,hero=false}:{category:string;photo?:string;alt:string;hero?:boolean}) {
  const file = photo || serviceCards.find(s=>s.id===category)?.photo || "curtains";
  const [fallback,setFallback] = useState(false);
  const src = fallback ? (hero ? "/interior.webp" : "/illustrations/"+category+".svg") : "/work-photos/"+file+".webp";
  const image = <img className={fallback?"hm-photo-fallback":"hm-photo"} src={src} alt={alt} width={hero?1672:420} height={hero?941:240} loading={hero?"eager":"lazy"} fetchPriority={hero?"high":"auto"} decoding="async" onError={()=>setFallback(true)}/>;
  return hero ? <picture>{!fallback&&<source media="(max-width:600px)" srcSet="/work-photos/hero-mobile.webp"/>}{image}</picture> : image;
}
function ServiceCards() {
  return <div className="hm-approved-services" data-stagger>{serviceCards.map((s,i)=><a key={s.id} href={"/categories/"+s.id} className="hm-approved-service"><div className="hm-service-image"><ServicePhoto category={s.id} photo={s.photo} alt={s.name}/></div><div className="hm-approved-service-copy"><span className="hm-service-index">0{i+1} / УСЛУГИ</span><h3>{s.name}</h3><p>{s.text}</p><span className="hm-service-more">Подробнее <Mark name="arrow"/></span></div></a>)}</div>;
}
export function WorkGallery() {
  const [filter,setFilter] = useState("all");
  const [expanded,setExpanded] = useState(false);
  const [selected,setSelected] = useState<string|null>(null);
  const matches = gallery.filter(g=>filter==="all" || (filter==="other" ? ["handyman","electrical","furniture"].includes(g.type) : g.type===filter));
  const shown = filter==="all"&&!expanded?matches.slice(0,6):matches;
  const active=gallery.find(g=>g.photo===selected);
  return <section className="hm-approved-gallery" id="works" aria-labelledby="works-title"><h2 id="works-title">Примеры работ</h2><p className="hm-gallery-lede">Посмотрите, какие задачи мы можем выполнить.</p><div className="hm-gallery-filters" role="group" aria-label="Категории работ">{filters.map(([id,label])=><button type="button" key={id} aria-pressed={filter===id} onClick={()=>{setFilter(id);setExpanded(false);setSelected(null)}}>{label}</button>)}</div><div className="hm-gallery-grid" aria-live="polite" key={filter+(expanded?"-expanded":"-compact")}>{shown.map(g=><button key={g.photo} type="button" className="hm-gallery-card" onClick={()=>setSelected(g.photo)} aria-label={"Подробнее: "+g.title}><ServicePhoto category={g.type} photo={g.photo} alt={g.title}/><span>{g.title}</span></button>)}</div>{active&&<div className="hm-gallery-detail" role="region" aria-label={active.title}><button type="button" className="hm-gallery-close" aria-label="Закрыть подробности" onClick={()=>setSelected(null)}>×</button><ServicePhoto key={active.photo} category={active.type} photo={active.photo} alt={active.title}/><div><h3>{active.title}</h3><p>{active.note}</p><a href={"/categories/"+active.type}>Подробнее об услугах →</a></div></div>}{filter==="all"&&matches.length>6&&<button type="button" className="hm-show-more" onClick={()=>{setExpanded(!expanded);setSelected(null)}}>{expanded?"Свернуть":"Показать ещё работы"} <Mark name="arrow"/></button>}<p className="hm-gallery-disclosure">Иллюстративные изображения видов работ, не фотографии реальных заказов.</p></section>;
}
export default function ApprovedHome() {
  return <div className="hm-approved-home">
    <section className="hm-approved-hero"><div className="hm-hero-photo"><ServicePhoto category="curtains" photo="hero-premium" alt="Иллюстрация современного интерьера с потолочными шторами" hero/></div><div className="hm-shell hm-approved-hero-content"><span className="hm-hero-eyebrow">ДОМАШНИЙ МАСТЕР · САНКТ-ПЕТЕРБУРГ</span><h1>Бытовые, монтажные<br className="hm-hero-break"/> и фасадные работы <span>в Санкт-Петербурге</span></h1><p>От установки карнизов и подключения техники до утепления и отделки фасадов. Для дома, бизнеса и строительных объектов.</p><div className={"hm-approved-actions"+(company.phone?"":" hm-email-only")}>{company.phone && <a href={phoneHref}><Mark name="phone"/> Позвонить</a>}<a href={"mailto:"+company.email}><Mark name="mail"/> Написать на почту</a></div><div className="hm-hero-benefits">{[["tool","Аккуратный монтаж"],["shield","Бытовые работы: гарантия 1 год*"],["clock","Согласуем время"],["pin","Санкт-Петербург"]].map(([icon,label])=><div key={icon}><Mark name={icon}/><span>{label}</span></div>)}</div><div className="hm-hero-footnote">Иллюстративное изображение интерьера</div></div></section>
    <div className="hm-premium-partner-strip"><div className="hm-shell"><span>Сотрудничаем с компаниями</span><div><strong>Лемана ПРО</strong><strong>Петрович</strong></div><a href="/business">О сотрудничестве ↗</a></div></div>
    <section className="hm-shell hm-approved-section" id="services"><div className="hm-approved-heading"><div><span className="hm-kicker">01 / НАПРАВЛЕНИЯ</span><h2>Наши услуги</h2><p>Комплекс бытовых, монтажных и ремонтных работ. Выберите нужное направление.</p></div><a href="/services">Все услуги <Mark name="arrow"/></a></div><ServiceCards/></section>
    <FacadeHighlight home/>
    <CompanyProfile home/>
    <CompanyFacts/>
    <QualitySection home/>
    <ObjectsSection/>
    <div className="hm-shell hm-approved-workflow" data-reveal><WorkGallery/><div className="hm-approved-process"><section aria-labelledby="process-title"><h2 id="process-title">Как мы работаем</h2><div className="hm-approved-steps">{steps.map(([title,desc],i)=><div key={title}><span className="hm-step-icon"><Mark name={["phone","calendar","tool","check"][i]}/></span><h3>{title}</h3><p>{desc}</p></div>)}</div></section><section className="hm-approved-why"><h2>Почему выбирают нас</h2><div className="hm-why-inner"><ServicePhoto category="handyman" photo="tools" alt="Инструменты для монтажных работ"/><div><ul>{["Согласуем объём и стоимость заранее","Подбираем мастера под задачу","Аккуратный монтаж и проверка результата","Гарантия на бытовые работы — 1 год*"].map(t=><li key={t}><Mark name="check"/>{t}</li>)}</ul><a href="/how-it-works">Подробнее о компании →</a></div></div></section><p className="hm-gallery-disclosure">* <a href="/guarantee">Условия и порядок обращения по гарантии.</a></p></div></div>
    <section className="hm-shell hm-approved-partners" id="business"><div><span className="hm-hero-eyebrow">ПАРТНЁРАМ</span><h2>Работаем с бизнесом</h2><p>Организуем монтажные, бытовые и фасадные работы для компаний. Обсудим перечень услуг, порядок взаимодействия и условия.</p><PartnerNames/><div className="hm-partner-actions"><a href="/business">Подробнее о сотрудничестве <Mark name="arrow"/></a><a href="/company-proposal.pdf" download>Скачать предложение (PDF) ↓</a></div></div><div className="hm-partner-types"><span><Mark name="home"/> Магазинам и поставщикам</span><span><Mark name="tool"/> Ремонтным компаниям</span><span><Mark name="check"/> Дизайнерам интерьеров</span></div></section>
    <TeamSection home/>
    <UsefulArticles/>
    <section className="hm-shell hm-approved-section hm-approved-faq"><div><h2>Частые вопросы</h2><p>Что полезно знать перед обращением.</p><a href="/faq">Все вопросы →</a></div><div className="hm-faq">{faq.map(([q,a])=><details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div></section>
    <section className="hm-approved-contact"><div className="hm-shell"><div><h2>Свяжитесь с нами</h2><p>Расскажите, какую работу нужно выполнить.</p></div><div>{company.phone && <a href={phoneHref}><Mark name="phone"/>{company.phone}</a>}<a href={"mailto:"+company.email}><Mark name="mail"/>{company.email}</a></div><div><strong>ИП Шагалина И.Б.</strong><p>Санкт-Петербург</p><a href="/contacts">Все контакты →</a></div></div></section>
  </div>;
}

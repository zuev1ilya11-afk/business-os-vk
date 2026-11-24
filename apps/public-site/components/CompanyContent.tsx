import { company, phoneHref } from "../lib/company";
import { articles } from "../lib/content";

export const siteFaq = [
  ["Какие работы вы выполняете?","Устанавливаем карнизы и шторы, подключаем бытовую технику и сантехнику, выполняем электромонтажные и мелкие бытовые работы, сборку мебели. Отдельное направление — мокрые и вентилируемые фасады, утепление и отделка."],
  ["Как узнать стоимость бытовых работ?","Сообщите, что нужно установить, количество, размеры, материал основания и особенности доступа. Уточним состав работ и согласуем стоимость до начала."],
  ["Как рассчитываются фасадные работы?","Индивидуально: учитываем площадь, состояние стен, выбранную систему, материалы, утепление, высоту и условия доступа. При наличии подготовьте проект и фотографии объекта."],
  ["Где вы работаете?","В Санкт-Петербурге. Возможность выезда по конкретному адресу и объём работ уточняем при обращении."],
  ["Можно ли обратиться от имени компании?","Да. Обсудим перечень работ, сроки, порядок передачи заказов и условия взаимодействия с вашей организацией."],
  ["Что подготовить к приезду мастера?","Сообщите модель изделия, наличие комплектующих, размеры, материал стены или потолка и фотографии места установки. Если требуется доставка товара, согласуем визит после уточнения её даты."],
  ["Какая гарантия на работы?","На бытовые работы — 1 год с учётом применимых условий. Условия по фасадным работам согласовываем для конкретного объекта."],
  ["Что делать, если возник вопрос после работ?","Свяжитесь с нами по телефону или почте, сообщите дату, адрес и характер вопроса. Уточним информацию и дальнейший порядок действий."],
];
const facts = [
  ["2","направления","Бытовой монтаж и фасадные работы"],
  ["6","специализаций","Бытовые услуги для дома и бизнеса"],
  ["3","типа фасадных работ","Мокрый, вентилируемый, утепление"],
  ["1 год","гарантии*","На бытовые работы"],
];
export function CompanyFacts(){
  return <section className="hm-premium-facts" aria-labelledby="facts-title"><div className="hm-shell"><div className="hm-facts-heading"><span className="hm-kicker">ДОМАШНИЙ МАСТЕР</span><h2 id="facts-title">Компания в цифрах</h2><p>Основные направления и условия работы.</p></div><div className="hm-facts-grid" data-stagger>{facts.map(([value,label,description])=><div key={label}><strong>{value}</strong><h3>{label}</h3><p>{description}</p></div>)}</div><p className="hm-facts-note">* <a href="/guarantee">Применимые условия гарантии.</a></p></div></section>;
}
const quality = [
  ["01","Уточняем задачу","Согласовываем виды работ, количество, особенности объекта, стоимость и удобное время."],
  ["02","Организуем выполнение","Подбираем специалиста по направлению работ, фиксируем согласованные условия."],
  ["03","Контролируем процесс","Используем собственную систему координации заказов: от назначения специалиста до проверки результата."],
  ["04","Проверяем результат","По бытовым работам проверяем отчёт мастера, фотографии и акт, когда он предусмотрен. По фасадам — согласованный порядок приёмки."],
];
export function QualitySection({home=false}:{home?:boolean}){
  return <section className={"hm-quality"+(home?" hm-shell hm-premium-section":"")} id="quality" aria-labelledby="quality-title"><div className="hm-quality-intro"><span className="hm-kicker">КОНТРОЛЬ КАЧЕСТВА</span><h2 id="quality-title">Понятный процесс.<br/>Предсказуемый результат.</h2><p>Работу сопровождает компания, а не только отдельный мастер. Мы организуем согласование, выполнение и контроль, чтобы клиент понимал, что происходит на каждом этапе.</p>{home&&<a href="/quality" className="hm-link">Как устроен контроль качества ↗</a>}</div><div className="hm-quality-grid" data-stagger>{quality.map(([number,title,description])=><article key={number}><span className="hm-quality-number">{number}</span><h3>{title}</h3><p>{description}</p></article>)}</div></section>;
}
const objectTypes=[["01","Квартиры","Установка, подключение и бытовой монтаж."],["02","Частные дома","Внутренние работы, фасад и утепление."],["03","Офисы","Монтаж и бытовые задачи в рабочих помещениях."],["04","Магазины","Работы в торговых помещениях и у покупателей."],["05","Коммерческие помещения","Согласованные монтажные и ремонтные работы."],["06","Строительные объекты","Фасадные работы по согласованному проекту."]];
export function ObjectsSection(){
  return <section className="hm-shell hm-premium-section hm-objects" aria-labelledby="objects-title"><div className="hm-editorial-heading"><div><span className="hm-kicker">ДЛЯ КОГО РАБОТАЕМ</span><h2 id="objects-title">Объекты разного масштаба</h2></div><p>От отдельной бытовой задачи до согласованного объёма фасадных работ.</p></div><div className="hm-object-grid" data-stagger>{objectTypes.map(([number,title,description])=><article key={number}><span>{number}</span><h3>{title}</h3><p>{description}</p></article>)}</div></section>;
}
const roles=[["Координатор","Принимает обращение, помогает уточнить детали и организовать визит."],["Мастер или бригада","Выполняет работы по согласованному направлению и проверяет результат."],["Руководитель","Сопровождает выполнение, рассматривает вопросы качества и дальнейшее взаимодействие."]];
export function TeamSection({home=false}:{home?:boolean}){
  return <section className={"hm-team"+(home?" hm-shell hm-premium-section":"")} aria-labelledby="team-title"><div className="hm-editorial-heading"><div><span className="hm-kicker">КОМАНДА И ОРГАНИЗАЦИЯ</span><h2 id="team-title">Кто сопровождает работу</h2></div><p>Понятное распределение ответственности: от первого звонка до приёмки.</p></div><div className="hm-team-grid" data-stagger>{roles.map(([title,description],i)=><article key={title}><span className="hm-kicker">0{i+1}</span><h3>{title}</h3><p>{description}</p></article>)}</div><div className="hm-team-links"><a className="hm-link" href="/careers">Сотрудничество с мастерами ↗</a><a className="hm-link" href="/feedback">Отзывы и обратная связь ↗</a><a className="hm-link" href="/documents">Документы и реквизиты ↗</a></div></section>;
}
export function CareersContent(){
  return <div className="hm-prose"><h2>Профессиональным мастерам и бригадам</h2><p>Готовы обсудить сотрудничество со специалистами по бытовому монтажу, сантехнике, электрике, подключению техники, сборке мебели и фасадным работам. Наличие свободных направлений, условия и формат сотрудничества уточняются при обращении.</p><h2>Что указать в письме</h2><p>Ваше имя, контакт для связи, специализацию, опыт, район работы, наличие инструментов и примеры выполненных работ, если есть разрешение на их передачу.</p><div className="hm-actions"><a className="hm-btn" href={"mailto:"+company.email+"?subject="+encodeURIComponent("Сотрудничество с мастером")}>Написать о себе ↗</a><a className="hm-btn hm-btn-outline" href={phoneHref}>Позвонить ↗</a></div></div>;
}
export function FeedbackContent(){
  return <div className="hm-prose"><h2>Ваше мнение помогает улучшать работу</h2><p>Если вы уже обращались в «Домашний мастер», можете поделиться впечатлениями или сообщить о вопросе после выполненных работ. Напишите дату, вид работ и удобный способ связи. Не отправляйте в открытый доступ персональные данные.</p><h2>Вопросы по качеству</h2><p>Для обсуждения результата свяжитесь с компанией. Уточним сведения о заказе и дальнейший порядок действий в зависимости от условий работ.</p><div className="hm-actions"><a className="hm-btn" href={"mailto:"+company.email+"?subject="+encodeURIComponent("Обратная связь по работе")}>Написать отзыв ↗</a><a className="hm-btn hm-btn-outline" href={phoneHref}>Позвонить ↗</a></div><p><a href="/guarantee">Условия гарантии</a></p></div>;
}
export function DocumentsContent(){
  return <div className="hm-documents"><div className="hm-contact-cards"><div><span className="hm-kicker">ИСПОЛНИТЕЛЬ</span><strong>ИП Шагалина И.Б.</strong><p>Санкт-Петербург</p></div><div><span className="hm-kicker">ТЕЛЕФОН</span><a href={phoneHref}>{company.phone}</a></div><div><span className="hm-kicker">ПОЧТА</span><a href={"mailto:"+company.email}>{company.email}</a></div></div><div className="hm-doc-list"><a href="/privacy"><div><h2>Политика конфиденциальности</h2><p>Информация о порядке обработки персональных данных.</p></div><span>Открыть ↗</span></a><a href="/guarantee"><div><h2>Гарантийные условия</h2><p>Бытовые и фасадные работы.</p></div><span>Открыть ↗</span></a><a href="/company-proposal.pdf" download><div><h2>Предложение о сотрудничестве</h2><p>Направления работ и форматы взаимодействия, PDF.</p></div><span>Скачать ↓</span></a></div><div className="hm-prose"><h2>Реквизиты для договора</h2><p>Полные реквизиты и документы, необходимые для конкретного договора, уточняйте по корпоративной почте.</p><a className="hm-btn" href={"mailto:"+company.email+"?subject="+encodeURIComponent("Запрос реквизитов")}>Запросить реквизиты ↗</a></div></div>;
}
export function UsefulArticles(){
  const items=articles.filter(a=>a.published).slice(0,3);
  return <section className="hm-shell hm-premium-section hm-useful" aria-labelledby="useful-title"><div className="hm-editorial-heading"><div><span className="hm-kicker">ПОЛЕЗНО ЗНАТЬ</span><h2 id="useful-title">Готовимся к работам</h2></div><a href="/articles" className="hm-link">Все статьи ↗</a></div><div className="hm-useful-grid" data-stagger>{items.map(a=><a key={a.slug} href={"/articles/"+a.slug}><div className="hm-useful-photo"><img src={a.cover} alt="" width="420" height="240" loading="lazy"/></div><div><span className="hm-kicker">{a.category}</span><h3>{a.title}</h3><p>{a.excerpt}</p><span className="hm-link">Читать ↗</span></div></a>)}</div></section>;
}

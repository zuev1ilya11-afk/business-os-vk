import { Layout } from "../components/Layout";
export default function NotFound() {
  return <Layout title="Страница не найдена" noindex><section className="hm-shell hm-page"><div className="hm-page-intro"><span className="hm-kicker">404</span><h1>Страница не найдена.</h1><p>Выберите нужное направление в каталоге услуг.</p></div><a className="hm-btn" href="/services">Наши услуги ↗</a></section></Layout>;
}

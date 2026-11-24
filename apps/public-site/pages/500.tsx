import { Layout } from "../components/Layout";
export default function ErrorPage() {
  return <Layout title="Временная ошибка" noindex><section className="hm-shell hm-page"><div className="hm-page-intro"><h1>Не удалось открыть страницу.</h1><p>Попробуйте ещё раз немного позже.</p></div><a className="hm-btn" href="/">На главную ↗</a></section></Layout>;
}

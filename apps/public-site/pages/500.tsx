import { Layout } from "../components/Layout";
export default function ErrorPage() {
  return (
    <Layout title="Временная ошибка" noindex>
      <section className="section prose">
        <h1>Не удалось открыть страницу.</h1>
        <p>Попробуйте ещё раз немного позже.</p>
        <a className="button" href="/">
          На главную ↗
        </a>
      </section>
    </Layout>
  );
}

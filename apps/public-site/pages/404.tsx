import { Layout } from "../components/Layout";
export default function NotFound() {
  return (
    <Layout title="Страница не найдена" noindex>
      <section className="section prose">
        <span className="eyebrow">404</span>
        <h1>Здесь пока ничего нет.</h1>
        <p>Попробуйте найти нужную работу в каталоге.</p>
        <a className="button" href="/services">
          Посмотреть услуги ↗
        </a>
      </section>
    </Layout>
  );
}

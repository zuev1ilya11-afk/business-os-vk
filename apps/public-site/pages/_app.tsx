import type { AppProps } from "next/app";
import "../styles.css";
import "../company-design.css";
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}

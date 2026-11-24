import type { AppProps } from "next/app";
import "../company-design.css";
import "../approved-home.css";
import "../company-profile.css";
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}

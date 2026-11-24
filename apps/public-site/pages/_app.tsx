import type { AppProps } from "next/app";
import "../company-design.css";
import "../approved-home.css";
import "../company-profile.css";
import "../premium-site.css";
import SiteMotion from "../components/SiteMotion";
export default function App({ Component, pageProps }: AppProps) {
  return <><SiteMotion/><Component {...pageProps}/></>;
}

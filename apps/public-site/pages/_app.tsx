import type { AppProps } from "next/app";
import { useEffect } from "react";
import { useRouter } from "next/router";
import { track, attribution } from "../lib/analytics";
import "../styles.css";
export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  useEffect(() => {
    attribution();
    track("page_view");
  }, [router.asPath]);
  return <Component {...pageProps} />;
}

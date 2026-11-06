import Document, {
  Html,
  Head,
  Main,
  NextScript,
  DocumentContext,
} from "next/document";
export default class SiteDocument extends Document<{ nonce: string }> {
  static async getInitialProps(ctx: DocumentContext) {
    const initial = await Document.getInitialProps(ctx);
    return { ...initial, nonce: String(ctx.req?.headers["x-csp-nonce"] || "") };
  }
  render() {
    return (
      <Html lang="ru">
        <Head nonce={this.props.nonce} />
        <body>
          <Main />
          <NextScript nonce={this.props.nonce} />
        </body>
      </Html>
    );
  }
}

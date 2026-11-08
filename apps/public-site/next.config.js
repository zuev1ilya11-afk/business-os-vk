module.exports = {
  distDir: process.env.NODE_ENV === "production" ? ".next" : ".next-dev",
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  experimental: { cpus: 2 },
  turbopack: { root: __dirname },
};

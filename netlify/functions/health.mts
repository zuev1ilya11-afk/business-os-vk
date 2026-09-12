export default async () => {
  return new Response(JSON.stringify({ ok: true, service: "business-os-api-gateway" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

export const config = {
  path: "/api/_healthcheck",
};

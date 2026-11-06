import type { Service, LegalDocument } from "./types";
let cached: { expires: number; services: Service[] } | undefined;
export async function apiRead(path: string) {
  const origin = process.env.WEBSITE_INTERNAL_API_ORIGIN;
  if (!origin) {
    console.warn("website_api_origin_missing");
    throw Error("API origin missing");
  }
  const response = await fetch(new URL("/client-api/" + path, origin), {
    signal: AbortSignal.timeout(8000),
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    console.warn("website_api_status", response.status);
    throw Error("API unavailable");
  }
  return response.json();
}
export async function catalog(): Promise<Service[]> {
  if (cached && cached.expires > Date.now()) return cached.services;
  const data = await apiRead("website/catalog");
  cached = { services: data.services, expires: Date.now() + 30000 };
  return data.services;
}
export async function documents(): Promise<LegalDocument[]> {
  return (await apiRead("documents")).documents;
}

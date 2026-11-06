export type EventName =
  | "page_view"
  | "service_search"
  | "service_view"
  | "start_order"
  | "upload_photo"
  | "submit_phone"
  | "otp_verified"
  | "order_created"
  | "open_cabinet"
  | "business_lead_created"
  | "call_click"
  | "chat_open"
  | "repeat_order"
  | "claim_created";
// Local integration point. No production counters, network sends or personal data.
export function track(
  name: EventName,
  values: Record<string, string | number> = {},
) {
  if (typeof window === "undefined") return;
  const safe = Object.fromEntries(
    Object.entries(values).filter(([k]) =>
      ["service_id", "count", "step"].includes(k),
    ),
  );
  window.dispatchEvent(
    new CustomEvent("bos:analytics", { detail: { name, values: safe } }),
  );
}
export function attribution() {
  if (typeof window === "undefined") return {};
  try {
    const p = new URLSearchParams(location.search),
      v: Record<string, string> = {};
    for (const key of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ]) {
      const value = p.get(key);
      if (value) v[key] = value.slice(0, 160);
    }
    if (Object.keys(v).length)
      sessionStorage.setItem("bos-website-utm", JSON.stringify(v));
    return JSON.parse(sessionStorage.getItem("bos-website-utm") || "{}");
  } catch {
    return {};
  }
}

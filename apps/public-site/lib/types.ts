export interface Service {
  id: string;
  name: string;
  public_title: string;
  slug: string;
  category: string;
  category_slug: string;
  subcategory: string;
  subcategory_slug: string;
  description: string;
  full_description: string;
  unit: string;
  price_display_mode: "fixed" | "range" | "from" | "after_inspection";
  price_min: number | null;
  price_max: number | null;
  image: string;
  duration: string;
  included_text: string;
  excluded_text: string;
  seo_title: string;
  seo_description: string;
  synonyms: string[];
  version: number;
}
export interface LegalDocument {
  document: string;
  title: string;
  body: string;
  version: string;
  required: boolean;
  reviewed: boolean;
}
export interface Article {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  cover: string;
  category: string;
  published_at: string;
  published: boolean;
  seo_title: string;
  seo_description: string;
  related_services: string[];
}
export interface PageData {
  path: string;
  query: string;
  services: Service[];
  documents: LegalDocument[];
  reviews: { rating: number; body: string; public_name: string }[];
  unavailable: boolean;
  staging: boolean;
  nonce: string;
  matchedIds?: string[];
}

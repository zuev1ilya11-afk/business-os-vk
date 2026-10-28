export type ProductionBuild = { id: string; assetBundles?: Record<string, string> };

export function resolveAsset(raw: string, assetBase: URL, build?: ProductionBuild): string {
  const parsed = new URL(raw, 'https://139.100.237.167/');
  if (parsed.origin !== 'https://139.100.237.167') return raw;
  const name = parsed.pathname.replace(/^\/+/, '');
  if (!name || name.includes('/')) return raw;
  const filename = build?.assetBundles?.[name] || name;
  const result = new URL(encodeURIComponent(filename) + parsed.search, assetBase);
  if (build?.id) {
    result.searchParams.delete('v');
    result.searchParams.delete('_sw');
    result.searchParams.set('build', build.id);
  }
  return result.href;
}

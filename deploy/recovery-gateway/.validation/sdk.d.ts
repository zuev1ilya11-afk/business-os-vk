declare module '@appdeploy/client' {
  export const api: {
    get(url: string, data?: unknown): Promise<{ data: unknown }>;
    post(url: string, data?: unknown): Promise<{ data: unknown }>;
  };
}
declare module '@appdeploy/sdk' {
  export type RouterResponse = { statusCode: number; headers: Record<string, string>; body: string };
  export type RouterContext = { body: unknown; params: Record<string, string>; query: Record<string, string>; event: unknown };
  export function router(routes: Record<string, Array<(ctx: RouterContext) => Promise<RouterResponse> | RouterResponse>>): unknown;
  export function json(data: unknown, status?: number): RouterResponse;
  export function error(message: string, status?: number): RouterResponse;
}

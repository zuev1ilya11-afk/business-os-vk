# VK auth regression checks

Run from the repository root with Node.js 24 or newer:

```sh
node --test tests/vk-auth.test.mjs
```

The tests execute the actual Edge Function after stripping TypeScript types.
Only the Supabase import and Deno environment/server are stubbed. No real
credentials, network calls, or database writes are used. Frontend transport is
checked against the actual `app-vk.js` in a minimal browser context.

Canonical strings in the encoding vectors are explicit, and signatures use
Node's HMAC implementation independently of the Edge Function's Web Crypto.
These checks do not replace a real VK launch after deployment.

Algorithm reference: [VK's official Node example](https://github.com/VKCOM/vk-apps-launch-params/blob/master/examples/node.js).

## Deploying the fix

After merging the fix and updating your local checkout, redeploy `vk-auth` to
the existing Supabase project:

```sh
supabase functions deploy vk-auth --project-ref obsropbslfwtanyspjbi --no-verify-jwt
```

The function authenticates with VK launch signatures before creating a Supabase
session, so it must be reachable without an existing Supabase JWT. Keep the
existing `VK_APP_SECRET` in Supabase Edge Function Secrets; do not put it in
source code or frontend configuration.

Alternatively, replace `vk-auth/index.ts` in the Supabase dashboard editor and
deploy it there, preserving the existing JWT setting. No frontend deployment is
needed for this change. Reopen VK Mini App 54758847 and use “Обновить вход через
VK” if a cached Supabase session would otherwise skip the new authentication.

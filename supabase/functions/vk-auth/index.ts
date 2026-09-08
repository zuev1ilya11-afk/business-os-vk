import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function verifyVkLaunchParams(raw: string, secret: string, expectedAppId: string) {
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const sign = params.get('sign');
  const appId = params.get('vk_app_id');
  const vkUserId = params.get('vk_user_id');
  if (!sign || !appId || !vkUserId || appId !== expectedAppId) return null;

  const vkPairs = [...params.entries()]
    .filter(([key]) => key.startsWith('vk_'))
    .sort(([a], [b]) => a.localeCompare(b));
  const canonical = new URLSearchParams(vkPairs).toString();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical)),
  );
  if (base64Url(digest) !== sign) return null;
  return { vkUserId: Number(vkUserId), appId: Number(appId) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const VK_APP_SECRET = Deno.env.get('VK_APP_SECRET');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const missing = [
      !VK_APP_SECRET ? 'VK_APP_SECRET' : null,
      !SUPABASE_URL ? 'SUPABASE_URL' : null,
      !SERVICE_ROLE ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    ].filter(Boolean);
    if (missing.length) throw new Error(`Missing server secrets: ${missing.join(', ')}`);

    const body = await req.json();
    const verified = await verifyVkLaunchParams(body.launchParams || '', VK_APP_SECRET!, '54758847');
    if (!verified) return new Response(JSON.stringify({ error: 'Invalid VK signature' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { autoRefreshToken: false, persistSession: false } });
    const fullName = [body.firstName, body.lastName].filter(Boolean).join(' ') || `VK ${verified.vkUserId}`;
    const avatar = body.photo200 || body.photo100 || null;

    const { data: existing } = await admin.from('profiles').select('id').eq('vk_user_id', verified.vkUserId).maybeSingle();
    let userId = existing?.id || null;
    let email = `vk_${verified.vkUserId}@businessos.local`;

    if (!userId) {
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName, vk_user_id: verified.vkUserId },
      });
      if (created.error) throw created.error;
      userId = created.data.user.id;
    } else {
      const user = await admin.auth.admin.getUserById(userId);
      if (!user.error && user.data.user.email) email = user.data.user.email;
    }

    const { error: profileError } = await admin.from('profiles').upsert({
      id: userId,
      vk_user_id: verified.vkUserId,
      full_name: fullName,
      avatar_url: avatar,
      is_active: true,
    }, { onConflict: 'id' });
    if (profileError) throw profileError;

    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error) throw link.error;
    const tokenHash = link.data.properties?.hashed_token;
    if (!tokenHash) throw new Error('Could not create session token');

    return new Response(JSON.stringify({ token_hash: tokenHash, type: 'magiclink' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

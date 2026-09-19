const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('startup has no blocking Netlify dependency and core API uses direct Edge route',()=>{
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const network=fs.readFileSync(path.join(root,'network-direct-v86.js'),'utf8');

  expect(html).not.toContain('<script src="https://business-os-api-gateway.netlify.app/vendor/vk-bridge.js"></script>');
  expect(html).toContain('<script src="network-direct-v86.js?v=20260918-v86"></script>');
  expect(html.indexOf('network-direct-v86.js')).toBeLessThan(html.indexOf('config.js'));

  expect(network).toContain("const GATEWAY='https://business-os-api-gateway.netlify.app'");
  expect(network).toContain("const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1'");
  expect(network).toContain("url.pathname.startsWith('/api/proxy/')");
  expect(network).toContain('return `${EDGE}/${encodeURIComponent(slug)}${url.search}`');
});

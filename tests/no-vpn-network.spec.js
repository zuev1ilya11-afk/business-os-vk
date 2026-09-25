const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('startup uses independent gateway with Netlify and direct Edge fallbacks',()=>{
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const network=fs.readFileSync(path.join(root,'network-direct-v86.js'),'utf8');
  const config=fs.readFileSync(path.join(root,'config.js'),'utf8');

  expect(html).not.toContain('<script src="https://business-os-api-gateway.netlify.app/vendor/vk-bridge.js"></script>');
  expect(html).toContain('<script src="network-direct-v86.js?v=20260925-v161"></script>');
  expect(html).toContain('<script src="config.js?v=20260911-v39"></script>');
  expect(html.indexOf('network-direct-v86.js')).toBeLessThan(html.indexOf('config.js'));

  expect(network).toContain("const GATEWAY='https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai'");
  expect(network).toContain("const ALT_GATEWAY='https://business-os-api-gateway.netlify.app'");
  expect(network).toContain("const EDGE='https://obsropbslfwtanyspjbi.supabase.co/functions/v1'");
  expect(network).toContain("url.pathname.startsWith('/api/proxy/')");
  expect(network).toContain('return info?`${EDGE}/${encodeURIComponent(info.slug)}${info.search}`:\'\'');
  expect(config).toContain("const PRIMARY_GATEWAY='https://business-os-api-gateway-3y8h7e.v2.appdeploy.ai'");
  expect(config).toContain("const SECONDARY_GATEWAY='https://business-os-api-gateway.netlify.app'");
});

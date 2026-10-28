const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const old='https://139.100.237.167',next='https://136.234.17.113';
const path='/storage/v1/object/public/master-reports/example/photo.jpg';
const source=fs.readFileSync(process.env.BOS_TEST_BUNDLE,'utf8');
function moduleSource(name){const marker='// Source: '+name+'\n';assert.equal(source.split(marker).length,2);const start=source.indexOf(marker)+marker.length;return source.slice(start,source.indexOf('\n;\n// Source:',start));}
function setup(origin=next){
 const rendered=[];
 const c={URL,console,openOrder:()=>{},esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll("'",'&#39;'),
  money:x=>String(x),pages:{home:()=>'',orders:()=>''},state:{orders:[],user:{role:'owner'}},
  document:{querySelector:()=>null,createElement:()=>({innerHTML:''}),body:{appendChild:e=>rendered.push(e.innerHTML)}},
  openModal:html=>rendered.push(html),$:()=>({}),BOS_RU_NETWORK:origin?{origin}:undefined};
 c.window=c;vm.createContext(c);
 vm.runInContext(moduleSource('master-report-patch.js'),c);
 vm.runInContext(moduleSource('report-review-patch.js'),c);
 return {c,rendered};
}
test('thumbnail uses current storage origin and preserves encoded object path and query',()=>{
 const {c}=setup();const url=old+path+'?download=a%20b.jpg&x=1';const html=c.BOS_REPORT_PHOTO_THUMB(url,0);
 assert(html.includes('src="'+next+path+'?download=a%20b.jpg&amp;x=1"'));
 assert(!html.includes(old));
});
test('photo viewer and open original both use current storage',()=>{
 const {c,rendered}=setup();c.BOS_OPEN_REPORT_PHOTO(old+path,'Фото');
 assert(rendered[0].includes('src="'+next+path+'"'));assert(rendered[0].includes('href="'+next+path+'"'));
});
test('signed file URL preserves the signature and PDF fragment exactly',()=>{
 const {c}=setup();const suffix='/storage/v1/object/sign/business-os-vk-files/orders/example/photo.jpg?token=test.signature&download=x%20y.jpg#page=2';
 assert.equal(c.safeReportHref(old+suffix),next+suffix);
});
test('accepted report keeps its state while photos and documents use current storage',()=>{
 const {c}=setup();const o={report_review_status:'approved',report_type:'measurement',report_act_url:old+path+'.pdf#page=2',report_measurement_url:old+path+'.pdf',report_photo_urls:JSON.stringify([old+path])};
 const before=JSON.stringify(o),html=c.reportLinksHtml(o);
 assert(html.includes(next+path+'.pdf#page=2'));assert(html.includes(next+path));assert(!html.includes(old));assert.equal(JSON.stringify(o),before);
});
test('review screen rewrites links without approving, rejecting or mutating the order',()=>{
 const {c,rendered}=setup();const o={id:'test-only',report_act_url:old+path+'.pdf',report_photo_urls:JSON.stringify([old+path]),report_review_status:'pending'};
 c.state.orders=[o];const before=JSON.stringify(c.state);
 c.openReportReview('test-only');assert(rendered[0].includes(next+path+'.pdf'));assert(rendered[0].includes(next+path));assert.equal(JSON.stringify(c.state),before);
});
test('unrelated hosts and non-storage links remain unchanged',()=>{
 const {c}=setup();for(const url of ['https://drive.google.com/file/d/example/view','https://obsropbslfwtanyspjbi.supabase.co'+path,old+'/news','https://139.100.237.167.example'+path])assert.equal(c.safeReportHref(url),url);
});
test('unsafe schemes remain rejected',()=>{
 const {c}=setup();for(const url of ['javascript:alert(1)','data:image/svg+xml,x','not a URL'])assert.equal(c.safeReportHref(url),'');
});
test('generic deployments without RU adapter preserve original behavior',()=>{
 const {c}=setup(null);assert.equal(c.safeReportHref(old+path),old+path);
});
test('old origin stays compatible',()=>{
 const {c}=setup(old);assert.equal(c.safeReportHref(old+path),old+path);
});

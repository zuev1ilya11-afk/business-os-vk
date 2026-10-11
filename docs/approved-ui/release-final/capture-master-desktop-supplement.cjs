const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=process.cwd(),filename=path.join(root,'docs/approved-ui/stage-2/capture-master-fixtures.cjs');
const wanted=['contact-agreed','contact-callback','contact-outcomes','day-detail','departure','filters','home-refresh-error','orders-done','orders-future','orders-today','orders-undated','report-deduction','report-submitted','reschedule-request','start-work'];
let code=fs.readFileSync(filename,'utf8').replace('for(const width of [360,390,430])','for(const width of [1440])').replace('async function cap(', 'async function capOriginal(');
code+=`\nasync function cap(c,screen,state,actions){if(${JSON.stringify(wanted)}.includes(screen))await capOriginal(c,screen,state,actions)}`;
process.argv[2]='main';process.env.BOS_QA_ROOT=root;process.env.BOS_CAPTURE_OUT=path.join(root,'docs/approved-ui/release-final/visual');
const m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(code,filename);

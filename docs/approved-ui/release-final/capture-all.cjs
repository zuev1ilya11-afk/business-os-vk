// Full synthetic release evidence, using the established screen workflows.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),out=path.join(root,'docs/approved-ui/release-final/visual');
const env={...process.env,BOS_QA_ROOT:root,BOS_CAPTURE_OUT:out,BOS_FINAL_CAPTURE_OUT:out};
const batches=[
 ['stage-6/capture-final.cjs',{}],
 ['stage-3/capture-dispatcher-fixtures.cjs',{BOS_CAPTURE_WIDTHS:'390,1440'}],
 ['stage-4/capture-management-fixtures.cjs',{BOS_CAPTURE_WIDTHS:'390,1440',BOS_CAPTURE_ROLES:'manager,owner'}],
 ['stage-5/capture-shared-fixtures.cjs',{BOS_CAPTURE_WIDTHS:'390,1440',BOS_CAPTURE_ROLES:'master,dispatcher,manager,owner',BOS_CAPTURE_PUSH_STATES:'default,subscribed,denied,unsupported'}],
 ['stage-2/capture-master-fixtures.cjs',{}],
 ['stage-4/capture-management-fixtures.cjs',{BOS_CAPTURE_WIDTHS:'390,1440',BOS_CAPTURE_ROLES:'dispatcher',BOS_CAPTURE_SCREENS:'review,review-reject,control,control-task'}]
];
for(const [file,extra] of batches){const result=spawnSync(process.execPath,[path.join(root,'docs/approved-ui',file)],{cwd:root,env:{...env,...extra},stdio:'inherit'});if(result.status)process.exit(result.status||1)}
const manifestPath=path.join(out,'capture-manifest.json'),entries=JSON.parse(fs.readFileSync(manifestPath));
for(const e of entries){e.runtimeBuild=e.runtimeBuild||e.buildId||e.observedBuild||null;if(e.screen.endsWith('-bottom')){e.screen=e.screen.slice(0,-7);e.state+='-scrolled-end'}}
fs.writeFileSync(manifestPath,JSON.stringify(entries,null,2));
console.log(JSON.stringify({captures:entries.length,gaps:entries.filter(e=>e.coverageGaps?.length).length}));

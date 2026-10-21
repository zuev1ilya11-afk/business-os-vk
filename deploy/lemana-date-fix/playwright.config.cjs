const fs=require('node:fs'),path=require('node:path');
const base=require('../../playwright.config.js');
module.exports={...base,testDir:path.resolve(__dirname,'../../tests'),testMatch:'lemana-import.spec.js',grep:/export dates with milliseconds/,workers:1,retries:0,reporter:'list',
 use:{...base.use,baseURL:'http://127.0.0.1:4178'},
 webServer:{command:'python3 -m http.server 4178 --bind 127.0.0.1',cwd:fs.readFileSync(path.join(__dirname,'.ui-root'),'utf8'),url:'http://127.0.0.1:4178',reuseExistingServer:false,stderr:'ignore',timeout:30000},
 outputDir:path.join(__dirname,'ui-results')};

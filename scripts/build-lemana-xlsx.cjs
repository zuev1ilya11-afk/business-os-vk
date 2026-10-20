const esbuild=require('esbuild');const fs=require('node:fs');
fs.mkdirSync('vendor',{recursive:true});
esbuild.buildSync({entryPoints:['scripts/lemana-xlsx-entry.cjs'],bundle:true,platform:'neutral',format:'iife',target:'es2022',outfile:'vendor/lemana-xlsx.js',minify:true,legalComments:'eof',banner:{js:'// XLSX reader: fflate 0.8.3 (MIT), fast-xml-parser 5.11.2 (MIT). Rebuild: node scripts/build-lemana-xlsx.cjs'}});

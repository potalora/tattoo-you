import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = resolve(import.meta.dirname, '..');

/** Compile in memory so verification never rewrites the checked-in runtime. */
export async function buildUI({sourceRoot=repositoryRoot, check=false}={}) {
  sourceRoot=resolve(sourceRoot);
  const js = await build({
    absWorkingDir:sourceRoot, entryPoints:['studio/ui/main.jsx'], outfile:'studio/ui-app.js',
    bundle:true, format:'esm', jsx:'automatic', minify:true, write:false,
    target:['es2022'], define:{'process.env.NODE_ENV':'"production"'},
    legalComments:'eof', metafile:true,
  });
  const inputs=Object.keys(js.metafile.inputs);
  if(inputs.some(path=>/(?:node_modules\/three\/|studio\/(?:scene|vendor)\.)/.test(path))) {
    throw Error('The UI bundle must not own or duplicate the Three renderer.');
  }
  const css = await postcss([tailwind({optimize:true})]).process(
    await readFile(resolve(sourceRoot,'studio/ui/globals.css'),'utf8'),
    {from:resolve(sourceRoot,'studio/ui/globals.css'),to:resolve(sourceRoot,'studio/ui-app.css')},
  );
  const outputs=[['studio/ui-app.js',js.outputFiles[0].contents],['studio/ui-app.css',Buffer.from(css.css)]];
  if(check) {
    for(const [path,bytes] of outputs) {
      let current;
      try { current=await readFile(resolve(sourceRoot,path)); } catch(error) { if(error.code!=='ENOENT')throw error; }
      if(!current || !current.equals(Buffer.from(bytes)))throw Error(`Stale generated UI: ${path}; run npm run build:ui.`);
    }
  } else {
    for(const [path,bytes] of outputs)await writeFile(resolve(sourceRoot,path),bytes);
  }
  return {jsBytes:outputs[0][1].length,cssBytes:outputs[1][1].length};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const check=process.argv.includes('--check');
  const result=await buildUI({check});
  console.log(`UI ${check?'verified':'built'}: ${result.jsBytes.toLocaleString()} bytes JS, ${result.cssBytes.toLocaleString()} bytes CSS; Three stays external.`);
}

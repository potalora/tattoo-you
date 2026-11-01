import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, mkdir, readdir, rm, truncate, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {test} from 'node:test';

const root = resolve(import.meta.dirname, '..');
const publishedLanding = html => html.includes('href="/studio/"') && html.includes('href="/site.css"');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(directory, prefix = '') {
  return (await Promise.all((await readdir(directory, {withFileTypes:true})).map(async entry => {
    const path = prefix + entry.name;
    return entry.isDirectory() ? files(join(directory, entry.name), path + '/') : [path];
  }))).flat().sort();
}
async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'inkform-public-'));
  t.after(() => rm(temporary, {recursive:true, force:true}));
  const sourceRoot = join(temporary, 'source'), outputDir = join(temporary, 'output');
  const definition = JSON.parse(await readFile(join(root, 'public/runtime-assets.json'), 'utf8'));
  for (const group of definition.groups) for (const entry of group.files) {
    const source = typeof entry === 'string' ? entry : entry.source;
    const path = join(sourceRoot, source);
    await mkdir(dirname(path), {recursive:true});
    await writeFile(path, source.startsWith('public/') ? await readFile(join(root, source)) : `fixture: ${source}\n`);
  }
  await mkdir(join(sourceRoot, 'public'), {recursive:true});
  await writeFile(join(sourceRoot, 'public/runtime-assets.json'), JSON.stringify(definition));
  for (const path of ['data/workspace.sqlite3', '.env', 'catalog.json', 'assets/private.png', 'output/backup.json', 'studio/models/source/base.obj', 'deploy/secret.yml', 'studio/unexpected.js']) {
    await mkdir(dirname(join(sourceRoot, path)), {recursive:true});
    await writeFile(join(sourceRoot, path), 'PRIVATE SENTINEL');
  }
  return {sourceRoot, outputDir, definition};
}

test('builds only explicit runtime files with public entry, all model families, notices and deterministic hashes', async t => {
  const {buildPublic} = await import('../scripts/build-public.mjs');
  const options = await fixture(t);
  await buildPublic(options);
  const published = await files(options.outputDir);
  for (const path of ['studio/index.html', 'studio/public-app.js', 'studio/wasm/morph.wasm', 'studio/surface-worker.js', 'studio/models/human.json', 'studio/models/atelier/male.json', 'studio/models/blender-studio/female.json', 'studio/models/mhr/neutral.json', 'studio/models/drummyfish/male.json', 'ASSET-NOTICES.md', 'THIRD-PARTY-NOTICES.txt', 'privacy.html', 'asset-manifest.json', '_headers', '_redirects', '404.html']) assert.ok(published.includes(path), path);
  assert.ok(!published.some(path => /(?:^data\/|^assets\/|^output\/|^deploy\/|\.env|\.py$|\.pdf$|\.blend$|\.obj$|\.target$|studio\/app\.js$|unexpected)/i.test(path)));
  const manifestBytes = await readFile(join(options.outputDir, 'asset-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.files.length + 1, published.length);
  assert.deepEqual(manifest.files.map(file => file.path), published.filter(path => path !== 'asset-manifest.json'));
  assert.ok(published.length <= 20_000);
  for (const file of manifest.files) {
    const bytes = await readFile(join(options.outputDir, file.path));
    assert.equal(file.bytes, bytes.length);
    assert.ok(file.bytes <= 25 * 1024 * 1024);
    assert.equal(file.sha256, sha256(bytes));
    assert.ok(file.license && file.provenance, file.path);
  }
  await writeFile(join(options.outputDir, 'stale-private.txt'), 'must disappear');
  await buildPublic(options);
  assert.deepEqual(await readFile(join(options.outputDir, 'asset-manifest.json')), manifestBytes);
  assert.ok(!(await files(options.outputDir)).includes('stale-private.txt'));
});

test('CSP hashes the actual import map and permits renderer capabilities without general script eval', async t => {
  const {buildPublic} = await import('../scripts/build-public.mjs');
  const options = await fixture(t);
  await buildPublic(options);
  const html = await readFile(join(options.outputDir, 'studio/index.html'), 'utf8');
  const headers = await readFile(join(options.outputDir, '_headers'), 'utf8');
  const importmap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(importmap).digest('base64');
  assert.ok(headers.includes(`'sha256-${hash}'`));
  const csp = headers.match(/Content-Security-Policy: (.+)/)[1];
  const directives = Object.fromEntries(csp.split(';').map(value => value.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...values]) => [name, values]));
  assert.ok(directives['script-src'].includes("'wasm-unsafe-eval'"));
  assert.ok(!directives['script-src'].includes("'unsafe-eval'"));
  assert.ok(!directives['script-src'].includes("'unsafe-inline'"));
  assert.ok(directives['worker-src'].includes("'self'"));
  assert.ok(directives['worker-src'].includes('blob:'));
  assert.ok(directives['img-src'].includes('blob:'));
  assert.ok(directives['style-src'].includes("'unsafe-inline'"));
  assert.deepEqual(directives['connect-src'], ["'self'", 'blob:']);
  assert.ok(headers.includes('X-Content-Type-Options: nosniff'));
  assert.ok(headers.includes('Referrer-Policy: no-referrer'));
  assert.ok(html.includes('./public-app.js'));
  assert.ok(!html.includes('src="./app.js'));
  assert.doesNotMatch(await readFile(join(options.outputDir, '_redirects'), 'utf8'), /^\/\s+/m);
  assert.match(await readFile(join(options.outputDir, 'index.html'), 'utf8'), /try it before you buy it/);
  assert.ok(publishedLanding(await readFile(join(options.outputDir, 'index.html'), 'utf8')));
});

test('missing files, symlinked files, and oversized assets fail before replacing the previous artifact', async t => {
  const {buildPublic} = await import('../scripts/build-public.mjs');
  const options = await fixture(t);
  await buildPublic(options);
  const original = await readFile(join(options.outputDir, 'asset-manifest.json'));
  const path = join(options.sourceRoot, 'studio/public-app.js');
  await rm(path);
  await assert.rejects(buildPublic(options), /public-app\.js/);
  assert.deepEqual(await readFile(join(options.outputDir, 'asset-manifest.json')), original);
  await symlink(join(options.sourceRoot, '.env'), path);
  await assert.rejects(buildPublic(options), /symlink|symbolic/i);
  await rm(path);
  await writeFile(path, '');
  await truncate(path, 25 * 1024 * 1024 + 1);
  await assert.rejects(buildPublic(options), /25 MiB|too large/i);
  assert.deepEqual(await readFile(join(options.outputDir, 'asset-manifest.json')), original);
});

test('Pages configuration deploys only dist-public with no Worker script or bindings', async () => {
  const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
  assert.equal(config.name, 'inkform');
  assert.equal(config.pages_build_output_dir, './dist-public');
  for (const key of ['main', 'durable_objects', 'd1_databases', 'kv_namespaces', 'r2_buckets', 'vars', 'services']) assert.ok(!(key in config));
});

test('definition rejects path traversal, duplicate destinations, excessive files and source/output overlap', async t => {
  const {buildPublic} = await import('../scripts/build-public.mjs');
  const options = await fixture(t);
  const definitionPath = join(options.sourceRoot, 'public/runtime-assets.json');
  const setDefinition = groups => writeFile(definitionPath, JSON.stringify({schemaVersion:1, groups}));
  const group = {id:'test', license:'MIT', provenance:'test input'};
  await setDefinition([{...group, files:[{source:'../.env', path:'leak.txt'}]}]);
  await assert.rejects(buildPublic(options), /Invalid public asset path/);
  await setDefinition([{...group, files:['studio/public-app.js', 'studio/public-app.js']}]);
  await assert.rejects(buildPublic(options), /Duplicate/);
  await setDefinition([{...group, files:Array.from({length:20_000}, (_, i) => `studio/file-${i}.js`)}]);
  await assert.rejects(buildPublic(options), /20,000 files/);
  await setDefinition(options.definition.groups);
  await assert.rejects(buildPublic({...options, outputDir:options.sourceRoot}), /source root/);
  await assert.rejects(buildPublic({...options, outputDir:join(options.sourceRoot, 'studio')}), /overlaps source inputs/);
});

test('actual artifact resolves the public module graph, model runtime references and UI dependency licenses', async t => {
  const {buildPublic} = await import('../scripts/build-public.mjs');
  const {build} = await import('esbuild');
  const {BODY_MODELS} = await import('../studio/model-catalog.js');
  const outputDir = await mkdtemp(join(tmpdir(), 'inkform-public-real-'));
  t.after(() => rm(outputDir, {recursive:true, force:true}));
  const manifest = await buildPublic({sourceRoot:root, outputDir});
  const paths = new Set(manifest.files.map(file => file.path));
  await build({entryPoints:[join(outputDir, 'studio/public-app.js'), join(outputDir, 'studio/surface-worker.js')], bundle:true, write:false, outdir:join(outputDir, 'check-only'), format:'esm', external:['three', 'three/webgpu', 'three/tsl']});
  const checkReference = (path, base) => {
    const resolved = path.startsWith('./models/') ? 'studio/' + path.slice(2) : base + path;
    assert.ok(paths.has(resolved), `Missing model runtime dependency: ${resolved}`);
  };
  for (const model of Object.values(BODY_MODELS)) {
    const base = 'studio/' + model.basePath.slice(2);
    checkReference(model.shapes, base);
    const shapes = JSON.parse(await readFile(join(outputDir, 'studio', model.shapes), 'utf8'));
    for (const [anatomy, bodyPath] of Object.entries(model.bodyFiles)) {
      checkReference(bodyPath, base);
      const body = JSON.parse(await readFile(join(outputDir, 'studio', bodyPath), 'utf8'));
      const meta = body.metadata || {}, spec = shapes.bodies[anatomy];
      for (const key of ['skinTexture', 'skinTextureHigh', 'heightTexture', 'heightTextureHigh', 'normalTexture', 'normalTextureHigh', 'eyes', 'eyeTexture']) if (meta[key]) checkReference(meta[key], base);
      for (const key of ['positions', 'eyes']) if (typeof spec[key] === 'string') checkReference(spec[key], base);
      for (const accessory of body.accessories || []) {
        checkReference(accessory.file, base);
        if (accessory.optionalTexture) checkReference(accessory.optionalTexture, base);
        const data = JSON.parse(await readFile(join(outputDir, base, accessory.file), 'utf8'));
        if (data.metadata?.shapePositions) checkReference(data.metadata.shapePositions, base);
      }
    }
  }
  const ui = await build({entryPoints:[join(root, 'studio/ui/main.jsx')], bundle:true, write:false, format:'esm', metafile:true, jsx:'automatic', absWorkingDir:root});
  const packages = new Set(Object.keys(ui.metafile.inputs).filter(path => path.startsWith('node_modules/')).map(path => path.split('/').slice(1, path.startsWith('node_modules/@') ? 3 : 2).join('/')));
  const definition = JSON.parse(await readFile(join(root, 'public/runtime-assets.json'), 'utf8'));
  for (const name of packages) {
    const group = definition.groups.find(group => group.id === 'package-' + name);
    assert.ok(group?.files.some(file => typeof file === 'object' && /LICENSE\.txt$/.test(file.path)), `Missing UI package license: ${name}`);
  }
});

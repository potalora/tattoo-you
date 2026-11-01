import {sourceIdentity} from './source-identity.mjs';
import {createHash, randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_PUBLIC_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PUBLIC_FILES = 20_000;
const digest = (bytes, encoding = 'hex') => createHash('sha256').update(bytes).digest(encoding);

function safePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Error(`Invalid public asset path: ${path}`);
  }
  return path;
}

async function readAsset(sourceRoot, path) {
  let cursor = sourceRoot;
  for (const part of path.split('/')) {
    cursor = resolve(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw Error(`Public asset cannot use a symlink: ${path}`);
  }
  const stat = await lstat(cursor);
  if (!stat.isFile()) throw Error(`Public asset is not a regular file: ${path}`);
  if (stat.size > MAX_PUBLIC_FILE_BYTES) throw Error(`Public asset exceeds 25 MiB: ${path}`);
  const bytes = await readFile(cursor);
  if (bytes.length > MAX_PUBLIC_FILE_BYTES) throw Error(`Public asset exceeds 25 MiB: ${path}`);
  return bytes;
}

async function outputFiles(directory, prefix = '') {
  return (await Promise.all((await readdir(directory, {withFileTypes:true})).map(async entry => entry.isDirectory()
    ? outputFiles(resolve(directory, entry.name), `${prefix}${entry.name}/`)
    : [`${prefix}${entry.name}`]))).flat().sort();
}

/** The reviewed file list is the boundary: never recursively copy a source directory. */
export async function buildPublic({sourceRoot = repositoryRoot, outputDir = resolve(sourceRoot, 'dist-public')} = {}) {
  sourceRoot = resolve(sourceRoot);
  outputDir = resolve(outputDir);
  if (outputDir === sourceRoot || !relative(outputDir, sourceRoot).startsWith(`..${sep}`) && relative(outputDir, sourceRoot) !== '..') {
    throw Error('Public output must not contain the source root.');
  }
  const definition = JSON.parse(await readAsset(sourceRoot, 'public/runtime-assets.json'));
  if (definition.schemaVersion !== 1 || !Array.isArray(definition.groups)) throw Error('Unsupported public asset definition.');
  const entries = definition.groups.flatMap(group => {
    if (!group.id || !group.license || !group.provenance || !Array.isArray(group.files)) throw Error('Public asset groups require provenance and license.');
    return group.files.map(file => ({
      source: safePath(typeof file === 'string' ? file : file.source),
      path: safePath(typeof file === 'string' ? file : file.path),
      group: group.id, license: group.license, provenance: group.provenance,
    }));
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (entries.length + 1 > MAX_PUBLIC_FILES) throw Error('Public artifact exceeds 20,000 files.');
  const paths = new Set();
  for (const entry of entries) {
    if (entry.path === 'asset-manifest.json' || paths.has(entry.path)) throw Error(`Duplicate/reserved public asset path: ${entry.path}`);
    paths.add(entry.path);
    // Never let an output directory overwrite any allowlisted source input.
    const source = resolve(sourceRoot, entry.source);
    if (source === outputDir || source.startsWith(outputDir + sep)) throw Error('Public output overlaps source inputs.');
  }
  // Validate every source before touching the previous artifact.
  const payload = [];
  for (const entry of entries) payload.push({...entry, bytes:await readAsset(sourceRoot, entry.source)});
  const html = payload.find(entry => entry.path === 'studio/index.html')?.bytes.toString('utf8');
  const maps = [...(html || '').matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)];
  if (maps.length !== 1) throw Error('Public HTML must contain exactly one import map.');
  const importMapHash = `'sha256-${digest(maps[0][1], 'base64')}'`;
  const headers = payload.find(entry => entry.path === '_headers');
  if (!headers || !headers.bytes.toString('utf8').includes('{{IMPORT_MAP_HASH}}')) throw Error('Public headers require an import-map hash placeholder.');
  headers.bytes = Buffer.from(headers.bytes.toString('utf8').replaceAll('{{IMPORT_MAP_HASH}}', importMapHash));
  const manifest = {
    schemaVersion:1,
    source:await sourceIdentity(sourceRoot),
    hashAlgorithm:'SHA-256',
    entryPoint:'/studio/',
    manifestExcludesItself:true,
    files:payload.map(({path, group, license, provenance, bytes}) => ({path, bytes:bytes.length, sha256:digest(bytes), group, license, provenance})),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  if (manifestBytes.length > MAX_PUBLIC_FILE_BYTES) throw Error('Public manifest exceeds 25 MiB.');
  const staging = `${outputDir}.staging-${randomUUID()}`;
  const previous = `${outputDir}.previous-${randomUUID()}`;
  let movedPrevious = false;
  try {
    await mkdir(staging, {recursive:true});
    for (const entry of payload) {
      const path = resolve(staging, entry.path);
      await mkdir(dirname(path), {recursive:true});
      await writeFile(path, entry.bytes);
    }
    await writeFile(resolve(staging, 'asset-manifest.json'), manifestBytes);
    const expected = [...paths, 'asset-manifest.json'].sort();
    if (JSON.stringify(await outputFiles(staging)) !== JSON.stringify(expected)) throw Error('Unexpected files in public artifact.');
    try { await rename(outputDir, previous); movedPrevious = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(staging, outputDir); }
    catch (error) { if (movedPrevious) await rename(previous, outputDir); throw error; }
    if (movedPrevious) await rm(previous, {recursive:true, force:true});
  } finally {
    await rm(staging, {recursive:true, force:true});
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildPublic();
  console.log(`Public artifact: ${manifest.files.length + 1} files, ${manifest.files.reduce((sum, file) => sum + file.bytes, 0).toLocaleString()} bytes; /studio/ entry, no server.`);
}

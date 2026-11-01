import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute = promisify(execFile);

/** Unknown source control is a preview, never an implicitly clean release. */
export async function sourceIdentity(sourceRoot) {
  try {
    const {stdout:commit} = await execute('git', ['rev-parse', 'HEAD'], {cwd:sourceRoot});
    const {stdout:status} = await execute('git', ['status', '--porcelain', '--untracked-files=normal'], {cwd:sourceRoot});
    return {commit:commit.trim(), dirtyPreview:status.trim().length > 0};
  } catch {
    return {commit:null, dirtyPreview:true};
  }
}

// git.ts: reads your commits from git repos on this PC, for note suggestions.
// Runs in the MAIN process: starting a program (git.exe) needs Node's child_process.
// Local only: it reads the repos' own history, never GitHub, so no network and no token.
// Never imports electron, so Vitest tests it against a throwaway repo.
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { GIT_FORMAT, parseGitLog, type CommitSuggestion } from '../shared/gitlog'

// promisify turns execFile's callback into a Promise we can await.
// execFile (not exec) passes arguments as a list: no shell, so a folder name with
// spaces or quotes can't be misread as part of a command.
const run = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', cwd, ...args], {
    timeout: 5000, // a stuck git (network drive, huge repo) must not hang Pong
    windowsHide: true, // no black console window flashing on screen
    maxBuffer: 4 * 1024 * 1024
  })
  return stdout
}

// The repo's top folder if `path` is inside a git repo, else null.
export async function repoRoot(path: string): Promise<string | null> {
  try {
    return (await git(path, ['rev-parse', '--show-toplevel'])).trim() || null
  } catch {
    return null // not a repo, or git isn't installed
  }
}

export async function gitInstalled(): Promise<boolean> {
  try {
    await run('git', ['--version'], { timeout: 5000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

// Your commits in one repo between two local timestamps ('2026-10-31T13:20:00').
//   --all         every branch, including ones you haven't pushed
//   --no-merges   "Merge branch ..." isn't work worth a note
//   --author      only yours: the repo's user.email (everyone's, if it has none)
//   --date=format-local  times in this PC's time zone, the same shape as notes use
// Any problem (folder gone, not a repo) gives no suggestions rather than an error.
export async function commitsIn(
  repo: { path: string; outputId: number | null },
  since: string,
  until: string
): Promise<CommitSuggestion[]> {
  try {
    const email = (await git(repo.path, ['config', 'user.email']).catch(() => '')).trim()
    const out = await git(repo.path, [
      'log',
      '--all',
      '--no-merges',
      `--since=${since.replace('T', ' ')}`,
      `--until=${until.replace('T', ' ')}`,
      ...(email ? [`--author=${email}`] : []),
      `--pretty=format:${GIT_FORMAT}`,
      '--date=format-local:%Y-%m-%dT%H:%M:%S'
    ])
    return parseGitLog(out, basename(repo.path), repo.outputId)
  } catch (error) {
    console.warn(`git log failed in ${repo.path}:`, error)
    return []
  }
}

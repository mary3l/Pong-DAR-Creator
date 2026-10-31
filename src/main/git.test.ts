// git.test.ts: real git against a throwaway repo in a temp folder.
// Skipped if git isn't installed.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commitsIn, repoRoot } from './git'

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { windowsHide: true })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasGit)('commitsIn', () => {
  let dir: string

  // A commit at a fixed local time, by `email`.
  const commit = (message: string, when: string, email = 'mgmabano@davao-water.gov.ph') => {
    writeFileSync(join(dir, 'notes.txt'), `${message}\n`, { flag: 'a' })
    execFileSync('git', ['-C', dir, 'add', '.'], { windowsHide: true })
    execFileSync('git', ['-C', dir, '-c', `user.email=${email}`, '-c', 'user.name=Test', 'commit', '-q', '-m', message], {
      windowsHide: true,
      env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }
    })
  }

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'pong-git-')))
    execFileSync('git', ['-C', dir, 'init', '-q'], { windowsHide: true })
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'mgmabano@davao-water.gov.ph'], { windowsHide: true })
    commit('Yesterday evening', '2026-10-30T18:00:00')
    commit('Fix billing lookup timeout', '2026-10-31T09:15:00')
    commit('Someone else', '2026-10-31T10:00:00', 'teammate@davao-water.gov.ph')
    commit('Add GIS popup card', '2026-10-31T14:31:00')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('finds the repo top from a folder inside it', async () => {
    expect(await repoRoot(dir)).toBeTruthy()
    expect(await repoRoot(tmpdir())).toBeNull()
  })

  it('lists only your commits in the window, with local times', async () => {
    const found = await commitsIn({ path: dir, outputId: 3 }, '2026-10-31T00:00:00', '2026-10-31T15:00:00')
    expect(found.map((c) => [c.subject, c.at])).toEqual([
      ['Add GIS popup card', '2026-10-31T14:31:00'],
      ['Fix billing lookup timeout', '2026-10-31T09:15:00']
    ])
    expect(found[0]).toMatchObject({ repo: basename(dir), outputId: 3 })
  })

  it('gives nothing for a folder that is not a repo', async () => {
    expect(await commitsIn({ path: tmpdir(), outputId: null }, '2026-10-31T00:00:00', '2026-10-31T15:00:00')).toEqual([])
  })
})

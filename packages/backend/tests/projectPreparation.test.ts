import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createProjectPreparer } from '../src/runtime/projectPreparation'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ProjectPreparer', () => {
  test('reports an absent adapter without guessing a package manager', async () => {
    const fixture = await createFixture()

    const result = await createProjectPreparer().prepare({
      projectRoot: fixture.repo,
      runtimeDir: fixture.runtime,
    })

    expect(result).toMatchObject({ kind: 'absent', exitCode: null })
    expect(result.logs).toContain('scripts/hopi/prepare is missing')
  })

  test('runs an idempotent adapter in the selected checkout', async () => {
    const fixture = await createFixture()
    await writeAdapter(
      fixture.repo,
      'await Bun.write(`${process.env.HOPI_PREPARE_RUNTIME_DIR}/cwd.txt`, process.cwd()); console.log("ready")',
    )
    await git(fixture.repo, ['add', '.'])
    await git(fixture.repo, ['commit', '-m', 'add prepare'])

    const result = await createProjectPreparer().prepare({
      projectRoot: fixture.repo,
      runtimeDir: fixture.runtime,
    })

    expect(result).toMatchObject({ kind: 'ready', exitCode: 0 })
    expect(result.logs).toContain('stdout: ready')
    expect(await Bun.file(join(fixture.runtime, 'cwd.txt')).text()).toBe(
      await realpath(fixture.repo),
    )
    expect(await git(fixture.repo, ['status', '--porcelain'])).toBe('')
  })

  test('fails when preparation mutates Project source', async () => {
    const fixture = await createFixture()
    await writeAdapter(fixture.repo, 'await Bun.write("generated.txt", "unexpected\\n")')
    await git(fixture.repo, ['add', '.'])
    await git(fixture.repo, ['commit', '-m', 'add prepare'])

    const result = await createProjectPreparer().prepare({
      projectRoot: fixture.repo,
      runtimeDir: fixture.runtime,
    })

    expect(result.kind).toBe('source_changed')
    expect(result.logs).toContain('generated.txt')
  })

  test('passes one runtime manifest for a multi-Repo workspace', async () => {
    const fixture = await createFixture()
    const api = join(dirname(fixture.repo), 'api')
    await mkdir(api, { recursive: true })
    await Bun.write(join(api, 'README.md'), '# API\n')
    await git(api, ['init', '-b', 'main'])
    await git(api, ['config', 'user.name', 'HOPI Test'])
    await git(api, ['config', 'user.email', 'hopi@example.test'])
    await git(api, ['add', '.'])
    await git(api, ['commit', '-m', 'initial'])
    await writeAdapter(
      fixture.repo,
      'const manifest = await Bun.file(process.env.HOPI_REPOS_FILE!).json(); console.log(`api=${manifest.repos.api}`)',
    )
    await git(fixture.repo, ['add', '.'])
    await git(fixture.repo, ['commit', '-m', 'add prepare'])

    const result = await createProjectPreparer().prepare({
      projectRoot: fixture.repo,
      runtimeDir: fixture.runtime,
      primaryRepoId: 'web',
      repoRoots: [
        { repoId: 'web', path: fixture.repo },
        { repoId: 'api', path: api },
      ],
    })

    expect(result.kind).toBe('ready')
    expect(result.logs).toContain(`api=${api}`)
  })

  test('does not run over uncheckpointed Generator source', async () => {
    const fixture = await createFixture()
    await writeAdapter(fixture.repo, 'throw new Error("must not run")')
    await git(fixture.repo, ['add', '.'])
    await git(fixture.repo, ['commit', '-m', 'add prepare'])
    await Bun.write(join(fixture.repo, 'partial.ts'), 'partial\n')

    const result = await createProjectPreparer().prepare({
      projectRoot: fixture.repo,
      runtimeDir: fixture.runtime,
    })

    expect(result.kind).toBe('skipped_dirty')
    expect(result.logs).toContain('partial.ts')
  })
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-project-prepare-'))
  roots.push(root)
  const repo = join(root, 'repo')
  const runtime = join(root, 'runtime')
  await mkdir(repo, { recursive: true })
  await Bun.write(join(repo, 'README.md'), '# Project\n')
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'user.name', 'HOPI Test'])
  await git(repo, ['config', 'user.email', 'hopi@example.test'])
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'initial'])
  return { repo, runtime }
}

async function writeAdapter(repo: string, body: string) {
  const path = join(repo, 'scripts', 'hopi', 'prepare')
  await mkdir(join(repo, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(path, `#!/usr/bin/env bun\n${body}\n`)
  await chmod(path, 0o755)
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
  return stdout.trim()
}

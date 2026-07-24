import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createCommandRunner } from '../src/commands/commandRunner'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'command-runner')
const backendRoot = join(import.meta.dir, '..')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('CommandRunner', () => {
  test('plans, executes, and journals one transparent Project rebind command', async () => {
    const home = createAssistantHomeStore(join(temporaryRoot, 'home'))
    const original = await createRepo(join(temporaryRoot, 'original'))
    const target = await createRepo(join(temporaryRoot, 'target'))
    await home.linkProject({ projectId: 'P-1', repoPath: original })
    const excludedProjectIds: string[] = []
    const commands = createCommandRunner(home, {
      async runProjectMutation(projectId, operation) {
        excludedProjectIds.push(projectId)
        return operation()
      },
    })
    const unchanged = await commands.planProjectRebind({
      projectId: 'P-1',
      repos: [{ repoId: 'primary', repoPath: original }],
    })
    expect(unchanged).toMatchObject({
      changedRepoIds: [],
      summary: 'Project P-1 Repo bindings are already current.',
    })
    expect(await Bun.file(home.paths.operationsRoot).exists()).toBe(false)
    await commands.executeProjectRebind(unchanged.input)
    expect(excludedProjectIds).toEqual([])
    const input = {
      projectId: 'P-1',
      repos: [{ repoId: 'primary', repoPath: target }],
    }

    const plan = await commands.planProjectRebind(input)
    expect(plan).toMatchObject({
      command: 'project.rebind',
      input,
      effects: expect.arrayContaining(['publish project.yml before projects.yml']),
    })

    const execution = await commands.executeProjectRebind(input)
    const operationRoot = join(home.paths.operationsRoot, execution.result.operationId)

    expect(excludedProjectIds).toEqual(['P-1'])
    expect(execution.result).toMatchObject({
      command: 'project.rebind',
      status: 'completed',
      project: { projectId: 'P-1', repoPath: target },
    })
    expect(JSON.parse(await Bun.file(join(operationRoot, 'request.json')).text())).toMatchObject({
      command: 'project.rebind',
      input,
    })
    expect(JSON.parse(await Bun.file(join(operationRoot, 'plan.json')).text())).toMatchObject({
      operationId: execution.result.operationId,
      command: 'project.rebind',
      changedRepoIds: ['primary'],
    })
    expect(JSON.parse(await Bun.file(join(operationRoot, 'result.json')).text())).toMatchObject({
      status: 'completed',
      recoveryPaths: [expect.any(String)],
    })
    expect(await Bun.file(join(operationRoot, 'events.jsonl')).text()).toContain(
      '"phase":"published"',
    )

    const cli = Bun.spawn(
      [
        'bun',
        'run',
        'src/cli/hopi.ts',
        'project',
        'rebind',
        '--home',
        home.paths.rootDir,
        '--project',
        'P-1',
        '--repo',
        'primary',
        '--path',
        target,
        '--plan',
      ],
      { cwd: backendRoot, stdout: 'pipe', stderr: 'pipe' },
    )
    const [cliOutput, cliError, cliExit] = await Promise.all([
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
      cli.exited,
    ])
    expect(cliExit, cliError).toBe(0)
    expect(JSON.parse(cliOutput)).toMatchObject({
      command: 'project.rebind',
      input,
    })

    const cliTarget = await createRepo(join(temporaryRoot, 'cli-target'))
    const cliExecution = Bun.spawn(
      [
        'bun',
        'run',
        'src/cli/hopi.ts',
        'project',
        'rebind',
        '--home',
        home.paths.rootDir,
        '--project',
        'P-1',
        '--repo',
        'primary',
        '--path',
        cliTarget,
      ],
      { cwd: backendRoot, stdout: 'pipe', stderr: 'pipe' },
    )
    const [executionOutput, executionError, executionExit] = await Promise.all([
      new Response(cliExecution.stdout).text(),
      new Response(cliExecution.stderr).text(),
      cliExecution.exited,
    ])
    expect(executionExit, executionError).toBe(0)
    expect(JSON.parse(executionOutput)).toMatchObject({
      result: {
        command: 'project.rebind',
        status: 'completed',
        project: { projectId: 'P-1', repoPath: cliTarget },
      },
    })
    expect(await home.readProject('P-1')).toMatchObject({ repoPath: cliTarget })
  })
})

async function createRepo(path: string) {
  await mkdir(path, { recursive: true })
  await git(path, ['init', '-b', 'main'])
  await git(path, ['config', 'user.email', 'hopi@example.test'])
  await git(path, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(path, 'README.md'), '# Test Repo\n')
  await git(path, ['add', 'README.md'])
  await git(path, ['commit', '-m', 'initial'])
  return path
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

import { parseArgs } from 'node:util'
import { defaultAssistantHomeRoot } from '../packages/backend/src/runtime/assistantHomeMigration'
import { applyProjectReset, planProjectReset } from '../packages/backend/src/runtime/projectReset'

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    home: { type: 'string' },
    apply: { type: 'boolean', default: false },
    confirm: { type: 'string' },
  },
})

if (positionals.length !== 1) {
  fail(
    'Usage: bun run reset:project -- <projectId> [--home <directory>] [--apply --confirm <projectId>]',
  )
}

const projectId = positionals[0] as string
const homeRoot = values.home ?? process.env.HOPI_HOME?.trim() ?? defaultAssistantHomeRoot()

if (!values.apply) {
  if (values.confirm) fail('--confirm is valid only with --apply')
  const plan = await planProjectReset({ homeRoot, projectId })
  console.log(JSON.stringify({ kind: 'project_reset_plan', ...plan }, null, 2))
  if (plan.blockers.length > 0) process.exitCode = 1
} else {
  if (!values.confirm) {
    fail(`Applying reset requires --confirm ${projectId}`)
  }
  console.log(
    JSON.stringify(
      await applyProjectReset({
        homeRoot,
        projectId,
        confirm: values.confirm,
      }),
      null,
      2,
    ),
  )
}

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

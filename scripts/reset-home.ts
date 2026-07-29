import { parseArgs } from 'node:util'
import { defaultAssistantHomeRoot } from '../packages/backend/src/runtime/assistantHomeRoot'
import { applyHomeReset, planHomeReset } from '../packages/backend/src/runtime/homeReset'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    home: { type: 'string' },
    apply: { type: 'boolean', default: false },
    confirm: { type: 'string' },
  },
})

const homeRoot = values.home ?? process.env.HOPI_HOME?.trim() ?? defaultAssistantHomeRoot()

if (!values.apply) {
  if (values.confirm) fail('--confirm is valid only with --apply')
  console.log(JSON.stringify({ kind: 'home_reset_plan', ...(await planHomeReset(homeRoot)) }, null, 2))
} else {
  if (!values.confirm) {
    fail(`Applying reset requires --confirm ${homeRoot}`)
  }
  console.log(
    JSON.stringify(
      await applyHomeReset({
        homeRoot,
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

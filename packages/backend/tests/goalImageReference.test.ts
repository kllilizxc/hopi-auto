import { describe, expect, test } from 'bun:test'
import { findNonPortableGoalImageReference } from '../src/domain/goalImageReference'

describe('findNonPortableGoalImageReference', () => {
  test('finds local image files without rejecting URLs or Project-relative paths', () => {
    expect(findNonPortableGoalImageReference('Use /home/user/reference.png.')).toBe(
      '/home/user/reference.png',
    )
    expect(findNonPortableGoalImageReference(String.raw`Use C:\Users\user\reference.jpg.`)).toBe(
      String.raw`C:\Users\user\reference.jpg`,
    )
    expect(findNonPortableGoalImageReference('Use file:///tmp/reference.webp.')).toBe(
      'file:///tmp/reference.webp',
    )
    expect(findNonPortableGoalImageReference('Use ~/.codex/generated_images/reference.gif.')).toBe(
      '~/.codex/generated_images/reference.gif',
    )
    expect(
      findNonPortableGoalImageReference('Use file://wsl.localhost/Debian/home/user/reference.png.'),
    ).toBe('file://wsl.localhost/Debian/home/user/reference.png')
    expect(findNonPortableGoalImageReference('Call /api/reference.png.')).toBeNull()
    expect(findNonPortableGoalImageReference('Read https://example.com/reference.png.')).toBeNull()
    expect(
      findNonPortableGoalImageReference(
        'Use .hopi/docs/goals/G-1/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/reference.png.',
      ),
    ).toBeNull()
  })
})

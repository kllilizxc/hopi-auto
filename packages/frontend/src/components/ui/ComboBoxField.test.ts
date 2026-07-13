import { expect, test } from 'bun:test'
import { comboBoxOptionTextValue } from './ComboBoxField'

test('combobox selections persist the option value instead of the display label', () => {
  expect(
    comboBoxOptionTextValue({
      label: 'Gemini 3.1 Pro Preview (local proxy)',
      value: 'gemini-3.1-pro-preview',
    }),
  ).toBe('gemini-3.1-pro-preview')
})

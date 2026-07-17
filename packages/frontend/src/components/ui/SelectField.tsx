import { ListBox } from '@heroui/react/list-box'
import { Select } from '@heroui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { AppScrollShadow } from './ScrollShadow'

export interface SelectOption {
  description?: ReactNode
  isDisabled?: boolean
  label: ReactNode
  textValue?: string
  value: string
}

export interface SelectFieldProps {
  'aria-label'?: string
  className?: string
  disabled?: boolean
  label?: ReactNode
  labelClassName?: string
  name?: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  popoverClassName?: string
  triggerClassName?: string
  value: string | null
}

export function SelectField({
  'aria-label': ariaLabel,
  className,
  disabled,
  label,
  labelClassName,
  name,
  onValueChange,
  options,
  placeholder,
  popoverClassName,
  triggerClassName,
  value,
}: SelectFieldProps) {
  return (
    <Select
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      className={cn('app-select', className)}
      isDisabled={disabled}
      name={name}
      onSelectionChange={(key) => {
        if (key !== null) onValueChange(String(key))
      }}
      placeholder={placeholder}
      selectedKey={value ?? null}
    >
      {label ? <span className={cn('app-select__label', labelClassName)}>{label}</span> : null}
      <Select.Trigger className={cn('app-select__trigger', triggerClassName)}>
        <Select.Value className="app-select__value" />
        <Select.Indicator className="app-select__indicator">
          <ChevronDown />
        </Select.Indicator>
      </Select.Trigger>
      <Select.Popover className={cn('app-select__popover', popoverClassName)}>
        <AppScrollShadow className="app-select__scroll">
          <ListBox aria-label={ariaLabel ?? (typeof label === 'string' ? label : 'Options')}>
            {options.map((option) => (
              <ListBox.Item
                id={option.value}
                isDisabled={option.isDisabled}
                key={option.value}
                textValue={option.textValue ?? (typeof option.label === 'string' ? option.label : option.value)}
              >
                <span className="app-select__option-copy">
                  <span>{option.label}</span>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                <ListBox.ItemIndicator className="app-select__option-indicator">
                  <Check />
                </ListBox.ItemIndicator>
              </ListBox.Item>
            ))}
          </ListBox>
        </AppScrollShadow>
      </Select.Popover>
    </Select>
  )
}

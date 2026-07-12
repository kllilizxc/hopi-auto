import { Button } from '@heroui/react/button'
import { ComboBox } from '@heroui/react/combo-box'
import { Input } from '@heroui/react/input'
import { Label } from '@heroui/react/label'
import { ListBox } from '@heroui/react/list-box'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { AppScrollShadow } from './ScrollShadow'

export interface ComboBoxOption {
  description?: ReactNode
  isDisabled?: boolean
  label: ReactNode
  textValue?: string
  value: string
}

export interface ComboBoxFieldProps {
  'aria-label'?: string
  className?: string
  disabled?: boolean
  label?: ReactNode
  labelClassName?: string
  name?: string
  onInputChange: (value: string) => void
  options: ComboBoxOption[]
  popoverClassName?: string
  triggerClassName?: string
  inputClassName?: string
  value: string
  placeholder?: string
}

export function ComboBoxField({
  'aria-label': ariaLabel,
  className,
  disabled,
  label,
  labelClassName,
  name,
  onInputChange,
  options,
  popoverClassName,
  triggerClassName,
  inputClassName,
  value,
  placeholder,
}: ComboBoxFieldProps) {
  return (
    <ComboBox
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      className={cn('app-text-field', className)}
      isDisabled={disabled}
      name={name}
      inputValue={value}
      onInputChange={onInputChange}
      allowsCustomValue
    >
      {label ? <Label className={cn('app-field-label', labelClassName)}>{label}</Label> : null}

      <div
        className={cn(
          'app-input flex items-center p-0 overflow-hidden focus-within:ring-2 focus-within:ring-[var(--focus)]',
          triggerClassName,
        )}
        style={{ display: 'flex' }}
      >
        <Input
          className={cn(
            'flex-1 border-none bg-transparent h-full px-2 outline-none',
            inputClassName,
          )}
          placeholder={placeholder}
        />
        <Button className="flex items-center justify-center h-full px-2 bg-transparent border-none cursor-pointer text-[var(--muted)] hover:text-[var(--text)]">
          <ChevronDown className="w-[13px] h-[13px]" />
        </Button>
      </div>

      <ComboBox.Popover className={cn('app-select__popover', popoverClassName)}>
        <AppScrollShadow className="app-select__scroll">
          <ListBox aria-label={ariaLabel ?? (typeof label === 'string' ? label : 'Options')}>
            {options.map((option) => (
              <ListBox.Item
                id={option.value}
                isDisabled={option.isDisabled}
                key={option.value}
                textValue={
                  option.textValue ??
                  (typeof option.label === 'string' ? option.label : option.value)
                }
              >
                <span className="app-select__option-copy">
                  <span>{option.label}</span>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                {option.value === value && (
                  <ListBox.ItemIndicator className="app-select__option-indicator !opacity-100">
                    <Check className="w-[13px] h-[13px]" />
                  </ListBox.ItemIndicator>
                )}
              </ListBox.Item>
            ))}
          </ListBox>
        </AppScrollShadow>
      </ComboBox.Popover>
    </ComboBox>
  )
}

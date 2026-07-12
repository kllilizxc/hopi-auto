import { Description } from '@heroui/react/description'
import { FieldError } from '@heroui/react/field-error'
import { Form, type FormProps } from '@heroui/react/form'
import { Input, type InputProps } from '@heroui/react/input'
import { Label } from '@heroui/react/label'
import { TextArea, type TextAreaProps } from '@heroui/react/textarea'
import { TextField, type TextFieldProps } from '@heroui/react/textfield'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface AppFormProps extends Omit<FormProps, 'className'> {
  className?: string
}

export function AppForm({ className, ...props }: AppFormProps) {
  return <Form className={cn('app-form', className)} {...props} />
}

export interface AppInputProps extends Omit<InputProps, 'className'> {
  className?: string
}

export function AppInput({ className, ...props }: AppInputProps) {
  return <Input className={cn('app-input', className)} {...props} />
}

export interface AppTextAreaProps extends Omit<TextAreaProps, 'className'> {
  className?: string
}

export function AppTextArea({ className, ...props }: AppTextAreaProps) {
  return <TextArea className={cn('app-textarea', className)} {...props} />
}

interface FieldShellProps extends Omit<TextFieldProps, 'children' | 'className' | 'onChange'> {
  className?: string
  description?: ReactNode
  errorMessage?: ReactNode
  label: ReactNode
  labelClassName?: string
  name?: string
  onValueChange?: (value: string) => void
  placeholder?: string
}

export interface AppTextFieldProps extends FieldShellProps {
  autoFocus?: boolean
  inputClassName?: string
  type?: InputProps['type']
}

export function AppTextField({
  autoFocus,
  className,
  description,
  errorMessage,
  inputClassName,
  label,
  labelClassName,
  name,
  onValueChange,
  placeholder,
  type,
  ...props
}: AppTextFieldProps) {
  return (
    <TextField
      className={cn('app-text-field', className)}
      onChange={onValueChange}
      {...props}
    >
      <Label className={cn('app-field-label', labelClassName)}>{label}</Label>
      <Input
        autoFocus={autoFocus}
        className={cn('app-input', inputClassName)}
        name={name}
        placeholder={placeholder}
        type={type}
      />
      {description ? <Description>{description}</Description> : null}
      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
    </TextField>
  )
}

export interface AppTextAreaFieldProps extends FieldShellProps {
  rows?: number
  textAreaClassName?: string
}

export function AppTextAreaField({
  className,
  description,
  errorMessage,
  label,
  labelClassName,
  name,
  onValueChange,
  placeholder,
  rows,
  textAreaClassName,
  ...props
}: AppTextAreaFieldProps) {
  return (
    <TextField
      className={cn('app-text-field', className)}
      onChange={onValueChange}
      {...props}
    >
      <Label className={cn('app-field-label', labelClassName)}>{label}</Label>
      <TextArea
        className={cn('app-textarea', textAreaClassName)}
        name={name}
        placeholder={placeholder}
        rows={rows}
      />
      {description ? <Description>{description}</Description> : null}
      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
    </TextField>
  )
}

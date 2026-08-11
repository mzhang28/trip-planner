import type { ReactNode } from 'react';
import {
  FieldError,
  Input,
  Label,
  Text,
  TextArea,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components';
import { cn } from '../lib/cn';

const CONTROL = cn(
  'w-full rounded-md border border-line-input bg-card px-2.5 text-ink',
  'placeholder:text-ink-placeholder',
  'data-focused:border-accent data-focused:outline-focus data-focused:outline-2 data-focused:outline-offset-[-1px]',
  'data-invalid:border-danger',
  'data-disabled:cursor-not-allowed data-disabled:bg-sunken data-disabled:opacity-60',
);

export interface TextFieldProps extends Omit<AriaTextFieldProps, 'children'> {
  label: string;
  /** Hidden from view but still read out, for a field whose purpose is obvious. */
  labelHidden?: boolean;
  /** Standing guidance. Shown until an error replaces it. */
  description?: ReactNode;
  /**
   * What went wrong and how to put it right. Shown in place of the description,
   * because two messages competing under one field is one too many.
   */
  errorMessage?: ReactNode;
  placeholder?: string;
  /** Renders a multi-line control. */
  multiline?: boolean;
  rows?: number;
  className?: string;
}

export function TextField({
  label,
  labelHidden = false,
  description,
  errorMessage,
  placeholder,
  multiline = false,
  rows = 3,
  className,
  ...props
}: TextFieldProps) {
  const invalid = props.isInvalid ?? Boolean(errorMessage);

  return (
    <AriaTextField {...props} isInvalid={invalid} className={cn('flex flex-col gap-1', className)}>
      <Label className={cn('text-xs font-medium text-ink-secondary', labelHidden && 'sr-only')}>
        {label}
      </Label>

      {multiline ? (
        <TextArea placeholder={placeholder} rows={rows} className={cn(CONTROL, 'resize-y py-2')} />
      ) : (
        <Input placeholder={placeholder} className={cn(CONTROL, 'h-9')} />
      )}

      {description && !invalid && (
        <Text slot="description" className="text-2xs text-ink-muted">
          {description}
        </Text>
      )}

      {/*
        React Aria wires this to aria-describedby and only renders it when the
        field is invalid, so the message reaches a screen reader at the moment
        it becomes true rather than on every render.
      */}
      <FieldError className="text-2xs text-danger">{errorMessage}</FieldError>
    </AriaTextField>
  );
}

import { CheckedField, type CheckedFieldProps } from './CheckedField';

export type TimeFieldProps = Omit<
  CheckedFieldProps,
  'placeholder' | 'inputMode' | 'suggestions'
>;

/** A checked field carrying a time of day, written the way the app prints it. */
export function TimeField(props: TimeFieldProps) {
  return <CheckedField {...props} placeholder="09:00" inputMode="numeric" />;
}

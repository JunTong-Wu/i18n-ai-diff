import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from '@phosphor-icons/react';
import type { ComponentPropsWithoutRef } from 'react';
import { cx } from './utils';

type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

export function Checkbox({
  className,
  ...props
}: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      className={cx('ui-checkbox', className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="ui-checkbox-indicator">
        <Check size={12} weight="bold" aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

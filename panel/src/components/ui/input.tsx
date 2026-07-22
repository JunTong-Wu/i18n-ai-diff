import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cx } from './utils';

export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cx('ui-input', className)}
      {...props}
    />
  ),
);

Input.displayName = 'Input';

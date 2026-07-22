import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cx } from './utils';

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cx('ui-textarea', className)}
      {...props}
    />
  ),
);

Textarea.displayName = 'Textarea';

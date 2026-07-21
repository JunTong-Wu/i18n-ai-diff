import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentPropsWithoutRef } from 'react';
import { cx } from './utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

type DialogContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content>;

export function DialogContent({
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay" />
      <DialogPrimitive.Content
        className={cx('ui-dialog-content', className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

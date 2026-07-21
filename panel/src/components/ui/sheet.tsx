import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentPropsWithoutRef } from 'react';
import { cx } from './utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

type SheetContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: 'left' | 'right' | 'top' | 'bottom';
};

export function SheetContent({
  className,
  children,
  side = 'left',
  ...props
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-sheet-overlay" />
      <DialogPrimitive.Content
        className={cx('ui-sheet-content', className)}
        data-side={side}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

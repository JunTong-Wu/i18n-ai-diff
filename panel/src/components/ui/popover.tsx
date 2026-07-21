import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentPropsWithoutRef } from 'react';
import { cx } from './utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

type PopoverContentProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>;

export function PopoverContent({
  align = 'start',
  sideOffset = 8,
  collisionPadding = 12,
  className,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cx('ui-popover-content', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

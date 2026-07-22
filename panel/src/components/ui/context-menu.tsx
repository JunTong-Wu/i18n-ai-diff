import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import type { ComponentPropsWithoutRef } from 'react';
import { cx } from './utils';

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;

type ContextMenuContentProps = ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>;

export function ContextMenuContent({
  className,
  collisionPadding = 12,
  ...props
}: ContextMenuContentProps) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        collisionPadding={collisionPadding}
        className={cx('ui-context-menu-content', className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

type ContextMenuItemProps = ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>;

export function ContextMenuItem({
  className,
  ...props
}: ContextMenuItemProps) {
  return (
    <ContextMenuPrimitive.Item
      className={cx('ui-context-menu-item', className)}
      {...props}
    />
  );
}

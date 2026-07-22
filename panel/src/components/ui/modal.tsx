import { X } from '@phosphor-icons/react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { DialogClose, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { cx } from './utils';

type ModalContentProps = ComponentPropsWithoutRef<typeof DialogContent> & {
  size?: 'md' | 'lg' | 'xl';
};

export function ModalContent({
  className,
  children,
  size = 'md',
  ...props
}: ModalContentProps) {
  return (
    <DialogContent className={cx('ui-modal', `is-${size}`, className)} {...props}>
      {children}
    </DialogContent>
  );
}

export function ModalHeader({
  children,
  className,
  icon,
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={cx('ui-modal-header', className)}>
      <div className="ui-modal-heading">
        {icon && <span className="ui-modal-icon" aria-hidden="true">{icon}</span>}
        {children}
      </div>
      <ModalCloseButton />
    </div>
  );
}

export function ModalTitleBlock({
  description,
  descriptionId,
  title,
}: {
  description?: ReactNode;
  descriptionId?: string;
  title: ReactNode;
}) {
  return (
    <div className="ui-modal-title-block">
      <DialogTitle asChild>
        <h2>{title}</h2>
      </DialogTitle>
      {description && (
        <DialogDescription asChild>
          <p id={descriptionId}>{description}</p>
        </DialogDescription>
      )}
    </div>
  );
}

export function ModalCloseButton({
  ariaLabel = 'Close modal',
  className,
}: {
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <DialogClose asChild>
      <button type="button" className={cx('ui-modal-close', className)} aria-label={ariaLabel}>
        <X size={18} aria-hidden="true" />
      </button>
    </DialogClose>
  );
}

export function ModalActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx('ui-modal-actions', className)}>{children}</div>;
}

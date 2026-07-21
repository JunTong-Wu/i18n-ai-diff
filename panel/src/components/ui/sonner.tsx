import { Toaster as SonnerToaster, toast } from 'sonner';

export { toast };

export function Toaster() {
  return (
    <SonnerToaster
      closeButton
      richColors={false}
      position="top-right"
      toastOptions={{
        duration: 7000,
        classNames: {
          toast: 'ui-toast',
          title: 'ui-toast-title',
          description: 'ui-toast-description',
          closeButton: 'ui-toast-close',
        },
      }}
    />
  );
}

import React, { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the cancel button when dialog opens
  useEffect(() => {
    cancelBtnRef.current?.focus();
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
      // Trap focus within the dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onCancel}
      aria-hidden="false"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-message"
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: '24px 32px',
          maxWidth: 400,
          width: '90%',
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <p
          id="confirm-dialog-message"
          style={{ margin: '0 0 20px', fontSize: 16, color: '#222' }}
        >
          {message}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            ref={cancelBtnRef}
            onClick={onCancel}
            style={{
              padding: '8px 18px',
              border: '1px solid #ccc',
              borderRadius: 6,
              background: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            style={{
              padding: '8px 18px',
              border: 'none',
              borderRadius: 6,
              background: '#e53e3e',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

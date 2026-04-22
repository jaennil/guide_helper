import { useLanguage } from "../context/LanguageContext";

interface AiDescriptionModalProps {
  isOpen: boolean;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function AiDescriptionModal({
  isOpen,
  value,
  saving,
  onChange,
  onClose,
  onSave,
}: AiDescriptionModalProps) {
  const { t } = useLanguage();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <h2>{t("ai.modalTitle")}</h2>
        <div className="modal-form">
          <p style={{ fontSize: "0.85em", color: "var(--text-secondary)", marginBottom: "8px" }}>
            {t("ai.hint")}
          </p>
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={8}
            style={{
              width: "100%",
              resize: "vertical",
              padding: "8px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-primary)",
              fontSize: "0.9em",
            }}
          />
          <div className="modal-actions">
            <button onClick={onClose} className="modal-cancel">
              {t("ai.cancel")}
            </button>
            <button onClick={onSave} disabled={saving} className="modal-save">
              {saving ? t("map.saving") : t("ai.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

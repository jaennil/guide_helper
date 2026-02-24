import { useRef, useCallback } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { useLanguage } from "../context/LanguageContext";
import "./QRCodeModal.css";

interface QRCodeModalProps {
  url: string;
  routeName: string;
  onClose: () => void;
}

export function QRCodeModal({ url, routeName, onClose }: QRCodeModalProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${routeName || "route"}-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [routeName]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div className="qr-backdrop" onClick={handleBackdropClick}>
      <div className="qr-modal">
        <h3 className="qr-title">{t("qr.title")}</h3>
        <p className="qr-route-name">{routeName}</p>
        <div className="qr-canvas-wrapper" ref={canvasRef}>
          <QRCodeCanvas
            value={url}
            size={240}
            marginSize={2}
            level="M"
          />
        </div>
        <p className="qr-hint">{t("qr.scanHint")}</p>
        <div className="qr-actions">
          <button className="btn-secondary" onClick={handleDownload}>
            {t("qr.download")}
          </button>
          <button className="btn-secondary" onClick={onClose}>
            {t("qr.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

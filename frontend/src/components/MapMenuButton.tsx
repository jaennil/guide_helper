import { useState, useRef, useEffect } from "react";

interface MapMenuButtonProps {
  children: React.ReactNode;
}

export function MapMenuButton({ children }: MapMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="map-menu" ref={menuRef}>
      <button
        className="map-menu-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Menu"
      >
        <span className="map-menu-icon" />
      </button>
      {open && (
        <div className="map-menu-dropdown" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

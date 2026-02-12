import { useState, useEffect, useRef, useCallback } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useLanguage } from "../context/LanguageContext";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string];
}

export function GeoSearchControl() {
  const map = useMap();
  const { t, locale } = useLanguage();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Prevent map click propagation through the search control
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    }
  }, []);

  // Click-outside handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const search = useCallback(
    async (q: string) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }

      if (q.length < 3) {
        setResults([]);
        setIsOpen(false);
        setSearched(false);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      console.log(`[geo-search] searching: "${q}" (locale=${locale})`);

      try {
        const params = new URLSearchParams({
          q,
          format: "jsonv2",
          limit: "5",
          "accept-language": locale,
        });
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?${params}`,
          { signal: controller.signal }
        );
        const data: NominatimResult[] = await res.json();
        console.log(`[geo-search] got ${data.length} results`);
        setResults(data);
        setIsOpen(true);
        setSearched(true);
        setActiveIndex(-1);
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("[geo-search] fetch failed:", err);
        }
      } finally {
        setLoading(false);
      }
    },
    [locale]
  );

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => search(value), 300);
  };

  const selectResult = (result: NominatimResult) => {
    const [south, north, west, east] = result.boundingbox.map(Number);
    const bounds = L.latLngBounds(
      L.latLng(south, west),
      L.latLng(north, east)
    );
    console.log(`[geo-search] flying to: ${result.display_name}`);
    map.flyToBounds(bounds, { padding: [20, 20], maxZoom: 17 });
    setQuery(result.display_name);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) {
      if (e.key === "Escape") {
        inputRef.current?.blur();
        setIsOpen(false);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          selectResult(results[activeIndex]);
        }
        break;
      case "Escape":
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setIsOpen(false);
    setSearched(false);
    inputRef.current?.focus();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="geo-search">
      <div className="geo-search-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="geo-search-input"
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
        />
        {query && (
          <button
            type="button"
            className="geo-search-clear"
            onClick={handleClear}
            aria-label="Clear"
          >
            &times;
          </button>
        )}
      </div>
      {isOpen && (
        <ul className="geo-search-results">
          {loading && (
            <li className="geo-search-loading">...</li>
          )}
          {!loading && searched && results.length === 0 && (
            <li className="geo-search-no-results">{t("search.noResults")}</li>
          )}
          {results.map((result, idx) => (
            <li
              key={result.place_id}
              className={`geo-search-item${idx === activeIndex ? " geo-search-item--active" : ""}`}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                selectResult(result);
              }}
            >
              {result.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

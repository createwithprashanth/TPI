import { useEffect, useMemo, useState } from "react";
import { Search, ChevronDown, ChevronRight, X, Pipette, Star, Clock } from "lucide-react";
import { ISA_CATEGORIES, ALL_SYMBOLS, type ISASymbol } from "./ISASymbols";

interface Props {
  selectedSymbolId: string | null;
  onSelectSymbol: (id: string | null) => void;
  activeColor: string;
  onColorChange: (color: string) => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#000000", // black
  "#ffffff", // white
];

const FAVORITES_STORAGE_KEY = "precisionpdf.pidSymbolFavorites";
const RECENTS_STORAGE_KEY = "precisionpdf.pidSymbolRecents";
const MAX_RECENTS = 12;

const SEARCH_ALIASES: Record<string, string[]> = {
  psv: ["v-safety-relief"],
  prv: ["v-safety-relief", "v-pressure-regulator"],
  pvsv: ["v-pressure-vacuum"],
  pvv: ["v-pressure-vacuum"],
  nrv: ["v-check", "v-swing-check", "v-tilting-disc-check"],
  mov: ["act-electric-motor", "v-control", "v-fail-open", "v-fail-close"],
  sov: ["act-solenoid"],
  sdv: ["v-fail-close", "v-control"],
  esdv: ["v-fail-close", "v-control"],
  bdv: ["v-blowdown"],
  xv: ["v-ball", "v-butterfly", "v-plug", "v-control"],
  cv: ["v-control", "v-fail-open", "v-fail-close"],
  hv: ["act-handwheel", "act-hand-lever"],
  ro: ["ie-orifice-plate"],
  fe: ["ie-orifice-plate", "ie-venturi", "ie-rotameter", "ie-flow-conditioner"],
  ft: ["ib-transmitter", "ie-turbine-meter", "ie-mag-meter", "ie-vortex-meter", "ie-coriolis"],
  fit: ["ib-field-discrete", "ib-local-indicator"],
  pt: ["ib-transmitter"],
  pi: ["ib-local-indicator"],
  pit: ["ib-transmitter", "ib-local-indicator"],
  tt: ["ib-transmitter"],
  ti: ["ib-local-indicator"],
  lit: ["ib-transmitter", "ib-local-indicator"],
  lt: ["ib-transmitter"],
  li: ["ib-local-indicator"],
  at: ["ib-analyzer"],
  ait: ["ib-analyzer"],
  la: ["ib-alarm"],
  pah: ["ib-alarm"],
  lah: ["ib-alarm"],
  sil: ["ib-sis"],
  sis: ["ib-sis", "sl-safety-signal"],
  dcs: ["ib-shared-dcs"],
  plc: ["ib-plc"],
};

function readStoredIds(key: string): string[] {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeStoredIds(key: string, ids: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable in hardened browser modes; favorites still work for this session.
  }
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getSymbolsByIds(ids: string[]): ISASymbol[] {
  return ids
    .map((id) => ALL_SYMBOLS.find((symbol) => symbol.id === id))
    .filter((symbol): symbol is ISASymbol => Boolean(symbol));
}

function symbolMatchesQuery(symbol: ISASymbol, query: string): boolean {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const aliasIds = SEARCH_ALIASES[compactQuery] ?? [];
  if (aliasIds.includes(symbol.id)) return true;

  const haystack = normalizeSearch([
    symbol.name,
    symbol.description,
    symbol.category,
    ...symbol.tags,
    symbol.id,
  ].join(" "));

  return normalizedQuery
    .split(/\s+/)
    .every((part) => haystack.includes(part) || haystack.replace(/\s+/g, "").includes(part));
}

function SymbolTile({
  symbol,
  selected,
  color,
  onClick,
  favorite,
  onToggleFavorite,
}: {
  symbol: ISASymbol;
  selected: boolean;
  color: string;
  onClick: () => void;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`${symbol.name} — ${symbol.description}`}
      className={`group relative flex flex-col items-center gap-1 rounded-xl border p-2 transition-all
        ${selected
          ? "border-brand-primary/60 bg-brand-primary/10 shadow-sm"
          : "border-slate-700/50 bg-slate-900 hover:border-slate-500 hover:bg-slate-800"
        }`}
    >
      <span
        role="button"
        tabIndex={0}
        title={favorite ? "Remove from favourites" : "Add to favourites"}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onToggleFavorite();
          }
        }}
        className={`absolute right-1.5 top-1.5 rounded p-0.5 transition-colors ${
          favorite
            ? "text-yellow-300"
            : "text-slate-600 opacity-0 hover:text-yellow-300 group-hover:opacity-100"
        }`}
      >
        <Star className="h-3 w-3" fill={favorite ? "currentColor" : "none"} />
      </span>
      <div className="flex h-10 w-full items-center justify-center">
        <svg
          viewBox="0 0 100 100"
          className="h-9 w-auto max-w-[56px]"
          style={{ color }}
          dangerouslySetInnerHTML={{ __html: symbol.svg }}
        />
      </div>
      <span className="w-full truncate text-center text-[10px] leading-tight text-slate-400 group-hover:text-slate-200">
        {symbol.name}
      </span>
    </button>
  );
}

export default function PIDSymbolPanel({
  selectedSymbolId,
  onSelectSymbol,
  activeColor,
  onColorChange,
  onClose,
}: Props) {
  const [search, setSearch]             = useState("");
  const [collapsed, setCollapsed]       = useState<Record<string, boolean>>({});
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readStoredIds(FAVORITES_STORAGE_KEY));
  const [recentIds, setRecentIds] = useState<string[]>(() => readStoredIds(RECENTS_STORAGE_KEY));

  useEffect(() => {
    writeStoredIds(FAVORITES_STORAGE_KEY, favoriteIds);
  }, [favoriteIds]);

  useEffect(() => {
    writeStoredIds(RECENTS_STORAGE_KEY, recentIds);
  }, [recentIds]);

  const favoriteSymbols = useMemo(() => getSymbolsByIds(favoriteIds), [favoriteIds]);
  const recentSymbols = useMemo(() => getSymbolsByIds(recentIds), [recentIds]);

  const toggleFavorite = (id: string) => {
    setFavoriteIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [id, ...prev],
    );
  };

  const selectSymbol = (id: string) => {
    const nextId = selectedSymbolId === id ? null : id;
    onSelectSymbol(nextId);
    if (nextId) {
      setRecentIds((prev) => [nextId, ...prev.filter((item) => item !== nextId)].slice(0, MAX_RECENTS));
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return null;
    return ALL_SYMBOLS.filter((symbol) => symbolMatchesQuery(symbol, q));
  }, [search]);

  const toggle = (catId: string) =>
    setCollapsed((prev) => ({ ...prev, [catId]: !prev[catId] }));

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-950 text-slate-200">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
        <div>
          <p className="text-xs font-semibold text-white">P&ID Symbol Library</p>
          <p className="text-[10px] text-slate-500">ISA 5.1 standard symbols</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Color selector */}
      <div className="border-b border-slate-800 px-3 py-2.5">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Symbol colour
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onColorChange(c)}
              className={`h-5 w-5 rounded-full border-2 transition-all ${
                activeColor === c ? "border-white scale-110" : "border-transparent hover:scale-105"
              }`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
          {/* Custom color */}
          <label
            className="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-2 border-slate-600 bg-slate-800 hover:border-slate-400 transition-colors"
            title="Custom colour"
          >
            <Pipette className="h-3 w-3 text-slate-400" />
            <input
              type="color"
              value={activeColor}
              onChange={(e) => onColorChange(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          <div
            className="h-5 w-5 rounded-full border-2 border-white/20"
            style={{ backgroundColor: activeColor }}
            title="Current colour"
          />
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-2.5 py-1.5 border border-slate-700/50">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <input
            type="text"
            placeholder="Search symbols…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-slate-500 hover:text-slate-300">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Symbol usage hint */}
      {selectedSymbolId && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 text-[10px] text-brand-primary">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-primary" />
          Click on the PDF to place symbol. Press Esc to cancel.
        </div>
      )}

      {/* Symbol grid */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {filtered ? (
          <>
            <p className="mb-2 px-1 text-[10px] text-slate-500">
              {filtered.length} result{filtered.length !== 1 ? "s" : ""}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {filtered.map((s) => (
                <SymbolTile
                  key={s.id}
                  symbol={s}
                  selected={selectedSymbolId === s.id}
                  color={activeColor}
                  favorite={favoriteIds.includes(s.id)}
                  onToggleFavorite={() => toggleFavorite(s.id)}
                  onClick={() => selectSymbol(s.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {favoriteSymbols.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-slate-300">
                  <Star className="h-3 w-3 text-yellow-300" fill="currentColor" />
                  <span>Favourites</span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1.5 pb-2">
                  {favoriteSymbols.map((s) => (
                    <SymbolTile
                      key={s.id}
                      symbol={s}
                      selected={selectedSymbolId === s.id}
                      color={activeColor}
                      favorite={favoriteIds.includes(s.id)}
                      onToggleFavorite={() => toggleFavorite(s.id)}
                      onClick={() => selectSymbol(s.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {recentSymbols.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-slate-300">
                  <Clock className="h-3 w-3 text-slate-500" />
                  <span>Recent</span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1.5 pb-2">
                  {recentSymbols.map((s) => (
                    <SymbolTile
                      key={s.id}
                      symbol={s}
                      selected={selectedSymbolId === s.id}
                      color={activeColor}
                      favorite={favoriteIds.includes(s.id)}
                      onToggleFavorite={() => toggleFavorite(s.id)}
                      onClick={() => selectSymbol(s.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {ISA_CATEGORIES.map((cat) => (
              <div key={cat.id} className="mb-1">
              <button
                onClick={() => toggle(cat.id)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-slate-300 hover:bg-slate-800/60 transition-colors"
              >
                <span>{cat.label}</span>
                <span className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500">{cat.symbols.length}</span>
                  {collapsed[cat.id]
                    ? <ChevronRight className="h-3 w-3 text-slate-500" />
                    : <ChevronDown  className="h-3 w-3 text-slate-500" />
                  }
                </span>
              </button>
              {!collapsed[cat.id] && (
                <div className="mt-1 grid grid-cols-3 gap-1.5 pb-2">
                  {cat.symbols.map((s) => (
                    <SymbolTile
                      key={s.id}
                      symbol={s}
                      selected={selectedSymbolId === s.id}
                      color={activeColor}
                      favorite={favoriteIds.includes(s.id)}
                      onToggleFavorite={() => toggleFavorite(s.id)}
                      onClick={() => selectSymbol(s.id)}
                    />
                  ))}
                </div>
              )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="border-t border-slate-800 px-3 py-2">
        <p className="text-[10px] text-slate-600">
          {ALL_SYMBOLS.length} symbols · ISA 5.1 · After placing: click to select, drag to move, handles to resize.
        </p>
      </div>
    </div>
  );
}

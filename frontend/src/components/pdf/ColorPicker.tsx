// src/components/pdf/ColorPicker.tsx

import { useState, useRef, useEffect } from "react";

type ColorPickerProps = {
  currentColor: string;
  onColorChange: (color: string) => void;
  onClose?: () => void;
  isOpen?: boolean;
  onToggle?: () => void;
};

const PRESET_COLORS = [
  "#ffff00", // Yellow
  "#ff0000", // Red
  "#00ff00", // Green
  "#0000ff", // Blue
  "#ff00ff", // Magenta
  "#00ffff", // Cyan
  "#ffa500", // Orange
  "#800080", // Purple
  "#ffc0cb", // Pink
  "#a52a2a", // Brown
  "#808080", // Gray
  "#000000", // Black
];

export default function ColorPicker({ currentColor, onColorChange, onClose, isOpen: controlledIsOpen, onToggle }: ColorPickerProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  
  // Use controlled state if provided, otherwise use internal state
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = controlledIsOpen !== undefined 
    ? (onToggle ? () => onToggle() : () => {}) 
    : setInternalIsOpen;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        if (onToggle) {
          onToggle(); // This will close it if controlled
        } else {
          setIsOpen(false);
        }
        onClose?.();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose, onToggle]);

  const handlePresetClick = (color: string) => {
    onColorChange(color);
    if (onToggle) {
      onToggle(); // Close if controlled
    } else {
      setIsOpen(false);
    }
    onClose?.();
  };

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onColorChange(e.target.value);
  };

  return (
    <div ref={pickerRef} className="relative" onClick={(e) => e.stopPropagation()}>
      {/* Color Preview Button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (onToggle) {
            onToggle();
          } else {
            setIsOpen(!isOpen);
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-6 h-6 rounded-xl border-2 border-gray-300 hover:border-brand-primary transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md"
        style={{ backgroundColor: currentColor, pointerEvents: "auto" }}
        title="Pick color"
      />

      {/* Color Picker Dropdown */}
      {isOpen && (
        <div 
          className="absolute top-full left-0 mt-2 bg-white/95 backdrop-blur-sm border-2 border-gray-200 rounded-2xl shadow-xl p-4 min-w-[200px]"
          style={{ zIndex: 99999, pointerEvents: "auto" }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Preset Colors */}
          <div className="mb-3">
            <div className="text-xs font-medium text-gray-700 mb-2">Preset Colors</div>
            <div className="grid grid-cols-6 gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePresetClick(color);
                  }}
                  className={`w-7 h-7 rounded-xl border-2 transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md ${
                    currentColor.toLowerCase() === color.toLowerCase()
                      ? "border-brand-primary scale-110 shadow-md"
                      : "border-gray-300 hover:border-gray-400"
                  }`}
                  style={{ backgroundColor: color, pointerEvents: "auto" }}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Custom Color Picker */}
          <div className="border-t border-gray-200 pt-3">
            <div className="text-xs font-medium text-gray-700 mb-2">Custom Color</div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={currentColor}
                onChange={handleCustomColorChange}
                onClick={(e) => e.stopPropagation()}
                className="w-12 h-10 rounded-xl border-2 border-gray-200 cursor-pointer focus:outline-none focus:ring-4 focus:ring-brand-primary/20 focus:border-brand-primary transition-all duration-300"
                style={{ pointerEvents: "auto" }}
              />
              <input
                type="text"
                value={currentColor}
                onChange={(e) => {
                  e.stopPropagation();
                  if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                    onColorChange(e.target.value);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 px-3 py-2 text-xs border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-primary/20 focus:border-brand-primary transition-all duration-300"
                placeholder="#000000"
                pattern="^#[0-9A-Fa-f]{6}$"
                style={{ pointerEvents: "auto" }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


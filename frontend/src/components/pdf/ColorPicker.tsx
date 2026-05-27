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
        className="h-5 w-5 cursor-pointer rounded-[3px] border border-[#3c3c3c] transition-colors hover:border-[#3794ff]"
        style={{ backgroundColor: currentColor, pointerEvents: "auto" }}
        title="Pick color"
      />

      {/* Color Picker Dropdown */}
      {isOpen && (
        <div 
          className="absolute left-0 top-full mt-1 min-w-[190px] border border-[#454545] bg-[#252526] p-3 shadow-2xl"
          style={{ zIndex: 99999, pointerEvents: "auto" }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Preset Colors */}
          <div className="mb-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#858585]">Preset Colors</div>
            <div className="grid grid-cols-6 gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePresetClick(color);
                  }}
                  className={`h-6 w-6 cursor-pointer rounded-[3px] border transition-colors ${
                    currentColor.toLowerCase() === color.toLowerCase()
                      ? "border-[#3794ff] ring-1 ring-[#3794ff]/50"
                      : "border-[#3c3c3c] hover:border-[#cccccc]"
                  }`}
                  style={{ backgroundColor: color, pointerEvents: "auto" }}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Custom Color Picker */}
          <div className="border-t border-[#3c3c3c] pt-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#858585]">Custom Color</div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={currentColor}
                onChange={handleCustomColorChange}
                onClick={(e) => e.stopPropagation()}
                className="h-7 w-10 cursor-pointer rounded-[3px] border border-[#3c3c3c] bg-[#1e1e1e] transition-colors focus:border-[#3794ff] focus:outline-none"
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
                className="h-7 flex-1 rounded-[3px] border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-xs text-[#cccccc] outline-none transition-colors focus:border-[#3794ff]"
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

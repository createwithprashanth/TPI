type MiniMapOverlayProps = {
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollLeft: number;
  scrollTop: number;
  onNavigate: (nextLeft: number, nextTop: number) => void;
};

export default function MiniMapOverlay({
  contentWidth,
  contentHeight,
  viewportWidth,
  viewportHeight,
  scrollLeft,
  scrollTop,
  onNavigate,
}: MiniMapOverlayProps) {
  const maxWidth = 180;
  const maxHeight = 180;
  const scale = Math.min(maxWidth / contentWidth, maxHeight / contentHeight, 1);
  const miniWidth = Math.max(90, Math.round(contentWidth * scale));
  const miniHeight = Math.max(90, Math.round(contentHeight * scale));
  const safeScrollLeft = Math.max(0, Math.min(scrollLeft, Math.max(0, contentWidth - viewportWidth)));
  const safeScrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, contentHeight - viewportHeight)));
  const viewportRectWidth = Math.max(18, (viewportWidth / contentWidth) * miniWidth);
  const viewportRectHeight = Math.max(18, (viewportHeight / contentHeight) * miniHeight);
  const viewportRectLeft = (safeScrollLeft / contentWidth) * miniWidth;
  const viewportRectTop = (safeScrollTop / contentHeight) * miniHeight;

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const centeredLeft = (localX / miniWidth) * contentWidth - viewportWidth / 2;
    const centeredTop = (localY / miniHeight) * contentHeight - viewportHeight / 2;

    onNavigate(centeredLeft, centeredTop);
  };

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      className="absolute bottom-6 right-6 z-20 overflow-hidden rounded-[3px] border border-[#454545] bg-[#252526]/95 p-2 shadow-2xl backdrop-blur transition-colors hover:border-[#3794ff]/70"
      style={{ width: miniWidth + 16, height: miniHeight + 16 }}
      title="Navigator"
      aria-label="Navigator minimap"
    >
      <div
        className="relative overflow-hidden rounded-md border border-slate-700/70 bg-[linear-gradient(180deg,_#1f2937_0%,_#111827_100%)]"
        style={{ width: miniWidth, height: miniHeight }}
      >
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.16) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        />
        <div
          className="absolute rounded border-2 border-sky-300 bg-sky-400/20 shadow-[0_0_0_1px_rgba(255,255,255,0.15)]"
          style={{
            width: viewportRectWidth,
            height: viewportRectHeight,
            left: viewportRectLeft,
            top: viewportRectTop,
          }}
        />
      </div>
    </button>
  );
}

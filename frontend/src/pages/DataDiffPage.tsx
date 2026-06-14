import React, { useState } from 'react';
import { GitCompare, ArrowRight, FileSpreadsheet, Zap, CheckCircle2, Shuffle } from 'lucide-react';
import { DataDiffComparePage } from './DataDiffComparePage';

type DataDiffView = 'landing' | 'compare';

const DataDiffPage: React.FC = () => {
  const [view, setView] = useState<DataDiffView>('landing');

  if (view === 'compare') {
    return <DataDiffComparePage onBack={() => setView('landing')} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090c] text-gray-200">

      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d11] px-5 py-3">
        <div className="flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-gray-400" />
          <h1 className="text-sm font-semibold text-white">DataDiff</h1>
          <span className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gray-500">
            Excel Comparison
          </span>
        </div>
        <p className="mt-1 text-[11px] text-gray-500">
          Compare two revisions of any engineering Excel file and see every change, addition, and deletion.
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto xyra-scroll-contained">
        <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">

          {/* How it works */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { step: '1', title: 'Upload both files', desc: 'Drop in the base revision and updated revision (.xlsx / .xls)', icon: FileSpreadsheet },
              { step: '2', title: 'Configure', desc: 'Pick the sheet, select the unique lookup key, map renamed columns.', icon: Shuffle },
              { step: '3', title: 'Download report', desc: 'Colour-coded Excel with a Comparison Details sheet and Summary Report.', icon: Zap },
            ].map(({ step, title, desc, icon: Icon }) => (
              <div key={step} className="rounded-md border border-white/[0.08] bg-white/[0.025] p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-white/[0.08] text-gray-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                    {step}
                  </span>
                  <Icon className="w-3.5 h-3.5 text-gray-500" />
                </div>
                <p className="text-xs font-semibold text-white">{title}</p>
                <p className="text-[11px] text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* What's supported */}
          <div className="rounded-md border border-white/[0.08] bg-[#0d0d11] px-5 py-4">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
              What's supported
            </div>
            <ul className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[11px] text-gray-400">
              {[
                '50,000+ rows — vectorized engine',
                'Multi-sheet workbooks',
                'Smart lookup key matching',
                'Column renaming / mapping',
                'Ignore spaces, hyphens, case',
                'Added / removed / changed detection',
                'Colour-coded Excel output',
                'Summary report included',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 w-3 h-3 text-white/[0.2] shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Use cases */}
          <div className="rounded-md border border-white/[0.08] bg-[#0d0d11] px-5 py-4">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
              Common use cases
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                'Instrument Index Rev A vs Rev B',
                'Client I/O List vs Vendor I/O List',
                'SPI export vs AVEVA export',
                'MTO revision tracking',
                'Cable Schedule updates',
                'Equipment List reconciliation',
              ].map((uc) => (
                <div key={uc} className="flex items-center gap-2 text-[11px] text-gray-500">
                  <span className="w-1 h-1 rounded-full bg-white/[0.15] shrink-0" />
                  {uc}
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="flex justify-center pt-2">
            <button
              onClick={() => setView('compare')}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-white text-black text-sm font-semibold hover:bg-gray-200 transition-colors"
            >
              Compare Files
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <p className="text-center text-[11px] text-gray-600">
            All processing happens on-premise — no data leaves your network.
          </p>

        </div>
      </div>
    </div>
  );
};

export default DataDiffPage;

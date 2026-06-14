import React, { useState } from 'react';
import { Database, ArrowRight, FileSpreadsheet, Shield, Zap } from 'lucide-react';
import { DataPumpGeneratePage } from './DataPumpGeneratePage';

type DataPumpView = 'landing' | 'generate';

const DataPumpPage: React.FC = () => {
  const [view, setView] = useState<DataPumpView>('landing');

  if (view === 'generate') {
    return <DataPumpGeneratePage onBack={() => setView('landing')} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090c] text-gray-200">

      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d11] px-5 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-gray-400" />
          <h1 className="text-sm font-semibold text-white">DataPump</h1>
          <span className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gray-500">
            SPI Bulk Updater
          </span>
        </div>
        <p className="mt-1 text-[11px] text-gray-500">
          Generate Oracle SQL UPDATE statements from your Excel instrument data.
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto xyra-scroll-contained">
        <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">

          {/* How it works */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { step: '1', title: 'Upload Excel', desc: 'Drop your instrument tag list or SPI data export (.xlsx / .xls)', icon: FileSpreadsheet },
              { step: '2', title: 'Map columns',  desc: 'Auto-maps your columns to SPI fields. Review and adjust in seconds.', icon: Zap },
              { step: '3', title: 'Download ZIP', desc: 'One .sql file per SPI table, ready to run against Oracle.', icon: Shield },
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
                '652 SPI tables (full schema)',
                '7,000+ column mappings',
                'COMPONENT, LOOP, LINE, PANEL tables',
                'Satellite table subquery WHERE clauses',
                'NUMBER / DATE / TIMESTAMP type quoting',
                'Null / dash / N/A empty-cell handling',
                'Pre-flight preview with duplicate detection',
                'Saved mapping profiles (browser storage)',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 w-1 h-1 rounded-full bg-white/[0.2] shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <div className="flex justify-center pt-2">
            <button
              onClick={() => setView('generate')}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-white text-black text-sm font-semibold hover:bg-gray-200 transition-colors"
            >
              Generate SQL
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

export default DataPumpPage;

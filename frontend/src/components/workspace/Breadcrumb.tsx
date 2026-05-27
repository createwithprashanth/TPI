import React from 'react';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  dim?: boolean;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => (
  <div className="h-7 shrink-0 flex items-center px-4 gap-0.5 border-b border-white/[0.04] bg-[#101013] overflow-hidden">
    {items.map((item, i) => (
      <React.Fragment key={i}>
        {i > 0 && (
          <ChevronRight className="w-3 h-3 text-gray-700 shrink-0 mx-0.5" />
        )}
        <span
          className={`text-[11px] truncate ${
            item.dim ? 'text-gray-600' : i === items.length - 1 ? 'text-gray-300' : 'text-gray-500'
          }`}
        >
          {item.label}
        </span>
      </React.Fragment>
    ))}
  </div>
);

export default Breadcrumb;

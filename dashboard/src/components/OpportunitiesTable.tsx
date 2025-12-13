import React from "react";
import type { Opportunity } from "../hooks/useDashboardSocket";

interface Props {
  opportunities: Opportunity[];
}

export const OpportunitiesTable: React.FC<Props> = ({ opportunities }) => {
  return (
    <div className="bg-dark-800 border border-dark-700 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Detected Opportunities</h2>
        <span className="text-xs text-slate-400">
          {opportunities.length} active
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs md:text-sm">
          <thead>
            <tr className="text-slate-400 border-b border-dark-700">
              <th className="text-left py-1 pr-4">Type</th>
              <th className="text-left py-1 pr-4">Pair / Path</th>
              <th className="text-left py-1 pr-4">Profit %</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="py-3 text-center text-slate-500 italic"
                >
                  No opportunities currently detected.
                </td>
              </tr>
            )}
            {opportunities.map((opp, idx) => (
              <tr
                key={idx}
                className="border-b border-dark-900 hover:bg-dark-900/60"
              >
                <td className="py-2 pr-4 text-xs uppercase text-slate-400">
                  {opp.type}
                </td>
                <td className="py-2 pr-4">
                  <div className="font-semibold">
                    {opp.tokenA} / {opp.tokenB}
                  </div>
                  <div className="text-[0.7rem] text-slate-500">
                    {opp.path?.join(" → ")}
                  </div>
                </td>
                <td className="py-2 pr-4">
                  {opp.profitPct != null
                    ? opp.profitPct.toFixed(3) + " %"
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

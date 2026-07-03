// Ranking de corretores · vendas + atividade
import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill } from "@/components/ui/StatusPill";
import type { Associate } from "@/types/lead";

const CATEGORY_TONE: Record<string, "neutral" | "info" | "gold" | "success"> = {
  BRONZE: "neutral", SILVER: "info", GOLD: "gold", DIAMOND: "success",
};
const CATEGORY_LABEL: Record<string, string> = {
  BRONZE: "Bronze", SILVER: "Prata", GOLD: "Ouro", DIAMOND: "Diamante",
};

export function Ranking() {
  const [list, setList] = useState<Associate[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ data: Associate[] }>("/api/associates?limit=5000");
        setList(r.data ?? []);
      } catch { /* silent */ }
    })();
  }, []);

  const ranking = useMemo(() => {
    return list
      .filter((a) => a.status === "APPROVED")
      .sort((a, b) => (b.vendas ?? 0) - (a.vendas ?? 0))
      .slice(0, 50);
  }, [list]);

  const maxV = Math.max(...ranking.map((b) => b.vendas ?? 0), 1);

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Ranking de corretores"
        description={`Top 50 por vendas · ${list.filter(a => a.status === "APPROVED").length} ativos`}
      />

      <div className="card overflow-hidden">
        <ul className="divide-y hairline">
          {ranking.map((b, i) => {
            const pct = ((b.vendas ?? 0) / maxV) * 100;
            return (
              <li key={b.id} className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-gold-400/15 text-gold-400 font-bold flex items-center justify-center shrink-0">
                  {i < 3 ? <Trophy size={18} /> : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold truncate">{b.user?.name ?? "—"}</span>
                    <StatusPill tone={CATEGORY_TONE[b.category] ?? "neutral"} size="xs">
                      {CATEGORY_LABEL[b.category] ?? b.category}
                    </StatusPill>
                  </div>
                  <div className="h-1.5 bg-app-subtle rounded-full overflow-hidden">
                    <div className="h-full bg-gold-gradient" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold tabular-nums">{b.vendas ?? 0}</p>
                  <p className="text-[0.65rem] uppercase tracking-mono-wide text-sand-100/55">vendas</p>
                </div>
              </li>
            );
          })}
          {ranking.length === 0 && (
            <li className="p-10 text-center text-sand-100/55">Sem corretores ativos.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

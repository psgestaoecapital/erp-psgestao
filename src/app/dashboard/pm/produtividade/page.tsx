"use client";
// P&M · Onda A (rentabilidade) · tela 121 "Planejamento de recursos e capacidade" · fatia 3 (disponibilidade).
// Heatmap de utilização (faturável x não faturável) por pessoa e semana + DISPONIBILIDADE (horas livres =
// capacidade − horas apontadas) do período e por pessoa — responde "quem tem folga para pegar trabalho novo".
// Só leitura (RLS por empresa; dado individual gated no backend por fn__mao_obra_pode_ver_individual).
// Fonte: fn_pm_utilizacao_heatmap (fatia 1). Mostra horas e % — nunca custo/salário.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import AjudaCampo from "@/components/ajuda/AjudaCampo";

const ROTA = "/dashboard/pm/produtividade";

type Linha = {
  user_id: string;
  pessoa: string | null;
  cargo: string | null;
  setor: string | null;
  semana: string; // date (segunda-feira)
  horas_faturavel: number;
  horas_nao_faturavel: number;
  horas_total: number;
  jornada_horas_dia: number;
  dias_uteis: number;
  capacidade_horas: number;
  utilizacao_pct: number | null;
};

const JANELAS = [
  { s: 8, l: "8 semanas" },
  { s: 12, l: "12 semanas" },
  { s: 26, l: "26 semanas" },
];

const cartao = "rounded-2xl border border-[#3D2314]/10 bg-white p-4";
const num = (n: number) => (n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

// Segunda-feira da semana de uma data (igual ao date_trunc('week') do Postgres).
function segundaDaSemana(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = segunda
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Escala de utilização (design PS, legível em claro/escuro; nunca só cor — o número aparece na célula).
function corUtil(pct: number | null, temCapacidade: boolean): { bg: string; fg: string } {
  if (!temCapacidade) return { bg: "bg-[#F3EEE7]", fg: "text-[#9a8a78]" };
  const p = pct ?? 0;
  if (p <= 0) return { bg: "bg-[#F3EEE7]", fg: "text-[#9a8a78]" };
  if (p < 40) return { bg: "bg-[#FBF1D9]", fg: "text-[#7a5a12]" };
  if (p < 70) return { bg: "bg-[#E7F0DC]", fg: "text-[#3f5a24]" };
  if (p <= 100) return { bg: "bg-[#CDE3BC]", fg: "text-[#2f4a1a]" };
  return { bg: "bg-[#F6D6CE]", fg: "text-[#8a2d1a]" }; // acima de 100% = estouro de capacidade
}

const rotuloSemana = (s: string) => {
  const d = new Date(s + "T00:00:00Z");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
};

export default function ProdutividadePage() {
  const { companyIds } = useCompanyIds();
  const empresa = companyIds[0] ?? null;
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [semanasN, setSemanasN] = useState(8);
  const [ordem, setOrdem] = useState<"nome" | "disponivel">("nome");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!empresa) { setCarregando(false); return; }
    let vivo = true;
    setCarregando(true); setErro(null);
    const ate = new Date();
    const de = segundaDaSemana(new Date(ate.getTime()));
    de.setUTCDate(de.getUTCDate() - (semanasN - 1) * 7);
    void (async () => {
      const { data, error } = await supabase.rpc("fn_pm_utilizacao_heatmap", {
        p_company_id: empresa,
        p_de: iso(de),
        p_ate: iso(ate),
      });
      if (!vivo) return;
      if (error) {
        console.error("produtividade: falha ao carregar utilização", error);
        setErro("Não foi possível carregar a utilização. Tente novamente.");
        setCarregando(false);
        return;
      }
      setLinhas((data ?? []) as Linha[]);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [empresa, semanasN]);

  const semanas = useMemo(
    () => Array.from(new Set(linhas.map((l) => l.semana))).sort(),
    [linhas],
  );

  const pessoas = useMemo(() => {
    const m = new Map<string, { user_id: string; pessoa: string; cargo: string | null }>();
    const livre = new Map<string, number>(); // horas livres por pessoa, para ordenar por disponibilidade
    for (const l of linhas) {
      if (!m.has(l.user_id)) m.set(l.user_id, { user_id: l.user_id, pessoa: l.pessoa ?? "—", cargo: l.cargo });
      const atual = livre.get(l.user_id) ?? 0;
      livre.set(l.user_id, atual + ((Number(l.capacidade_horas) || 0) - (Number(l.horas_total) || 0)));
    }
    const lista = Array.from(m.values());
    if (ordem === "disponivel") {
      // mais disponível primeiro (maior folga = capacidade − apontadas); desempate pelo nome
      return lista.sort((a, b) => (Math.max(0, livre.get(b.user_id) ?? 0) - Math.max(0, livre.get(a.user_id) ?? 0)) || a.pessoa.localeCompare(b.pessoa, "pt-BR"));
    }
    return lista.sort((a, b) => a.pessoa.localeCompare(b.pessoa, "pt-BR"));
  }, [linhas, ordem]);

  const celula = useMemo(() => {
    const m = new Map<string, Linha>();
    for (const l of linhas) m.set(`${l.user_id}|${l.semana}`, l);
    return m;
  }, [linhas]);

  const totais = useMemo(() => {
    let fat = 0, nfat = 0, cap = 0;
    for (const l of linhas) { fat += Number(l.horas_faturavel) || 0; nfat += Number(l.horas_nao_faturavel) || 0; cap += Number(l.capacidade_horas) || 0; }
    const tot = fat + nfat;
    // Disponibilidade = capacidade ainda livre no período (nunca negativa; estouro aparece no heatmap em vermelho).
    const disp = Math.max(0, cap - tot);
    return { fat, nfat, tot, cap, disp, utilMedia: cap > 0 ? Math.round((tot / cap) * 1000) / 10 : 0 };
  }, [linhas]);

  const totalPessoa = (uid: string) => {
    let fat = 0, nfat = 0, cap = 0;
    for (const l of linhas) if (l.user_id === uid) { fat += Number(l.horas_faturavel) || 0; nfat += Number(l.horas_nao_faturavel) || 0; cap += Number(l.capacidade_horas) || 0; }
    const tot = fat + nfat;
    return { tot, livre: Math.max(0, cap - tot), util: cap > 0 ? Math.round((tot / cap) * 1000) / 10 : 0 };
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header>
        <h1 className="text-xl font-bold text-[#3D2314]">
          Utilização da equipe
          <AjudaCampo chave="pm.produtividade.tela" rota={ROTA} />
        </h1>
        <p className="text-[12px] text-[#6b5444]">
          Quanto da capacidade de cada pessoa virou hora apontada, semana a semana — separando horas faturáveis (em job de cliente) das não faturáveis (trabalho interno).
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[12px] text-[#6b5444]">Período:</span>
        {JANELAS.map((w) => (
          <button
            key={w.s}
            type="button"
            onClick={() => setSemanasN(w.s)}
            className={`min-h-[40px] rounded-lg border px-3 text-[12px] ${semanasN === w.s ? "border-[#3D2314] bg-[#3D2314] text-white" : "border-[#E7DED3] text-[#3D2314]"}`}
          >
            {w.l}
          </button>
        ))}
        <AjudaCampo chave="pm.produtividade.filtro_periodo" rota={ROTA} />
        <span className="ml-3 mr-1 text-[12px] text-[#6b5444]">Ordenar:</span>
        {([["nome", "Nome"], ["disponivel", "Mais disponível"]] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setOrdem(k)}
            className={`min-h-[40px] rounded-lg border px-3 text-[12px] ${ordem === k ? "border-[#3D2314] bg-[#3D2314] text-white" : "border-[#E7DED3] text-[#3D2314]"}`}
          >
            {l}
          </button>
        ))}
        <AjudaCampo chave="pm.produtividade.ordenar" rota={ROTA} />
      </div>

      {erro && <p role="alert" className="rounded-lg bg-red-50 p-3 text-[13px] text-red-700">{erro}</p>}

      {carregando ? (
        <p className="text-[13px] text-[#6b5444]">Carregando…</p>
      ) : !empresa ? (
        <p className="text-[13px] text-[#6b5444]">Selecione uma empresa para ver a utilização da equipe.</p>
      ) : pessoas.length === 0 ? (
        <section className={cartao}>
          <p className="text-[13px] text-[#6b5444]">
            Ainda não há horas apontadas no período para montar o heatmap. Registre horas em{" "}
            <a href="/dashboard/pm/apontamento-horas" className="underline">Apontamento de horas</a> para acompanhar a utilização aqui.
          </p>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className={cartao}>
              <p className="text-[11px] text-[#6b5444]">Utilização média<AjudaCampo chave="pm.produtividade.utilizacao" rota={ROTA} /></p>
              <p className="text-lg font-bold text-[#3D2314]">{num(totais.utilMedia)}%</p>
            </div>
            <div className={cartao}>
              <p className="text-[11px] text-[#6b5444]">Disponibilidade<AjudaCampo chave="pm.produtividade.disponibilidade" rota={ROTA} /></p>
              <p className="text-lg font-bold text-[#2f4a1a]">{num(totais.disp)} h</p>
              <p className="text-[10px] text-[#9a8a78]">livres de {num(totais.cap)} h de capacidade</p>
            </div>
            <div className={cartao}>
              <p className="text-[11px] text-[#6b5444]">Horas faturáveis<AjudaCampo chave="pm.produtividade.faturavel" rota={ROTA} /></p>
              <p className="text-lg font-bold text-[#2f4a1a]">{num(totais.fat)} h</p>
            </div>
            <div className={cartao}>
              <p className="text-[11px] text-[#6b5444]">Horas não faturáveis<AjudaCampo chave="pm.produtividade.nao_faturavel" rota={ROTA} /></p>
              <p className="text-lg font-bold text-[#7a5a12]">{num(totais.nfat)} h</p>
            </div>
            <div className={cartao}>
              <p className="text-[11px] text-[#6b5444]">Capacidade do período<AjudaCampo chave="pm.produtividade.capacidade" rota={ROTA} /></p>
              <p className="text-lg font-bold text-[#3D2314]">{num(totais.cap)} h</p>
            </div>
          </section>

          <section className={cartao}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold text-[#3D2314]">
                Heatmap de utilização · pessoa × semana
                <AjudaCampo chave="pm.produtividade.heatmap" rota={ROTA} />
              </h2>
              <ul className="flex flex-wrap items-center gap-2 text-[11px] text-[#6b5444]">
                <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-[#F3EEE7]" />ocioso</li>
                <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-[#FBF1D9]" />&lt;40%</li>
                <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-[#E7F0DC]" />40–70%</li>
                <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-[#CDE3BC]" />70–100%</li>
                <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-[#F6D6CE]" />&gt;100%</li>
              </ul>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-1 text-[12px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-semibold text-[#3D2314]">Pessoa</th>
                    {semanas.map((s) => (
                      <th key={s} className="px-1 py-1 text-center font-medium text-[#6b5444]" title={`Semana de ${rotuloSemana(s)}`}>{rotuloSemana(s)}</th>
                    ))}
                    <th className="px-2 py-1 text-right font-semibold text-[#3D2314]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pessoas.map((p) => {
                    const tp = totalPessoa(p.user_id);
                    return (
                      <tr key={p.user_id}>
                        <th scope="row" className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-normal">
                          <span className="block text-[#3D2314]">{p.pessoa}</span>
                          {p.cargo && <span className="block text-[10px] text-[#9a8a78]">{p.cargo}</span>}
                        </th>
                        {semanas.map((s) => {
                          const c = celula.get(`${p.user_id}|${s}`);
                          const temCap = !!c && Number(c.capacidade_horas) > 0;
                          const cor = corUtil(c?.utilizacao_pct ?? 0, temCap);
                          const pct = c?.utilizacao_pct ?? 0;
                          const titulo = c
                            ? `${p.pessoa} · semana de ${rotuloSemana(s)}: ${num(c.horas_total)} h de ${num(c.capacidade_horas)} h (${num(pct)}%) — faturável ${num(c.horas_faturavel)} h, não faturável ${num(c.horas_nao_faturavel)} h`
                            : "sem dados";
                          return (
                            <td key={s} className="p-0 text-center">
                              <div className={`min-w-[44px] rounded px-1 py-1 ${cor.bg} ${cor.fg}`} title={titulo}>
                                {temCap && pct > 0 ? `${num(pct)}%` : "—"}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-2 py-1 text-right">
                          <span className="block font-semibold text-[#3D2314]">{num(tp.tot)} h</span>
                          <span className="block text-[10px] text-[#9a8a78]">{num(tp.util)}%</span>
                          <span className="block text-[10px] text-[#2f4a1a]" title={`Horas livres no período (capacidade − apontadas) de ${p.pessoa}`}>{num(tp.livre)} h livres</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-[#9a8a78]">
              Utilização = horas apontadas ÷ capacidade (jornada × dias úteis da semana). Disponibilidade = horas livres (capacidade − apontadas). Passe o mouse (ou toque) numa célula para ver o detalhe de horas.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

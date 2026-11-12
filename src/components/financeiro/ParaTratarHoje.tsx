"use client";
// Card "Para tratar hoje" (P2/CEO 12/11) — topo do Caixa do grupo (e, depois, do Painel da GE).
// Mostra, acima de tudo, o que o financeiro precisa resolver NO DIA: diferença banco×sistema, extrato
// atrasado, lançamento sem conta, caixa negativo, a receber/pagar vencendo e atrasados. Cada linha tem
// gravidade (vermelho/amarelo), valor, texto na língua do usuário e botão "Resolver" que leva à tela certa.
// Só leitura — vem de fn_ge_pendencias_dia (fail-closed por empresa do usuário). Se a RPC ainda não existe
// no ambiente, o card simplesmente não aparece (nunca quebra a tela). RD-95: "?" no título.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

const BG2 = "var(--ps-bg2,#FFFFFF)", TX = "var(--ps-text,#3D2314)", TXM = "var(--ps-text-m,#6B5D4F)";
const BD = "var(--ps-border,#E0D8CC)", VERDE = "#3B6D11", VERM = "#A32D2D", AMBER = "#B45309";

const brl = (v: unknown) =>
  `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Pendencia = {
  tipo: string;
  empresa: string;
  company_id: string;
  gravidade: "vermelho" | "amarelo";
  quantidade: number | null;
  valor: number | null;
  texto: string;
  link: string;
};
type Resp = { ok: boolean; data: string; pendencias: Pendencia[]; total: number;
  por_gravidade: { vermelho: number; amarelo: number } };

export function ParaTratarHoje({
  companyIds,
  data,
  multiEmpresa,
}: {
  companyIds: string[];
  data: string;
  multiEmpresa?: boolean;
}) {
  const key = [...companyIds].sort().join(",");
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [indisponivel, setIndisponivel] = useState(false);

  const carregar = useCallback(async () => {
    if (!key) { setResp(null); setLoading(false); return; }
    setLoading(true);
    const ids = key.split(",");
    const { data: d, error } = await supabase.rpc("fn_ge_pendencias_dia", { p_company_ids: ids, p_data: data });
    // RPC ausente no ambiente (ainda não publicada) → esconde o card sem quebrar a tela.
    if (error) { setIndisponivel(true); setResp(null); setLoading(false); return; }
    setIndisponivel(false);
    setResp(d as Resp);
    setLoading(false);
  }, [key, data]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- busca ao mudar grupo/dia; loading é estado legítimo.
  useEffect(() => { void carregar(); }, [carregar]);

  if (indisponivel || !key) return null;

  const pend = resp?.pendencias ?? [];
  const tudoEmDia = !loading && resp?.ok && pend.length === 0;

  return (
    <section
      aria-label="Para tratar hoje"
      style={{ background: BG2, border: `1px solid ${BD}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: pend.length || tudoEmDia ? 10 : 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: TX, display: "inline-flex", alignItems: "center" }}>
          Para tratar hoje
          <AjudaCampo chave="ge.caixa.para_tratar_hoje" rota="/dashboard/financeiro/caixa-grupo" />
        </span>
        {resp && resp.total > 0 && (
          <span style={{ fontSize: 12, fontWeight: 600, color: TXM }}>
            {resp.total} {resp.total === 1 ? "pendência" : "pendências"}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ color: TXM, fontSize: 13, padding: "4px 0" }}>Verificando pendências…</div>
      ) : tudoEmDia ? (
        <div style={{ color: VERDE, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          Tudo em dia ✓
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {pend.map((p, i) => {
            const cor = p.gravidade === "vermelho" ? VERM : AMBER;
            return (
              <li
                key={`${p.tipo}-${p.company_id}-${i}`}
                style={{
                  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  padding: "10px 12px", borderRadius: 10,
                  background: `${cor}0D`, border: `1px solid ${cor}33`,
                }}
              >
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: cor, flex: "0 0 auto" }} />
                <span style={{ flex: "1 1 180px", minWidth: 0, fontSize: 13, color: TX, fontWeight: 500 }}>
                  {p.texto}
                  {multiEmpresa && p.empresa ? (
                    <span style={{ color: TXM, fontWeight: 400 }}> · {p.empresa}</span>
                  ) : null}
                </span>
                {p.valor != null && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: cor, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {brl(p.valor)}
                  </span>
                )}
                <a
                  href={p.link}
                  style={{
                    flex: "0 0 auto", fontSize: 12, fontWeight: 600, color: "#FFFFFF", background: cor,
                    borderRadius: 8, padding: "6px 12px", textDecoration: "none", whiteSpace: "nowrap",
                  }}
                >
                  Resolver
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

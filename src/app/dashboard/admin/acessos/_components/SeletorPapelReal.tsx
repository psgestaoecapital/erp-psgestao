"use client";
// Papel na empresa (função real) — os PAPÉIS REAIS do catálogo rbac_papel da vertical contratada
// (fonte: fn_acessos_papeis_rbac, já filtrada pelas áreas contratadas). Agrupado por camada e área.
// Gravação: fn_acessos_definir_papel_rbac → user_scope.papel_slug (lido por fn_acesso_efetivo, menu e bloqueio de rota).
// A guarda do servidor valida papel ativo + vertical contratada e nunca escala para admin.
import type { CSSProperties } from "react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

export type PapelRbac = { slug: string; nome: string; area: string | null; camada: string; secoes: string[]; itens: string[] };

// Ordem de cima para baixo da hierarquia (camadas do catálogo rbac_papel).
const CAMADAS: { v: string; l: string }[] = [
  { v: "propriedade", l: "Propriedade" }, { v: "direcao", l: "Direção" }, { v: "gerencia", l: "Gerência" },
  { v: "supervisao", l: "Supervisão" }, { v: "especialista", l: "Especialista" }, { v: "operacao", l: "Operação" },
];
const AREA_LBL: Record<string, string> = {
  producao: "Produção", comercial: "Comercial", rh: "RH", compliance: "Compliance / SST", administrativo: "Administrativo",
  ti: "TI", financeiro: "Financeiro", compras: "Compras", obras: "Obras", orcamentos: "Orçamentos", campo: "Campo",
  portal: "Portal do cliente", criacao: "Criação", atendimento: "Atendimento", midia: "Mídia",
};
export const areaRotulo = (a: string | null) => (a ? AREA_LBL[a] ?? a.charAt(0).toUpperCase() + a.slice(1) : "Geral");
export const camadaRotulo = (c: string) => CAMADAS.find((x) => x.v === c)?.l ?? c;

// Nível (users.role) coerente com a camada/área do papel — só SUGESTÃO; nunca nível de admin.
// Só devolve um nível que exista na lista de níveis permitidos da empresa.
export function nivelSugerido(p: PapelRbac | undefined, permitidos: string[]): string | null {
  if (!p) return null;
  const area = p.area ?? "";
  const cand: string[] =
    p.camada === "propriedade" ? ["socio"] :
    p.camada === "direcao" ? ["diretor_area", "diretor"] :
    p.camada === "gerencia" ? (area === "rh" ? ["rh_industrial", "gerente"] : area === "financeiro" ? ["financeiro", "gerente"] : p.slug === "ind_ger_unidade" ? ["gerente_planta", "gerente"] : ["gerente"]) :
    p.camada === "supervisao" ? ["supervisor"] :
    p.camada === "especialista" ? (area === "comercial" ? ["comercial"] : area === "rh" ? ["rh_industrial", "consultor"] : area === "compliance" ? ["sst", "consultor"] : area === "financeiro" ? ["financeiro"] : ["consultor"]) :
    p.camada === "operacao" ? ["operador", "operacional"] : [];
  return cand.find((c) => permitidos.includes(c)) ?? null;
}

export function SeletorPapelReal({ papeis, value, onChange, selectStyle, testId }: {
  papeis: PapelRbac[]; value: string; onChange: (slug: string) => void; selectStyle: CSSProperties; testId?: string;
}) {
  const grupos = CAMADAS.map((c) => ({
    ...c,
    itens: papeis.filter((p) => p.camada === c.v)
      .sort((a, b) => areaRotulo(a.area).localeCompare(areaRotulo(b.area), "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR")),
  })).filter((g) => g.itens.length > 0);
  const semCamada = papeis.filter((p) => !CAMADAS.some((c) => c.v === p.camada));
  const sel = papeis.find((r) => r.slug === value);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <select data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
          <option value="">Sem função (vê o menu conforme o nível)</option>
          {grupos.map((g) => (
            <optgroup key={g.v} label={g.l}>
              {g.itens.map((r) => <option key={r.slug} value={r.slug}>{r.nome} · {areaRotulo(r.area)}</option>)}
            </optgroup>
          ))}
          {semCamada.length > 0 && (
            <optgroup label="Outros">
              {semCamada.map((r) => <option key={r.slug} value={r.slug}>{r.nome} · {areaRotulo(r.area)}</option>)}
            </optgroup>
          )}
          {value && !sel && <option value={value}>{value} (atual)</option>}
        </select>
        <AjudaCampo chave="acessos.funcao_papel" rota="/dashboard/admin/acessos" />
      </div>
      {papeis.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--ps-text-d,#9C8E80)", marginTop: 6 }}>
          Nenhuma função cadastrada para as áreas que a empresa contratou.
        </div>
      ) : !sel ? (
        <div style={{ fontSize: 11.5, color: "var(--ps-text-d,#9C8E80)", marginTop: 6 }}>
          Em branco: sem restrição por função — a pessoa vê o menu conforme o nível.
        </div>
      ) : (
        <div data-testid="papel-real-resumo" style={{ fontSize: 11.5, color: "var(--ps-text-m,#6B5D4F)", marginTop: 6, lineHeight: 1.5 }}>
          <div><strong>{camadaRotulo(sel.camada)} · {areaRotulo(sel.area)}.</strong> Esta função vê: {sel.secoes.length ? sel.secoes.join(" · ") : "só o Início"}</div>
          {sel.itens.length > 0 && <div><strong>Itens liberados:</strong> {sel.itens.join(" · ")}</div>}
          <div style={{ color: "var(--ps-text-d,#9C8E80)" }}>Abrir por endereço uma tela fora da função mostra “Acesso restrito à sua função”.</div>
        </div>
      )}
    </div>
  );
}

/**
 * PS GESTÃO ERP — dataFilters.ts
 * FONTE ÚNICA DE VERDADE para todas as regras de filtragem
 * v1.3 — 17/04/2026
 */

// ═══ 1. STATUS DE EXCLUSÃO ═══
export const STATUS_EXCLUIDOS = new Set([
  "CANCELADO", "CANCELADA",
  "ESTORNADO", "ESTORNADA",
  "DEVOLVIDO", "DEVOLVIDA",
  "ANULADO", "ANULADA",
  "DUPLICADO_REMOVIDO",
]);

export function isExcluido(status: string | null | undefined): boolean {
  if (!status) return false;
  return STATUS_EXCLUIDOS.has(status.toUpperCase().trim());
}

// ═══ 2. DETECÇÃO DE EMPRÉSTIMOS ═══
const EMPRESTIMO_KEYWORDS = [
  "emprestimo", "empréstimo", "financiamento",
  "pronampe", "fampe", "peac", "bndes",
  "contrato sicoob", "contrato sicredi", "contrato caixa",
  "parcela contrato",
];

export function isEmprestimo(descricao: string, categoria: string, obs: string): boolean {
  const texto = `${descricao} ${categoria} ${obs}`.toLowerCase();
  return EMPRESTIMO_KEYWORDS.some(kw => texto.includes(kw));
}

// ═══ 3. TIPOS ═══
export interface DedupRecord {
  id?: string | number;
  omie_id?: string | number;
  nome_pessoa?: string;
  fornecedor?: string;
  cliente?: string;
  descricao?: string;
  valor?: number;
  valor_documento?: number;
  data_previsao?: string;
  data_vencimento?: string;
  data_emissao?: string;
  numero_documento?: string;
  [key: string]: any;
}

export interface Lancamento {
  id?: string | number;
  omie_id?: string | number;
  nome_pessoa?: string;
  fornecedor?: string;
  cliente?: string;
  descricao?: string;
  observacao?: string;
  valor?: number;
  valor_documento?: number;
  data_previsao?: string;
  data_vencimento?: string;
  data_emissao?: string;
  numero_documento?: string;
  status?: string;
  status_titulo?: string;
  tipo?: string;
  categoria?: string;
  subcategoria?: string;
  descricao_categoria?: string;
  codigo_categoria?: string;
  company_id?: string;
  [key: string]: any;
}

// ═══ 4. DEDUPLICAÇÃO ═══
export function deduplicar<T extends DedupRecord>(registros: T[]): T[] {
  if (!registros || registros.length === 0) return [];
  const seen = new Set<string>();
  const result: T[] = [];
  for (const r of registros) {
    if (r.id) {
      const key = `id:${String(r.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(r);
      continue;
    }
    if (r.omie_id) {
      const key = `omie:${String(r.omie_id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(r);
      continue;
    }
    const nome = (r.nome_pessoa || r.fornecedor || r.cliente || "").trim().toLowerCase();
    const valor = String(r.valor || r.valor_documento || 0);
    const data = r.data_previsao || r.data_vencimento || r.data_emissao || "";
    const doc = (r.numero_documento || r.descricao || "").trim().toLowerCase().slice(0, 30);
    const compositeKey = `comp:${nome}|${valor}|${data}|${doc}`;
    if (seen.has(compositeKey)) continue;
    seen.add(compositeKey);
    result.push(r);
  }
  return result;
}

// ═══ 5. CLASSIFICAÇÃO DRE ═══
export type ClasseDRE = "impostos" | "custos" | "despesas" | "financeiro";

export function classificarDespesa(categoria: string, nome: string): ClasseDRE {
  const c = (categoria || "").toLowerCase();
  const n = (nome || "").toLowerCase();
  if (c.startsWith("3.04") || n.includes("imposto") || n.includes("icms") || n.includes("iss") || n.includes("pis") || n.includes("cofins") || n.includes("das") || n.includes("irpj") || n.includes("csll") || n.includes("simples") || n.includes("darf") || n.includes("tribut") || n.includes("cbs") || n.includes("ibs")) return "impostos";
  if (c.startsWith("4.") || c.startsWith("5.") || n.includes("juros") || n.includes("financiamento") || n.includes("parcela") || n.includes("empréstimo") || n.includes("emprestimo") || n.includes("pronampe") || n.includes("fampe") || n.includes("peac") || n.includes("bndes") || n.includes("taxa bancária") || n.includes("taxa bancaria") || n.includes("iof") || n.includes("tarifa bancária") || n.includes("tarifa bancaria")) return "financeiro";
  if (c.startsWith("2.01") || c.startsWith("2.02") || c.startsWith("2.03") || n.includes("cmv") || n.includes("matéria") || n.includes("materia") || n.includes("material") || n.includes("insumo") || n.includes("mercadoria") || n.includes("mão de obra") || n.includes("mao de obra") || n.includes("folha") || n.includes("salário") || n.includes("salario") || n.includes("encargo") || n.includes("fgts") || n.includes("inss") || n.includes("férias") || n.includes("ferias") || n.includes("13") || n.includes("gps")) return "custos";
  return "despesas";
}

// ═══ 6. PARSING DE DATA ═══
export function parseData(dt: string | null | undefined): Date | null {
  if (!dt) return null;
  const p1 = dt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (p1) { let ano = parseInt(p1[3]); if (p1[3].length === 2) ano += 2000; return new Date(ano, parseInt(p1[2]) - 1, parseInt(p1[1])); }
  const p2 = dt.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (p2) return new Date(parseInt(p2[1]), parseInt(p2[2]) - 1, parseInt(p2[3]));
  const d = new Date(dt);
  return isNaN(d.getTime()) ? null : d;
}

export function parseDia(dt: string, ano: number, mes: number): number | null {
  const d = parseData(dt);
  if (!d) return null;
  if (d.getFullYear() === ano && d.getMonth() + 1 === mes) return d.getDate();
  return null;
}

// ═══ 7. STATUS VISUAL ═══
export type StatusVisual = { cor: string; label: string };

export function getStatusVisual(status: string, dataVencimento: string | null, cores: { verde: string; vermelho: string; azul: string; cinza: string }): StatusVisual {
  const st = (status || "").toUpperCase();
  if (st.includes("RECEBIDO") || st.includes("PAGO") || st.includes("LIQUIDADO") || st === "PAGO") return { cor: cores.verde, label: "Realizado" };
  if (st.includes("CANCEL")) return { cor: cores.cinza, label: "Cancelado" };
  if (dataVencimento) { const hoje = new Date(); hoje.setHours(0, 0, 0, 0); const dtVenc = parseData(dataVencimento); if (dtVenc && dtVenc < hoje && !st.includes("CANCEL")) return { cor: cores.vermelho, label: "Atrasado" }; }
  if (st.includes("VENCIDO") || st === "VENCIDO") return { cor: cores.vermelho, label: "Atrasado" };
  return { cor: cores.azul, label: "No Prazo" };
}

// ═══ 8. FILTRO MESTRE ═══
export interface FiltroOpcoes {
  excluirCancelados?: boolean;
  excluirDuplicados?: boolean;
  separarEmprestimos?: boolean;
}

export interface ResultadoFiltrado<T> {
  registros: T[];
  emprestimos: T[];
  excluidos: number;
  duplicados: number;
  total_original: number;
}

export function filtrarRegistros<T extends DedupRecord>(registros: T[], opcoes: FiltroOpcoes = {}): ResultadoFiltrado<T> {
  const { excluirCancelados = true, excluirDuplicados = true, separarEmprestimos = false } = opcoes;
  const totalOriginal = registros.length;
  let resultado = [...registros];
  let excluidos = 0;
  let duplicados = 0;
  const emprestimos: T[] = [];

  if (excluirCancelados) {
    const antes = resultado.length;
    resultado = resultado.filter((r: any) => !isExcluido(r.status || r.status_titulo || ""));
    excluidos = antes - resultado.length;
  }

  if (separarEmprestimos) {
    const limpos: T[] = [];
    for (const r of resultado) {
      const desc = (r as any).descricao || (r as any).observacao || "";
      const cat = (r as any).descricao_categoria || (r as any).codigo_categoria || "";
      const obs = (r as any).observacao || "";
      if (isEmprestimo(desc, cat, obs)) { emprestimos.push(r); } else { limpos.push(r); }
    }
    resultado = limpos;
  }

  if (excluirDuplicados) {
    const antes = resultado.length;
    resultado = deduplicar(resultado);
    duplicados = antes - resultado.length;
  }

  return { registros: resultado, emprestimos, excluidos, duplicados, total_original: totalOriginal };
}

// ═══════════════════════════════════════════════════════════════
// 9. ALIASES DE COMPATIBILIDADE
// Garante que TODOS os módulos existentes continuam funcionando
// ═══════════════════════════════════════════════════════════════

// Usado por: dashboard/route.ts, dre/route.ts, fluxo-caixa/route.ts, linhas-negocio/dre/route.ts
export function applyStandardFilters<T extends DedupRecord>(registros: T[]): T[] {
  return filtrarRegistros(registros).registros;
}

// Usado por: hooks/useBPOData.ts
export function applyBPOFilters<T extends DedupRecord>(registros: T[]): T[] {
  return filtrarRegistros(registros, { excluirCancelados: true, excluirDuplicados: true, separarEmprestimos: true }).registros;
}

// Usado por: hooks/useBPOData.ts, components/bpo/BPODashboard.tsx
export function filterSummary<T extends DedupRecord>(registros: T[]): {
  total: number;
  ativos: number;
  cancelados: number;
  duplicados: number;
  emprestimos: number;
  total_filtrado: number;
  total_original: number;
  excluidos: number;
} {
  const r = filtrarRegistros(registros, { excluirCancelados: true, excluirDuplicados: true, separarEmprestimos: true });
  return {
    total: r.total_original,
    ativos: r.registros.length,
    cancelados: r.excluidos,
    duplicados: r.duplicados,
    emprestimos: r.emprestimos.length,
    total_filtrado: r.registros.length,
    total_original: r.total_original,
    excluidos: r.excluidos,
  };
}

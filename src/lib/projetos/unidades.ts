// Catálogo de UNIDADES DE MEDIDA do Hub (CEO 26/11) — universal, todos os ramos.
// Compartilhado entre serviço (catálogo) e item/insumo/EPI/ferramenta (BOM/insumos/orçamento).
// Constante extensível: acrescentar uma unidade = uma linha aqui, e ela aparece em todo o Hub.
// Os `value` preservam os códigos já gravados (m2, m3, L, sc, cx, rl, gl, un, h, dia…) para não
// quebrar dados existentes; `label` é o que o usuário vê. NÃO assume m² em lugar nenhum.

export type UnidadeMedida = { value: string; label: string; grupo: string };

export const UNIDADES_MEDIDA: UnidadeMedida[] = [
  // Área
  { value: "m2", label: "m² (metro quadrado)", grupo: "Área" },
  { value: "cm2", label: "cm² (centímetro quadrado)", grupo: "Área" },
  { value: "ha", label: "ha (hectare)", grupo: "Área" },
  // Volume
  { value: "m3", label: "m³ (metro cúbico)", grupo: "Volume" },
  { value: "L", label: "L (litro)", grupo: "Volume" },
  { value: "mL", label: "mL (mililitro)", grupo: "Volume" },
  // Comprimento
  { value: "m", label: "m (metro linear/corrido)", grupo: "Comprimento" },
  { value: "cm", label: "cm (centímetro)", grupo: "Comprimento" },
  { value: "mm", label: "mm (milímetro)", grupo: "Comprimento" },
  { value: "km", label: "km (quilômetro)", grupo: "Comprimento" },
  // Massa
  { value: "kg", label: "kg (quilograma)", grupo: "Massa" },
  { value: "g", label: "g (grama)", grupo: "Massa" },
  { value: "ton", label: "ton (tonelada)", grupo: "Massa" },
  // Contagem / embalagem
  { value: "un", label: "un (unidade)", grupo: "Contagem" },
  { value: "pc", label: "peça (pç)", grupo: "Contagem" },
  { value: "par", label: "par", grupo: "Contagem" },
  { value: "jogo", label: "jogo/conjunto", grupo: "Contagem" },
  { value: "kit", label: "kit", grupo: "Contagem" },
  { value: "folha", label: "folha", grupo: "Contagem" },
  { value: "chapa", label: "chapa", grupo: "Contagem" },
  { value: "barra", label: "barra", grupo: "Contagem" },
  { value: "rl", label: "rolo", grupo: "Contagem" },
  { value: "sc", label: "saco", grupo: "Contagem" },
  { value: "balde", label: "balde", grupo: "Contagem" },
  { value: "lata", label: "lata", grupo: "Contagem" },
  { value: "gl", label: "galão", grupo: "Contagem" },
  { value: "cx", label: "caixa", grupo: "Contagem" },
  { value: "millheiro", label: "milheiro (mil peças)", grupo: "Contagem" },
  // Específicas de ramo (elétrica/hidráulica/esquadrias/estrutura…)
  { value: "ponto", label: "ponto (elétrica/hidráulica/lógica)", grupo: "Ramo" },
  { value: "ponto_luz", label: "ponto de luz", grupo: "Ramo" },
  { value: "circuito", label: "circuito", grupo: "Ramo" },
  { value: "vao", label: "vão (esquadrias)", grupo: "Ramo" },
  { value: "verba", label: "verba (valor fechado)", grupo: "Ramo" },
  // Tempo (mão de obra / locação)
  { value: "h", label: "h (hora)", grupo: "Tempo" },
  { value: "dia", label: "dia", grupo: "Tempo" },
  { value: "mes", label: "mês", grupo: "Tempo" },
];

// Lista simples {value,label} para componentes que já esperam esse formato (ex.: insumos).
export const UNIDADES_PROJETOS = UNIDADES_MEDIDA.map((u) => ({ value: u.value, label: u.label }));

// Agrupado para <optgroup> / seções.
export function unidadesPorGrupo(): Record<string, UnidadeMedida[]> {
  return UNIDADES_MEDIDA.reduce((acc, u) => {
    (acc[u.grupo] ||= []).push(u);
    return acc;
  }, {} as Record<string, UnidadeMedida[]>);
}

// Rótulo de exibição a partir do código gravado (fallback = o próprio código; m2 → m²).
export function rotuloUnidade(value: string | null | undefined): string {
  if (!value) return "";
  if (value === "m2") return "m²";
  if (value === "m3") return "m³";
  const u = UNIDADES_MEDIDA.find((x) => x.value === value);
  return u ? u.label.replace(/\s*\(.*\)$/, "") : value;
}

// Revenda FILA-3 · classificador de ESTADO DE CONTEÚDO do robô (auditor/screen-watcher).
// Depois que a tela ASSENTOU (heurística de settle inalterada — este classificador NÃO decide se assentou,
// só rotula o que já assentou), diz em que estado ela está:
//   com_dados      → tem tabela/gráfico/valores/registros;
//   vazio_legitimo → assentou e está honestamente vazia ("Nenhum X encontrado") — NÃO é bug;
//   sem_plano      → a área não faz parte do plano da empresa (GuardaPlanoArea) — NÃO é bug;
//   sem_acesso     → acesso/permissão negada — NÃO é bug (é gate de segurança).
// O auditor usa isso para não rebaixar uma tela por lista vazia legítima, área não contratada ou sem acesso.

export type EstadoConteudo = 'com_dados' | 'vazio_legitimo' | 'sem_plano' | 'sem_acesso'

export type SinaisConteudo = {
  texto?: string | null       // document.body.innerText (já assentado)
  temTabela?: boolean
  temGrafico?: boolean
  qtdValoresBrl?: number
  emptyState?: boolean        // "Nenhum X encontrado" detectado no DOM
}

// GuardaPlanoArea: "<Empresa> não tem <Área> contratado" · "Esta área não faz parte do plano" · "Trocar de empresa".
const RE_SEM_PLANO = /não faz parte do plano|nao faz parte do plano|não tem .{0,40}contratad|nao tem .{0,40}contratad|contratar (esta|a) área|fale com a ps capital para contratar/i
// terminal de acesso negado (NÃO inclui "verificando permissões", que é loading — tratado pelo settle).
const RE_SEM_ACESSO = /acesso negado|sem acesso|sem permissão|sem permissao|você não tem (permissão|acesso)|voce nao tem (permissao|acesso)|não autorizado|nao autorizado|permissão negada|permissao negada/i
const RE_VAZIO = /nenhum[ao]?\s+\w+\s+encontrad|nada (aqui|encontrado|para (mostrar|exibir))|sem registros|lista vazia|sem dados|nenhum resultado/i

export function classificarEstadoConteudo(s: SinaisConteudo): EstadoConteudo {
  const t = s.texto || ''
  if (RE_SEM_PLANO.test(t)) return 'sem_plano'
  if (RE_SEM_ACESSO.test(t)) return 'sem_acesso'
  const temDados = !!s.temTabela || !!s.temGrafico || (s.qtdValoresBrl ?? 0) > 0
  if (temDados) return 'com_dados'
  if (s.emptyState || RE_VAZIO.test(t)) return 'vazio_legitimo'
  // Sem sinais de dados e sem empty-state explícito: se há texto substancial, a tela mostra ALGO
  // (com_dados); senão, vazio legítimo. Nunca inventa bug — só rotula.
  return t.replace(/\s+/g, '').length > 400 ? 'com_dados' : 'vazio_legitimo'
}

// true quando o vazio é ESPERADO (não penalizar no placar/veredito).
export function estadoNaoEhBug(e: EstadoConteudo): boolean {
  return e === 'vazio_legitimo' || e === 'sem_plano' || e === 'sem_acesso'
}

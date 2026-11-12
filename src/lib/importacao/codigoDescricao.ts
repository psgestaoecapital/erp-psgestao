// Chamado #8439 — modelos de importação em massa: os menus suspensos dos campos codificados
// passam a exibir "código - descrição" (ex.: "00 - Mercadoria para revenda", "0 - Nacional").
// Para que a planilha preenchida por esses menus importe certo — e as planilhas ANTIGAS (só o código)
// continuem funcionando — todos os importadores afetados devem extrair SÓ o código da célula.
//
// Regra: o código é o texto ANTES do primeiro separador " - " / " – " / " — " (hífen ou travessão
// cercado por espaço). Sem separador, o valor inteiro é o código (planilha antiga). A validação do
// código (listas permitidas) continua acontecendo no importador, depois da extração.

const SEP = /\s[-–—]\s/ // espaço + hífen/en dash/em dash + espaço

/**
 * Extrai o código de uma célula que pode vir como "código - descrição" (menu novo, #8439)
 * ou como o código puro (planilha antiga). Nunca lança; sempre devolve string já trimada.
 */
export function extrairCodigo(valor: string | null | undefined): string {
  const t = (valor ?? '').trim()
  if (!t) return t
  const i = t.search(SEP)
  return i >= 0 ? t.slice(0, i).trim() : t
}

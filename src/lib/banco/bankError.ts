// Extrai a mensagem que o BANCO enviou num corpo de erro (Sicredi/Bradesco/Sicoob/…).
//
// Por que isto existe: quando o banco recusa um boleto ele quase sempre DIZ a causa real —
// ex. real do Sicredi (422): "Negócio: Em pagador, para o PESSOA_JURIDICA o documento deve
// possuir 14 digitos". Hoje a tela mostra só "o banco recusou o registro" e joga a causa fora.
// O cliente fica 2 semanas no escuro por algo que resolveria sozinho em 2 minutos se lesse a
// frase do banco. Isto vale para QUALQUER erro de banco, não um provider só — por isso é genérico.

// Chaves com a FRASE descritiva (o que interessa mostrar). Ordem = prioridade.
const CHAVES_DESCRITIVAS = [
  'message', 'mensagem', 'msg', 'detail', 'detalhe', 'descricao', 'description',
  'motivo', 'razao', 'reason', 'error_description',
]
// Chaves com CÓDIGO/rótulo (ex.: "UNPROCESSABLE_ENTITY", "invalid_grant"). Só como último recurso,
// quando não houver frase descritiva — senão vira ruído colado na mensagem boa.
const CHAVES_CODIGO = ['error', 'erro', 'code', 'codigo', 'title', 'titulo']
// Chaves que carregam LISTAS de erros aninhados.
const CHAVES_LISTA = [
  'errors', 'erros', 'violacoes', 'violations', 'mensagens', 'messages', 'campos', 'parametros',
  'details', 'detalhes', 'itens', 'items',
]

const truncar = (s: string) => (s.length <= 400 ? s : s.slice(0, 400) + '…')

// Retorna a frase legível que o banco mandou, ou null. Prioriza a descrição; recorre em listas;
// só usa código quando não há descrição. Dedup e tamanho limitado (não vaza corpo gigante na tela).
export function extractBankMessage(raw: unknown, _profundidade = 0): string | null {
  if (raw == null || _profundidade > 4) return null

  if (typeof raw === 'string') {
    const s = raw.trim()
    if ((s.startsWith('{') || s.startsWith('[')) && s.length > 1) {
      try { return extractBankMessage(JSON.parse(s), _profundidade + 1) } catch { /* usa como texto */ }
    }
    return s.length > 0 ? truncar(s) : null
  }

  const descritivas: string[] = []
  const push = (arr: string[], v: unknown) => { const m = extractBankMessage(v, _profundidade + 1); if (m) arr.push(m) }

  if (Array.isArray(raw)) {
    for (const item of raw) push(descritivas, item)
  } else if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    for (const k of CHAVES_DESCRITIVAS) if (typeof o[k] === 'string' && (o[k] as string).trim()) descritivas.push((o[k] as string).trim())
    for (const k of CHAVES_LISTA) if (o[k] != null) push(descritivas, o[k])
    // Só cai no código se nenhuma frase descritiva apareceu (neste nó ou nas listas dele).
    if (descritivas.length === 0) {
      for (const k of CHAVES_CODIGO) if (typeof o[k] === 'string' && (o[k] as string).trim()) descritivas.push((o[k] as string).trim())
    }
  }

  const unicas = Array.from(new Set(descritivas.filter(Boolean)))
  return unicas.length === 0 ? null : truncar(unicas.join('; '))
}

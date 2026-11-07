// Núcleo de SEGURANÇA do auditor do Hub (eng-chefe-auto). SEM dependência de navegador/banco — só fs — para o gate
// (check-hub-auditor) e o build ficarem leves. Aqui moram as invariantes que o CEO exige: o robô NUNCA clica em ação
// perigosa e só audita telas do Hub na empresa DEMO.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Normaliza para comparar rótulo sem depender de acento/caixa.
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// NUNCA clicar: ações que emitem documento, movimentam dinheiro, falam com terceiros, integram ou apagam.
export const ACOES_PROIBIDAS: readonly string[] = [
  'emitir', 'transmitir', 'autorizar nota', 'nota fiscal', 'nfe', 'nf-e', 'nfse', 'nfs-e', 'danfe',
  'pagar', 'pagamento', 'quitar', 'baixar titulo', 'baixar boleto', 'liquidar',
  'aprovar', 'aprovacao', 'reprovar', 'conciliar', 'conciliacao',
  'enviar', 'whatsapp', 'e-mail', 'email', 'sms', 'compartilhar',
  'integrar', 'sincronizar', 'banco', 'cofre', 'assinar', 'assinatura',
  'excluir', 'apagar', 'deletar', 'remover', 'cancelar nota', 'estornar',
]

// Só abrir e cancelar: botões que abrem um formulário/assistente sem efeito definitivo.
export const ACOES_SEGURAS_ABRIR: readonly string[] = [
  'incluir', 'adicionar', 'novo', 'nova', 'cadastrar', 'criar', 'editar', 'filtrar', 'filtros', 'buscar', 'detalhar',
]

// Rótulos usados para FECHAR um formulário aberto sem salvar.
export const ACOES_FECHAR: readonly string[] = ['cancelar', 'fechar', 'voltar', 'descartar', 'close']

export function ehAcaoProibida(rotulo: string): boolean {
  const n = normalizar(rotulo)
  return ACOES_PROIBIDAS.some((p) => n.includes(p))
}
export function ehAcaoSeguraDeAbrir(rotulo: string): boolean {
  if (!rotulo.trim()) return false
  if (ehAcaoProibida(rotulo)) return false // proibida sempre vence
  const n = normalizar(rotulo)
  return ACOES_SEGURAS_ABRIR.some((s) => n.includes(s))
}

export interface HubRotasArquivo { empresa_demo: string; empresa_demo_nome: string; rotas: Array<{ rota: string; titulo: string }> }
export function carregarRotas(): HubRotasArquivo {
  const txt = readFileSync(join(__dirname, 'hub-rotas.json'), 'utf-8')
  const dados = JSON.parse(txt) as HubRotasArquivo
  if (!/^b0700000-0000-4000-a000-0000000000\d\d$/.test(dados.empresa_demo)) {
    throw new Error(`hub-rotas.json: empresa_demo "${dados.empresa_demo}" não é uma empresa DEMO conhecida`)
  }
  if (!Array.isArray(dados.rotas) || dados.rotas.some((r) => !r.rota.startsWith('/dashboard/projetos'))) {
    throw new Error('hub-rotas.json: toda rota tem de começar em /dashboard/projetos (só o Hub)')
  }
  return dados
}

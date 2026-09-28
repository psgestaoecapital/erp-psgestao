// Fila de chamados (CEO 28/09): o cabeçalho "N p/ aprovar" (Central de Melhorias) mostrava 2 e a aba "Precisa de
// mim" (Atendimento) mostrava 0 — os dois rascunhos eram o #286 (aguardando_confirmacao) e o #135 (nova). Causa: a
// fila carregava v_sugestao_fila com limit(300) SEM ordem (319 chamados) e os dois ficavam de fora; o cabeçalho
// contava por outra consulta. Agora os dois lugares usam as MESMAS funções (filaAtendimento.ts). A prova roda essas
// funções sobre os dados reais (só leitura), com o cliente Supabase, e exige: cabeçalho == aba, e nenhum rascunho
// do banco fora da aba.

import { createClient } from '@supabase/supabase-js'
import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'
import { carregarFila, contarPendentesAprovacao, contarPrecisaDeMim, estadoFila, chamadoEncerrado, rascunhoNaoEnviado, FILA_LIMITE, type ItemFila } from '../../../src/lib/sugestoes/filaAtendimento'

type Linha = ItemFila & { id: string; numero: number }
const sb = () => createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } })

test.describe('Fila de chamados · cabeçalho "p/ aprovar" = aba "Precisa de mim"', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-fila-rascunho-precisa-de-mim', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('caminho principal: cabeçalho = aba = rascunhos em chamados abertos; encerrados ficam fora e marcados', async () => {
    const cliente = sb()
    const cabecalho = await contarPendentesAprovacao(cliente)                // o que a Central de Melhorias mostra
    const fila = await carregarFila<Linha>(cliente)                          // o que a fila de atendimento carrega
    expect(fila.error).toBeNull()
    const aba = contarPrecisaDeMim(fila.data)                                // o número da aba "Precisa de mim"
    expect(aba, `cabeçalho ${cabecalho} × aba ${aba}`).toBe(cabecalho)

    // a verdade no banco: resposta escrita e não aprovada — "Precisa de mim" só em chamado ABERTO (fora concluído/arquivado)
    const todos = (await dbSelect<Linha>('sugestoes', 'select=id,numero,status,resposta,resposta_aprovada,confirmado_pelo_autor&resposta_aprovada=eq.false&resposta=not.is.null'))
      .filter((r) => (r.resposta ?? '').trim())
    const abertos = todos.filter((r) => !chamadoEncerrado(r))
    const encerrados = todos.filter((r) => chamadoEncerrado(r))
    const naFila = new Map(fila.data.map((r) => [r.id, r]))
    expect(aba, 'aba = cabeçalho = total de rascunhos em chamados abertos').toBe(abertos.length)
    expect(abertos.filter((r) => !naFila.has(r.id) || estadoFila(naFila.get(r.id)!) !== 'precisa_mim').map((r) => r.numero),
      'todo rascunho de chamado aberto está na aba "Precisa de mim"').toEqual([])
    // rascunho de chamado encerrado: fora da fila, mas guardado e marcado no histórico (RD-30 — nada é apagado)
    expect(encerrados.filter((r) => !naFila.has(r.id) || estadoFila(naFila.get(r.id)!) === 'precisa_mim' || !rascunhoNaoEnviado(naFila.get(r.id)!)).map((r) => r.numero),
      'rascunho de chamado encerrado: fora da aba e marcado "rascunho não enviado — chamado já encerrado"').toEqual([])
  })

  test('a carga não corta chamados: com menos de FILA_LIMITE chamados, a fila traz todos', async () => {
    const total = await dbSelect<{ id: string }>('sugestoes', 'select=id')
    const fila = await carregarFila<Linha>(sb())
    if (total.length <= FILA_LIMITE) expect(fila.data.length, 'nenhum chamado some da fila').toBe(total.length)
    else expect(fila.data.length).toBeGreaterThanOrEqual(FILA_LIMITE)
  })
})

// Fila de chamados: todo chamado com resposta em rascunho aparece em "Precisa de mim", seja qual for o status
// (CEO 28/09). O defeito: a tela carregava v_sugestao_fila com limit(300) SEM ordem (319 chamados) — o #286, com
// rascunho novo e a linha regravada no fim da tabela, ficou de fora. A prova roda as MESMAS consultas da tela sobre
// os dados reais (só leitura) e confere que nenhum rascunho fica de fora nem cai fora da aba.

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'
import { estadoFila, juntarFila, FILA_LIMITE, type ItemFila } from '../../../src/lib/sugestoes/filaAtendimento'

type Linha = ItemFila & { id: string; numero: number }
const COLS = 'id,numero,status,resposta,resposta_aprovada,confirmado_pelo_autor'

test.describe('Fila de chamados · rascunho sempre em "Precisa de mim"', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-fila-rascunho-precisa-de-mim', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('caminho principal: a carga da tela traz TODOS os rascunhos, e todos caem em "Precisa de mim"', async () => {
    // as duas consultas da tela (page.tsx): recentes ordenados + todos os rascunhos
    const recentes = await dbSelect<Linha>('v_sugestao_fila', `select=${COLS}&order=created_at.desc&limit=${FILA_LIMITE}`)
    const rascunhos = await dbSelect<Linha>('v_sugestao_fila', `select=${COLS}&resposta_aprovada=eq.false&resposta=not.is.null`)
    const tela = juntarFila(recentes, rascunhos)
    // a verdade no banco
    const todos = await dbSelect<Linha>('sugestoes', `select=${COLS}&resposta_aprovada=eq.false&resposta=not.is.null`)
    const esperados = todos.filter((r) => (r.resposta ?? '').trim())
    const naTela = new Map(tela.map((r) => [r.id, r]))
    const faltando = esperados.filter((r) => !naTela.has(r.id)).map((r) => r.numero)
    expect(faltando, 'nenhum rascunho fica fora da carga da tela').toEqual([])
    const foraDaAba = esperados.filter((r) => estadoFila(naTela.get(r.id)!) !== 'precisa_mim').map((r) => r.numero)
    expect(foraDaAba, 'todo rascunho está na aba "Precisa de mim"').toEqual([])
  })

  test('a carga não corta chamados: com menos de FILA_LIMITE chamados, a tela traz todos', async () => {
    const total = await dbSelect<{ id: string }>('sugestoes', 'select=id')
    const recentes = await dbSelect<{ id: string }>('v_sugestao_fila', `select=id&order=created_at.desc&limit=${FILA_LIMITE}`)
    if (total.length <= FILA_LIMITE) expect(recentes.length, 'nenhum chamado some da fila').toBe(total.length)
    else expect(recentes.length).toBe(FILA_LIMITE)
  })
})

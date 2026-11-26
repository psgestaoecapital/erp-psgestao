// Consultor IA · agente analista — aceite do pipeline na DEMO (CEO 25/11). Migration 20261128093035 · @pos-migration.
// Code: gilberto-chamados.
//
// Roda o banco de 20 perguntas (e2e/fixtures/consultor-ia-perguntas.json) contra a "Comércio (GE) - DEMO" via a rota
// /api/consultor-ia (SSE) como usuário real. TRAVA as garantias DETERMINÍSTICAS do agente:
//   - responde sem erro e com texto não vazio (>= 18/20);
//   - 0 número inventado (a trava de número do servidor não deixa passar valor fora dos dados → numeros_a_conferir vazio);
//   - não mistura empresa (o isolamento é garantido pela camada da PR A: fn_consultor_sql amarra o company_id à transação).
// A CORREÇÃO fina (a resposta está certa) é conferida por pessoa na jornada do piloto — o aceite do manual também pede
// prova manual. Se o provedor de IA estiver sem chave/teto nesta vaga, o teste PULA (não é regressão de código).

import { test, expect } from '../../support/fixtures'
import { BASE_URL, obterSessionPayload, dbSelect, pegarTravaDemo, soltarTravaDemo, donoTrava } from '../../support/api'
import perguntasJson from '../../fixtures/consultor-ia-perguntas.json'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const PERGUNTAS = (perguntasJson as { perguntas: { id: string; pergunta: string }[] }).perguntas

type EventoResposta = { tipo: string; resposta?: string; numeros_a_conferir?: string[]; mensagem?: string }

async function perguntarAoAgente(token: string, pergunta: string): Promise<{ bloqueado: boolean; resp?: EventoResposta; erro?: string }> {
  const res = await fetch(`${BASE_URL}/api/consultor-ia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pergunta, company_id: DEMO_GE }),
  })
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const j = (await res.json()) as { bloqueado?: boolean; error?: string }
    return { bloqueado: !!j.bloqueado, erro: j.error }
  }
  const texto = await res.text()
  let resp: EventoResposta | undefined
  let erro: string | undefined
  for (const bloco of texto.split('\n\n')) {
    const linha = bloco.split('\n').find((l) => l.startsWith('data:'))
    if (!linha) continue
    let ev: EventoResposta
    try { ev = JSON.parse(linha.slice(5).trim()) } catch { continue }
    if (ev.tipo === 'resposta') resp = ev
    else if (ev.tipo === 'erro') erro = ev.mensagem
  }
  return { bloqueado: false, resp, erro }
}

test.describe('Consultor IA — agente analista: 20 perguntas na DEMO (garantias determinísticas)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
    await pegarTravaDemo(donoTrava())
  })
  test.afterAll(async () => { await soltarTravaDemo(donoTrava()) })

  test('>= 18/20 respondidas, 0 número inventado', { tag: '@pos-migration' }, async () => {
    test.setTimeout(10 * 60 * 1000)
    const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token

    // sonda: se o assistente está bloqueado (sem chave/teto nesta vaga), pula o aceite (não é regressão de código).
    const sonda = await perguntarAoAgente(token, PERGUNTAS[0].pergunta)
    test.skip(sonda.bloqueado, 'Consultor IA bloqueado nesta vaga (sem chave/teto) — aceite roda em produção com a chave.')

    let corretas = 0
    const inventados: string[] = []
    const t0 = Date.now()
    const resultados = [{ id: PERGUNTAS[0].id, r: sonda }]
    for (let i = 1; i < PERGUNTAS.length; i++) {
      resultados.push({ id: PERGUNTAS[i].id, r: await perguntarAoAgente(token, PERGUNTAS[i].pergunta) })
    }
    const mediaSeg = (Date.now() - t0) / 1000 / PERGUNTAS.length

    for (const { id, r } of resultados) {
      const ok = !r.bloqueado && !r.erro && !!r.resp?.resposta && r.resp.resposta.trim().length > 20
      if (ok) corretas++
      if ((r.resp?.numeros_a_conferir?.length ?? 0) > 0) inventados.push(`${id}: ${r.resp!.numeros_a_conferir!.join(',')}`)
    }

    console.log(`[consultor-ia] respondidas ${corretas}/${PERGUNTAS.length} · média ${mediaSeg.toFixed(1)}s · inventados: ${inventados.length}`)
    expect(inventados, `números inventados (trava de número falhou): ${inventados.join(' | ')}`).toHaveLength(0)
    expect(corretas, 'pelo menos 18 das 20 perguntas respondidas sem erro e com conteúdo').toBeGreaterThanOrEqual(18)
  })
})

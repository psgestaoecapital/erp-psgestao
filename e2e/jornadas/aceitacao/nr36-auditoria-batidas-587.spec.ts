// Chamado #587 (Frioeste · CEO 01/10): auditoria de batidas — o sistema SUGERE, a responsável CONFIRMA COM
// JUSTIFICATIVA, nada grava sozinho. Migration 20261001170000 (@pos-migration). Prova na Demonstração Indústria
// Alimentícia (SST), com um colaborador de teste e o dia do exemplo do chamado (par deslizado: faltou uma batida):
//  1) a auditoria lista o dia com as batidas ORIGINAIS do relatório e a sugestão aponta a batida faltando (09:05);
//  2) sem justificativa nada é gravado (o dia continua como veio);
//  3) com justificativa o dia é relido pela sugestão e a justificativa fica registrada (autor + antes).
// Dados de teste ficam na demonstração (a leitura anterior vai para o histórico pela própria releitura — RD-30).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbInsertMany, obterSessionPayload, registrarJornada } from '../../support/api'
import { sugerirPapeis, marcasDasPausas, diaSuspeito, type LinhaPausaDia } from '../../../src/lib/ponto/pausasMarcas'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
const CPF = `E2E587${RUN}`
const DIA = '2026-09-01'
let token = ''

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: r.status, corpo: (await r.json().catch(() => null)) as Record<string, unknown> }
}
const ts = (h: string) => `${DIA}T${h}:00-03:00`

test.describe.configure({ mode: 'serial' })
test.describe('NR-36 · auditoria de batidas: sugere, confirma com justificativa (#587)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_SST}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    await dbInsert('ind_ponto_colaborador', { company_id: DEMO_SST, provider: 'e2e', cpf: CPF, nome: `E2E Auditoria ${RUN}` })
    // o exemplo do chamado: 09:05 sem par; pausas reais 10:40–11:01, 15:10–15:30, 17:04–17:27
    const pares: [string, string | null][] = [['09:05', '10:40'], ['11:01', '15:10'], ['15:30', '17:04'], ['17:27', null]]
    await dbInsertMany('ind_ponto_pausa', pares.map(([i, f]) => ({
      company_id: DEMO_SST, cpf: CPF, data: DIA, inicio: ts(i), fim: f ? ts(f) : null, tipo: 'termica_253',
      raw: { inicio: ts(i), fim: f ? ts(f) : null, cpf: CPF, data: DIA },
    })))
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nr36-auditoria-batidas-587', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('auditoria lista o dia e a sugestão aponta a batida faltando', { tag: '@pos-migration' }, async () => {
    const r = await rpc('fn_nr36_auditoria_batidas_dias', { p_company_id: DEMO_SST, p_ini: '2026-09-01', p_fim: '2026-09-30' })
    expect(r.status, JSON.stringify(r.corpo)).toBe(200)
    const dia = (r.corpo.dias as { cpf: string; data: string; linhas: LinhaPausaDia[] }[]).find((d) => d.cpf === CPF)
    expect(dia, 'o dia de teste aparece com as batidas originais').toBeTruthy()
    expect(diaSuspeito(dia!.linhas), 'dia com par deslizado').toBe(true)
    const s = sugerirPapeis(marcasDasPausas(dia!.linhas))
    expect(s.faltando).toEqual(['09:05'])
    expect(s.pausas.filter((p) => p.situacao === 'fechada').map((p) => `${p.inicio}-${p.fim}`)).toEqual(['10:40-11:01', '15:10-15:30', '17:04-17:27'])
  })

  test('sem justificativa nada grava; com justificativa relê o dia e registra quem e por quê', { tag: '@pos-migration' }, async () => {
    const r0 = await rpc('fn_nr36_auditoria_batidas_dias', { p_company_id: DEMO_SST, p_ini: '2026-09-01', p_fim: '2026-09-30' })
    const dia = (r0.corpo.dias as { cpf: string; linhas: LinhaPausaDia[] }[]).find((d) => d.cpf === CPF)!
    const marcas = sugerirPapeis(marcasDasPausas(dia.linhas)).marcas

    const sem = await rpc('fn_nr36_reler_dia_justificado', { p_company_id: DEMO_SST, p_cpf: CPF, p_data: DIA, p_marcas: marcas, p_justificativa: 'curta', p_origem: 'sugestao' })
    expect(sem.corpo.erro, 'justificativa é obrigatória').toBe('sem_justificativa')
    const intacto = await dbSelect<{ id: string }>('ind_ponto_pausa', `company_id=eq.${DEMO_SST}&cpf=eq.${CPF}&data=eq.${DIA}&select=id`)
    expect(intacto, 'nada gravado sem justificativa').toHaveLength(4)

    // #587 (CEO 02/10): a sugestão deixa a 09:05 sem retorno — sem dizer que não sabe o horário, não grava
    const falta = await rpc('fn_nr36_reler_dia_justificado', { p_company_id: DEMO_SST, p_cpf: CPF, p_data: DIA, p_marcas: marcas,
      p_justificativa: `E2E ${RUN}: conferido — esqueceu de bater a 1ª pausa`, p_origem: 'sugestao' })
    expect(falta.corpo.erro, 'pendência sem "não sei o horário" não grava').toBe('falta_horario')
    const ok = await rpc('fn_nr36_reler_dia_justificado', { p_company_id: DEMO_SST, p_cpf: CPF, p_data: DIA, p_marcas: marcas,
      p_justificativa: `E2E ${RUN}: conferido — esqueceu de bater a 1ª pausa`, p_origem: 'sugestao', p_pendencia_ciente: true })
    expect(ok.status, JSON.stringify(ok.corpo)).toBe(200)
    expect(ok.corpo.ok, JSON.stringify(ok.corpo)).toBe(true)
    const [j] = await dbSelect<{ origem: string; justificativa: string; autor_id: string | null; antes: unknown[] }>('nr36_releitura_justificativa',
      `company_id=eq.${DEMO_SST}&cpf=eq.${CPF}&data=eq.${DIA}&select=origem,justificativa,autor_id,antes`)
    expect(j.origem).toBe('sugestao')
    expect(j.justificativa).toContain(RUN)
    expect(j.autor_id, 'autoria pela sessão').toBeTruthy()
    expect(j.antes, 'guarda como estava antes').toHaveLength(4)
  })

  test('batida original é imutável; o horário digitado entra como ajuste (catraca, quem, quando) e o dia segue na auditoria', { tag: '@pos-migration' }, async () => {
    // as batidas originais do relatório deste dia: 09:05, 10:40, 11:01, 15:10, 15:30, 17:04, 17:27
    const base = [['09:05', 'retorno'], ['10:40', 'saida'], ['11:01', 'retorno'], ['15:10', 'saida'], ['15:30', 'retorno'], ['17:04', 'saida'], ['17:27', 'retorno']]
      .map(([hora, papel]) => ({ hora, papel, origem: 'arquivo' }))
    const just = `E2E ${RUN}: saída das 09:05 tirada da catraca`
    // "do relatório" com horário que não é batida original: recusado
    const inventada = await rpc('fn_nr36_reler_dia_justificado', { p_company_id: DEMO_SST, p_cpf: CPF, p_data: DIA,
      p_marcas: [{ hora: '08:45', papel: 'saida', origem: 'arquivo' }, ...base], p_justificativa: just, p_origem: 'manual' })
    expect(inventada.corpo.erro, 'batida original não se inventa nem se altera').toBe('marca_original_alterada')
    // digitado sem origem: recusado
    const semOrigem = await rpc('fn_nr36_reler_dia_justificado', { p_company_id: DEMO_SST, p_cpf: CPF, p_data: DIA,
      p_marcas: [{ hora: '08:45', papel: 'saida', origem: 'manual' }, ...base], p_justificativa: just, p_origem: 'manual' })
    expect(semOrigem.corpo.erro, 'horário digitado diz de onde veio').toBe('origem_ajuste_obrigatoria')
    // com a catraca: grava como ajuste, o dia fecha e as originais continuam as mesmas
    const ok = await rpc('fn_nr36_reler_dia_justificado', { p_company_id: DEMO_SST, p_cpf: CPF, p_data: DIA,
      p_marcas: [{ hora: '08:45', papel: 'saida', origem: 'manual', origem_ajuste: 'catraca' }, ...base], p_justificativa: just, p_origem: 'manual' })
    expect(ok.corpo.ok, JSON.stringify(ok.corpo)).toBe(true)
    const [aj] = await dbSelect<{ hora: string; papel: string; origem: string; autor_id: string | null; removido_em: string | null }>('nr36_batida_ajuste',
      `company_id=eq.${DEMO_SST}&cpf=eq.${CPF}&data=eq.${DIA}&removido_em=is.null&select=hora,papel,origem,autor_id,removido_em`)
    expect(aj, 'o ajuste fica na camada à parte').toMatchObject({ hora: '08:45', papel: 'saida', origem: 'catraca' })
    expect(aj.autor_id, 'quem ajustou').toBeTruthy()
    const r = await rpc('fn_nr36_auditoria_batidas_dias', { p_company_id: DEMO_SST, p_ini: '2026-09-01', p_fim: '2026-09-30' })
    const dia = (r.corpo.ajustados as { cpf: string; pendencias: unknown[]; ajuste: { originais: string[]; ajustes: { hora: string }[] } }[]).find((d) => d.cpf === CPF)
    expect(dia, 'o dia ajustado continua na auditoria').toBeTruthy()
    expect(dia!.pendencias, 'sem horário faltando').toHaveLength(0)
    expect(dia!.ajuste.originais, 'batidas originais intactas').toEqual(['09:05', '10:40', '11:01', '15:10', '15:30', '17:04', '17:27'])
    expect(dia!.ajuste.ajustes.map((a) => a.hora)).toEqual(['08:45'])
  })
})

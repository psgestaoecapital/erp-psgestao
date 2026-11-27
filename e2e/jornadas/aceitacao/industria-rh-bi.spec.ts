// Indústria · RH — BI de RH (CEO 25/11). Prova o painel agregado na DEMO Indústria (RD-69/LGPD):
// infrações de ponto (agregado a partir de fn_rh_bi_infracoes, nominal por fn_ponto_infracoes) e cobertura do
// cadastro (fn_rh_bi_cobertura_cadastro). Sem @pos-migration no preview: as funções entram com esta PR.
import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO_INDUSTRIA = 'b0700000-0000-4000-a000-000000000005'

function cpfValido(base9: string): string {
  const d = base9.slice(0, 9).padStart(9, '0').split('').map(Number)
  const dv = (nums: number[]) => { let s = 0; const w = nums.length + 1; for (let i = 0; i < nums.length; i++) s += nums[i] * (w - i); const r = s % 11; return r < 2 ? 0 : 11 - r }
  const dv1 = dv(d); const dv2 = dv([...d, dv1]); return [...d, dv1, dv2].join('')
}

type BiInfra = { total: number; headcount: number; pode_nominal: boolean; por_tipo: { tipo: string; n: number }[] }
type Cobertura = { total_ativas: number; por_setor: { setor: string; ativas: number }[] }
type Nominal = { cpf: string; nome: string | null; tipo: string }

test.describe('Indústria · RH — BI de RH (infrações + cobertura)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-industria-rh-bi', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('infrações agregadas (jornada > 10h) e cobertura do cadastro por setor', async () => {
    const tag = Date.now()
    const cpf = cpfValido(String(tag))
    const setor = `BI TESTE ${tag}`
    const dia = '2026-11-10'
    let funcionarioId = ''
    try {
      await dbDelete('ind_ponto_dia', `company_id=eq.${DEMO_INDUSTRIA}&cpf=eq.${cpf}`)
      await dbDelete('ind_ponto_colaborador', `company_id=eq.${DEMO_INDUSTRIA}&cpf=eq.${cpf}`)
      await dbDelete('compliance_funcionarios', `company_id=eq.${DEMO_INDUSTRIA}&cpf=eq.${cpf}`)

      funcionarioId = (await dbInsert<{ id: string }>('compliance_funcionarios', { company_id: DEMO_INDUSTRIA, nome_completo: `BI Fulano ${tag}`, cpf, setor, data_admissao: '2021-01-10', ativo: true })).id
      await dbInsert('ind_ponto_colaborador', { company_id: DEMO_INDUSTRIA, cpf, nome: `BI Fulano ${tag}`, funcao: 'OPERADOR', departamento: setor, admissao: '2021-01-10' })
      // um dia de 11h (40000s > 10h+tolerância) → infração "jornada_acima_10h"; 2 batidas (par) evita marcação ímpar
      await dbInsert('ind_ponto_dia', { company_id: DEMO_INDUSTRIA, cpf, data: dia, worked_seconds: 40000, total_pontos: 2, department: setor })

      // b) infrações agregadas
      const bi = await rpc<BiInfra>('fn_rh_bi_infracoes', { p_company_id: DEMO_INDUSTRIA, p_data_ini: '2026-11-01', p_data_fim: '2026-11-28', p_departamento: null })
      expect(bi.total, 'pelo menos a infração semeada').toBeGreaterThanOrEqual(1)
      expect(bi.por_tipo.find((t) => t.tipo === 'jornada_acima_10h')?.n ?? 0, 'conta a jornada > 10h').toBeGreaterThanOrEqual(1)
      expect(typeof bi.pode_nominal, 'traz o flag de acesso ao nominal').toBe('boolean')

      // lista nominal, só quando o usuário pode (DEMO: dono) — e com a pessoa semeada
      if (bi.pode_nominal) {
        const nom = await rpc<Nominal[]>('fn_ponto_infracoes', { p_company_id: DEMO_INDUSTRIA, p_data_ini: '2026-11-01', p_data_fim: '2026-11-28', p_departamento: null, p_cpf: null })
        expect(nom.some((r) => r.cpf === cpf && r.tipo === 'jornada_acima_10h'), 'a pessoa aparece no nominal').toBe(true)
      }

      // e) cobertura do cadastro: a pessoa ativa entra no total e no setor dela
      const cob = await rpc<Cobertura>('fn_rh_bi_cobertura_cadastro', { p_company_id: DEMO_INDUSTRIA })
      expect(cob.total_ativas, 'conta a pessoa ativa semeada').toBeGreaterThanOrEqual(1)
      expect(cob.por_setor.find((s) => s.setor === setor)?.ativas ?? 0, 'o setor dela aparece').toBeGreaterThanOrEqual(1)
    } finally {
      await dbDelete('ind_ponto_dia', `company_id=eq.${DEMO_INDUSTRIA}&cpf=eq.${cpf}`)
      await dbDelete('ind_ponto_colaborador', `company_id=eq.${DEMO_INDUSTRIA}&cpf=eq.${cpf}`)
      if (funcionarioId) await dbDelete('compliance_funcionarios', `id=eq.${funcionarioId}`)
    }
  })
})

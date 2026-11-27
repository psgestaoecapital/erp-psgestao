// Indústria · RH — Cadastro de pessoas com custo completo (CEO 25/11). Prova a jornada do RH industrial:
// trazer funções do ponto → pessoa do ponto sem ficha (com sugestão da folha) → criar a ficha pré-preenchida →
// conferir → o custo/hora aparece na função. Roda na DEMO Indústria (RD-69/LGPD: dado fictício).
// Sem @pos-migration no preview: as funções fn_mao_obra_funcoes_do_ponto / fn_mao_obra_pessoas_sem_ficha entram
// com esta PR; a aceitação da main (pós-deploy) é o veredito.
import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbSelect, dbDelete, registrarJornada } from '../../support/api'

const DEMO_INDUSTRIA = 'b0700000-0000-4000-a000-000000000005'

// CPF válido determinístico (dígitos verificadores corretos) a partir de 9 dígitos base — evita colisão entre execuções.
function cpfValido(base9: string): string {
  const d = base9.slice(0, 9).padStart(9, '0').split('').map(Number)
  const dv = (nums: number[]) => { let s = 0; const w = nums.length + 1; for (let i = 0; i < nums.length; i++) s += nums[i] * (w - i); const r = s % 11; return r < 2 ? 0 : 11 - r }
  const dv1 = dv(d); const dv2 = dv([...d, dv1])
  return [...d, dv1, dv2].join('')
}

type Pessoa = { funcionario_id: string; nome: string; funcao_id: string | null; funcao_sugerida: string | null; remuneracao: number | null }
type Lista = { funcoes: { id: string; nome: string; custo: { custo_hora: number | null; origem: string } | null }[]; equipe: { id: string; funcionario_id: string | null; conferido: boolean }[] }

test.describe('Indústria · RH — pessoas do ponto com custo (ponto + folha)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-industria-rh-pessoas', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('trazer funções do ponto → pessoa sem ficha → criar ficha pré-preenchida → conferir → custo/hora na função', async () => {
    const tag = Date.now()
    const cpf = cpfValido(String(tag))
    const matricula = String(90000 + (tag % 9000))
    const funcaoPonto = `OPERADOR TESTE ${tag}`
    let funcionarioId = ''
    const funcoesCriadas: string[] = []
    try {
      // limpeza defensiva (execução anterior que tenha quebrado)
      await dbDelete('compliance_funcionarios', `company_id=eq.${DEMO_INDUSTRIA}&cpf=eq.${cpf}`)
      await dbDelete('ind_ponto_colaborador', `company_id=eq.${DEMO_INDUSTRIA}&cpf=eq.${cpf}`)
      await dbDelete('folha_competencia', `company_id=eq.${DEMO_INDUSTRIA}&matricula=eq.${matricula}`)

      // 1) pessoa no cadastro compartilhado + no ponto (mesmo CPF) + folha (mesma matrícula)
      funcionarioId = (await dbInsert<{ id: string }>('compliance_funcionarios', { company_id: DEMO_INDUSTRIA, nome_completo: `Fulano Teste ${tag}`, cpf, matricula, data_admissao: '2020-05-10', ativo: true })).id
      await dbInsert('ind_ponto_colaborador', { company_id: DEMO_INDUSTRIA, cpf, matricula, nome: `Fulano Teste ${tag}`, funcao: funcaoPonto, departamento: 'DESOSSA', admissao: '2020-05-10' })
      await dbInsert('folha_competencia', { company_id: DEMO_INDUSTRIA, matricula: Number(matricula), competencia: '2026-10-01', nome: `Fulano Teste ${tag}`, remuneracao: 3000, total_geral: 3900 })

      // 2) trazer funções do ponto (idempotente)
      const r1 = await rpc<{ ok: boolean; criadas: number }>('fn_mao_obra_funcoes_do_ponto', { p_company_id: DEMO_INDUSTRIA })
      expect(r1.ok).toBe(true)
      expect(r1.criadas).toBeGreaterThanOrEqual(1)

      // 3) pessoa do ponto sem ficha, com função sugerida e remuneração da folha
      const semFicha = await rpc<{ pessoas: Pessoa[] }>('fn_mao_obra_pessoas_sem_ficha', { p_company_id: DEMO_INDUSTRIA })
      const minha = semFicha.pessoas.find((p) => p.funcionario_id === funcionarioId)
      expect(minha, 'a pessoa do ponto aparece sem ficha').toBeTruthy()
      expect(minha!.funcao_id, 'casou com a função trazida do ponto').toBeTruthy()
      expect(Number(minha!.remuneracao), 'remuneração sugerida da folha').toBe(3000)

      // 4) criar a ficha pré-preenchida (pessoa já existe → sem p_pessoa; componente fixo = remuneração)
      const r2 = await rpc<{ ok: boolean; id: string }>('fn_mao_obra_ficha_salvar', {
        p_company_id: DEMO_INDUSTRIA,
        p_ficha: { tipo: 'pessoa', funcionario_id: funcionarioId, funcao_id: minha!.funcao_id, vinculo: 'clt', horas_produtivas_mes: 176,
          componentes: [{ tipo: 'fixo', subtipo: 'mensal', valor: 3000, gera_dsr: true, integra_13_ferias: true, incide_encargos: true, integra_remuneracao: true }],
          vigencia_inicio: '2026-11-01' },
        p_pessoa: null,
      })
      expect(r2.ok).toBe(true)

      // 5) a ficha entra NÃO conferida; conferir
      const antes = await rpc<Lista>('fn_mao_obra_listar', { p_company_id: DEMO_INDUSTRIA })
      const fichaItem = antes.equipe.find((e) => e.funcionario_id === funcionarioId)
      expect(fichaItem, 'a ficha aparece na equipe').toBeTruthy()
      expect(fichaItem!.conferido, 'nasce não conferida').toBe(false)
      await rpc('fn_mao_obra_ficha_conferir', { p_ficha_id: fichaItem!.id, p_conferido: true })

      // 6) o custo/hora aparece na função (média do grupo com a ficha conferida)
      const depois = await rpc<Lista>('fn_mao_obra_listar', { p_company_id: DEMO_INDUSTRIA })
      funcoesCriadas.push(...depois.funcoes.filter((f) => f.nome.toUpperCase() === funcaoPonto.toUpperCase()).map((f) => f.id))
      const funcao = depois.funcoes.find((f) => f.nome.toUpperCase() === funcaoPonto.toUpperCase())
      expect(funcao, 'a função trazida do ponto existe').toBeTruthy()
      expect(Number(funcao!.custo?.custo_hora), 'custo/hora calculado da ficha conferida').toBeGreaterThan(0)
    } finally {
      if (funcionarioId) await dbDelete('erp_mao_obra_custo', `funcionario_id=eq.${funcionarioId}`)
      if (funcionarioId) await dbDelete('compliance_funcionarios', `id=eq.${funcionarioId}`)
      await dbDelete('ind_ponto_colaborador', `company_id=eq.${DEMO_INDUSTRIA}&cpf=eq.${cpf}`)
      await dbDelete('folha_competencia', `company_id=eq.${DEMO_INDUSTRIA}&matricula=eq.${matricula}`)
      await dbDelete('erp_funcao_mao_obra', `company_id=eq.${DEMO_INDUSTRIA}&nome=eq.${encodeURIComponent(funcaoPonto)}`)
    }
  })
})

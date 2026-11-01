// #2159 · código IBGE do município do cliente (exigido na NFS-e/NF-e).
// O PessoaForm preenche o IBGE por cidade + UF via fn_municipio_por_nome_uf (tabela oficial, 5.570 municípios).
// Este spec prova o contrato que o formulário usa: cidade+UF conhecidos devolvem o código oficial e
// cidade inexistente devolve vazio (não inventa). Só leitura; não grava dado.

import { test, expect } from '../../support/fixtures'
import { rpc } from '../../support/api'

type Municipio = { codigo_ibge?: string } | null

function codigo(r: unknown): string | null {
  const m = (Array.isArray(r) ? r[0] : r) as Municipio
  return m?.codigo_ibge ? String(m.codigo_ibge) : null
}

test.describe('IBGE do município pela tabela oficial (#2159)', () => {
  test('cidade + UF conhecidos devolvem o código oficial de 7 dígitos', async () => {
    const sp = codigo(await rpc('fn_municipio_por_nome_uf', { p_nome: 'São Paulo', p_uf: 'SP' }))
    expect(sp).toBe('3550308')
    const cwb = codigo(await rpc('fn_municipio_por_nome_uf', { p_nome: 'Curitiba', p_uf: 'PR' }))
    expect(cwb).toBe('4106902')
  })

  test('cidade inexistente não inventa código', async () => {
    const r = codigo(await rpc('fn_municipio_por_nome_uf', { p_nome: 'Cidade Que Nao Existe', p_uf: 'SP' }))
    expect(r).toBeNull()
  })
})

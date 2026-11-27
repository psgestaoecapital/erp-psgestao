import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { aliquotaIbptEmpresa } from '@/lib/fiscal/ibptEmpresa'
import type { NFeRequest } from '@/lib/fiscal/types'

export type FonteIbpt = 'ibpt_empresa' | 'tabela_generica'

/**
 * Lei 12.741/2012 (Transparência Fiscal) · "valor aproximado dos tributos" nas Informações
 * Complementares (tag infCpl → campo Focus informacoes_adicionais_contribuinte).
 *
 * ## Base legal
 * - Lei 12.741/2012, art. 1º caput — obriga a informar o "valor aproximado correspondente à totalidade
 *   dos tributos" nos documentos fiscais/equivalentes emitidos POR OCASIÃO DA VENDA AO CONSUMIDOR;
 * - Decreto 8.264/2014 — regulamentação (pode constar em painel ou documento fiscal);
 * - Ajuste SINIEF 20/2012 — tabela de origem da mercadoria.
 * Vigência: em vigor. Fonte das alíquotas: IBPT (tabela por NCM/EX/UF/origem, versão vigente).
 *
 * Operação entre contribuintes para REVENDA (B2B) NÃO é venda ao consumidor → o bloco não entra.
 * Regra no código (não no acaso): só compõe quando o destinatário é consumidor final
 * (nfeReq.consumidorFinal === true; derivado do indIEDest quando não explícito).
 * SIMPLES: percentual único (percentual_total_tributos_sn) × valor da nota. REGIME NORMAL: soma por
 * item da tabela IBPT vigente (federal por origem + estadual + municipal). CONCATENA (não sobrescreve)
 * em nfeReq.observacoes. UF/NCM sem linha na versão vigente → a nota SAI sem o valor daquele item + aviso.
 *
 * Extraído de /api/fiscal/nfe/emitir (#70) para reuso na rota /api/fiscal/nfe/remessa (chamado #11418:
 * a NF-e avulsa saía sem o valor aproximado dos tributos). Comportamento idêntico ao da emissão normal.
 */
export async function aplicarLei12741(
  companyId: string,
  nfeReq: NFeRequest,
): Promise<{ avisoIbpt: string | null; fontesIbpt: Set<FonteIbpt> }> {
  let avisoIbpt: string | null = null
  const fontesIbpt = new Set<FonteIbpt>()
  const valorProdutos = nfeReq.itens.reduce((acc, i) => acc + i.valorTotal, 0)

  const { data: cfg12741 } = await supabaseAdmin
    .from('erp_fiscal_provider_config')
    .select('lei12741_ativo, percentual_total_tributos_sn, lei12741_observacao_template, regime_tributario, opcao_simples_nacional')
    .eq('company_id', companyId).eq('provider', 'focusnfe').eq('ativo', true).maybeSingle()
  const { data: emp12741 } = await supabaseAdmin
    .from('companies').select('pais').eq('id', companyId).maybeSingle()
  const ehEstrangeira = !!(emp12741?.pais && !/^\s*(brasil|brazil|br)\s*$/i.test(String(emp12741.pais)))
  const ehConsumidorFinal = nfeReq.consumidorFinal === true
  const pctTrib = Number(cfg12741?.percentual_total_tributos_sn ?? 0)
  const ehSimples = /simples/i.test(String(cfg12741?.regime_tributario ?? '')) || cfg12741?.opcao_simples_nacional != null
  const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (cfg12741?.lei12741_ativo === true && ehConsumidorFinal && valorProdutos > 0 && !ehEstrangeira) {
    if (ehSimples && Number.isFinite(pctTrib) && pctTrib > 0) {
      // Simples: percentual único do regime (não usa a tabela IBPT).
      const valorAprox = Math.round((pctTrib / 100) * valorProdutos * 100) / 100
      const template = (typeof cfg12741?.lei12741_observacao_template === 'string' && cfg12741.lei12741_observacao_template.trim())
        ? cfg12741.lei12741_observacao_template.trim()
        : 'Valor aproximado dos tributos: R$ {valor} ({percentual}%) — Fonte: Simples Nacional, Lei 12.741/2012'
      const bloco = template.replace(/\{valor\}/g, fmt(valorAprox)).replace(/\{percentual\}/g, fmt(pctTrib))
      nfeReq.observacoes = [nfeReq.observacoes, bloco].map((s) => (s ?? '').trim()).filter(Boolean).join(' | ')
    } else if (!ehSimples) {
      // Regime normal: soma por item da tabela IBPT vigente (federal por origem + estadual + municipal).
      const ufDest = (nfeReq.destinatario?.endereco?.uf ?? '').trim()
      let vFed = 0, vEst = 0, vMun = 0, versaoIbpt = ''
      const semLinha: string[] = []
      // IBPT por empresa (CEO 28/09): 1º a consulta da PRÓPRIA empresa (cache → API); sem token/erro/fora do ar
      // → tabela genérica. Federal = Nacional (origem 0) ou Importado (demais origens).
      const { data: cfgIbptNfe } = await supabaseAdmin.from('erp_fiscal_provider_config').select('ibpt_empresa_nas_notas')
        .eq('company_id', companyId).eq('ativo', true).limit(1).maybeSingle()
      const usarIbptEmpresa = !!(cfgIbptNfe as { ibpt_empresa_nas_notas?: boolean } | null)?.ibpt_empresa_nas_notas
      const { data: empCnpj } = usarIbptEmpresa ? await supabaseAdmin.from('companies').select('cnpj').eq('id', companyId).maybeSingle() : { data: null }
      for (const it of nfeReq.itens) {
        let row: Record<string, unknown> | null | undefined = null
        const ncmIt = (it.ncm ?? '').replace(/\D/g, '')
        if (usarIbptEmpresa && ncmIt.length === 8 && ufDest.length === 2) {
          const emp = await aliquotaIbptEmpresa(companyId, String((empCnpj as { cnpj?: string | null } | null)?.cnpj ?? ''), {
            tipo: 'produto', codigo: ncmIt, uf: ufDest, ex: Number(it.exTipi || 0) || 0, descricao: it.descricao || 'produto',
            unidadeMedida: it.unidade || 'UN', valor: Number(it.valorUnitario) || 1, gtin: null,
          })
          const origemNac = String(it.origem ?? '0') === '0'
          const fed = origemNac ? emp?.nacional : emp?.importado
          if (emp && fed != null) {
            row = { federal: fed, estadual: emp.estadual ?? 0, municipal: emp.municipal ?? 0, total: fed + (emp.estadual ?? 0) + (emp.municipal ?? 0), versao: emp.versao }
            fontesIbpt.add('ibpt_empresa')
          }
        }
        if (!row) {
          const { data: al } = await supabaseAdmin.rpc('fn_ibpt_aliquota_vigente', {
            p_ncm: it.ncm, p_ex: it.exTipi ?? '0', p_uf: ufDest || null, p_origem: it.origem ?? null,
          })
          row = Array.isArray(al) ? (al[0] as Record<string, unknown> | undefined) : (al as Record<string, unknown> | null)
          if (row && row.total != null) fontesIbpt.add('tabela_generica')
        }
        if (!row || row.total == null) {
          const n = (it.ncm ?? '').replace(/\D/g, '')
          if (n && !semLinha.includes(n)) semLinha.push(n)
          continue
        }
        vFed += it.valorTotal * Number(row.federal ?? 0) / 100
        vEst += it.valorTotal * Number(row.estadual ?? 0) / 100
        vMun += it.valorTotal * Number(row.municipal ?? 0) / 100
        if (!versaoIbpt && row.versao) versaoIbpt = String(row.versao)
      }
      const round2 = (n: number) => Math.round(n * 100) / 100
      vFed = round2(vFed); vEst = round2(vEst); vMun = round2(vMun)
      if (vFed + vEst + vMun > 0) {
        const pct = (v: number) => fmt(round2(v / valorProdutos * 100))
        const bloco = `Valor aprox. dos tributos: R$ ${fmt(vFed)} Federal (${pct(vFed)}%), R$ ${fmt(vEst)} Estadual (${pct(vEst)}%) e R$ ${fmt(vMun)} Municipal (${pct(vMun)}%). Fonte: IBPT${versaoIbpt ? ' ' + versaoIbpt : ''}`
        nfeReq.observacoes = [nfeReq.observacoes, bloco].map((s) => (s ?? '').trim()).filter(Boolean).join(' | ')
      }
      if (semLinha.length) {
        avisoIbpt = `Lei 12.741: ${semLinha.length} NCM(s) sem alíquota IBPT na UF ${ufDest || '?'} / versão vigente (${semLinha.slice(0, 10).join(', ')}${semLinha.length > 10 ? '…' : ''}). A nota SAIU, sem esses itens no valor de tributos — atualize a tabela IBPT ou confira o NCM.`
      }
    }
  }
  return { avisoIbpt, fontesIbpt }
}

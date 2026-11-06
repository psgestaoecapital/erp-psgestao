// Visita → Orçamento direto da lista de visitas (PDCA /dashboard/projetos/visitas, auditor 24/10: "ligar Abrir
// orçamento a partir da visita realizada"). Mesma regra da ficha da oportunidade (gerarOrcamentoDaVisita):
// - a oportunidade já tem orçamento → só vincula a visita a ele (nada é criado);
// - não tem → cria o orçamento em rascunho (número da empresa, cliente da oportunidade, validade 15 dias),
//   liga à oportunidade, avança a etapa para 'orcando' (só se ainda antes dela) e vincula a visita.
// Tudo pelo cliente logado (RLS da empresa); a oportunidade é relida na hora para não usar dado velho da lista.
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'

export type OrcamentoDaVisita =
  | { ok: true; orcamentoId: string; numero: string | null; criado: boolean }
  | { ok: false; erro: string }

const ETAPAS_ANTES_DE_ORCAR = ['prospeccao', 'visita_agendada', 'visita_feita']

export async function gerarOrcamentoDaVisita(visitaId: string, oportunidadeId: string): Promise<OrcamentoDaVisita> {
  const { data: op, error: opErr } = await supabase
    .from('erp_crm_oportunidade')
    .select('id, company_id, cliente_id, etapa, observacoes, orcamento_id, erp_clientes(nome_fantasia, razao_social, cpf_cnpj, email, telefone)')
    .eq('id', oportunidadeId)
    .single()
  if (opErr || !op) return { ok: false, erro: erroAmigavel(opErr, 'Oportunidade não encontrada ou sem acesso.') }

  let orcamentoId = op.orcamento_id as string | null
  let numero: string | null = null
  const criado = !orcamentoId
  if (!orcamentoId) {
    if (!op.cliente_id) return { ok: false, erro: 'Defina o cliente da oportunidade antes de gerar o orçamento.' }
    const cli = op.erp_clientes as unknown as {
      nome_fantasia: string | null; razao_social: string | null; cpf_cnpj: string | null; email: string | null; telefone: string | null
    } | null
    const { data: num, error: numErr } = await supabase.rpc('next_orcamento_numero', { p_company_id: op.company_id })
    if (numErr) return { ok: false, erro: erroAmigavel(numErr) }
    const hoje = new Date().toISOString().slice(0, 10)
    const valid = new Date(); valid.setDate(valid.getDate() + 15)
    const { data: orc, error: oErr } = await supabase
      .from('erp_orcamentos')
      .insert({
        company_id: op.company_id,
        numero: num as string,
        versao: 1,
        cliente_id: op.cliente_id,
        cliente_nome: cli?.nome_fantasia ?? cli?.razao_social ?? '',
        cliente_cnpj: cli?.cpf_cnpj ?? null,
        cliente_email: cli?.email ?? null,
        cliente_telefone: cli?.telefone ?? null,
        data_emissao: hoje,
        data_validade: valid.toISOString().slice(0, 10),
        status: 'rascunho',
        subtotal: 0, total: 0,
        observacoes: op.observacoes ?? null,
      })
      .select('id, numero')
      .single()
    if (oErr || !orc) return { ok: false, erro: erroAmigavel(oErr) }
    orcamentoId = orc.id as string
    numero = orc.numero as string
    const { error: lErr } = await supabase.from('erp_crm_oportunidade').update({ orcamento_id: orcamentoId }).eq('id', op.id)
    if (lErr) return { ok: false, erro: erroAmigavel(lErr) }
    if (ETAPAS_ANTES_DE_ORCAR.includes(op.etapa as string)) {
      await supabase.rpc('fn_crm_mover_etapa', { p_id: op.id, p_etapa: 'orcando' })
    }
  }
  const { error: vErr } = await supabase.from('erp_crm_visita').update({ gerou_orcamento_id: orcamentoId }).eq('id', visitaId)
  if (vErr) return { ok: false, erro: erroAmigavel(vErr) }
  return { ok: true, orcamentoId: orcamentoId as string, numero, criado }
}

'use client'
// HB0 · Cockpit da obra — avanço, custo, margem e pendências numa tela só (Hub, blueprint V18 Parte M).
// Só leitura de v_obra_resultado_alocado (HB1, security_invoker: respeita a RLS das tabelas de origem): inclui mão de obra e rateio.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/cockpit'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Situação da obra no cabeçalho do cockpit (a situação é mudada na lista de Obras; aqui só mostra).
const STATUS_OBRA: Record<string, { label: string; cor: string; bg: string }> = {
  em_andamento: { label: 'Em andamento', cor: GOLD, bg: 'rgba(200,148,26,0.12)' },
  concluida: { label: 'Concluída', cor: VERDE, bg: 'rgba(22,163,74,0.12)' },
  pausada: { label: 'Pausada', cor: '#92400E', bg: 'rgba(146,64,14,0.10)' },
  cancelada: { label: 'Cancelada', cor: VERM, bg: 'rgba(185,28,28,0.10)' },
}

type Resultado = {
  obra_id: string; numero: string; nome: string | null; status: string
  custo_previsto: number; receita_prevista: number; receita_servico: number; receita_material: number
  custo_material: number; custo_viagens: number; margem_realizada: number
  custo_mao_obra: number; custo_rateio: number; margem_alocada: number
}
// Contexto da obra (avanço físico, prazo, cliente) — vem de projetos_obras, não da view de resultado financeiro.
type ObraInfo = { pct_conclusao: number | null; data_inicio: string | null; data_prevista_fim: string | null; cliente_nome: string | null; cidade: string | null; area_construida_m2: number | null }
// Ação 5W2H aberta ligada a esta obra (erp_plano_acao.obra_id). Leitura por fn_obra_plano_acao_abertas; não trava a tela.
type AcaoObra = { id: string; codigo: string | null; titulo: string; quando: string | null; responsavel_nome: string | null; status: string; prioridade: string | null; atrasada: boolean }
// Últimos diários de obra (RDO) desta obra (§329 prontuário): leitura direta de projetos_obra_rdo (RLS por empresa); não trava a tela.
type DiarioObra = { id: string; data: string; efetivo: number | null; atividades: string | null; ocorrencias: string | null; fotos: string[] | null }
// Etapas (tarefas do cronograma) atrasadas desta obra (§329 prontuário): fim no passado e ainda não concluídas (percentual < 100).
// Leitura direta de projetos_obra_tarefa (RLS por empresa); não trava a tela.
type EtapaAtrasada = { id: string; nome: string; fim: string | null; percentual: number | null }
type Linha = { k: string; ajuda: string; l: string; v: number }
type Card = { k: string; ajuda: string; l: string; v: string; sub: string; cor?: string; bar?: number | null; linhas?: Linha[] }

// §329 prontuário (req 5f2ff4ac/81cec33c · "evoluir cockpit → prontuário"): navegação por assunto da obra.
// Cada item abre a TELA DONA do assunto (sub-rota de obra já existente, RD-26 — nada é duplicado aqui).
// Só rotas que existem de verdade em src/app/dashboard/projetos/obras/[id]/* (evita link morto).
const PRONTUARIO_SECOES: { slug: string; label: string }[] = [
  { slug: 'ficha', label: 'Dados gerais' },
  { slug: 'estrutura', label: 'Estrutura' },
  { slug: 'partes', label: 'Partes' },
  { slug: 'orcamento', label: 'Orçamento' },
  { slug: 'custos', label: 'Custos' },
  { slug: 'materiais', label: 'Materiais' },
  { slug: 'horas', label: 'Mão de obra' },
  { slug: 'subempreiteiros', label: 'Subempreiteiros' },
  { slug: 'medicoes', label: 'Medições' },
  { slug: 'cronograma', label: 'Cronograma' },
  { slug: 'rdo', label: 'Diário de obra' },
  { slug: 'linha-do-tempo', label: 'Linha do tempo' },
  { slug: 'regularizacao', label: 'Regularização' },
  { slug: 'revisoes', label: 'Revisões' },
  { slug: 'relatorio', label: 'Relatório' },
  { slug: 'portal-cliente', label: 'Portal do cliente' },
  { slug: 'calendario', label: 'Calendário' },
  { slug: 'encerramento', label: 'Entrega e pós-obra' },
]

export default function CockpitObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [r, setR] = useState<Resultado | null>(null)
  const [info, setInfo] = useState<ObraInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  // Código curto de referência do erro para o suporte triar o motivo (RD-98 p2: erro amigável + código + CTA).
  const [codigoErro, setCodigoErro] = useState<string | null>(null)
  // Regularização (alvará e licenças) — alerta de documento vencido/a vencer vira pendência do cockpit (tela 314).
  // Dado real de fn_obra_licenca_listar; falha aqui não trava a tela.
  const [reg, setReg] = useState<{ vencidos: number; vence30: number } | null>(null)
  // Breakdown financeiro do cockpit (§329 cbde929d): orçado × contratado × pago × pendente, lido por fn_obra_cockpit_orcamento
  // (guarda por empresa). Falha aqui não trava a tela — o bloco cai nos estados vazios.
  const [orc, setOrc] = useState<{ orcado: number; contratado: number; pago: number; pendente: number } | null>(null)
  // Ações 5W2H abertas ligadas a esta obra (§112b6b3a): leitura por fn_obra_plano_acao_abertas. Falha aqui não trava a tela.
  const [acoes, setAcoes] = useState<AcaoObra[] | null>(null)
  // Últimos diários (RDO) desta obra (§329): os 5 mais recentes, para ver o andamento sem sair do cockpit. Falha aqui não trava a tela.
  const [diarios, setDiarios] = useState<DiarioObra[] | null>(null)
  // Etapas atrasadas do cronograma desta obra (§329): as 5 mais atrasadas. Falha aqui não trava a tela.
  const [etapasAtrasadas, setEtapasAtrasadas] = useState<EtapaAtrasada[] | null>(null)

  const consulta = useCallback(async () => await supabase.from('v_obra_resultado_alocado').select('*').eq('obra_id', id).maybeSingle(), [id])
  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); setCodigoErro('OBRA-LINK'); return }
    setLoading(true); setErro(null); setCodigoErro(null); setOrc(null); setAcoes(null); setDiarios(null); setEtapasAtrasadas(null)
    let res: Awaited<ReturnType<typeof consulta>>
    try { res = await comPrazo(consulta, { ms: 8000, tentativas: 1, label: 'cockpit-obra' }) } catch { setLoading(false); setErro(MSG_CARREGAMENTO_FALHOU); setCodigoErro('OBRA-REDE'); return }
    const { data, error } = res
    setLoading(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar a obra. Tente de novo.')); setCodigoErro('OBRA-ERR'); return }
    if (!data) {
      // Diferencia obra inexistente × sem acesso nesta empresa (fn_obra_existe só diz existe/tem_acesso).
      const { data: ex } = await supabase.rpc('fn_obra_existe', { p_obra_id: id })
      const j = ex as { existe?: boolean; tem_acesso?: boolean } | null
      if (j?.existe === false) { setErro('Esta obra não existe. O link pode estar desatualizado.'); setCodigoErro('OBRA-404') }
      else if (j?.existe && !j.tem_acesso) { setErro('Você não tem acesso a esta obra na empresa ativa. Troque de empresa ou peça acesso.'); setCodigoErro('OBRA-403') }
      else { setErro('Não foi possível confirmar esta obra. Abra pela lista de obras.'); setCodigoErro('OBRA-CONF') }
      return
    }
    setR(data as Resultado)
    // Contexto da obra (avanço físico, prazo, cliente) — leitura separada de projetos_obras; se falhar, os cards
    // financeiros seguem aparecendo (não trava a tela).
    const { data: oi } = await supabase.from('projetos_obras').select('pct_conclusao,data_inicio,data_prevista_fim,cliente_nome,cidade,area_construida_m2').eq('id', id).maybeSingle()
    if (oi) setInfo(oi as ObraInfo)
    // Breakdown financeiro (orçado × contratado × pago × pendente): leitura guardada por empresa. Não trava a tela.
    try {
      const { data: od } = await supabase.rpc('fn_obra_cockpit_orcamento', { p_obra_id: id })
      const j = od as { ok?: boolean; orcado?: number; contratado?: number; pago?: number; pendente?: number } | null
      if (j && j.ok) setOrc({ orcado: Number(j.orcado ?? 0), contratado: Number(j.contratado ?? 0), pago: Number(j.pago ?? 0), pendente: Number(j.pendente ?? 0) })
    } catch { /* breakdown é opcional no cockpit */ }
    // Ações 5W2H abertas desta obra: leitura guardada por empresa. Não trava a tela — o bloco cai no estado vazio.
    try {
      const { data: ad } = await supabase.rpc('fn_obra_plano_acao_abertas', { p_obra_id: id })
      const j = ad as { ok?: boolean; resultados?: AcaoObra[] } | null
      if (j && j.ok) setAcoes(Array.isArray(j.resultados) ? j.resultados : [])
    } catch { /* bloco de ações é opcional no cockpit */ }
    // Regularização: conta documentos vencidos / a vencer em 30 dias para virar pendência. Não trava a tela.
    try {
      const { data: licData } = await supabase.rpc('fn_obra_licenca_listar', { p_obra_id: id })
      const lic = licData as { ok?: boolean; itens?: { situacao: string }[] } | null
      if (lic && lic.ok) {
        const itens = lic.itens ?? []
        setReg({
          vencidos: itens.filter((l) => l.situacao === 'vencido').length,
          vence30: itens.filter((l) => l.situacao === 'vence_30').length,
        })
      }
    } catch { /* leitura de licença é opcional no cockpit */ }
    // Últimos diários de obra (RDO): os 5 mais recentes não excluídos. Leitura guardada por empresa (RLS). Não trava a tela.
    try {
      const { data: dd } = await supabase.from('projetos_obra_rdo')
        .select('id,data,efetivo,atividades,ocorrencias,fotos')
        .eq('obra_id', id).is('excluido_em', null)
        .order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(5)
      setDiarios(Array.isArray(dd) ? (dd as DiarioObra[]) : [])
    } catch { /* bloco de diários é opcional no cockpit */ }
    // Etapas atrasadas (cronograma): tarefas com fim no passado e ainda não concluídas (percentual < 100 ou não lançado).
    // As 5 mais atrasadas (fim mais antigo primeiro). Leitura guardada por empresa (RLS). Não trava a tela.
    try {
      const hojeStr = new Date().toISOString().slice(0, 10)
      const { data: ea } = await supabase.from('projetos_obra_tarefa')
        .select('id,nome,fim,percentual')
        .eq('obra_id', id).is('excluido_em', null)
        .lt('fim', hojeStr).or('percentual.lt.100,percentual.is.null')
        .order('fim', { ascending: true }).limit(5)
      setEtapasAtrasadas(Array.isArray(ea) ? (ea as EtapaAtrasada[]) : [])
    } catch { /* bloco de etapas atrasadas é opcional no cockpit */ }
  }, [consulta, id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const receita = r ? Number(r.receita_servico) + Number(r.receita_material) : 0
  const custo = r ? Number(r.custo_material) + Number(r.custo_viagens) + Number(r.custo_mao_obra ?? 0) + Number(r.custo_rateio ?? 0) : 0
  const margem = r ? Number(r.margem_alocada ?? r.margem_realizada) : 0
  const margemPct = receita > 0 ? (margem / receita) * 100 : null
  // Margem PREVISTA (do orçamento): (receita prevista − custo previsto) ÷ receita prevista. Serve de referência
  // ao lado da margem realizada, para o gestor ver previsto × realizado sem sair do cockpit (§310/§314).
  const margemPrevistaPct = r && Number(r.receita_prevista) > 0 ? ((Number(r.receita_prevista) - Number(r.custo_previsto)) / Number(r.receita_prevista)) * 100 : null
  // Avanço financeiro = receita já realizada (serviço medido + material vendido à obra) sobre a receita prevista.
  // Usa a receita realizada total — a mesma do card "Receita realizada" — para não contradizer a própria tela quando a
  // receita vem por venda de material (ex.: obra sem NFS-e de medição ainda lançada). Teto 100%.
  const avancoPct = r && Number(r.receita_prevista) > 0 ? Math.min(100, (receita / Number(r.receita_prevista)) * 100) : null
  const custoPrevisto = r ? Number(r.custo_previsto) : 0
  const estouro = custoPrevisto > 0 && custo > custoPrevisto
  // Custo a incorrer = o que ainda falta gastar até o previsto (previsto − realizado, nunca negativo). Dá ao gestor
  // a visão de quanto ainda vai desembolsar. (O "comprometido"/empenhado em OS depende de valor na OS, que hoje não
  // existe no dado — projetos_obra_os não tem coluna de valor —, então não é exibido para não gerar falso-zero.)
  const custoAIncorrer = custoPrevisto > 0 ? Math.max(0, custoPrevisto - custo) : null
  // Avanço físico = execução em campo (pct_conclusao do cronograma/medição). Distinto do avanço financeiro (receita realizada).
  const fisicoPct = info && info.pct_conclusao != null ? Math.max(0, Math.min(100, Number(info.pct_conclusao))) : null
  // Prazo: dias até a data prevista de término; vencido só vale enquanto a obra não foi concluída.
  const hoje = new Date().toISOString().slice(0, 10)
  const prazo = info?.data_prevista_fim ?? null
  const prazoVencido = !!prazo && prazo < hoje && r?.status === 'em_andamento'
  const prazoBR = prazo ? new Date(prazo + 'T12:00:00').toLocaleDateString('pt-BR') : null
  const diasRestantes = prazo ? Math.round((new Date(prazo + 'T12:00:00').getTime() - new Date(hoje + 'T12:00:00').getTime()) / 86400000) : null
  const prazoSub = prazo == null ? 'Sem data prevista'
    : prazoVencido ? 'Vencido' : diasRestantes === 0 ? 'Entrega hoje' : (diasRestantes ?? 0) > 0 ? `Faltam ${diasRestantes} dia(s)` : `${Math.abs(diasRestantes ?? 0)} dia(s) atrás`

  // Indicadores de valor agregado (só com os dois lados do dado): valor ganho = avanço físico × custo previsto.
  // IDC = valor ganho ÷ custo realizado (>1 gastando menos que o executado); IDP = avanço físico ÷ tempo decorrido (cronograma linear).
  const inicio = info?.data_inicio ?? null
  const idc = fisicoPct != null && custoPrevisto > 0 && custo > 0 ? (fisicoPct / 100 * custoPrevisto) / custo : null
  const prazoTotal = inicio && prazo ? Math.round((new Date(prazo + 'T12:00:00').getTime() - new Date(inicio + 'T12:00:00').getTime()) / 86400000) : 0
  const decorridos = inicio ? Math.round((new Date(hoje + 'T12:00:00').getTime() - new Date(inicio + 'T12:00:00').getTime()) / 86400000) : 0
  const tempoPct = prazoTotal > 0 && decorridos > 0 ? Math.min(100, decorridos / prazoTotal * 100) : null
  const idp = fisicoPct != null && tempoPct != null ? fisicoPct / tempoPct : null
  const burn = decorridos > 0 && custo > 0 ? custo / decorridos : null
  // Custo por m² = custo realizado ÷ área construída (da Ficha da obra). Mesmo "custo" do card
  // "Custo realizado", para a tela não se contradizer. Só aparece com os dois lados do dado (§329 cbde929d).
  const areaConstruida = info && info.area_construida_m2 != null ? Number(info.area_construida_m2) : null
  const custoPorM2 = areaConstruida != null && areaConstruida > 0 && custo > 0 ? custo / areaConstruida : null
  // Breakdown financeiro §329 cbde929d. Orçado/contratado/pago/pendente vêm da RPC guardada (orçado cai para o
  // custo previsto da view enquanto a RPC não responde); saldo e projeção derivam do custo realizado + avanço físico
  // que o cockpit já calcula, para não duplicar fonte.
  const orcado = orc ? orc.orcado : custoPrevisto
  const contratado = orc ? orc.contratado : 0
  const pago = orc ? orc.pago : 0
  const pendente = orc ? orc.pendente : 0
  const temContratado = contratado > 0
  const pagoPct = temContratado ? (pago / contratado) * 100 : null
  const saldoOrcado = orcado > 0 ? orcado - custo : null
  const projecaoCusto = fisicoPct != null && fisicoPct > 0 && custo > 0 ? custo / (fisicoPct / 100) : null
  const projecaoAcima = projecaoCusto != null && orcado > 0 && projecaoCusto > orcado
  const indicadores = [
    { k: 'idc', ajuda: 'projetos.cockpit.idc', l: 'IDC · custo', v: idc == null ? '—' : idc.toFixed(2), sub: idc == null ? 'Precisa de avanço físico, custo previsto e custo lançado' : idc >= 1 ? 'Executando dentro do custo' : 'Custo acima do executado', cor: idc == null ? undefined : idc >= 1 ? VERDE : VERM },
    { k: 'idp', ajuda: 'projetos.cockpit.idp', l: 'IDP · prazo', v: idp == null ? '—' : idp.toFixed(2), sub: idp == null ? 'Precisa de data de início, data prevista e avanço físico' : idp >= 1 ? 'No ritmo ou adiantada' : 'Ritmo abaixo do planejado', cor: idp == null ? undefined : idp >= 1 ? VERDE : VERM },
    { k: 'burn', ajuda: 'projetos.cockpit.burn_rate', l: 'Gasto por dia', v: burn == null ? '—' : brl(burn), sub: burn == null ? 'Precisa de data de início e custo lançado' : `${decorridos} dia(s) desde o início` },
    { k: 'custo_m2', ajuda: 'projetos.cockpit.custo_m2', l: 'Custo por m²', v: custoPorM2 == null ? '—' : brl(custoPorM2), sub: custoPorM2 == null ? (custo > 0 ? 'Informe a área construída na Ficha da obra' : 'Precisa de custo lançado e área construída') : `Sobre ${areaConstruida!.toLocaleString('pt-BR')} m² construídos` },
  ]

  const cards: Card[] = r ? [
    { k: 'receita', ajuda: 'projetos.cockpit.receita', l: 'Receita realizada', v: brl(receita), sub: receita > 0 ? 'Medido e vendido na obra' : 'Nenhuma medição lançada ainda', linhas: [
      { k: 'serv', ajuda: 'projetos.cockpit.receita_servico', l: 'Serviço medido', v: Number(r.receita_servico) },
      { k: 'mat', ajuda: 'projetos.cockpit.receita_material', l: 'Material vendido', v: Number(r.receita_material) }] },
    { k: 'custo', ajuda: 'projetos.cockpit.custo', l: 'Custo realizado', v: brl(custo), sub: custoPrevisto > 0 ? `Previsto ${brl(custoPrevisto)} · A incorrer ${brl(custoAIncorrer)}` : 'Sem custo previsto', cor: estouro ? VERM : undefined, linhas: [
      { k: 'mat', ajuda: 'projetos.cockpit.custo_material', l: 'Material', v: Number(r.custo_material) },
      { k: 'via', ajuda: 'projetos.cockpit.custo_viagens', l: 'Viagens', v: Number(r.custo_viagens) },
      { k: 'mo', ajuda: 'projetos.cockpit.custo_mao_obra', l: 'Mão de obra', v: Number(r.custo_mao_obra ?? 0) },
      { k: 'rat', ajuda: 'projetos.cockpit.custo_rateio', l: 'Rateio', v: Number(r.custo_rateio ?? 0) }] },
    { k: 'margem', ajuda: 'projetos.cockpit.margem', l: 'Margem', v: brl(margem), sub: margemPct == null ? (custo > 0 ? 'Custo lançado, mas sem medição: a margem fica negativa até medir' : 'Sem receita ainda') : `${margemPct.toFixed(1)}% da receita${margemPrevistaPct != null ? ` · prevista ${margemPrevistaPct.toFixed(1)}%` : ''}`, cor: margem < 0 ? VERM : VERDE },
    { k: 'avanco_fisico', ajuda: 'projetos.cockpit.avanco_fisico', l: 'Avanço físico', v: fisicoPct == null ? '—' : `${fisicoPct.toFixed(0)}%`, sub: fisicoPct == null ? 'Lance o % no cronograma' : 'Execução em campo', bar: fisicoPct },
    { k: 'avanco', ajuda: 'projetos.cockpit.avanco', l: 'Avanço financeiro', v: avancoPct == null ? '—' : `${avancoPct.toFixed(0)}%`, sub: `Realizado ${brl(receita)} de ${brl(r.receita_prevista)}`, bar: avancoPct },
    { k: 'prazo', ajuda: 'projetos.cockpit.prazo', l: 'Prazo', v: prazoBR ?? '—', sub: prazoSub, cor: prazoVencido ? VERM : undefined, bar: tempoPct },
  ] : []

  // Bloco "Orçamento × desembolso": o breakdown financeiro do requisito §329 (orçado, contratado, pago, pendente,
  // saldo e projeção do custo). Cada indicador tem estado vazio próprio quando a obra ainda não tem o dado (critério d).
  const orcamentoCards: Card[] = r ? [
    { k: 'orcado', ajuda: 'projetos.cockpit.orcado', l: 'Orçado', v: orcado > 0 ? brl(orcado) : '—', sub: orcado > 0 ? 'Custo previsto no orçamento' : 'Cadastre o orçamento da obra' },
    { k: 'contratado', ajuda: 'projetos.cockpit.contratado', l: 'Contratado', v: temContratado ? brl(contratado) : '—', sub: temContratado ? 'Comprometido em contas a pagar' : 'Sem contrato ou compra lançada ainda' },
    { k: 'pago', ajuda: 'projetos.cockpit.pago', l: 'Pago', v: temContratado ? brl(pago) : '—', sub: temContratado ? `${pagoPct!.toFixed(0)}% do contratado` : 'Nada pago ainda', bar: pagoPct },
    { k: 'pendente', ajuda: 'projetos.cockpit.pendente', l: 'Pendente', v: temContratado ? brl(pendente) : '—', sub: temContratado ? 'A liquidar dos compromissos' : 'Nada a pagar ainda', cor: temContratado && pendente > 0 ? GOLD : undefined },
    { k: 'saldo_orcado', ajuda: 'projetos.cockpit.saldo_orcado', l: 'Saldo do orçado', v: saldoOrcado == null ? '—' : brl(saldoOrcado), sub: saldoOrcado == null ? 'Precisa do orçamento cadastrado' : saldoOrcado >= 0 ? 'Ainda cabe no orçamento' : 'Custo realizado passou do orçado', cor: saldoOrcado == null ? undefined : saldoOrcado < 0 ? VERM : VERDE },
    { k: 'projecao_custo', ajuda: 'projetos.cockpit.projecao_custo', l: 'Projeção do custo', v: projecaoCusto == null ? '—' : brl(projecaoCusto), sub: projecaoCusto == null ? 'Precisa de custo lançado e avanço físico' : projecaoAcima ? `Acima do orçado (${brl(orcado)})` : orcado > 0 ? `Dentro do orçado (${brl(orcado)})` : 'Custo projetado ao final', cor: projecaoAcima ? VERM : undefined },
  ] : []

  const pendencias: string[] = []
  if (r) {
    if (Number(r.receita_prevista) === 0) pendencias.push('Obra sem itens contratados — cadastre o orçamento para medir o avanço.')
    if (estouro) pendencias.push(`Custo realizado acima do previsto (${brl(custo)} de ${brl(custoPrevisto)}).`)
    if (margem < 0) pendencias.push(receita === 0
      ? 'Margem negativa porque há custo lançado e nenhuma medição — lance a medição da obra.'
      : 'Margem negativa — o custo lançado superou a receita medida; revise custos.')
    if (prazoVencido) pendencias.push(`Prazo vencido em ${prazoBR} — replaneje a entrega ou ajuste a data.`)
    // Regularização: documento vencido é mais urgente que a vencer; mostra o alerta mais grave (não os dois).
    if (reg && reg.vencidos > 0) pendencias.push(`${reg.vencidos} documento(s) de regularização vencido(s) (alvará/licença/ART) — regularize em Regularização da obra.`)
    else if (reg && reg.vence30 > 0) pendencias.push(`${reg.vence30} documento(s) de regularização vence(m) em até 30 dias — renove em Regularização da obra.`)
    // Desvio físico × financeiro: alerta só quando a diferença é relevante (≥ 15 pontos) e há os dois números.
    if (fisicoPct != null && avancoPct != null && Math.abs(fisicoPct - avancoPct) >= 15) {
      pendencias.push(fisicoPct > avancoPct
        ? `Execução à frente do faturamento (físico ${fisicoPct.toFixed(0)}% × financeiro ${avancoPct.toFixed(0)}%) — há medição a lançar.`
        : `Faturamento à frente da execução (financeiro ${avancoPct.toFixed(0)}% × físico ${fisicoPct.toFixed(0)}%) — confira o avanço em campo.`)
    }
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }} data-testid="hub-cockpit-obra">
        <Link href="/dashboard/projetos/obras?area=hub" style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Obras</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 2px' }}>
          Cockpit {r ? `· ${r.numero}${r.nome ? ` — ${r.nome}` : ''}` : ''}
        </h1>
        {r && (() => {
          const s = STATUS_OBRA[r.status] ?? { label: r.status || 'Situação não informada', cor: MUT, bg: 'rgba(61,35,20,0.06)' }
          return (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '4px 0 2px' }}>
              <span data-testid="cockpit-status-obra" style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: s.cor, background: s.bg, borderRadius: 999, padding: '2px 10px' }}>{s.label}</span>
              <AjudaCampo chave="projetos.cockpit.status_obra" rota={ROTA} />
            </div>
          )
        })()}
        {r && (info?.cliente_nome || info?.cidade) && (
          <div style={{ fontSize: 13, color: MUT, margin: '0 0 12px' }}>{[info?.cliente_nome, info?.cidade].filter(Boolean).join(' · ')}</div>
        )}
        {r && !(info?.cliente_nome || info?.cidade) && <div style={{ margin: '0 0 12px' }} />}
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
          : erro ? (
            <div data-testid="cockpit-erro" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 14, padding: '32px 24px', textAlign: 'center', maxWidth: 440, margin: '20px auto 0' }}>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 400, color: ESP, marginBottom: 6 }}>Não foi possível abrir este cockpit</div>
              <div style={{ fontSize: 13, color: MUT, lineHeight: 1.5, marginBottom: codigoErro ? 8 : 18 }}>{erro}</div>
              {codigoErro && <div data-testid="cockpit-erro-codigo" style={{ fontSize: 11, color: MUT, marginBottom: 18 }}>Código de referência: <b style={{ color: ESP, fontVariantNumeric: 'tabular-nums' }}>{codigoErro}</b></div>}
              <Link href="/dashboard/projetos/obras?area=hub" data-testid="cockpit-erro-voltar" style={{ display: 'inline-block', background: ESP, color: BG, borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Voltar para Obras</Link>
            </div>
          )
          : (
            <>
              {/* §329 prontuário: navegação por assunto da obra — cada atalho abre a tela dona (sub-rota existente), sem sair do fluxo. */}
              <div data-testid="cockpit-prontuario-nav" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '10px 12px', marginBottom: 14 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700, marginBottom: 8 }}>
                  Prontuário da obra <AjudaCampo chave="projetos.cockpit.prontuario_navegacao" rota={ROTA} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PRONTUARIO_SECOES.map((s) => (
                    <Link
                      key={s.slug}
                      href={`/dashboard/projetos/obras/${id}/${s.slug}?area=hub`}
                      data-testid={`prontuario-aba-${s.slug}`}
                      style={{ fontSize: 12, fontWeight: 600, color: ESP, textDecoration: 'none', border: `0.5px solid ${LINE}`, borderRadius: 999, padding: '5px 11px', whiteSpace: 'nowrap', background: BG }}
                    >
                      {s.label}
                    </Link>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
                {cards.map((c) => (
                  <div key={c.k} data-testid={`cockpit-${c.k}`} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.l} <AjudaCampo chave={c.ajuda} rota={ROTA} /></div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: c.cor ?? ESP, margin: '4px 0' }}>{c.v}</div>
                    {c.bar != null && (
                      <div style={{ height: 6, background: LINE, borderRadius: 999, margin: '2px 0 6px' }}>
                        <div style={{ width: `${Math.max(0, Math.min(100, c.bar))}%`, height: '100%', background: GOLD, borderRadius: 999 }} />
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: MUT }}>{c.sub}</div>
                    {c.linhas && (
                      <div style={{ marginTop: 8, borderTop: `0.5px solid ${LINE}`, paddingTop: 6 }}>
                        {c.linhas.map((l) => (
                          <div key={l.k} data-testid={`cockpit-${c.k}-${l.k}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUT, padding: '2px 0' }}>
                            <span>{l.l} <AjudaCampo chave={l.ajuda} rota={ROTA} /></span><span>{brl(l.v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: GOLD, fontWeight: 700, margin: '2px 0 8px' }}>Orçamento × desembolso</div>
              <div data-testid="cockpit-orcamento-desembolso" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
                {orcamentoCards.map((c) => (
                  <div key={c.k} data-testid={`cockpit-${c.k}`} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.l} <AjudaCampo chave={c.ajuda} rota={ROTA} /></div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: c.cor ?? ESP, margin: '4px 0' }}>{c.v}</div>
                    {c.bar != null && (
                      <div style={{ height: 6, background: LINE, borderRadius: 999, margin: '2px 0 6px' }}>
                        <div style={{ width: `${Math.max(0, Math.min(100, c.bar))}%`, height: '100%', background: GOLD, borderRadius: 999 }} />
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: MUT }}>{c.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
                {indicadores.map((c) => (
                  <div key={c.k} data-testid={`cockpit-${c.k}`} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.l} <AjudaCampo chave={c.ajuda} rota={ROTA} /></div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: c.cor ?? ESP, margin: '4px 0' }}>{c.v}</div>
                    <div style={{ fontSize: 11, color: MUT }}>{c.sub}</div>
                  </div>
                ))}
                <div data-testid="cockpit-curva-s" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>Curva S <AjudaCampo chave="projetos.cockpit.curva_s" rota={ROTA} /></div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ESP, margin: '6px 0' }}>
                    {fisicoPct != null && tempoPct != null ? `Físico ${fisicoPct.toFixed(0)}% · Prazo ${tempoPct.toFixed(0)}%` : 'Previsto × realizado'}
                  </div>
                  <div style={{ fontSize: 11, color: MUT, marginBottom: 8 }}>
                    {fisicoPct != null && tempoPct != null
                      ? (fisicoPct >= tempoPct ? 'Execução acompanha o tempo decorrido.' : 'Execução atrás do tempo decorrido — veja o ritmo.')
                      : 'O avanço físico acumulado × previsto aparece na curva do cronograma.'}
                  </div>
                  <Link href={`/dashboard/projetos/obras/${id}/cronograma?area=hub`} data-testid="link-curva-s-cronograma" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Ver curva S no cronograma →</Link>
                </div>
              </div>
              <div data-testid="cockpit-pendencias" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 6 }}>Pendências do dia <AjudaCampo chave="projetos.cockpit.pendencias" rota={ROTA} /></div>
                {pendencias.length === 0
                  ? <div style={{ fontSize: 12, color: VERDE }}>Nenhuma pendência. Obra em ordem.</div>
                  : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: ESP }}>{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>}
              </div>
              {/* Ações 5W2H abertas desta obra (§112b6b3a): o que ainda está em aberto, com responsável e prazo, sem sair do cockpit. */}
              <div data-testid="cockpit-acoes-obra" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Ações abertas desta obra <AjudaCampo chave="projetos.cockpit.acoes_abertas" rota={ROTA} /></div>
                  <Link href="/dashboard/hub/plano-acao?area=hub" data-testid="link-plano-acao-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>Plano de ação (5W2H) →</Link>
                </div>
                {acoes === null
                  ? <div style={{ fontSize: 12, color: MUT }}>Carregando ações…</div>
                  : acoes.length === 0
                    ? <div style={{ fontSize: 12, color: MUT }}>Nenhuma ação aberta ligada a esta obra. Registre o que precisa resolver no <Link href="/dashboard/hub/plano-acao?area=hub" style={{ color: GOLD, fontWeight: 700, textDecoration: 'none' }}>plano de ação (5W2H)</Link> e ligue à obra.</div>
                    : <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {acoes.map((a: AcaoObra) => (
                          <li key={a.id} data-testid="cockpit-acao-item" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, borderTop: `0.5px solid ${LINE}`, paddingTop: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, color: ESP, fontWeight: 600 }}>{a.codigo ? `${a.codigo} · ` : ''}{a.titulo}</div>
                              <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>
                                {a.responsavel_nome || 'Sem responsável'}
                                {a.quando ? ` · vence ${new Date(a.quando + 'T00:00:00').toLocaleDateString('pt-BR')}` : ' · sem prazo'}
                              </div>
                            </div>
                            <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, borderRadius: 999, padding: '2px 8px', color: a.atrasada ? VERM : GOLD, background: a.atrasada ? 'rgba(185,28,28,0.10)' : 'rgba(200,148,26,0.12)' }}>{a.atrasada ? 'Atrasada' : (a.status === 'em_andamento' ? 'Em andamento' : 'Aberta')}</span>
                          </li>
                        ))}
                      </ul>}
              </div>

              {/* Últimos diários de obra (RDO) desta obra (§329 prontuário): o andamento recente do campo sem sair do cockpit. */}
              <div data-testid="cockpit-diarios-obra" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Últimos diários de obra <AjudaCampo chave="projetos.cockpit.ultimos_diarios" rota={ROTA} /></div>
                  <Link href={`/dashboard/projetos/obras/${id}/rdo?area=hub`} data-testid="link-diarios-rdo" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>Diário de obra (RDO) →</Link>
                </div>
                {diarios === null
                  ? <div style={{ fontSize: 12, color: MUT }}>Carregando diários…</div>
                  : diarios.length === 0
                    ? <div style={{ fontSize: 12, color: MUT }}>Nenhum diário registrado nesta obra. Registre o dia a dia da obra no <Link href={`/dashboard/projetos/obras/${id}/rdo?area=hub`} style={{ color: GOLD, fontWeight: 700, textDecoration: 'none' }}>diário de obra (RDO)</Link>.</div>
                    : <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {diarios.map((d: DiarioObra) => (
                          <li key={d.id} data-testid="cockpit-diario-item" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, borderTop: `0.5px solid ${LINE}`, paddingTop: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, color: ESP, fontWeight: 600 }}>{d.data ? new Date(d.data + 'T00:00:00').toLocaleDateString('pt-BR') : 'Sem data'}</div>
                              <div style={{ fontSize: 11, color: MUT, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {d.atividades?.trim() || d.ocorrencias?.trim() || 'Sem atividades anotadas'}
                              </div>
                            </div>
                            <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, borderRadius: 999, padding: '2px 8px', color: GOLD, background: 'rgba(200,148,26,0.12)' }}>{(d.efetivo ?? 0)} no efetivo{(d.fotos?.length ?? 0) > 0 ? ` · ${d.fotos?.length} foto${(d.fotos?.length ?? 0) > 1 ? 's' : ''}` : ''}</span>
                          </li>
                        ))}
                      </ul>}
              </div>

              {/* Etapas atrasadas do cronograma (§329 prontuário): o que passou do prazo e não foi concluído, sem sair do cockpit. */}
              <div data-testid="cockpit-etapas-atrasadas" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Etapas atrasadas <AjudaCampo chave="projetos.cockpit.etapas_atrasadas" rota={ROTA} /></div>
                  <Link href={`/dashboard/projetos/obras/${id}/cronograma?area=hub`} data-testid="link-etapas-cronograma" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>Ver cronograma →</Link>
                </div>
                {etapasAtrasadas === null
                  ? <div style={{ fontSize: 12, color: MUT }}>Carregando etapas…</div>
                  : etapasAtrasadas.length === 0
                    ? <div style={{ fontSize: 12, color: VERDE }}>Nenhuma etapa atrasada. Cronograma em dia.</div>
                    : <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {etapasAtrasadas.map((e: EtapaAtrasada) => {
                          const dias = e.fim ? Math.max(0, Math.round((new Date(hoje + 'T12:00:00').getTime() - new Date(e.fim + 'T12:00:00').getTime()) / 86400000)) : null
                          const pct = e.percentual == null ? 0 : Number(e.percentual)
                          return (
                            <li key={e.id} data-testid="cockpit-etapa-atrasada-item" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, borderTop: `0.5px solid ${LINE}`, paddingTop: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, color: ESP, fontWeight: 600 }}>{e.nome}</div>
                                <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>
                                  {pct.toFixed(0)}% concluído{e.fim ? ` · prazo ${new Date(e.fim + 'T12:00:00').toLocaleDateString('pt-BR')}` : ' · sem prazo'}
                                </div>
                              </div>
                              {dias != null && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, borderRadius: 999, padding: '2px 8px', color: VERM, background: 'rgba(185,28,28,0.10)' }}>{dias} dia{dias === 1 ? '' : 's'} de atraso</span>}
                            </li>
                          )
                        })}
                      </ul>}
              </div>

              {/* Ações da obra: contêiner que quebra linha sem cortar (antes eram links soltos com margens inconsistentes que estouravam no mobile) */}
              <nav aria-label="Ações da obra" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px', marginTop: 2 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/ficha?area=hub`} data-testid="link-ficha-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Ficha da obra →</Link><AjudaCampo chave="projetos.cockpit.ficha" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/estrutura?area=hub`} data-testid="link-estrutura-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Estrutura da obra →</Link><AjudaCampo chave="projetos.cockpit.estrutura" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/partes?area=hub`} data-testid="link-partes-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Partes da obra →</Link><AjudaCampo chave="projetos.cockpit.partes" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/regularizacao?area=hub`} data-testid="link-regularizacao-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Regularização da obra →</Link><AjudaCampo chave="projetos.cockpit.regularizacao" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/horas?area=hub`} data-testid="link-lancar-horas" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Lançar horas →</Link><AjudaCampo chave="projetos.cockpit.lancar_horas" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/orcamento?area=hub`} data-testid="link-orcamento-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Orçamento (EAP) →</Link><AjudaCampo chave="projetos.cockpit.orcamento" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/custos?area=hub`} data-testid="link-custos-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Custos da obra →</Link><AjudaCampo chave="projetos.cockpit.custos" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/os?obra=${id}&area=hub`} data-testid="link-os-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Ordens de serviço →</Link><AjudaCampo chave="projetos.cockpit.os" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/medicoes?area=hub`} data-testid="link-medicoes-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Medições →</Link><AjudaCampo chave="projetos.cockpit.medicoes" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/rdo?area=hub`} data-testid="link-rdo-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Diário de obra (RDO) →</Link><AjudaCampo chave="projetos.cockpit.rdo" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/subempreiteiros?area=hub`} data-testid="link-subempreiteiros-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Subempreiteiros →</Link><AjudaCampo chave="projetos.cockpit.subempreiteiros" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/revisoes?area=hub`} data-testid="link-revisoes-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Revisões de escopo →</Link><AjudaCampo chave="projetos.cockpit.revisoes" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/linha-do-tempo?area=hub`} style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Ver linha do tempo →</Link><AjudaCampo chave="projetos.cockpit.linha_tempo" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/cronograma?area=hub`} style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Ver cronograma →</Link><AjudaCampo chave="projetos.cockpit.cronograma" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/calendario?area=hub`} data-testid="link-calendario-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Calendário da obra →</Link><AjudaCampo chave="projetos.cockpit.calendario" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/viagens?obra=${id}&area=hub`} data-testid="link-nova-viagem" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Nova viagem desta obra →</Link><AjudaCampo chave="projetos.cockpit.nova_viagem" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/encerramento?area=hub`} data-testid="link-encerramento-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Encerramento da obra →</Link><AjudaCampo chave="projetos.cockpit.encerramento" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/materiais?area=hub`} data-testid="link-materiais-obra" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Materiais da obra →</Link><AjudaCampo chave="projetos.cockpit.materiais" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/relatorio?area=hub`} data-testid="link-relatorio-cliente" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Relatório ao cliente →</Link><AjudaCampo chave="projetos.cockpit.relatorio" rota={ROTA} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Link href={`/dashboard/projetos/obras/${id}/portal-cliente?area=hub`} data-testid="link-portal-cliente" style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>Portal do cliente →</Link><AjudaCampo chave="projetos.cockpit.portal_cliente" rota={ROTA} /></span>
              </nav>
            </>
          )}
      </div>
    </div>
  )
}

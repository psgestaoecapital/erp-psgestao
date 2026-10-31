'use client'

// Plano de Ação 5W2H — NÚCLEO COMUM da Indústria (CEO 14/10, reunião Frioeste). Gestão da planta: o quê, por quê, onde,
// quando, quem, como, quanto; status com atraso CALCULADO (prazo < hoje e não concluída/cancelada), quadro por status,
// filtros + busca e "Exportar para a reunião" (PDF/Excel). Nada com nome de espécie (serve toda vertical industrial).
// RD-95: "?" em todo campo/filtro/indicador/ação (AjudaCampo, chaves industrial.plano_acao.* no banco). RD-96: layout próprio.
// Escrita só via RPC (fn_plano_acao_salvar/status/excluir); a tela nunca grava direto na tabela.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapPin, User, CalendarDays, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { exportarExcel, exportarPDF, type Coluna } from '@/lib/export/relatorioLista'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const VERM = '#B23B3B'
const CARD: React.CSSProperties = { background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const ROTA = '/dashboard/industrial/plano-acao'

// Busca acento- e caixa-insensível (#5405): "Marcelo" acha "Márcelo/MARCELO".
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type Status = 'aberta' | 'em_andamento' | 'concluida' | 'cancelada'
type Prioridade = 'alta' | 'media' | 'baixa'
type Origem = 'reuniao' | 'indicador' | 'auditoria' | 'chamado' | 'outro'

type Plano = {
  id: string; codigo: string; titulo: string
  o_que: string | null; por_que: string | null; onde: string | null
  setor_id: string | null; setor_nome: string | null
  quando: string | null; responsavel_user_id: string | null; responsavel_nome: string | null
  como: string | null; custo_estimado: number | null; custo_real: number | null
  status: Status; prioridade: Prioridade; origem: Origem | null; origem_ref: string | null
  indicador_vinculado: string | null; resultado_obtido: string | null
  reuniao_id: string | null; reuniao_codigo: string | null; reuniao_titulo: string | null
  concluida_em: string | null; criado_em: string; atualizado_em: string
  atrasada: boolean; arquivada?: boolean; arquivada_em?: string | null
}
type Resumo = { abertas: number; em_andamento: number; atrasadas: number; concluidas_mes: number; pct_no_prazo: number | null }
type Setor = { id: string; nome: string }
type StatusReuniao = 'agendada' | 'realizada' | 'cancelada'
type Reuniao = {
  id: string; codigo: string; titulo: string; data_hora: string | null; local: string | null
  dono_user_id: string | null; dono_nome: string | null; participantes: string | null; pauta: string | null
  ata: string | null; status: StatusReuniao
  acoes_total: number; acoes_abertas: number; acoes_atrasadas: number; acoes_concluidas: number
}
type FormReuniao = { titulo: string; data_hora: string; local: string; dono_nome: string; participantes: string; pauta: string; ata: string; status: StatusReuniao }
const STATUS_REUNIAO: Record<StatusReuniao, string> = { agendada: 'Agendada', realizada: 'Realizada', cancelada: 'Cancelada' }
const FORM_REUNIAO_VAZIO: FormReuniao = { titulo: '', data_hora: '', local: '', dono_nome: '', participantes: '', pauta: '', ata: '', status: 'agendada' }
type Form = {
  titulo: string; o_que: string; por_que: string; onde: string; setor_id: string; quando: string
  responsavel_nome: string; como: string; custo_estimado: string; custo_real: string
  prioridade: Prioridade; origem: string; origem_ref: string; indicador_vinculado: string; reuniao_id: string
}

const STATUS_ROTULO: Record<Status, string> = { aberta: 'Aberta', em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' }
const STATUS_ORDEM: Status[] = ['aberta', 'em_andamento', 'concluida', 'cancelada']
const PRIORIDADE_ROTULO: Record<Prioridade, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }
const PRIORIDADE_COR: Record<Prioridade, string> = { alta: VERM, media: GOLD, baixa: '#5B8C5A' }
const ORIGEM_ROTULO: Record<Origem, string> = { reuniao: 'Reunião', indicador: 'Indicador', auditoria: 'Auditoria', chamado: 'Chamado', outro: 'Outro' }

const FORM_VAZIO: Form = {
  titulo: '', o_que: '', por_que: '', onde: '', setor_id: '', quando: '',
  responsavel_nome: '', como: '', custo_estimado: '', custo_real: '',
  prioridade: 'media', origem: '', origem_ref: '', indicador_vinculado: '', reuniao_id: '',
}

const brl = (v: number | null) => v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso: string | null) => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `0.5px solid ${LINE}`, borderRadius: 8, fontSize: 14, color: ESP, background: '#FFF', boxSizing: 'border-box' }
const sel: React.CSSProperties = { padding: '7px 10px', border: `0.5px solid ${LINE}`, borderRadius: 8, fontSize: 13, color: ESP, background: '#FFF' }
const btnPrim: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: ESP, color: BG, border: `0.5px solid ${ESP}` }
const btnSec: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: '#FFF', color: ESP, border: `0.5px solid ${LINE}` }
const rotulo: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: ESP, marginBottom: 4 }

export default function PlanoAcaoPage() {
  const { selInfo, sel: selId, companies } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && selId ? selId : null
  const empresaNome = selInfo.nome || companies.find((c) => c.id === companyId)?.nome_fantasia || ''

  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [planos, setPlanos] = useState<Plano[]>([])
  const [setores, setSetores] = useState<Setor[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // reuniões
  const [reunioes, setReunioes] = useState<Reuniao[]>([])
  const [reuniaoSel, setReuniaoSel] = useState('') // '' = Todas
  const [reuniaoForm, setReuniaoForm] = useState<FormReuniao>(FORM_REUNIAO_VAZIO)
  const [reuniaoFormAberto, setReuniaoFormAberto] = useState(false)
  const [reuniaoEditId, setReuniaoEditId] = useState<string | null>(null)
  const [salvandoReuniao, setSalvandoReuniao] = useState(false)

  // filtros (client-side; dataset por empresa é pequeno)
  const [busca, setBusca] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fResp, setFResp] = useState('')
  const [fSetor, setFSetor] = useState('')
  const [fPrioridade, setFPrioridade] = useState('')
  const [fOrigem, setFOrigem] = useState('')
  const [soAtrasadas, setSoAtrasadas] = useState(false)
  const [incluirArq, setIncluirArq] = useState(false) // arquivo: concluída/cancelada >30 dias (nunca exclui)

  // visão (quadro/tabela) e arrastar cartão entre colunas (chamados #3177/#3181)
  const [visao, setVisao] = useState<'quadro' | 'tabela'>('quadro')
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<Status | null>(null)

  // formulário
  const [formAberto, setFormAberto] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  // concluir
  const [concluir, setConcluir] = useState<Plano | null>(null)
  const [resultado, setResultado] = useState('')

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600) }

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setErro(null)
    const p_reuniao = reuniaoSel || null
    // arquivamento automático (idempotente): concluída/cancelada há mais de 30 dias vai para o arquivo
    await supabase.rpc('fn_plano_acao_arquivar_antigas', { p_company_id: companyId })
    const [r, l, s, reu] = await Promise.all([
      supabase.rpc('fn_plano_acao_resumo', { p_company_id: companyId, p_reuniao }),
      supabase.rpc('fn_plano_acao_listar', { p_company_id: companyId, p_reuniao, p_incluir_arquivadas: incluirArq }),
      supabase.from('prod_setor').select('id, nome').eq('company_id', companyId).order('nome'),
      supabase.rpc('fn_plano_acao_reuniao_listar', { p_company_id: companyId }),
    ])
    if (r.data?.ok) setResumo(r.data as Resumo); else setResumo(null)
    if (l.data?.ok) setPlanos((l.data.resultados ?? []) as Plano[])
    else { setPlanos([]); setErro(l.data?.erro || l.error?.message || 'Não foi possível carregar o plano de ação.') }
    setSetores((s.data ?? []) as Setor[])
    if (reu.data?.ok) setReunioes((reu.data.reunioes ?? []) as Reuniao[])
    setLoading(false)
  }, [companyId, reuniaoSel, incluirArq])

  useEffect(() => { void carregar() }, [carregar])

  // responsáveis presentes (para o filtro) — nomes distintos já carregados
  const responsaveis = useMemo(() => {
    const nomes = new Set<string>()
    for (const p of planos) { const n = p.responsavel_nome?.trim(); if (n) nomes.add(n) }
    return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [planos])

  const filtrados = useMemo(() => {
    // #5405 (Frioeste): busca acento-insensível (ex.: "Marcelo" acha "Márcelo") e cobre todos os campos
    // visíveis do cartão/tabela — antes só casava em campos ocultos e o resultado parecia "sem o nome em nenhuma célula".
    const q = norm(busca.trim())
    return planos.filter((p) => {
      if (fStatus && p.status !== fStatus) return false
      if (fResp && (p.responsavel_nome?.trim() ?? '') !== fResp) return false
      if (fSetor && p.setor_id !== fSetor) return false
      if (fPrioridade && p.prioridade !== fPrioridade) return false
      if (fOrigem && p.origem !== fOrigem) return false
      if (soAtrasadas && !p.atrasada) return false
      if (q) {
        const alvo = norm(`${p.codigo} ${p.titulo} ${p.o_que ?? ''} ${p.responsavel_nome ?? ''} ${p.setor_nome ?? ''} ${p.onde ?? ''}`)
        if (!alvo.includes(q)) return false
      }
      return true
    })
  }, [planos, busca, fStatus, fResp, fSetor, fPrioridade, fOrigem, soAtrasadas])

  const porStatus = useMemo(() => {
    const m: Record<Status, Plano[]> = { aberta: [], em_andamento: [], concluida: [], cancelada: [] }
    for (const p of filtrados) m[p.status].push(p)
    return m
  }, [filtrados])

  function abrirNova() { setEditId(null); setForm({ ...FORM_VAZIO, reuniao_id: reuniaoSel }); setFormAberto(true) }
  function abrirEdicao(p: Plano) {
    setEditId(p.id)
    setForm({
      titulo: p.titulo, o_que: p.o_que ?? '', por_que: p.por_que ?? '', onde: p.onde ?? '',
      setor_id: p.setor_id ?? '', quando: p.quando?.slice(0, 10) ?? '', responsavel_nome: p.responsavel_nome ?? '',
      como: p.como ?? '', custo_estimado: p.custo_estimado?.toString() ?? '', custo_real: p.custo_real?.toString() ?? '',
      prioridade: p.prioridade, origem: p.origem ?? '', origem_ref: p.origem_ref ?? '', indicador_vinculado: p.indicador_vinculado ?? '',
      reuniao_id: p.reuniao_id ?? '',
    })
    setFormAberto(true)
  }

  async function salvar() {
    if (!companyId) return
    if (!form.titulo.trim()) { flash('Informe o título da ação.'); return }
    setSalvando(true)
    const payload = {
      titulo: form.titulo, o_que: form.o_que, por_que: form.por_que, onde: form.onde, setor_id: form.setor_id,
      quando: form.quando, responsavel_nome: form.responsavel_nome, como: form.como,
      custo_estimado: form.custo_estimado, custo_real: form.custo_real, prioridade: form.prioridade,
      origem: form.origem, origem_ref: form.origem_ref, indicador_vinculado: form.indicador_vinculado,
      reuniao_id: form.reuniao_id,
    }
    const { data, error } = await supabase.rpc('fn_plano_acao_salvar', { p_company_id: companyId, p_plano: payload, p_id: editId })
    setSalvando(false)
    if (error || !data?.ok) { flash(data?.erro === 'titulo_obrigatorio' ? 'O título é obrigatório.' : `Não salvou: ${data?.erro || error?.message || 'erro'}`); return }
    setFormAberto(false)
    flash(editId ? 'Ação atualizada.' : `Ação criada (${data.codigo}).`)
    await carregar()
  }

  async function mudarStatus(p: Plano, novo: Status) {
    const { data, error } = await supabase.rpc('fn_plano_acao_status', { p_id: p.id, p_status: novo })
    if (error || !data?.ok) { flash(`Não mudou o status: ${data?.erro || error?.message || 'erro'}`); return }
    flash(`"${p.codigo}" → ${STATUS_ROTULO[novo]}.`)
    await carregar()
  }

  async function confirmarConclusao() {
    if (!concluir) return
    if (!resultado.trim()) { flash('Descreva o resultado obtido para concluir.'); return }
    const { data, error } = await supabase.rpc('fn_plano_acao_status', { p_id: concluir.id, p_status: 'concluida', p_resultado: resultado })
    if (error || !data?.ok) { flash(data?.erro === 'resultado_obrigatorio' ? 'O resultado é obrigatório.' : `Não concluiu: ${data?.erro || error?.message || 'erro'}`); return }
    setConcluir(null); setResultado('')
    flash(`"${concluir.codigo}" concluída.`)
    await carregar()
  }

  async function excluir(p: Plano) {
    if (!window.confirm(`Excluir a ação ${p.codigo} — "${p.titulo}"? Ela sai do plano (exclusão lógica).`)) return
    const { data, error } = await supabase.rpc('fn_plano_acao_excluir', { p_id: p.id })
    if (error || !data?.ok) { flash(`Não excluiu: ${data?.erro || error?.message || 'erro'}`); return }
    flash(`"${p.codigo}" removida do plano.`)
    await carregar()
  }

  // Arrastar o cartão para outra coluna = mudar o status (concluir pede o resultado, como no botão).
  function soltarEm(destino: Status) {
    const p = planos.find((x) => x.id === arrastando)
    setArrastando(null); setSobre(null)
    if (!p || p.status === destino) return
    if (destino === 'concluida') { setConcluir(p); setResultado(''); return }
    void mudarStatus(p, destino)
  }

  // ── Reuniões ──
  const reuniaoAtual = reunioes.find((r) => r.id === reuniaoSel) ?? null

  function abrirNovaReuniao() { setReuniaoEditId(null); setReuniaoForm(FORM_REUNIAO_VAZIO); setReuniaoFormAberto(true) }
  function abrirEdicaoReuniao(r: Reuniao) {
    setReuniaoEditId(r.id)
    setReuniaoForm({
      titulo: r.titulo, data_hora: r.data_hora ? r.data_hora.slice(0, 16) : '', local: r.local ?? '',
      dono_nome: r.dono_nome ?? '', participantes: r.participantes ?? '', pauta: r.pauta ?? '', ata: r.ata ?? '', status: r.status,
    })
    setReuniaoFormAberto(true)
  }
  async function salvarReuniao() {
    if (!companyId) return
    if (!reuniaoForm.titulo.trim()) { flash('Informe o título da reunião.'); return }
    setSalvandoReuniao(true)
    const payload = {
      titulo: reuniaoForm.titulo, data_hora: reuniaoForm.data_hora, local: reuniaoForm.local, dono_nome: reuniaoForm.dono_nome,
      participantes: reuniaoForm.participantes, pauta: reuniaoForm.pauta, ata: reuniaoForm.ata, status: reuniaoForm.status,
    }
    const { data, error } = await supabase.rpc('fn_plano_acao_reuniao_salvar', { p_company_id: companyId, p_reuniao: payload, p_id: reuniaoEditId })
    setSalvandoReuniao(false)
    if (error || !data?.ok) { flash(data?.erro === 'titulo_obrigatorio' ? 'O título é obrigatório.' : `Não salvou: ${data?.erro || error?.message || 'erro'}`); return }
    setReuniaoFormAberto(false)
    flash(reuniaoEditId ? 'Reunião atualizada.' : `Reunião criada (${data.codigo}).`)
    if (!reuniaoEditId && data.id) setReuniaoSel(data.id as string)
    await carregar()
  }
  async function excluirReuniao(r: Reuniao) {
    if (!window.confirm(`Excluir a reunião ${r.codigo} — "${r.titulo}"? As ações dela continuam no plano, só perdem o vínculo.`)) return
    const { data, error } = await supabase.rpc('fn_plano_acao_reuniao_excluir', { p_id: r.id })
    if (error || !data?.ok) { flash(`Não excluiu: ${data?.erro || error?.message || 'erro'}`); return }
    if (reuniaoSel === r.id) setReuniaoSel('')
    flash(`Reunião "${r.codigo}" removida.`)
    await carregar()
  }

  // ── Export "para a reunião" (lista FILTRADA) ──
  const colunas: Coluna<Plano>[] = [
    { header: 'Código', get: (p) => p.codigo, peso: 1.1 },
    { header: 'Título (O quê)', get: (p) => p.titulo, peso: 2.6 },
    { header: 'Por quê', get: (p) => p.por_que ?? '', peso: 2.2 },
    { header: 'Onde', get: (p) => p.setor_nome || p.onde || '', peso: 1.4 },
    { header: 'Quem', get: (p) => p.responsavel_nome ?? '', peso: 1.4 },
    { header: 'Quando', get: (p) => p.quando, tipo: 'data', peso: 1.1, align: 'right' },
    { header: 'Como', get: (p) => p.como ?? '', peso: 2.2 },
    { header: 'Estimado', get: (p) => p.custo_estimado, tipo: 'moeda', peso: 1.2, align: 'right', total: true },
    { header: 'Real', get: (p) => p.custo_real, tipo: 'moeda', peso: 1.2, align: 'right', total: true },
    { header: 'Prioridade', get: (p) => PRIORIDADE_ROTULO[p.prioridade], peso: 1 },
    { header: 'Status', get: (p) => (p.atrasada ? `${STATUS_ROTULO[p.status]} (atrasada)` : STATUS_ROTULO[p.status]) + (p.arquivada ? ' · arquivada' : ''), peso: 1.4 },
  ]
  function metaRelatorio() {
    const filtros: string[] = []
    if (fStatus) filtros.push(`status ${STATUS_ROTULO[fStatus as Status]}`)
    if (fResp) filtros.push(`responsável ${fResp}`)
    if (fSetor) filtros.push(`setor ${setores.find((s) => s.id === fSetor)?.nome ?? ''}`)
    if (fPrioridade) filtros.push(`prioridade ${PRIORIDADE_ROTULO[fPrioridade as Prioridade]}`)
    if (fOrigem) filtros.push(`origem ${ORIGEM_ROTULO[fOrigem as Origem]}`)
    if (soAtrasadas) filtros.push('só atrasadas')
    if (incluirArq) filtros.push('com arquivadas')
    if (busca.trim()) filtros.push(`busca "${busca.trim()}"`)
    return {
      titulo: 'Plano de Ação 5W2H', empresa: empresaNome, filtros: filtros.length ? filtros.join(' · ') : 'todas as ações',
      emitidoEmISO: new Date().toISOString(),
      kpis: resumo ? [
        { label: 'Abertas', valor: resumo.abertas }, { label: 'Em andamento', valor: resumo.em_andamento },
        { label: 'Atrasadas', valor: resumo.atrasadas }, { label: 'Concluídas no mês', valor: resumo.concluidas_mes },
      ] : undefined,
    }
  }
  function exportar(fmt: 'pdf' | 'excel' | 'csv') {
    if (!filtrados.length) { flash('Nada para exportar com os filtros atuais.'); return }
    if (fmt === 'csv') {
      const cel = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const linhas = [colunas.map((c) => cel(c.header)).join(';'), ...filtrados.map((p) => colunas.map((c) => cel(c.get(p))).join(';'))]
      const url = URL.createObjectURL(new Blob(['\uFEFF' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a'); a.href = url; a.download = 'plano-de-acao.csv'; a.click(); URL.revokeObjectURL(url)
      flash('CSV gerado.'); return
    }
    const meta = metaRelatorio()
    if (fmt === 'pdf') void exportarPDF(meta, colunas, filtrados).then(() => flash('PDF gerado.')).catch(() => flash('Falha ao gerar o PDF.'))
    else { try { exportarExcel(meta, colunas, filtrados); flash('Excel gerado.') } catch { flash('Falha ao gerar o Excel.') } }
  }
  function exportarAta(r: Reuniao) {
    const acoes = planos.filter((p) => p.reuniao_id === r.id)
    const partes: string[] = []
    if (r.dono_nome) partes.push(`Dono: ${r.dono_nome}`)
    if (r.data_hora) partes.push(`Data: ${new Date(r.data_hora).toLocaleString('pt-BR')}`)
    if (r.local) partes.push(`Local: ${r.local}`)
    partes.push(`Status: ${STATUS_REUNIAO[r.status]}`)
    if (r.participantes) partes.push(`Participantes: ${r.participantes.replace(/\s*\n\s*/g, ', ')}`)
    if (r.pauta) partes.push(`Pauta: ${r.pauta}`)
    if (r.ata) partes.push(`Ata: ${r.ata}`)
    const meta = {
      titulo: `Ata — ${r.codigo} · ${r.titulo}`, empresa: empresaNome,
      filtros: partes.join('  ·  ') || 'reunião sem detalhes',
      emitidoEmISO: new Date().toISOString(),
      kpis: [
        { label: 'Ações', valor: r.acoes_total }, { label: 'Abertas', valor: r.acoes_abertas },
        { label: 'Atrasadas', valor: r.acoes_atrasadas }, { label: 'Concluídas', valor: r.acoes_concluidas },
      ],
    }
    void exportarPDF(meta, colunas, acoes).then(() => flash('Ata (PDF) gerada.')).catch(() => flash('Falha ao gerar a ata.'))
  }

  if (!companyId) {
    return <div style={{ background: BG, minHeight: '100vh', padding: 32, color: MUT, fontSize: 14 }}>Selecione uma empresa específica no topo para ver o Plano de Ação 5W2H da planta.</div>
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Cabeçalho */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Industrial · Gestão da planta</div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 0' }}>Plano de Ação 5W2H</h1>
            <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>{empresaNome}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span role="group" aria-label="Forma de exibir as ações (Kanban ou Lista)" style={{ display: 'inline-flex', border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
                {(['quadro', 'tabela'] as const).map((v) => (
                  <button key={v} type="button" data-testid={`plano-visao-${v}`} aria-pressed={visao === v} onClick={() => setVisao(v)}
                    style={{ padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: visao === v ? ESP : '#FFF', color: visao === v ? BG : ESP }}>
                    {v === 'quadro' ? 'Kanban' : 'Lista'}
                  </button>
                ))}
              </span>
              <AjudaCampo chave="industrial.plano_acao.visao" rota={ROTA} />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button type="button" data-testid="plano-exportar-pdf" onClick={() => exportar('pdf')} style={btnSec}>Exportar PDF</button>
              <AjudaCampo chave="industrial.plano_acao.exportar" rota={ROTA} />
            </span>
            <button type="button" data-testid="plano-exportar-excel" onClick={() => exportar('excel')} style={btnSec}>Exportar Excel</button>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button type="button" data-testid="plano-exportar-csv" onClick={() => exportar('csv')} style={btnSec}>Exportar CSV</button>
              <AjudaCampo chave="industrial.plano_acao.exportar_csv" rota={ROTA} />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button type="button" data-testid="plano-novo" onClick={abrirNova} style={btnPrim}>+ Nova ação</button>
              <AjudaCampo chave="industrial.plano_acao.novo" rota={ROTA} />
            </span>
          </div>
        </header>

        {/* Reunião */}
        <div style={{ ...CARD, padding: 12, marginBottom: 16, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ flex: '1 1 260px', minWidth: 180 }}>
              <span style={rotulo}>Reunião<AjudaCampo chave="industrial.plano_acao.reuniao_seletor" rota={ROTA} /></span>
              <select data-testid="plano-reuniao-sel" value={reuniaoSel} onChange={(e) => setReuniaoSel(e.target.value)} style={{ ...inp, padding: '8px 10px' }}>
                <option value="">Todas as reuniões (visão geral)</option>
                {reunioes.map((r) => <option key={r.id} value={r.id}>{r.codigo} · {r.titulo}</option>)}
              </select>
            </label>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button type="button" data-testid="plano-reuniao-nova" onClick={abrirNovaReuniao} style={btnSec}>+ Nova reunião</button>
              <AjudaCampo chave="industrial.plano_acao.reuniao_nova" rota={ROTA} />
            </span>
          </div>
          {reuniaoAtual && (
            <div data-testid="plano-reuniao-resumo" style={{ borderTop: `0.5px solid ${LINE}`, paddingTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: MUT }}>
              <span><b style={{ color: ESP }}>{reuniaoAtual.codigo}</b> · {STATUS_REUNIAO[reuniaoAtual.status]}</span>
              {reuniaoAtual.dono_nome && <span>Dono: {reuniaoAtual.dono_nome}</span>}
              {reuniaoAtual.data_hora && <span>Data: {new Date(reuniaoAtual.data_hora).toLocaleString('pt-BR')}</span>}
              {reuniaoAtual.participantes && <span>Participantes: {reuniaoAtual.participantes.replace(/\s*\n\s*/g, ', ')}</span>}
              <span>Ações: <b style={{ color: ESP }}>{reuniaoAtual.acoes_total}</b> · abertas {reuniaoAtual.acoes_abertas} · <span style={{ color: reuniaoAtual.acoes_atrasadas ? VERM : MUT, fontWeight: reuniaoAtual.acoes_atrasadas ? 700 : 400 }}>atrasadas {reuniaoAtual.acoes_atrasadas}</span> · concluídas {reuniaoAtual.acoes_concluidas}</span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <button type="button" data-testid="plano-reuniao-nova-acao" onClick={abrirNova} style={{ ...btnPrim, padding: '5px 10px', fontSize: 12 }}>+ Nova ação</button>
                <AjudaCampo chave="industrial.plano_acao.reuniao_nova_acao" rota={ROTA} />
                <button type="button" data-testid="plano-reuniao-editar" onClick={() => abrirEdicaoReuniao(reuniaoAtual)} style={{ ...btnSec, padding: '5px 10px', fontSize: 12 }}>Editar</button>
                <button type="button" data-testid="plano-reuniao-exportar" onClick={() => exportarAta(reuniaoAtual)} style={{ ...btnSec, padding: '5px 10px', fontSize: 12 }}>Exportar ata (PDF)</button>
                <AjudaCampo chave="industrial.plano_acao.reuniao_exportar_ata" rota={ROTA} />
                <button type="button" data-testid="plano-reuniao-excluir" onClick={() => excluirReuniao(reuniaoAtual)} style={{ ...btnSec, padding: '5px 10px', fontSize: 12, color: VERM }}>Excluir</button>
              </span>
            </div>
          )}
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          <Kpi chave="industrial.plano_acao.kpi_abertas" titulo="Abertas" valor={resumo?.abertas ?? 0} />
          <Kpi chave="industrial.plano_acao.kpi_em_andamento" titulo="Em andamento" valor={resumo?.em_andamento ?? 0} />
          <Kpi chave="industrial.plano_acao.kpi_atrasadas" titulo="Atrasadas" valor={resumo?.atrasadas ?? 0} cor={VERM} testid="kpi-atrasadas" />
          <Kpi chave="industrial.plano_acao.kpi_concluidas_mes" titulo="Concluídas no mês" valor={resumo?.concluidas_mes ?? 0} />
          <Kpi chave="industrial.plano_acao.kpi_pct_prazo" titulo="% no prazo" valor={resumo?.pct_no_prazo != null ? `${resumo.pct_no_prazo}%` : '—'} />
        </div>

        {/* Filtros + busca */}
        <div style={{ ...CARD, padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 220px', minWidth: 160 }}>
            <span style={rotulo}>Buscar<AjudaCampo chave="industrial.plano_acao.busca" rota={ROTA} /></span>
            <input data-testid="plano-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código, título, o quê ou responsável" style={inp} />
          </label>
          <label>
            <span style={rotulo}>Status<AjudaCampo chave="industrial.plano_acao.f_status" rota={ROTA} /></span>
            <select data-testid="plano-f-status" value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={sel}>
              <option value="">Todos</option>
              {STATUS_ORDEM.map((s) => <option key={s} value={s}>{STATUS_ROTULO[s]}</option>)}
            </select>
          </label>
          <label>
            <span style={rotulo}>Responsável<AjudaCampo chave="industrial.plano_acao.f_responsavel" rota={ROTA} /></span>
            <select data-testid="plano-f-responsavel" value={fResp} onChange={(e) => setFResp(e.target.value)} style={sel}>
              <option value="">Todos</option>
              {responsaveis.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>
            <span style={rotulo}>Setor<AjudaCampo chave="industrial.plano_acao.f_setor" rota={ROTA} /></span>
            <select data-testid="plano-f-setor" value={fSetor} onChange={(e) => setFSetor(e.target.value)} style={sel}>
              <option value="">Todos</option>
              {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </label>
          <label>
            <span style={rotulo}>Prioridade<AjudaCampo chave="industrial.plano_acao.f_prioridade" rota={ROTA} /></span>
            <select data-testid="plano-f-prioridade" value={fPrioridade} onChange={(e) => setFPrioridade(e.target.value)} style={sel}>
              <option value="">Todas</option>
              {(['alta', 'media', 'baixa'] as Prioridade[]).map((p) => <option key={p} value={p}>{PRIORIDADE_ROTULO[p]}</option>)}
            </select>
          </label>
          <label>
            <span style={rotulo}>Origem<AjudaCampo chave="industrial.plano_acao.f_origem" rota={ROTA} /></span>
            <select data-testid="plano-f-origem" value={fOrigem} onChange={(e) => setFOrigem(e.target.value)} style={sel}>
              <option value="">Todas</option>
              {(Object.keys(ORIGEM_ROTULO) as Origem[]).map((o) => <option key={o} value={o}>{ORIGEM_ROTULO[o]}</option>)}
            </select>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: ESP, padding: '7px 2px' }}>
            <input data-testid="plano-f-atrasadas" type="checkbox" checked={soAtrasadas} onChange={(e) => setSoAtrasadas(e.target.checked)} />
            Só atrasadas<AjudaCampo chave="industrial.plano_acao.f_so_atrasadas" rota={ROTA} />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: ESP, padding: '7px 2px' }}>
            <input data-testid="plano-f-arquivadas" type="checkbox" checked={incluirArq} onChange={(e) => setIncluirArq(e.target.checked)} />
            Incluir arquivadas<AjudaCampo chave="industrial.plano_acao.incluir_arquivadas" rota={ROTA} />
          </label>
        </div>

        {erro && <div style={{ ...CARD, borderColor: VERM, color: VERM, marginBottom: 16, fontSize: 13 }}>{erro}</div>}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : visao === 'tabela' ? (
          <TabelaAcoes planos={filtrados} onEditar={abrirEdicao} />
        ) : (
          <div data-testid="plano-quadro" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, alignItems: 'start' }}>
            {STATUS_ORDEM.map((s) => (
              <div key={s} data-testid={`plano-coluna-${s}`}
                onDragOver={(e) => { if (arrastando) { e.preventDefault(); setSobre(s) } }}
                onDragLeave={() => setSobre((v) => (v === s ? null : v))}
                onDrop={(e) => { e.preventDefault(); soltarEm(s) }}
                style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, minHeight: 80, borderRadius: 12, padding: 4, outline: sobre === s ? `2px dashed ${GOLD}` : '2px dashed transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 2px' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>{STATUS_ROTULO[s]}</span>
                  <span style={{ fontSize: 12, color: MUT }}>{porStatus[s].length}</span>
                </div>
                {porStatus[s].length === 0 ? (
                  <div style={{ ...CARD, padding: 12, color: MUT, fontSize: 12, textAlign: 'center', borderStyle: 'dashed' }}>—</div>
                ) : porStatus[s].map((p) => (
                  <CardAcao key={p.id} p={p} arrastando={arrastando === p.id} onArrastar={(on) => { setArrastando(on ? p.id : null); if (!on) setSobre(null) }} onEditar={() => abrirEdicao(p)} onStatus={(st) => void mudarStatus(p, st)}
                    onConcluir={() => { setConcluir(p); setResultado('') }} onExcluir={() => void excluir(p)} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {formAberto && (
        <Modal titulo={editId ? 'Editar ação' : 'Nova ação 5W2H'} onFechar={() => setFormAberto(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              <span style={rotulo}>Título<AjudaCampo chave="industrial.plano_acao.titulo" rota={ROTA} /></span>
              <input data-testid="campo-titulo" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Revisar o plano de limpeza da sala de cortes" style={inp} />
            </label>
            <label>
              <span style={rotulo}>O quê<AjudaCampo chave="industrial.plano_acao.o_que" rota={ROTA} /></span>
              <textarea data-testid="campo-o_que" value={form.o_que} onChange={(e) => setForm({ ...form, o_que: e.target.value })} rows={2} placeholder="A ação em si" style={{ ...inp, resize: 'vertical' }} />
            </label>
            <label>
              <span style={rotulo}>Por quê<AjudaCampo chave="industrial.plano_acao.por_que" rota={ROTA} /></span>
              <textarea data-testid="campo-por_que" value={form.por_que} onChange={(e) => setForm({ ...form, por_que: e.target.value })} rows={2} placeholder="A razão / justificativa" style={{ ...inp, resize: 'vertical' }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label>
                <span style={rotulo}>Onde<AjudaCampo chave="industrial.plano_acao.onde" rota={ROTA} /></span>
                <input data-testid="campo-onde" value={form.onde} onChange={(e) => setForm({ ...form, onde: e.target.value })} placeholder="Local (texto)" style={inp} />
              </label>
              <label>
                <span style={rotulo}>Setor (opcional)<AjudaCampo chave="industrial.plano_acao.setor" rota={ROTA} /></span>
                <select data-testid="campo-setor" value={form.setor_id} onChange={(e) => setForm({ ...form, setor_id: e.target.value })} style={{ ...inp, padding: '8px 10px' }}>
                  <option value="">—</option>
                  {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label>
                <span style={rotulo}>Quando (prazo)<AjudaCampo chave="industrial.plano_acao.quando" rota={ROTA} /></span>
                <input data-testid="campo-quando" type="date" value={form.quando} onChange={(e) => setForm({ ...form, quando: e.target.value })} style={inp} />
              </label>
              <label>
                <span style={rotulo}>Quem (responsável)<AjudaCampo chave="industrial.plano_acao.quem" rota={ROTA} /></span>
                <input data-testid="campo-quem" value={form.responsavel_nome} onChange={(e) => setForm({ ...form, responsavel_nome: e.target.value })} placeholder="Ex.: João (Manutenção)" style={inp} />
              </label>
            </div>
            <label>
              <span style={rotulo}>Como<AjudaCampo chave="industrial.plano_acao.como" rota={ROTA} /></span>
              <textarea data-testid="campo-como" value={form.como} onChange={(e) => setForm({ ...form, como: e.target.value })} rows={2} placeholder="Método / passos" style={{ ...inp, resize: 'vertical' }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <label>
                <span style={rotulo}>Quanto (estimado)<AjudaCampo chave="industrial.plano_acao.quanto_estimado" rota={ROTA} /></span>
                <input data-testid="campo-custo_estimado" type="number" step="0.01" min="0" value={form.custo_estimado} onChange={(e) => setForm({ ...form, custo_estimado: e.target.value })} placeholder="R$" style={inp} />
              </label>
              <label>
                <span style={rotulo}>Quanto (real)<AjudaCampo chave="industrial.plano_acao.quanto_real" rota={ROTA} /></span>
                <input data-testid="campo-custo_real" type="number" step="0.01" min="0" value={form.custo_real} onChange={(e) => setForm({ ...form, custo_real: e.target.value })} placeholder="R$" style={inp} />
              </label>
              <label>
                <span style={rotulo}>Prioridade<AjudaCampo chave="industrial.plano_acao.prioridade" rota={ROTA} /></span>
                <select data-testid="campo-prioridade" value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Prioridade })} style={{ ...inp, padding: '8px 10px' }}>
                  {(['alta', 'media', 'baixa'] as Prioridade[]).map((p) => <option key={p} value={p}>{PRIORIDADE_ROTULO[p]}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label>
                <span style={rotulo}>Origem<AjudaCampo chave="industrial.plano_acao.origem" rota={ROTA} /></span>
                <select data-testid="campo-origem" value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })} style={{ ...inp, padding: '8px 10px' }}>
                  <option value="">—</option>
                  {(Object.keys(ORIGEM_ROTULO) as Origem[]).map((o) => <option key={o} value={o}>{ORIGEM_ROTULO[o]}</option>)}
                </select>
              </label>
              <label>
                <span style={rotulo}>Referência da origem<AjudaCampo chave="industrial.plano_acao.origem_ref" rota={ROTA} /></span>
                <input data-testid="campo-origem_ref" value={form.origem_ref} onChange={(e) => setForm({ ...form, origem_ref: e.target.value })} placeholder='Ex.: "Ata 14/10" ou "#2734"' style={inp} />
              </label>
              <label>
                <span style={rotulo}>Indicador vinculado<AjudaCampo chave="industrial.plano_acao.indicador_vinculado" rota={ROTA} /></span>
                <input data-testid="campo-indicador" value={form.indicador_vinculado} onChange={(e) => setForm({ ...form, indicador_vinculado: e.target.value })} placeholder="Ex.: Rendimento de carcaça" style={inp} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => setFormAberto(false)} style={btnSec}>Cancelar</button>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <button type="button" data-testid="plano-salvar" onClick={() => void salvar()} disabled={salvando} style={{ ...btnPrim, opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
                <AjudaCampo chave="industrial.plano_acao.salvar" rota={ROTA} />
              </span>
            </div>
          </div>
        </Modal>
      )}

      {concluir && (
        <Modal titulo={`Concluir ${concluir.codigo}`} onFechar={() => setConcluir(null)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 13, color: MUT }}>{concluir.titulo}</div>
            <label>
              <span style={rotulo}>Resultado obtido<AjudaCampo chave="industrial.plano_acao.resultado_obtido" rota={ROTA} /></span>
              <textarea data-testid="campo-resultado" value={resultado} onChange={(e) => setResultado(e.target.value)} rows={3} placeholder="O que a ação entregou (fecha o ciclo PDCA)" style={{ ...inp, resize: 'vertical' }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setConcluir(null)} style={btnSec}>Cancelar</button>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                <button type="button" data-testid="plano-concluir-confirmar" onClick={() => void confirmarConclusao()} style={btnPrim}>Concluir ação</button>
                <AjudaCampo chave="industrial.plano_acao.concluir" rota={ROTA} />
              </span>
            </div>
          </div>
        </Modal>
      )}

      {reuniaoFormAberto && (
        <Modal titulo={reuniaoEditId ? 'Editar reunião' : 'Nova reunião'} onFechar={() => setReuniaoFormAberto(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              <span style={rotulo}>Título<AjudaCampo chave="industrial.plano_acao.reuniao_titulo" rota={ROTA} /></span>
              <input data-testid="reuniao-titulo" value={reuniaoForm.titulo} onChange={(e) => setReuniaoForm({ ...reuniaoForm, titulo: e.target.value })} placeholder="Ex.: Reunião semanal da planta" style={inp} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label>
                <span style={rotulo}>Data e hora<AjudaCampo chave="industrial.plano_acao.reuniao_data" rota={ROTA} /></span>
                <input data-testid="reuniao-data" type="datetime-local" value={reuniaoForm.data_hora} onChange={(e) => setReuniaoForm({ ...reuniaoForm, data_hora: e.target.value })} style={inp} />
              </label>
              <label>
                <span style={rotulo}>Local<AjudaCampo chave="industrial.plano_acao.reuniao_local" rota={ROTA} /></span>
                <input data-testid="reuniao-local" value={reuniaoForm.local} onChange={(e) => setReuniaoForm({ ...reuniaoForm, local: e.target.value })} placeholder="Ex.: Sala de reuniões" style={inp} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label>
                <span style={rotulo}>Dono<AjudaCampo chave="industrial.plano_acao.reuniao_dono" rota={ROTA} /></span>
                <input data-testid="reuniao-dono" value={reuniaoForm.dono_nome} onChange={(e) => setReuniaoForm({ ...reuniaoForm, dono_nome: e.target.value })} placeholder="Ex.: Cleverton" style={inp} />
              </label>
              <label>
                <span style={rotulo}>Status<AjudaCampo chave="industrial.plano_acao.reuniao_status" rota={ROTA} /></span>
                <select data-testid="reuniao-status" value={reuniaoForm.status} onChange={(e) => setReuniaoForm({ ...reuniaoForm, status: e.target.value as StatusReuniao })} style={{ ...inp, padding: '8px 10px' }}>
                  {(Object.keys(STATUS_REUNIAO) as StatusReuniao[]).map((s) => <option key={s} value={s}>{STATUS_REUNIAO[s]}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span style={rotulo}>Participantes<AjudaCampo chave="industrial.plano_acao.reuniao_participantes" rota={ROTA} /></span>
              <textarea data-testid="reuniao-participantes" value={reuniaoForm.participantes} onChange={(e) => setReuniaoForm({ ...reuniaoForm, participantes: e.target.value })} rows={2} placeholder="Um por linha ou separados por vírgula" style={{ ...inp, resize: 'vertical' }} />
            </label>
            <label>
              <span style={rotulo}>Pauta<AjudaCampo chave="industrial.plano_acao.reuniao_pauta" rota={ROTA} /></span>
              <textarea data-testid="reuniao-pauta" value={reuniaoForm.pauta} onChange={(e) => setReuniaoForm({ ...reuniaoForm, pauta: e.target.value })} rows={2} placeholder="Assuntos da reunião" style={{ ...inp, resize: 'vertical' }} />
            </label>
            <label>
              <span style={rotulo}>Ata<AjudaCampo chave="industrial.plano_acao.reuniao_ata" rota={ROTA} /></span>
              <textarea data-testid="reuniao-ata" value={reuniaoForm.ata} onChange={(e) => setReuniaoForm({ ...reuniaoForm, ata: e.target.value })} rows={3} placeholder="O que foi decidido (sai no PDF da ata)" style={{ ...inp, resize: 'vertical' }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => setReuniaoFormAberto(false)} style={btnSec}>Cancelar</button>
              <button type="button" data-testid="reuniao-salvar" onClick={() => void salvarReuniao()} disabled={salvandoReuniao} style={{ ...btnPrim, opacity: salvandoReuniao ? 0.6 : 1 }}>{salvandoReuniao ? 'Salvando…' : 'Salvar reunião'}</button>
            </div>
          </div>
        </Modal>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESP, color: BG, padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>{toast}</div>
      )}
    </div>
  )
}

function Kpi({ chave, titulo, valor, cor, testid }: { chave: string; titulo: string; valor: number | string; cor?: string; testid?: string }) {
  return (
    <div style={CARD} data-testid={testid}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
        {titulo}<AjudaCampo chave={chave} rota={ROTA} />
      </div>
      <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, color: cor ?? ESP, marginTop: 4 }}>{valor}</div>
    </div>
  )
}

function CardAcao({ p, arrastando, onArrastar, onEditar, onStatus, onConcluir, onExcluir }: {
  p: Plano; arrastando: boolean; onArrastar: (on: boolean) => void; onEditar: () => void; onStatus: (s: Status) => void; onConcluir: () => void; onExcluir: () => void
}) {
  const concluida = p.status === 'concluida' || p.status === 'cancelada'
  return (
    <div data-testid="plano-card" data-codigo={p.codigo} draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); onArrastar(true) }} onDragEnd={() => onArrastar(false)}
      style={{ ...CARD, padding: 12, borderLeft: `3px solid ${PRIORIDADE_COR[p.prioridade]}`, display: 'grid', gap: 8, minWidth: 0, cursor: 'grab', opacity: arrastando ? 0.5 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: MUT, fontWeight: 600 }}>{p.codigo}</span>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: PRIORIDADE_COR[p.prioridade], fontWeight: 700 }}>{PRIORIDADE_ROTULO[p.prioridade]}</span>
      </div>
      <button type="button" onClick={onEditar} style={{ all: 'unset', display: 'block', boxSizing: 'border-box', width: '100%', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: ESP, lineHeight: 1.45, whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'left' }}>{p.titulo}</button>
      {p.o_que && norm(p.o_que) !== norm(p.titulo) && (
        <div style={{ fontSize: 12, lineHeight: 1.45, color: MUT, overflowWrap: 'anywhere' }}>{p.o_que}</div>
      )}
      <div style={{ fontSize: 12, lineHeight: 1.5, color: MUT, display: 'flex', alignItems: 'center', gap: '2px 6px', flexWrap: 'wrap', overflowWrap: 'anywhere' }}>
        {(p.setor_nome || p.onde) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MapPin size={12} strokeWidth={1.5} /> {p.setor_nome || p.onde} ·</span>}
        {p.responsavel_nome ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><User size={12} strokeWidth={1.5} /> {p.responsavel_nome}</span> : <span style={{ color: VERM }}>sem responsável</span>}
      </div>
      <div style={{ fontSize: 12, color: p.atrasada ? VERM : MUT, fontWeight: p.atrasada ? 700 : 400, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <CalendarDays size={12} strokeWidth={1.5} /> {dataBR(p.quando)}{p.atrasada ? ' · ATRASADA' : ''}
      </div>
      {(p.custo_estimado != null || p.custo_real != null) && (
        <div style={{ fontSize: 11, color: MUT }}>estimado {brl(p.custo_estimado)}{p.custo_real != null ? ` · real ${brl(p.custo_real)}` : ''}</div>
      )}
      {p.status === 'concluida' && p.resultado_obtido && <div style={{ fontSize: 11, color: '#5B8C5A', display: 'inline-flex', alignItems: 'flex-start', gap: 3 }}><CheckCircle2 size={12} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 1 }} /> {p.resultado_obtido}</div>}
      {!concluida && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          {p.status === 'aberta' && <BtnMini testid="plano-status-andamento" onClick={() => onStatus('em_andamento')}>Iniciar</BtnMini>}
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <BtnMini testid="plano-concluir" onClick={onConcluir}>Concluir</BtnMini>
            <AjudaCampo chave="industrial.plano_acao.concluir" rota={ROTA} />
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <BtnMini testid="plano-cancelar" onClick={() => onStatus('cancelada')}>Cancelar</BtnMini>
            <AjudaCampo chave="industrial.plano_acao.mudar_status" rota={ROTA} />
          </span>
          <BtnMini testid="plano-excluir" onClick={onExcluir}>Excluir</BtnMini>
        </div>
      )}
      {p.status === 'cancelada' && (
        <div style={{ marginTop: 2 }}><BtnMini testid="plano-reabrir" onClick={() => onStatus('aberta')}>Reabrir</BtnMini></div>
      )}
    </div>
  )
}

type ColTab = { k: string; h: string; v: (p: Plano) => string | number }
const COLS_TAB: ColTab[] = [
  { k: 'codigo', h: 'Código', v: (p) => p.codigo },
  { k: 'titulo', h: 'Ação', v: (p) => p.titulo },
  { k: 'por_que', h: 'Por quê', v: (p) => p.por_que ?? '' },
  { k: 'resp', h: 'Responsável', v: (p) => p.responsavel_nome ?? '' },
  { k: 'setor', h: 'Setor / local', v: (p) => p.setor_nome || p.onde || '' },
  { k: 'prazo', h: 'Prazo', v: (p) => p.quando ?? '9999-12-31' },
  { k: 'como', h: 'Como', v: (p) => p.como ?? '' },
  { k: 'estimado', h: 'Estimado', v: (p) => p.custo_estimado ?? -1 },
  { k: 'real', h: 'Real', v: (p) => p.custo_real ?? -1 },
  { k: 'prio', h: 'Prioridade', v: (p) => ({ alta: 0, media: 1, baixa: 2 }[p.prioridade]) },
  { k: 'status', h: 'Status', v: (p) => STATUS_ORDEM.indexOf(p.status) },
]

function TabelaAcoes({ planos, onEditar }: { planos: Plano[]; onEditar: (p: Plano) => void }) {
  const [ord, setOrd] = useState<{ k: string; dir: 1 | -1 }>({ k: 'prazo', dir: 1 })
  const linhas = useMemo(() => {
    const c = COLS_TAB.find((x) => x.k === ord.k) ?? COLS_TAB[0]
    return [...planos].sort((a, b) => {
      const va = c.v(a), vb = c.v(b)
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true })
      return r * ord.dir
    })
  }, [planos, ord])
  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700, borderBottom: `0.5px solid ${LINE}`, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, lineHeight: 1.45, color: ESP, borderBottom: `0.5px solid ${LINE}`, verticalAlign: 'top', overflowWrap: 'anywhere' }
  if (planos.length === 0) return <div data-testid="plano-tabela" style={{ ...CARD, textAlign: 'center', color: MUT, fontSize: 13 }}>Nenhuma ação com esses filtros. Limpe a busca ou crie uma ação em “+ Nova ação”.</div>
  return (
    <div data-testid="plano-tabela" style={{ ...CARD, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
        <thead>
          <tr>{COLS_TAB.map((c) => (
            <th key={c.k} style={th} aria-sort={ord.k === c.k ? (ord.dir === 1 ? 'ascending' : 'descending') : 'none'}>
              <button type="button" data-testid={`plano-ord-${c.k}`} onClick={() => setOrd((o) => ({ k: c.k, dir: o.k === c.k ? (o.dir === 1 ? -1 : 1) : 1 }))}
                style={{ all: 'unset', cursor: 'pointer' }}>{c.h}{ord.k === c.k ? (ord.dir === 1 ? ' ▲' : ' ▼') : ''}</button>
              {c.k === 'codigo' && <AjudaCampo chave="industrial.plano_acao.ordenar" rota={ROTA} />}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {linhas.map((p) => (
            <tr key={p.id} data-testid="plano-linha" data-codigo={p.codigo} style={{ opacity: p.arquivada ? 0.6 : 1 }}>
              <td style={{ ...td, whiteSpace: 'nowrap', color: MUT, fontWeight: 600 }}>{p.codigo}</td>
              <td style={td}>
                <button type="button" onClick={() => onEditar(p)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, color: ESP, lineHeight: 1.45 }}>{p.titulo}</button>
                {p.o_que && norm(p.o_que) !== norm(p.titulo) && <div style={{ fontSize: 12, color: MUT, lineHeight: 1.4, marginTop: 2 }}>{p.o_que}</div>}
              </td>
              <td style={td}>{p.por_que || '—'}</td>
              <td style={td}>{p.responsavel_nome || <span style={{ color: VERM }}>sem responsável</span>}</td>
              <td style={td}>{p.setor_nome || p.onde || '—'}</td>
              <td style={{ ...td, whiteSpace: 'nowrap', color: p.atrasada ? VERM : ESP, fontWeight: p.atrasada ? 700 : 400 }}>{dataBR(p.quando)}{p.atrasada ? ' · ATRASADA' : ''}</td>
              <td style={td}>{p.como || '—'}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{brl(p.custo_estimado)}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{brl(p.custo_real)}</td>
              <td style={{ ...td, color: PRIORIDADE_COR[p.prioridade], fontWeight: 700 }}>{PRIORIDADE_ROTULO[p.prioridade]}</td>
              <td style={td}>{STATUS_ROTULO[p.status]}{p.arquivada ? ' · arquivada' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BtnMini({ children, onClick, testid }: { children: React.ReactNode; onClick: () => void; testid?: string }) {
  return <button type="button" data-testid={testid} onClick={onClick} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: '#FFF', color: ESP, border: `0.5px solid ${LINE}` }}>{children}</button>
}

// Chamado #2862: clicar fora NÃO fecha (perdia o preenchimento) e o overlay fica abaixo do cartão do "?" (z 130).
function Modal({ titulo, children, onFechar }: { titulo: string; children: React.ReactNode; onFechar: () => void }) {
  return (
    <div data-testid="plano-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.35)', zIndex: 120, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
      <div data-testid="plano-form" style={{ background: '#FFF', borderRadius: 14, padding: 20, width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: ESP, margin: 0 }}>{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ all: 'unset', cursor: 'pointer', fontSize: 20, color: MUT, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

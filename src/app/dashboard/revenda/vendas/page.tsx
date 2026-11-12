'use client'

// Revenda de Veículos · R4b — Venda e entrega (Tela 10).
// Passo a passo faturada → checklist → termo → entregue. Entrega passa pelo checklist (obrigatórios).
// "cliente deve / banco deve" = EM ABERTO da fonte única (v_veic_venda ← erp_receber, RD-65).
// Venda entregue: "Registrar devolução" (motivo obrigatório) no lugar de "Cancelar". Paleta PS.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { authFetch } from '@/lib/authFetch'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d: string) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const SIT = ['aberta', 'faturada', 'entregue', 'devolvida', 'cancelada']

// Traduz erro cru do banco/transporte para linguagem do usuário (nunca vaza mensagem técnica).
function msgAmigavel(raw?: string | null): string {
  const s = (raw || '').toLowerCase()
  if (!s) return 'Não foi possível concluir a ação. Tente novamente; se continuar, avise o suporte.'
  if (s.includes('jwt') || s.includes('token') || s.includes('session') || s.includes('expired') || s.includes('refresh')) return 'Sua sessão expirou. Entre novamente para continuar.'
  if (s.includes('permission') || s.includes('row-level') || s.includes('rls') || s.includes('not authorized') || s.includes('denied') || s.includes('policy')) return 'Você não tem acesso a esta informação nesta empresa.'
  if (s.includes('network') || s.includes('failed to fetch') || s.includes('fetch') || s.includes('timeout') || s.includes('timed out')) return 'Falha de conexão. Verifique sua internet e tente novamente.'
  return 'Não foi possível concluir a ação. Tente novamente; se continuar, avise o suporte.'
}

type Venda = {
  id: string; veiculo_id: string; chassi: string; modelo: string | null; placa: string | null; cliente_nome: string | null
  data_venda: string; valor_venda: number | null; desconto_embutido_troca: number | null
  valor_entrada: number | null; valor_financiado: number | null; banco_nome: string | null; retorno_banco: number | null
  situacao: string; total_cliente: number; total_banco: number; vendedor_nome: string | null
  nfe_autorizada: boolean; is_demo: boolean
  em_aberto_cliente: number; em_aberto_banco: number; recebido: number
  tem_checklist: boolean; checklist_ok: boolean; tem_termo: boolean; termo_assinado: boolean
  km_entrega: number | null; devolvido_em: string | null; devolucao_motivo: string | null
}
type ChkItem = { id: string; item: string; obrigatorio: boolean; feito: boolean }
type Acerto = {
  previsto: { preco_venda: number | null; custo_real_total: number | null; lucro_projetado: number | null }
  realizado: { recebido: number; em_aberto: number; em_aberto_cliente: number; em_aberto_banco: number; custos_pos_venda: number; lucro_real: number | null }
}
type NfeVenda = { id: string; numero: string | null; chave: string | null; status: string; danfe_url: string | null; xml_url: string | null; motivo_rejeicao: string | null }
type Receb = { venda_id: string; tipo: string; devedor: string; valor: number; receber_id: string | null; numero: string | null; status: string | null }
// #7641 etapa 2 · resumo da nota montada (apenasPrevia) para o card de conferência.
type PreviaItem = { descricao: string; ncm: string | null; cfop: string | null; cst: string | null; cBenef: string | null; chassi: string | null; icmsBase: number | null; icmsValor: number | null; ibsCbs: { base: number; cbs: number; ibs: number } | null; valorTotal: number }
type PreviaNota = {
  naturezaOperacao: string; serie: string; finalidade: string; consumidorFinal: boolean | null
  destinatario: { razaoSocial: string; documento: string | null; tipoDocumento: string | null; email: string | null; endereco: string | null }
  itens: PreviaItem[]
  totais: { produtos: number; ibsCbs: { base: number; cbs: number; ibs: number } | null }
}

export default function VendasPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [rows, setRows] = useState<Venda[]>([])
  const [filtro, setFiltro] = useState('todos')
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // modais
  const [chkVenda, setChkVenda] = useState<Venda | null>(null)
  const [chkItens, setChkItens] = useState<ChkItem[]>([])
  const [chkKm, setChkKm] = useState('')
  const [termoVenda, setTermoVenda] = useState<Venda | null>(null)
  const [termoMd, setTermoMd] = useState('')
  const [assinaNome, setAssinaNome] = useState('')
  const [acertoVenda, setAcertoVenda] = useState<Venda | null>(null)
  const [acerto, setAcerto] = useState<Acerto | null>(null)
  const [recebs, setRecebs] = useState<Map<string, Receb[]>>(new Map())
  const [cancelaTit, setCancelaTit] = useState<{ venda: Venda; motivo: string; abertos: { id: string; valor: number }[] } | null>(null)
  // Motivo (devolução/cancelamento) coletado por Modal/bottom-sheet do design PS — sem window.prompt() nativo.
  const [motivoModal, setMotivoModal] = useState<{ titulo: string; label: string; obrig: boolean; confirmLabel: string; onConfirm: (motivo: string) => void | Promise<void> } | null>(null)
  const [motivoTxt, setMotivoTxt] = useState('')
  const [motivoErro, setMotivoErro] = useState<string | null>(null)
  // #7641 etapa 2 · card de conferência da NF-e (confere/edita antes de emitir; mantém aberto p/ reenviar em rejeição).
  const [nfeCard, setNfeCard] = useState<{ v: Venda; nota: PreviaNota; infoCpl: string; limite: number; aviso: string | null } | null>(null)
  const [nfeCardBusy, setNfeCardBusy] = useState(false)
  const [nfeCardErro, setNfeCardErro] = useState<string | null>(null)
  // #7641 · status real da NF-e de cada venda (veic_venda.nfe_id → erp_nfe_emitidas).
  const [nfes, setNfes] = useState<Map<string, NfeVenda>>(new Map())
  const [acResumo, setAcResumo] = useState<Map<string, { previsto: number | null; realizado: number | null }>>(new Map())

  // #5684 · Emitir NF-e da venda (Caminho A: mesmo emissor do GE, ligada ao título da venda, grava veic_venda.nfe_id).
  const nfeProcessando = Array.from(nfes.values()).some((n) => n.status === 'processando')
  useEffect(() => {
    if (!nfeProcessando) return
    const t = setInterval(() => { void carregar() }, 8000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nfeProcessando])

  // #7641 etapa 2 · Emitir NF-e passa a abrir um CARD DE CONFERÊNCIA (monta a nota sem emitir, via
  // apenasPrevia), o operador confere/edita o permitido e só então confirma. Reusa o status real da NF-e,
  // DANFE/XML e o link para NFes emitidas (etapa 1) — não duplica.
  const abrirCardEmissao = async (v: Venda) => {
    if (!companyId) return
    setBusy(true); setErro(null); setMsg(null)
    try {
      const res = await authFetch('/api/fiscal/nfe/emitir', { method: 'POST', body: JSON.stringify({ companyId, vendaVeiculoId: v.id, apenasPrevia: true }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.ok === false || !j?.previa?.nota) {
        setErro(`Não foi possível montar a nota para conferência: ${j?.motivoRejeicao ?? j?.mensagem ?? j?.message ?? `erro ${res.status}`}.`)
        return
      }
      setNfeCardErro(null)
      setNfeCard({ v, nota: j.previa.nota as PreviaNota, infoCpl: j.previa.informacoesComplementares ?? '', limite: j.previa.limite ?? 5000, aviso: j.previa.avisoIbpt ?? null })
    } catch (e) {
      setErro(e instanceof Error ? msgAmigavel(e.message) : 'Falha ao montar a nota para conferência')
    } finally {
      setBusy(false)
    }
  }
  const confirmarEmissao = async () => {
    if (!companyId || !nfeCard) return
    const v = nfeCard.v
    setNfeCardBusy(true); setNfeCardErro(null)
    try {
      const res = await authFetch('/api/fiscal/nfe/emitir', { method: 'POST', body: JSON.stringify({ companyId, vendaVeiculoId: v.id, informacoesComplementares: nfeCard.infoCpl }) })
      const j = await res.json().catch(() => ({}))
      if (j?.status === 'processando') {
        setNfeCard(null)
        setMsg('NF-e enviada à SEFAZ. Aguarde: o status aparece no card da venda.')
      } else if (!res.ok || j?.ok === false || j?.status === 'rejeitada') {
        // Mantém o card ABERTO para corrigir e reenviar sem sair (motivo em português).
        setNfeCardErro(`Nota rejeitada: ${j?.motivoRejeicao ?? j?.mensagem ?? j?.message ?? `erro ${res.status}`}. Ajuste as Informações Complementares se for o caso e clique em Reenviar; se o problema estiver no cadastro (destinatário, produto), corrija lá e reenvie.`)
      } else {
        setNfeCard(null)
        const avisos: string[] = Array.isArray(j.avisosVeiculo) ? j.avisosVeiculo : []
        setMsg(`NF-e ${j.numero ?? ''} — ${j.status}${j.ambiente ? ` (${j.ambiente})` : ''}.${avisos.length ? ' Atenção: ' + avisos.join(' ') : ''}`)
      }
    } catch (e) {
      setNfeCardErro(e instanceof Error ? msgAmigavel(e.message) : 'Falha ao emitir a NF-e')
    } finally {
      setNfeCardBusy(false)
      await carregar()
    }
  }

  const carregar = useCallback(async () => {
    if (!companyId) { setRows([]); setRecebs(new Map()); setAcResumo(new Map()); return }
    const { data, error } = await supabase.from('v_veic_venda').select('*').eq('company_id', companyId).order('data_venda', { ascending: false })
    if (error) { setErro(msgAmigavel(error.message)); return }
    const vs = (data as Venda[]) ?? []
    setRows(vs)
    {
      const { data: vn } = await supabase.from('veic_venda').select('id, nfe_id').in('id', vs.map((v) => v.id)).not('nfe_id', 'is', null)
      const link = (vn as { id: string; nfe_id: string }[]) ?? []
      const nm = new Map<string, NfeVenda>()
      if (link.length) {
        const { data: nn } = await supabase.from('erp_nfe_emitidas').select('id, numero, chave, status, danfe_url, xml_url, motivo_rejeicao').in('id', link.map((l) => l.nfe_id))
        const byId = new Map(((nn as NfeVenda[]) ?? []).map((n) => [n.id, n]))
        link.forEach((l) => { const n = byId.get(l.nfe_id); if (n) nm.set(l.id, n) })
      }
      setNfes(nm)
    }
    // Títulos na GE por venda: recebimento ↔ erp_receber (rastreabilidade ponta a ponta, RD-65).
    const ids = vs.map((v) => v.id)
    const m = new Map<string, Receb[]>()
    if (ids.length) {
      const { data: rr } = await supabase.from('veic_venda_recebimento').select('venda_id, tipo, devedor, valor, receber_id').in('venda_id', ids)
      const recs = (rr as { venda_id: string; tipo: string; devedor: string; valor: number; receber_id: string | null }[]) ?? []
      const recIds = recs.map((r) => r.receber_id).filter((x): x is string => !!x)
      const numById = new Map<string, { numero: string | null; status: string | null }>()
      if (recIds.length) {
        const { data: er } = await supabase.from('erp_receber').select('id, numero_documento, status').in('id', recIds)
        ;((er as { id: string; numero_documento: string | null; status: string | null }[]) ?? []).forEach((e) => numById.set(e.id, { numero: e.numero_documento, status: e.status }))
      }
      recs.forEach((r) => {
        const info = r.receber_id ? numById.get(r.receber_id) : null
        const arr = m.get(r.venda_id) ?? []
        arr.push({ venda_id: r.venda_id, tipo: r.tipo, devedor: r.devedor, valor: r.valor, receber_id: r.receber_id, numero: info?.numero ?? null, status: info?.status ?? null })
        m.set(r.venda_id, arr)
      })
    }
    setRecebs(m)
    // Acerto resumo (lucro previsto × realizado) das vendas entregues — sem exigir clique.
    const am = new Map<string, { previsto: number | null; realizado: number | null }>()
    for (const v of vs.filter((x) => x.situacao === 'entregue')) {
      const { data: ac } = await supabase.rpc('fn_veic_venda_acerto', { p_venda_id: v.id })
      const r = ac as ({ ok?: boolean } & Acerto) | null
      if (r?.ok) am.set(v.id, { previsto: r.previsto.lucro_projetado, realizado: r.realizado.lucro_real })
    }
    setAcResumo(am)
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const visiveis = useMemo(() => filtro === 'todos' ? rows : rows.filter((r) => r.situacao === filtro), [rows, filtro])
  async function userId() { const { data: { session } } = await supabase.auth.getSession(); return session?.user?.id ?? null }

  // ── Entrega: abre o checklist ──────────────────────────────────────────────────────────────
  async function abrirChecklist(v: Venda) {
    setErro(null); setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_venda_checklist_materializar', { p_venda_id: v.id, p_user: await userId() })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; itens?: ChkItem[] } | null
    if (error || !r?.ok) { setErro((error ? msgAmigavel(error.message) : null) || r?.erro || 'Falha ao abrir checklist'); return }
    setChkVenda(v); setChkItens(r.itens ?? []); setChkKm(v.km_entrega ? String(v.km_entrega) : '')
  }
  async function marcarItem(it: ChkItem, feito: boolean) {
    setChkItens((xs) => xs.map((x) => x.id === it.id ? { ...x, feito } : x))
    const { data } = await supabase.rpc('fn_veic_checklist_marcar', { p_item_id: it.id, p_feito: feito, p_user: await userId(), p_obs: null })
    const r = data as { ok?: boolean } | null
    if (!r?.ok) { setChkItens((xs) => xs.map((x) => x.id === it.id ? { ...x, feito: !feito } : x)) }
  }
  async function concluirEntrega() {
    if (!chkVenda) return
    setErro(null); setBusy(true)
    const km = chkKm.trim() ? Number(chkKm.replace(/\D/g, '')) : null
    const { data, error } = await supabase.rpc('fn_veic_venda_entregar', { p_venda_id: chkVenda.id, p_user: await userId(), p_obs: null, p_forcar: false, p_km_entrega: km })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; faltando?: string[]; mensagem?: string } | null
    if (error || !r?.ok) {
      if (r?.erro === 'checklist_incompleto') setErro(`Faltam itens obrigatórios: ${(r.faltando ?? []).join(' · ')}`)
      else setErro((error ? msgAmigavel(error.message) : null) || r?.mensagem || r?.erro || 'Falha ao entregar')
      return
    }
    setMsg('Veículo entregue.'); setChkVenda(null); void carregar()
  }

  // ── Termo ──────────────────────────────────────────────────────────────────────────────────
  async function abrirTermo(v: Venda) {
    setErro(null); setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_termo_entrega', { p_venda_id: v.id })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; termo_md?: string } | null
    if (error || !r?.ok) { setErro((error ? msgAmigavel(error.message) : null) || r?.erro || 'Falha ao gerar termo'); return }
    setTermoVenda(v); setTermoMd(r.termo_md ?? ''); setAssinaNome(v.cliente_nome ?? ''); void carregar()
  }
  async function assinarTermo() {
    if (!termoVenda) return
    if (!assinaNome.trim()) { setErro('Informe o nome de quem recebe.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_termo_assinar', { p_venda_id: termoVenda.id, p_nome: assinaNome.trim(), p_ip: null, p_user: await userId() })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro((error ? msgAmigavel(error.message) : null) || r?.erro || 'Falha no aceite'); return }
    setMsg('Aceite registrado.'); setTermoVenda(null); void carregar()
  }

  // ── Acerto de contas ─────────────────────────────────────────────────────────────────────────
  async function abrirAcerto(v: Venda) {
    setErro(null); setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_venda_acerto', { p_venda_id: v.id })
    setBusy(false)
    const r = data as ({ ok?: boolean; erro?: string } & Acerto) | null
    if (error || !r?.ok) { setErro((error ? msgAmigavel(error.message) : null) || r?.erro || 'Falha no acerto'); return }
    setAcertoVenda(v); setAcerto({ previsto: r.previsto, realizado: r.realizado })
  }

  // ── Devolução / cancelamento ───────────────────────────────────────────────────────────────
  function devolver(v: Venda) {
    setMotivoTxt(''); setMotivoErro(null)
    setMotivoModal({ titulo: `Registrar devolução — ${v.modelo || ''}`, label: 'Motivo da devolução', obrig: true, confirmLabel: 'Registrar devolução', onConfirm: (motivo) => executarDevolver(v, motivo) })
  }
  async function executarDevolver(v: Venda, motivo: string) {
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_venda_devolver', { p_venda_id: v.id, p_motivo: motivo, p_data: null, p_user: await userId() })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; titulos_a_estornar?: string[] } | null
    if (error || !r?.ok) { setErro((error ? msgAmigavel(error.message) : null) || r?.erro || 'Falha na devolução'); return }
    const n = (r.titulos_a_estornar ?? []).length
    setMsg(`Devolução registrada. Veículo volta ao pátio. ${n} título(s) marcado(s) a estornar (evento enviado ao financeiro).`)
    void carregar()
  }
  // #6928: títulos do financeiro (GE) ainda em aberto de uma venda. Pago/cancelado nunca entram.
  const ABERTO = ['aberto', 'vencido', 'pendente']
  const titulosAbertos = (vendaId: string) => (recebs.get(vendaId) ?? []).filter((t) => t.receber_id && t.status && ABERTO.includes(t.status))
  const titulosPagos = (vendaId: string) => (recebs.get(vendaId) ?? []).filter((t) => t.receber_id && t.status && !ABERTO.includes(t.status) && t.status !== 'cancelado')

  function cancelar(v: Venda) {
    setMotivoTxt(''); setMotivoErro(null)
    setMotivoModal({ titulo: `Cancelar venda — ${v.modelo || ''}`, label: 'Motivo do cancelamento (opcional)', obrig: false, confirmLabel: 'Continuar', onConfirm: (motivo) => prosseguirCancelar(v, motivo) })
  }
  async function prosseguirCancelar(v: Venda, motivo: string) {
    // Releitura do status dos títulos no banco (a lista da tela pode estar velha).
    const ids = (recebs.get(v.id) ?? []).map((t) => t.receber_id).filter((x): x is string => !!x)
    let abertos: { id: string; valor: number }[] = []
    if (ids.length) {
      const { data: er } = await supabase.from('erp_receber').select('id, valor, status').in('id', ids)
      abertos = ((er as { id: string; valor: number; status: string | null }[]) ?? []).filter((e) => e.status && ABERTO.includes(e.status)).map((e) => ({ id: e.id, valor: Number(e.valor) || 0 }))
    }
    if (abertos.length > 0) { setCancelaTit({ venda: v, motivo, abertos }); return }
    await executarCancelar(v, motivo, [])
  }
  async function executarCancelar(v: Venda, motivo: string, cancelarTitulos: { id: string; valor: number }[]) {
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_veic_venda_cancelar', { p_venda_id: v.id, p_user: await userId(), p_motivo: motivo || null })
    const r = data as { ok?: boolean; erro?: string; mensagem?: string; titulos_nao_excluidos?: number } | null
    if (error || !r?.ok) { setBusy(false); setErro((error ? msgAmigavel(error.message) : null) || r?.mensagem || r?.erro || 'Falha'); return }
    // Venda cancelada. Só então cancela os títulos escolhidos, pela função do financeiro (histórico + auditoria).
    let falhas = 0
    for (const t of cancelarTitulos) {
      const { data: cr, error: ce } = await supabase.rpc('fn_receber_cancelar', { p_id: t.id, p_motivo: `Venda cancelada${motivo ? `: ${motivo}` : ''}` })
      if (ce || !(cr as { sucesso?: boolean } | null)?.sucesso) falhas++
    }
    setBusy(false)
    if (falhas > 0) setErro(`Venda cancelada, mas ${falhas} título(s) não puderam ser cancelados. Cancele no Contas a Receber.`)
    else setMsg(cancelarTitulos.length ? `Venda cancelada e ${cancelarTitulos.length} título(s) do financeiro cancelado(s).` : 'Venda cancelada.')
    void carregar()
  }

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🚗 Comércio · Revenda</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Vendas e entrega</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Cada venda tem um passo a passo até a entrega: fatura → checklist → termo → entregue. &quot;Cliente deve&quot; e &quot;banco deve&quot; são o que está <b>em aberto</b> (o que já foi pago não conta). A entrega exige o checklist dos itens obrigatórios.</p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }} onClick={() => setErro(null)}>{erro}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: C.espM, display: 'inline-flex', alignItems: 'center' }}>Situação&nbsp;
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inp}>
            <option value="todos">todas</option>
            {SIT.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <AjudaCampo chave="revenda.vendas.filtro_situacao" rota="/dashboard/revenda/vendas" />
        </label>
        <span style={{ fontSize: 12, color: C.espM }}>{visiveis.length} venda(s)</span>
      </div>

      {visiveis.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '30px 16px', textAlign: 'center', color: C.espM }}>
          {filtro === 'todos' ? (
            <>
              <div style={{ fontSize: 14, color: C.esp, fontWeight: 600 }}>Nenhuma venda registrada ainda.</div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>A venda começa na ficha do veículo, lá no pátio.</div>
              <button onClick={() => router.push('/dashboard/revenda/patio')} style={{ ...btnGold, marginTop: 14 }}>Registrar venda no pátio</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, color: C.esp, fontWeight: 600 }}>Nenhuma venda {filtro}.</div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>Há vendas registradas, mas nenhuma neste filtro de situação.</div>
              <button onClick={() => setFiltro('todos')} style={{ ...btnGhost, marginTop: 14 }}>Ver todas as vendas</button>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {visiveis.map((v) => {
            const entregue = v.situacao === 'entregue'
            const encerrada = entregue || v.situacao === 'cancelada' || v.situacao === 'devolvida'
            return (
              <div key={v.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{v.modelo || '—'} <span style={{ fontWeight: 400, color: C.espM, fontFamily: 'monospace', fontSize: 12 }}>· {v.placa || v.chassi.slice(-6)}</span></div>
                    <div style={{ fontSize: 13, color: C.espM }}>{v.cliente_nome || '—'} · {brDate(v.data_venda)}{v.vendedor_nome ? ` · vend. ${v.vendedor_nome}` : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.gold }}>{brl(v.valor_venda ?? 0)}</div>
                    <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: entregue ? C.greenBg : v.situacao === 'cancelada' ? C.redBg : v.situacao === 'devolvida' ? C.amberBg : C.cream, color: entregue ? C.green : v.situacao === 'cancelada' ? C.red : v.situacao === 'devolvida' ? C.amber : C.gold, fontWeight: 700 }}>{v.situacao}</span>
                  </div>
                </div>

                {/* passo a passo */}
                <Passos v={v} />

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: C.espM, marginTop: 8 }}>
                  <span>cliente deve <b style={{ color: v.em_aberto_cliente > 0 ? C.esp : C.green }}>{brl(v.em_aberto_cliente)}</b></span>
                  <span>banco deve <b style={{ color: v.em_aberto_banco > 0 ? C.esp : C.green }}>{brl(v.em_aberto_banco)}</b></span>
                  {v.recebido > 0 ? <span>recebido <b style={{ color: C.green }}>{brl(v.recebido)}</b></span> : null}
                  {v.retorno_banco ? <span>retorno banco {brl(v.retorno_banco)}</span> : null}
                  {v.desconto_embutido_troca ? <span style={{ color: C.amber }} title="valor de troca − valor de avaliação">desconto embutido na troca {brl(v.desconto_embutido_troca)}</span> : null}
                  {(v.retorno_banco || v.desconto_embutido_troca) ? <AjudaCampo chave="revenda.vendas.financiamento" rota="/dashboard/revenda/vendas" /> : null}
                  <AjudaCampo chave="revenda.vendas.em_aberto" rota="/dashboard/revenda/vendas" />
                </div>

                {/* Títulos no financeiro (GE): cada recebimento aponta o título gerado no Contas a Receber (RD-65). */}
                {(recebs.get(v.id)?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 8, borderTop: `1px solid ${C.cream}`, paddingTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.6, color: C.espL, fontWeight: 700, marginBottom: 4 }}>Títulos no financeiro (GE)<AjudaCampo chave="revenda.vendas.titulos_ge" rota="/dashboard/revenda/vendas" /></div>
                    <div style={{ display: 'grid', gap: 4 }}>
                      {recebs.get(v.id)!.map((t, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: C.espM }}>
                          <span>{t.tipo} · {t.devedor} · {brl(t.valor)}</span>
                          {t.receber_id
                            ? <>
                                <span style={{ color: t.status === 'pago' ? C.green : t.status === 'vencido' ? C.red : C.espM }}>
                                  título GE {t.numero ? `nº ${t.numero}` : `#${t.receber_id.slice(0, 8)}`}{t.status ? ` · ${t.status}` : ''}
                                </span>
                                <a href={`/dashboard/financeiro/receber?q=${encodeURIComponent(t.numero || t.receber_id)}`} style={{ color: C.gold, textDecoration: 'none', fontWeight: 700 }}>ver</a>
                              </>
                            : <span style={{ color: C.amber }}>sem título na GE</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* #6928: venda cancelada com título ainda aberto no financeiro — aviso em destaque. */}
                {v.situacao === 'cancelada' && titulosAbertos(v.id).length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12.5, color: C.red, background: C.redBg, borderRadius: 8, padding: '8px 10px', fontWeight: 600 }}>
                    Venda cancelada, mas o título do financeiro continua em aberto ({brl(titulosAbertos(v.id).reduce((a, t) => a + (t.valor || 0), 0))}). Use o &quot;ver&quot; acima para tratar no Contas a Receber.
                  </div>
                )}

                {/* Acerto resumo no card entregue — sem exigir clique (o detalhe fica no botão "Acerto de contas"). */}
                {entregue && acResumo.get(v.id) && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    <span style={{ color: C.espM }}>lucro previsto </span>
                    <b>{acResumo.get(v.id)!.previsto != null ? brl(acResumo.get(v.id)!.previsto!) : '—'}</b>
                    <span style={{ color: C.espM }}> · realizado </span>
                    <b style={{ color: (acResumo.get(v.id)!.realizado ?? 0) < 0 ? C.red : C.green }}>{acResumo.get(v.id)!.realizado != null ? brl(acResumo.get(v.id)!.realizado!) : '—'}</b>
                    <AjudaCampo chave="revenda.vendas.acerto_resumo" rota="/dashboard/revenda/vendas" />
                  </div>
                )}

                {v.situacao === 'devolvida' && v.devolucao_motivo ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: C.amber, background: C.amberBg, borderRadius: 8, padding: '6px 10px' }}>Devolvida{v.devolvido_em ? ` em ${brDate(v.devolvido_em)}` : ''}: {v.devolucao_motivo}</div>
                ) : null}

                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={() => router.push(`/dashboard/revenda/veiculo/${v.veiculo_id}`)} style={btnGhost}>ver veículo</button>
                  <AjudaCampo chave="revenda.vendas.acoes" rota="/dashboard/revenda/vendas" />

                  {/* #7641 · status real da NF-e (lido de erp_nfe_emitidas), sem aviso de erro enquanto processa */}
                  {nfes.get(v.id) && (() => {
                    const n = nfes.get(v.id)!
                    const lnk: React.CSSProperties = { color: C.gold, fontWeight: 700, textDecoration: 'none', fontSize: 12 }
                    const ajuda = <AjudaCampo chave="revenda.vendas.nfe_status" rota="/dashboard/revenda/vendas" />
                    if (n.status === 'autorizada') return (
                      <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '4px 10px', borderRadius: 8, background: C.greenBg, color: C.green, fontSize: 12, fontWeight: 600 }} data-testid="venda-nfe-status">
                        Autorizada{n.numero ? ` — nº ${n.numero}` : ''}
                        {n.danfe_url && <a href={n.danfe_url} target="_blank" rel="noreferrer" style={lnk}>Imprimir DANFE</a>}
                        {n.xml_url && <a href={n.xml_url} target="_blank" rel="noreferrer" style={lnk}>Baixar XML</a>}
                        <a href="/dashboard/fiscal/nfe" style={lnk}>Ver em NF-e emitidas</a>
                        {ajuda}
                      </span>
                    )
                    if (n.status === 'processando') return (
                      <span style={{ padding: '4px 10px', borderRadius: 8, background: C.amberBg, color: '#8A4B08', fontSize: 12, fontWeight: 600 }} data-testid="venda-nfe-status">Enviando à SEFAZ… aguarde, a tela atualiza sozinha.{ajuda}</span>
                    )
                    if (n.status === 'rejeitada') return (
                      <span style={{ padding: '4px 10px', borderRadius: 8, background: C.redBg, color: C.red, fontSize: 12, fontWeight: 600 }} data-testid="venda-nfe-status">
                        Nota rejeitada: {n.motivo_rejeicao ?? 'motivo não informado'}. Corrija o cadastro e emita de novo. <a href="/dashboard/fiscal/nfe" style={lnk}>Ver nota</a>{ajuda}
                      </span>
                    )
                    return null
                  })()}

                  {/* Entregar (via checklist) — R0.2/R0.2b travas de NF mantidas na função */}
                  {!encerrada && (
                    v.nfe_autorizada || (v.is_demo && v.situacao === 'faturada')
                      ? <button disabled={busy} onClick={() => void abrirChecklist(v)} style={btnGold}>Entregar</button>
                      : <>
                          <span style={{ padding: '6px 12px', borderRadius: 8, background: C.amberBg, color: '#8A4B08', fontSize: 11.5, fontWeight: 600 }}>Emitir nota antes de entregar</span>
                          <button disabled={busy || nfes.get(v.id)?.status === 'processando'} onClick={() => void abrirCardEmissao(v)} style={btnGold}>Emitir NF-e</button>
                          <AjudaCampo chave="revenda.vendas.emitir_nfe" rota="/dashboard/revenda/vendas" />
                        </>
                  )}
                  {v.is_demo && !encerrada && (v.nfe_autorizada ? null : <span style={{ padding: '3px 8px', borderRadius: 999, background: C.amberBg, color: '#8A4B08', fontSize: 10.5, fontWeight: 700, alignSelf: 'center' }} title="Empresa de demonstração — sem emissão fiscal real">Demonstração — sem nota fiscal real</span>)}

                  {/* Termo — após entregue (ou já com termo) */}
                  {(entregue || v.tem_termo) && <button disabled={busy} onClick={() => void abrirTermo(v)} style={btnGhost}>{v.tem_termo ? (v.termo_assinado ? 'Ver termo (assinado)' : 'Ver/assinar termo') : 'Gerar termo'}</button>}

                  {/* Acerto de contas — venda concluída */}
                  {entregue && <button disabled={busy} onClick={() => void abrirAcerto(v)} style={btnGhost}>Acerto de contas</button>}

                  {/* Devolução (entregue) no lugar de Cancelar */}
                  {entregue
                    ? <button disabled={busy} onClick={() => void devolver(v)} style={btnDanger}>Registrar devolução</button>
                    : (!encerrada && <button disabled={busy} onClick={() => void cancelar(v)} style={btnDanger}>Cancelar</button>)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modal de motivo (devolução / cancelamento) — bottom sheet PS no lugar do window.prompt() ── */}
      {motivoModal && (
        <Modal onClose={() => { setMotivoModal(null); setMotivoErro(null) }} titulo={motivoModal.titulo}>
          <label style={{ display: 'block', fontSize: 12.5, color: C.espM, marginBottom: 6 }}>{motivoModal.label}</label>
          <textarea
            value={motivoTxt}
            onChange={(e) => { setMotivoTxt(e.target.value); if (motivoErro) setMotivoErro(null) }}
            rows={3}
            autoFocus
            placeholder="Descreva o motivo…"
            style={{ ...inp, display: 'block', width: '100%', resize: 'vertical', fontFamily: 'inherit', minHeight: 72 }}
          />
          {motivoErro && <div style={{ fontSize: 12, color: C.red, marginTop: 6 }}>{motivoErro}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={() => { setMotivoModal(null); setMotivoErro(null) }} style={btnGhost}>Voltar</button>
            <button disabled={busy} onClick={() => {
              const t = motivoTxt.trim()
              if (motivoModal.obrig && !t) { setMotivoErro('Informe o motivo para continuar.'); return }
              const cb = motivoModal.onConfirm
              setMotivoModal(null); setMotivoErro(null)
              void cb(t)
            }} style={btnGold}>{motivoModal.confirmLabel}</button>
          </div>
        </Modal>
      )}

      {/* ── Modal #6928: cancelar também o título? ── */}
      {cancelaTit && (
        <Modal onClose={() => setCancelaTit(null)} titulo="Cancelar venda">
          <p style={{ fontSize: 13, color: C.esp, margin: '0 0 8px' }}>
            Esta venda tem <b>{brl(cancelaTit.abertos.reduce((a, t) => a + t.valor, 0))}</b> em título aberto no financeiro. Cancelar também o título?
          </p>
          {titulosPagos(cancelaTit.venda.id).length > 0 && (
            <p style={{ fontSize: 12, color: C.amber, background: C.amberBg, borderRadius: 8, padding: '6px 10px', margin: '0 0 8px' }}>Título já pago não é cancelado: trate no Contas a Receber.</p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button disabled={busy} style={btnGold} onClick={() => { const c = cancelaTit; setCancelaTit(null); void executarCancelar(c.venda, c.motivo, c.abertos) }}>Sim, cancelar venda e título</button>
            <button disabled={busy} style={btnDanger} onClick={() => { const c = cancelaTit; setCancelaTit(null); void executarCancelar(c.venda, c.motivo, []) }}>Não, só a venda</button>
            <button disabled={busy} style={btnGhost} onClick={() => setCancelaTit(null)}>Voltar</button>
          </div>
        </Modal>
      )}

      {/* ── #7641 etapa 2 · Card de conferência da NF-e (confira os dados antes de emitir) ── */}
      {nfeCard && (() => {
        const n = nfeCard.nota
        const linha = (rot: string, val: React.ReactNode) => (
          <div style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
            <span style={{ color: C.espM, minWidth: 128 }}>{rot}</span>
            <span style={{ color: C.esp, fontWeight: 500 }}>{val ?? '—'}</span>
          </div>
        )
        const secTit: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: C.gold, fontWeight: 700, margin: '12px 0 4px' }
        return (
          <Modal onClose={() => { if (!nfeCardBusy) setNfeCard(null) }} titulo={`Conferir NF-e antes de emitir — ${nfeCard.v.modelo || ''}`}>
            <div style={{ fontSize: 12.5, color: C.espM, marginBottom: 6 }}>Confira os dados abaixo. Nada foi enviado ainda — a nota só sai ao clicar em <b>Confirmar e emitir</b>.</div>

            <div style={secTit}>Operação</div>
            {linha('Natureza', n.naturezaOperacao)}
            {linha('Série / Finalidade', `${n.serie || '—'} · ${n.finalidade}`)}
            {linha('Consumidor final', n.consumidorFinal == null ? '—' : (n.consumidorFinal ? 'Sim' : 'Não'))}

            <div style={secTit}>Destinatário</div>
            {linha('Nome', n.destinatario.razaoSocial)}
            {linha(n.destinatario.tipoDocumento || 'Documento', n.destinatario.documento)}
            {linha('E-mail', n.destinatario.email)}
            {linha('Endereço', n.destinatario.endereco)}

            <div style={secTit}>Itens e tributos</div>
            {nfeCard.v.placa && linha('Placa', nfeCard.v.placa)}
            {n.itens.map((it, i) => (
              <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: C.esp, marginBottom: 2 }}>{it.descricao}</div>
                {it.chassi && linha('Chassi', it.chassi)}
                {linha('NCM / CFOP', `${it.ncm || '—'} · CFOP ${it.cfop || '—'}`)}
                {linha('CST / cBenef', `${it.cst || '—'}${it.cBenef ? ` · benef. ${it.cBenef}` : ''}`)}
                {linha('Base / ICMS', `${it.icmsBase != null ? brl(it.icmsBase) : '—'} · ${it.icmsValor != null ? brl(it.icmsValor) : '—'}`)}
                {it.ibsCbs && linha('IBS/CBS', `base ${brl(it.ibsCbs.base)} · CBS ${brl(it.ibsCbs.cbs)} · IBS ${brl(it.ibsCbs.ibs)}`)}
                {linha('Valor', brl(it.valorTotal))}
              </div>
            ))}
            {linha('Total produtos', brl(n.totais.produtos))}
            {n.totais.ibsCbs && linha('Total IBS/CBS', `base ${brl(n.totais.ibsCbs.base)} · CBS ${brl(n.totais.ibsCbs.cbs)} · IBS ${brl(n.totais.ibsCbs.ibs)}`)}

            <div style={secTit}>
              Informações complementares <AjudaCampo chave="revenda.vendas.nfe_info_complementares" rota="/dashboard/revenda/vendas" />
            </div>
            <textarea
              value={nfeCard.infoCpl}
              onChange={(e) => setNfeCard((c) => c ? { ...c, infoCpl: e.target.value } : c)}
              rows={4}
              style={{ ...inp, display: 'block', width: '100%', resize: 'vertical', fontFamily: 'inherit', minHeight: 84 }}
            />
            <div style={{ fontSize: 11, color: nfeCard.infoCpl.length > nfeCard.limite ? C.red : C.espM, marginTop: 4 }}>
              {nfeCard.infoCpl.length}/{nfeCard.limite} caracteres{nfeCard.infoCpl.length > nfeCard.limite ? ' — acima do limite; a nota não sai' : ''}
            </div>
            {nfeCard.aviso && <div style={{ fontSize: 12, color: '#8A4B08', background: C.amberBg, borderRadius: 8, padding: '6px 10px', marginTop: 8 }}>{nfeCard.aviso}</div>}
            {nfeCardErro && <div style={{ fontSize: 12.5, color: C.red, background: C.redBg, borderRadius: 8, padding: '8px 10px', marginTop: 8 }}>{nfeCardErro}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button disabled={nfeCardBusy} onClick={() => setNfeCard(null)} style={btnGhost}>Cancelar</button>
              <button disabled={nfeCardBusy || nfeCard.infoCpl.length > nfeCard.limite} onClick={() => void confirmarEmissao()} style={btnGold}>
                {nfeCardBusy ? 'Enviando…' : (nfeCardErro ? 'Reenviar' : 'Confirmar e emitir')}
              </button>
            </div>
          </Modal>
        )
      })()}

      {/* ── Modal checklist ── */}
      {chkVenda && (
        <Modal onClose={() => setChkVenda(null)} titulo={`Entrega — ${chkVenda.modelo || ''} ${chkVenda.placa || ''}`}>
          <p style={{ fontSize: 12.5, color: C.espM, margin: '0 0 10px' }}>Marque os itens conferidos. Os <b>obrigatórios</b> precisam estar marcados para concluir a entrega.</p>
          <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            {chkItens.map((it) => (
              <label key={it.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 10px', border: `1px solid ${C.border}`, borderRadius: 8, background: it.feito ? C.greenBg : C.white, cursor: 'pointer', fontSize: 13.5 }}>
                <input type="checkbox" checked={it.feito} onChange={(e) => void marcarItem(it, e.target.checked)} style={{ width: 18, height: 18, accentColor: C.gold }} />
                <span style={{ flex: 1 }}>{it.item}</span>
                {it.obrigatorio ? <span style={{ fontSize: 10, color: C.amber, fontWeight: 700 }}>obrigatório</span> : <span style={{ fontSize: 10, color: C.espL }}>opcional</span>}
              </label>
            ))}
          </div>
          <label style={{ display: 'block', fontSize: 12, color: C.espM, marginBottom: 12 }}>KM na entrega
            <input value={chkKm} onChange={(e) => setChkKm(e.target.value)} inputMode="numeric" placeholder="ex.: 71000" style={{ ...inp, display: 'block', width: '100%', marginTop: 4 }} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setChkVenda(null)} style={btnGhost}>fechar</button>
            <button disabled={busy} onClick={() => void concluirEntrega()} style={btnGold}>Concluir entrega</button>
          </div>
        </Modal>
      )}

      {/* ── Modal termo ── */}
      {termoVenda && (
        <Modal onClose={() => setTermoVenda(null)} titulo="Termo de entrega">
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, background: C.cream, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, maxHeight: 340, overflow: 'auto', color: C.esp }}>{termoMd}</pre>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
            <label style={{ fontSize: 12, color: C.espM, flex: 1, minWidth: 180 }}>Aceite — nome de quem recebe
              <input value={assinaNome} onChange={(e) => setAssinaNome(e.target.value)} disabled={termoVenda.termo_assinado} style={{ ...inp, display: 'block', width: '100%', marginTop: 4 }} />
            </label>
            <button onClick={() => window.print()} style={btnGhost}>Imprimir / PDF</button>
            {!termoVenda.termo_assinado && <button disabled={busy} onClick={() => void assinarTermo()} style={btnGold}>Registrar aceite</button>}
          </div>
          {termoVenda.termo_assinado && <div style={{ marginTop: 8, fontSize: 12, color: C.green }}>✓ Aceite já registrado.</div>}
        </Modal>
      )}

      {/* ── Modal acerto ── */}
      {acertoVenda && acerto && (
        <Modal onClose={() => { setAcertoVenda(null); setAcerto(null) }} titulo={`Acerto de contas — ${acertoVenda.modelo || ''}`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ background: C.cream, borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.espM, fontWeight: 700, marginBottom: 6 }}>Previsto<AjudaCampo chave="revenda.vendas.acerto_previsto" rota="/dashboard/revenda/vendas" /></div>
              <Linha k="Preço de venda" v={acerto.previsto.preco_venda} />
              <Linha k="Custo real" v={acerto.previsto.custo_real_total} />
              <Linha k="Lucro projetado" v={acerto.previsto.lucro_projetado} destaque />
            </div>
            <div style={{ background: C.cream, borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.espM, fontWeight: 700, marginBottom: 6 }}>Realizado<AjudaCampo chave="revenda.vendas.acerto_realizado" rota="/dashboard/revenda/vendas" /></div>
              <Linha k="Recebido" v={acerto.realizado.recebido} />
              <Linha k="Em aberto — cliente" v={acerto.realizado.em_aberto_cliente} />
              <Linha k="Em aberto — banco" v={acerto.realizado.em_aberto_banco} />
              <Linha k="Custos após a venda (já no custo real)" v={acerto.realizado.custos_pos_venda} />
              <Linha k="Lucro real" v={acerto.realizado.lucro_real} destaque testid="acerto-lucro-real" />
            </div>
          </div>
          <p style={{ fontSize: 12, color: C.espM, marginTop: 10 }}>O lucro real conta só o que já entrou: o que ainda está em aberto (cliente e banco, inclusive o retorno do banco) entra quando for pago. Os custos lançados depois da venda já estão dentro do custo real — aparecem à parte só para conferência.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button onClick={() => { setAcertoVenda(null); setAcerto(null) }} style={btnGhost}>fechar</button></div>
        </Modal>
      )}
    </div>
  )
}

function Passos({ v }: { v: Venda }) {
  const entregue = v.situacao === 'entregue'
  const passos: { nome: string; feito: boolean; atual: boolean }[] = [
    { nome: 'Faturada', feito: ['faturada', 'entregue', 'devolvida'].includes(v.situacao) || v.nfe_autorizada, atual: v.situacao === 'aberta' },
    { nome: 'Checklist', feito: v.tem_checklist && v.checklist_ok && (entregue || v.tem_checklist), atual: !entregue && (!v.tem_checklist || !v.checklist_ok) },
    { nome: 'Termo', feito: v.tem_termo, atual: entregue && !v.tem_termo },
    { nome: 'Entregue', feito: entregue, atual: false },
  ]
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      {passos.map((p, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
          background: p.feito ? C.greenBg : p.atual ? C.amberBg : C.cream,
          color: p.feito ? C.green : p.atual ? C.amber : C.espL }}>
          <span>{p.feito ? '✓' : p.atual ? '•' : '○'}</span>{p.nome}
        </span>
      ))}
      <AjudaCampo chave="revenda.vendas.passos" rota="/dashboard/revenda/vendas" />
    </div>
  )
}

function Linha({ k, v, destaque, testid }: { k: string; v: number | null; destaque?: boolean; testid?: string }) {
  return (
    <div data-testid={testid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderTop: destaque ? `1px solid ${C.border}` : 'none', marginTop: destaque ? 4 : 0, fontWeight: destaque ? 700 : 400 }}>
      <span style={{ color: C.espM }}>{k}</span>
      <span style={{ color: v == null ? C.espL : (destaque && (v ?? 0) < 0 ? C.red : C.esp) }}>{v == null ? 'não configurado' : brl(v)}</span>
    </div>
  )
}

function Modal({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50, padding: '0' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, width: '100%', maxWidth: 560, borderRadius: '16px 16px 0 0', padding: 18, maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{titulo}</div>
          <button onClick={onClose} style={{ ...btnGhost, padding: '4px 10px' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const btnGold: React.CSSProperties = { padding: '8px 14px', border: 'none', borderRadius: 8, background: C.gold, color: C.white, fontWeight: 700, cursor: 'pointer', fontSize: 12.5 }
const btnGhost: React.CSSProperties = { padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.gold, cursor: 'pointer', fontSize: 12.5 }
const btnDanger: React.CSSProperties = { padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.red, cursor: 'pointer', fontSize: 12.5 }

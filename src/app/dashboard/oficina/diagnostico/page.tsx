'use client'
// OFICINA · DIAGNÓSTICO TÉCNICO (laudo do mecânico). Mobile-first (o mecânico usa celular).
// Escolhe a OS do pátio → registra causa provável + itens (serviços do tempário + peças) + severidade.
// 🚫 SEM preço, SEM financeiro, SEM mudar status — só o laudo técnico (RD: financeiro é da GE).
import React, { useEffect, useState, useCallback, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Stethoscope, ChevronLeft, Plus, Trash2, Search, Wrench, Package, Check, Camera, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PlacaInline } from '../_components/PlacaInline'
import SolicitarPecaModal from '@/components/oficina/SolicitarPecaModal'
import { useOficinaRamo } from '@/lib/oficina/ramo'

const BUCKET = 'oficina-recepcao'   // RD-26 · mesmo bucket/mecanismo da recepção (#831)
// comprime a foto no celular/tablet antes de subir (mesmo padrão da recepção)
async function comprimirImagem(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const MAX = 1600
    let { width, height } = bitmap
    if (width > MAX || height > MAX) { const r = Math.min(MAX / width, MAX / height); width = Math.round(width * r); height = Math.round(height * r) }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d'); if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.7))
  } catch { return file }
}
type FotoDiag = { id: string; foto_path: string; descricao: string | null; criado_por_nome: string | null; _url?: string | null }

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534'; const RED = '#A32D2D'; const AMBER = '#B45309'
const SEVERIDADES = [
  { v: 'critico', l: 'Crítico', c: RED },
  { v: 'recomendado', l: 'Recomendado', c: AMBER },
  { v: 'futuro', l: 'Futuro', c: ESP60 },
]

type ItemLaudo = {
  id?: string | null    // RD-55 · id do item p/ UPSERT (preserva preco/aprovado no salvar)
  tipo: 'servico' | 'peca'; servico_id?: string | null; produto_id?: string | null; descricao: string
  quantidade?: string; tempo_estimado_h?: string; severidade: string; observacao?: string
  _estoque?: number | null; _codigo?: string | null    // só p/ exibição (peça do catálogo)
  // RD-41 · orçamento operacional (vem da RPC pós-aprovação; SEMPRE presente no dado)
  preco?: number | null; subtotal?: number | null; status_item?: string; aprovado?: boolean | null
}
type Resumo = { total_aprovado: number; total_geral: number; qtd_aprovados: number; qtd_pendentes: number; qtd_recusados: number }
const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
type OSLinha = { id: string; numero: string; cliente_nome: string | null; placa: string | null; marca: string | null; modelo: string | null; status: string; defeito_relatado: string | null; tem_laudo?: boolean }
type Tempario = { id: string; codigo: string | null; nome: string; tempo_padrao_h: number | null }
type Peca = { id: string; codigo: string | null; nome: string; marca: string | null; unidade: string | null; preco_venda: number | null; estoque_atual: number | null; status_estoque: string | null }

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

export default function DiagnosticoPage() {
  const companyId = useCompanyId()
  const { config: ramo } = useOficinaRamo(companyId)   // RD-41 · texto coerente por ramo
  const router = useRouter()
  const [lista, setLista] = useState<OSLinha[]>([])
  const [osSel, setOsSel] = useState<OSLinha | null>(null)
  const [diagnostico, setDiagnostico] = useState('')
  const [km, setKm] = useState('')
  const [itens, setItens] = useState<ItemLaudo[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)   // RD-41 · total aprovado/geral da OS
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // busca no tempário
  const [buscaServ, setBuscaServ] = useState('')
  const [sugestoes, setSugestoes] = useState<Tempario[]>([])
  // busca de peça no catálogo/estoque
  const [buscaPeca, setBuscaPeca] = useState('')
  const [sugestoesPeca, setSugestoesPeca] = useState<Peca[]>([])
  // RD-26 · gerar cotação de compra a partir do diagnóstico (ponte p/ Compras/GE)
  const [cotarAberto, setCotarAberto] = useState(false)
  const [cotarSel, setCotarSel] = useState<Set<string>>(new Set())
  const [gerandoCot, setGerandoCot] = useState(false)
  // Item 2 · após gerar a cotação, convidar fornecedores (dispatch [→GE]). 2ª fase do mesmo modal.
  const [cotacaoCriada, setCotacaoCriada] = useState<{ id: string; numero: string } | null>(null)
  const [fornecedores, setFornecedores] = useState<{ id: string; nome: string; local: string | null }[]>([])
  const [convidarSel, setConvidarSel] = useState<Set<string>>(new Set())
  const [buscaFornec, setBuscaFornec] = useState('')
  const [convidando, setConvidando] = useState(false)
  const [solicitarAberto, setSolicitarAberto] = useState(false)  // R5 · modal solicitar peça ao dono
  // RD-41 · fotos do diagnóstico (reusa erp_os_registro_foto, etapa='diagnostico')
  const [fotosDiag, setFotosDiag] = useState<FotoDiag[]>([])
  const [fotoPend, setFotoPend] = useState<{ path: string; url?: string | null; descricao: string } | null>(null)
  const [subindoFoto, setSubindoFoto] = useState(false)
  const [fotoZoom, setFotoZoom] = useState<string | null>(null)   // lightbox: abrir foto em tamanho grande ao clicar

  const carregarFotos = useCallback(async (osId: string) => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_registro_listar', { p_company_id: companyId, p_os_id: osId, p_etapa: 'diagnostico' })
    const regs = (data as FotoDiag[]) ?? []
    const comUrl = await Promise.all(regs.map(async (r) => {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(r.foto_path, 3600)
      return { ...r, _url: s?.signedUrl ?? null }
    }))
    setFotosDiag(comUrl)
  }, [companyId])

  const carregarLista = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_os_fila', { p_company_id: companyId, p_etapa: 'diagnostico' })
    setLista((data as OSLinha[]) ?? [])
  }, [companyId])
  const setPlacaLocal = (osId: string, placa: string) => setLista((p) => p.map((o) => (o.id === osId ? { ...o, placa } : o)))

  useEffect(() => { void carregarLista() }, [carregarLista])

  const abrirOS = async (os: OSLinha) => {
    if (!companyId) return
    setOsSel(os); setFotoPend(null); setFotosDiag([]); void carregarFotos(os.id)
    const { data } = await supabase.rpc('fn_oficina_diagnostico_obter', { p_company_id: companyId, p_os_id: os.id })
    const d = data as { os?: { diagnostico?: string; km?: number }; itens?: (ItemLaudo & { preco?: number; subtotal?: number; status_item?: string })[]; resumo?: Resumo } | null
    setDiagnostico(d?.os?.diagnostico ?? '')
    setKm(d?.os?.km ? String(d.os.km) : '')
    setResumo(d?.resumo ?? null)
    setItens((d?.itens ?? []).map((i) => ({
      id: i.id ?? null,
      tipo: i.tipo === 'peca' ? 'peca' : 'servico', servico_id: i.servico_id ?? null, produto_id: i.produto_id ?? null,
      descricao: i.descricao ?? '', quantidade: i.quantidade != null ? String(i.quantidade) : '1',
      tempo_estimado_h: i.tempo_estimado_h != null ? String(i.tempo_estimado_h) : '',
      severidade: i.severidade ?? 'recomendado', observacao: i.observacao ?? '',
      preco: i.preco ?? null, subtotal: i.subtotal ?? null, status_item: i.status_item, aprovado: i.aprovado ?? null,
    })))
  }

  // busca no tempário (debounce simples)
  useEffect(() => {
    if (!companyId || buscaServ.trim().length < 2) { setSugestoes([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('erp_oficina_servicos')
        .select('id, codigo, nome, tempo_padrao_h')
        .eq('company_id', companyId).eq('ativo', true).eq('excluida', false)
        .ilike('nome', `%${buscaServ.trim()}%`).order('nome').limit(8)
      setSugestoes((data as Tempario[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [buscaServ, companyId])

  const addServicoTempario = (s: Tempario) => {
    setItens((p) => [...p, { tipo: 'servico', servico_id: s.id, descricao: s.nome, quantidade: '1', tempo_estimado_h: s.tempo_padrao_h != null ? String(s.tempo_padrao_h) : '', severidade: 'recomendado' }])
    setBuscaServ(''); setSugestoes([])
  }

  // busca de peça no catálogo/estoque (debounce)
  useEffect(() => {
    if (!companyId || buscaPeca.trim().length < 2) { setSugestoesPeca([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('fn_oficina_pecas_buscar', { p_company_id: companyId, p_termo: buscaPeca.trim() })
      setSugestoesPeca((data as Peca[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [buscaPeca, companyId])

  const addPecaCatalogo = (p: Peca) => {
    setItens((prev) => [...prev, { tipo: 'peca', produto_id: p.id, descricao: p.nome, quantidade: '1', severidade: 'recomendado', _estoque: p.estoque_atual, _codigo: p.codigo }])
    setBuscaPeca(''); setSugestoesPeca([])
  }
  const addLinha = (tipo: 'servico' | 'peca') => setItens((p) => [...p, { tipo, descricao: '', quantidade: '1', tempo_estimado_h: '', severidade: 'recomendado' }])
  const setItem = (i: number, patch: Partial<ItemLaudo>) => setItens((p) => p.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  const delItem = (i: number) => setItens((p) => p.filter((_, idx) => idx !== i))

  // captura a foto (comprime + sobe pro bucket) → fica pendente pra descrever e salvar
  const onFotoDiag = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = Array.from(e.target.files ?? []).find((f) => f.type.startsWith('image/'))
    e.target.value = ''
    if (!file || !companyId || !osSel) return
    setSubindoFoto(true)
    const blob = await comprimirImagem(file)
    const path = `${companyId}/diagnostico/${osSel.id}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) { setSubindoFoto(false); setMsg('❌ Falha ao subir a foto — tente de novo.'); return }
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    setFotoPend({ path, url: signed?.signedUrl, descricao: '' }); setSubindoFoto(false)
  }
  // salva o registro da foto (etapa='diagnostico') — aparece na impressão (#843)
  const salvarFotoDiag = async () => {
    if (!companyId || !osSel || !fotoPend) return
    const desc = fotoPend.descricao.trim() || 'Foto do diagnóstico'
    const { data } = await supabase.rpc('fn_oficina_registro_salvar', {
      p_company_id: companyId, p_os_id: osSel.id, p_foto_path: fotoPend.path, p_descricao: desc, p_etapa: 'diagnostico',
    })
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setMsg('❌ ' + (r?.erro ?? 'Falha ao salvar a foto')); return }
    setFotoPend(null); setMsg('📷 Foto do diagnóstico salva'); void carregarFotos(osSel.id)
  }
  // exclui a foto (pedido Gean) — RPC com guard de company; a foto some do histórico/impressão, então confirma.
  // A RPC apaga a linha e devolve foto_path; o arquivo do storage é removido no mesmo bucket do upload.
  const excluirFoto = async (f: FotoDiag) => {
    if (!companyId || !osSel) return
    if (!confirm('Excluir esta foto?\n\nEla sai do histórico fotográfico da OS (some também da impressão).')) return
    const { data, error } = await supabase.rpc('fn_os_foto_excluir', { p_id: f.id })
    const r = data as { sucesso?: boolean; erro?: string; foto_path?: string } | null
    if (error || !r?.sucesso) {
      const m = r?.erro === 'sem_acesso' ? 'Sem permissão para excluir esta foto.'
        : r?.erro === 'foto_inexistente' ? 'Foto já removida.'
        : (error?.message ?? r?.erro ?? 'Falha ao excluir a foto')
      setMsg('❌ ' + m); return
    }
    setFotosDiag((prev) => prev.filter((x) => x.id !== f.id)) // some da tela na hora
    if (r.foto_path) { await supabase.storage.from(BUCKET).remove([r.foto_path]) } // remove o arquivo (a RPC só apaga a linha)
    setMsg('🗑 Foto excluída')
  }

  const salvar = async () => {
    if (!companyId || !osSel) return
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_oficina_diagnostico_salvar', {
      p_company_id: companyId, p_os_id: osSel.id,
      p_dados: { diagnostico, km, itens: itens.filter((i) => i.descricao.trim().length > 0).map((i) => ({
        id: i.id ?? null,    // RD-55 · item existente atualiza SÓ o laudo (preco/aprovado intocados); sem id = novo
        tipo: i.tipo, servico_id: i.servico_id ?? null, produto_id: i.produto_id ?? null,
        descricao: i.descricao, quantidade: i.quantidade, tempo_estimado_h: i.tempo_estimado_h,
        severidade: i.severidade, observacao: i.observacao ?? null,
      })) },
    })
    setSalvando(false)
    const j = data as { ok?: boolean; erro?: string; itens?: number } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    setMsg(`✅ Laudo salvo — ${j?.itens ?? 0} item(ns). Próximo: aprovação do cliente.`)
    await carregarLista()
    setTimeout(() => setOsSel(null), 1400)
  }

  // ── RD-26 · Gerar cotação de compra a partir do diagnóstico (ponte p/ Compras/GE [→GE]) ──
  // Só PEÇAS salvas (com id). Pré-marca o que precisa comprar: item livre (sem produto_id) ou catálogo sem saldo.
  // Serviço/mão de obra nunca entra. A cotação cai na tela de comparação de fornecedores que já existe.
  const pecasCotaveis = () => itens.filter((i) => i.tipo === 'peca' && !!i.id && i.descricao.trim().length > 0)
  const abrirCotar = () => {
    const pecas = pecasCotaveis()
    if (pecas.length === 0) { setMsg('Salve o laudo e adicione peças antes de gerar a cotação.'); return }
    const pre = new Set(pecas.filter((p) => !p.produto_id || (p._estoque ?? 0) <= 0).map((p) => p.id as string))
    setCotarSel(pre); setCotarAberto(true)
  }
  const gerarCotacao = async () => {
    if (!osSel) return
    const ids = Array.from(cotarSel)
    if (ids.length === 0) { setMsg('Marque ao menos uma peça para cotar.'); return }
    setGerandoCot(true)
    const { data, error } = await supabase.rpc('fn_os_diagnostico_gerar_cotacao', { p_os_id: osSel.id, p_itens_ids: ids })
    setGerandoCot(false)
    const j = data as { sucesso?: boolean; erro?: string; msg?: string; cotacao_id?: string; numero?: string; itens?: number } | null
    if (error || j?.sucesso === false || !j?.cotacao_id) { setMsg('❌ ' + (error?.message || j?.msg || j?.erro || 'falha ao gerar cotação')); return }
    // Fica no modal e passa à 2ª fase: convidar fornecedores para esta cotação (dispatch [→GE]).
    setCotacaoCriada({ id: j.cotacao_id, numero: j.numero ?? '' })
    setConvidarSel(new Set()); setBuscaFornec('')
    setMsg(`✅ Cotação ${j?.numero ?? ''} criada (${j?.itens ?? 0} peça(s)). Convide fornecedores ou vá para Compras.`)
    void carregarFornecedores()
  }

  // Fornecedores ativos da empresa (multiselect do convite). Nome = nome_fantasia || razao_social.
  const carregarFornecedores = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase
      .from('erp_fornecedores').select('id, nome_fantasia, razao_social, cidade_estado')
      .eq('company_id', companyId).eq('ativo', true)
      .order('nome_fantasia', { ascending: true, nullsFirst: false }).limit(500)
    setFornecedores((data ?? []).map((f) => ({
      id: f.id as string,
      nome: (f.nome_fantasia || f.razao_social || '(sem nome)') as string,
      local: (f.cidade_estado ?? null) as string | null,
    })))
  }, [companyId])

  const convidarFornecedores = async () => {
    if (!cotacaoCriada) return
    const ids = Array.from(convidarSel)
    if (ids.length === 0) { setMsg('Marque ao menos um fornecedor para convidar.'); return }
    setConvidando(true)
    const { data, error } = await supabase.rpc('fn_cotacao_convidar_fornecedores', { p_cotacao_id: cotacaoCriada.id, p_fornecedor_ids: ids })
    setConvidando(false)
    const j = data as { ok?: boolean; erro?: string; convidados?: number } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro || 'falha ao convidar')); return }
    fecharCotar()
    setMsg(`✅ ${j?.convidados ?? ids.length} fornecedor(es) convidado(s) para a cotação ${cotacaoCriada.numero}. Compare as propostas em Compras › Cotações.`)
    setTimeout(() => router.push('/dashboard/commerce/compras'), 1000)
  }

  const fecharCotar = () => { setCotarAberto(false); setCotacaoCriada(null); setFornecedores([]); setConvidarSel(new Set()); setBuscaFornec('') }

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para abrir o Diagnóstico.</div>

  // LISTA de OS (escolher qual diagnosticar)
  if (!osSel) return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 40px' }}>
        <button onClick={() => router.push('/dashboard/oficina/patio')} style={linkBtn}><ChevronLeft size={16} /> Pátio</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Diagnóstico</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Stethoscope size={22} /> Qual {ramo.objetoLabelCurto} diagnosticar?</h1>
        {lista.length === 0 && <div style={{ color: ESP60, fontSize: 14, padding: '20px 0' }}>{ramo.automotivo ? 'Nenhum veículo ativo no pátio.' : 'Nada ativo no pátio.'} Faça a recepção primeiro.</div>}
        {lista.map((os) => (
          <div key={os.id} onClick={() => void abrirOS(os)} style={{ width: '100%', textAlign: 'left', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <PlacaInline companyId={companyId} osId={os.id} placa={os.placa} onSaved={(p) => setPlacaLocal(os.id, p)} />
              <span style={{ fontSize: 11, color: ESP60 }}>{os.numero}</span>
            </div>
            <div style={{ fontSize: 13, color: ESP, marginTop: 3 }}>{[os.marca, os.modelo].filter(Boolean).join(' ') || ramo.objetoLabel}{os.cliente_nome ? ` · ${os.cliente_nome}` : ''}</div>
            {os.defeito_relatado && <div style={{ fontSize: 12, color: ESP60, marginTop: 4 }}>“{os.defeito_relatado}”</div>}
            {os.tem_laudo && <div style={{ fontSize: 11, fontWeight: 700, color: OK, marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={13} /> já tem laudo — toque p/ editar</div>}
          </div>
        ))}
      </div>
      {msg && <Toast>{msg}</Toast>}
    </div>
  )

  // FORMULÁRIO do laudo
  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 96px' }}>
        <button onClick={() => setOsSel(null)} style={linkBtn}><ChevronLeft size={16} /> Trocar {ramo.objetoLabelCurto}</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Diagnóstico · {osSel.numero}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 4px' }}>{osSel.placa} · {osSel.marca} {osSel.modelo}</h1>
        {osSel.defeito_relatado && <div style={{ fontSize: 13, color: ESP60, marginBottom: 12 }}>Queixa do cliente: “{osSel.defeito_relatado}”</div>}

        <Sec titulo={ramo.automotivo ? 'Causa provável (o que o carro tem)' : 'Causa provável (o que foi constatado)'}>
          <textarea value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} rows={3} placeholder="Ex.: barulho ao frear — pastilha dianteira gasta e disco com sulco." style={{ ...inp, resize: 'vertical' }} />
          <Campo l="KM confirmado"><input value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={inp} /></Campo>
        </Sec>

        <Sec titulo="Serviços & peças necessárias">
          {/* busca no tempário */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 10, padding: '0 10px', background: '#fff' }}>
              <Search size={16} color={ESP60} />
              <input value={buscaServ} onChange={(e) => setBuscaServ(e.target.value)} placeholder="Buscar serviço no tempário…" style={{ ...inp, border: 'none', padding: '10px 0' }} />
            </div>
            {sugestoes.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, marginTop: 4, boxShadow: '0 6px 18px rgba(0,0,0,0.08)' }}>
                {sugestoes.map((s) => (
                  <button key={s.id} onClick={() => addServicoTempario(s)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{s.nome}</span>
                    {s.tempo_padrao_h != null && <span style={{ fontSize: 12, color: GOLD, fontWeight: 700 }}>{s.tempo_padrao_h}h</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* busca de peça no catálogo/estoque */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 10, padding: '0 10px', background: '#fff' }}>
              <Package size={16} color={ESP60} />
              <input value={buscaPeca} onChange={(e) => setBuscaPeca(e.target.value)} placeholder="Buscar peça no estoque (código/nome)…" style={{ ...inp, border: 'none', padding: '10px 0' }} />
            </div>
            {sugestoesPeca.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, marginTop: 4, boxShadow: '0 6px 18px rgba(0,0,0,0.08)', maxHeight: 260, overflowY: 'auto' }}>
                {sugestoesPeca.map((p) => (
                  <button key={p.id} onClick={() => addPecaCatalogo(p)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer' }}>
                    {/* 🚫 SEM preço na tela do mecânico (R4) — R$ fica só na Aprovação/Orçamento. Aqui: nome + estoque. */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{p.nome}</span>
                    </div>
                    <div style={{ fontSize: 11, color: ESP60, marginTop: 2 }}>
                      {p.codigo ? `${p.codigo} · ` : ''}estoque {p.estoque_atual != null ? Number(p.estoque_atual) : '—'} {p.unidade ?? ''}
                      {p.status_estoque && p.status_estoque !== 'ok' ? ` · ${p.status_estoque}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* R5 · mecânico solicita peça ao dono (foto + qtd, sem preço) → alerta pro dono decidir */}
          <button onClick={() => setSolicitarAberto(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: `1px dashed ${GOLD}`, background: 'rgba(200,148,26,0.06)', color: ESP, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            <Package size={16} color={GOLD} /> Solicitar peça ao dono
          </button>

          {itens.map((it, i) => (
            <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, marginBottom: 10, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: it.tipo === 'peca' ? GOLD : ESP, display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {it.tipo === 'peca' ? <><Package size={14} /> Peça</> : <><Wrench size={14} /> Serviço</>}
                  {it.tipo === 'peca' && it.produto_id && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: OK, background: 'rgba(22,101,52,0.08)', borderRadius: 6, padding: '2px 6px' }}>
                      catálogo{it._estoque != null ? ` · estoque ${Number(it._estoque)}` : ''}
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {/* RD-41 · valor SEMPRE à vista pós-aprovação. recusado = sem valor (só indicação). */}
                  {it.status_item === 'recusado' ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: ESP60 }}>recusado</span>
                  ) : it.preco != null ? (
                    <span style={{ fontSize: 13, fontWeight: 800, color: it.status_item === 'aprovado' ? OK : GOLD, whiteSpace: 'nowrap' }}>
                      {brl(it.subtotal ?? it.preco)}{it.status_item === 'aprovado' ? ' ✓' : it.status_item === 'pendente' ? ' · aguardando' : ''}
                    </span>
                  ) : null}
                  <button onClick={() => delItem(i)} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', padding: 4 }}><Trash2 size={16} /></button>
                </div>
              </div>
              <input value={it.descricao} onChange={(e) => setItem(i, { descricao: e.target.value })} placeholder={it.tipo === 'peca' ? 'Qual peça?' : 'Qual serviço?'} style={{ ...inp, marginBottom: 8 }} />
              <div style={{ display: 'grid', gridTemplateColumns: it.tipo === 'peca' ? '1fr' : '1fr 1fr', gap: 8, marginBottom: 8 }}>
                {it.tipo === 'peca'
                  ? <Campo l="Qtd"><input value={it.quantidade} onChange={(e) => setItem(i, { quantidade: e.target.value.replace(/[^\d.,]/g, '') })} inputMode="decimal" style={inp} /></Campo>
                  : <Campo l="Tempo estimado (h)"><input value={it.tempo_estimado_h} onChange={(e) => setItem(i, { tempo_estimado_h: e.target.value.replace(/[^\d.,]/g, '') })} inputMode="decimal" style={inp} /></Campo>}
                {it.tipo === 'servico' && <Campo l="Qtd"><input value={it.quantidade} onChange={(e) => setItem(i, { quantidade: e.target.value.replace(/[^\d.,]/g, '') })} inputMode="decimal" style={inp} /></Campo>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SEVERIDADES.map((s) => (
                  <button key={s.v} onClick={() => setItem(i, { severidade: s.v })} style={{ ...chip, borderColor: it.severidade === s.v ? s.c : LINE, background: it.severidade === s.v ? s.c : '#fff', color: it.severidade === s.v ? '#fff' : s.c }}>{s.l}</button>
                ))}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => addLinha('servico')} style={{ ...btnLine, flex: 1 }}><Plus size={15} /> Serviço</button>
            <button onClick={() => addLinha('peca')} style={{ ...btnLine, flex: 1 }}><Plus size={15} /> Peça</button>
          </div>

          {/* RD-41 · total do orçamento (operacional; faturamento continua [→GE]) */}
          {resumo && (resumo.qtd_aprovados > 0 || resumo.qtd_pendentes > 0 || resumo.qtd_recusados > 0) && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${LINE}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: ESP60 }}>
                {resumo.qtd_aprovados} aprovado(s){resumo.qtd_pendentes ? ` · ${resumo.qtd_pendentes} aguardando` : ''}{resumo.qtd_recusados ? ` · ${resumo.qtd_recusados} recusado(s)` : ''}
              </span>
              <span style={{ fontSize: 16, fontWeight: 800, color: OK }}>Total aprovado {brl(resumo.total_aprovado)}</span>
            </div>
          )}
        </Sec>

        {/* RD-41 · Fotos do diagnóstico (tablet do mecânico) — entram no histórico fotográfico da impressão (#843) */}
        <Sec titulo={ramo.automotivo ? 'Fotos do diagnóstico' : `Fotos da ${ramo.objetoLabelCurto}`}>
          <label style={{ ...btnGold, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', width: 'auto' }}>
            <Camera size={18} /> {subindoFoto ? 'Enviando…' : 'Tirar / anexar foto'}
            <input type="file" accept="image/*" capture="environment" onChange={onFotoDiag} style={{ display: 'none' }} />
          </label>
          <div style={{ fontSize: 11, color: ESP60, marginTop: 6 }}>Ex.: peça com defeito, vazamento, desgaste. Aparecem na impressão da OS (histórico fotográfico).</div>

          {fotoPend && (
            <div style={{ marginTop: 10, border: `1px solid ${GOLD}`, borderRadius: 10, padding: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {fotoPend.url && <img src={fotoPend.url} alt="foto do diagnóstico" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <input value={fotoPend.descricao} onChange={(e) => setFotoPend((p) => (p ? { ...p, descricao: e.target.value } : p))} placeholder="Descreva a foto (ex.: pastilha gasta)" style={{ ...inp, padding: '9px 11px', fontSize: 13 }} autoFocus />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button onClick={() => void salvarFotoDiag()} style={{ ...btnGold, flex: 1, padding: '9px 12px', fontSize: 13 }}>Salvar foto</button>
                  <button onClick={() => setFotoPend(null)} style={{ ...btnLine, padding: '9px 12px', fontSize: 13 }}><X size={14} /></button>
                </div>
              </div>
            </div>
          )}

          {fotosDiag.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10, marginTop: 12 }}>
              {fotosDiag.map((f) => (
                <div key={f.id} style={{ position: 'relative', border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                  <button
                    onClick={() => void excluirFoto(f)}
                    title="Excluir foto" aria-label="Excluir foto"
                    style={{ position: 'absolute', top: 4, right: 4, zIndex: 2, width: 22, height: 22, borderRadius: 999, border: 'none', background: 'rgba(61,35,20,0.62)', color: '#fff', fontSize: 13, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    <X size={13} />
                  </button>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {f._url ? <img src={f._url} alt={f.descricao ?? 'foto'} onClick={() => setFotoZoom(f._url ?? null)} title="Clique para ampliar" style={{ width: '100%', height: 72, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
                    : <div style={{ width: '100%', height: 72, background: '#F0EADE' }} />}
                  <div style={{ fontSize: 10.5, color: ESP60, padding: '5px 7px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.descricao || 'Foto'}{f.criado_por_nome ? ` · ${f.criado_por_nome}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </Sec>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `1px solid ${LINE}`, padding: '10px 14px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: 8, maxWidth: 560, width: '100%' }}>
          <button onClick={salvar} disabled={salvando} style={{ ...btnGold, flex: 1, fontSize: 15, minHeight: 48 }}>
            {salvando ? 'Salvando…' : 'Salvar laudo'}
          </button>
          <button onClick={abrirCotar} disabled={salvando} title="Gerar cotação de compra das peças (comparar fornecedores)"
            style={{ ...btnLine, flex: 1, fontSize: 14, minHeight: 48, justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Package size={16} /> Gerar cotação
          </button>
        </div>
      </div>
      {/* RD-26 · seleção de peças p/ cotação (serviço não entra; estoque vem desmarcado) */}
      {cotarAberto && osSel && (
        <div onClick={fecharCotar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 560, maxHeight: '82vh', overflowY: 'auto', padding: 16 }}>
            {!cotacaoCriada ? (
              // ── Fase 1 · escolher peças e gerar a cotação ──
              <>
                <div style={{ fontSize: 16, fontWeight: 800, color: ESP, marginBottom: 4 }}>Gerar cotação de compra</div>
                <div style={{ fontSize: 12, color: ESP60, marginBottom: 12 }}>Marque as peças que precisam cotar. Serviços não entram; itens em estoque vêm desmarcados.</div>
                {pecasCotaveis().length === 0 ? (
                  <div style={{ fontSize: 13, color: ESP60, padding: '16px 0' }}>Nenhuma peça salva para cotar. Salve o laudo primeiro.</div>
                ) : pecasCotaveis().map((p) => {
                  const on = cotarSel.has(p.id as string)
                  return (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: `1px solid ${LINE}`, cursor: 'pointer' }}>
                      <input type="checkbox" checked={on} onChange={() => setCotarSel((s) => { const n = new Set(s); if (n.has(p.id as string)) n.delete(p.id as string); else n.add(p.id as string); return n })} style={{ width: 18, height: 18, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: ESP, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.descricao || 'Peça'}</div>
                        <div style={{ fontSize: 11, color: ESP60 }}>Qtd {p.quantidade || '1'}{p.produto_id ? (p._estoque != null ? ` · estoque ${Number(p._estoque)}` : ' · catálogo') : ' · item livre'}</div>
                      </div>
                    </label>
                  )
                })}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={fecharCotar} style={{ ...btnLine, flex: 1 }}>Cancelar</button>
                  <button onClick={() => void gerarCotacao()} disabled={gerandoCot || cotarSel.size === 0} style={{ ...btnGold, flex: 1 }}>
                    {gerandoCot ? 'Gerando…' : `Gerar cotação (${cotarSel.size})`}
                  </button>
                </div>
              </>
            ) : (
              // ── Fase 2 · convidar fornecedores para a cotação recém-criada ([→GE]) ──
              <>
                <div style={{ fontSize: 16, fontWeight: 800, color: ESP, marginBottom: 4 }}>Convidar fornecedores · Cotação {cotacaoCriada.numero}</div>
                <div style={{ fontSize: 12, color: ESP60, marginBottom: 12 }}>Selecione quem receberá o pedido de cotação. A comparação das propostas é feita em Compras.</div>
                <div style={{ position: 'relative', marginBottom: 10 }}>
                  <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: ESP60 }} />
                  <input value={buscaFornec} onChange={(e) => setBuscaFornec(e.target.value)} placeholder="Buscar fornecedor…"
                    style={{ width: '100%', padding: '9px 10px 9px 30px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13, color: ESP, boxSizing: 'border-box' }} />
                </div>
                <div style={{ maxHeight: '42vh', overflowY: 'auto' }}>
                  {(() => {
                    const t = buscaFornec.trim().toLowerCase()
                    const lista = t ? fornecedores.filter((f) => f.nome.toLowerCase().includes(t) || (f.local ?? '').toLowerCase().includes(t)) : fornecedores
                    if (fornecedores.length === 0) return <div style={{ fontSize: 13, color: ESP60, padding: '16px 0' }}>Nenhum fornecedor ativo cadastrado.</div>
                    if (lista.length === 0) return <div style={{ fontSize: 13, color: ESP60, padding: '16px 0' }}>Nenhum fornecedor encontrado.</div>
                    return lista.map((f) => {
                      const on = convidarSel.has(f.id)
                      return (
                        <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: `1px solid ${LINE}`, cursor: 'pointer' }}>
                          <input type="checkbox" checked={on} onChange={() => setConvidarSel((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n })} style={{ width: 18, height: 18, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: ESP, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.nome}</div>
                            {f.local && <div style={{ fontSize: 11, color: ESP60 }}>{f.local}</div>}
                          </div>
                        </label>
                      )
                    })
                  })()}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => { fecharCotar(); setTimeout(() => router.push('/dashboard/commerce/compras'), 100) }} style={{ ...btnLine, flex: 1 }}>Pular · ir para Compras</button>
                  <button onClick={() => void convidarFornecedores()} disabled={convidando || convidarSel.size === 0} style={{ ...btnGold, flex: 1 }}>
                    {convidando ? 'Convidando…' : `Convidar (${convidarSel.size})`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {msg && <Toast>{msg}</Toast>}
      {osSel && companyId && (
        <SolicitarPecaModal companyId={companyId} osId={osSel.id} aberto={solicitarAberto}
          onFechar={() => setSolicitarAberto(false)}
          onEnviada={() => setMsg('Solicitação enviada ao responsável.')} />
      )}
      {/* Lightbox: foto em tamanho grande (clique na miniatura). Toque/clique fora fecha. */}
      {fotoZoom && (
        <div onClick={() => setFotoZoom(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fotoZoom} alt="foto do diagnóstico" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }} />
          <button type="button" aria-label="Fechar" onClick={() => setFotoZoom(null)}
            style={{ position: 'fixed', top: 14, right: 14, width: 40, height: 40, borderRadius: 999, border: 'none', background: 'rgba(255,255,255,0.9)', color: '#3D2314', fontSize: 20, fontWeight: 700, cursor: 'pointer' }}>×</button>
        </div>
      )}
    </div>
  )
}

function Sec({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700, marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
function Campo({ l, children }: { l: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: 11, color: ESP60, marginBottom: 4 }}>{l}</div>{children}</div>
}
function Toast({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', bottom: 74, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 16px', borderRadius: 999, fontSize: 13, zIndex: 70, maxWidth: '92%', textAlign: 'center' }}>{children}</div>
}
const inp: CSSProperties = { width: '100%', padding: '11px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 15, background: '#fff', color: ESP, outline: 'none', fontFamily: 'inherit' }
const btnGold: CSSProperties = { background: GOLD, color: '#3D2314', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const btnLine: CSSProperties = { background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }
const chip: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: ESP60, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }

'use client'

// Hub · Gestão de Obras · Encerramento da obra (H8 · HBF-7.x).
// Três abas na mesma tela (1 tela = 1 PR):
//  • TERMO DE ENTREGA: registrar o termo da obra (data de entrega, observações, assinatura) como rascunho
//    e, ao assinar, torná-lo IMUTÁVEL. Consome fn_obra_termo_entrega_obter/_registrar (#3920, já na main).
//  • RETENÇÃO E GARANTIA: controla a retenção contratual (percentual/valor, data prevista de liberação e
//    situação) e a garantia da obra (prazo em meses, início/fim, situação). Consome
//    fn_obra_retencao_garantia_obter/_salvar. É só o CONTROLE: a retenção "virar título" em erp_receber é
//    um passo do FINANCEIRO (núcleo) e entra em PR própria coordenada — esta aba NÃO toca o financeiro.
//  • DOCUMENTOS: anexos da obra por tipo em storage PRIVADO (bucket 'obra-documentos'), com exclusão
//    rastreável (soft-delete + motivo + auditoria via fn_obra_arquivo_excluir, #3912).
// Fronteira de núcleo: o "flip" do status da obra para 'entregue' NÃO é feito aqui (CHECK de projetos_obras
// só admite em_andamento|pausada|concluida|cancelada — decisão do eng_chefe/gilberto-desenv). O termo tem o
// próprio ciclo (rascunho -> assinado).
// RD-95: "?" em todo campo/ação. RD-100: linguagem de arquiteto/engenheiro, sem nome de terceiros.

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

// A camada de dados desta tela (tabela/bucket/RPC) pode chegar à produção DEPOIS da UI. Enquanto não chegar,
// PostgREST/Storage respondem "relation does not exist" / "function not found" / "Bucket not found". RD-98: a
// tela NUNCA mostra esse erro cru — degrada para um aviso de "recurso sendo liberado" (tela viva, não morta).
function recursoEmLiberacao(e: unknown): boolean {
  const err = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  if (['42P01', 'PGRST205', 'PGRST202', 'PGRST204'].includes(code)) return true
  return /does not exist|not found|schema cache|bucket not found/.test(msg)
}

const ROTA = '/dashboard/projetos/obras/[id]/encerramento'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = 'rgba(61,35,20,0.18)', MUT = 'rgba(61,35,20,0.55)', VERM = '#A32D2D', VERDE = '#2E7D52'
const BUCKET = 'obra-documentos'
const MIME_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

const TIPOS: { v: string; l: string }[] = [
  { v: 'termo_entrega', l: 'Termo de entrega' },
  { v: 'art_rrt', l: 'ART / RRT' },
  { v: 'as_built', l: 'As built' },
  { v: 'laudo', l: 'Laudo' },
  { v: 'foto', l: 'Foto' },
  { v: 'nota', l: 'Nota / documento' },
  { v: 'outro', l: 'Outro' },
]
const tipoLabel = (v: string) => TIPOS.find((t) => t.v === v)?.l ?? v

type ArquivoRow = {
  id: string; obra_id: string; company_id: string; tipo: string
  nome_arquivo: string; storage_path: string; tamanho_bytes: number | null
  mime_type: string | null; enviado_em: string
}
type Obra = { id: string; nome: string | null; company_id: string }
type Termo = {
  id: string; obra_id: string; status: string; data_entrega: string | null
  observacoes: string | null; assinatura: string | null
  assinado_por: string | null; assinado_em: string | null
  criado_em: string | null; atualizado_em: string | null
}
type RetGar = {
  id: string; obra_id: string
  retencao_percentual: number | null; retencao_valor: number | null
  retencao_data_prevista_liberacao: string | null; retencao_status: string; retencao_observacoes: string | null
  garantia_prazo_meses: number | null; garantia_inicio: string | null; garantia_fim: string | null
  garantia_status: string; garantia_observacoes: string | null
  atualizado_em: string | null
}
const RET_STATUS: { v: string; l: string }[] = [
  { v: 'prevista', l: 'Prevista' }, { v: 'liberada', l: 'Liberada' }, { v: 'cancelada', l: 'Cancelada' },
]
const GAR_STATUS: { v: string; l: string }[] = [
  { v: 'vigente', l: 'Vigente' }, { v: 'encerrada', l: 'Encerrada' }, { v: 'acionada', l: 'Acionada' },
]
const labelDe = (arr: { v: string; l: string }[], v: string) => arr.find((x) => x.v === v)?.l ?? v
// número a partir de texto de formulário: vazio → null; vírgula decimal aceita
function numOuNull(s: string): number | null {
  const t = s.trim().replace(/\./g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
function fmtMoeda(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtTamanho(b: number | null): string {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}
function fmtData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtDataCurta(iso: string | null): string {
  if (!iso) return '—'
  // date pura (YYYY-MM-DD) sem fuso: formata direto para não "voltar um dia"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return new Date(iso).toLocaleDateString('pt-BR')
}
function sanitizar(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export default function EncerramentoObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [aba, setAba] = useState<'termo' | 'documentos' | 'retencao'>('termo')
  const [obra, setObra] = useState<Obra | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erroGeral, setErroGeral] = useState<string | null>(null)

  // --- Documentos ---
  const [lista, setLista] = useState<ArquivoRow[]>([])
  const [enviando, setEnviando] = useState(false)
  const [erroDoc, setErroDoc] = useState<string | null>(null)
  const [tipoUpload, setTipoUpload] = useState<string>('termo_entrega')
  const [filtro, setFiltro] = useState<string>('todos')
  const [arrastando, setArrastando] = useState(false)
  const [docEmLiberacao, setDocEmLiberacao] = useState(false)
  const [excluindo, setExcluindo] = useState<ArquivoRow | null>(null)
  const [motivoExcl, setMotivoExcl] = useState('')
  const [removendo, setRemovendo] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // --- Termo de entrega ---
  const [termo, setTermo] = useState<Termo | null>(null)
  const [termoEmLiberacao, setTermoEmLiberacao] = useState(false)
  const [dataEntrega, setDataEntrega] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [assinatura, setAssinatura] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroTermo, setErroTermo] = useState<string | null>(null)
  const [okTermo, setOkTermo] = useState<string | null>(null)
  const [confirmandoAssinatura, setConfirmandoAssinatura] = useState(false)

  // --- Retenção e garantia ---
  const [retGar, setRetGar] = useState<RetGar | null>(null)
  const [rgEmLiberacao, setRgEmLiberacao] = useState(false)
  const [rgRetPct, setRgRetPct] = useState('')
  const [rgRetValor, setRgRetValor] = useState('')
  const [rgRetLiberacao, setRgRetLiberacao] = useState('')
  const [rgRetStatus, setRgRetStatus] = useState('prevista')
  const [rgRetObs, setRgRetObs] = useState('')
  const [rgGarPrazo, setRgGarPrazo] = useState('')
  const [rgGarInicio, setRgGarInicio] = useState('')
  const [rgGarFim, setRgGarFim] = useState('')
  const [rgGarStatus, setRgGarStatus] = useState('vigente')
  const [rgGarObs, setRgGarObs] = useState('')
  const [salvandoRG, setSalvandoRG] = useState(false)
  const [erroRG, setErroRG] = useState<string | null>(null)
  const [okRG, setOkRG] = useState<string | null>(null)

  const carregarDocumentos = useCallback(async () => {
    setDocEmLiberacao(false)
    const { data, error } = await supabase
      .from('erp_obra_arquivos')
      .select('id, obra_id, company_id, tipo, nome_arquivo, storage_path, tamanho_bytes, mime_type, enviado_em')
      .eq('obra_id', id).is('deleted_at', null).order('enviado_em', { ascending: false })
    if (error) {
      if (recursoEmLiberacao(error)) { setDocEmLiberacao(true); return }
      setErroDoc(erroAmigavel(error, 'Não foi possível carregar os documentos. Tente de novo.'))
      return
    }
    setLista((data as ArquivoRow[]) ?? [])
  }, [id])

  const carregarTermo = useCallback(async () => {
    setTermoEmLiberacao(false)
    const { data, error } = await supabase.rpc('fn_obra_termo_entrega_obter', { p_obra_id: id })
    if (error) {
      if (recursoEmLiberacao(error)) { setTermoEmLiberacao(true); return }
      setErroTermo(erroAmigavel(error, 'Não foi possível carregar o termo de entrega. Tente de novo.'))
      return
    }
    const row = (Array.isArray(data) ? data[0] : data) as Termo | undefined
    setTermo(row ?? null)
    if (row) {
      setDataEntrega(row.data_entrega ?? '')
      setObservacoes(row.observacoes ?? '')
      setAssinatura(row.assinatura ?? '')
    }
  }, [id])

  const carregarRetGar = useCallback(async () => {
    setRgEmLiberacao(false)
    const { data, error } = await supabase.rpc('fn_obra_retencao_garantia_obter', { p_obra_id: id })
    if (error) {
      if (recursoEmLiberacao(error)) { setRgEmLiberacao(true); return }
      setErroRG(erroAmigavel(error, 'Não foi possível carregar a retenção e a garantia. Tente de novo.'))
      return
    }
    const row = (Array.isArray(data) ? data[0] : data) as RetGar | undefined
    setRetGar(row ?? null)
    setRgRetPct(row?.retencao_percentual != null ? String(row.retencao_percentual).replace('.', ',') : '')
    setRgRetValor(row?.retencao_valor != null ? String(row.retencao_valor).replace('.', ',') : '')
    setRgRetLiberacao(row?.retencao_data_prevista_liberacao ?? '')
    setRgRetStatus(row?.retencao_status ?? 'prevista')
    setRgRetObs(row?.retencao_observacoes ?? '')
    setRgGarPrazo(row?.garantia_prazo_meses != null ? String(row.garantia_prazo_meses) : '')
    setRgGarInicio(row?.garantia_inicio ?? '')
    setRgGarFim(row?.garantia_fim ?? '')
    setRgGarStatus(row?.garantia_status ?? 'vigente')
    setRgGarObs(row?.garantia_observacoes ?? '')
  }, [id])

  const carregar = useCallback(async () => {
    setCarregando(true); setErroGeral(null); setErroDoc(null); setErroTermo(null); setErroRG(null)
    const { data: o, error: eo } = await supabase
      .from('projetos_obras').select('id, nome, company_id').eq('id', id).maybeSingle()
    if (eo) { setCarregando(false); setErroGeral(erroAmigavel(eo, 'Não foi possível abrir a obra. Tente de novo.')); return }
    if (!o) { setCarregando(false); setObra(null); return }
    setObra(o as Obra)
    await Promise.all([carregarTermo(), carregarDocumentos(), carregarRetGar()])
    setCarregando(false)
  }, [id, carregarTermo, carregarDocumentos, carregarRetGar])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const assinado = termo?.status === 'assinado'

  async function salvarTermo(assinar: boolean) {
    setErroTermo(null); setOkTermo(null)
    if (!obra) { setErroTermo('Obra não encontrada ou sem acesso.'); return }
    if (!dataEntrega) { setErroTermo('Informe a data de entrega.'); return }
    if (assinar && assinatura.trim().length < 3) { setErroTermo('Para assinar, preencha a assinatura (nome de quem assina).'); return }
    setSalvando(true)
    const { error } = await supabase.rpc('fn_obra_termo_entrega_registrar', {
      p_obra_id: id,
      p_data_entrega: dataEntrega,
      p_observacoes: observacoes.trim() || null,
      p_assinatura: assinatura.trim() || null,
      p_assinar: assinar,
    })
    setSalvando(false); setConfirmandoAssinatura(false)
    if (error) {
      if (recursoEmLiberacao(error)) { setTermoEmLiberacao(true); return }
      setErroTermo(erroAmigavel(error, 'Não consegui salvar o termo. Tente de novo.'))
      return
    }
    setOkTermo(assinar ? 'Termo de entrega assinado.' : 'Rascunho do termo salvo.')
    await carregarTermo()
  }

  async function salvarRetGar() {
    setErroRG(null); setOkRG(null)
    if (!obra) { setErroRG('Obra não encontrada ou sem acesso.'); return }
    const pct = numOuNull(rgRetPct)
    if (pct !== null && (pct < 0 || pct > 100)) { setErroRG('O percentual de retenção deve ficar entre 0 e 100.'); return }
    const valor = numOuNull(rgRetValor)
    if (valor !== null && valor < 0) { setErroRG('O valor retido não pode ser negativo.'); return }
    const prazo = numOuNull(rgGarPrazo)
    if (prazo !== null && (prazo < 0 || !Number.isInteger(prazo))) { setErroRG('O prazo de garantia deve ser um número inteiro de meses (0 ou mais).'); return }
    if (rgGarInicio && rgGarFim && rgGarFim < rgGarInicio) { setErroRG('O fim da garantia não pode ser antes do início.'); return }
    setSalvandoRG(true)
    const { error } = await supabase.rpc('fn_obra_retencao_garantia_salvar', {
      p_obra_id: id,
      p_retencao_percentual: pct,
      p_retencao_valor: valor,
      p_retencao_data_prevista_liberacao: rgRetLiberacao || null,
      p_retencao_status: rgRetStatus,
      p_retencao_observacoes: rgRetObs.trim() || null,
      p_garantia_prazo_meses: prazo,
      p_garantia_inicio: rgGarInicio || null,
      p_garantia_fim: rgGarFim || null,
      p_garantia_status: rgGarStatus,
      p_garantia_observacoes: rgGarObs.trim() || null,
    })
    setSalvandoRG(false)
    if (error) {
      if (recursoEmLiberacao(error)) { setRgEmLiberacao(true); return }
      setErroRG(erroAmigavel(error, 'Não consegui salvar a retenção e a garantia. Tente de novo.'))
      return
    }
    setOkRG('Retenção e garantia salvas.')
    await carregarRetGar()
  }

  // sugere o fim da garantia a partir do início + prazo, quando o usuário ainda não preencheu o fim
  function sugerirFimGarantia() {
    const prazo = numOuNull(rgGarPrazo)
    if (!rgGarInicio || prazo === null || prazo <= 0) return
    const d = new Date(`${rgGarInicio}T00:00:00`)
    d.setMonth(d.getMonth() + Math.round(prazo))
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setRgGarFim(iso)
  }

  async function anexar(file: File) {
    setErroDoc(null)
    if (!obra) { setErroDoc('Obra não encontrada ou sem acesso.'); return }
    if (!MIME_OK.includes(file.type)) { setErroDoc('Aceita só PDF, JPG, PNG ou WebP.'); return }
    if (file.size > MAX_BYTES) { setErroDoc(`Arquivo grande demais (${fmtTamanho(file.size)}) — máximo 10 MB.`); return }
    setEnviando(true)
    const path = `${id}/${Date.now()}_${sanitizar(file.name)}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) {
      setEnviando(false)
      if (recursoEmLiberacao(up.error)) { setDocEmLiberacao(true); return }
      setErroDoc(erroAmigavel(up.error, 'Não consegui anexar o documento. Tente de novo.'))
      return
    }
    const ins = await supabase.from('erp_obra_arquivos').insert({
      obra_id: id, company_id: obra.company_id, tipo: tipoUpload,
      nome_arquivo: file.name, storage_path: path, tamanho_bytes: file.size, mime_type: file.type,
    })
    setEnviando(false)
    if (ins.error) {
      await supabase.storage.from(BUCKET).remove([path]) // rollback do blob órfão
      if (recursoEmLiberacao(ins.error)) { setDocEmLiberacao(true); return }
      setErroDoc(erroAmigavel(ins.error, 'Não consegui registrar o anexo. Tente de novo.'))
      return
    }
    await carregarDocumentos()
  }

  async function baixar(row: ArquivoRow) {
    setErroDoc(null)
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 60)
    if (error || !data?.signedUrl) { setErroDoc(erroAmigavel(error, 'Não consegui gerar o link do documento. Tente de novo.')); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    if (motivoExcl.trim().length < 3) { setErroDoc('Informe o motivo da exclusão (ao menos 3 letras).'); return }
    setRemovendo(true); setErroDoc(null)
    const { data, error } = await supabase.rpc('fn_obra_arquivo_excluir', { p_id: excluindo.id, p_motivo: motivoExcl.trim() })
    setRemovendo(false)
    const j = (data ?? null) as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setErroDoc(erroAmigavel(error, j?.erro ?? 'Não consegui excluir o documento. Tente de novo.')); return }
    setExcluindo(null); setMotivoExcl('')
    await carregarDocumentos()
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault(); setArrastando(false)
    const f = e.dataTransfer.files?.[0]; if (f) void anexar(f)
  }

  const visiveis = filtro === 'todos' ? lista : lista.filter((r) => r.tipo === filtro)

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, fontWeight: 700, textDecoration: 'none' }}>← Voltar ao cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 10 }}>Hub · Gestão de Obras</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
          Encerramento da obra <AjudaCampo chave="projetos.encerramento.aba" rota={ROTA} />
        </h1>
        {obra?.nome && <div style={{ fontSize: 13, color: MUT, marginBottom: 16 }}>{obra.nome}</div>}

        {carregando ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
        ) : erroGeral ? (
          <div style={{ background: '#FCEBEB', color: VERM, padding: '12px 14px', borderRadius: 8, fontSize: 13 }}>{erroGeral}</div>
        ) : !obra ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Obra não encontrada ou sem acesso.</div>
        ) : (
          <>
            {/* abas */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: `0.5px solid ${LINE}` }}>
              {([['termo', 'Termo de entrega'], ['retencao', 'Retenção e garantia'], ['documentos', 'Documentos']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setAba(k)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 12px',
                    fontSize: 13.5, fontWeight: aba === k ? 700 : 500, color: aba === k ? ESP : MUT,
                    borderBottom: aba === k ? `2px solid ${GOLD}` : '2px solid transparent', marginBottom: -1,
                  }}>{l}</button>
              ))}
            </div>

            {aba === 'termo' ? (
              termoEmLiberacao ? (
                <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📝</div>
                  <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: ESP, marginBottom: 6 }}>Termo de entrega — em liberação</div>
                  <div style={{ fontSize: 13, color: MUT, lineHeight: 1.5, maxWidth: 440, margin: '0 auto' }}>
                    Esta área está sendo habilitada para a sua empresa. Em breve você poderá registrar e assinar o
                    termo de entrega da obra.
                  </div>
                </div>
              ) : (
                <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginBottom: 4 }}>
                    Termo de entrega <AjudaCampo chave="projetos.encerramento.termo" rota={ROTA} />
                  </div>

                  {/* faixa de situação */}
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999, marginBottom: 14, background: assinado ? 'rgba(46,125,82,0.12)' : 'rgba(200,148,26,0.14)', color: assinado ? VERDE : '#8A6A12' }}>
                    {assinado ? '✓ Assinado' : termo ? '✎ Rascunho' : '• Ainda não iniciado'}
                    {assinado && termo?.assinado_em && <span style={{ fontWeight: 500, color: MUT }}>· em {fmtData(termo.assinado_em)}</span>}
                  </div>

                  {assinado ? (
                    // termo assinado → leitura, imutável
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ background: 'rgba(46,125,82,0.06)', border: `0.5px solid rgba(46,125,82,0.25)`, borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: ESP }}>
                        Este termo foi <strong>assinado</strong> e, por isso, é <strong>imutável</strong> — fica como registro
                        do encerramento. Para corrigir algo, fale com o responsável pela obra.
                      </div>
                      <Campo rotulo="Data de entrega"><span style={leitura}>{fmtDataCurta(termo?.data_entrega ?? null)}</span></Campo>
                      <Campo rotulo="Assinatura"><span style={leitura}>{termo?.assinatura || '—'}</span></Campo>
                      {termo?.observacoes && <Campo rotulo="Observações"><span style={{ ...leitura, whiteSpace: 'pre-wrap' }}>{termo.observacoes}</span></Campo>}
                    </div>
                  ) : (
                    // rascunho → formulário editável
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 220 }}>
                        <span style={lbl}>Data de entrega * <AjudaCampo chave="projetos.encerramento.termo_data" rota={ROTA} /></span>
                        <input type="date" value={dataEntrega} onChange={(e) => setDataEntrega(e.target.value)} style={inp} />
                      </label>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={lbl}>Observações <AjudaCampo chave="projetos.encerramento.termo_obs" rota={ROTA} /></span>
                        <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={4}
                          placeholder="Pendências resolvidas, ressalvas da entrega, itens combinados com o cliente…"
                          style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
                      </label>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 360 }}>
                        <span style={lbl}>Assinatura (nome de quem assina) <AjudaCampo chave="projetos.encerramento.termo_assinatura" rota={ROTA} /></span>
                        <input value={assinatura} onChange={(e) => setAssinatura(e.target.value)} placeholder="ex.: Eng. Ana Prado — responsável técnica" style={inp} />
                      </label>

                      {erroTermo && <div style={{ background: '#FCEBEB', color: VERM, padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>{erroTermo}</div>}
                      {okTermo && <div style={{ background: 'rgba(46,125,82,0.1)', color: VERDE, padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>{okTermo}</div>}

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" onClick={() => void salvarTermo(false)} disabled={salvando || !dataEntrega}
                          style={{ background: 'transparent', color: ESP, border: `1px solid ${LINE}`, padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: salvando || !dataEntrega ? 'not-allowed' : 'pointer', opacity: salvando || !dataEntrega ? 0.5 : 1 }}>
                          {salvando ? 'Salvando…' : 'Salvar rascunho'}
                        </button>
                        <button type="button" onClick={() => { setErroTermo(null); setConfirmandoAssinatura(true) }} disabled={salvando || !dataEntrega || assinatura.trim().length < 3}
                          style={{ background: GOLD, color: ESP, border: 'none', padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: salvando || !dataEntrega || assinatura.trim().length < 3 ? 'not-allowed' : 'pointer', opacity: salvando || !dataEntrega || assinatura.trim().length < 3 ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          Assinar e encerrar o termo <AjudaCampo chave="projetos.encerramento.termo_assinar" rota={ROTA} />
                        </button>
                      </div>
                      <div style={{ fontSize: 11.5, color: MUT }}>Ao assinar, o termo fica <strong>imutável</strong>. Revise a data e a assinatura antes.</div>
                    </div>
                  )}
                </div>
              )
            ) : aba === 'documentos' ? (
              /* ---------- aba DOCUMENTOS ---------- */
              docEmLiberacao ? (
                <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🗂️</div>
                  <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: ESP, marginBottom: 6 }}>Documentos da obra — em liberação</div>
                  <div style={{ fontSize: 13, color: MUT, lineHeight: 1.5, maxWidth: 440, margin: '0 auto' }}>
                    Esta área está sendo habilitada para a sua empresa. Em breve você poderá anexar e consultar
                    termo de entrega, ART/RRT, as built, laudos e fotos da obra, tudo em arquivo privado.
                  </div>
                </div>
              ) : (
                <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginBottom: 12 }}>
                    Documentos da obra <AjudaCampo chave="projetos.encerramento.documentos" rota={ROTA} />
                  </div>

                  {/* enviar: escolher o tipo e anexar */}
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Tipo do documento <AjudaCampo chave="projetos.encerramento.tipo" rota={ROTA} />
                      </span>
                      <select value={tipoUpload} onChange={(e) => setTipoUpload(e.target.value)} style={inp}>
                        {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                      </select>
                    </label>

                    <div style={{ flex: 1, minWidth: 220 }}>
                      <span style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                        Enviar documento <AjudaCampo chave="projetos.encerramento.upload" rota={ROTA} />
                      </span>
                      <div
                        data-ajuda="projetos.encerramento.upload"
                        onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
                        onDragLeave={() => setArrastando(false)}
                        onDrop={handleDrop}
                        onClick={() => inputRef.current?.click()}
                        role="button" tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
                        style={{ border: `1.5px dashed ${arrastando ? GOLD : 'rgba(61,35,20,0.3)'}`, borderRadius: 8, padding: '14px', textAlign: 'center', background: arrastando ? 'rgba(200,148,26,0.08)' : 'rgba(61,35,20,0.02)', cursor: enviando ? 'wait' : 'pointer', opacity: enviando ? 0.6 : 1 }}
                      >
                        <div style={{ fontSize: 13, color: ESP, fontWeight: 500 }}>{enviando ? 'Anexando…' : '📎 Anexar — arraste ou clique'}</div>
                        <div style={{ fontSize: 11, color: MUT, marginTop: 4 }}>PDF, JPG, PNG ou WebP — até 10 MB</div>
                        <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) void anexar(f); e.target.value = '' }} />
                      </div>
                    </div>
                  </div>

                  {erroDoc && <div style={{ background: '#FCEBEB', color: VERM, padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 12 }}>{erroDoc}</div>}

                  {/* filtrar por tipo */}
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                    <span style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      Filtrar por tipo <AjudaCampo chave="projetos.encerramento.filtro" rota={ROTA} />
                    </span>
                    <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inp}>
                      <option value="todos">Todos</option>
                      {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </label>

                  {/* lista */}
                  {visiveis.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: MUT, padding: '10px 0', fontStyle: 'italic' }}>
                      {lista.length === 0 ? 'Nenhum documento anexado ainda.' : 'Nenhum documento deste tipo.'}
                    </div>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {visiveis.map((row) => (
                        <li key={row.id} style={{ background: BG, border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 92 }}>{tipoLabel(row.tipo)}</span>
                          <div style={{ flex: 1, minWidth: 160 }}>
                            <div style={{ fontSize: 13, color: ESP, fontWeight: 500, wordBreak: 'break-word' }}>{row.nome_arquivo}</div>
                            <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>{fmtTamanho(row.tamanho_bytes)} · enviado em {fmtData(row.enviado_em)}</div>
                          </div>
                          <button type="button" onClick={() => void baixar(row)} style={{ background: GOLD, color: ESP, border: 'none', padding: '6px 14px', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Baixar</button>
                          <button type="button" onClick={() => { setExcluindo(row); setMotivoExcl(''); setErroDoc(null) }} style={{ background: 'transparent', color: VERM, border: `0.5px solid rgba(163,45,45,0.4)`, padding: '6px 12px', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>Excluir</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            ) : (
              /* ---------- aba RETENÇÃO E GARANTIA ---------- */
              rgEmLiberacao ? (
                <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🛡️</div>
                  <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: ESP, marginBottom: 6 }}>Retenção e garantia — em liberação</div>
                  <div style={{ fontSize: 13, color: MUT, lineHeight: 1.5, maxWidth: 440, margin: '0 auto' }}>
                    Esta área está sendo habilitada para a sua empresa. Em breve você poderá controlar a retenção
                    contratual e a garantia da obra aqui.
                  </div>
                </div>
              ) : (
                <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginBottom: 4 }}>
                    Retenção e garantia <AjudaCampo chave="projetos.encerramento.retencao_garantia" rota={ROTA} />
                  </div>

                  {/* faixa de situação (retenção · garantia) */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: 'rgba(200,148,26,0.14)', color: '#8A6A12' }}>
                      Retenção: {labelDe(RET_STATUS, retGar?.retencao_status ?? 'prevista')}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: rgGarStatus === 'vigente' ? 'rgba(46,125,82,0.12)' : 'rgba(61,35,20,0.08)', color: rgGarStatus === 'vigente' ? VERDE : MUT }}>
                      Garantia: {labelDe(GAR_STATUS, retGar?.garantia_status ?? 'vigente')}
                    </span>
                  </div>

                  {/* ── RETENÇÃO ── */}
                  <div style={secHead}>Retenção contratual</div>
                  <div style={grid2}>
                    <label style={col}>
                      <span style={lbl}>Percentual de retenção (%) <AjudaCampo chave="projetos.encerramento.retencao_percentual" rota={ROTA} /></span>
                      <input inputMode="decimal" value={rgRetPct} onChange={(e) => setRgRetPct(e.target.value)} placeholder="ex.: 5" style={inp} />
                    </label>
                    <label style={col}>
                      <span style={lbl}>Valor retido (R$) <AjudaCampo chave="projetos.encerramento.retencao_valor" rota={ROTA} /></span>
                      <input inputMode="decimal" value={rgRetValor} onChange={(e) => setRgRetValor(e.target.value)} placeholder="ex.: 2160,76" style={inp} />
                    </label>
                    <label style={col}>
                      <span style={lbl}>Data prevista de liberação <AjudaCampo chave="projetos.encerramento.retencao_liberacao" rota={ROTA} /></span>
                      <input type="date" value={rgRetLiberacao} onChange={(e) => setRgRetLiberacao(e.target.value)} style={inp} />
                    </label>
                    <label style={col}>
                      <span style={lbl}>Situação da retenção <AjudaCampo chave="projetos.encerramento.retencao_status" rota={ROTA} /></span>
                      <select value={rgRetStatus} onChange={(e) => setRgRetStatus(e.target.value)} style={inp}>
                        {RET_STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                      </select>
                    </label>
                  </div>
                  <label style={{ ...col, marginTop: 12 }}>
                    <span style={lbl}>Observações da retenção <AjudaCampo chave="projetos.encerramento.retencao_obs" rota={ROTA} /></span>
                    <textarea value={rgRetObs} onChange={(e) => setRgRetObs(e.target.value)} rows={2}
                      placeholder="Sobre o que incide, como será devolvida, combinados…" style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
                  </label>

                  {/* ── GARANTIA ── */}
                  <div style={{ ...secHead, marginTop: 20 }}>Garantia da obra</div>
                  <div style={grid2}>
                    <label style={col}>
                      <span style={lbl}>Prazo de garantia (meses) <AjudaCampo chave="projetos.encerramento.garantia_prazo" rota={ROTA} /></span>
                      <input inputMode="numeric" value={rgGarPrazo} onChange={(e) => setRgGarPrazo(e.target.value)} onBlur={sugerirFimGarantia} placeholder="ex.: 12" style={inp} />
                    </label>
                    <label style={col}>
                      <span style={lbl}>Início da garantia <AjudaCampo chave="projetos.encerramento.garantia_inicio" rota={ROTA} /></span>
                      <input type="date" value={rgGarInicio} onChange={(e) => setRgGarInicio(e.target.value)} onBlur={sugerirFimGarantia} style={inp} />
                    </label>
                    <label style={col}>
                      <span style={lbl}>Fim da garantia <AjudaCampo chave="projetos.encerramento.garantia_fim" rota={ROTA} /></span>
                      <input type="date" value={rgGarFim} onChange={(e) => setRgGarFim(e.target.value)} style={inp} />
                    </label>
                    <label style={col}>
                      <span style={lbl}>Situação da garantia <AjudaCampo chave="projetos.encerramento.garantia_status" rota={ROTA} /></span>
                      <select value={rgGarStatus} onChange={(e) => setRgGarStatus(e.target.value)} style={inp}>
                        {GAR_STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                      </select>
                    </label>
                  </div>
                  <label style={{ ...col, marginTop: 12 }}>
                    <span style={lbl}>Observações da garantia <AjudaCampo chave="projetos.encerramento.garantia_obs" rota={ROTA} /></span>
                    <textarea value={rgGarObs} onChange={(e) => setRgGarObs(e.target.value)} rows={2}
                      placeholder="O que a garantia cobre, exclusões, condições…" style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
                  </label>

                  {erroRG && <div style={{ background: '#FCEBEB', color: VERM, padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 14 }}>{erroRG}</div>}
                  {okRG && <div style={{ background: 'rgba(46,125,82,0.1)', color: VERDE, padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 14 }}>{okRG}</div>}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
                    <button type="button" onClick={() => void salvarRetGar()} disabled={salvandoRG}
                      style={{ background: GOLD, color: ESP, border: 'none', padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: salvandoRG ? 'wait' : 'pointer', opacity: salvandoRG ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {salvandoRG ? 'Salvando…' : 'Salvar'} <AjudaCampo chave="projetos.encerramento.retencao_garantia_salvar" rota={ROTA} />
                    </button>
                    {retGar?.retencao_valor != null && (
                      <span style={{ fontSize: 12, color: MUT }}>Retido hoje: <strong style={{ color: ESP }}>{fmtMoeda(retGar.retencao_valor)}</strong></span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: MUT, marginTop: 10, lineHeight: 1.5 }}>
                    Aqui você <strong>controla</strong> a retenção e a garantia da obra. A geração do título financeiro da
                    retenção (a devolução virar uma conta a receber) é um passo do Financeiro e entra depois.
                  </div>
                </div>
              )
            )}
          </>
        )}

        {/* confirmação de assinatura (imutável) */}
        {confirmandoAssinatura && (
          <div onClick={() => { if (!salvando) setConfirmandoAssinatura(false) }} style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', padding: 18 }}>
            <div role="dialog" aria-label="Assinar termo de entrega" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: BG, border: `0.5px solid ${LINE}`, borderRadius: 14, padding: 20 }}>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: ESP, marginBottom: 6 }}>Assinar o termo de entrega?</div>
              <div style={{ fontSize: 12.5, color: MUT, lineHeight: 1.5, marginBottom: 12 }}>
                O termo será registrado como <strong>assinado por você</strong>, com data e hora, e passa a ser
                <strong> imutável</strong> — não dá para editar depois. Confira a data de entrega ({fmtDataCurta(dataEntrega || null)}) e a assinatura.
              </div>
              {erroTermo && <div style={{ background: '#FCEBEB', color: VERM, padding: '8px 12px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erroTermo}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => { if (!salvando) setConfirmandoAssinatura(false) }} style={{ background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`, padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                <button type="button" onClick={() => void salvarTermo(true)} disabled={salvando}
                  style={{ background: GOLD, color: ESP, border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.6 : 1 }}>
                  {salvando ? 'Assinando…' : 'Assinar agora'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* RD-98 p4 — modal de exclusão rastreável (motivo obrigatório) */}
        {excluindo && (
          <div onClick={() => { if (!removendo) setExcluindo(null) }} style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', padding: 18 }}>
            <div role="dialog" aria-label="Excluir documento" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: BG, border: `0.5px solid ${LINE}`, borderRadius: 14, padding: 20 }}>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: ESP, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                Excluir documento <AjudaCampo chave="projetos.encerramento.motivo_exclusao" rota={ROTA} />
              </div>
              <div style={{ fontSize: 12.5, color: MUT, lineHeight: 1.5, marginBottom: 12 }}>
                “{excluindo.nome_arquivo}” sai da lista. Nada é apagado de vez: ficam registrados <strong>quem</strong> excluiu, <strong>quando</strong> e o <strong>motivo</strong>.
              </div>
              <div data-ajuda="projetos.encerramento.motivo_exclusao">
                <span style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6 }}>Motivo *</span>
                <input autoFocus value={motivoExcl} onChange={(e) => setMotivoExcl(e.target.value)} placeholder="ex.: versão antiga, reenviado corrigido"
                  style={{ ...inp, width: '100%', marginTop: 4 }} onKeyDown={(e) => { if (e.key === 'Enter') void confirmarExclusao() }} />
              </div>
              {erroDoc && <div style={{ background: '#FCEBEB', color: VERM, padding: '8px 12px', borderRadius: 6, marginTop: 10, fontSize: 12 }}>{erroDoc}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button type="button" onClick={() => { if (!removendo) setExcluindo(null) }} style={{ background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`, padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                <button type="button" onClick={() => void confirmarExclusao()} disabled={removendo || motivoExcl.trim().length < 3}
                  style={{ background: VERM, color: '#FFF', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: removendo || motivoExcl.trim().length < 3 ? 'not-allowed' : 'pointer', opacity: removendo || motivoExcl.trim().length < 3 ? 0.5 : 1 }}>
                  {removendo ? 'Excluindo…' : 'Excluir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6 }}>{rotulo}</span>
      {children}
    </div>
  )
}

const inp: React.CSSProperties = { fontSize: 13, padding: '7px 10px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP }
const lbl: React.CSSProperties = { fontSize: 11, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 4 }
const leitura: React.CSSProperties = { fontSize: 14, color: ESP, fontWeight: 500 }
const secHead: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: ESP, marginBottom: 10, paddingBottom: 4, borderBottom: `0.5px solid ${LINE}` }
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }
const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }

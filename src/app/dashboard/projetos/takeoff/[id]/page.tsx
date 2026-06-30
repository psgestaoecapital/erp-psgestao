'use client'

// Detalhe da planta — ficha editavel (CRIOU/ALTEROU), ambientes com
// semaforo de confianca, Ver/Baixar via signed URL e Analisar com IA.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Sparkles, Check, AlertTriangle, Eye, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'
const GREEN = '#5C8D3F'
const YELLOW = '#C8941A'
const RED = '#C44536'

const PDF_RENDER_SCALE = 2

type Planta = {
  id: string; company_id: string; nome: string; status: string
  area_total_m2: number | null; ia_erro: string | null
  arquivo_path: string | null; arquivo_tipo: string | null
  projeto_nome: string | null; cliente_nome: string | null; cliente_id: string | null
  engenheiro_responsavel: string | null
  obra_endereco: string | null; obra_cidade: string | null; obra_uf: string | null
  data_projeto: string | null; observacoes: string | null
}
type Servico = { id: string; codigo: string | null; nome: string; unidade: string | null; custo_unitario_total: number | null }
type Ambiente = {
  id: string; nome: string; area_m2: number | null; perimetro_ml: number | null; pe_direito_m: number | null
  confianca: 'alta' | 'media' | 'baixa'; confirmado: boolean
  servico_id: string | null; base_calculo: 'area' | 'perimetro' | 'pe_direito_parede'
}

async function pdfPagina1ParaPng(pdfBytes: Uint8Array): Promise<{ blob: Blob; pages: number }> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  const loadingTask = pdfjs.getDocument({ data: pdfBytes, isEvalSupported: false } as unknown as Parameters<typeof pdfjs.getDocument>[0])
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D nao disponivel.')
  await page.render({ canvasContext: ctx, viewport, canvas } as unknown as Parameters<typeof page.render>[0]).promise
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha PNG.'))), 'image/png')
  })
  return { blob, pages: pdf.numPages }
}

export default function PlantaDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id ?? ''
  const [planta, setPlanta] = useState<Planta | null>(null)
  const [servicos, setServicos] = useState<Servico[]>([])
  const [ambientes, setAmbientes] = useState<Ambiente[]>([])
  const [ficha, setFicha] = useState<Partial<Planta>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvandoFicha, setSalvandoFicha] = useState(false)

  const carregar = useCallback(async () => {
    if (!id) return
    const { data: p, error } = await supabase.from('erp_obra_planta')
      .select('id,company_id,nome,status,area_total_m2,ia_erro,arquivo_path,arquivo_tipo,projeto_nome,cliente_nome,cliente_id,engenheiro_responsavel,obra_endereco,obra_cidade,obra_uf,data_projeto,observacoes')
      .eq('id', id).single()
    if (error) { setErro(error.message); return }
    setPlanta(p as Planta)
    setFicha({
      projeto_nome: p.projeto_nome, cliente_nome: p.cliente_nome,
      engenheiro_responsavel: p.engenheiro_responsavel,
      obra_endereco: p.obra_endereco, obra_cidade: p.obra_cidade, obra_uf: p.obra_uf,
      data_projeto: p.data_projeto, observacoes: p.observacoes,
    })
    const { data: a } = await supabase.from('erp_obra_planta_ambiente')
      .select('id,nome,area_m2,perimetro_ml,pe_direito_m,confianca,confirmado,servico_id,base_calculo')
      .eq('planta_id', id).order('nome')
    setAmbientes((a as Ambiente[]) ?? [])
    const { data: s } = await supabase.from('projetos_servicos')
      .select('id,codigo,nome,unidade,custo_unitario_total')
      .eq('company_id', (p as Planta).company_id).eq('ativo', true).order('nome').limit(500)
    setServicos((s as Servico[]) ?? [])
  }, [id])

  useEffect(() => { void carregar() }, [carregar])

  const salvarFicha = async () => {
    if (!planta) return
    setSalvandoFicha(true); setErro(null); setMsg(null)
    const { error } = await supabase.from('erp_obra_planta').update({
      projeto_nome: ficha.projeto_nome ?? null, cliente_nome: ficha.cliente_nome ?? null,
      engenheiro_responsavel: ficha.engenheiro_responsavel ?? null,
      obra_endereco: ficha.obra_endereco ?? null, obra_cidade: ficha.obra_cidade ?? null,
      obra_uf: ficha.obra_uf?.toUpperCase().slice(0, 2) ?? null,
      data_projeto: ficha.data_projeto || null, observacoes: ficha.observacoes ?? null,
    }).eq('id', planta.id)
    setSalvandoFicha(false)
    if (error) setErro(error.message)
    else {
      setMsg('Ficha do projeto ALTEROU com sucesso.')
      await carregar()
    }
  }

  const verArquivo = async (forcarDownload = false) => {
    if (!planta?.arquivo_path) { setErro('Planta sem arquivo.'); return }
    const { data, error } = await supabase.storage.from('projetos-plantas')
      .createSignedUrl(planta.arquivo_path, 60 * 60 * 24 * 7) // 7 dias
    if (error || !data?.signedUrl) { setErro('Falha ao gerar URL.'); return }
    if (forcarDownload) {
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = planta.nome
      document.body.appendChild(a); a.click(); a.remove()
    } else {
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    }
  }

  const analisar = async () => {
    if (!planta?.arquivo_path) { setErro('Reenvie a planta.'); return }
    const ehPdf = planta.arquivo_tipo === 'pdf' || planta.arquivo_path.toLowerCase().endsWith('.pdf')
    setBusy(true); setErro(null); setMsg(ehPdf ? 'Convertendo PDF para imagem…' : 'Analisando com IA…')
    try {
      let imagemPath = planta.arquivo_path
      let media: 'image/png' | 'image/jpeg' = 'image/png'
      if (ehPdf) {
        const { data: dl, error: dle } = await supabase.storage.from('projetos-plantas').download(planta.arquivo_path)
        if (dle || !dl) throw dle ?? new Error('Falha download')
        const pdfBytes = new Uint8Array(await dl.arrayBuffer())
        const r = await pdfPagina1ParaPng(pdfBytes)
        const pngPath = planta.arquivo_path.replace(/\.[^./]+$/, '_p1.png')
        const up = await supabase.storage.from('projetos-plantas')
          .upload(pngPath, new Uint8Array(await r.blob.arrayBuffer()), { upsert: true, contentType: 'image/png' })
        if (up.error) throw new Error(up.error.message)
        imagemPath = pngPath; media = 'image/png'
        setMsg(r.pages > 1 ? `PDF de ${r.pages} páginas — analisando a página 1…` : 'Analisando com IA…')
      } else {
        media = /\.jpe?g$/i.test(planta.arquivo_path) || planta.arquivo_tipo === 'jpg' ? 'image/jpeg' : 'image/png'
      }
      const { data, error } = await supabase.functions.invoke('takeoff-planta-ia', {
        body: { planta_id: planta.id, company_id: planta.company_id, arquivo_path: imagemPath, media_type: media, escala_hint: null },
      })
      if (error) throw error
      const r = data as { ok: boolean; erro?: string }
      if (!r.ok) throw new Error(r.erro || 'Erro IA')
      await carregar()
      setMsg('Ambientes extraídos. Revise no histórico abaixo.')
    } catch (e) {
      setErro((e as Error).message || String(e))
    } finally { setBusy(false) }
  }

  const atualizarAmb = async (a: Ambiente, patch: Partial<Ambiente>) => {
    const next = { ...a, ...patch, confirmado: true }
    setAmbientes((prev) => prev.map((x) => (x.id === a.id ? next : x)))
    if (!planta) return
    await supabase.rpc('fn_takeoff_ambiente_atualizar', {
      p_company_id: planta.company_id, p_id: a.id,
      p_nome: next.nome, p_area_m2: next.area_m2, p_perimetro_ml: next.perimetro_ml, p_pe_direito_m: next.pe_direito_m,
      p_servico_id: next.servico_id, p_base_calculo: next.base_calculo, p_confirmado: next.confirmado,
    })
  }

  const areaTotalAmbientes = ambientes.reduce((s, a) => s + (a.area_m2 ?? 0), 0)

  if (!planta) return (
    <div className="min-h-screen bg-[#FAF7F2] p-6 text-sm text-[#3D2314]/60">
      {erro ? erro : 'Carregando…'}
    </div>
  )

  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white p-2 text-sm text-[#3D2314]'

  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 text-sm" style={{ color: ESP60 }}>
        <Link href="/dashboard/projetos/takeoff" className="inline-flex items-center gap-1 hover:underline">
          <ArrowLeft size={14} /> Acervo
        </Link>
        <span>·</span>
        <span style={{ color: ESP }}>{planta.projeto_nome || planta.nome}</span>
      </div>

      <header className="space-y-1">
        <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: GOLD }}>Projeto</div>
        <h1 className="text-2xl sm:text-3xl text-[#3D2314]" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>
          {planta.projeto_nome || planta.nome}
        </h1>
      </header>

      {msg && <div className="rounded-xl p-3 text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>{msg}</div>}
      {erro && <div className="rounded-xl p-3 text-sm flex items-start gap-2" style={{ background: '#FEE', border: '1px solid #FBB', color: '#A65A3A' }}><AlertTriangle size={14} className="mt-0.5" /> {erro}</div>}

      <section className="rounded-2xl bg-white p-4 border border-[#E7DECF] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#3D2314]">Ficha do projeto</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => verArquivo(false)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#E7DECF] text-[#3D2314] bg-white">
              <Eye size={13} /> Ver planta
            </button>
            <button onClick={() => verArquivo(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#E7DECF] text-[#3D2314] bg-white">
              <Download size={13} /> Baixar
            </button>
            <button onClick={analisar} disabled={busy || planta.status === 'processando'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
              <Sparkles size={13} /> Analisar com IA
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Campo label="Nome do projeto">
            <input className={inp} value={ficha.projeto_nome ?? ''} onChange={(e) => setFicha((f) => ({ ...f, projeto_nome: e.target.value }))} placeholder={planta.nome} />
          </Campo>
          <Campo label="Cliente">
            <input className={inp} value={ficha.cliente_nome ?? ''} onChange={(e) => setFicha((f) => ({ ...f, cliente_nome: e.target.value }))} />
          </Campo>
          <Campo label="Engenheiro responsável">
            <input className={inp} value={ficha.engenheiro_responsavel ?? ''} onChange={(e) => setFicha((f) => ({ ...f, engenheiro_responsavel: e.target.value }))} />
          </Campo>
          <Campo label="Data do projeto">
            <input type="date" className={inp} value={ficha.data_projeto ?? ''} onChange={(e) => setFicha((f) => ({ ...f, data_projeto: e.target.value }))} />
          </Campo>
          <Campo label="Endereço da obra"><input className={inp} value={ficha.obra_endereco ?? ''} onChange={(e) => setFicha((f) => ({ ...f, obra_endereco: e.target.value }))} /></Campo>
          <div className="grid grid-cols-[1fr_80px] gap-2">
            <Campo label="Cidade"><input className={inp} value={ficha.obra_cidade ?? ''} onChange={(e) => setFicha((f) => ({ ...f, obra_cidade: e.target.value }))} /></Campo>
            <Campo label="UF"><input className={inp} maxLength={2} value={ficha.obra_uf ?? ''} onChange={(e) => setFicha((f) => ({ ...f, obra_uf: e.target.value.toUpperCase().slice(0, 2) }))} /></Campo>
          </div>
        </div>
        <Campo label="Observações">
          <textarea className={inp} rows={2} value={ficha.observacoes ?? ''} onChange={(e) => setFicha((f) => ({ ...f, observacoes: e.target.value }))} />
        </Campo>
        <div className="flex justify-end">
          <button onClick={salvarFicha} disabled={salvandoFicha} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: ESP, color: '#fff', opacity: salvandoFicha ? 0.6 : 1 }}>
            <Check size={14} /> {salvandoFicha ? 'Salvando…' : 'Salvar ficha'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-[#E7DECF] overflow-hidden">
        <div className="p-3 flex items-center justify-between border-b border-[#E7DECF]">
          <div className="text-sm font-semibold text-[#3D2314]">Medições / Histórico ({ambientes.length} ambientes)</div>
          <div className="text-xs" style={{ color: ESP60 }}>
            Área total: <b className="text-[#3D2314]">{areaTotalAmbientes.toFixed(1)} m²</b>
          </div>
        </div>
        {ambientes.length === 0 ? (
          <div className="p-6 text-center text-sm" style={{ color: ESP60 }}>
            Sem ambientes ainda. Clique em <b>Analisar com IA</b> para extrair.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs" style={{ color: ESP60, background: BG }}>
                <tr>
                  <th className="text-left p-2">Ambiente</th>
                  <th className="text-right p-2">m²</th>
                  <th className="text-right p-2">ml</th>
                  <th className="text-right p-2">pé-dir.</th>
                  <th className="p-2">Confiança</th>
                  <th className="p-2">Serviço</th>
                  <th className="p-2">Confirmado</th>
                </tr>
              </thead>
              <tbody>
                {ambientes.map((a) => {
                  const cor = a.confianca === 'alta' ? GREEN : a.confianca === 'baixa' ? RED : YELLOW
                  return (
                    <tr key={a.id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td className="p-2"><input className={inp} value={a.nome} onChange={(e) => atualizarAmb(a, { nome: e.target.value })} /></td>
                      <td className="p-2"><input className={inp + ' text-right'} inputMode="decimal" value={a.area_m2 ?? ''} onChange={(e) => atualizarAmb(a, { area_m2: e.target.value ? Number(e.target.value) : null })} /></td>
                      <td className="p-2"><input className={inp + ' text-right'} inputMode="decimal" value={a.perimetro_ml ?? ''} onChange={(e) => atualizarAmb(a, { perimetro_ml: e.target.value ? Number(e.target.value) : null })} /></td>
                      <td className="p-2"><input className={inp + ' text-right'} inputMode="decimal" value={a.pe_direito_m ?? ''} onChange={(e) => atualizarAmb(a, { pe_direito_m: e.target.value ? Number(e.target.value) : null })} /></td>
                      <td className="p-2 text-center"><span className="text-[10px] uppercase px-2 py-0.5 rounded-full text-white" style={{ background: cor }}>{a.confianca}</span></td>
                      <td className="p-2">
                        <select className={inp} value={a.servico_id ?? ''} onChange={(e) => atualizarAmb(a, { servico_id: e.target.value || null })}>
                          <option value="">—</option>
                          {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}{s.unidade ? ` (${s.unidade})` : ''}</option>)}
                        </select>
                      </td>
                      <td className="p-2 text-center">{a.confirmado ? <span style={{ color: GREEN }}>✓</span> : <input type="checkbox" onChange={(e) => atualizarAmb(a, { confirmado: e.target.checked })} />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <button onClick={() => router.push('/dashboard/projetos/takeoff')} className="text-sm text-[#3D2314]/60 hover:underline">
        ← Voltar para o acervo
      </button>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wide mb-1" style={{ color: ESP60 }}>{label}</label>
      {children}
    </div>
  )
}

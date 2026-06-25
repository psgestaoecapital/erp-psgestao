'use client'
import { useCallback, useEffect, useState } from 'react'
import { UploadCloud, Sparkles, Check, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// padrao ps_empresa_sel com polling (mesmo das outras telas verticais)
function useEmpresaSelecionada(): { companyId: string | null } {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setCompanyId(read())
    const t = setInterval(() => {
      const v = read()
      setCompanyId((prev) => (prev === v ? prev : v))
    }, 800)
    return () => clearInterval(t)
  }, [])
  return { companyId }
}

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'
const GREEN = '#5C8D3F'
const YELLOW = '#C8941A'
const RED = '#C44536'

type Orc = { id: string; numero: string | null; cliente_nome: string | null; status: string }
type Servico = { id: string; codigo: string | null; nome: string; unidade: string | null; custo_unitario_total: number | null }
type Planta = { id: string; nome: string; status: string; area_total_m2: number | null; ia_erro: string | null; arquivo_path: string | null; arquivo_tipo: string | null }
type Ambiente = {
  id: string; nome: string; area_m2: number | null; perimetro_ml: number | null; pe_direito_m: number | null;
  confianca: 'alta' | 'media' | 'baixa'; confirmado: boolean;
  servico_id: string | null; base_calculo: 'area' | 'perimetro' | 'pe_direito_parede';
}

const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // 20 MB
const PDF_RENDER_SCALE = 2 // ~200 DPI — suficiente pra IA ler cotas

// Converte a 1a pagina de um PDF em PNG via pdfjs (dynamic import — fora do bundle inicial).
// Worker servido de /public/pdf.worker.min.mjs (copiado pelo postinstall, sempre na MESMA
// versao do pdfjs-dist instalado — evita 'fake worker' nao funcionar e mismatch CDN).
async function pdfPagina1ParaPng(pdfBytes: Uint8Array): Promise<{ blob: Blob; pages: number }> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  }
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    isEvalSupported: false,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0])
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D nao disponivel.')
  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
  } as unknown as Parameters<typeof page.render>[0]).promise
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar PNG.'))), 'image/png')
  })
  return { blob, pages: pdf.numPages }
}

export default function TakeoffPage() {
  const { companyId } = useEmpresaSelecionada()
  const [orcamentos, setOrcamentos] = useState<Orc[]>([])
  const [orcId, setOrcId] = useState<string>('')
  const [servicos, setServicos] = useState<Servico[]>([])
  const [planta, setPlanta] = useState<Planta | null>(null)
  const [ambientes, setAmbientes] = useState<Ambiente[]>([])
  const [escala, setEscala] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    ;(async () => {
      const { data: o } = await supabase.from('erp_orcamentos').select('id,numero,cliente_nome,status')
        .eq('company_id', companyId).in('status', ['rascunho', 'enviado', 'aprovado']).order('created_at', { ascending: false }).limit(50)
      const { data: s } = await supabase.from('projetos_servicos').select('id,codigo,nome,unidade,custo_unitario_total')
        .eq('company_id', companyId).eq('ativo', true).order('nome').limit(500)
      if (!alive) return
      setOrcamentos((o as Orc[]) ?? [])
      setServicos((s as Servico[]) ?? [])
    })()
    return () => { alive = false }
  }, [companyId])

  const recarregarAmbientes = useCallback(async (plantaId: string) => {
    const { data } = await supabase.from('erp_obra_planta_ambiente')
      .select('id,nome,area_m2,perimetro_ml,pe_direito_m,confianca,confirmado,servico_id,base_calculo')
      .eq('planta_id', plantaId).order('nome')
    setAmbientes((data as Ambiente[]) ?? [])
  }, [])

  const recarregarPlanta = useCallback(async (plantaId: string) => {
    const { data } = await supabase.from('erp_obra_planta')
      .select('id,nome,status,area_total_m2,ia_erro,arquivo_path,arquivo_tipo').eq('id', plantaId).single()
    setPlanta(data as Planta)
  }, [])

  const enviarPlanta = async (file: File) => {
    if (!companyId) return
    setBusy(true); setErro(null); setMsg(null); setAmbientes([])
    try {
      const lower = file.name.toLowerCase()
      // DWG: orienta exportar pra PDF/imagem (RD-42: conversor pago fica pra depois)
      if (/\.dwg$/i.test(lower)) {
        throw new Error('Arquivos DWG (AutoCAD) ainda nao sao suportados. Exporte a planta como PDF ou PNG/JPG no seu CAD e suba aqui.')
      }
      if (!/\.(pdf|png|jpe?g)$/i.test(lower)) {
        throw new Error('Formato nao suportado. Envie PDF, PNG ou JPG.')
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        const mb = (file.size / (1024 * 1024)).toFixed(1)
        throw new Error(`Arquivo grande demais (${mb} MB). Limite: 20 MB.`)
      }
      const tipo = /\.pdf$/i.test(lower) ? 'pdf'
        : /\.jpe?g$/i.test(lower) ? 'jpg'
          : 'png'
      const extMatch = lower.match(/\.(pdf|png|jpe?g)$/i)
      const ext = extMatch ? extMatch[1] : tipo
      const plantaId = crypto.randomUUID()
      // Key segura no Storage: SEM nome original (espacos/acentos/especiais
      // disparam "Invalid key"). Usa uuid + extensao. Nome original vai
      // como metadado em erp_obra_planta.nome (display).
      const path = `${companyId}/${plantaId}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('projetos-plantas').upload(path, file, {
        upsert: false, contentType: file.type || undefined,
      })
      if (up.error) {
        const m = /invalid key|key/i.test(up.error.message)
          ? 'Nao foi possivel enviar o arquivo (nome com caracteres invalidos). Tente renomear sem acentos/espacos.'
          : `Falha no envio: ${up.error.message}`
        throw new Error(m)
      }
      const { data: pid, error } = await supabase.rpc('fn_takeoff_planta_salvar', {
        p_company_id: companyId, p_nome: file.name, p_arquivo_path: path, p_arquivo_tipo: tipo,
        p_orcamento_id: orcId || null, p_escala: escala || null,
      })
      if (error) throw error
      const idFinal = (pid as string)
      await recarregarPlanta(idFinal)
      setMsg('Planta enviada. Clique em Analisar para extrair os ambientes.')
    } catch (e) {
      setErro((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const analisar = async () => {
    if (!planta || !companyId) return
    const arquivoPath = planta.arquivo_path
    if (!arquivoPath) {
      setErro('Caminho do arquivo nao encontrado. Reenvie a planta.')
      return
    }
    const ehPdf = planta.arquivo_tipo === 'pdf' || arquivoPath.toLowerCase().endsWith('.pdf')

    setBusy(true); setErro(null); setMsg(ehPdf ? 'Convertendo PDF para imagem…' : 'Analisando com IA…')
    try {
      // 1) Resolve o path da imagem que a IA vai analisar.
      //    - PNG/JPG: o proprio arquivo.
      //    - PDF: converte a 1a pagina pra PNG no browser, sobe no bucket
      //      como <path>_p1.png, e usa esse path.
      let imagemPath = arquivoPath
      let media: 'image/png' | 'image/jpeg' = 'image/png'
      let pages = 1

      if (ehPdf) {
        const { data: dl, error: dle } = await supabase.storage.from('projetos-plantas').download(arquivoPath)
        if (dle || !dl) throw dle ?? new Error('Falha ao baixar planta')
        const pdfBytes = new Uint8Array(await dl.arrayBuffer())
        const r = await pdfPagina1ParaPng(pdfBytes)
        pages = r.pages
        const pngPath = arquivoPath.replace(/\.[^./]+$/, '_p1.png')
        const pngBytes = new Uint8Array(await r.blob.arrayBuffer())
        const up = await supabase.storage.from('projetos-plantas').upload(pngPath, pngBytes, {
          upsert: true, contentType: 'image/png',
        })
        if (up.error) throw new Error(`Falha ao salvar imagem convertida: ${up.error.message}`)
        imagemPath = pngPath
        media = 'image/png'
        setMsg(pages > 1 ? `PDF de ${pages} paginas — analisando a pagina 1…` : 'Analisando com IA…')
      } else {
        media = /\.jpe?g$/i.test(arquivoPath) || planta.arquivo_tipo === 'jpg' ? 'image/jpeg' : 'image/png'
      }

      // 2) Chama a edge mandando apenas o path (payload pequeno, sem base64
      //    no body — evita "Failed to send a request to the Edge Function").
      //    A edge baixa do bucket via service role e manda pra IA.
      const { data, error } = await supabase.functions.invoke('takeoff-planta-ia', {
        body: {
          planta_id: planta.id,
          company_id: companyId,
          arquivo_path: imagemPath,
          media_type: media,
          escala_hint: escala || null,
        },
      })
      if (error) throw error
      const r = data as { ok: boolean; erro?: string }
      if (!r.ok) throw new Error(r.erro || 'Erro IA')
      await recarregarPlanta(planta.id)
      await recarregarAmbientes(planta.id)
      setMsg(ehPdf && pages > 1
        ? `Ambientes extraidos da pagina 1 (PDF tem ${pages} paginas). Revise, vincule um servico e confirme.`
        : 'Ambientes extraidos. Revise, vincule um servico e confirme.')
    } catch (e) {
      setErro((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const atualizarAmb = async (a: Ambiente, patch: Partial<Ambiente>) => {
    const next = { ...a, ...patch }
    setAmbientes((prev) => prev.map((x) => (x.id === a.id ? next : x)))
    if (!companyId) return
    await supabase.rpc('fn_takeoff_ambiente_atualizar', {
      p_company_id: companyId, p_id: a.id,
      p_nome: next.nome, p_area_m2: next.area_m2, p_perimetro_ml: next.perimetro_ml, p_pe_direito_m: next.pe_direito_m,
      p_servico_id: next.servico_id, p_base_calculo: next.base_calculo, p_confirmado: next.confirmado,
    })
  }

  const gerarOrcamento = async () => {
    if (!companyId || !planta || !orcId) { setErro('Selecione um orcamento antes de gerar.'); return }
    const prontos = ambientes.filter((a) => a.confirmado && a.servico_id)
    if (prontos.length === 0) { setErro('Confirme ao menos 1 ambiente com servico vinculado.'); return }
    setBusy(true); setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_takeoff_gerar_orcamento', {
        p_company_id: companyId, p_planta_id: planta.id, p_orcamento_id: orcId,
      })
      if (error) throw error
      setMsg(`Orcamento atualizado: ${data} itens criados.`)
    } catch (e) {
      setErro((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const totalEstimado = ambientes.reduce((s, a) => {
    if (!a.confirmado || !a.servico_id) return s
    const sv = servicos.find((x) => x.id === a.servico_id)
    if (!sv) return s
    const qtd = a.base_calculo === 'perimetro' ? (a.perimetro_ml ?? 0)
      : a.base_calculo === 'pe_direito_parede' ? (a.perimetro_ml ?? 0) * (a.pe_direito_m ?? 0)
      : (a.area_m2 ?? 0)
    return s + qtd * (sv.custo_unitario_total ?? 0)
  }, 0)

  if (!companyId) return (
    <div className="min-h-screen bg-[#FAF7F2] p-6 text-sm text-[#3D2314]/60">
      Selecione uma empresa especifica no topo do menu para abrir o takeoff.
    </div>
  )

  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white p-2 text-sm text-[#3D2314]'
  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 space-y-4 max-w-4xl mx-auto">
      <header>
        <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: GOLD }}>Construção · diferencial IA</div>
        <h1 className="text-2xl sm:text-3xl mt-1 text-[#3D2314]" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Takeoff por IA da planta</h1>
        <p className="text-sm mt-1" style={{ color: ESP60 }}>Suba a planta → a IA extrai ambientes e medidas → você revisa, vincula serviços e gera o orçamento.</p>
      </header>

      <section className="rounded-2xl bg-white p-4 border border-[#E7DECF] space-y-2">
        <label className="block text-xs font-medium" style={{ color: ESP }}>Orçamento de destino</label>
        <select className={inp} value={orcId} onChange={(e) => setOrcId(e.target.value)}>
          <option value="">— selecione (ou crie em /dashboard/projetos/propostas) —</option>
          {orcamentos.map((o) => (
            <option key={o.id} value={o.id}>{o.numero ?? o.id.slice(0, 8)} · {o.cliente_nome ?? 'sem cliente'} · {o.status}</option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <input className={inp} placeholder="Escala (ex.: 1:50) — opcional" value={escala} onChange={(e) => setEscala(e.target.value)} />
          <label className="rounded-xl border border-dashed border-[#E7DECF] bg-[#FAF7F2] p-2 text-sm text-center cursor-pointer text-[#3D2314] flex items-center justify-center gap-2">
            <UploadCloud size={15} />
            <span>{planta?.nome ?? 'Enviar planta (PNG/JPG/PDF)'}</span>
            <input type="file" accept=".png,.jpg,.jpeg,.pdf" className="hidden" onChange={(e) => e.target.files && enviarPlanta(e.target.files[0])} />
          </label>
        </div>

        {planta && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="text-xs px-2 py-1 rounded-full" style={{ background: BG, border: `1px solid ${LINE}`, color: ESP }}>
              status: <b>{planta.status}</b>
            </span>
            {planta.area_total_m2 !== null && planta.area_total_m2 > 0 && (
              <span className="text-xs px-2 py-1 rounded-full" style={{ background: BG, border: `1px solid ${LINE}`, color: ESP }}>
                área total: <b>{planta.area_total_m2} m²</b>
              </span>
            )}
            <button onClick={analisar} disabled={busy || planta.status === 'processando'} className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
              <Sparkles size={15} /> Analisar com IA
            </button>
          </div>
        )}
      </section>

      <div className="rounded-xl p-3 text-xs border" style={{ background: '#FFFBEF', borderColor: '#F0E1B8', color: '#7A5A0B' }}>
        ⚠️ A IA sugere as medições. <b>Confira antes de gerar o orçamento.</b>
      </div>

      {msg && <div className="rounded-xl p-3 text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>{msg}</div>}
      {erro && <div className="rounded-xl p-3 text-sm flex items-start gap-2" style={{ background: '#FEE', border: '1px solid #FBB', color: '#A65A3A' }}><AlertTriangle size={14} className="mt-0.5" /> {erro}</div>}

      {ambientes.length > 0 && (
        <section className="rounded-2xl bg-white border border-[#E7DECF] overflow-hidden">
          <div className="p-3 text-sm font-semibold text-[#3D2314] border-b border-[#E7DECF]">Ambientes extraídos</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs" style={{ color: ESP60, background: BG }}>
                <tr>
                  <th className="text-left p-2">Nome</th>
                  <th className="text-right p-2">m²</th>
                  <th className="text-right p-2">ml</th>
                  <th className="text-right p-2">pé-dir.</th>
                  <th className="p-2">Confiança</th>
                  <th className="p-2">Serviço</th>
                  <th className="p-2">Base</th>
                  <th className="p-2">OK</th>
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
                      <td className="p-2">
                        <select className={inp} value={a.base_calculo} onChange={(e) => atualizarAmb(a, { base_calculo: e.target.value as Ambiente['base_calculo'] })}>
                          <option value="area">Área</option>
                          <option value="perimetro">Perímetro</option>
                          <option value="pe_direito_parede">Parede</option>
                        </select>
                      </td>
                      <td className="p-2 text-center"><input type="checkbox" checked={a.confirmado} onChange={(e) => atualizarAmb(a, { confirmado: e.target.checked })} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E7DECF]" style={{ background: BG }}>
            <div className="text-sm">
              <span style={{ color: ESP60 }}>Estimado:</span> <b className="text-[#3D2314]">{money(totalEstimado)}</b>
            </div>
            <button onClick={gerarOrcamento} disabled={busy || !orcId} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: ESP, color: '#fff', opacity: (busy || !orcId) ? 0.6 : 1 }}>
              <Check size={15} /> Gerar itens no orçamento
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

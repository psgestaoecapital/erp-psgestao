'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { UploadCloud, Sparkles, Check, AlertTriangle, Archive } from 'lucide-react'
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
type Planta = {
  id: string; nome: string; status: string; area_total_m2: number | null;
  ia_erro: string | null; arquivo_path: string | null; arquivo_tipo: string | null;
  arquivo_dwg_path: string | null;
  aps_status: 'traduzindo' | 'radiografado' | 'erro' | null;
  aps_diagnostico: Record<string, unknown> | null;
  aps_traduzido_em: string | null;
  analisado_em: string | null;
  analisado_por: string | null;
}
type Ambiente = {
  id: string; nome: string; area_m2: number | null; perimetro_ml: number | null; pe_direito_m: number | null;
  confianca: 'alta' | 'media' | 'baixa'; confirmado: boolean;
  servico_id: string | null; base_calculo: 'area' | 'perimetro' | 'pe_direito_parede';
}

type DiagCad = {
  total_views?: number
  n_objetos?: number
  tem_area_prop?: boolean
  layers?: Array<{ nome: string; count: number }>
  views?: Array<{ name: string; role?: string; type?: string }>
  view_escolhida?: { name?: string; role?: string }
}

function FichaCad({ diag, analisadoEm }: { diag: DiagCad; analisadoEm: string | null }) {
  const layers = (diag.layers ?? []).slice(0, 12)
  const rest = Math.max(0, (diag.layers?.length ?? 0) - layers.length)
  return (
    <div className="mt-3 rounded-xl border p-3 space-y-3" style={{ borderColor: LINE, background: '#FFFFFF' }}>
      <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: GOLD }}>Ficha da análise CAD</div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MiniCard label="Analisado em" value={analisadoEm ? new Date(analisadoEm).toLocaleString('pt-BR') : '—'} />
        <MiniCard label="Views" value={String(diag.total_views ?? '—')} />
        <MiniCard label="Objetos" value={String(diag.n_objetos ?? '—')} />
        <MiniCard label="Área nativa" value={diag.tem_area_prop ? 'sim' : 'não'} />
      </div>

      {layers.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: ESP60 }}>Layers detectadas</div>
          <ul className="text-xs divide-y" style={{ color: ESP, borderColor: LINE }}>
            {layers.map((l) => (
              <li key={l.nome} className="flex items-center justify-between py-1">
                <span className="truncate mr-2">{l.nome}</span>
                <span className="tabular-nums" style={{ color: ESP60 }}>{l.count}</span>
              </li>
            ))}
          </ul>
          {rest > 0 && <div className="text-[11px] mt-1" style={{ color: ESP60 }}>+ {rest} outras layers</div>}
        </div>
      )}

      {diag.view_escolhida?.name && (
        <div className="text-[11px]" style={{ color: ESP60 }}>
          View escolhida: <b style={{ color: ESP }}>{diag.view_escolhida.name}</b>
          {diag.view_escolhida.role && <> · {diag.view_escolhida.role}</>}
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer" style={{ color: ESP60 }}>▶ Avançado (JSON completo)</summary>
        <pre className="text-[10px] mt-2 p-2 rounded overflow-auto max-h-64" style={{ background: BG }}>
{JSON.stringify(diag, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2 text-center" style={{ background: BG, border: `0.5px solid ${LINE}` }}>
      <div className="text-[9px] uppercase tracking-widest" style={{ color: ESP60 }}>{label}</div>
      <div className="text-sm mt-1 font-medium" style={{ color: ESP }}>{value}</div>
    </div>
  )
}

const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // 20 MB (PDF/PNG/JPG)
const MAX_UPLOAD_DWG_BYTES = 60 * 1024 * 1024 // 60 MB (DWG geralmente maior)
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
  const searchParams = useSearchParams()
  const plantaIdParam = searchParams?.get('planta_id') ?? null
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

  // Se veio ?planta_id=... (vindo do acervo), carrega essa planta direto.
  useEffect(() => {
    if (!companyId || !plantaIdParam) return
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('erp_obra_planta')
        .select('id')
        .eq('id', plantaIdParam).eq('company_id', companyId).maybeSingle()
      if (!alive || !data) return
      await recarregarPlanta(plantaIdParam)
      await recarregarAmbientes(plantaIdParam)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, plantaIdParam])

  // Guard de abertura (PR-FIX #2): quando o usuario seleciona um orcamento, se ja
  // existe planta RADIOGRAFADA vinculada a esse orcamento, carrega ela ao inves
  // de deixar a tela vazia esperando upload. Sem isso, ele reuploada e "some" o
  // radiografado (caso Tryo/MAGNUS).
  useEffect(() => {
    if (!companyId || !orcId) return
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('erp_obra_planta')
        .select('id,aps_status,updated_at')
        .eq('company_id', companyId).eq('orcamento_id', orcId)
        .not('aps_status', 'is', null)
        .order('aps_status', { ascending: true }) // radiografado vem antes de traduzindo (ordem alfabetica)
        .order('updated_at', { ascending: false })
        .limit(1)
      if (!alive) return
      const primeiro = (data ?? [])[0] as { id: string; aps_status: string | null } | undefined
      if (primeiro?.aps_status === 'radiografado' && (!planta || planta.id !== primeiro.id)) {
        await recarregarPlanta(primeiro.id)
        await recarregarAmbientes(primeiro.id)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, orcId])

  const recarregarAmbientes = useCallback(async (plantaId: string) => {
    const { data } = await supabase.from('erp_obra_planta_ambiente')
      .select('id,nome,area_m2,perimetro_ml,pe_direito_m,confianca,confirmado,servico_id,base_calculo')
      .eq('planta_id', plantaId).order('nome')
    setAmbientes((data as Ambiente[]) ?? [])
  }, [])

  const recarregarPlanta = useCallback(async (plantaId: string) => {
    const { data } = await supabase.from('erp_obra_planta')
      .select('id,nome,status,area_total_m2,ia_erro,arquivo_path,arquivo_tipo,arquivo_dwg_path,aps_status,aps_diagnostico,aps_traduzido_em,analisado_em,analisado_por')
      .eq('id', plantaId).single()
    setPlanta(data as Planta)
  }, [])

  const enviarPlanta = async (file: File, forcarNovaVersao = false) => {
    if (!companyId) return
    setBusy(true); setErro(null); setMsg(null); setAmbientes([])
    try {
      const lower = file.name.toLowerCase()
      const ehDwg = /\.dwg$/i.test(lower)
      if (!ehDwg && !/\.(pdf|png|jpe?g)$/i.test(lower)) {
        throw new Error('Formato nao suportado. Envie DWG (CAD), PDF, PNG ou JPG.')
      }
      const limite = ehDwg ? MAX_UPLOAD_DWG_BYTES : MAX_UPLOAD_BYTES
      if (file.size > limite) {
        const mb = (file.size / (1024 * 1024)).toFixed(1)
        throw new Error(`Arquivo grande demais (${mb} MB). Limite: ${(limite / (1024 * 1024)).toFixed(0)} MB.`)
      }
      const tipo = ehDwg ? 'dwg'
        : /\.pdf$/i.test(lower) ? 'pdf'
        : /\.jpe?g$/i.test(lower) ? 'jpg'
        : 'png'
      const extMatch = lower.match(/\.(dwg|pdf|png|jpe?g)$/i)
      const ext = extMatch ? extMatch[1] : tipo

      // 1) hash SHA-256 dos bytes — dedup por conteudo, nao por nome/UUID
      const bytes = new Uint8Array(await file.arrayBuffer())
      const hashBuf = await crypto.subtle.digest('SHA-256', bytes)
      const hash = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0')).join('')

      // 2) Existe planta com esse hash nessa company? Preferencia: radiografada.
      if (!forcarNovaVersao) {
        setMsg('Verificando se essa planta ja foi analisada...')
        const { data: existentes, error: procErr } = await supabase.rpc('fn_takeoff_planta_procurar_por_hash', {
          p_company_id: companyId, p_arquivo_hash: hash,
        })
        if (!procErr && Array.isArray(existentes) && existentes.length > 0) {
          const ja = existentes[0] as {
            id: string; nome: string; aps_status: string | null; analisado_em: string | null
          }
          if (ja.aps_status === 'radiografado') {
            const dt = ja.analisado_em ? new Date(ja.analisado_em).toLocaleString('pt-BR') : 'antes'
            const ok = window.confirm(
              `Esta planta ja foi analisada em ${dt}.\n\n` +
              `OK = REUSAR a analise existente (gratis).\n` +
              `Cancelar = subir NOVA VERSAO (paga 1 credito de novo).`
            )
            if (ok) {
              await recarregarPlanta(ja.id)
              await recarregarAmbientes(ja.id)
              setMsg('Analise existente carregada. Nao houve nova cobranca.')
              return
            }
            // Caiu aqui = usuario clicou Cancelar -> forca nova versao. Continua no fluxo.
          } else if (ja.aps_status === 'traduzindo') {
            const ok = window.confirm(
              `Esta planta ja esta sendo processada agora (em traducao).\n\n` +
              `OK = abrir o processamento em andamento.\n` +
              `Cancelar = subir NOVA VERSAO (paga 1 credito de novo).`
            )
            if (ok) {
              await recarregarPlanta(ja.id)
              await recarregarAmbientes(ja.id)
              setMsg('Processamento em andamento carregado.')
              return
            }
          } else {
            // enviada mas nao processada — reusa direto (nao houve cobranca ainda)
            await recarregarPlanta(ja.id)
            await recarregarAmbientes(ja.id)
            setMsg('Planta ja enviada — carregada. Clique em processar.')
            return
          }
        }
      }

      // 3) upload novo
      const plantaId = crypto.randomUUID()
      // Key segura no Storage: SEM nome original (espacos/acentos/especiais
      // disparam "Invalid key"). Usa uuid + extensao. Nome original vai
      // como metadado em erp_obra_planta.nome (display).
      const path = `${companyId}/${plantaId}/${crypto.randomUUID()}.${ext}`
      // Passa o File (nao os bytes) — o SDK do Supabase Storage tira Content-Type
      // do File.type automaticamente. Bytes crus sem contentType explicito
      // quebrava o upload de DWG (browsers nao conhecem MIME de .dwg -> file.type='').
      const contentType = file.type
        || (ehDwg ? 'application/acad'
          : tipo === 'pdf' ? 'application/pdf'
          : tipo === 'jpg' ? 'image/jpeg'
          : 'image/png')
      const up = await supabase.storage.from('projetos-plantas').upload(path, file, {
        upsert: false, contentType,
      })
      if (up.error) {
        const m = /invalid key|key/i.test(up.error.message)
          ? 'Nao foi possivel enviar o arquivo (nome com caracteres invalidos). Tente renomear sem acentos/espacos.'
          : `Falha no envio: ${up.error.message}`
        throw new Error(m)
      }
      const { data: pid, error } = await supabase.rpc('fn_takeoff_planta_salvar', {
        p_company_id: companyId, p_nome: file.name, p_arquivo_path: path, p_arquivo_tipo: tipo,
        p_orcamento_id: orcId || null, p_escala: escala || null, p_arquivo_hash: hash,
      })
      if (error) throw error
      const idFinal = (pid as string)
      if (ehDwg) {
        // Espelha em arquivo_dwg_path (acervo persistente do CAD original) —
        // fn_takeoff_planta_salvar so mexe em arquivo_path.
        await supabase.from('erp_obra_planta').update({ arquivo_dwg_path: path }).eq('id', idFinal)
      }
      await recarregarPlanta(idFinal)
      setMsg(ehDwg
        ? 'DWG enviado e arquivado. Clique em "Processar DWG (precisao CAD)" para radiografar.'
        : 'Planta enviada. Clique em Analisar para extrair os ambientes.')
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

  const processarDwg = async (forcar = false) => {
    if (!planta) return
    if (forcar) {
      const ok = confirm('Reanalisar consome 1 credito APS e conta como analise paga. Continuar?')
      if (!ok) return
    }
    setBusy(true); setErro(null); setMsg('Enviando DWG para o motor de precisao CAD...')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/aps/ingest', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          authorization: session ? `Bearer ${session.access_token}` : '',
        },
        body: JSON.stringify({ planta_id: planta.id, forcar }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.erro || j.detalhe || 'Falha ao processar DWG')
      await recarregarPlanta(planta.id)
      if (j.status === 'traduzindo') {
        setMsg('DWG em traducao no APS — clique em "Processar DWG" de novo em ~1 minuto para concluir.')
      } else if (j.status === 'radiografado') {
        setMsg(j.ja_analisado
          ? 'Analise ja existente carregada do acervo (sem cobrar de novo).'
          : 'DWG radiografado. Ficha do projeto e diagnostico abaixo.')
      }
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

  // FEATURE-TAKEOFF-AMBIENTE-MANUAL (07/07 · Saneamento V1 Fase 3 · destrava
  // tela quebrada): quando o APS nao extrai ambientes (DWG unitless / geometria
  // em blocos, ex BLUE-2023-18 candidatos_ambiente=[]), a tabela vinha vazia e
  // o eng ficava travado. Agora pode adicionar ambiente na mao. Backend:
  // fn_takeoff_ambiente_criar_manual (origem='manual', imune ao DELETE de IA).
  const [addAberto, setAddAberto] = useState(false)
  const adicionarAmbienteManual = async (form: {
    nome: string; area_m2: string; largura_m: string; comprimento_m: string
    perimetro_ml: string; pe_direito_m: string
  }) => {
    if (!companyId || !planta) return
    const num = (v: string) => (v.trim() ? Number(v) : null)
    setBusy(true); setErro(null)
    try {
      const { error } = await supabase.rpc('fn_takeoff_ambiente_criar_manual', {
        p_company_id: companyId,
        p_planta_id: planta.id,
        p_nome: form.nome.trim() || 'Ambiente',
        p_area_m2: num(form.area_m2),
        p_largura_m: num(form.largura_m),
        p_comprimento_m: num(form.comprimento_m),
        p_perimetro_ml: num(form.perimetro_ml),
        p_pe_direito_m: num(form.pe_direito_m),
      })
      if (error) throw error
      setAddAberto(false)
      setMsg('Ambiente adicionado. Vincule um serviço e confirme para gerar o orçamento.')
      await recarregarAmbientes(planta.id)
      await recarregarPlanta(planta.id)
    } catch (e) {
      setErro((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
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
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: GOLD }}>Construção · diferencial IA</div>
          <h1 className="text-2xl sm:text-3xl mt-1 text-[#3D2314]" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Takeoff por IA da planta</h1>
          <p className="text-sm mt-1" style={{ color: ESP60 }}>Suba a planta → a IA extrai ambientes e medidas → você revisa, vincula serviços e gera o orçamento.</p>
        </div>
        <Link
          href="/dashboard/projetos/takeoff/acervo"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold shrink-0"
          style={{ background: '#FFFFFF', color: ESP, border: `0.5px solid ${GOLD}` }}
        >
          <Archive size={13} /> Análises salvas
        </Link>
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
            <span>{planta?.nome ?? 'Enviar planta (DWG/PNG/JPG/PDF)'}</span>
            <input type="file" accept=".dwg,.png,.jpg,.jpeg,.pdf" className="hidden" onChange={(e) => e.target.files && enviarPlanta(e.target.files[0])} />
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
            {planta.arquivo_tipo === 'dwg' && (
              <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{
                background: planta.aps_status === 'radiografado' ? '#DCFCE7'
                  : planta.aps_status === 'traduzindo' ? '#FEF3C7'
                  : planta.aps_status === 'erro' ? '#FEE2E2' : BG,
                color: planta.aps_status === 'radiografado' ? '#16A34A'
                  : planta.aps_status === 'traduzindo' ? '#7A5A0F'
                  : planta.aps_status === 'erro' ? '#A32D2D' : ESP60,
                border: `0.5px solid ${LINE}`,
              }}>
                CAD: <b>{planta.aps_status ?? 'pendente'}</b>
              </span>
            )}
            {planta.arquivo_tipo !== 'dwg' && (
              <button onClick={analisar} disabled={busy || planta.status === 'processando'} className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
                <Sparkles size={15} /> Analisar com IA
              </button>
            )}
            {planta.arquivo_tipo === 'dwg' && planta.aps_status !== 'radiografado' && (
              <button onClick={() => processarDwg(false)} disabled={busy} className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
                <Sparkles size={15} /> {planta.aps_status === 'traduzindo' ? 'Concluir processamento' : 'Processar DWG (precisão CAD)'}
              </button>
            )}
            {planta.arquivo_tipo === 'dwg' && planta.aps_status === 'radiografado' && (
              <button onClick={() => processarDwg(true)} disabled={busy} className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: '#FFFFFF', color: ESP, border: `0.5px solid ${GOLD}`, opacity: busy ? 0.6 : 1 }}>
                Reanalisar (custa 1 crédito)
              </button>
            )}
          </div>
        )}
        {planta?.arquivo_tipo === 'dwg' && planta.aps_status === 'radiografado' && planta.aps_diagnostico && (
          <FichaCad diag={planta.aps_diagnostico as DiagCad} analisadoEm={planta.analisado_em} />
        )}
      </section>

      <div className="rounded-xl p-3 text-xs border" style={{ background: '#FFFBEF', borderColor: '#F0E1B8', color: '#7A5A0B' }}>
        ⚠️ A IA sugere as medições. <b>Confira antes de gerar o orçamento.</b>
      </div>

      {msg && <div className="rounded-xl p-3 text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>{msg}</div>}
      {erro && <div className="rounded-xl p-3 text-sm flex items-start gap-2" style={{ background: '#FEE', border: '1px solid #FBB', color: '#A65A3A' }}><AlertTriangle size={14} className="mt-0.5" /> {erro}</div>}

      {planta && (
        <section className="rounded-2xl bg-white border border-[#E7DECF] overflow-hidden">
          <div className="p-3 flex items-center justify-between gap-2 border-b border-[#E7DECF]">
            <span className="text-sm font-semibold text-[#3D2314]">Ambientes ({ambientes.length})</span>
            <button
              data-testid="takeoff-add-ambiente"
              onClick={() => setAddAberto(true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border"
              style={{ borderColor: GOLD, color: GOLD, background: 'transparent', opacity: busy ? 0.6 : 1 }}
            >
              + Adicionar ambiente
            </button>
          </div>
          {ambientes.length === 0 ? (
            <div className="p-6 text-center text-sm" style={{ color: ESP60 }}>
              Nenhum ambiente extraído da planta. Se o CAD não tinha geometria de área
              (ex.: DWG sem unidade ou tudo em blocos), <b>adicione os ambientes na mão</b> pelo botão acima.
            </div>
          ) : (
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
          )}
          {ambientes.length > 0 && (
          <div className="p-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E7DECF]" style={{ background: BG }}>
            <div className="text-sm">
              <span style={{ color: ESP60 }}>Estimado:</span> <b className="text-[#3D2314]">{money(totalEstimado)}</b>
            </div>
            <button onClick={gerarOrcamento} disabled={busy || !orcId} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: ESP, color: '#fff', opacity: (busy || !orcId) ? 0.6 : 1 }}>
              <Check size={15} /> Gerar itens no orçamento
            </button>
          </div>
          )}
        </section>
      )}

      {addAberto && (
        <AmbienteManualModal
          onFechar={() => setAddAberto(false)}
          onSalvar={adicionarAmbienteManual}
          busy={busy}
        />
      )}
    </div>
  )
}

// FEATURE-TAKEOFF-AMBIENTE-MANUAL: modal de cadastro manual de ambiente.
function AmbienteManualModal({
  onFechar, onSalvar, busy,
}: {
  onFechar: () => void
  onSalvar: (f: { nome: string; area_m2: string; largura_m: string; comprimento_m: string; perimetro_ml: string; pe_direito_m: string }) => void
  busy: boolean
}) {
  const [nome, setNome] = useState('')
  const [areaM2, setAreaM2] = useState('')
  const [largura, setLargura] = useState('')
  const [comprimento, setComprimento] = useState('')
  const [perimetro, setPerimetro] = useState('')
  const [peDireito, setPeDireito] = useState('')

  // Se digita L×C, sugere área e perímetro (o backend recalcula igual, isso é só preview)
  const areaCalc = largura.trim() && comprimento.trim() ? (Number(largura) * Number(comprimento)) : null
  const perimCalc = largura.trim() && comprimento.trim() ? (2 * (Number(largura) + Number(comprimento))) : null

  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white p-2 text-sm text-[#3D2314]'
  const lbl = 'block text-[11px] font-medium mb-1'

  return (
    <div onClick={onFechar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#FAF7F2] rounded-2xl border border-[#E7DECF] w-full max-w-md p-5" style={{ boxShadow: '0 16px 48px rgba(0,0,0,0.25)' }}>
        <h3 className="text-lg font-semibold text-[#3D2314] mb-1">Adicionar ambiente manual</h3>
        <p className="text-[11px] mb-4" style={{ color: ESP60 }}>
          Informe a área direto, ou largura × comprimento que a gente calcula.
        </p>

        <div className="mb-3">
          <label className={lbl} style={{ color: ESP60 }}>Nome do ambiente *</label>
          <input autoFocus className={inp} value={nome} onChange={(e) => setNome(e.target.value)} placeholder='ex: "Sala 01", "Banheiro"' />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={lbl} style={{ color: ESP60 }}>Área (m²)</label>
            <input className={inp + ' text-right'} inputMode="decimal" value={areaM2} onChange={(e) => setAreaM2(e.target.value)} placeholder={areaCalc != null ? areaCalc.toFixed(2) : '0,00'} />
          </div>
          <div>
            <label className={lbl} style={{ color: ESP60 }}>Pé-direito (m)</label>
            <input className={inp + ' text-right'} inputMode="decimal" value={peDireito} onChange={(e) => setPeDireito(e.target.value)} placeholder="2,80" />
          </div>
          <div>
            <label className={lbl} style={{ color: ESP60 }}>Largura (m)</label>
            <input className={inp + ' text-right'} inputMode="decimal" value={largura} onChange={(e) => setLargura(e.target.value)} />
          </div>
          <div>
            <label className={lbl} style={{ color: ESP60 }}>Comprimento (m)</label>
            <input className={inp + ' text-right'} inputMode="decimal" value={comprimento} onChange={(e) => setComprimento(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={lbl} style={{ color: ESP60 }}>Perímetro (ml)</label>
            <input className={inp + ' text-right'} inputMode="decimal" value={perimetro} onChange={(e) => setPerimetro(e.target.value)} placeholder={perimCalc != null ? perimCalc.toFixed(2) : '0,00'} />
          </div>
        </div>

        {areaCalc != null && !areaM2.trim() && (
          <div className="text-[11px] mb-3" style={{ color: '#7A5A0B' }}>
            Área calculada: <b>{areaCalc.toFixed(2)} m²</b> · Perímetro: <b>{perimCalc?.toFixed(2)} ml</b> (L×C)
          </div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onFechar} disabled={busy} className="px-4 py-2 rounded-xl text-sm border border-[#E7DECF] text-[#3D2314]">Cancelar</button>
          <button
            onClick={() => onSalvar({ nome, area_m2: areaM2, largura_m: largura, comprimento_m: comprimento, perimetro_ml: perimetro, pe_direito_m: peDireito })}
            disabled={busy || (!nome.trim())}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: GOLD, opacity: (busy || !nome.trim()) ? 0.6 : 1 }}
          >
            {busy ? 'Salvando…' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

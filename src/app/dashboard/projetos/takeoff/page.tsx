'use client'

// Acervo de Projetos (Takeoff IA). Lista as plantas da empresa
// (RLS multi-tenant). Cada linha abre o detalhe (/takeoff/[id]) com
// ficha editavel, ambientes, ver/baixar e exclusao. Upload de nova
// planta acontece direto aqui no topo — apos upload, redireciona
// pro detalhe pra analisar com IA.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UploadCloud, Search, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

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

type PlantaRow = {
  id: string
  nome: string
  projeto_nome: string | null
  cliente_nome: string | null
  engenheiro_responsavel: string | null
  data_projeto: string | null
  status: string
  area_total_m2: number | null
  arquivo_path: string | null
  arquivo_tipo: string | null
  ambientes_count: number
  created_at: string
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export default function TakeoffAcervoPage() {
  const { companyId } = useEmpresaSelecionada()
  const router = useRouter()
  const [plantas, setPlantas] = useState<PlantaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')
  const [mostrarPendentes, setMostrarPendentes] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [excluindoId, setExcluindoId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase
      .from('erp_obra_planta')
      .select('id, nome, projeto_nome, cliente_nome, engenheiro_responsavel, data_projeto, status, area_total_m2, arquivo_path, arquivo_tipo, created_at, erp_obra_planta_ambiente:erp_obra_planta_ambiente!planta_id(count)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      setErro(error.message)
      setPlantas([])
    } else {
      type Row = Omit<PlantaRow, 'ambientes_count'> & {
        erp_obra_planta_ambiente: { count: number }[] | { count: number } | null
      }
      const lista: PlantaRow[] = ((data as Row[] | null) ?? []).map((r) => {
        const agg = Array.isArray(r.erp_obra_planta_ambiente) ? r.erp_obra_planta_ambiente[0] : r.erp_obra_planta_ambiente
        return { ...r, ambientes_count: agg?.count ?? 0 }
      })
      setPlantas(lista)
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  const enviarPlanta = async (file: File) => {
    if (!companyId) return
    setEnviando(true)
    setErro(null)
    try {
      const lower = file.name.toLowerCase()
      if (/\.dwg$/i.test(lower)) throw new Error('DWG ainda nao suportado. Exporte como PDF/PNG/JPG e suba aqui.')
      if (!/\.(pdf|png|jpe?g)$/i.test(lower)) throw new Error('Formato nao suportado (envie PDF, PNG ou JPG).')
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(`Arquivo grande demais (${(file.size / (1024 * 1024)).toFixed(1)} MB). Limite 20 MB.`)
      }
      const tipo = /\.pdf$/i.test(lower) ? 'pdf' : /\.jpe?g$/i.test(lower) ? 'jpg' : 'png'
      const extMatch = lower.match(/\.(pdf|png|jpe?g)$/i)
      const ext = extMatch ? extMatch[1] : tipo
      const plantaId = crypto.randomUUID()
      const path = `${companyId}/${plantaId}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('projetos-plantas').upload(path, file, {
        upsert: false, contentType: file.type || undefined,
      })
      if (up.error) {
        const m = /invalid key|key/i.test(up.error.message)
          ? 'Nao foi possivel enviar (nome com caracteres invalidos). Renomeie sem acentos/espacos.'
          : `Falha no envio: ${up.error.message}`
        throw new Error(m)
      }
      const { data: pid, error } = await supabase.rpc('fn_takeoff_planta_salvar', {
        p_company_id: companyId, p_nome: file.name, p_arquivo_path: path, p_arquivo_tipo: tipo,
        p_orcamento_id: null, p_escala: null,
      })
      if (error) throw error
      router.push(`/dashboard/projetos/takeoff/${pid as string}`)
    } catch (e) {
      setErro((e as Error).message || String(e))
    } finally {
      setEnviando(false)
    }
  }

  const excluir = async (planta: PlantaRow) => {
    if (!window.confirm(`Excluir a planta "${planta.projeto_nome || planta.nome}"? Esta acao remove o arquivo e as medicoes.`)) return
    setExcluindoId(planta.id)
    try {
      // remove ambientes -> planta -> arquivo no storage
      await supabase.from('erp_obra_planta_ambiente').delete().eq('planta_id', planta.id)
      const { error } = await supabase.from('erp_obra_planta').delete().eq('id', planta.id)
      if (error) throw error
      if (planta.arquivo_path) {
        await supabase.storage.from('projetos-plantas').remove([planta.arquivo_path]).catch(() => {})
      }
      await carregar()
    } catch (e) {
      setErro((e as Error).message || 'Falha ao excluir')
    } finally {
      setExcluindoId(null)
    }
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return plantas.filter((p) => {
      // cleanup: ocultar 'enviada' sem ambientes a nao ser que toggle ligado
      if (!mostrarPendentes && p.status === 'enviada' && p.ambientes_count === 0) return false
      if (!q) return true
      const hay = [p.projeto_nome, p.cliente_nome, p.engenheiro_responsavel, p.nome].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [plantas, busca, mostrarPendentes])

  const fmtData = (iso: string | null) => iso ? iso.split('-').reverse().join('/') : '—'

  if (!companyId) return (
    <div className="min-h-screen bg-[#FAF7F2] p-6 text-sm text-[#3D2314]/60">
      Selecione uma empresa específica no topo do menu para abrir o acervo de projetos.
    </div>
  )

  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 space-y-4 max-w-6xl mx-auto">
      <header>
        <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: GOLD }}>Construção · Takeoff IA</div>
        <h1 className="text-2xl sm:text-3xl mt-1 text-[#3D2314]" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Acervo de projetos</h1>
        <p className="text-sm mt-1" style={{ color: ESP60 }}>Suas plantas, fichas e medições — tudo num lugar. Clique numa linha para abrir o detalhe.</p>
      </header>

      <section className="rounded-2xl bg-white p-4 border border-[#E7DECF] flex flex-wrap items-center gap-2">
        <label className="rounded-xl border border-dashed border-[#E7DECF] bg-[#FAF7F2] px-3 py-2 text-sm cursor-pointer text-[#3D2314] flex items-center gap-2" style={{ opacity: enviando ? 0.6 : 1 }}>
          <UploadCloud size={15} />
          <span>{enviando ? 'Enviando…' : 'Enviar nova planta (PDF/PNG/JPG)'}</span>
          <input type="file" accept=".png,.jpg,.jpeg,.pdf" className="hidden" disabled={enviando}
                 onChange={(e) => e.target.files && enviarPlanta(e.target.files[0])} />
        </label>

        <div className="flex-1 min-w-[200px] relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3D2314]/40" />
          <input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por projeto, cliente ou engenheiro…"
            className="w-full rounded-xl border border-[#E7DECF] bg-white pl-9 pr-3 py-2 text-sm text-[#3D2314]"
          />
        </div>

        <label className="flex items-center gap-2 text-xs" style={{ color: ESP }}>
          <input type="checkbox" checked={mostrarPendentes} onChange={(e) => setMostrarPendentes(e.target.checked)} />
          Mostrar pendentes (sem ambientes)
        </label>
      </section>

      {erro && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#FEE', border: '1px solid #FBB', color: '#A65A3A' }}>
          {erro}
        </div>
      )}

      <section className="rounded-2xl bg-white border border-[#E7DECF] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs" style={{ color: ESP60, background: BG }}>
              <tr>
                <th className="text-left p-3">Projeto</th>
                <th className="text-left p-3">Cliente</th>
                <th className="text-left p-3">Engenheiro</th>
                <th className="text-left p-3">Data</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">m²</th>
                <th className="text-right p-3">Ambientes</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="p-4 text-center text-[#3D2314]/50">Carregando…</td></tr>
              )}
              {!loading && filtradas.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-[#3D2314]/50">
                  Nenhuma planta no acervo. {plantas.length > 0 && !mostrarPendentes && '(há pendentes — ative o toggle pra ver.)'}
                </td></tr>
              )}
              {filtradas.map((p) => (
                <tr key={p.id} className="hover:bg-[#FAF7F2] cursor-pointer" style={{ borderTop: `1px solid ${LINE}` }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button')) return
                      router.push(`/dashboard/projetos/takeoff/${p.id}`)
                    }}>
                  <td className="p-3 text-[#3D2314] font-medium">{p.projeto_nome || p.nome}</td>
                  <td className="p-3" style={{ color: ESP }}>{p.cliente_nome || '—'}</td>
                  <td className="p-3" style={{ color: ESP }}>{p.engenheiro_responsavel || '—'}</td>
                  <td className="p-3" style={{ color: ESP }}>{fmtData(p.data_projeto)}</td>
                  <td className="p-3">
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded-full" style={{
                      background: p.status === 'processada' ? '#DCFCE7' : p.status === 'erro' ? '#FEE2E2' : '#FEF3C7',
                      color: p.status === 'processada' ? '#16A34A' : p.status === 'erro' ? '#A32D2D' : '#7A5A0F',
                    }}>{p.status}</span>
                  </td>
                  <td className="p-3 text-right" style={{ color: ESP }}>{p.area_total_m2 ? p.area_total_m2.toFixed(1) : '—'}</td>
                  <td className="p-3 text-right" style={{ color: ESP }}>{p.ambientes_count}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); void excluir(p) }}
                      disabled={excluindoId === p.id}
                      title="Excluir planta"
                      className="inline-flex items-center justify-center p-1.5 rounded-md hover:bg-[#FEE2E2]"
                      style={{ color: '#A32D2D', opacity: excluindoId === p.id ? 0.5 : 1 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

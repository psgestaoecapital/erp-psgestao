'use client'
// #135 (ajuste 21/10, item 6) · fotos de UMA OS: envio de várias de uma vez (FotosMultiplas) + miniaturas com legenda
// opcional e exclusão. Cada foto vira um registro em erp_os_registro_foto (fn_oficina_registro_salvar, a mesma do
// diagnóstico/execução) e aparece no histórico fotográfico da impressão da OS. Usado na ficha da OS e na execução.
import { useCallback, useEffect, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import FotosMultiplas from './FotosMultiplas'

const ESP = '#3D2314', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)', RED = '#A32D2D'
const BUCKET = 'oficina-recepcao'
const LEGENDA_PADRAO: Record<string, string> = { servico: 'Foto do serviço', diagnostico: 'Foto do diagnóstico', recepcao: 'Foto da recepção' }

type Registro = { id: string; foto_path: string; descricao: string | null; criado_por_nome: string | null; etapa?: string | null; created_at: string; _url?: string | null }

export default function FotosOS({ companyId, osId, etapa = 'servico', listarEtapa, criadoPorNome, podeExcluir = true, chaveEnviar, chaveLegenda, rotaAjuda, testId = 'os-fotos' }: {
  companyId: string | null
  osId: string
  etapa?: 'servico' | 'diagnostico' | 'recepcao'   // etapa gravada nas fotos novas
  listarEtapa?: string | null                       // filtro da lista (null = todas as fotos da OS)
  criadoPorNome?: string | null
  podeExcluir?: boolean
  chaveEnviar: string
  chaveLegenda: string
  rotaAjuda?: string
  testId?: string
}) {
  const [fotos, setFotos] = useState<Registro[]>([])
  const [legendas, setLegendas] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId || !osId) return
    const { data } = await supabase.rpc('fn_oficina_registro_listar', { p_company_id: companyId, p_os_id: osId, p_etapa: listarEtapa ?? null })
    const regs = (data as Registro[]) ?? []
    const comUrl = await Promise.all(regs.map(async (r) => {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(r.foto_path, 3600)
      return { ...r, _url: s?.signedUrl ?? null }
    }))
    setFotos(comUrl)
    setLegendas(Object.fromEntries(comUrl.map((r) => [r.id, r.descricao ?? ''])))
  }, [companyId, osId, listarEtapa])

  useEffect(() => { const t = setTimeout(() => { void carregar() }, 0); return () => clearTimeout(t) }, [carregar])

  const salvarLegenda = async (f: Registro) => {
    const nova = (legendas[f.id] ?? '').trim()
    if (nova === (f.descricao ?? '').trim()) return
    const { data, error } = await supabase.rpc('fn_oficina_registro_legenda', { p_id: f.id, p_descricao: nova || null })
    const r = data as { ok?: boolean; erro?: string; descricao?: string } | null
    if (error || !r?.ok) { setMsg('Legenda não salva: ' + (error?.message ?? r?.erro ?? 'falha')); return }
    setFotos((p) => p.map((x) => (x.id === f.id ? { ...x, descricao: r.descricao ?? nova } : x)))
    setLegendas((p) => ({ ...p, [f.id]: r.descricao ?? nova }))
  }

  const excluir = async (f: Registro) => {
    if (!confirm('Excluir esta foto?\n\nEla sai do histórico fotográfico da OS (some também da impressão).')) return
    const { data, error } = await supabase.rpc('fn_os_foto_excluir', { p_id: f.id })
    const r = data as { sucesso?: boolean; erro?: string; foto_path?: string } | null
    if (error || !r?.sucesso) { setMsg((r?.erro === 'sem_acesso' ? 'Sem permissão para excluir esta foto.' : (error?.message ?? r?.erro ?? 'Falha ao excluir'))); return }
    if (r.foto_path) await supabase.storage.from(BUCKET).remove([r.foto_path])
    setFotos((p) => p.filter((x) => x.id !== f.id))
  }

  return (
    <div data-testid={testId}>
      <FotosMultiplas
        companyId={companyId}
        pasta={`${etapa}/${osId}`}
        rotulo="Fotos"
        chaveAjuda={chaveEnviar}
        rotaAjuda={rotaAjuda}
        testId={`${testId}-enviar`}
        aoSubir={async (foto) => {
          const { data, error } = await supabase.rpc('fn_oficina_registro_salvar', {
            p_company_id: companyId, p_os_id: osId, p_foto_path: foto.path, p_descricao: LEGENDA_PADRAO[etapa],
            p_criado_por_nome: criadoPorNome || null, p_etapa: etapa, p_diagnostico_item_id: null,
          })
          const r = data as { ok?: boolean; erro?: string } | null
          if (error || !r?.ok) throw new Error(error?.message ?? r?.erro ?? 'falha ao ligar a foto à OS')
          return foto
        }}
        aoTerminar={() => { setMsg(null); void carregar() }}
      />
      {msg && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: RED }}>{msg}</div>}
      <div style={{ fontSize: 11.5, color: ESP60, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}><Camera size={13} strokeWidth={1.5} /> {fotos.length} foto(s) nesta OS · aparecem na impressão (histórico fotográfico)</div>
      {fotos.length > 0 && (
        <div data-ajuda={chaveLegenda} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 8, marginTop: 8 }}>
          {fotos.map((f) => (
            <div key={f.id} data-testid={`${testId}-miniatura`} style={{ position: 'relative', border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
              {podeExcluir && (
                <button type="button" onClick={() => void excluir(f)} title="Excluir foto" aria-label="Excluir foto"
                  style={{ position: 'absolute', top: 4, right: 4, zIndex: 2, width: 24, height: 24, borderRadius: 999, border: 'none', background: 'rgba(61,35,20,0.62)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  <X size={13} />
                </button>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {f._url ? <a href={f._url} target="_blank" rel="noopener noreferrer"><img src={f._url} alt={f.descricao ?? 'foto'} style={{ width: '100%', height: 76, objectFit: 'cover', display: 'block' }} /></a>
                : <div style={{ width: '100%', height: 76, background: '#F0EADE' }} />}
              <input value={legendas[f.id] ?? ''} onChange={(e) => setLegendas((p) => ({ ...p, [f.id]: e.target.value }))} onBlur={() => void salvarLegenda(f)}
                placeholder="Legenda (opcional)" aria-label="Legenda da foto" maxLength={200}
                style={{ width: '100%', boxSizing: 'border-box', border: 'none', borderTop: `1px solid ${LINE}`, padding: '6px 7px', fontSize: 11.5, color: ESP, background: '#fff' }} />
            </div>
          ))}
        </div>
      )}
      {fotos.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: ESP60, marginTop: 4 }}>Legenda: toque na linha abaixo da foto <AjudaCampo chave={chaveLegenda} rota={rotaAjuda} /></div>}
    </div>
  )
}

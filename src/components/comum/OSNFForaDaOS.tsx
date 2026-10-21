'use client'
// Chamado #2167 (complemento): na ficha da OS, marca que a nota desta OS foi emitida FORA dela (antes do vínculo
// automático, pelo OMIE, nota avulsa). Todos os campos são opcionais; dá para vincular uma nota autorizada do
// cliente que ainda não está em nenhuma OS. Marcada, a OS sai do "NF pendente" e mostra a etiqueta azul na lista.
// Grava por fn_os_nf_fora_marcar / fn_os_nf_fora_desmarcar (registra quem marcou e quando).
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { NFForaOS } from '@/lib/oficina/osNotaLista'

type NotaSemOS = { tipo: 'nfe' | 'nfse'; id: string; numero: string | null; data_emissao: string | null }

const C = { espresso: '#3D2314', espressoM: '#6B5D4F', border: '#E0D8CC', blue: '#1D4ED8', blueBg: '#EFF6FF', red: '#B91C1C' }
const inp: CSSProperties = { width: '100%', minHeight: 44, padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, color: C.espresso, background: '#FFFFFF' }
const lbl: CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 11, color: C.espressoM, fontWeight: 600, marginBottom: 4 }

const VAZIO = { tipo: '', numero: '', data_nota: '', chave: '', pdf_url: '', observacao: '', vinculo: '' }

export default function OSNFForaDaOS({ osId, companyId }: { osId: string; companyId: string }) {
  const [marcacao, setMarcacao] = useState<NFForaOS | null>(null)
  const [aberto, setAberto] = useState(false)
  const [form, setForm] = useState(VAZIO)
  const [notas, setNotas] = useState<NotaSemOS[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('erp_os_nf_fora')
      .select('tipo, numero, data_nota, chave, pdf_url, observacao, nfe_id, nfse_id, marcado_em')
      .eq('os_id', osId).eq('company_id', companyId).maybeSingle()
    setMarcacao((data as NFForaOS | null) ?? null)
  }, [osId, companyId])

  useEffect(() => { void carregar() }, [carregar])

  async function abrir() {
    setErro(null)
    const m = marcacao
    setForm(m ? {
      tipo: m.tipo ?? '', numero: m.numero ?? '', data_nota: m.data_nota ?? '', chave: m.chave ?? '', pdf_url: m.pdf_url ?? '',
      observacao: m.observacao ?? '', vinculo: m.nfe_id ? `nfe:${m.nfe_id}` : m.nfse_id ? `nfse:${m.nfse_id}` : '',
    } : VAZIO)
    setAberto(true)
    const { data } = await supabase.rpc('fn_os_nf_notas_sem_os', { p_os_id: osId })
    setNotas(((data as { notas?: NotaSemOS[] } | null)?.notas) ?? [])
  }

  async function salvar() {
    setSalvando(true); setErro(null)
    const [vt, vid] = form.vinculo ? form.vinculo.split(':') : ['', '']
    const nota = notas.find((n) => n.id === vid)
    const { data, error } = await supabase.rpc('fn_os_nf_fora_marcar', {
      p_os_id: osId,
      p_dados: {
        tipo: form.tipo || vt || null,
        numero: form.numero || nota?.numero || null,
        data_nota: form.data_nota || nota?.data_emissao?.slice(0, 10) || null,
        chave: form.chave || null, pdf_url: form.pdf_url || null, observacao: form.observacao || null,
        nfe_id: vt === 'nfe' ? vid : null, nfse_id: vt === 'nfse' ? vid : null,
      },
    })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message ?? r?.erro ?? 'Não foi possível marcar.'); return }
    setAberto(false)
    await carregar()
  }

  async function desmarcar() {
    if (!confirm('Desfazer a marcação "NF fora da OS"? A OS volta a aparecer em NF pendente.')) return
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_os_nf_fora_desmarcar', { p_os_id: osId })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message ?? r?.erro ?? 'Não foi possível desfazer.'); return }
    setAberto(false)
    await carregar()
  }

  const set = (k: keyof typeof VAZIO) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <button type="button" onClick={() => void abrir()} data-testid="os-nf-fora-abrir"
          title="A nota desta OS foi emitida por outro caminho? Marque aqui para tirá-la do NF pendente."
          style={{ fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '10px 14px', minHeight: 44, cursor: 'pointer',
            color: C.blue, background: marcacao ? C.blueBg : '#FFFFFF', border: `1px solid ${marcacao ? '#BFDBFE' : C.border}` }}>
          {marcacao ? `NF fora da OS${marcacao.numero ? ` · nº ${marcacao.numero}` : ''} ✓` : 'NF fora da OS'}
        </button>
        <AjudaCampo chave="os.nf_fora.marcar" rota="/dashboard/os" />
      </span>

      {aberto && (
        <div onClick={() => setAberto(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <div onClick={(e) => e.stopPropagation()} data-testid="os-nf-fora-modal"
            style={{ background: '#FFFFFF', borderRadius: 12, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.espresso }}>NF fora da OS</div>
            <div style={{ fontSize: 12, color: C.espressoM }}>
              Todos os campos são opcionais. Ao salvar, a OS sai do &quot;NF pendente&quot; e mostra a etiqueta azul na lista.
            </div>

            {notas.length > 0 && (
              <label style={{ display: 'block' }}>
                <span style={lbl}>Vincular nota do sistema<AjudaCampo chave="os.nf_fora.vincular" rota="/dashboard/os" /></span>
                <select value={form.vinculo} onChange={set('vinculo')} style={inp} data-testid="os-nf-fora-vinculo">
                  <option value="">— nenhuma —</option>
                  {notas.map((n) => (
                    <option key={n.id} value={`${n.tipo}:${n.id}`}>
                      {n.tipo === 'nfe' ? 'NF-e' : 'NFS-e'} {n.numero ?? 's/ nº'}{n.data_emissao ? ` · ${new Date(n.data_emissao).toLocaleDateString('pt-BR')}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <label style={{ display: 'block' }}>
                <span style={lbl}>Tipo<AjudaCampo chave="os.nf_fora.tipo" rota="/dashboard/os" /></span>
                <select value={form.tipo} onChange={set('tipo')} style={inp} data-testid="os-nf-fora-tipo">
                  <option value="">—</option>
                  <option value="nfe">NF-e (peças)</option>
                  <option value="nfse">NFS-e (serviços)</option>
                </select>
              </label>
              <label style={{ display: 'block' }}>
                <span style={lbl}>Número<AjudaCampo chave="os.nf_fora.numero" rota="/dashboard/os" /></span>
                <input value={form.numero} onChange={set('numero')} style={inp} inputMode="numeric" data-testid="os-nf-fora-numero" />
              </label>
              <label style={{ display: 'block' }}>
                <span style={lbl}>Data<AjudaCampo chave="os.nf_fora.data" rota="/dashboard/os" /></span>
                <input type="date" value={form.data_nota} onChange={set('data_nota')} style={inp} data-testid="os-nf-fora-data" />
              </label>
            </div>
            <label style={{ display: 'block' }}>
              <span style={lbl}>Chave de acesso<AjudaCampo chave="os.nf_fora.chave" rota="/dashboard/os" /></span>
              <input value={form.chave} onChange={set('chave')} style={inp} data-testid="os-nf-fora-chave" />
            </label>
            <label style={{ display: 'block' }}>
              <span style={lbl}>Link do PDF<AjudaCampo chave="os.nf_fora.pdf" rota="/dashboard/os" /></span>
              <input type="url" value={form.pdf_url} onChange={set('pdf_url')} style={inp} placeholder="https://…" data-testid="os-nf-fora-pdf" />
            </label>
            <label style={{ display: 'block' }}>
              <span style={lbl}>Observação<AjudaCampo chave="os.nf_fora.observacao" rota="/dashboard/os" /></span>
              <textarea value={form.observacao} onChange={set('observacao')} rows={2} style={{ ...inp, minHeight: 64 }} data-testid="os-nf-fora-obs" />
            </label>

            {marcacao?.marcado_em && (
              <div style={{ fontSize: 11, color: C.espressoM }}>Marcada em {new Date(marcacao.marcado_em).toLocaleString('pt-BR')}.</div>
            )}
            {erro && <div role="alert" style={{ fontSize: 12, color: C.red }}>{erro}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {marcacao && (
                <button type="button" onClick={() => void desmarcar()} disabled={salvando} data-testid="os-nf-fora-desmarcar"
                  style={{ minHeight: 44, padding: '0 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#FFFFFF', color: C.red, cursor: 'pointer' }}>
                  Desfazer marcação
                </button>
              )}
              <button type="button" onClick={() => setAberto(false)}
                style={{ minHeight: 44, padding: '0 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#FFFFFF', color: C.espressoM, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button type="button" onClick={() => void salvar()} disabled={salvando} data-testid="os-nf-fora-salvar"
                style={{ minHeight: 44, padding: '0 16px', borderRadius: 8, border: 'none', background: C.blue, color: '#FFFFFF', fontWeight: 700, cursor: 'pointer', opacity: salvando ? 0.6 : 1 }}>
                {salvando ? 'Salvando…' : 'Marcar NF fora da OS'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

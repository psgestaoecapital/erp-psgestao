'use client'

// Chamado #5167 etapa (b) · Controle "em remessa" de ATIVO IMOBILIZADO dentro de Notas Emitidas.
// Lê fn_fiscal_remessa_ativo_em_aberto (guarda de empresa fail-closed, só leitura, sem custo/margem) e deixa
// registrar o RETORNO (CFOP 1.554/2.554) por fn_fiscal_remessa_ativo_retorno_registrar. Uma remessa some da lista
// "em remessa" quando o retorno é registrado OU quando uma nota de entrada referencia a chave da remessa.
// Mobile 390px: tudo empilha, alvos de toque >= 44px.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { PackageCheck, PackageOpen, ChevronDown, ChevronRight, Loader2, AlertCircle, Undo2, X } from 'lucide-react'

interface RemessaItem {
  nfe_id: string
  chave: string | null
  numero: string | null
  data_emissao: string | null
  destinatario: string | null
  valor_total: number | null
  cfop_saida: string | null
  retornada: boolean
  dias_fora: number | null
  retorno: { retorno_cfop?: string; data_retorno?: string; retorno_numero?: string | null } | null
}

const fmtBRL = (v: number | null) => v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtData = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('pt-BR') } catch { return '—' } }

export default function RemessaAtivoControle({ companyId }: { companyId: string | null }) {
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)
  const [mostrarRetornadas, setMostrarRetornadas] = useState(false)
  const [emAberto, setEmAberto] = useState(0)
  const [retornadas, setRetornadas] = useState(0)
  const [remessas, setRemessas] = useState<RemessaItem[]>([])
  // form de retorno
  const [registrando, setRegistrando] = useState<RemessaItem | null>(null)
  const [cfop, setCfop] = useState<'1554' | '2554'>('1554')
  const [dataRetorno, setDataRetorno] = useState('')
  const [notaNumero, setNotaNumero] = useState('')
  const [notaChave, setNotaChave] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_fiscal_remessa_ativo_em_aberto', {
      p_company_id: companyId, p_de: null, p_ate: null,
    })
    if (error) { setErro('Não foi possível carregar o controle de remessa.'); setLoading(false); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string; em_aberto?: number; retornadas?: number; remessas?: RemessaItem[] }
    if (!r.ok) { setErro(r.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : 'Controle indisponível.'); setLoading(false); return }
    setEmAberto(r.em_aberto ?? 0)
    setRetornadas(r.retornadas ?? 0)
    setRemessas(r.remessas ?? [])
    setLoading(false)
  }, [companyId])

  useEffect(() => { carregar() }, [carregar, reloadKey])

  async function enviarRetorno() {
    if (!companyId || !registrando) return
    setErroForm(null)
    if (!dataRetorno) { setErroForm('Informe a data em que o bem voltou.'); return }
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_fiscal_remessa_ativo_retorno_registrar', {
      p_company_id: companyId,
      p_remessa_nfe_id: registrando.nfe_id,
      p_retorno_cfop: cfop,
      p_data_retorno: dataRetorno,
      p_retorno_chave: notaChave.trim() || null,
      p_retorno_numero: notaNumero.trim() || null,
      p_observacao: obs.trim() || null,
    })
    setSalvando(false)
    const r = (data ?? {}) as { ok?: boolean; mensagem?: string; erro?: string }
    if (error || !r.ok) { setErroForm(r.mensagem || 'Não foi possível registrar o retorno.'); return }
    setRegistrando(null); setDataRetorno(''); setNotaNumero(''); setNotaChave(''); setObs(''); setCfop('1554')
    setReloadKey((k) => k + 1)
  }

  // Sem nenhuma remessa de ativo imobilizado nesta empresa: o controle não é relevante — não ocupa a tela.
  if (!companyId) return null
  if (!loading && emAberto === 0 && retornadas === 0 && !erro) return null

  const visiveis = remessas.filter((r) => mostrarRetornadas || !r.retornada)

  return (
    <div className="bg-white border border-[#3D2314]/10 rounded-xl mb-4 overflow-hidden" data-testid="remessa-ativo-controle">
      <button type="button" onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 min-h-[44px] hover:bg-[#3D2314]/[0.03]">
        <span className="flex items-center gap-2 text-[14px] font-medium text-[#3D2314]">
          {emAberto > 0 ? <PackageOpen size={16} className="text-[#C8941A]" /> : <PackageCheck size={16} className="text-[#2F7D46]" />}
          Remessa de ativo imobilizado
          <AjudaCampo chave="fiscal.remessa_ativo.painel" />
        </span>
        <span className="flex items-center gap-2">
          <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ${emAberto > 0 ? 'bg-[#FBEFD6] text-[#8B5612]' : 'bg-[#E8F3EC] text-[#2F7D46]'}`}>
            {emAberto} em remessa
          </span>
          {aberto ? <ChevronDown size={16} className="text-[#3D2314]/50" /> : <ChevronRight size={16} className="text-[#3D2314]/50" />}
        </span>
      </button>

      {aberto && (
        <div className="border-t border-[#3D2314]/10 px-4 py-3">
          {loading ? (
            <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-[#C8941A]" size={20} /></div>
          ) : erro ? (
            <div className="text-[12.5px] text-[#791F1F] flex items-center gap-2"><AlertCircle size={14} /> {erro}</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <p className="text-[12px] text-[#3D2314]/70">
                  Bens do ativo imobilizado que saíram (CFOP 5.554/6.554) para uso fora do estabelecimento.
                </p>
                <label className="inline-flex items-center gap-1.5 text-[12px] text-[#3D2314]/80 cursor-pointer select-none">
                  <input type="checkbox" checked={mostrarRetornadas} onChange={(e) => setMostrarRetornadas(e.target.checked)} className="accent-[#C8941A]" />
                  Mostrar já retornadas ({retornadas})
                  <AjudaCampo chave="fiscal.remessa_ativo.painel" />
                </label>
              </div>

              {visiveis.length === 0 ? (
                <div className="py-6 text-center text-[12.5px] text-[#3D2314]/60">
                  {emAberto === 0 ? 'Nenhum bem em remessa agora — tudo que saiu já voltou.' : 'Nada para mostrar com este filtro.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {visiveis.map((r) => (
                    <div key={r.nfe_id} className="border border-[#3D2314]/10 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-medium text-[#3D2314]">NF-e {r.numero ?? '—'}</span>
                          <span className="text-[11px] text-[#3D2314]/55">CFOP {r.cfop_saida ?? '—'}</span>
                          {r.retornada ? (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#E8F3EC] text-[#2F7D46]">
                              retornada{r.retorno?.data_retorno ? ` em ${fmtData(r.retorno.data_retorno)}` : ''}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FBEFD6] text-[#8B5612]">
                              {r.dias_fora ?? 0} dias fora <AjudaCampo chave="fiscal.remessa_ativo.dias_fora" />
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] text-[#3D2314]/70 mt-0.5 truncate">
                          {r.destinatario ?? '—'} · {fmtData(r.data_emissao)} · {fmtBRL(r.valor_total)}
                        </div>
                      </div>
                      {!r.retornada && (
                        <button type="button" onClick={() => { setRegistrando(r); setErroForm(null) }}
                          data-testid="remessa-ativo-registrar"
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-[12px] font-semibold rounded-lg border border-[#C8941A]/40 text-[#8B5612] hover:bg-[#FBEFD6] whitespace-nowrap">
                          <Undo2 size={13} /> Registrar retorno
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {registrando && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setRegistrando(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[15px] font-medium text-[#3D2314] flex items-center gap-1.5">
                Registrar retorno <AjudaCampo chave="fiscal.remessa_ativo.registrar_retorno" />
              </h3>
              <button type="button" onClick={() => setRegistrando(null)} className="p-2 -mr-2 text-[#3D2314]/50 hover:text-[#3D2314]"><X size={18} /></button>
            </div>
            <p className="text-[12px] text-[#3D2314]/70 mb-3">NF-e {registrando.numero ?? '—'} · {registrando.destinatario ?? '—'}</p>

            <label className="block mb-3">
              <span className="text-[12px] font-medium text-[#3D2314]/80 flex items-center gap-1.5 mb-1">
                CFOP do retorno <AjudaCampo chave="fiscal.remessa_ativo.retorno_cfop" />
              </span>
              <select value={cfop} onChange={(e) => setCfop(e.target.value as '1554' | '2554')}
                className="w-full px-3 py-2.5 min-h-[44px] text-[13px] border border-[#3D2314]/15 rounded-lg bg-white">
                <option value="1554">1.554 — retorno de dentro do estado</option>
                <option value="2554">2.554 — retorno de fora do estado</option>
              </select>
            </label>

            <label className="block mb-3">
              <span className="text-[12px] font-medium text-[#3D2314]/80 flex items-center gap-1.5 mb-1">
                Voltou em <AjudaCampo chave="fiscal.remessa_ativo.data_retorno" />
              </span>
              <input type="date" value={dataRetorno} onChange={(e) => setDataRetorno(e.target.value)}
                className="w-full px-3 py-2.5 min-h-[44px] text-[13px] border border-[#3D2314]/15 rounded-lg" />
            </label>

            <label className="block mb-3">
              <span className="text-[12px] font-medium text-[#3D2314]/80 flex items-center gap-1.5 mb-1">
                Nº da nota de entrada (opcional) <AjudaCampo chave="fiscal.remessa_ativo.nota_entrada" />
              </span>
              <input type="text" value={notaNumero} onChange={(e) => setNotaNumero(e.target.value)} placeholder="000123"
                className="w-full px-3 py-2.5 min-h-[44px] text-[13px] border border-[#3D2314]/15 rounded-lg" />
            </label>

            <label className="block mb-3">
              <span className="text-[12px] font-medium text-[#3D2314]/80 flex items-center gap-1.5 mb-1">
                Chave da nota de entrada (opcional) <AjudaCampo chave="fiscal.remessa_ativo.nota_entrada" />
              </span>
              <input type="text" value={notaChave} onChange={(e) => setNotaChave(e.target.value)} placeholder="44 dígitos"
                className="w-full px-3 py-2.5 min-h-[44px] text-[13px] border border-[#3D2314]/15 rounded-lg" />
            </label>

            <label className="block mb-3">
              <span className="text-[12px] font-medium text-[#3D2314]/80 flex items-center gap-1.5 mb-1">
                Observação (opcional) <AjudaCampo chave="fiscal.remessa_ativo.observacao" />
              </span>
              <input type="text" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: voltou da obra Canteiro Norte"
                className="w-full px-3 py-2.5 min-h-[44px] text-[13px] border border-[#3D2314]/15 rounded-lg" />
            </label>

            {erroForm && <div className="text-[12px] text-[#791F1F] flex items-start gap-1.5 mb-3"><AlertCircle size={13} className="mt-0.5" /> {erroForm}</div>}

            <div className="flex gap-2">
              <button type="button" onClick={() => setRegistrando(null)}
                className="flex-1 px-3 py-2.5 min-h-[44px] text-[13px] font-medium rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5">Cancelar</button>
              <button type="button" onClick={enviarRetorno} disabled={salvando}
                data-testid="remessa-ativo-confirmar-retorno"
                className="flex-1 px-3 py-2.5 min-h-[44px] text-[13px] font-semibold rounded-lg bg-[#C8941A] text-white hover:bg-[#A77A12] disabled:opacity-60 flex items-center justify-center gap-1.5">
                {salvando ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Registrar retorno
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

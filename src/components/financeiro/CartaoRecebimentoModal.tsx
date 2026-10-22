'use client'

// F2 · "Registrar em cartão": prévia (fn_cartao_calcular) → confirma (fn_cartao_registrar_recebimento).
// #3740: bandeira, modalidade e parcelas obrigatórias; quita o cliente e cria UM título da operadora por parcela
// (bruto, taxa, líquido e data de repasse), cada um com a sua taxa como despesa financeira.
// Taxa/prazo vêm do cadastro (RD-52), nunca digitados; a prévia por parcela usa o mesmo arredondamento do banco.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { parcelasCartao } from '@/lib/financeiro/cartaoParcelas'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.6)', GREEN = '#16A34A', RED = '#B91C1C'
const ROTA_AJUDA = '/dashboard/financeiro/cartao-recebimento'
const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const hoje = () => new Date().toISOString().split('T')[0]
const dataBR = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR')

type Adquirente = { id: string; nome: string }
type Taxa = { bandeira: string; modalidade: string; parcelas_de: number; parcelas_ate: number; ativo?: boolean }
type Calc = { ok: boolean; erro?: string; taxa_percentual?: number; prazo_repasse_dias?: number }

const ERROS: Record<string, string> = {
  taxa_nao_cadastrada: 'Taxa não cadastrada para essa bandeira/modalidade/parcelas. Cadastre em Financeiro › Cartões.',
  bandeira_obrigatoria: 'Escolha a bandeira do cartão.',
  modalidade_obrigatoria: 'Escolha débito ou crédito.',
  parcelas_invalidas: 'Parcelas inválidas (débito é sempre 1x).',
  adquirente_obrigatoria: 'Escolha a operadora.',
  titulo_ja_baixado: 'Este título já tem recebimento registrado. Desfaça a baixa antes de registrar em cartão.',
}

function Rotulo({ txt, chave }: { txt: string; chave: string }) {
  return <label style={{ fontSize: 11, color: ESP60, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>{txt}<AjudaCampo chave={chave} rota={ROTA_AJUDA} /></label>
}

export default function CartaoRecebimentoModal({ companyId, receber, dataVenda, onClose, onSucesso }: {
  companyId: string
  receber: { id: string; descricao: string; valor: number; cliente?: string | null }
  dataVenda?: string
  onClose: () => void
  onSucesso: (msg: string) => void
}) {
  const [adquirentes, setAdquirentes] = useState<Adquirente[]>([])
  const [taxas, setTaxas] = useState<Taxa[]>([])
  const [adq, setAdq] = useState('')
  const [bandeira, setBandeira] = useState('')
  const [modalidade, setModalidade] = useState('')
  const [parcelas, setParcelas] = useState('1')
  const [data, setData] = useState(dataVenda || hoje())
  const [prev, setPrev] = useState<Calc | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_cartao_adquirente_listar', { p_company_id: companyId })
    const list = ((data as { adquirentes?: Adquirente[] } | null)?.adquirentes) ?? []
    setAdquirentes(list)
    setAdq((a) => a || list[0]?.id || '')
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  // bandeiras e parcelas possíveis = as taxas cadastradas da operadora
  useEffect(() => {
    if (!adq) return
    let ignore = false
    void supabase.rpc('fn_cartao_taxa_listar', { p_company_id: companyId, p_adquirente_id: adq }).then(({ data }) => {
      if (ignore) return
      setTaxas((((data as { taxas?: Taxa[] } | null)?.taxas) ?? []).filter((t) => t.ativo !== false))
    })
    return () => { ignore = true }
  }, [companyId, adq])

  const daModalidade = useMemo(() => taxas.filter((t) => t.modalidade === modalidade), [taxas, modalidade])
  const bandeiras = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of daModalidade) if (!m.has(t.bandeira.toLowerCase())) m.set(t.bandeira.toLowerCase(), t.bandeira)
    return [...m.values()].sort((a, b) => a.localeCompare(b))
  }, [daModalidade])
  const maxParcelas = useMemo(() => {
    if (modalidade === 'debito') return 1
    const ts = daModalidade.filter((t) => t.bandeira.toLowerCase() === bandeira.toLowerCase())
    return Math.max(1, ...ts.map((t) => t.parcelas_ate))
  }, [daModalidade, bandeira, modalidade])

  const nParcelas = modalidade === 'debito' ? 1 : Math.min(Math.max(Number(parcelas) || 1, 1), maxParcelas)

  const previa = useCallback(async () => {
    if (!adq || !bandeira || !modalidade) { setPrev(null); return }
    const { data: d, error } = await supabase.rpc('fn_cartao_calcular', {
      p_company_id: companyId, p_adquirente_id: adq, p_bandeira: bandeira, p_modalidade: modalidade,
      p_parcelas: nParcelas, p_valor: receber.valor, p_data_venda: data,
    })
    if (error) { setPrev({ ok: false, erro: error.message }); return }
    setPrev(d as Calc)
  }, [companyId, adq, bandeira, modalidade, nParcelas, receber.valor, data])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void previa() }, [previa])

  const linhas = prev?.ok ? parcelasCartao(receber.valor, nParcelas, Number(prev.taxa_percentual ?? 0), Number(prev.prazo_repasse_dias ?? 0), data) : []
  const totTaxa = r2(linhas.reduce((s, l) => s + l.taxa, 0))
  const totLiq = r2(linhas.reduce((s, l) => s + l.liquido, 0))

  async function confirmar() {
    if (!adq) { setErro(ERROS.adquirente_obrigatoria); return }
    if (!modalidade) { setErro(ERROS.modalidade_obrigatoria); return }
    if (!bandeira) { setErro(ERROS.bandeira_obrigatoria); return }
    setBusy(true); setErro(null)
    const { data: d, error } = await supabase.rpc('fn_cartao_registrar_recebimento', {
      p_company_id: companyId, p_receber_id: receber.id, p_adquirente_id: adq,
      p_bandeira: bandeira, p_modalidade: modalidade, p_parcelas: nParcelas, p_data_venda: data,
    })
    setBusy(false)
    const r = d as { ok?: boolean; erro?: string; adquirente?: string; parcelas?: unknown[] } | null
    if (error || r?.ok === false) {
      setErro((r?.erro && ERROS[r.erro]) || error?.message || r?.erro || 'falha ao registrar')
      return
    }
    const n = r?.parcelas?.length ?? nParcelas
    onSucesso(`Recebimento em cartão registrado: cliente quitado e ${n} ${n === 1 ? 'repasse criado' : 'repasses criados'} em nome de ${r?.adquirente ?? 'operadora'}.`)
  }

  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 13, background: '#fff', color: ESP }
  const th: React.CSSProperties = { textAlign: 'right', padding: '4px 6px', fontWeight: 600, color: ESP60, fontSize: 11 }
  const td: React.CSSProperties = { textAlign: 'right', padding: '4px 6px', fontSize: 12.5, color: ESP }
  const adqNome = adquirentes.find((a) => a.id === adq)?.nome ?? 'a operadora'

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1200 }}>
      <div onClick={(e) => e.stopPropagation()} data-testid="cartao-recebimento-modal" style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 500, padding: 20, border: `0.5px solid ${LINE}`, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: ESP, display: 'flex', alignItems: 'center', gap: 6 }}><CreditCard size={18} strokeWidth={1.5} color={GOLD} />Recebido em cartão</div>
        <div style={{ fontSize: 12, color: ESP60, margin: '2px 0 14px' }}>{receber.descricao} · <b>R$ {brl(receber.valor)}</b></div>

        {adquirentes.length === 0 && (
          <div style={{ fontSize: 12.5, color: '#7A5A0F', background: '#FBF4E4', border: `0.5px solid ${GOLD}55`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
            Nenhuma operadora cadastrada. Cadastre em <b>Financeiro › Cartões</b> antes de registrar.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }} data-ajuda="financeiro.cartao_recebimento.adquirente"><Rotulo txt="Operadora" chave="financeiro.cartao_recebimento.adquirente" />
            <select style={inp} value={adq} onChange={(e) => { setAdq(e.target.value); setBandeira('') }} aria-label="Operadora">
              <option value="">—</option>
              {adquirentes.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </div>
          <div data-ajuda="financeiro.cartao_recebimento.modalidade"><Rotulo txt="Modalidade" chave="financeiro.cartao_recebimento.modalidade" />
            <select style={inp} value={modalidade} onChange={(e) => { setModalidade(e.target.value); setBandeira(''); setParcelas('1') }} aria-label="Modalidade">
              <option value="">Escolha…</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
            </select>
          </div>
          <div data-ajuda="financeiro.cartao_recebimento.bandeira"><Rotulo txt="Bandeira" chave="financeiro.cartao_recebimento.bandeira" />
            <select style={inp} value={bandeira} onChange={(e) => setBandeira(e.target.value)} disabled={!modalidade} aria-label="Bandeira">
              <option value="">{modalidade ? 'Escolha…' : 'Escolha a modalidade'}</option>
              {bandeiras.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div data-ajuda="financeiro.cartao_recebimento.parcelas"><Rotulo txt="Parcelas" chave="financeiro.cartao_recebimento.parcelas" />
            <select style={inp} value={String(nParcelas)} onChange={(e) => setParcelas(e.target.value)} disabled={modalidade !== 'credito'} aria-label="Parcelas">
              {Array.from({ length: maxParcelas }, (_, k) => k + 1).map((k) => <option key={k} value={k}>{k}x</option>)}
            </select>
          </div>
          <div data-ajuda="financeiro.cartao_recebimento.data_venda"><Rotulo txt="Data da venda" chave="financeiro.cartao_recebimento.data_venda" />
            <input style={inp} type="date" value={data} onChange={(e) => setData(e.target.value || hoje())} aria-label="Data da venda" />
          </div>
        </div>

        {/* PRÉVIA */}
        <div style={{ marginTop: 12 }}>
          <Rotulo txt="Prévia dos repasses" chave="financeiro.cartao_recebimento.previa" />
          {prev?.ok ? (
            <div style={{ padding: 12, borderRadius: 8, background: '#EAF5EE', border: `0.5px solid ${GREEN}55`, fontSize: 13, color: ESP, lineHeight: 1.5 }}>
              Cliente quita <b>R$ {brl(receber.valor)}</b>. {adqNome} repassa em <b>{nParcelas}</b> {nParcelas === 1 ? 'parcela' : 'parcelas'} (taxa {brl(prev.taxa_percentual ?? 0)}%):
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                <thead><tr><th style={{ ...th, textAlign: 'left' }}>Parcela</th><th style={th}>Repasse</th><th style={th}>Bruto</th><th style={th}>Taxa</th><th style={th}>Líquido</th></tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.i} data-testid="cartao-previa-parcela">
                      <td style={{ ...td, textAlign: 'left' }}>{l.i}/{nParcelas}</td><td style={td}>{dataBR(l.repasse)}</td>
                      <td style={td}>{brl(l.bruto)}</td><td style={td}>{brl(l.taxa)}</td><td style={{ ...td, fontWeight: 700 }}>{brl(l.liquido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 6, fontSize: 12 }}>Taxa total <b>R$ {brl(totTaxa)}</b> vira despesa financeira · líquido no banco <b>R$ {brl(totLiq)}</b>.</div>
            </div>
          ) : prev && prev.ok === false ? (
            <div style={{ padding: 10, borderRadius: 8, background: '#FEECEC', color: RED, fontSize: 12.5 }}>
              {(prev.erro && ERROS[prev.erro]) || `Erro na prévia: ${prev.erro}`}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: ESP60, background: BG, borderRadius: 8, padding: 10 }}>Escolha a operadora, a modalidade e a bandeira para ver os repasses.</div>
          )}
        </div>

        {erro && <div style={{ marginTop: 10, fontSize: 12.5, color: RED }}>❌ {erro}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', color: ESP60, border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={() => void confirmar()} disabled={busy || !prev?.ok} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: (busy || !prev?.ok) ? 'not-allowed' : 'pointer', opacity: (busy || !prev?.ok) ? 0.5 : 1 }}>{busy ? 'Registrando…' : 'Confirmar recebimento'}</button>
        </div>
      </div>
    </div>
  )
}

'use client'
// RD-41 · Agro/Pecuária — Movimentações do Rebanho: consultar · editar · ESTORNAR · excluir.
// Linguagem do produtor (Pilar 3), mobile-first. Consome as RPCs fn_pec_movimentacoes_listar/obter/
// editar/estornar/excluir (Pilar 2 · tudo por company_id). Estorno é o pedido central: reverte a venda
// e o animal volta ao rebanho, cancelando a receita vinculada (RD-55, com confirmação + motivo).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada, usePropriedade } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.6)'
const GREEN = '#5C8D3F', RED = '#C44536'

const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '—'

// rótulo do produtor por tipo de movimentação
const LABEL_TIPO: Record<string, string> = {
  venda: 'Venda', transferencia: 'Transferência', morte: 'Morte', compra: 'Compra',
  nascimento: 'Nascimento', abate: 'Abate', estorno: 'Estorno', ajuste: 'Ajuste',
}
const rotuloTipo = (t: string) => LABEL_TIPO[t] ?? t

type Mov = {
  grupo_id: string; tipo: string; data: string; qtd: number; qtd_ativos?: number; qtd_estornada?: number; estado?: 'intacta' | 'parcial' | 'estornada'
  contraparte_nome: string | null; valor: number
  lote_origem: string | null; lote_destino: string | null; area_origem: string | null; area_destino: string | null
  estornada: boolean; tem_financeiro: boolean; financeiro_status: string | null
}
type Animal = { animal_id: string; identificacao: string | null; status: string; ativo: boolean; valor: number | null; linha_estornada?: boolean }
type Detalhe = {
  movimentacao: { tipo: string; data: string; qtd: number; qtd_ativos?: number; qtd_estornada?: number; contraparte_nome: string | null; valor: number; peso_kg: number | null; observacao: string | null; lote_origem: string | null; lote_destino: string | null; estornada: boolean; motivo_estorno: string | null; estornada_em: string | null }
  animais: Animal[]
  financeiro: { receber_id: string; valor: number; status: string; descricao: string } | null
}

const TIPOS_FILTRO = [
  { v: '', l: 'Todos os tipos' }, { v: 'venda', l: 'Vendas' }, { v: 'transferencia', l: 'Transferências' },
  { v: 'morte', l: 'Mortes' }, { v: 'compra', l: 'Compras' }, { v: 'estorno', l: 'Estornos' },
]

export default function MovimentacoesPage() {
  const { companyId } = useEmpresaSelecionada()
  const { propriedade } = usePropriedade(companyId)
  const propriedadeId = propriedade?.id ?? null

  const [tipo, setTipo] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [incluirEstornadas, setIncluirEstornadas] = useState(true)
  const [lista, setLista] = useState<Mov[]>([])
  const [carregando, setCarregando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [sel, setSel] = useState<Mov | null>(null)
  const [det, setDet] = useState<Detalhe | null>(null)
  const [carregandoDet, setCarregandoDet] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setCarregando(true)
    const { data } = await supabase.rpc('fn_pec_movimentacoes_listar', {
      p_company_id: companyId, p_propriedade_id: propriedadeId, p_tipo: tipo || null,
      p_de: de || null, p_ate: ate || null, p_incluir_estornadas: incluirEstornadas,
    })
    const r = data as { ok?: boolean; movimentacoes?: Mov[] } | null
    setLista(r?.ok ? (r.movimentacoes ?? []) : [])
    setCarregando(false)
  }, [companyId, propriedadeId, tipo, de, ate, incluirEstornadas])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])

  const abrir = async (m: Mov) => {
    if (!companyId) return
    setSel(m); setDet(null); setCarregandoDet(true)
    const { data } = await supabase.rpc('fn_pec_movimentacao_obter', { p_company_id: companyId, p_grupo_id: m.grupo_id })
    const r = data as { ok?: boolean; movimentacao?: Detalhe['movimentacao']; animais?: Animal[]; financeiro?: Detalhe['financeiro'] } | null
    if (r?.ok) setDet({ movimentacao: r.movimentacao!, animais: r.animais ?? [], financeiro: r.financeiro ?? null })
    setCarregandoDet(false)
  }
  const fechar = () => { setSel(null); setDet(null) }

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Agro · Rebanho</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: ESP, margin: '2px 0 0' }}>Movimentações</h1>
        <div style={{ fontSize: 13, color: MUT, marginTop: 2 }}>Consulte, corrija ou estorne vendas e transferências. Ao estornar, o animal volta ao rebanho.</div>
      </div>

      {/* filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={selStyle}>
          {TIPOS_FILTRO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
        <label style={{ fontSize: 12, color: MUT }}>de <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={inStyle} /></label>
        <label style={{ fontSize: 12, color: MUT }}>até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={inStyle} /></label>
        <label style={{ fontSize: 12, color: MUT, display: 'flex', alignItems: 'center', gap: 5 }}>
          <input type="checkbox" checked={incluirEstornadas} onChange={(e) => setIncluirEstornadas(e.target.checked)} /> mostrar estornadas
        </label>
      </div>

      {carregando && <div style={{ fontSize: 13, color: MUT }}>carregando…</div>}
      {!carregando && lista.length === 0 && <div style={{ fontSize: 14, color: MUT, padding: 24, textAlign: 'center' }}>Nenhuma movimentação no filtro.</div>}

      {/* lista (cards mobile-first) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lista.map((m) => {
          const origemDestino = [m.lote_origem || m.area_origem, m.lote_destino || m.area_destino].filter(Boolean).join(' → ')
          return (
            <button key={m.grupo_id} type="button" onClick={() => void abrir(m)}
              style={{ textAlign: 'left', background: '#fff', border: `1px solid ${m.estornada ? RED : LINE}`, borderRadius: 12, padding: 12, cursor: 'pointer', opacity: m.estornada ? 0.7 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: m.tipo === 'venda' ? GREEN : m.tipo === 'estorno' ? RED : GOLD, borderRadius: 6, padding: '2px 8px' }}>{rotuloTipo(m.tipo)}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>{m.qtd} {m.qtd === 1 ? 'animal' : 'animais'}</span>
                {origemDestino && <span style={{ fontSize: 12.5, color: MUT }}>{origemDestino}</span>}
                {m.estado === 'estornada' && <span style={{ fontSize: 10.5, fontWeight: 700, color: RED, border: `1px solid ${RED}`, borderRadius: 5, padding: '1px 6px' }}>ESTORNADA</span>}
                {m.estado === 'parcial' && <span style={{ fontSize: 10.5, fontWeight: 700, color: GOLD, border: `1px solid ${GOLD}`, borderRadius: 5, padding: '1px 6px' }}>PARCIAL · {m.qtd_ativos}/{m.qtd} ativos</span>}
                <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: ESP }}>{brl(m.valor)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12, color: MUT, flexWrap: 'wrap' }}>
                <span>{dataBR(m.data)}</span>
                {m.contraparte_nome && <span>· {m.contraparte_nome}</span>}
                {m.tem_financeiro && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: m.financeiro_status === 'cancelado' ? RED : GREEN }}>
                    💰 financeiro {m.financeiro_status ?? ''}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {sel && <DetalheModal companyId={companyId} mov={sel} det={det} carregando={carregandoDet}
        onClose={fechar} onDone={(m) => { setMsg(m); fechar(); void carregar() }} />}

      {msg && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }}>{msg}</div>}
    </div>
  )
}

const selStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: ESP, background: '#fff' }
const inStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 8px', fontSize: 13, color: ESP, background: '#fff', marginLeft: 4 }

function DetalheModal({ companyId, mov, det, carregando, onClose, onDone }: {
  companyId: string | null; mov: Mov; det: Detalhe | null; carregando: boolean
  onClose: () => void; onDone: (msg: string) => void
}) {
  const [modo, setModo] = useState<'ver' | 'editar' | 'estornar' | 'excluir'>('ver')
  const [valor, setValor] = useState('')
  const [contraparte, setContraparte] = useState('')
  const [obs, setObs] = useState('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())   // estorno parcial: animais marcados

  useEffect(() => {
    if (!det) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setValor(String(det.movimentacao.valor ?? ''))
    setContraparte(det.movimentacao.contraparte_nome ?? '')
    setObs(det.movimentacao.observacao ?? '')
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [det])

  const podeMexer = det && !det.movimentacao.estornada
  const fin = det?.financeiro

  const salvarEdicao = async () => {
    if (!companyId) return
    setSalvando(true); setErro(null)
    const { data } = await supabase.rpc('fn_pec_movimentacao_editar', {
      p_company_id: companyId, p_grupo_id: mov.grupo_id,
      p_valor: valor.trim() === '' ? null : Number(valor.replace(',', '.')),
      p_contraparte_nome: contraparte.trim() || null, p_observacao: obs.trim() || null,
    })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Falha ao salvar'); return }
    onDone('Movimentação atualizada.')
  }

  // animais que ainda podem ser estornados (linha não estornada)
  const elegiveis = (det?.animais ?? []).filter((a) => !a.linha_estornada)
  const marcados = elegiveis.filter((a) => selecionados.has(a.animal_id))
  const valorMarcado = marcados.reduce((s, a) => s + (a.valor ?? 0), 0)
  const todosMarcados = elegiveis.length > 0 && marcados.length === elegiveis.length
  const abrirEstorno = () => {
    setSelecionados(new Set(elegiveis.map((a) => a.animal_id)))   // default: todos (= estornar tudo, como o #880)
    setErro(null); setModo('estornar')
  }
  const toggleAnimal = (id: string) => setSelecionados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleTodos = () => setSelecionados(todosMarcados ? new Set() : new Set(elegiveis.map((a) => a.animal_id)))

  const confirmarEstorno = async () => {
    if (!companyId) return
    if (marcados.length === 0) { setErro('Marque ao menos um animal.'); return }
    if (motivo.trim().length < 3) { setErro('Descreva o motivo do estorno.'); return }
    setSalvando(true); setErro(null)
    // se marcou TODOS os elegíveis → null (estorna o grupo); senão → só os marcados (parcial)
    const ids = todosMarcados ? null : marcados.map((a) => a.animal_id)
    const { data } = await supabase.rpc('fn_pec_movimentacao_estornar', {
      p_company_id: companyId, p_grupo_id: mov.grupo_id, p_motivo: motivo.trim(), p_animal_ids: ids,
    })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string; animais_revertidos?: number; restantes_ativos?: number } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Falha ao estornar'); return }
    const rest = r.restantes_ativos ?? 0
    onDone(`Estornado — ${r.animais_revertidos ?? marcados.length} animal(is) voltaram ao rebanho${rest > 0 ? ` · ${rest} seguem vendidos` : ''}.`)
  }

  const confirmarExclusao = async () => {
    if (!companyId) return
    setSalvando(true); setErro(null)
    const { data } = await supabase.rpc('fn_pec_movimentacao_excluir', {
      p_company_id: companyId, p_grupo_id: mov.grupo_id, p_motivo: motivo.trim() || null,
    })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro ?? 'Não foi possível excluir'); return }
    onDone('Lançamento excluído.')
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(61,35,20,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 540, maxHeight: '92vh', overflowY: 'auto', background: BG, borderRadius: '16px 16px 0 0', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>{rotuloTipo(mov.tipo)}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: ESP }}>{mov.qtd} {mov.qtd === 1 ? 'animal' : 'animais'} · {brl(mov.valor)}</div>
            <div style={{ fontSize: 12.5, color: MUT }}>{dataBR(mov.data)}{mov.contraparte_nome ? ` · ${mov.contraparte_nome}` : ''}</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: MUT, cursor: 'pointer', minWidth: 40, minHeight: 40 }}>✕</button>
        </div>

        {det?.movimentacao.estornada && (
          <div style={{ background: '#fbeaea', border: `1px solid ${RED}`, borderRadius: 10, padding: 10, fontSize: 12.5, color: RED, marginBottom: 10 }}>
            Estornada em {det.movimentacao.estornada_em ? new Date(det.movimentacao.estornada_em).toLocaleString('pt-BR') : '—'}. Motivo: {det.movimentacao.motivo_estorno ?? '—'}
          </div>
        )}

        {carregando && <div style={{ fontSize: 13, color: MUT }}>carregando…</div>}

        {det && modo === 'ver' && (
          <>
            {fin && (
              <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 10, marginBottom: 10, fontSize: 12.5, color: ESP }}>
                💰 Financeiro vinculado: <b>{brl(fin.valor)}</b> · {fin.status}
              </div>
            )}
            <div style={{ fontSize: 11, fontWeight: 700, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5, margin: '6px 0 4px' }}>Animais ({det.animais.length})</div>
            <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
              {det.animais.map((a, i) => (
                <div key={a.animal_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderTop: i ? `1px solid ${LINE}` : 'none', fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: ESP }}>{a.identificacao || a.animal_id.slice(0, 8)}</span>
                  <span style={{ fontSize: 11, color: a.ativo ? GREEN : MUT }}>{a.status}</span>
                  <span style={{ marginLeft: 'auto', color: MUT }}>{brl(a.valor)}</span>
                </div>
              ))}
              {det.animais.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: MUT }}>Sem animais individualizados.</div>}
            </div>

            {podeMexer && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setModo('editar')} style={btn(GOLD)}>Editar</button>
                {mov.tipo !== 'estorno' && elegiveis.length > 0 && <button type="button" onClick={abrirEstorno} style={btn(RED)}>Estornar</button>}
                <button type="button" onClick={() => setModo('excluir')} style={btnGhost}>Excluir</button>
              </div>
            )}
          </>
        )}

        {det && modo === 'editar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={lbl}>Valor total (R$)<input value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))} style={campo} /></label>
            <label style={lbl}>Comprador / contraparte<input value={contraparte} onChange={(e) => setContraparte(e.target.value)} style={campo} /></label>
            <label style={lbl}>Observação<input value={obs} onChange={(e) => setObs(e.target.value)} style={campo} /></label>
            {fin && <div style={{ fontSize: 11.5, color: MUT }}>Ao mudar o valor, a receita vinculada ({brl(fin.valor)}) é atualizada junto.</div>}
            {erro && <div style={{ fontSize: 12.5, color: RED }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={salvando} onClick={() => void salvarEdicao()} style={btn(GOLD)}>{salvando ? 'Salvando…' : 'Salvar'}</button>
              <button type="button" onClick={() => setModo('ver')} style={btnGhost}>Cancelar</button>
            </div>
          </div>
        )}

        {det && modo === 'estornar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12.5, color: MUT }}>Marque os animais a estornar. Cada um marcado volta ao rebanho.</div>
            {/* selecionar todos */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: ESP, padding: '4px 2px' }}>
              <input type="checkbox" checked={todosMarcados} onChange={toggleTodos} style={{ width: 18, height: 18 }} />
              Selecionar todos ({elegiveis.length})
            </label>
            <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
              {det.animais.map((a, i) => {
                const jaEstornado = !!a.linha_estornada
                return (
                  <label key={a.animal_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderTop: i ? `1px solid ${LINE}` : 'none', fontSize: 13, opacity: jaEstornado ? 0.5 : 1, cursor: jaEstornado ? 'default' : 'pointer' }}>
                    <input type="checkbox" disabled={jaEstornado} checked={selecionados.has(a.animal_id)}
                      onChange={() => toggleAnimal(a.animal_id)} style={{ width: 18, height: 18 }} />
                    <span style={{ fontWeight: 700, color: ESP }}>{a.identificacao || a.animal_id.slice(0, 8)}</span>
                    {jaEstornado && <span style={{ fontSize: 10.5, fontWeight: 700, color: RED, border: `1px solid ${RED}`, borderRadius: 5, padding: '1px 6px' }}>já estornado</span>}
                    <span style={{ marginLeft: 'auto', color: MUT }}>{brl(a.valor)}</span>
                  </label>
                )
              })}
            </div>
            {/* resumo dinâmico */}
            <div style={{ background: '#fbeaea', border: `1px solid ${RED}`, borderRadius: 10, padding: 12, fontSize: 13.5, color: ESP }}>
              <b>{marcados.length} {marcados.length === 1 ? 'animal' : 'animais'}</b> {marcados.length === 1 ? 'voltará' : 'voltarão'} ao rebanho{fin && valorMarcado > 0 ? <> · <b>{brl(valorMarcado)}</b> será cancelado{marcados.length < elegiveis.length ? ' da receita' : ''}</> : ''}.
            </div>
            <label style={lbl}>Motivo do estorno (obrigatório)<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: comprador devolveu parte" style={campo} /></label>
            {erro && <div style={{ fontSize: 12.5, color: RED }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={salvando || marcados.length === 0} onClick={() => void confirmarEstorno()}
                style={{ ...btn(RED), opacity: salvando || marcados.length === 0 ? 0.5 : 1 }}>
                {salvando ? 'Estornando…' : `Estornar selecionados (${marcados.length})`}
              </button>
              <button type="button" onClick={() => { setModo('ver'); setErro(null) }} style={btnGhost}>Voltar</button>
            </div>
          </div>
        )}

        {det && modo === 'excluir' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, fontSize: 13, color: ESP }}>
              Excluir é só para lançamento recente feito por engano. Para reverter uma venda real com histórico, use <b>Estornar</b>.
            </div>
            <label style={lbl}>Motivo (opcional)<input value={motivo} onChange={(e) => setMotivo(e.target.value)} style={campo} /></label>
            {erro && <div style={{ fontSize: 12.5, color: RED }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={salvando} onClick={() => void confirmarExclusao()} style={btn(RED)}>{salvando ? 'Excluindo…' : 'Confirmar exclusão'}</button>
              <button type="button" onClick={() => { setModo('ver'); setErro(null) }} style={btnGhost}>Voltar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: ESP, display: 'flex', flexDirection: 'column', gap: 4 }
const campo: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 14, color: ESP, background: '#fff' }
const btn = (bg: string): React.CSSProperties => ({ background: bg, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' })
const btnGhost: React.CSSProperties = { background: 'none', color: ESP, border: `1px solid ${LINE}`, borderRadius: 9, padding: '10px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }

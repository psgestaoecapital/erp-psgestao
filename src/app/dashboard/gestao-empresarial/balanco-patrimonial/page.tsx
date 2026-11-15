'use client'

// "Balanço Patrimonial" (GE genérico). Linhas CALCULADAS (🔒 read-only, vêm da fonte) +
// linhas MANUAIS LIVRES por período: adicionar / editar (nome+valor) / excluir / ordenar.
// Ausente => valor null + motivo (RD-51). Diferença de fechamento destacada, nunca forçada.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
// Princ.1 (núcleo universal): seletor GENÉRICO de empresa da GE. Balanço é núcleo (serve a qualquer ramo)
// e NÃO pode depender da pecuária/agro — antes vinha de '@/lib/agro/usePecuaria' (useEmpresaSelecionada).
import { useCompanyIds } from '@/lib/useCompanyIds'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/gestao-empresarial/balanco-patrimonial'
const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'; const GREEN = '#5C8D3F'; const RED = '#C44536'
const AMBER = '#9A6A00'

// Chave de ajuda "?" por grupo do balanco (RD-95).
const AJUDA_GRUPO: Record<string, string> = {
  'ATIVO CIRCULANTE': 'ge.balanco.grupo.ativo_circ',
  'ATIVO NÃO CIRCULANTE': 'ge.balanco.grupo.ativo_nao_circ',
  'PASSIVO CIRCULANTE': 'ge.balanco.grupo.passivo_circ',
  'PASSIVO NÃO CIRCULANTE': 'ge.balanco.grupo.passivo_nao_circ',
  'PATRIMÔNIO LÍQUIDO': 'ge.balanco.grupo.pl',
}

const GRUPOS: { lado: string; grupo: string }[] = [
  { lado: 'ativo', grupo: 'ATIVO CIRCULANTE' },
  { lado: 'ativo', grupo: 'ATIVO NÃO CIRCULANTE' },
  { lado: 'passivo', grupo: 'PASSIVO CIRCULANTE' },
  { lado: 'passivo', grupo: 'PASSIVO NÃO CIRCULANTE' },
  { lado: 'pl', grupo: 'PATRIMÔNIO LÍQUIDO' },
]

type Linha = { id?: string; lado: string; grupo: string; nome: string; valor: number | null; ordem?: number; origem: string; editavel: boolean; fonte?: string | null; motivo?: string | null }
type Balanco = { ok: boolean; periodo: string; ativo_total: number; passivo_total: number; pl_total: number; passivo_mais_pl: number; diferenca: number; fecha: boolean; vazio?: boolean; linhas: Linha[] }
// Modal premium de "adicionar linha manual" — substitui os window.prompt (RD-99 #1/#2, critérios a/e).
type NovaLinha = { lado: string; grupo: string; nome: string; valor: string }
// Confirmação premium (RD-99): substitui o window.confirm nativo em ações que mexem no balanço.
type Confirmacao = { titulo: string; aviso?: string; rotulo: string; perigo?: boolean; onOk: () => void | Promise<void> }

function fmt(n: number | null | undefined): string { return n == null ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function hoje(): string { return new Date().toISOString().slice(0, 10) }
function periodoDe(dataRef: string): string { return dataRef.slice(0, 7) }
function periodoAnterior(dataRef: string): string { const [y, m] = dataRef.slice(0, 7).split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
function iconeOrigem(o: string): string { return o === 'calculado' ? '🔒' : o === 'manual' ? '✍️' : '⚠️' }
// Máscara de moeda BR: digita só números, formata como R$ (centavos à direita).
function maskMoeda(v: string): string { const d = v.replace(/\D/g, ''); if (!d) return ''; return (Number(d) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function parseMoeda(v: string): number | null { if (!v.trim()) return null; return Number(v.replace(/\./g, '').replace(',', '.')) || 0 }

export default function BalancoPage() {
  // Princ.1 (núcleo universal): seletor GENÉRICO — empresa única só quando UMA empresa está selecionada.
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [dataRef, setDataRef] = useState(hoje())
  const [bal, setBal] = useState<Balanco | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // edição local das linhas manuais (chave = id ou "novo:lado|grupo|nome")
  const [ed, setEd] = useState<Record<string, { nome: string; valor: string; ordem: string }>>({})
  // modal de nova linha manual
  const [nova, setNova] = useState<NovaLinha | null>(null)
  const [novaErro, setNovaErro] = useState<string | null>(null)
  // confirmação premium (RD-99) — substitui window.confirm
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null)

  const periodo = periodoDe(dataRef)

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_balanco_patrimonial', { p_company_id: empresaUnica, p_data_ref: dataRef })
    if (error) { setMsg('Erro: ' + erroAmigavel(error)); setBal(null) }
    else {
      const b = data as Balanco
      setBal(b)
      const e: Record<string, { nome: string; valor: string; ordem: string }> = {}
      for (const l of b.linhas) if (l.editavel) {
        const k = l.id ?? `t:${l.lado}|${l.grupo}|${l.nome}`
        e[k] = { nome: l.nome, valor: l.valor != null ? String(l.valor) : '', ordem: String(l.ordem ?? 0) }
      }
      setEd(e)
    }
    setBusy(false)
  }, [empresaUnica, dataRef])

  useEffect(() => { void carregar() }, [carregar])

  function keyOf(l: Linha): string { return l.id ?? `t:${l.lado}|${l.grupo}|${l.nome}` }

  async function salvarLinha(l: Linha) {
    if (!empresaUnica) return
    const k = keyOf(l); const cur = ed[k] ?? { nome: l.nome, valor: '', ordem: '0' }
    if (!cur.nome.trim()) { setMsg('Informe o nome da linha.'); return }
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('fn_balanco_linha_salvar', {
      p_company_id: empresaUnica, p_id: l.id ?? null, p_lado: l.lado, p_grupo: l.grupo,
      p_nome: cur.nome.trim(), p_valor: cur.valor === '' ? null : Number(String(cur.valor).replace(',', '.')),
      p_subgrupo: null, p_ordem: Number(cur.ordem) || 0, p_periodo: periodo,
    })
    if (error) setMsg('Erro: ' + erroAmigavel(error)); else { setMsg('Linha salva.'); await carregar() }
    setBusy(false)
  }

  function excluirLinha(l: Linha) {
    if (!empresaUnica || !l.id) return
    const aviso = (l.valor ?? 0) > 0 ? `Esta linha tem valor R$ ${fmt(l.valor)} — o Total e o fechamento do balanço vão mudar.` : undefined
    setConfirmacao({
      titulo: `Excluir a linha "${l.nome}"?`, aviso, rotulo: 'Excluir linha', perigo: true,
      onOk: async () => {
        const id = l.id!
        setBusy(true); setMsg(null)
        const { error } = await supabase.rpc('fn_balanco_linha_excluir', { p_company_id: empresaUnica!, p_id: id })
        if (error) setMsg('Erro: ' + erroAmigavel(error)); else { setMsg('Linha excluída.'); await carregar() }
        setBusy(false)
      },
    })
  }

  // Abre o modal premium (RD-99: sem window.prompt). Pré-preenche lado/grupo.
  function abrirNovaLinha(lado: string, grupo: string) {
    setNovaErro(null)
    setNova({ lado, grupo, nome: '', valor: '' })
  }

  async function salvarNovaLinha() {
    if (!empresaUnica || !nova) return
    if (!nova.nome.trim()) { setNovaErro('Informe o nome da linha.'); return }
    setBusy(true); setNovaErro(null); setMsg(null)
    const { error } = await supabase.rpc('fn_balanco_linha_salvar', {
      p_company_id: empresaUnica, p_id: null, p_lado: nova.lado, p_grupo: nova.grupo, p_nome: nova.nome.trim(),
      p_valor: parseMoeda(nova.valor), p_subgrupo: null, p_ordem: 99, p_periodo: periodo,
    })
    if (error) { setNovaErro(erroAmigavel(error)); setBusy(false); return }
    setNova(null); setMsg('Linha adicionada.'); await carregar(); setBusy(false)
  }

  function copiarPeriodoAnterior() {
    if (!empresaUnica) return
    const de = periodoAnterior(dataRef)
    setConfirmacao({
      titulo: `Copiar as linhas manuais de ${de} para ${periodo}?`,
      aviso: 'As linhas que já existem na competência atual não são duplicadas.', rotulo: 'Copiar linhas',
      onOk: async () => {
        setBusy(true); setMsg(null)
        const { data, error } = await supabase.rpc('fn_balanco_copiar_periodo', { p_company_id: empresaUnica!, p_de: de, p_para: periodo })
        if (error) setMsg('Erro: ' + erroAmigavel(error))
        else { const r = data as { copiadas?: number }; setMsg(`${r?.copiadas ?? 0} linha(s) copiada(s) de ${de}.`); await carregar() }
        setBusy(false)
      },
    })
  }

  const porGrupo = useCallback((lado: string, grupo: string) => (bal?.linhas ?? []).filter((l) => l.lado === lado && l.grupo === grupo), [bal])

  function renderLinha(l: Linha) {
    const k = keyOf(l)
    if (!l.editavel) {
      // CALCULADA — read-only, com cadeado + tooltip da fonte
      return (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13 }}>
          <span title={`Calculado de: ${l.fonte ?? '—'}`} style={{ width: 18, cursor: 'help' }}>🔒</span>
          <span style={{ flex: 1, color: l.origem === 'ausente' ? '#9A6A00' : ESP }} title={l.fonte ?? undefined}>
            {l.nome}{l.origem === 'ausente' && l.motivo && <span style={{ fontSize: 10.5, color: ESP60 }}> · {l.motivo}</span>}
          </span>
          <span style={{ width: 120, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(l.valor)}</span>
        </div>
      )
    }
    // MANUAL / AUSENTE — editável
    const cur = ed[k] ?? { nome: l.nome, valor: '', ordem: '0' }
    return (
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 13 }}>
        <span title="manual" style={{ width: 18 }}>{iconeOrigem(l.origem)}</span>
        <AjudaCampo chave="ge.balanco.linha" rota={ROTA} />
        <input value={cur.ordem} onChange={(e) => setEd({ ...ed, [k]: { ...cur, ordem: e.target.value } })} title="ordem" style={{ ...ip, width: 34, textAlign: 'center' }} />
        <input value={cur.nome} onChange={(e) => setEd({ ...ed, [k]: { ...cur, nome: e.target.value } })} placeholder={l.origem === 'ausente' ? `${l.nome} (sugestão)` : 'nome'} style={{ ...ip, flex: 1 }} />
        <input value={cur.valor} onChange={(e) => setEd({ ...ed, [k]: { ...cur, valor: e.target.value } })} placeholder="0,00" style={{ ...ip, width: 100, textAlign: 'right' }} />
        <button onClick={() => void salvarLinha(l)} disabled={busy} style={miniPri} title="Salvar">✓</button>
        {l.id && <button onClick={() => void excluirLinha(l)} disabled={busy} style={miniDel} title="Excluir">✕</button>}
      </div>
    )
  }

  function renderGrupo(g: { lado: string; grupo: string }) {
    const linhas = porGrupo(g.lado, g.grupo)
    return (
      <div key={g.grupo} style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: ESP, borderBottom: `1px solid ${LINE}`, paddingBottom: 4, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{g.grupo}{AJUDA_GRUPO[g.grupo] && <AjudaCampo chave={AJUDA_GRUPO[g.grupo]} rota={ROTA} />}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><button onClick={() => abrirNovaLinha(g.lado, g.grupo)} style={miniAdd} title="Adicionar linha manual">+ linha</button><AjudaCampo chave="ge.balanco.add_linha" rota={ROTA} /></span>
        </div>
        {linhas.map(renderLinha)}
      </div>
    )
  }

  if (!empresaUnica) return <div style={{ padding: 24, color: ESP60 }}>Selecione UMA empresa específica.</div>

  return (
    <div style={{ padding: 24, background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>📊 Balanço Patrimonial</div>
      <div style={{ fontSize: 13, color: ESP60, marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span>🔒 calculado (da fonte, read-only) · ✍️ manual (editável) · ⚠️ ausente. Linhas manuais são por período. A diferença é mostrada, nunca forçada.</span>
        <AjudaCampo chave="ge.balanco.origem" rota={ROTA} />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: ESP60, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Data-base <input type="date" value={dataRef} onChange={(e) => setDataRef(e.target.value)} style={{ padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 6 }} /><AjudaCampo chave="ge.balanco.data_base" rota={ROTA} /></label>
        <span style={{ fontSize: 12, color: ESP60, display: 'inline-flex', alignItems: 'center', gap: 4 }}>competência {periodo} <AjudaCampo chave="ge.balanco.competencia" rota={ROTA} /></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><button onClick={() => void copiarPeriodoAnterior()} disabled={busy} style={btnSec}>⧉ Copiar linhas de {periodoAnterior(dataRef)}</button><AjudaCampo chave="ge.balanco.copiar_periodo" rota={ROTA} /></span>
        {msg && <span style={{ fontSize: 13, color: msg.startsWith('Erro') ? RED : GREEN }}>{msg}</span>}
      </div>

      {bal && bal.vazio && (
        // GAP 2 (auditor_pdca_2, critério d): balanço TODO ZERO não mostra selo verde "fecha" (enganoso).
        // Estado vazio explica o que falta e oferece o caminho — nunca um "✓ fecha" de balanço sem conteúdo.
        <div style={{ marginTop: 8, padding: '28px 20px', borderRadius: 12, background: '#fff', border: `1px dashed ${LINE}`, textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 6 }}>📄</div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Sem dados para montar o balanço nesta competência</div>
          <div style={{ fontSize: 13, color: ESP60, marginTop: 8, lineHeight: 1.6, maxWidth: 560, marginInline: 'auto' }}>
            O balanço se monta a partir dos <strong>lançamentos financeiros</strong>: lance <strong>contas a pagar e a receber</strong>,
            registre <strong>saldos de banco</strong> e <strong>bens</strong> (imobilizado), ou adicione <strong>linhas manuais</strong>
            de Patrimônio Líquido (Capital Social, Reservas). Enquanto tudo está zerado, não há balanço a conferir.
          </div>
          <button onClick={() => abrirNovaLinha('pl', 'PATRIMÔNIO LÍQUIDO')} disabled={busy} style={{ ...ctaPl, marginTop: 16 }}>+ Adicionar linha manual ao Patrimônio Líquido</button>
        </div>
      )}
      {bal && !bal.vazio && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
            <div style={card}><div style={{ fontWeight: 800, marginBottom: 10 }}>ATIVO</div>
              {GRUPOS.filter((g) => g.lado === 'ativo').map(renderGrupo)}
              <div style={{ borderTop: `2px solid ${LINE}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Total do Ativo <AjudaCampo chave="ge.balanco.total_ativo" rota={ROTA} /></span><span>{fmt(bal.ativo_total)}</span></div>
            </div>
            <div style={card}><div style={{ fontWeight: 800, marginBottom: 10 }}>PASSIVO + PATRIMÔNIO LÍQUIDO</div>
              {GRUPOS.filter((g) => g.lado !== 'ativo').map(renderGrupo)}
              <div style={{ borderTop: `2px solid ${LINE}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Passivo + PL <AjudaCampo chave="ge.balanco.total_passivo_pl" rota={ROTA} /></span><span>{fmt(bal.passivo_mais_pl)}</span></div>
            </div>
          </div>
          {bal.fecha ? (
            <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, background: '#E8F4DC', border: `1px solid ${GREEN}55`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: GREEN, display: 'inline-flex', alignItems: 'center', gap: 4 }}>✓ Balanço fecha <AjudaCampo chave="ge.balanco.fechamento" rota={ROTA} /></span>
              <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: GREEN }}>Diferença: R$ {fmt(bal.diferenca)}</span>
            </div>
          ) : (
            // Estado GUIADO (RD-98/criterios d,e): em vez do alarme cru "Balanço NÃO fecha",
            // a diferença é apresentada como Patrimônio Líquido a apurar, com orientação e CTA.
            <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, background: '#FFF6E6', border: `1px solid ${AMBER}55` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontWeight: 700, color: AMBER, display: 'inline-flex', alignItems: 'center', gap: 4 }}>⚠️ Patrimônio Líquido a apurar <AjudaCampo chave="ge.balanco.fechamento" rota={ROTA} /></span>
                <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: AMBER }}>Falta apurar: R$ {fmt(Math.abs(bal.diferenca))}</span>
              </div>
              <div style={{ fontSize: 12.5, color: ESP, marginTop: 8, lineHeight: 1.5 }}>
                O Ativo (R$ {fmt(bal.ativo_total)}) ainda não tem contrapartida completa no Passivo + Patrimônio Líquido (R$ {fmt(bal.passivo_mais_pl)}).
                Lance no <strong>Patrimônio Líquido</strong> o <strong>Capital Social</strong> e o <strong>Resultado / Lucros (ou Prejuízos) Acumulados</strong> do período para o balanço fechar.
                A diferença não é forçada — ela é mostrada até você apurar o Patrimônio Líquido.
              </div>
              <button onClick={() => abrirNovaLinha('pl', 'PATRIMÔNIO LÍQUIDO')} disabled={busy} style={ctaPl}>+ Lançar no Patrimônio Líquido</button>
            </div>
          )}
        </>
      )}

      {nova && (
        <div onClick={() => !busy && setNova(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 420, boxShadow: '0 10px 40px rgba(61,35,20,0.25)' }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Adicionar linha manual</div>
            <div style={{ fontSize: 12.5, color: ESP60, marginTop: 2, marginBottom: 14 }}>{nova.grupo}</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={lbl}>Nome da linha <AjudaCampo chave="ge.balanco.linha_nome" rota={ROTA} />
                <input autoFocus style={{ ...ipModal, width: '100%' }} value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="ex.: Capital Social" />
              </label>
              <label style={lbl}>Valor (R$) <AjudaCampo chave="ge.balanco.linha_valor" rota={ROTA} />
                <input style={{ ...ipModal, width: '100%', textAlign: 'right' }} inputMode="numeric" value={nova.valor} onChange={(e) => setNova({ ...nova, valor: maskMoeda(e.target.value) })} placeholder="0,00" />
              </label>
            </div>
            {novaErro && <div style={{ marginTop: 10, fontSize: 12.5, color: RED }}>{novaErro}</div>}
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setNova(null)} disabled={busy} style={btnSec}>Cancelar</button>
              <button onClick={() => void salvarNovaLinha()} disabled={busy} style={btnPri}>{busy ? 'Salvando…' : 'Adicionar'}</button>
            </div>
          </div>
        </div>
      )}

      {confirmacao && (
        // Confirmação premium (RD-99 #3): substitui o window.confirm nativo nas ações que mexem no balanço.
        <div onClick={() => !busy && setConfirmacao(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 420, boxShadow: '0 10px 40px rgba(61,35,20,0.25)' }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{confirmacao.titulo}</div>
            {confirmacao.aviso && <div style={{ fontSize: 12.5, color: confirmacao.perigo ? RED : ESP60, marginTop: 8, lineHeight: 1.5 }}>{confirmacao.perigo ? '⚠️ ' : ''}{confirmacao.aviso}</div>}
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmacao(null)} disabled={busy} style={btnSec}>Cancelar</button>
              <button autoFocus onClick={async () => { const fn = confirmacao.onOk; setConfirmacao(null); await fn() }} disabled={busy} style={confirmacao.perigo ? btnDel : btnPri}>{confirmacao.rotulo}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }
const ip: React.CSSProperties = { padding: '3px 6px', border: `1px solid ${LINE}`, borderRadius: 5, fontSize: 12.5, background: '#fff', color: ESP }
const ipModal: React.CSSProperties = { display: 'inline-block', padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 13, marginTop: 3, background: '#fff', color: ESP }
const lbl: React.CSSProperties = { fontSize: 12, color: ESP60, display: 'block' }
const btnSec: React.CSSProperties = { padding: '6px 12px', background: 'transparent', color: ESP, border: `1px solid ${LINE}`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12.5 }
const btnPri: React.CSSProperties = { padding: '8px 14px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }
const btnDel: React.CSSProperties = { padding: '8px 14px', background: RED, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }
const miniPri: React.CSSProperties = { padding: '3px 8px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 5, fontWeight: 700, cursor: 'pointer', fontSize: 12 }
const miniDel: React.CSSProperties = { padding: '3px 8px', background: 'transparent', color: RED, border: `1px solid ${RED}55`, borderRadius: 5, fontWeight: 700, cursor: 'pointer', fontSize: 12 }
const miniAdd: React.CSSProperties = { padding: '2px 8px', background: 'transparent', color: GOLD, border: `1px solid ${GOLD}55`, borderRadius: 5, fontWeight: 600, cursor: 'pointer', fontSize: 11 }
const ctaPl: React.CSSProperties = { marginTop: 10, padding: '7px 14px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 12.5 }

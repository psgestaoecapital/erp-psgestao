'use client'

// Chamado #20 · Fase 3 · Emitir NF-e de PRODUTO (peças) a partir da OS.
//
// fn_os_nfe_preparar resolve, no banco (RD-38): as peças EMITÍVEIS (com produto de catálogo + NCM),
// as BLOQUEADAS por texto-livre (§2.2 — viram produto só depois de entrar a NF de compra), as
// bloqueadas por produto sem NCM, o destinatário (cliente da OS) e o valor ESPERADO (total das peças).
//
// Locks do CEO:
//   §2.1  o operador escolhe quais peças emitíveis vão na nota (checkbox).
//   §2.2  texto-livre não entra e a tela diz por quê.
//   §2.3/§8.1  justificativa obrigatória SÓ quando o total da NF diverge do esperado (rito vazio ensina
//         a burlar). Mostra a diferença em número. Mínimo de caracteres — "ok"/"." não passam.
//   zero item selecionado = BLOQUEIO (não existe nota sem item), não justificativa.
//
// Emite pelo modo `manual` do /api/fiscal/nfe/emitir (o caminho que já emitiu as NF-e de produto),
// passando osId + a justificativa, que ficam no registro da nota (recuperável depois).

import { useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { authFetch } from '@/lib/authFetch'
import { carregarProducaoDisponivel } from '@/lib/fiscal/producaoDisponivel'

type ItemEmitivel = {
  item_id: string; produto_id: string; descricao: string; quantidade: number
  preco_unitario: number; subtotal: number; ncm: string; cfop: string; unidade: string
}
type Bloqueada = { descricao: string; subtotal?: number }
type Dest = {
  nome: string | null; documento: string; tipo: 'cpf' | 'cnpj' | 'indefinido'; email: string | null
  logradouro: string | null; numero: string | null; bairro: string | null
  cidade: string | null; uf: string | null; cep: string | null; codigo_municipio: string | null
  ok: boolean; faltando: string[]
}
type Prep = {
  ok: boolean; motivo?: string; erro?: string; os_numero?: string | null
  valor_esperado?: number; valor_emitivel?: number; qtd_pecas?: number
  itens_emitiveis?: ItemEmitivel[]; itens_texto_livre?: Bloqueada[]; itens_sem_fiscal?: Bloqueada[]
  destinatario?: Dest
}

const MIN_JUST = 10
const C = { espresso: '#3D2314', espressoM: '#6B5D4F', gold: '#C8941A', line: '#E7DECF',
  green: '#166534', greenBg: '#EAF3DE', amber: '#B45309', amberBg: '#FAEEDA', red: '#A32D2D', redBg: '#FCEBEB' }
const brl = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function EmitirNFeOSButton({
  osId, companyId, buttonStyle, onEmitida,
}: { osId: string; companyId: string; buttonStyle?: CSSProperties; onEmitida?: () => void }) {
  const [prep, setPrep] = useState<Prep | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [justificativa, setJustificativa] = useState('')
  const [producao, setProducao] = useState(false)
  const [fase, setFase] = useState<'form' | 'enviando' | 'resultado'>('form')
  const [resultado, setResultado] = useState<{ ok?: boolean; status?: string; numero?: string | null; mensagem?: string; motivoRejeicao?: string } | null>(null)

  async function preparar() {
    setErro(null); setCarregando(true)
    try {
      const [rpc, prod] = await Promise.all([
        supabase.rpc('fn_os_nfe_preparar', { p_os_id: osId }),
        carregarProducaoDisponivel(companyId),
      ])
      if (rpc.error) { setErro(rpc.error.message); return }
      const p = rpc.data as Prep | null
      if (!p?.ok) { setErro(p?.erro ?? 'Não foi possível preparar a NF-e.'); return }
      const s: Record<string, boolean> = {}
      ;(p.itens_emitiveis ?? []).forEach((it) => { s[it.item_id] = true })
      setPrep(p); setProducao(prod); setSel(s); setJustificativa(''); setFase('form'); setResultado(null); setAberto(true)
    } finally { setCarregando(false) }
  }

  const emitiveis = prep?.itens_emitiveis ?? []
  const textoLivre = prep?.itens_texto_livre ?? []
  const semFiscal = prep?.itens_sem_fiscal ?? []
  const dest = prep?.destinatario
  const selecionados = emitiveis.filter((it) => sel[it.item_id])
  const totalNF = selecionados.reduce((a, it) => a + Number(it.subtotal), 0)
  const esperado = Number(prep?.valor_esperado ?? 0)
  const diff = Number((esperado - totalNF).toFixed(2))
  const diverge = Math.abs(diff) >= 0.01
  const justOk = !diverge || justificativa.trim().length >= MIN_JUST
  const destOk = !!dest?.ok
  const podeEmitir = selecionados.length > 0 && justOk && destOk && fase === 'form'

  async function emitir() {
    if (!prep || !dest || selecionados.length === 0) return
    if (producao) {
      const ok = window.confirm('Esta NF-e tem VALOR FISCAL REAL e será transmitida à SEFAZ em nome da empresa.\n\nConfirmar emissão?')
      if (!ok) return
    }
    setFase('enviando')
    const body: Record<string, unknown> = {
      companyId,
      ...(producao ? {} : { ambiente: 'homologacao' }),
      manual: {
        destinatario: {
          razaoSocial: dest.nome ?? '',
          ...(dest.tipo === 'cnpj' ? { cnpj: dest.documento } : dest.tipo === 'cpf' ? { cpf: dest.documento } : {}),
          email: dest.email ?? undefined,
          endereco: {
            logradouro: dest.logradouro ?? '', numero: dest.numero ?? undefined, bairro: dest.bairro ?? '',
            cidade: dest.cidade ?? '', uf: dest.uf ?? '', cep: (dest.cep ?? '').replace(/\D/g, ''),
            codigoMunicipio: dest.codigo_municipio ?? undefined,
          },
        },
        itens: selecionados.map((it) => ({ produtoId: it.produto_id, quantidade: Number(it.quantidade), valorUnitarioOverride: Number(it.preco_unitario) })),
      },
      osId,
      ...(diverge ? { justificativaDivergencia: justificativa.trim(), valorEsperadoOs: esperado } : {}),
    }
    try {
      const res = await authFetch('/api/fiscal/nfe/emitir', { method: 'POST', body: JSON.stringify(body) })
      const json = await res.json()
      setResultado({ ok: json?.ok, status: json?.status, numero: json?.numero, mensagem: json?.mensagem, motivoRejeicao: json?.motivoRejeicao })
    } catch (e) {
      setResultado({ ok: false, mensagem: e instanceof Error ? e.message : 'Falha na emissão' })
    } finally {
      setFase('resultado'); onEmitida?.()
    }
  }

  const defBtn: CSSProperties = { fontSize: 12, fontWeight: 600, color: C.espresso, background: '#FFFFFF',
    border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 14px', minHeight: 44, cursor: 'pointer' }
  const box = (bg: string, cor: string): CSSProperties => ({ background: bg, color: cor, borderRadius: 8, padding: '10px 12px', fontSize: 12 })

  return (
    <>
      <button type="button" onClick={() => void preparar()} disabled={carregando}
        data-testid="os-nfe-emitir"
        title="Emite a NF-e de produto (peças) da OS. Só peças com produto de catálogo e NCM entram — texto livre fica de fora."
        style={{ ...defBtn, ...buttonStyle, opacity: carregando ? 0.6 : 1 }}>
        {carregando ? 'Preparando…' : '📄 Emitir NF-e (peças)'}
      </button>

      {erro && !aberto && (
        <div role="alert" style={{ flexBasis: '100%', marginTop: 8, ...box(C.redBg, '#791F1F'), borderLeft: `4px solid ${C.red}` }}>
          {erro}
          <button type="button" onClick={() => setErro(null)} style={{ marginLeft: 8, textDecoration: 'underline', background: 'none', border: 'none', color: '#791F1F', cursor: 'pointer' }}>ok</button>
        </div>
      )}

      {aberto && prep && (
        <div role="dialog" aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget && fase !== 'enviando') setAberto(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFFFFF', borderRadius: 12, maxWidth: 520, width: '100%', padding: 20, maxHeight: 'calc(100vh - 64px)', overflowY: 'auto' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.espresso }}>Emitir NF-e de peças · OS {prep.os_numero}</h3>
            <p style={{ margin: '4px 0 14px', fontSize: 12, color: C.espressoM }}>
              {producao ? 'Produção — nota fiscal real.' : 'Homologação — teste, não vale como nota.'}
            </p>

            {fase === 'resultado' && resultado ? (
              <div style={{ ...box(resultado.status === 'autorizada' ? C.greenBg : resultado.status === 'processando' ? C.amberBg : C.redBg,
                resultado.status === 'autorizada' ? C.green : resultado.status === 'processando' ? C.amber : '#791F1F'), fontSize: 13 }}>
                {resultado.status === 'autorizada' && <><b>✅ NF-e autorizada</b>{resultado.numero ? ` · nº ${resultado.numero}` : ''}</>}
                {resultado.status === 'processando' && <><b>⏳ Processando na SEFAZ</b><div style={{ marginTop: 4 }}>O número/chave saem quando a SEFAZ autorizar — acompanhe em Notas Fiscais.</div></>}
                {resultado.status !== 'autorizada' && resultado.status !== 'processando' && <><b>❌ Não emitida</b><div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{resultado.motivoRejeicao || resultado.mensagem || 'Falha na emissão.'}</div></>}
                <div style={{ marginTop: 12, textAlign: 'right' }}>
                  <button type="button" onClick={() => setAberto(false)} style={{ ...defBtn, minHeight: 38 }}>Fechar</button>
                </div>
              </div>
            ) : (
              <>
                {!destOk && (
                  <div style={{ ...box(C.redBg, '#791F1F'), borderLeft: `4px solid ${C.red}`, marginBottom: 12 }}>
                    Complete o cadastro do cliente antes de emitir: <b>{(dest?.faltando ?? []).join(', ')}</b>. Edite em Clientes e emita de novo.
                  </div>
                )}

                <div style={{ fontSize: 11, color: C.espressoM, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 }}>Peças na nota</div>
                {emitiveis.length === 0 ? (
                  <div style={{ ...box(C.amberBg, C.amber), marginBottom: 12 }}>Nenhuma peça emitível — todas ainda são texto livre ou sem produto de catálogo.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {emitiveis.map((it) => (
                      <label key={it.item_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.espresso }}>
                        <input type="checkbox" checked={!!sel[it.item_id]} onChange={(e) => setSel((p) => ({ ...p, [it.item_id]: e.target.checked }))} />
                        <span style={{ flex: 1 }}>{it.descricao} <span style={{ color: C.espressoM }}>· {it.quantidade}× {brl(it.preco_unitario)}</span></span>
                        <b>{brl(it.subtotal)}</b>
                      </label>
                    ))}
                  </div>
                )}

                {textoLivre.length > 0 && (
                  <div style={{ ...box(C.amberBg, C.amber), marginBottom: 8 }}>
                    <b>{textoLivre.length} peça(s) fora da nota — ainda texto livre.</b> Entre a NF de compra e vincule à OS pra virarem produto:
                    <div style={{ marginTop: 4 }}>{textoLivre.map((t) => t.descricao).join(' · ')}</div>
                  </div>
                )}
                {semFiscal.length > 0 && (
                  <div style={{ ...box(C.amberBg, C.amber), marginBottom: 8 }}>
                    <b>{semFiscal.length} peça(s) com produto sem NCM.</b> Cadastre o NCM em Produtos: {semFiscal.map((t) => t.descricao).join(' · ')}
                  </div>
                )}

                {/* trava de valor (§2.3/§8.1) — mostra a diferença em número */}
                <div style={{ ...box('#F7F3EC', C.espresso), marginBottom: diverge ? 8 : 12 }}>
                  NF <b>{brl(totalNF)}</b> · OS <b>{brl(esperado)}</b>
                  {diverge && <> · diferença <b style={{ color: C.amber }}>{brl(Math.abs(diff))}</b></>}
                </div>

                {diverge && (
                  <label style={{ display: 'block', marginBottom: 12 }}>
                    <span style={{ display: 'block', fontSize: 12, color: C.espresso, marginBottom: 4 }}>
                      A NF sai diferente do total de peças da OS. <b>Justifique</b> (fica no registro da nota):
                    </span>
                    <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={2}
                      placeholder="Ex.: peça X ainda é texto livre; cliente levou só parte das peças…"
                      style={{ width: '100%', border: `1px solid ${justOk ? C.line : C.red}`, borderRadius: 6, padding: '8px 10px', fontSize: 13, color: C.espresso }} />
                    {!justOk && <span style={{ fontSize: 11, color: C.red }}>Escreva uma justificativa de verdade (mín. {MIN_JUST} caracteres).</span>}
                  </label>
                )}

                {selecionados.length === 0 && (
                  <div style={{ ...box(C.redBg, '#791F1F'), marginBottom: 12 }}>Selecione ao menos uma peça — não existe nota sem item.</div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" onClick={() => setAberto(false)} disabled={fase === 'enviando'}
                    style={{ ...defBtn, flex: 1, opacity: fase === 'enviando' ? 0.5 : 1 }}>Cancelar</button>
                  <button type="button" onClick={() => void emitir()} disabled={!podeEmitir}
                    data-testid="os-nfe-confirmar"
                    style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none', background: C.gold, color: C.espresso, fontWeight: 600, fontSize: 13, cursor: podeEmitir ? 'pointer' : 'not-allowed', opacity: podeEmitir ? 1 : 0.5 }}>
                    {fase === 'enviando' ? 'Emitindo…' : '📄 Emitir NF-e'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

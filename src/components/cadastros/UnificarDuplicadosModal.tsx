'use client'

// Carteira Gean (caixa jordana-code 3352399e, item 3 — Eng. Chefe 09/10): tela para UNIFICAR cadastros de cliente com o
// mesmo CNPJ/CPF na empresa. Lista os grupos (fn_clientes_duplicados_listar), o usuário escolhe o cadastro principal, vê a
// prévia do que vai ser movido (fn_cliente_unificar_previa — não grava nada) e confirma (fn_cliente_unificar: move
// títulos/OS/orçamentos… para o principal, inativa o duplicado e registra em erp_cliente_unificacao). Grupo com mais de
// dois cadastros: unifica um par por vez (a função trabalha por par). Toda regra e recusa ficam no banco (#2302).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/cadastros/clientes'
const C = { espresso: '#3D2314', espressoM: '#6B5D4F', cream: '#FAF7F2', border: '#E0D8CC', gold: '#C8941A', white: '#FFFFFF', red: '#A32D2D', redBg: '#FCEBEB', green: '#2E6B3A', greenBg: '#E8F3EA' }

interface Cadastro { id: string; nome: string; razao_social: string | null; codigo: string | null; ativo: boolean; origem: string; tem_endereco: boolean; tem_ibge: boolean; criado_em: string | null }
interface Grupo { documento: string; cadastros: Cadastro[] }
interface Mover { tabela: string; rotulo: string; qtd: number }

function fmtDoc(d: string): string {
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d
}

// sugestão de principal: ativo, com endereço e IBGE, mais antigo (a função do banco ordena ativos primeiro)
function sugerirPrincipal(g: Grupo): string {
  const nota = (c: Cadastro) => (c.ativo ? 4 : 0) + (c.tem_ibge ? 2 : 0) + (c.tem_endereco ? 1 : 0)
  return [...g.cadastros].sort((a, b) => nota(b) - nota(a))[0]?.id ?? ''
}

function msgErro(e: { message?: string } | null): string {
  const m = e?.message ?? ''
  if (/fn_clientes_duplicados_listar|fn_cliente_unificar|does not exist|schema cache/i.test(m)) return 'A unificação ainda está sendo publicada. Tente de novo em alguns minutos.'
  return m || 'Não foi possível concluir. Tente de novo.'
}

export default function UnificarDuplicadosModal({ companyId, onClose, onUnificado }: { companyId: string; onClose: () => void; onUnificado?: () => void }) {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)          // documento do grupo aberto
  const [principal, setPrincipal] = useState('')
  const [duplicado, setDuplicado] = useState('')
  const [motivo, setMotivo] = useState('')
  const [previa, setPrevia] = useState<Mover[] | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [feito, setFeito] = useState<string | null>(null)

  async function carregar() {
    setErro(null)
    const { data, error } = await supabase.rpc('fn_clientes_duplicados_listar', { p_company_id: companyId })
    if (error) { setErro(msgErro(error)); setGrupos([]); return }
    setGrupos((data as Grupo[]) ?? [])
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  function abrirGrupo(g: Grupo) {
    const p = sugerirPrincipal(g)
    setAberto(g.documento)
    setPrincipal(p)
    setDuplicado(g.cadastros.find((c) => c.id !== p)?.id ?? '')
    setMotivo('')
    setPrevia(null)
    setErro(null)
    setFeito(null)
  }

  function escolherPrincipal(g: Grupo, id: string) {
    setPrincipal(id)
    if (duplicado === id || !duplicado) setDuplicado(g.cadastros.find((c) => c.id !== id)?.id ?? '')
    setPrevia(null)
  }

  async function verPrevia() {
    if (!principal || !duplicado) return
    setOcupado(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_cliente_unificar_previa', { p_principal: principal, p_duplicado: duplicado })
    setOcupado(false)
    if (error) { setErro(msgErro(error)); return }
    setPrevia(((data as { mover?: Mover[] })?.mover) ?? [])
  }

  async function unificar() {
    if (!principal || !duplicado || previa === null) return
    setOcupado(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_cliente_unificar', { p_principal: principal, p_duplicado: duplicado, p_motivo: motivo.trim() || null })
    setOcupado(false)
    if (error) { setErro(msgErro(error)); return }
    const movidos = ((data as { movidos?: Mover[] })?.movidos) ?? []
    const total = movidos.reduce((s, m) => s + Number(m.qtd || 0), 0)
    setFeito(`Unificado. ${total} registro(s) passaram para o cadastro principal; o duplicado foi inativado.`)
    setPrevia(null)
    setAberto(null)
    onUnificado?.()
    await carregar()
  }

  const btn = (primario: boolean, desabilitado = false): React.CSSProperties => ({
    background: primario ? C.gold : C.white, color: C.espresso, border: primario ? 'none' : `1px solid ${C.border}`,
    padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: desabilitado ? 'not-allowed' : 'pointer', opacity: desabilitado ? 0.55 : 1, minHeight: 40,
  })

  return (
    <div role="dialog" aria-modal="true" aria-label="Unificar cadastros duplicados" data-testid="unificar-duplicados"
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1500 }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.cream, width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: '22px 18px 28px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, color: C.espresso, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              Cadastros com o mesmo CNPJ/CPF <AjudaCampo chave="cadastros.clientes.duplicados" rota={ROTA} />
            </h2>
            <p style={{ fontSize: 13, color: C.espressoM, margin: '6px 0 0', lineHeight: 1.5 }}>
              Escolha qual cadastro fica. Títulos, OS, orçamentos e o resto do histórico do outro passam para ele, e o outro é inativado. Nota fiscal já emitida não muda.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', border: 'none', fontSize: 24, color: C.espresso, cursor: 'pointer', minWidth: 40, minHeight: 40 }}>×</button>
        </div>

        {feito && <div role="status" style={{ marginTop: 14, background: C.greenBg, color: C.green, padding: '10px 12px', borderRadius: 8, fontSize: 13 }}>{feito}</div>}
        {erro && <div role="alert" style={{ marginTop: 14, background: C.redBg, color: C.red, padding: '10px 12px', borderRadius: 8, fontSize: 13 }}>{erro}</div>}

        {grupos === null ? (
          <div style={{ padding: 32, textAlign: 'center', color: C.espressoM, fontSize: 13 }}>Procurando cadastros repetidos…</div>
        ) : grupos.length === 0 ? (
          !erro && <div style={{ padding: 32, textAlign: 'center', color: C.espressoM, fontSize: 13 }}>Nenhum CNPJ/CPF repetido nesta empresa. 👍</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            <div style={{ fontSize: 12, color: C.espressoM }}>{grupos.length} documento(s) com mais de um cadastro</div>
            {grupos.map((g) => {
              const estaAberto = aberto === g.documento
              const nomes = Array.from(new Set(g.cadastros.map((c) => c.nome))).join(' · ')
              return (
                <div key={g.documento} data-testid="grupo-duplicado" style={{ background: C.white, border: `1px solid ${estaAberto ? C.gold : C.border}`, borderRadius: 12, padding: '12px 14px' }}>
                  <button type="button" onClick={() => (estaAberto ? setAberto(null) : abrirGrupo(g))}
                    style={{ width: '100%', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, color: C.espresso }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtDoc(g.documento)} <span style={{ fontWeight: 400, color: C.espressoM }}>· {g.cadastros.length} cadastros</span></div>
                    <div style={{ fontSize: 12, color: C.espressoM, marginTop: 2 }}>{nomes}</div>
                  </button>

                  {estaAberto && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                        <legend style={{ fontSize: 12, fontWeight: 700, color: C.espresso, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                          Qual cadastro fica (principal)? <AjudaCampo chave="cadastros.clientes.unificar_principal" rota={ROTA} />
                        </legend>
                        {g.cadastros.map((c) => (
                          <label key={c.id} data-ajuda="cadastros.clientes.unificar_principal" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, background: principal === c.id ? '#FBF3E2' : 'transparent', cursor: 'pointer' }}>
                            <input type="radio" name={`principal-${g.documento}`} checked={principal === c.id} onChange={() => escolherPrincipal(g, c.id)} style={{ marginTop: 3 }} />
                            <span style={{ fontSize: 13, color: C.espresso, lineHeight: 1.45 }}>
                              <strong>{c.nome}</strong>{c.codigo ? ` · cód. ${c.codigo}` : ''}
                              <br />
                              <span style={{ fontSize: 12, color: C.espressoM }}>
                                {c.ativo ? 'Ativo' : 'Inativo'} · {c.origem === 'manual' ? 'cadastro manual' : `veio do ${c.origem}`} · {c.tem_endereco ? 'com endereço' : 'sem endereço'} · {c.tem_ibge ? 'com IBGE' : 'sem IBGE'}
                              </span>
                            </span>
                          </label>
                        ))}
                      </fieldset>

                      {g.cadastros.length > 2 && (
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700, color: C.espresso }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Unificar agora este cadastro <AjudaCampo chave="cadastros.clientes.unificar_duplicado" rota={ROTA} /></span>
                          <select value={duplicado} onChange={(e) => { setDuplicado(e.target.value); setPrevia(null) }}
                            style={{ minHeight: 40, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, color: C.espresso, background: C.white }}>
                            {g.cadastros.filter((c) => c.id !== principal).map((c) => (
                              <option key={c.id} value={c.id}>{c.nome}{c.codigo ? ` · cód. ${c.codigo}` : ''} ({c.ativo ? 'ativo' : 'inativo'})</option>
                            ))}
                          </select>
                        </label>
                      )}

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700, color: C.espresso }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Motivo (opcional) <AjudaCampo chave="cadastros.clientes.unificar_motivo" rota={ROTA} /></span>
                        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={300} placeholder="Ex.: cadastro antigo do Omie repetido"
                          style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, color: C.espresso, background: C.white, resize: 'vertical' }} />
                      </label>

                      {previa !== null && (
                        <div data-testid="previa-unificacao" style={{ background: C.cream, border: `1px dashed ${C.gold}`, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: C.espresso }}>
                          {previa.length === 0
                            ? 'Nada aponta para o cadastro duplicado: ele só será inativado.'
                            : (<>
                                <div style={{ fontWeight: 700, marginBottom: 4 }}>Vai passar para o principal:</div>
                                <ul style={{ margin: 0, paddingLeft: 18 }}>
                                  {previa.map((m) => <li key={m.tabela}>{m.qtd} × {m.rotulo}</li>)}
                                </ul>
                              </>)}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" onClick={verPrevia} disabled={ocupado || !duplicado} style={btn(previa === null, ocupado || !duplicado)}>
                          {ocupado && previa === null ? 'Conferindo…' : 'Ver o que vai mudar'}
                        </button>
                        <AjudaCampo chave="cadastros.clientes.unificar_previa" rota={ROTA} />
                        <button type="button" onClick={unificar} disabled={ocupado || previa === null} style={btn(previa !== null, ocupado || previa === null)}>
                          {ocupado && previa !== null ? 'Unificando…' : 'Unificar'}
                        </button>
                        <AjudaCampo chave="cadastros.clientes.unificar_confirmar" rota={ROTA} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

// #59 PDOIS parte 2 · "Solicitar elaboração de contrato" (comercial). Dois modos:
//  - "A partir de uma proposta": fn_contrato_solicitar copia cliente/título/valor/escopo da proposta
//    (e a condição de pagamento dela); o que for preenchido aqui prevalece;
//  - "Com dados novos": cliente (cadastro rápido) + título + código + valor.
// Nos dois modos o pedido leva o que o cliente listou no chamado #59 ("ficou muito resumido"): CPF/CNPJ,
// responsável pelo contrato, objeto, serviços/produtos, forma e condição de pagamento, nº de parcelas,
// periodicidade, dia/1º vencimento, vigência, reajuste, condições específicas, observação e prazo desejado.
// Cria o contrato em status 'solicitado' e dispara o e-mail ao responsável (trigger). Depois de criado,
// o comercial pode anexar modelos/prints de referência (tipo 'outro' — não conta como contrato assinado).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ClientePickerInline from './ClientePickerInline'
import ContratoArquivos from './ContratoArquivos'
import { FORMAS_PAGAMENTO, PERIODICIDADES_CONTRATO, TIPOS_REAJUSTE_CONTRATO, gradeContrato } from './contratoOpcoes'

const C = { espresso: '#3D2314', espressoM: '#6B5D4F', cream: '#FAF7F2', border: '#E0D8CC', gold: '#C8941A', white: '#FFFFFF', red: '#A32D2D', redBg: '#FCEBEB' }
const inp: React.CSSProperties = { width: '100%', minHeight: 38, padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.espresso, outline: 'none', boxSizing: 'border-box' }

export interface SolicitarResultado { contrato_id: string; numero: string; responsavel_id: string | null; aviso: string | null }

interface Props {
  companyId: string
  propostaId?: string | null
  propostaLabel?: string | null      // rótulo p/ mostrar de qual proposta veio
  clienteId?: string | null          // prefill (aberto do cliente/lead)
  onClose: () => void
  onSolicitado?: (r: SolicitarResultado) => void
}

// "1.500,50" e "1500.50" → 1500.5
const num = (s: string) => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}

export default function SolicitarContratoModal({ companyId, propostaId, propostaLabel, clienteId, onClose, onSolicitado }: Props) {
  const [modo, setModo] = useState<'proposta' | 'manual'>(propostaId ? 'proposta' : 'manual')
  const [cli, setCli] = useState(clienteId ?? '')
  const [titulo, setTitulo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [valorMensal, setValorMensal] = useState('')
  // #59 · identificação e objeto
  const [doc, setDoc] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [objeto, setObjeto] = useState('')
  const [escopo, setEscopo] = useState('')
  // #59 · pagamento
  const [forma, setForma] = useState('boleto')
  const [condicao, setCondicao] = useState('')
  const [nParcelas, setNParcelas] = useState('')
  const [periodicidade, setPeriodicidade] = useState('mensal')
  const [diaVenc, setDiaVenc] = useState('')
  const [primeiroVenc, setPrimeiroVenc] = useState('')
  // #59 · vigência e condições
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [reajuste, setReajuste] = useState('nenhum')
  const [reajustePct, setReajustePct] = useState('')
  const [especificas, setEspecificas] = useState('')
  const [prazo, setPrazo] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [criado, setCriado] = useState<SolicitarResultado | null>(null)

  // condição de pagamento da proposta como ponto de partida (editável)
  useEffect(() => {
    if (!propostaId) return
    let vivo = true
    void supabase.from('agency_propostas').select('condicao_pagamento').eq('id', propostaId).maybeSingle()
      .then(({ data }) => {
        const c = (data as { condicao_pagamento?: string | null } | null)?.condicao_pagamento
        if (vivo && c) setCondicao((atual) => atual || c)
      })
    return () => { vivo = false }
  }, [propostaId])

  async function solicitar() {
    setErro(null)
    const dia = diaVenc ? Number(diaVenc) : null
    if (dia != null && (!Number.isInteger(dia) || dia < 1 || dia > 28)) { setErro('Dia de vencimento: de 1 a 28.'); return }
    if (inicio && fim && fim < inicio) { setErro('O fim da vigência não pode ser antes do início.'); return }
    if (modo === 'manual' && !cli && !titulo.trim()) { setErro('Escolha um cliente ou informe um título para o contrato.'); return }
    if (modo === 'proposta' && !propostaId) { setErro('Proposta não informada.'); return }
    const dados: Record<string, unknown> = {
      cliente_cnpj: doc.trim() || null,
      responsavel: responsavel.trim() || null,
      objeto: objeto.trim() || null,
      escopo: escopo.trim() || null,
      forma_pagamento: forma || null,
      condicao_pagamento: condicao.trim() || null,
      numero_parcelas: nParcelas ? Number(nParcelas) : null,
      periodicidade: periodicidade || null,
      dia_vencimento: dia,
      data_primeiro_vencimento: primeiroVenc || null,
      data_inicio: inicio || null,
      data_fim: fim || null,
      tipo_reajuste: reajuste || null,
      reajuste_percentual: reajuste !== 'nenhum' ? num(reajustePct) : null,
      condicoes_especificas: especificas.trim() || null,
      titulo: titulo.trim() || null,
      valor_mensal: num(valorMensal),
    }
    if (modo === 'manual') {
      dados.cliente_id = cli || null
      dados.codigo_identificador = codigo.trim() || null
    }
    setSalvando(true)
    try {
      const { data, error } = await supabase.rpc('fn_contrato_solicitar', {
        p_company_id: companyId,
        p_proposta_id: modo === 'proposta' ? propostaId : null,
        p_prazo_desejado: prazo || null,
        p_observacoes: obs.trim() || null,
        p_dados: dados,
      })
      setSalvando(false)
      if (error) { setErro(error.message); return }
      const r = data as { ok?: boolean; erro?: string; contrato_id?: string; numero?: string; responsavel_id?: string | null; aviso?: string | null }
      if (!r?.ok) { setErro(traduz(r?.erro)); return }
      setCriado({ contrato_id: r.contrato_id!, numero: r.numero ?? '', responsavel_id: r.responsavel_id ?? null, aviso: r.aviso ?? null })
    } catch (e) {
      setSalvando(false); setErro(e instanceof Error ? e.message : String(e))
    }
  }

  const concluir = () => { if (criado) onSolicitado?.(criado); else onClose() }

  return (
    <div onClick={criado ? concluir : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Solicitar elaboração de contrato" style={{ background: C.cream, borderRadius: 12, maxWidth: 680, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ background: C.espresso, color: C.cream, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0, zIndex: 5 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Solicitar elaboração de contrato</h2>
          <button type="button" onClick={criado ? concluir : onClose} aria-label="Fechar" style={{ background: 'transparent', color: C.cream, border: 'none', fontSize: 22, cursor: 'pointer', width: 28, height: 28, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {erro && <div style={{ background: C.redBg, color: C.red, padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>{erro}</div>}
          {toast && <div style={{ background: '#EAF6EE', color: '#1E7A46', padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>{toast}</div>}

          {criado ? (
            <div data-testid="solicitacao-criada">
              <div style={{ background: '#EAF6EE', color: '#1E7A46', padding: '12px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
                Solicitação enviada{criado.numero ? <> — contrato nº <strong>{criado.numero}</strong></> : null}.
                {criado.aviso ? <> {criado.aviso}.</> : null}
              </div>
              <p style={{ fontSize: 13, color: C.espresso, margin: '0 0 8px' }}>
                Tem um modelo de contrato, print ou documento do cliente? Anexe aqui para quem vai elaborar (opcional).
              </p>
              <ContratoArquivos companyId={companyId} contratoId={criado.contrato_id} tipo="outro" titulo="Modelos e documentos de referência" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" onClick={concluir} style={{ background: C.gold, color: C.white, border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Concluir</button>
              </div>
            </div>
          ) : (
            <>
              {/* seletor de modo */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: '#EFEAE1', borderRadius: 8, padding: 4 }}>
                <button type="button" onClick={() => setModo('proposta')} disabled={!propostaId}
                  style={tab(modo === 'proposta', !propostaId)}>A partir de uma proposta</button>
                <button type="button" onClick={() => setModo('manual')} style={tab(modo === 'manual', false)}>Com dados novos</button>
              </div>

              <Secao titulo="Cliente e contrato">
                {modo === 'proposta' ? (
                  <div style={{ fontSize: 13, color: C.espresso, lineHeight: 1.6, marginBottom: 12 }}>
                    Cliente, título, valor e serviços vêm da proposta
                    {propostaLabel ? <> <strong>{propostaLabel}</strong></> : null}. Preencha abaixo só o que quiser mudar ou completar.
                  </div>
                ) : (
                  <Campo label="Cliente">
                    <ClientePickerInline companyId={companyId} value={cli} onChange={(id) => setCli(id)} onToast={(s) => setToast(s)} />
                  </Campo>
                )}
                <div style={gradeContrato}>
                  <Campo label="CPF/CNPJ do cliente">
                    <input style={inp} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Vazio = o do cadastro" />
                  </Campo>
                  <Campo label="Responsável pelo contrato">
                    <input style={inp} value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="Quem assina / contato no cliente" />
                  </Campo>
                </div>
                <Campo label="Título do contrato">
                  <input style={inp} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={modo === 'proposta' ? 'Vazio = o título da proposta' : 'Ex.: "Fee mensal — assessoria contábil"'} />
                </Campo>
                <Campo label="Objeto do contrato">
                  <textarea style={{ ...inp, minHeight: 56, fontFamily: 'inherit' }} value={objeto} onChange={(e) => setObjeto(e.target.value)} placeholder="O que está sendo contratado" />
                </Campo>
                <Campo label="Serviços / produtos">
                  <textarea style={{ ...inp, minHeight: 56, fontFamily: 'inherit' }} value={escopo} onChange={(e) => setEscopo(e.target.value)} placeholder={modo === 'proposta' ? 'Vazio = os itens da proposta' : 'Um por linha'} />
                </Campo>
                <div style={gradeContrato}>
                  {modo === 'manual' && (
                    <Campo label="Código identificador (opcional)">
                      <input style={inp} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: FEE-2026-001" />
                    </Campo>
                  )}
                  <Campo label="Valor (por parcela)">
                    <input style={inp} inputMode="decimal" value={valorMensal} onChange={(e) => setValorMensal(e.target.value)} placeholder={modo === 'proposta' ? 'Vazio = o da proposta' : '0,00'} />
                  </Campo>
                </div>
              </Secao>

              <Secao titulo="Pagamento">
                <div style={gradeContrato}>
                  <Campo label="Forma de pagamento">
                    <select style={inp} value={forma} onChange={(e) => setForma(e.target.value)}>
                      {FORMAS_PAGAMENTO.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                    </select>
                  </Campo>
                  <Campo label="Condição de pagamento">
                    <input style={inp} value={condicao} onChange={(e) => setCondicao(e.target.value)} placeholder="Ex.: entrada + 5x, 30/60/90" />
                  </Campo>
                  <Campo label="Nº de parcelas">
                    <input style={inp} type="number" min={1} value={nParcelas} onChange={(e) => setNParcelas(e.target.value)} />
                  </Campo>
                  <Campo label="Periodicidade">
                    <select style={inp} value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)}>
                      {PERIODICIDADES_CONTRATO.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                    </select>
                  </Campo>
                  <Campo label="Dia do vencimento">
                    <input style={inp} type="number" min={1} max={28} value={diaVenc} onChange={(e) => setDiaVenc(e.target.value)} placeholder="1 a 28" />
                  </Campo>
                  <Campo label="1º vencimento">
                    <input style={inp} type="date" value={primeiroVenc} onChange={(e) => setPrimeiroVenc(e.target.value)} />
                  </Campo>
                </div>
              </Secao>

              <Secao titulo="Vigência e condições">
                <div style={gradeContrato}>
                  <Campo label="Início previsto">
                    <input style={inp} type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
                  </Campo>
                  <Campo label="Fim da vigência">
                    <input style={inp} type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
                  </Campo>
                  <Campo label="Reajuste">
                    <select style={inp} value={reajuste} onChange={(e) => setReajuste(e.target.value)}>
                      {TIPOS_REAJUSTE_CONTRATO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </Campo>
                  <Campo label="% de reajuste">
                    <input style={inp} inputMode="decimal" value={reajustePct} onChange={(e) => setReajustePct(e.target.value)} disabled={reajuste === 'nenhum'} placeholder="0,00" />
                  </Campo>
                </div>
                <Campo label="Condições específicas">
                  <textarea style={{ ...inp, minHeight: 56, fontFamily: 'inherit' }} value={especificas} onChange={(e) => setEspecificas(e.target.value)} placeholder="Multa, fidelidade, garantias, o que foi combinado" />
                </Campo>
                <Campo label="Prazo desejado para o contrato">
                  <input type="date" style={inp} value={prazo} onChange={(e) => setPrazo(e.target.value)} />
                </Campo>
                <Campo label="Observação para quem vai elaborar">
                  <textarea style={{ ...inp, minHeight: 70, fontFamily: 'inherit' }} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Contexto, pedidos do cliente, etc." />
                </Campo>
                <div style={{ fontSize: 11, color: C.espressoM, marginTop: -6, marginBottom: 12 }}>
                  Depois de enviar, você pode anexar modelos de contrato, prints e documentos do cliente.
                </div>
              </Secao>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={onClose} disabled={salvando} style={{ background: 'transparent', color: C.espresso, border: `1px solid ${C.border}`, padding: '10px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                <button type="button" data-testid="solicitar-contrato" onClick={() => void solicitar()} disabled={salvando} style={{ background: C.gold, color: C.white, border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer' }}>
                  {salvando ? 'Enviando…' : 'Solicitar elaboração'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function tab(active: boolean, disabled: boolean): React.CSSProperties {
  return { flex: 1, minHeight: 36, border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, background: active ? '#FFFFFF' : 'transparent', color: active ? '#3D2314' : '#6B5D4F', boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }
}
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8, paddingTop: 12, borderTop: '1px solid rgba(61,35,20,0.10)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#3D2314', marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}
function traduz(e?: string): string {
  switch (e) {
    case 'company_id_ausente': return 'Empresa não informada.'
    case 'sem_acesso': return 'Você não tem acesso a esta empresa.'
    case 'proposta_nao_encontrada': return 'Proposta não encontrada nesta empresa.'
    case 'cliente_de_outra_empresa': return 'Esse cliente não é desta empresa.'
    case 'dia_vencimento_invalido': return 'Dia de vencimento: de 1 a 28.'
    case 'numero_parcelas_invalido': return 'Nº de parcelas precisa ser pelo menos 1.'
    case 'vigencia_invalida': return 'O fim da vigência não pode ser antes do início.'
    default: return e || 'Não foi possível solicitar o contrato.'
  }
}

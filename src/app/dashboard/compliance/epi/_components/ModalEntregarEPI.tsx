// src/app/dashboard/compliance/epi/_components/ModalEntregarEPI.tsx
// Modal Wizard 3 passos para entregar EPI a um funcionario.
// Passo 1: selecao do EPI + tipo movimento + qtd
// Passo 2: confirmacao com termo legal NR-6
// Passo 3: assinatura no canvas
// Backend: fn_epi_registrar_entrega + INSERT epi_assinatura

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CanvasAssinatura } from './CanvasAssinatura'

const C = {
  espresso: '#3D2314',
  espressoLt: '#5D4534',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16a34a',
  red: '#dc2626',
  redBg: '#fce8e8',
}

interface CatalogoItem {
  id: string
  nome: string
  modelo: string | null
  ca_numero: string
  ca_validade: string
  fabricante_nome: string
  lote: string | null
  vida_util_meses: number | null
  descartavel: boolean
  is_global: boolean
  estoque_disponivel?: number
}

interface Funcionario {
  id: string
  nome_completo: string
  cpf: string | null
  cargo: string | null
  setor: string | null
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  funcionario: Funcionario
  companyId: string
}

type TipoMovimento = 'entrega_inicial' | 'reposicao' | 'troca_vida_util' | 'troca_dano'

const TIPOS_MOVIMENTO: { value: TipoMovimento; label: string }[] = [
  { value: 'entrega_inicial', label: 'Entrega Inicial (primeira vez)' },
  { value: 'reposicao', label: 'Reposição (mesmo EPI)' },
  { value: 'troca_vida_util', label: 'Troca por vida útil' },
  { value: 'troca_dano', label: 'Troca por dano' },
]

export function ModalEntregarEPI({ isOpen, onClose, onSuccess, funcionario, companyId }: Props) {
  const [passo, setPasso] = useState<1 | 2 | 3>(1)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Passo 1
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([])
  const [carregandoCatalogo, setCarregandoCatalogo] = useState(false)
  const [catalogoId, setCatalogoId] = useState('')
  const [tipoMovimento, setTipoMovimento] = useState<TipoMovimento>('entrega_inicial')
  const [quantidade, setQuantidade] = useState(1)
  const [motivo, setMotivo] = useState('')

  // Passo 3
  const [signatureBase64, setSignatureBase64] = useState('')
  const [signatureSvg, setSignatureSvg] = useState('')
  const [signatureEmpty, setSignatureEmpty] = useState(true)

  const carregarCatalogo = useCallback(async () => {
    setCarregandoCatalogo(true)
    try {
      // Buscar EPIs disponiveis: proprios da empresa (mais relevantes) + globais (PS).
      // Duas queries separadas para evitar quirks do operador .or() do PostgREST.
      const COLS = 'id, nome, modelo, ca_numero, ca_validade, fabricante_nome, lote, vida_util_meses, descartavel, is_global, company_id'
      const [ownR, globalR] = await Promise.all([
        supabase
          .from('epi_catalogo')
          .select(COLS)
          .eq('is_global', false)
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('nome'),
        supabase
          .from('epi_catalogo')
          .select(COLS)
          .eq('is_global', true)
          .eq('ativo', true)
          .order('nome'),
      ])
      if (ownR.error) throw ownR.error
      if (globalR.error) throw globalR.error
      setCatalogo([...(ownR.data || []), ...(globalR.data || [])] as any)
    } catch (e: any) {
      console.error('[catalogo]', e?.message)
      setCatalogo([])
    } finally {
      setCarregandoCatalogo(false)
    }
  }, [companyId])

  useEffect(() => {
    if (isOpen) carregarCatalogo()
  }, [isOpen, carregarCatalogo])

  // Reset ao abrir/fechar
  useEffect(() => {
    if (!isOpen) {
      setPasso(1)
      setCatalogoId('')
      setTipoMovimento('entrega_inicial')
      setQuantidade(1)
      setMotivo('')
      setSignatureBase64('')
      setSignatureSvg('')
      setSignatureEmpty(true)
      setErro(null)
    }
  }, [isOpen])

  const epiSelecionado = useMemo(() => catalogo.find((c) => c.id === catalogoId) || null, [catalogo, catalogoId])

  function podeAvancarPasso1(): boolean {
    return !!catalogoId && quantidade > 0
  }

  function fechar() {
    if (carregando) return
    onClose()
  }

  async function confirmar() {
    if (signatureEmpty) {
      setErro('Capture a assinatura antes de confirmar')
      return
    }
    setCarregando(true)
    setErro(null)

    try {
      // 1) Chama RPC para registrar a movimentacao
      const { data: result, error: rpcError } = await supabase.rpc('fn_epi_registrar_entrega', {
        p_company_id: companyId,
        p_funcionario_id: funcionario.id,
        p_catalogo_id: catalogoId,
        p_tipo_movimento: tipoMovimento,
        p_quantidade: quantidade,
        p_motivo: motivo.trim() || null,
        p_observacoes: null,
      })

      if (rpcError) throw new Error(rpcError.message)
      const r: any = result || {}
      if (!r.sucesso) throw new Error(r.mensagem || 'Falha ao registrar entrega')

      const movimentacaoId = r.movimentacao_id
      if (!movimentacaoId) throw new Error('Backend nao retornou movimentacao_id')

      // 2) Insere a assinatura eletronica
      const { error: assError } = await supabase.from('epi_assinatura').insert({
        company_id: companyId,
        movimentacao_id: movimentacaoId,
        funcionario_id: funcionario.id,
        metodo: 'eletronica_desenhada',
        assinatura_dados: {
          base64: signatureBase64,
          svg: signatureSvg,
        },
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        // ip_origem e hash_integridade gerados pelo backend (trigger)
      })

      if (assError) throw new Error(assError.message)

      onSuccess()
      onClose()
    } catch (e: any) {
      setErro(e?.message || 'Erro inesperado')
    } finally {
      setCarregando(false)
    }
  }

  if (!isOpen) return null

  return (
    <div onClick={fechar} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        {/* Header com progresso 3 passos */}
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, color: C.gold, margin: 0, textTransform: 'uppercase' }}>
            EPI · Entrega
          </p>
          <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '4px 0 12px' }}>
            Entregar EPI · Passo {passo} de 3
          </h2>
          <BarraProgresso passoAtual={passo} />
        </div>

        {erro && (
          <div style={{ background: C.redBg, color: C.red, padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            {erro}
          </div>
        )}

        {/* PASSO 1: Selecao */}
        {passo === 1 && (
          <div>
            <Field label="Funcionário (contexto)">
              <input value={`${funcionario.nome_completo}${funcionario.cpf ? ' · ' + funcionario.cpf : ''}`} readOnly style={{ ...inputStyle, opacity: 0.7, cursor: 'default' }} />
            </Field>

            <Field label="EPI *">
              <select
                value={catalogoId}
                onChange={(e) => setCatalogoId(e.target.value)}
                disabled={carregandoCatalogo}
                style={inputStyle}
              >
                <option value="">{carregandoCatalogo ? 'Carregando catálogo…' : 'Selecione o EPI'}</option>
                {catalogo.filter((c) => !c.is_global).length > 0 && (
                  <optgroup label="🏢 Da empresa">
                    {catalogo.filter((c) => !c.is_global).map((epi) => (
                      <option key={epi.id} value={epi.id}>
                        {epi.nome}{epi.modelo ? ` · ${epi.modelo}` : ''} · CA {epi.ca_numero}
                      </option>
                    ))}
                  </optgroup>
                )}
                {catalogo.filter((c) => c.is_global).length > 0 && (
                  <optgroup label="🌐 Catálogo Global PS">
                    {catalogo.filter((c) => c.is_global).map((epi) => (
                      <option key={epi.id} value={epi.id}>
                        {epi.nome}{epi.modelo ? ` · ${epi.modelo}` : ''} · CA {epi.ca_numero}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {epiSelecionado && (
                <div style={{ marginTop: 8, padding: 10, background: C.beigeLt, borderRadius: 8, fontSize: 12, color: C.espressoLt }}>
                  <div><strong>{epiSelecionado.nome}</strong>{epiSelecionado.modelo ? ` · ${epiSelecionado.modelo}` : ''}</div>
                  <div style={{ marginTop: 4 }}>CA {epiSelecionado.ca_numero} · validade {fmtData(epiSelecionado.ca_validade)}</div>
                  <div>Fabricante: {epiSelecionado.fabricante_nome}</div>
                  {epiSelecionado.lote && <div>Lote: {epiSelecionado.lote}</div>}
                </div>
              )}
            </Field>

            <Field label="Tipo de movimento *">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {TIPOS_MOVIMENTO.map((t) => (
                  <label key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: C.ink }}>
                    <input type="radio" name="tipo" value={t.value} checked={tipoMovimento === t.value} onChange={() => setTipoMovimento(t.value)} />
                    {t.label}
                  </label>
                ))}
              </div>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <Field label="Quantidade *">
                <input type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(parseInt(e.target.value) || 1)} style={inputStyle} />
              </Field>
              <Field label="Motivo (opcional)">
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: novo membro, EPI quebrado..." style={inputStyle} />
              </Field>
            </div>

            <div style={botoesRowStyle}>
              <button onClick={fechar} style={btnSecundario}>Cancelar</button>
              <button onClick={() => setPasso(2)} disabled={!podeAvancarPasso1()} style={btnPrimario(podeAvancarPasso1())}>
                Continuar →
              </button>
            </div>
          </div>
        )}

        {/* PASSO 2: Confirmacao + termo */}
        {passo === 2 && epiSelecionado && (
          <div>
            <div style={{ background: C.beigeLt, borderRadius: 10, padding: 16, marginBottom: 14 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: C.espresso, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 12px' }}>Resumo da entrega</h3>
              <ResumoLinha label="Funcionário" valor={`${funcionario.nome_completo}${funcionario.cpf ? ` (${funcionario.cpf})` : ''}`} />
              {(funcionario.cargo || funcionario.setor) && <ResumoLinha label="Cargo / Setor" valor={`${funcionario.cargo || '—'}${funcionario.setor ? ` · ${funcionario.setor}` : ''}`} />}
              <ResumoLinha label="EPI" valor={`${epiSelecionado.nome}${epiSelecionado.modelo ? ' · ' + epiSelecionado.modelo : ''}`} />
              <ResumoLinha label="CA" valor={`${epiSelecionado.ca_numero} (validade ${fmtData(epiSelecionado.ca_validade)})`} />
              <ResumoLinha label="Fabricante" valor={epiSelecionado.fabricante_nome} />
              {epiSelecionado.lote && <ResumoLinha label="Lote" valor={epiSelecionado.lote} />}
              <ResumoLinha label="Tipo movimento" valor={TIPOS_MOVIMENTO.find((t) => t.value === tipoMovimento)?.label || tipoMovimento} />
              <ResumoLinha label="Quantidade" valor={String(quantidade)} />
              {motivo && <ResumoLinha label="Motivo" valor={motivo} />}
              <ResumoLinha label="Data/hora" valor={new Date().toLocaleString('pt-BR')} />
            </div>

            {/* Termo legal */}
            <div style={{ background: '#FFF8EC', border: '1px solid #F0DCB0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.gold, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
                Termo de recebimento — NR-6 do MTE
              </p>
              <p style={{ fontSize: 13, color: C.espresso, lineHeight: 1.5, margin: 0 }}>
                Declaro ter recebido o EPI acima descrito em perfeitas condições de uso, fui orientado(a) sobre seu uso correto, higienização, conservação e obrigatoriedade de utilização durante toda a jornada de trabalho, conforme NR-6 do MTE.
              </p>
            </div>

            <div style={botoesRowStyle}>
              <button onClick={() => setPasso(1)} style={btnSecundario} disabled={carregando}>← Voltar</button>
              <button onClick={() => setPasso(3)} style={btnPrimario(true)} disabled={carregando}>
                Continuar para Assinatura →
              </button>
            </div>
          </div>
        )}

        {/* PASSO 3: Assinatura */}
        {passo === 3 && (
          <div>
            <p style={{ fontSize: 13, color: C.espressoLt, margin: '0 0 14px' }}>
              O funcionário deve assinar abaixo confirmando o recebimento do EPI.
            </p>

            <CanvasAssinatura
              onChange={(data) => {
                setSignatureBase64(data.base64)
                setSignatureSvg(data.svg)
                setSignatureEmpty(data.isEmpty)
              }}
              height={220}
            />

            <div style={{ marginTop: 12, padding: 10, background: C.beigeLt, borderRadius: 8 }}>
              <p style={{ fontSize: 11, color: C.muted, margin: 0, lineHeight: 1.5 }}>
                Sua assinatura, IP, dispositivo e horário do servidor são registrados de forma segura e imutável conforme NR-6 e Lei 14.063/2020.
              </p>
            </div>

            <div style={botoesRowStyle}>
              <button onClick={() => setPasso(2)} style={btnSecundario} disabled={carregando}>← Voltar</button>
              <button onClick={fechar} style={btnSecundario} disabled={carregando}>Cancelar</button>
              <button onClick={confirmar} disabled={carregando || signatureEmpty} style={btnPrimario(!carregando && !signatureEmpty)}>
                {carregando ? 'Registrando…' : '✓ Confirmar Entrega'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function BarraProgresso({ passoAtual }: { passoAtual: 1 | 2 | 3 }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3].map((p) => (
        <div
          key={p}
          style={{
            flex: 1,
            height: 4,
            background: p <= passoAtual ? C.gold : C.borderLt,
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function ResumoLinha({ label, valor }: { label: string; valor: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', borderBottom: `1px dashed ${C.borderLt}`, fontSize: 13 }}>
      <span style={{ color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ color: C.espresso, fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>{valor}</span>
    </div>
  )
}

function fmtData(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    const [y, m, d] = s.split('T')[0].split('-')
    return `${d}/${m}/${y}`
  } catch {
    return s
  }
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(61,35,20,0.55)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const modalStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 12,
  width: 'min(620px, 95vw)',
  maxHeight: '92vh',
  overflowY: 'auto',
  padding: 24,
  boxShadow: '0 12px 36px rgba(61,35,20,0.25)',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'rgba(61,35,20,0.55)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 5,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  background: '#FAF7F2',
  border: '1px solid #ece3d2',
  borderRadius: 8,
  fontSize: 13,
  color: '#1a1a1a',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}

const botoesRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 18,
  flexWrap: 'wrap',
}

const btnSecundario: React.CSSProperties = {
  padding: '10px 16px',
  background: '#FFFFFF',
  color: '#3D2314',
  border: '1px solid #ece3d2',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

function btnPrimario(enabled: boolean): React.CSSProperties {
  return {
    padding: '10px 18px',
    background: enabled ? '#3D2314' : '#d6cfc4',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed',
  }
}

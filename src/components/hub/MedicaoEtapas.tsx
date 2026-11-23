'use client'
// Hub · ONDA S-MED · tela 320 — fluxo de APROVAÇÃO da medição, etapa a etapa.
// Consome só RPCs já publicadas e guardadas por empresa:
//   fn_obra_medicao_etapa_listar / _iniciar / _decidir (migration 20261123214845).
// A medição é UMA só e caminha pela cadeia padrão de 6 etapas; cada decisão fica no histórico (imutável).
// O TÍTULO financeiro NÃO nasce aqui (fica para a fatia de integração financeira · item 6 da spec):
// quando a etapa 'financeiro' é aprovada, o fluxo conclui e o próximo passo gera o título.
// RD-95: "?" no indicador e no campo de motivo. RD-96/RD-100: linguagem e layout próprios.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)'
const VERDE = '#1F7A4D', VERM = '#B91C1C'
const ROTA = '/dashboard/projetos/obras/[id]/medicoes'

// Rótulos próprios das 6 etapas da cadeia padrão (mesma ordem da RPC fn__obra_medicao_etapa_cadeia).
const ROTULO: Record<string, string> = {
  lancamento: 'Lançamento',
  aceite_contratado: 'Aceite do contratado',
  engenharia: 'Engenharia',
  gestao_pessoas: 'Gestão de pessoas',
  diretoria: 'Diretoria',
  financeiro: 'Financeiro',
}

type Etapa = {
  id: string; ordem: number; etapa: string
  decisao: string | null; motivo: string | null
  decidido_por: string | null; decidido_por_nome: string | null; decidido_em: string | null
  pendente: boolean
}
type Estado = { ok: boolean; erro?: string; etapa_atual_id: string | null; etapas: Etapa[] }

const dataBR = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')

export function MedicaoEtapas({ medicaoId, onMudou }: { medicaoId: string; onMudou?: () => void }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [agindo, setAgindo] = useState(false)
  const [devolvendo, setDevolvendo] = useState(false)
  const [motivo, setMotivo] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_medicao_etapa_listar', { p_medicao_id: medicaoId })
    setCarregando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar o fluxo de aprovação.')); return }
    const e = data as Estado
    if (e && e.ok === false) { setErro(e.erro ?? 'Não foi possível carregar o fluxo.'); return }
    setEstado(e)
  }, [medicaoId])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const etapaAtual = useMemo(() => estado?.etapas.find((e) => e.pendente) ?? null, [estado])
  const concluido = useMemo(() => {
    const fin = estado?.etapas.filter((e) => e.etapa === 'financeiro') ?? []
    return fin.length > 0 && fin.every((e) => e.decisao === 'aprovado') && !etapaAtual
  }, [estado, etapaAtual])

  const iniciar = async () => {
    setAgindo(true); setErro(null)
    const { error } = await supabase.rpc('fn_obra_medicao_etapa_iniciar', { p_medicao_id: medicaoId })
    setAgindo(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível iniciar o fluxo.')); return }
    await carregar(); onMudou?.()
  }

  const decidir = async (decisao: 'aprovado' | 'devolvido') => {
    if (decisao === 'devolvido' && motivo.trim() === '') { setErro('Informe o motivo da devolução.'); return }
    setAgindo(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_medicao_etapa_decidir', {
      p_medicao_id: medicaoId, p_decisao: decisao, p_motivo: decisao === 'devolvido' ? motivo.trim() : null,
    })
    setAgindo(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error) { setErro(erroAmigavel(error, 'Não foi possível registrar a decisão.')); return }
    if (r && r.ok === false) { setErro(r.erro ?? 'Não foi possível registrar a decisão.'); return }
    setDevolvendo(false); setMotivo('')
    await carregar(); onMudou?.()
  }

  const chip = (e: Etapa) => {
    const [txt, bg, cor] = e.pendente ? ['Pendente', '#FBF1DC', GOLD]
      : e.decisao === 'aprovado' ? ['Aprovado', '#E8F3EC', VERDE]
      : e.decisao === 'devolvido' ? ['Devolvido', '#FBEAEA', VERM]
      : ['Aguardando', '#F1ECE4', MUT]
    return <span style={{ fontSize: 11, fontWeight: 800, color: cor, background: bg, borderRadius: 999, padding: '2px 9px' }}>{txt}</span>
  }

  const naoIniciado = !!estado && estado.etapas.length === 0

  return (
    <div style={{ marginTop: 12, padding: 14, border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff' }} data-testid={`med-etapas-${medicaoId}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: ESP }}>Aprovação da medição</span>
        <AjudaCampo chave="projetos.medicao.etapa_fluxo" rota={ROTA} />
      </div>

      {erro && <div role="alert" data-testid={`med-etapas-erro-${medicaoId}`} style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 9, fontSize: 13, marginBottom: 10 }}>{erro}</div>}

      {carregando ? (
        <div style={{ fontSize: 13, color: MUT, padding: 8 }}>Carregando fluxo…</div>
      ) : naoIniciado ? (
        <div data-testid={`med-etapas-vazio-${medicaoId}`}>
          <p style={{ fontSize: 13, color: MUT, margin: '0 0 10px', maxWidth: 560 }}>
            A medição ainda não entrou no fluxo de aprovação. Ao iniciar, ela percorre as etapas Lançamento → Aceite do contratado → Engenharia → Gestão de pessoas → Diretoria → Financeiro; cada etapa aprova ou devolve com motivo, e o histórico fica registrado.
          </p>
          <button onClick={() => void iniciar()} disabled={agindo} data-testid={`med-etapas-iniciar-${medicaoId}`}
            style={{ padding: '8px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: agindo ? MUT : ESP, color: '#fff', fontSize: 13, fontWeight: 700, cursor: agindo ? 'default' : 'pointer' }}>
            {agindo ? 'Iniciando…' : 'Iniciar aprovação'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {concluido && (
            <div data-testid={`med-etapas-concluido-${medicaoId}`} style={{ background: '#E8F3EC', color: VERDE, borderRadius: 8, padding: '8px 10px', fontSize: 13, fontWeight: 700 }}>
              Fluxo concluído — Financeiro aprovou. O título a pagar/receber é gerado na etapa de integração financeira.
            </div>
          )}
          {(estado?.etapas ?? []).map((e) => (
            <div key={e.id} data-testid={`med-etapa-${e.etapa}-${e.ordem}`}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', borderRadius: 8, background: e.pendente ? '#FBF8F1' : BG, border: `1px solid ${e.pendente ? GOLD : LINE}` }}>
              <span style={{ fontSize: 12, color: MUT, fontWeight: 800, minWidth: 18, textAlign: 'center' }}>{e.ordem}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>{ROTULO[e.etapa] ?? e.etapa}</span>
                  {chip(e)}
                </div>
                {e.decisao && (
                  <div style={{ fontSize: 12, color: MUT, marginTop: 2 }}>
                    {e.decisao === 'aprovado' ? 'Aprovado' : 'Devolvido'}{e.decidido_por_nome ? ` por ${e.decidido_por_nome}` : ''}{e.decidido_em ? ` · ${dataBR(e.decidido_em)}` : ''}
                    {e.motivo ? ` — ${e.motivo}` : ''}
                  </div>
                )}
              </div>
            </div>
          ))}

          {etapaAtual && (
            <div style={{ marginTop: 4, paddingTop: 10, borderTop: `1px dashed ${LINE}` }} data-testid={`med-etapas-acao-${medicaoId}`}>
              <div style={{ fontSize: 12, color: MUT, marginBottom: 8 }}>
                Etapa atual: <strong style={{ color: ESP }}>{ROTULO[etapaAtual.etapa] ?? etapaAtual.etapa}</strong>
              </div>
              {devolvendo ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700, marginBottom: 4 }}>
                      Motivo da devolução <AjudaCampo chave="projetos.medicao.etapa_motivo" rota={ROTA} />
                    </span>
                    <textarea data-testid={`med-etapas-motivo-${medicaoId}`} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} rows={2}
                      placeholder="Diga o que precisa ser corrigido para a etapa anterior resolver."
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, color: ESP, resize: 'vertical' }} />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setDevolvendo(false); setMotivo(''); setErro(null) }} disabled={agindo}
                      style={{ padding: '8px 14px', borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', color: MUT, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                    <button onClick={() => void decidir('devolvido')} disabled={agindo} data-testid={`med-etapas-devolver-confirmar-${medicaoId}`}
                      style={{ padding: '8px 14px', borderRadius: 999, border: `1px solid ${VERM}`, background: agindo ? MUT : VERM, color: '#fff', fontSize: 13, fontWeight: 700, cursor: agindo ? 'default' : 'pointer' }}>
                      {agindo ? 'Devolvendo…' : 'Confirmar devolução'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => void decidir('aprovado')} disabled={agindo} data-testid={`med-etapas-aprovar-${medicaoId}`}
                    style={{ padding: '8px 16px', borderRadius: 999, border: `1px solid ${VERDE}`, background: agindo ? MUT : VERDE, color: '#fff', fontSize: 13, fontWeight: 700, cursor: agindo ? 'default' : 'pointer' }}>
                    {agindo ? 'Aprovando…' : `Aprovar ${ROTULO[etapaAtual.etapa] ?? ''}`.trim()}
                  </button>
                  {(() => {
                    const semAnterior = etapaAtual.etapa === 'lancamento' // lançamento não tem etapa anterior para onde devolver
                    return (
                      <button onClick={() => { setDevolvendo(true); setErro(null) }} disabled={agindo || semAnterior}
                        data-testid={`med-etapas-devolver-${medicaoId}`}
                        style={{ padding: '8px 16px', borderRadius: 999, border: `1px solid ${VERM}`, background: '#fff', color: VERM, fontSize: 13, fontWeight: 700, cursor: semAnterior ? 'default' : 'pointer', opacity: semAnterior ? 0.4 : 1 }}>
                        Devolver
                      </button>
                    )
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

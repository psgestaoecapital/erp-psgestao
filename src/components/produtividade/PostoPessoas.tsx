'use client'

// Postos · Pessoas e vagas (desenho do CEO 08/11, tarefa beebd8a4). Mostra QUEM está no posto (nome/CPF),
// a VAGA ABERTA (quadro × ocupado real) e deixa o RH incluir/excluir pessoa por CPF — manual (ou já vinda do
// ponto). Aditiva: consome só RPCs já publicadas e guardadas por escopo (fn_prod_posto_pessoas_listar /
// fn_prod_posto_pessoa_alocar / _desalocar). CPF é dado pessoal: a leitura é fail-closed por empresa no banco.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/produtividade'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC',
  gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB', blue: '#2F5AA8',
}
const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none', width: '100%' }

export type Turno = { id: string; nome: string; codigo?: string | null }
type Pessoa = { id: string; funcionario_id: string | null; nome: string | null; cpf: string | null; origem: 'ponto' | 'manual'; turno_id: string | null; vigencia_inicio: string }

const soDig = (s: string) => s.replace(/\D/g, '').slice(0, 11)
const fmtCpf = (s: string | null) => {
  const d = (s ?? '').replace(/\D/g, '')
  if (d.length !== 11) return s || '—'
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

export function PostoPessoas({ postoId, capacidade, turnos, onChange }: {
  postoId: string
  capacidade: number | null          // quadro: quantas o posto precisa (prod_posto_turno.pessoas)
  turnos: Turno[]
  onChange?: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [carregado, setCarregado] = useState(false)
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [cpf, setCpf] = useState('')
  const [turnoId, setTurnoId] = useState('')

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_prod_posto_pessoas_listar', { p_posto_id: postoId })
    if (error) { setErro(error.message); return }
    const r = data as { ok?: boolean; pessoas?: Pessoa[]; erro?: string } | null
    if (r?.ok) { setPessoas(r.pessoas ?? []); setErro(null) }
    else setErro(r?.erro === 'sem_acesso' ? 'Sem acesso a este posto.' : 'Não consegui carregar as pessoas do posto.')
    setCarregado(true)
  }, [postoId])

  useEffect(() => { if (aberto && !carregado) void carregar() }, [aberto, carregado, carregar])

  async function incluir() {
    const d = soDig(cpf)
    if (d.length !== 11) { setErro('CPF: digite os 11 dígitos.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_prod_posto_pessoa_alocar', { p_dados: { posto_id: postoId, cpf: d, turno_id: turnoId || null } })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message ?? traduz(r?.erro)); return }
    setCpf(''); setTurnoId(''); setErro(null)
    await carregar(); onChange?.()
  }

  async function excluir(id: string) {
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_prod_posto_pessoa_desalocar', { p_id: id })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error?.message ?? traduz(r?.erro)); return }
    setErro(null); await carregar(); onChange?.()
  }

  const ocupado = pessoas.length
  const semQuadro = capacidade == null
  const vaga = semQuadro ? null : Math.max(0, capacidade - ocupado)
  const acima = !semQuadro && ocupado > (capacidade ?? 0) ? ocupado - (capacidade ?? 0) : 0

  const badge = (() => {
    if (!carregado) return null
    if (semQuadro) return <B bg={C.cream} fg={C.espM}>defina o quadro em “Pessoas”</B>
    if (acima > 0) return <B bg={C.redBg} fg={C.red}>{acima} acima do quadro</B>
    if ((vaga ?? 0) > 0) return <B bg={C.amberBg} fg={C.amber}>{vaga} vaga{vaga === 1 ? '' : 's'} aberta{vaga === 1 ? '' : 's'}</B>
    return <B bg={C.greenBg} fg={C.green}>quadro completo</B>
  })()

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 9, background: C.white, overflow: 'hidden' }}>
      <button type="button" data-testid={`posto-pessoas-toggle`} onClick={() => setAberto((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', background: 'none', border: 'none', cursor: 'pointer', color: C.esp, fontSize: 12.5, fontWeight: 700 }}>
        <span>👥 Pessoas e vagas</span>
        <Aj k="prod.posto.pessoas_vagas" />
        {carregado && <span style={{ fontWeight: 600, color: C.espM }}>· Ocupado {ocupado}{semQuadro ? '' : ` de ${capacidade}`}</span>}
        {badge}
        <span style={{ marginLeft: 'auto', color: C.blue }}>{aberto ? '▲' : '▾'}</span>
      </button>

      {aberto && (
        <div style={{ padding: '2px 11px 12px', borderTop: `1px solid ${C.cream}` }}>
          {erro && <div style={{ fontSize: 12, color: C.red, background: C.redBg, borderRadius: 7, padding: '6px 9px', margin: '8px 0' }}>{erro}</div>}

          {carregado && pessoas.length === 0 && (
            <div style={{ fontSize: 12.5, color: C.espM, padding: '10px 0 4px' }}>
              Nenhuma pessoa alocada neste posto ainda. {semQuadro ? 'Defina o quadro no “Pessoas” do turno e inclua quem ocupa o posto, por CPF.' : `${capacidade} vaga${(capacidade ?? 0) === 1 ? '' : 's'} aberta${(capacidade ?? 0) === 1 ? '' : 's'} — inclua quem ocupa o posto, por CPF.`}
            </div>
          )}

          {pessoas.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
              {pessoas.map((p) => (
                <div key={p.id} data-testid={`posto-pessoa-${p.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', background: C.cream, borderRadius: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.esp }}>{p.nome ?? 'Sem nome no cadastro'}</span>
                  <span style={{ fontSize: 12, color: C.espM, fontVariantNumeric: 'tabular-nums' }}>{fmtCpf(p.cpf)}</span>
                  <span style={{ fontSize: 10.5, color: C.espM, background: C.white, border: `1px solid ${C.border}`, borderRadius: 5, padding: '1px 6px' }}>
                    {p.origem === 'ponto' ? 'do ponto' : 'CPF manual'}
                  </span>
                  {p.turno_id && <span style={{ fontSize: 11, color: C.espM }}>{turnos.find((t) => t.id === p.turno_id)?.codigo ?? turnos.find((t) => t.id === p.turno_id)?.nome ?? 'turno'}</span>}
                  <button type="button" disabled={busy} data-testid={`posto-pessoa-remover-${p.id}`} onClick={() => void excluir(p.id)} title="Remover do posto (encerra a alocação, não apaga o histórico)"
                    style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.red, cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 15 }}>×</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(120px, 160px) auto', gap: 8, alignItems: 'end', marginTop: 8 }}>
            <label style={{ fontSize: 11, color: C.espM, display: 'block' }}>
              CPF da pessoa <AjudaCampo chave="prod.posto.pessoa_cpf" rota={ROTA} />
              <input data-testid="posto-pessoa-cpf" value={fmtCpf(cpf) === '—' ? cpf : fmtCpf(cpf)} onChange={(e) => setCpf(soDig(e.target.value))}
                inputMode="numeric" placeholder="000.000.000-00" style={{ ...inp, marginTop: 2 }} />
            </label>
            <label style={{ fontSize: 11, color: C.espM, display: 'block' }}>
              Turno <AjudaCampo chave="prod.posto.pessoa_turno" rota={ROTA} />
              <select data-testid="posto-pessoa-turno" value={turnoId} onChange={(e) => setTurnoId(e.target.value)} style={{ ...inp, marginTop: 2 }}>
                <option value="">— sem turno</option>
                {turnos.map((t) => <option key={t.id} value={t.id}>{t.codigo ?? t.nome}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy} data-testid="posto-pessoa-incluir" onClick={() => void incluir()}
              style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: busy ? 'not-allowed' : 'pointer', background: busy ? C.espL : C.gold, color: C.white }}>
              Incluir
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function B({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return <span style={{ fontSize: 10.5, fontWeight: 700, color: fg, background: bg, borderRadius: 5, padding: '2px 7px' }}>{children}</span>
}

function traduz(erro?: string): string {
  switch (erro) {
    case 'sem_pessoa': return 'Informe o CPF da pessoa.'
    case 'posto_obrigatorio': return 'Posto não identificado.'
    case 'posto_nao_encontrado': return 'Posto não encontrado.'
    case 'sem_acesso': return 'Sem acesso a este posto.'
    case 'funcionario_outra_empresa': return 'Essa pessoa é de outra empresa.'
    case 'alocacao_nao_encontrada': return 'Alocação não encontrada.'
    case 'ja_encerrada': return 'Essa alocação já foi encerrada.'
    default: return 'Não foi possível concluir. Tente de novo.'
  }
}

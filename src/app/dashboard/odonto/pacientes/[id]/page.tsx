'use client'
// RD-41 · Odonto — Ficha do Paciente (abas). Benchmark Simples Dental. 🅰️
// Reusa RPCs/tabelas existentes (RD-26): planos/débitos/prontuário/odontograma. Financeiro vem
// da GE (DebitosPaciente / O0) — não recria. Anamnese/Imagens/Documentos = ondas seguintes.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ShellOdonto, PageHeaderOdonto, CardOdonto, EmptyStateOdonto, BrandIcon, TOK, DebitosPaciente, type TituloDebito } from '@/components/odonto/ui'
import { Odontograma, type Face } from '@/components/odonto/Odontograma'
import { UserRound, ChevronLeft, MessageCircle, Pencil, FileText, TrendingUp, Stethoscope, Wallet, ClipboardList, AlertTriangle, HeartPulse, Camera, FolderOpen, CheckCircle2, CalendarDays, X } from 'lucide-react'

type Paciente = {
  id: string; nome: string; cpf: string | null; rg: string | null; numero_paciente: string | null; data_nascimento: string | null; sexo: string | null
  telefone: string | null; celular: string | null; email: string | null; cliente_id: string | null
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null
  responsavel_nome: string | null; responsavel_cpf: string | null; responsavel_parentesco: string | null
  convenio_nome: string | null; convenio_carteirinha: string | null; alergias: string | null; observacao: string | null
}
type Plano = { id: string; titulo: string | null; status: string; valor_total: number | null; criado_em: string | null }
type Pront = { id: string; tipo: string; texto: string; data_atendimento: string | null; origem: string; assinado: boolean; profissional_nome: string | null; created_at: string | null }
type Cond = { dente: string; face: string | null; condicao: string }

const ABAS = [
  { k: 'sobre', l: 'Sobre', icon: FileText },
  { k: 'orcamentos', l: 'Orçamentos', icon: TrendingUp },
  { k: 'odontograma', l: 'Odontograma', icon: Stethoscope },
  { k: 'debitos', l: 'Débitos', icon: Wallet },
  { k: 'prontuario', l: 'Prontuário', icon: ClipboardList },
  { k: 'anamnese', l: 'Anamnese', icon: HeartPulse },
  { k: 'imagens', l: 'Imagens', icon: Camera },
  { k: 'documentos', l: 'Documentos', icon: FolderOpen },
] as const
type Aba = typeof ABAS[number]['k']

// Abas do roadmap O2+ que ainda não acenderam (OD-4 Anamnese, OD-5 Imagens, OD-6 Documentos).
// Empty state HONESTO (RD-51): nada finge dado. Odontograma e Prontuário seguem funcionais (não regride).
const EM_CONSTRUCAO: Record<string, { titulo: string; linha: string }> = {
  anamnese: { titulo: 'Anamnese — em construção', linha: 'O questionário de saúde estruturado chega no OD-4. Por ora, registre no Prontuário.' },
  imagens: { titulo: 'Imagens — em construção', linha: 'Raio-X, fotos intraorais e documentação de imagem chegam no OD-5.' },
  documentos: { titulo: 'Documentos — em construção', linha: 'Termos, atestados e modelos assináveis chegam no OD-6.' },
}

// cor da condição do odontograma (tinta suave; semáforo é reservado a status do plano)
const COND_COR: Record<string, string> = { carie: '#F3C7C0', fratura: '#F3C7C0', restauracao: '#CFE0F0', coroa: '#CFE0F0', canal: '#CFE0F0', implante: '#CFE0F0' }
const brl = (v: number | null | undefined) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (s: string | null | undefined) => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('pt-BR') } catch { return '—' } }
function calcIdade(nasc: string | null | undefined): number | null {
  if (!nasc) return null
  const d = new Date(nasc); if (isNaN(d.getTime())) return null
  const h = new Date(); let i = h.getFullYear() - d.getFullYear(); const m = h.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && h.getDate() < d.getDate())) i--
  return i >= 0 && i < 130 ? i : null
}
function waLink(fone: string | null | undefined): string | null {
  const t = (fone ?? '').replace(/\D/g, ''); if (t.length < 10) return null
  return `https://wa.me/${t.length <= 11 ? '55' + t : t}`
}
function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => { if (typeof window === 'undefined') return null; const v = localStorage.getItem('ps_empresa_sel'); return (!v || v === 'consolidado' || v.startsWith('group_')) ? null : v }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

export default function FichaPacientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const companyId = useCompanyId()
  const [pac, setPac] = useState<Paciente | null>(null)
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<Aba>('sobre')

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    const { data } = await supabase.from('erp_odonto_paciente').select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
    setPac((data as Paciente) ?? null); setLoading(false)
  }, [companyId, id])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  if (!companyId) return <ShellOdonto><EmptyStateOdonto titulo="Escolha uma clínica" linha="Selecione uma empresa específica no topo do menu." /></ShellOdonto>
  if (loading) return <ShellOdonto><div style={{ padding: 24, color: TOK.mut }}>Carregando…</div></ShellOdonto>
  if (!pac) return <ShellOdonto><EmptyStateOdonto titulo="Paciente não encontrado" linha="Ele pode ter sido inativado." acao={<Link href="/dashboard/odonto/pacientes" style={btnGold}>Voltar</Link>} /></ShellOdonto>

  const idade = calcIdade(pac.data_nascimento)
  const menor = idade != null && idade < 18
  const wa = waLink(pac.celular || pac.telefone)

  return (
    <ShellOdonto>
      <Link href="/dashboard/odonto/pacientes" style={{ background: 'none', border: 'none', color: TOK.mut, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0, marginBottom: 6, textDecoration: 'none' }}><ChevronLeft size={16} /> Pacientes</Link>
      <PageHeaderOdonto
        icon={<BrandIcon><UserRound size={20} /></BrandIcon>}
        titulo={pac.nome}
        subtitulo={[pac.numero_paciente ? `#${pac.numero_paciente}` : null, idade != null ? `${idade} anos` : null, pac.cpf ? `CPF ${pac.cpf}` : null, pac.celular || pac.telefone].filter(Boolean).join(' · ') || 'Paciente'}
        acoes={
          <div style={{ display: 'inline-flex', gap: 8 }}>
            {wa && <a href={wa} target="_blank" rel="noreferrer" style={{ ...btnLine, color: '#166534' }}><MessageCircle size={15} /> WhatsApp</a>}
            <Link href={`/dashboard/odonto/pacientes?edit=${pac.id}`} style={btnLine}><Pencil size={14} /> Editar</Link>
          </div>
        }
      />

      {/* alergias em destaque (segurança clínica) */}
      {pac.alergias && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FBEBEB', border: `1px solid ${TOK.red}55`, color: TOK.red, borderRadius: 10, padding: '9px 12px', margin: '4px 0 10px', fontSize: 13, fontWeight: 700 }}>
          <AlertTriangle size={16} /> Alergias: {pac.alergias}
        </div>
      )}

      {/* abas */}
      <div style={{ display: 'flex', gap: 4, background: TOK.bg, borderRadius: 999, padding: 3, margin: '4px 0 12px', overflowX: 'auto' }}>
        {ABAS.map(({ k, l, icon: Ic }) => (
          <button key={k} onClick={() => setAba(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 999, cursor: 'pointer', border: 'none', whiteSpace: 'nowrap', background: aba === k ? TOK.gold : 'transparent', color: aba === k ? '#fff' : TOK.mut }}>
            <Ic size={14} /> {l}
          </button>
        ))}
      </div>

      {aba === 'sobre' && <AbaSobre pac={pac} idade={idade} menor={menor} companyId={companyId} pacienteId={id} />}
      {aba === 'orcamentos' && <AbaOrcamentos companyId={companyId} pacienteId={id} />}
      {aba === 'odontograma' && <AbaOdontograma companyId={companyId} pacienteId={id} />}
      {aba === 'debitos' && <AbaDebitos companyId={companyId} pacienteId={id} />}
      {aba === 'prontuario' && <AbaProntuario companyId={companyId} pacienteId={id} />}
      {EM_CONSTRUCAO[aba] && <EmptyStateOdonto titulo={EM_CONSTRUCAO[aba].titulo} linha={EM_CONSTRUCAO[aba].linha} />}
    </ShellOdonto>
  )
}

type Consulta = { id: string; data: string; hora_inicio: string | null; status: string }
const CONSULTA_COR: Record<string, { l: string; cor: string; bg: string }> = {
  agendado: { l: 'Agendado', cor: '#1D4ED8', bg: '#EAF0FE' }, confirmado: { l: 'Confirmado', cor: TOK.green, bg: '#E7F3EA' },
  em_atendimento: { l: 'Em atendimento', cor: TOK.amber, bg: '#FBF0DF' }, concluido: { l: 'Concluído', cor: TOK.gray, bg: '#F1F1F0' },
  faltou: { l: 'Faltou', cor: TOK.red, bg: '#FBEBEB' }, cancelado: { l: 'Cancelado', cor: '#9CA3AF', bg: '#F4F3F1' },
}

function AbaSobre({ pac, idade, menor, companyId, pacienteId }: { pac: Paciente; idade: number | null; menor: boolean; companyId: string; pacienteId: string }) {
  const endereco = [ [pac.logradouro, pac.numero].filter(Boolean).join(', '), pac.bairro, [pac.cidade, pac.uf].filter(Boolean).join('/') ].filter(Boolean).join(' · ')
  const [consultas, setConsultas] = useState<Consulta[]>([])
  const [ultEvo, setUltEvo] = useState<Pront | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      const { data: ags } = await supabase.from('erp_odonto_agendamento')
        .select('id, data, hora_inicio, status').eq('company_id', companyId).eq('paciente_id', pacienteId)
        .order('data', { ascending: false }).order('hora_inicio', { ascending: false }).limit(30)
      if (alive) setConsultas(((ags as Consulta[] | null) ?? []))
      const { data: pr } = await supabase.rpc('fn_odonto_prontuario_paciente', { p_company_id: companyId, p_paciente_id: pacienteId })
      if (alive) setUltEvo(((pr as Pront[] | null) ?? [])[0] ?? null)
    })()
    return () => { alive = false }
  }, [companyId, pacienteId])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        <CardOdonto style={{ padding: 14 }}>
          <SecTit>Pessoais</SecTit>
          <Linha k="Código / Prontuário" v={pac.numero_paciente ? `#${pac.numero_paciente}` : null} />
          <Linha k="Nome" v={pac.nome} />
          <Linha k="CPF" v={pac.cpf} />
          <Linha k="RG" v={pac.rg} />
          <Linha k="Nascimento" v={pac.data_nascimento ? `${fmtData(pac.data_nascimento)}${idade != null ? ` · ${idade} anos` : ''}` : null} />
          <Linha k="Sexo" v={pac.sexo === 'F' ? 'Feminino' : pac.sexo === 'M' ? 'Masculino' : pac.sexo === 'O' ? 'Outro' : null} />
          <Linha k="Celular" v={pac.celular} />
          <Linha k="Telefone" v={pac.telefone} />
          <Linha k="E-mail" v={pac.email} />
        </CardOdonto>
        <CardOdonto style={{ padding: 14 }}>
          <SecTit>Endereço</SecTit>
          <Linha k="Endereço" v={endereco || null} />
          <Linha k="CEP" v={pac.cep} />
          <SecTit>Convênio</SecTit>
          <Linha k="Convênio" v={pac.convenio_nome || 'Particular'} />
          <Linha k="Carteirinha" v={pac.convenio_carteirinha} />
        </CardOdonto>
        {(menor || pac.responsavel_nome) && (
          <CardOdonto style={{ padding: 14, borderColor: menor ? TOK.amber : undefined }}>
            <SecTit>Responsável {menor ? '(obrigatório — menor)' : ''}</SecTit>
            <Linha k="Nome" v={pac.responsavel_nome} alerta={menor && !pac.responsavel_nome} />
            <Linha k="CPF" v={pac.responsavel_cpf} />
            <Linha k="Parentesco" v={pac.responsavel_parentesco} />
          </CardOdonto>
        )}
        <CardOdonto style={{ padding: 14 }}>
          <SecTit>Clínico</SecTit>
          <Linha k="Alergias" v={pac.alergias} alerta={!!pac.alergias} />
          <Linha k="Observação" v={pac.observacao} />
        </CardOdonto>
      </div>

      <CardOdonto style={{ padding: 14 }}>
        <SecTit>Última evolução</SecTit>
        {ultEvo ? (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: TOK.esp, marginBottom: 3 }}>{fmtData(ultEvo.data_atendimento)} · {ultEvo.tipo}{ultEvo.profissional_nome ? ` · ${ultEvo.profissional_nome}` : ''}</div>
            <div style={{ fontSize: 13, color: TOK.esp, whiteSpace: 'pre-wrap' }}>{ultEvo.texto}</div>
          </div>
        ) : <div style={{ fontSize: 13, color: TOK.mut }}>Sem evolução registrada. Registre na aba <strong>Prontuário</strong>.</div>}
      </CardOdonto>

      <CardOdonto style={{ padding: 14 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
          <SecTit>Consultas</SecTit>
          <Link href="/dashboard/odonto/agenda" style={{ fontSize: 12, color: TOK.gold, textDecoration: 'none' }}>Ver na agenda</Link>
        </div>
        {consultas.length === 0 ? (
          <div style={{ fontSize: 13, color: TOK.mut }}>Sem consultas registradas para este paciente.</div>
        ) : (
          <div style={{ border: `0.5px solid ${TOK.line}`, borderRadius: 10, overflow: 'hidden' }}>
            {consultas.map((c, i) => { const S = CONSULTA_COR[c.status] ?? CONSULTA_COR.agendado; return (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2" style={{ borderTop: i ? `0.5px solid ${TOK.line}` : 'none' }}>
                <CalendarDays size={14} style={{ color: TOK.mut, flexShrink: 0 }} />
                <div className="flex-1 min-w-0" style={{ fontSize: 13, color: TOK.esp }}>{fmtData(c.data)}{c.hora_inicio ? ` · ${c.hora_inicio.slice(0, 5)}` : ''}</div>
                <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: S.bg, color: S.cor, flexShrink: 0 }}>{S.l}</span>
              </div>) })}
          </div>
        )}
      </CardOdonto>
    </div>
  )
}

const APROVADO = new Set(['aprovado', 'em_andamento', 'concluido', 'cancelado'])

function AbaOrcamentos({ companyId, pacienteId }: { companyId: string; pacienteId: string }) {
  const [planos, setPlanos] = useState<Plano[]>([])
  const [loading, setLoading] = useState(true)
  const [aprovar, setAprovar] = useState<Plano | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_odonto_planos_paciente', { p_company_id: companyId, p_paciente_id: pacienteId })
    setPlanos((data as Plano[]) ?? []); setLoading(false)
  }, [companyId, pacienteId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  if (loading) return <div style={{ color: TOK.mut, fontSize: 13 }}>Carregando…</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Link href="/dashboard/odonto/clinica" style={btnGold}>+ Orçar na Clínica</Link>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: TOK.green, fontWeight: 600 }}>{msg}</div>}
      {planos.length === 0 ? (
        <EmptyStateOdonto titulo="Sem orçamentos" linha="Crie um plano de tratamento na tela Clínica (odontograma + valores + aprovação → financeiro)." />
      ) : planos.map((p) => { const aprovado = APROVADO.has((p.status || '').toLowerCase()); return (
        <CardOdonto key={p.id} style={{ padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: TOK.esp }}>{p.titulo || 'Plano de tratamento'}</div>
            <div style={{ fontSize: 11.5, color: TOK.mut }}>{fmtData(p.criado_em)} · <span style={{ fontWeight: 700 }}>{p.status}</span></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: TOK.gold }}>{brl(p.valor_total)}</div>
            {aprovado
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: TOK.green }}><CheckCircle2 size={15} /> Aprovado</span>
              : <button onClick={() => setAprovar(p)} style={btnGold}><CheckCircle2 size={15} /> Aprovar</button>}
          </div>
        </CardOdonto>
      ) })}
      {aprovar && (
        <AprovarPlanoModal
          plano={aprovar}
          onClose={() => setAprovar(null)}
          onOk={(titulos, valor) => { setAprovar(null); setMsg(titulos > 0 ? `Plano aprovado · ${titulos} título(s) gerado(s) no financeiro (${brl(valor)}).` : 'Plano aprovado.'); setTimeout(() => setMsg(null), 5000); void carregar() }}
        />
      )}
    </div>
  )
}

// Modal de aprovação → gera erp_receber (idempotente) via fn_odonto_plano_aprovar_financeiro.
function AprovarPlanoModal({ plano, onClose, onOk }: { plano: Plano; onClose: () => void; onOk: (titulos: number, valor: number) => void }) {
  const [parcelas, setParcelas] = useState(1)
  const [entrada, setEntrada] = useState('0')
  const [primeiraVenc, setPrimeiraVenc] = useState(new Date().toISOString().slice(0, 10))
  const [forma, setForma] = useState('boleto')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const aprovar = async () => {
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_odonto_plano_aprovar_financeiro', {
      p_id: plano.id, p_parcelas: Math.max(1, parcelas), p_entrada: parseFloat(entrada.replace(',', '.')) || 0,
      p_primeira_venc: primeiraVenc, p_forma: forma,
    })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string; titulos?: number; valor?: number } | null
    if (error || !r?.ok) { setErro(r?.erro || error?.message || 'Falha ao aprovar o plano.'); return }
    onOk(r.titulos ?? 0, r.valor ?? 0)
  }
  return (
    <ModalFicha titulo="Aprovar plano → financeiro" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: TOK.mut, marginBottom: 10 }}>{plano.titulo || 'Plano de tratamento'} · <strong style={{ color: TOK.gold }}>{brl(plano.valor_total)}</strong>. Gera as contas a receber (idempotente — reaprovar não duplica).</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Campo label="Parcelas"><input type="number" min={1} max={60} value={parcelas} onChange={(e) => setParcelas(parseInt(e.target.value || '1', 10))} style={inpFicha} /></Campo>
        <Campo label="Entrada (R$)"><input inputMode="decimal" value={entrada} onChange={(e) => setEntrada(e.target.value)} style={inpFicha} /></Campo>
        <Campo label="1º vencimento"><input type="date" value={primeiraVenc} onChange={(e) => setPrimeiraVenc(e.target.value)} style={inpFicha} /></Campo>
        <Campo label="Forma"><select value={forma} onChange={(e) => setForma(e.target.value)} style={inpFicha}>{['boleto', 'pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'transferencia', 'cheque'].map((f) => <option key={f} value={f}>{FORMA_LABEL[f] ?? f}</option>)}</select></Campo>
      </div>
      {erro && <div style={{ fontSize: 12.5, color: TOK.red, marginTop: 8 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={() => void aprovar()} disabled={salvando} style={{ ...btnGold, flex: 1, justifyContent: 'center', opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Aprovando…' : 'Aprovar e gerar financeiro'}</button>
        <button onClick={onClose} disabled={salvando} style={btnLine}>Cancelar</button>
      </div>
    </ModalFicha>
  )
}

// Aba Débitos + ação RECEBER (OD-1). Exibe via DebitosPaciente (reuso) e injeta o botão Receber por
// título aberto → modal (7 formas + valor + data + conta) → fn_receber_baixar_pagamento (RPC canônica).
function AbaDebitos({ companyId, pacienteId }: { companyId: string; pacienteId: string }) {
  const [receber, setReceber] = useState<TituloDebito | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {msg && <div style={{ fontSize: 12.5, color: TOK.green, fontWeight: 600 }}>{msg}</div>}
      <DebitosPaciente
        pacienteId={pacienteId}
        refreshKey={refreshKey}
        acaoTitulo={(t) => (t.status === 'pago' || t.status === 'recebido') ? null : (
          <button onClick={() => setReceber(t)} style={{ ...btnGold, padding: '5px 10px', fontSize: 12 }}>Receber</button>
        )}
      />
      {receber && (
        <ReceberModal companyId={companyId} titulo={receber} onClose={() => setReceber(null)}
          onOk={(v) => { setReceber(null); setRefreshKey((k) => k + 1); setMsg(`Recebimento de ${brl(v)} registrado.`); setTimeout(() => setMsg(null), 5000) }} />
      )}
    </div>
  )
}

const FORMA_LABEL: Record<string, string> = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', pix: 'Pix', transferencia: 'Transferência', boleto: 'Boleto', cheque: 'Cheque' }

// Modal Receber — 7 formas + valor + data + conta financeira → fn_receber_baixar_pagamento (reuso GE).
function ReceberModal({ companyId, titulo, onClose, onOk }: { companyId: string; titulo: TituloDebito; onClose: () => void; onOk: (valor: number) => void }) {
  const [contas, setContas] = useState<{ id: string; nome: string; banco: string | null }[]>([])
  const [conta, setConta] = useState('')
  const [forma, setForma] = useState('pix')
  const [valor, setValor] = useState(String(titulo.valor ?? ''))
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    void supabase.from('erp_banco_contas').select('id, nome, banco').eq('company_id', companyId).eq('ativo', true).order('nome')
      .then(({ data }) => setContas((data as { id: string; nome: string; banco: string | null }[] | null) ?? []))
  }, [companyId])
  const receber = async () => {
    if (!conta) { setErro('Escolha a conta financeira que recebe.'); return }
    setSalvando(true); setErro(null)
    const { data: res, error } = await supabase.rpc('fn_receber_baixar_pagamento', {
      p_receber_id: titulo.id, p_data_pagamento: data, p_conta_bancaria_id: conta,
      p_forma_pagamento: (FORMA_LABEL[forma] ?? forma).toUpperCase(), p_valor_pago: parseFloat(valor.replace(',', '.')) || null,
    })
    setSalvando(false)
    const r = res as { sucesso?: boolean; erro?: string; valor_baixa?: number } | null
    if (error || !r?.sucesso) { setErro(r?.erro || error?.message || 'Falha ao registrar o recebimento.'); return }
    onOk(r.valor_baixa ?? (parseFloat(valor.replace(',', '.')) || 0))
  }
  return (
    <ModalFicha titulo="Receber título" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: TOK.mut, marginBottom: 10 }}>{titulo.descricao} · venc. {fmtData(titulo.data_vencimento)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Campo label="Forma"><select value={forma} onChange={(e) => setForma(e.target.value)} style={inpFicha}>{['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'transferencia', 'boleto', 'cheque'].map((f) => <option key={f} value={f}>{FORMA_LABEL[f]}</option>)}</select></Campo>
        <Campo label="Valor (R$)"><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} style={inpFicha} /></Campo>
        <Campo label="Data"><input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inpFicha} /></Campo>
        <Campo label="Conta financeira"><select value={conta} onChange={(e) => setConta(e.target.value)} style={inpFicha}><option value="">— escolher —</option>{contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.banco ? ` · ${c.banco}` : ''}</option>)}</select></Campo>
      </div>
      {erro && <div style={{ fontSize: 12.5, color: TOK.red, marginTop: 8 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={() => void receber()} disabled={salvando} style={{ ...btnGold, flex: 1, justifyContent: 'center', opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Registrando…' : 'Registrar recebimento'}</button>
        <button onClick={onClose} disabled={salvando} style={btnLine}>Cancelar</button>
      </div>
    </ModalFicha>
  )
}

function ModalFicha({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 }} className="sm:items-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl" style={{ background: '#fff', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 -20px 50px rgba(61,35,20,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `0.5px solid ${TOK.line}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TOK.esp }}>{titulo}</div>
          <button onClick={onClose} style={{ color: TOK.mut, background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  )
}
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={{ fontSize: 11, color: TOK.mut, display: 'block', marginBottom: 4 }}>{label}</span>{children}</label>
}
const inpFicha: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `0.5px solid ${TOK.line}`, borderRadius: 8, fontSize: 13, color: TOK.esp, background: '#fff', boxSizing: 'border-box' }

function AbaOdontograma({ companyId, pacienteId }: { companyId: string; pacienteId: string }) {
  const [conds, setConds] = useState<Cond[]>([])
  const [deciduos, setDeciduos] = useState(false)
  useEffect(() => {
    let alive = true
    void (async () => {
      const { data } = await supabase.rpc('fn_odonto_odontograma_estado', { p_company_id: companyId, p_paciente_id: pacienteId })
      if (alive) setConds((data as Cond[]) ?? [])
    })()
    return () => { alive = false }
  }, [companyId, pacienteId])
  const cor = useCallback((dente: string, face: Face): string | null => {
    const c = conds.find((x) => x.dente === dente && (x.face === face || x.face == null))
    return c ? (COND_COR[c.condicao] ?? null) : null
  }, [conds])
  const corDente = useCallback((dente: string): { fill: string | null; ausente: boolean } => {
    const cs = conds.filter((x) => x.dente === dente).map((x) => x.condicao)
    if (cs.includes('ausente')) return { fill: TOK.gray, ausente: true }
    const c = cs.find((cc) => COND_COR[cc]); return { fill: c ? COND_COR[c] : null, ausente: false }
  }, [conds])
  const noop = () => {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 12, color: TOK.mut }}>Visão do estado clínico. Para marcar/editar condições e tratamentos, use a <strong>Clínica</strong>.</div>
        <Link href="/dashboard/odonto/clinica" style={btnLine}>Editar na Clínica</Link>
      </div>
      <Odontograma deciduos={deciduos} onToggleDecidua={setDeciduos} cor={cor} corDente={corDente} selecionados={new Set()} onFace={noop} onNum={noop} onDente={noop} />
    </div>
  )
}

function AbaProntuario({ companyId, pacienteId }: { companyId: string; pacienteId: string }) {
  const [regs, setRegs] = useState<Pront[]>([])
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_odonto_prontuario_paciente', { p_company_id: companyId, p_paciente_id: pacienteId })
    setRegs((data as Pront[]) ?? [])
  }, [companyId, pacienteId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  const registrar = async () => {
    if (!texto.trim()) return
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_odonto_prontuario_salvar', { p_company_id: companyId, p_paciente_id: pacienteId, p_texto: texto.trim(), p_tipo: 'evolucao', p_assinar: true })
    setSalvando(false)
    if (error || (data as { ok?: boolean })?.ok === false) { setMsg('Falha ao registrar.'); return }
    setTexto(''); setMsg('Registro assinado e salvo (imutável).'); setTimeout(() => setMsg(null), 3000); void carregar()
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <CardOdonto style={{ padding: 14 }}>
        <SecTit>Novo registro de evolução</SecTit>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Evolução clínica do atendimento…" rows={3}
          style={{ width: '100%', border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: 10, fontSize: 13, color: TOK.esp, resize: 'vertical' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
          <span style={{ fontSize: 11, color: TOK.mut }}>Ao salvar, o registro é assinado e fica <strong>imutável</strong>.</span>
          <button onClick={() => void registrar()} disabled={salvando || !texto.trim()} style={{ ...btnGold, opacity: (salvando || !texto.trim()) ? 0.6 : 1 }}>{salvando ? 'Salvando…' : 'Registrar'}</button>
        </div>
        {msg && <div style={{ fontSize: 12, color: TOK.green, marginTop: 6, fontWeight: 600 }}>{msg}</div>}
      </CardOdonto>
      {regs.length === 0 ? (
        <EmptyStateOdonto titulo="Sem registros" linha="O histórico clínico aparece aqui conforme os atendimentos." />
      ) : regs.map((r) => (
        <CardOdonto key={r.id} style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: TOK.esp }}>{fmtData(r.data_atendimento)} · {r.tipo}{r.origem === 'scribe_ia' ? ' · IA' : ''}</span>
            <span style={{ fontSize: 11, color: r.assinado ? TOK.green : TOK.mut, fontWeight: 700 }}>{r.assinado ? '✓ assinado' : 'rascunho'}{r.profissional_nome ? ` · ${r.profissional_nome}` : ''}</span>
          </div>
          <div style={{ fontSize: 13, color: TOK.esp, whiteSpace: 'pre-wrap' }}>{r.texto}</div>
        </CardOdonto>
      ))}
    </div>
  )
}

function SecTit({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: TOK.mut, margin: '8px 0 6px' }}>{children}</div>
}
function Linha({ k, v, alerta }: { k: string; v: string | null | undefined; alerta?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontSize: 13 }}>
      <span style={{ color: TOK.mut }}>{k}</span>
      <span style={{ color: alerta ? TOK.red : TOK.esp, fontWeight: alerta ? 700 : 500, textAlign: 'right' }}>{v || '—'}</span>
    </div>
  )
}
const btnGold: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: TOK.gold, color: '#fff', border: 'none', borderRadius: TOK.rCtrl, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'none' }
const btnLine: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: TOK.esp, border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCtrl, padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }

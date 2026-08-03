'use client'

// RD-41 · Odonto — Gestão da Agenda · PR1 (CRUD premium de Cadeiras e Profissionais).
// Reusa o Design System #819 (odonto/ui) + full-width #847. Soft-delete via `ativo` (RD-55).
// Guard no backend (fn_acessos_pode_gerir) — só Owner/Manager gere; erro claro se não pode.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ShellOdonto, PageHeaderOdonto, CardOdonto, EmptyStateOdonto, BrandIcon, TOK } from '@/components/odonto/ui'
import { IndicadoresAgenda } from '@/components/odonto/IndicadoresAgenda'
import { CalendarCog, Plus, Pencil, Archive, ChevronUp, ChevronDown, Armchair, UserRound, ChevronLeft, Settings2, BarChart3 } from 'lucide-react'

const CORES = ['#3D2314', '#C8941A', '#2F6F7E', '#3A5A8C', '#A65A3A', '#6C6480', '#166534', '#A32D2D']
const DIAS = [{ n: 1, l: 'Seg' }, { n: 2, l: 'Ter' }, { n: 3, l: 'Qua' }, { n: 4, l: 'Qui' }, { n: 5, l: 'Sex' }, { n: 6, l: 'Sáb' }, { n: 0, l: 'Dom' }]

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const sel = localStorage.getItem('ps_empresa_sel')
  if (!sel || sel === 'consolidado' || sel.startsWith('group_')) return null
  return sel
}

type Horario = { dias?: number[]; inicio?: string; fim?: string } | null
type Cadeira = { id: string; nome: string; cor: string | null; ordem: number | null; horario: Horario; ativo: boolean }
type Prof = { id: string; nome: string; cro: string | null; especialidade: string | null; cor: string | null; user_id: string | null; comissao_pct: number | null; horario: Horario; avatar_url: string | null; ativo: boolean }
type UserOpt = { user_id: string; email: string | null; nome: string | null }

export default function GestaoAgendaPage() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompanyId(resolveCompanyId())
    const i = setInterval(() => { const a = resolveCompanyId(); setCompanyId((p) => (p === a ? p : a)) }, 800)
    return () => clearInterval(i)
  }, [])

  const [cadeiras, setCadeiras] = useState<Cadeira[]>([])
  const [profs, setProfs] = useState<Prof[]>([])
  const [usuarios, setUsuarios] = useState<UserOpt[]>([])
  const [verInativos, setVerInativos] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [editCadeira, setEditCadeira] = useState<Cadeira | 'novo' | null>(null)
  const [editProf, setEditProf] = useState<Prof | 'novo' | null>(null)
  const [aba, setAba] = useState<'gestao' | 'indicadores'>('gestao')

  const carregar = useCallback(async () => {
    if (!companyId) return
    const [{ data: cad }, { data: pr }, { data: uc }] = await Promise.all([
      supabase.from('erp_odonto_cadeira').select('id,nome,cor,ordem,horario,ativo').eq('company_id', companyId).order('ordem', { ascending: true }).order('nome'),
      supabase.from('erp_odonto_profissional').select('id,nome,cro,especialidade,cor,user_id,comissao_pct,horario,avatar_url,ativo').eq('company_id', companyId).order('nome'),
      supabase.from('user_companies').select('user_id, users(id,email,nome)').eq('company_id', companyId),
    ])
    setCadeiras((cad as Cadeira[]) ?? [])
    setProfs((pr as Prof[]) ?? [])
    const ucRows = (uc as { user_id: string; users: { email: string | null; nome: string | null }[] | null }[] | null) ?? []
    setUsuarios(ucRows.map((r) => ({ user_id: r.user_id, email: r.users?.[0]?.email ?? null, nome: r.users?.[0]?.nome ?? null })))
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3500); return () => clearTimeout(t) }, [msg])

  const flash = (ok: boolean, t: string) => setMsg({ ok, t })

  async function arquivarCadeira(c: Cadeira) {
    if (!companyId || !confirm(`Inativar a cadeira "${c.nome}"? Ela some da agenda mas o histórico fica (reversível).`)) return
    const { data } = await supabase.rpc('fn_odonto_cadeira_arquivar', { p_company_id: companyId, p_id: c.id })
    const r = data as { ok?: boolean; erro?: string }
    if (!r?.ok) { flash(false, r?.erro ?? 'Falha ao inativar'); return }
    flash(true, `Cadeira "${c.nome}" inativada`); void carregar()
  }
  async function toggleCadeiraAtivo(c: Cadeira) {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_odonto_cadeira_salvar', { p_company_id: companyId, p_id: c.id, p_nome: c.nome, p_cor: c.cor, p_ordem: c.ordem, p_horario: c.horario, p_ativo: !c.ativo })
    const r = data as { ok?: boolean; erro?: string }
    if (!r?.ok) { flash(false, r?.erro ?? 'Falha'); return }
    void carregar()
  }
  async function moverCadeira(c: Cadeira, dir: -1 | 1) {
    if (!companyId) return
    const lista = cadeiras.filter((x) => x.ativo || verInativos)
    const idx = lista.findIndex((x) => x.id === c.id)
    const alvo = lista[idx + dir]
    if (!alvo) return
    // troca as ordens (usa o índice quando ordem vem nula)
    const oc = c.ordem ?? idx + 1, oa = alvo.ordem ?? idx + 1 + dir
    await supabase.rpc('fn_odonto_cadeira_salvar', { p_company_id: companyId, p_id: c.id, p_nome: c.nome, p_cor: c.cor, p_ordem: oa, p_horario: c.horario, p_ativo: c.ativo })
    await supabase.rpc('fn_odonto_cadeira_salvar', { p_company_id: companyId, p_id: alvo.id, p_nome: alvo.nome, p_cor: alvo.cor, p_ordem: oc, p_horario: alvo.horario, p_ativo: alvo.ativo })
    void carregar()
  }
  async function arquivarProf(p: Prof) {
    if (!companyId || !confirm(`Inativar "${p.nome}"? Some da agenda mas o histórico fica (reversível).`)) return
    const { data } = await supabase.rpc('fn_odonto_profissional_arquivar', { p_company_id: companyId, p_id: p.id })
    const r = data as { ok?: boolean; erro?: string }
    if (!r?.ok) { flash(false, r?.erro ?? 'Falha ao inativar'); return }
    flash(true, `${p.nome} inativado(a)`); void carregar()
  }

  if (!companyId) return <ShellOdonto><EmptyStateOdonto titulo="Escolha uma clínica" linha="Selecione uma empresa específica no topo do menu para gerir a agenda." /></ShellOdonto>

  const cadeirasVis = cadeiras.filter((c) => c.ativo || verInativos)
  const profsVis = profs.filter((p) => p.ativo || verInativos)

  return (
    <ShellOdonto>
      <button onClick={() => router.push('/dashboard/odonto/agenda')} style={{ background: 'none', border: 'none', color: TOK.mut, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0, marginBottom: 6 }}><ChevronLeft size={16} /> Agenda</button>
      <PageHeaderOdonto
        icon={<BrandIcon><CalendarCog size={20} /></BrandIcon>}
        titulo="Gestão da Agenda"
        subtitulo="Cadeiras e profissionais da clínica — cadastro, cor, horário e ordem."
        acoes={<label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: TOK.mut, cursor: 'pointer' }}><input type="checkbox" checked={verInativos} onChange={(e) => setVerInativos(e.target.checked)} /> Mostrar inativos</label>}
      />

      {msg && <div style={{ margin: '4px 0 12px', padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: msg.ok ? '#E7F3EA' : '#FBEBEB', color: msg.ok ? TOK.green : TOK.red }}>{msg.t}</div>}

      {/* abas: Cadeiras & Profissionais | Indicadores (PR2 · diferencial PS) */}
      <div style={{ display: 'inline-flex', gap: 4, background: TOK.bg, borderRadius: 999, padding: 3, margin: '4px 0 6px' }}>
        {([['gestao', 'Cadeiras & Profissionais', <Settings2 key="g" size={14} />], ['indicadores', 'Indicadores', <BarChart3 key="i" size={14} />]] as const).map(([k, l, ic]) => (
          <button key={k} onClick={() => setAba(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', border: 'none', background: aba === k ? TOK.gold : 'transparent', color: aba === k ? '#fff' : TOK.mut }}>{ic} {l}</button>
        ))}
      </div>

      {aba === 'indicadores' ? <IndicadoresAgenda companyId={companyId} /> : (<>

      {/* CADEIRAS */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 8px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: TOK.esp, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Armchair size={16} color={TOK.gold} /> Cadeiras · {cadeirasVis.length}</div>
        <button onClick={() => setEditCadeira('novo')} style={btnGold}><Plus size={16} /> Nova cadeira</button>
      </div>
      {cadeirasVis.length === 0 ? (
        <EmptyStateOdonto titulo="Nenhuma cadeira" linha="Cadastre a primeira cadeira pra montar a agenda." acao={<button onClick={() => setEditCadeira('novo')} style={btnGold}><Plus size={16} /> Nova cadeira</button>} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {cadeirasVis.map((c, i) => (
            <CardOdonto key={c.id} style={{ opacity: c.ativo ? 1 : 0.55, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: c.cor ?? TOK.gold, flexShrink: 0, border: `1px solid ${TOK.line}` }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: TOK.esp, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nome}</div>
                  <div style={{ fontSize: 11.5, color: TOK.mut }}>{horarioResumo(c.horario)}{c.ativo ? '' : ' · inativa'}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button title="Subir" disabled={i === 0} onClick={() => void moverCadeira(c, -1)} style={{ ...btnIcon, opacity: i === 0 ? 0.3 : 1 }}><ChevronUp size={15} /></button>
                  <button title="Descer" disabled={i === cadeirasVis.length - 1} onClick={() => void moverCadeira(c, 1)} style={{ ...btnIcon, opacity: i === cadeirasVis.length - 1 ? 0.3 : 1 }}><ChevronDown size={15} /></button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button onClick={() => setEditCadeira(c)} style={btnLine}><Pencil size={13} /> Editar</button>
                <button onClick={() => void toggleCadeiraAtivo(c)} style={btnLine}>{c.ativo ? 'Inativar' : 'Reativar'}</button>
                {c.ativo && <button onClick={() => void arquivarCadeira(c)} title="Arquivar (soft-delete)" style={{ ...btnLine, color: TOK.red }}><Archive size={13} /></button>}
              </div>
            </CardOdonto>
          ))}
        </div>
      )}

      {/* PROFISSIONAIS */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 0 8px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: TOK.esp, textTransform: 'uppercase', letterSpacing: 0.6, display: 'inline-flex', alignItems: 'center', gap: 6 }}><UserRound size={16} color={TOK.gold} /> Profissionais · {profsVis.length}</div>
        <button onClick={() => setEditProf('novo')} style={btnGold}><Plus size={16} /> Novo profissional</button>
      </div>
      {profsVis.length === 0 ? (
        <EmptyStateOdonto titulo="Nenhum profissional" linha="Cadastre os dentistas da clínica (CRO, especialidade, cor, comissão)." acao={<button onClick={() => setEditProf('novo')} style={btnGold}><Plus size={16} /> Novo profissional</button>} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {profsVis.map((p) => (
            <CardOdonto key={p.id} style={{ opacity: p.ativo ? 1 : 0.55, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar nome={p.nome} cor={p.cor} url={p.avatar_url} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: TOK.esp, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome}</div>
                  <div style={{ fontSize: 11.5, color: TOK.mut, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[p.especialidade, p.cro].filter(Boolean).join(' · ') || '—'}{p.comissao_pct != null ? ` · ${Number(p.comissao_pct)}% comissão` : ''}{p.user_id ? ' · 🔑 login' : ''}{p.ativo ? '' : ' · inativo'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button onClick={() => setEditProf(p)} style={btnLine}><Pencil size={13} /> Editar</button>
                {p.ativo && <button onClick={() => void arquivarProf(p)} title="Arquivar (soft-delete)" style={{ ...btnLine, color: TOK.red }}><Archive size={13} /> Inativar</button>}
              </div>
            </CardOdonto>
          ))}
        </div>
      )}

      </>)}

      {editCadeira && companyId && <ModalCadeira companyId={companyId} cadeira={editCadeira === 'novo' ? null : editCadeira} onClose={() => setEditCadeira(null)} onSalvo={(t) => { setEditCadeira(null); flash(true, t); void carregar() }} onErro={(t) => flash(false, t)} />}
      {editProf && companyId && <ModalProf companyId={companyId} prof={editProf === 'novo' ? null : editProf} usuarios={usuarios} onClose={() => setEditProf(null)} onSalvo={(t) => { setEditProf(null); flash(true, t); void carregar() }} onErro={(t) => flash(false, t)} />}
    </ShellOdonto>
  )
}

function horarioResumo(h: Horario): string {
  if (!h || (!h.inicio && !h.fim)) return 'Sem horário definido'
  return `${h.inicio ?? '—'}–${h.fim ?? '—'}${h.dias?.length ? ` · ${h.dias.length} dias` : ''}`
}

function Avatar({ nome, cor, url }: { nome: string; cor: string | null; url: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt={nome} style={{ width: 40, height: 40, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
  const ini = nome.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase()
  return <span style={{ width: 40, height: 40, borderRadius: 999, background: cor ?? TOK.gold, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{ini || '?'}</span>
}

function CorPicker({ cor, set }: { cor: string | null; set: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {CORES.map((c) => (
        <button key={c} type="button" onClick={() => set(c)} style={{ width: 26, height: 26, borderRadius: 8, background: c, border: cor === c ? `2px solid ${TOK.esp}` : `1px solid ${TOK.line}`, cursor: 'pointer' }} />
      ))}
    </div>
  )
}

function DiasPicker({ dias, set }: { dias: number[]; set: (d: number[]) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {DIAS.map((d) => {
        const on = dias.includes(d.n)
        return <button key={d.n} type="button" onClick={() => set(on ? dias.filter((x) => x !== d.n) : [...dias, d.n])}
          style={{ minHeight: 34, padding: '5px 10px', borderRadius: 8, border: `1px solid ${on ? TOK.gold : TOK.line}`, background: on ? TOK.gold : '#fff', color: on ? '#fff' : TOK.esp, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{d.l}</button>
      })}
    </div>
  )
}

function ModalCadeira({ companyId, cadeira, onClose, onSalvo, onErro }: { companyId: string; cadeira: Cadeira | null; onClose: () => void; onSalvo: (t: string) => void; onErro: (t: string) => void }) {
  const [nome, setNome] = useState(cadeira?.nome ?? '')
  const [cor, setCor] = useState<string | null>(cadeira?.cor ?? CORES[2])
  const [dias, setDias] = useState<number[]>(cadeira?.horario?.dias ?? [1, 2, 3, 4, 5])
  const [inicio, setInicio] = useState(cadeira?.horario?.inicio ?? '08:00')
  const [fim, setFim] = useState(cadeira?.horario?.fim ?? '18:00')
  const [salvando, setSalvando] = useState(false)
  async function salvar() {
    if (!nome.trim()) { onErro('Informe o nome da cadeira.'); return }
    setSalvando(true)
    const { data } = await supabase.rpc('fn_odonto_cadeira_salvar', { p_company_id: companyId, p_id: cadeira?.id ?? null, p_nome: nome.trim(), p_cor: cor, p_ordem: cadeira?.ordem ?? null, p_horario: { dias, inicio, fim }, p_ativo: cadeira?.ativo ?? true })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string }
    if (!r?.ok) { onErro(r?.erro ?? 'Falha ao salvar'); return }
    onSalvo(cadeira ? `Cadeira "${nome.trim()}" ALTERADA` : `Cadeira "${nome.trim()}" CRIADA`)
  }
  return (
    <Overlay onClose={onClose} titulo={cadeira ? 'Editar cadeira' : 'Nova cadeira'}>
      <Campo l="Nome *"><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Cadeira 1" style={inp} autoFocus /></Campo>
      <Campo l="Cor (identidade na agenda)"><CorPicker cor={cor} set={setCor} /></Campo>
      <Campo l="Dias de funcionamento"><DiasPicker dias={dias} set={setDias} /></Campo>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Campo l="Abre"><input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} style={inp} /></Campo>
        <Campo l="Fecha"><input type="time" value={fim} onChange={(e) => setFim(e.target.value)} style={inp} /></Campo>
      </div>
      <BotaoSalvar salvando={salvando} onClick={salvar} />
    </Overlay>
  )
}

function ModalProf({ companyId, prof, usuarios, onClose, onSalvo, onErro }: { companyId: string; prof: Prof | null; usuarios: UserOpt[]; onClose: () => void; onSalvo: (t: string) => void; onErro: (t: string) => void }) {
  const [nome, setNome] = useState(prof?.nome ?? '')
  const [cro, setCro] = useState(prof?.cro ?? '')
  const [esp, setEsp] = useState(prof?.especialidade ?? '')
  const [cor, setCor] = useState<string | null>(prof?.cor ?? CORES[3])
  const [userId, setUserId] = useState(prof?.user_id ?? '')
  const [comissao, setComissao] = useState(prof?.comissao_pct != null ? String(prof.comissao_pct) : '')
  const [avatar, setAvatar] = useState(prof?.avatar_url ?? '')
  const [dias, setDias] = useState<number[]>(prof?.horario?.dias ?? [1, 2, 3, 4, 5])
  const [inicio, setInicio] = useState(prof?.horario?.inicio ?? '08:00')
  const [fim, setFim] = useState(prof?.horario?.fim ?? '18:00')
  const [salvando, setSalvando] = useState(false)
  async function salvar() {
    if (!nome.trim()) { onErro('Informe o nome do profissional.'); return }
    setSalvando(true)
    const { data } = await supabase.rpc('fn_odonto_profissional_salvar', {
      p_company_id: companyId, p_id: prof?.id ?? null, p_nome: nome.trim(), p_cro: cro || null, p_especialidade: esp || null,
      p_cor: cor, p_user_id: userId || null, p_comissao_pct: comissao.trim() ? Number(comissao.replace(',', '.')) : null,
      p_horario: { dias, inicio, fim }, p_avatar_url: avatar || null, p_ativo: prof?.ativo ?? true,
    })
    setSalvando(false)
    const r = data as { ok?: boolean; erro?: string }
    if (!r?.ok) { onErro(r?.erro ?? 'Falha ao salvar'); return }
    onSalvo(prof ? `${nome.trim()} ALTERADO(A)` : `${nome.trim()} CRIADO(A)`)
  }
  return (
    <Overlay onClose={onClose} titulo={prof ? 'Editar profissional' : 'Novo profissional'}>
      <Campo l="Nome *"><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Dra. Ana Silva" style={inp} autoFocus /></Campo>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Campo l="CRO"><input value={cro} onChange={(e) => setCro(e.target.value)} placeholder="CRO-SC 00000" style={inp} /></Campo>
        <Campo l="Especialidade"><input value={esp} onChange={(e) => setEsp(e.target.value)} placeholder="Ex.: Ortodontia" style={inp} /></Campo>
      </div>
      <Campo l="Cor (identidade na agenda)"><CorPicker cor={cor} set={setCor} /></Campo>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Campo l="Comissão (%)"><input value={comissao} onChange={(e) => setComissao(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder="Ex.: 40" style={inp} /></Campo>
        <Campo l="Vínculo de login (opcional)">
          <select value={userId} onChange={(e) => setUserId(e.target.value)} style={inp}>
            <option value="">— sem vínculo —</option>
            {usuarios.map((u) => <option key={u.user_id} value={u.user_id}>{u.nome || u.email || u.user_id.slice(0, 8)}</option>)}
          </select>
        </Campo>
      </div>
      <Campo l="Foto/avatar (URL, opcional)"><input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://…" style={inp} /></Campo>
      <Campo l="Dias de trabalho"><DiasPicker dias={dias} set={setDias} /></Campo>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Campo l="Entra"><input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} style={inp} /></Campo>
        <Campo l="Sai"><input type="time" value={fim} onChange={(e) => setFim(e.target.value)} style={inp} /></Campo>
      </div>
      <BotaoSalvar salvando={salvando} onClick={salvar} />
    </Overlay>
  )
}

function Overlay({ children, onClose, titulo }: { children: React.ReactNode; onClose: () => void; titulo: string }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 220, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 12, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: TOK.rCard, width: '100%', maxWidth: 480, padding: 18, marginTop: 24, marginBottom: 24, border: `1px solid ${TOK.line}`, boxShadow: '0 20px 50px rgba(61,35,20,0.28)' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: TOK.esp, marginBottom: 12 }}>{titulo}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
      </div>
    </div>
  )
}
function Campo({ l, children }: { l: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: 11, color: TOK.mut, marginBottom: 4, fontWeight: 600 }}>{l}</div>{children}</div>
}
function BotaoSalvar({ salvando, onClick }: { salvando: boolean; onClick: () => void }) {
  return <button onClick={onClick} disabled={salvando} style={{ minHeight: 46, borderRadius: 10, background: salvando ? TOK.line : TOK.gold, color: '#fff', border: 'none', fontSize: 14, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer' }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
}

const inp: React.CSSProperties = { width: '100%', minHeight: 42, padding: '9px 11px', border: `1px solid ${TOK.line}`, borderRadius: 8, fontSize: 14, color: TOK.esp, background: '#fff', outline: 'none', boxSizing: 'border-box' }
const btnGold: React.CSSProperties = { background: TOK.gold, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnLine: React.CSSProperties = { background: '#fff', color: TOK.esp, border: `1px solid ${TOK.line}`, borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }
const btnIcon: React.CSSProperties = { background: '#fff', color: TOK.mut, border: `1px solid ${TOK.line}`, borderRadius: 6, padding: 2, cursor: 'pointer', display: 'inline-flex', lineHeight: 0 }

'use client'
// Onboarding Fase A · wizard "Incluir nova empresa" (5 passos). RD-26: reusa fn_admin_criar_empresa
// (cria company + assinaturas, com CNPJ-dup guard) + fn_acessos_convidar_pessoa (convida master+equipe).
// v1: papel padrão por pessoa (acesso fino área→tela→função é Fase B, tela "Gerenciar acessos" separada).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { Building2, Search, Crown, Users, ClipboardCheck, Check, X, Loader2, Plus, Trash2, ChevronRight, ChevronLeft } from 'lucide-react'

const GO = '#C8941A', BG = '#FAF7F2', BG2 = '#FFFFFF', BD = '#E0D8CC', TX = '#3D2314', TXM = '#6B5D4F', TXD = '#9C8E80', G = '#22C55E', R = '#EF4444'
const inp: CSSProperties = { padding: '8px 12px', borderRadius: 8, border: `1px solid ${BD}`, background: BG, color: TX, fontWeight: 600, width: '100%', boxSizing: 'border-box', fontSize: 13 }
const soDig = (s: string) => (s || '').replace(/\D/g, '')

type Plano = { id: string; nome: string; vertical: string | null; preco_min: number | null; preco_max: number | null; descricao: string | null; description_v15: string | null }
type Grupo = { id: string; nome: string }
type Papel = 'CLIENT_MANAGER' | 'CLIENT_OPERATOR' | 'CLIENT_VIEWER'
type Pessoa = { nome: string; email: string; papel: Papel }
const PAPEL_ROLE: Record<Papel, string> = { CLIENT_MANAGER: 'gerente', CLIENT_OPERATOR: 'operador', CLIENT_VIEWER: 'viewer' }
const PAPEL_LBL: Record<Papel, string> = { CLIENT_MANAGER: 'Gestor', CLIENT_OPERATOR: 'Operador', CLIENT_VIEWER: 'Visualizador' }

// Sugestão leve CNAE → vertical (2 primeiros dígitos da divisão). Só destaca cards; não trava.
function verticalPorCnae(cnae: string): string | null {
  const d = Number(soDig(cnae).slice(0, 2))
  if (!d) return null
  if (d >= 10 && d <= 33) return 'industrial'
  if (d === 45) return 'oficina'
  if (d === 47 || d === 46) return 'commerce'
  return null
}

export default function NovaEmpresaWizard({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(1)
  const [planos, setPlanos] = useState<Plano[]>([])
  const [grupos, setGrupos] = useState<Grupo[]>([])
  // P1 empresa
  const [cnpj, setCnpj] = useState('')
  const [razao, setRazao] = useState('')
  const [fantasia, setFantasia] = useState('')
  const [cidadeUf, setCidadeUf] = useState('')
  const [endereco, setEndereco] = useState('')
  const [cnae, setCnae] = useState('')
  const [ie, setIe] = useState('')
  const [im, setIm] = useState('')
  const [regime, setRegime] = useState('simples')
  const [grupoId, setGrupoId] = useState('')
  const [novoGrupo, setNovoGrupo] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [cnpjMsg, setCnpjMsg] = useState<{ ok: boolean; txt: string } | null>(null)
  // P2 planos
  const [planIds, setPlanIds] = useState<string[]>([])
  // P3 master
  const [master, setMaster] = useState({ nome: '', email: '', telefone: '' })
  // P4 equipe
  const [equipe, setEquipe] = useState<Pessoa[]>([])
  // P5
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ companyId: string; convites: number } | null>(null)

  useEffect(() => {
    if (!open) return
    void (async () => {
      const [{ data: pl }, { data: gr }] = await Promise.all([
        supabase.from('plan_catalog').select('id, nome, vertical, preco_min, preco_max, descricao, description_v15').eq('ativo', true).order('prioridade_comercial', { ascending: true, nullsFirst: false }),
        supabase.from('company_groups').select('id, nome').order('nome'),
      ])
      setPlanos((pl ?? []) as Plano[])
      setGrupos((gr ?? []) as Grupo[])
    })()
  }, [open])

  const cnpjLimpo = soDig(cnpj)
  const vertSugerido = useMemo(() => verticalPorCnae(cnae), [cnae])

  async function buscarCnpj() {
    if (cnpjLimpo.length !== 14) { setCnpjMsg({ ok: false, txt: 'CNPJ precisa ter 14 dígitos.' }); return }
    setBuscando(true); setCnpjMsg(null)
    try {
      // Dup check no nosso banco (RD-54) — antes de consultar a receita.
      const { data: existente } = await supabase.from('companies').select('id, nome_fantasia, razao_social').eq('cnpj', cnpjLimpo).eq('is_active', true).maybeSingle()
      if (existente) { setCnpjMsg({ ok: false, txt: `Já existe uma empresa ativa com este CNPJ: ${existente.nome_fantasia || existente.razao_social}.` }); setBuscando(false); return }
      // BrasilAPI (gratuita, RD-42) — auto-preenche. Roda no navegador do operador.
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`)
      if (r.ok) {
        const j = await r.json()
        setRazao(j.razao_social ?? '')
        setFantasia(j.nome_fantasia ?? '')
        setCidadeUf([j.municipio, j.uf].filter(Boolean).join('/'))
        setCnae(String(j.cnae_fiscal ?? ''))
        setEndereco([j.descricao_tipo_de_logradouro, j.logradouro, j.numero, j.bairro, j.cep].filter(Boolean).join(', '))
        setCnpjMsg({ ok: true, txt: 'CNPJ válido e disponível — dados preenchidos. Confira e ajuste.' })
      } else {
        setCnpjMsg({ ok: true, txt: 'CNPJ disponível. Não achei na Receita — preencha manualmente.' })
      }
    } catch {
      setCnpjMsg({ ok: true, txt: 'CNPJ disponível. Consulta externa indisponível — preencha manualmente.' })
    } finally { setBuscando(false) }
  }

  const togglePlano = (id: string) => setPlanIds((a) => a.includes(id) ? a.filter((x) => x !== id) : [...a, id])
  const addPessoa = () => setEquipe((a) => [...a, { nome: '', email: '', papel: 'CLIENT_OPERATOR' }])
  const setPessoa = (i: number, patch: Partial<Pessoa>) => setEquipe((a) => a.map((p, k) => k === i ? { ...p, ...patch } : p))
  const delPessoa = (i: number) => setEquipe((a) => a.filter((_, k) => k !== i))

  const podeAvancar =
    step === 1 ? (cnpjLimpo.length === 14 && razao.trim().length > 1) :
    step === 2 ? planIds.length > 0 :
    step === 3 ? (master.nome.trim().length > 1 && /.+@.+\..+/.test(master.email)) :
    true

  async function criar() {
    setCriando(true); setErro(null)
    try {
      // Grupo novo (opcional): cria em company_groups; se a RLS bloquear, segue sem grupo.
      let gid: string | null = grupoId || null
      if (!gid && novoGrupo.trim()) {
        const { data: g } = await supabase.from('company_groups').insert({ nome: novoGrupo.trim() }).select('id').maybeSingle()
        gid = g?.id ?? null
      }
      const { data, error } = await supabase.rpc('fn_admin_criar_empresa', {
        p_razao_social: razao.trim(), p_nome_fantasia: fantasia.trim() || null, p_cnpj: cnpjLimpo,
        p_inscricao_estadual: ie.trim() || null, p_inscricao_municipal: im.trim() || null,
        p_cidade_estado: cidadeUf.trim() || null, p_endereco: endereco.trim() || null,
        p_cnae: soDig(cnae) || null, p_regime_tributario: regime || null,
        p_plan_ids: planIds, p_group_id: gid, p_is_matriz: true, p_org_id: null,
      })
      const j = data as { ok?: boolean; erro?: string; company_id?: string; assinaturas?: number } | null
      if (error || !j?.ok || !j.company_id) {
        const m = j?.erro === 'cnpj_ja_existe' ? 'Já existe uma empresa ativa com este CNPJ.'
          : j?.erro === 'sem_permissao' ? 'Só um admin PS pode criar empresa.'
          : (error?.message ?? j?.erro ?? 'Falha ao criar empresa')
        setErro(m); setCriando(false); return
      }
      const companyId = j.company_id
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : null
      let convites = 0
      // Master → CLIENT_OWNER
      const rM = await supabase.rpc('fn_acessos_convidar_pessoa', {
        p_company_id: companyId, p_email: master.email.trim(), p_nome: master.nome.trim(),
        p_areas: null, p_role: 'socio', p_plantas: null, p_horario: null, p_papel_gestao: 'CLIENT_OWNER', p_base_url: baseUrl,
      })
      if (!rM.error) convites++
      // Equipe → papel padrão
      for (const p of equipe) {
        if (!p.email.trim() || !/.+@.+\..+/.test(p.email)) continue
        const rP = await supabase.rpc('fn_acessos_convidar_pessoa', {
          p_company_id: companyId, p_email: p.email.trim(), p_nome: p.nome.trim() || null,
          p_areas: null, p_role: PAPEL_ROLE[p.papel], p_plantas: null, p_horario: null, p_papel_gestao: p.papel, p_base_url: baseUrl,
        })
        if (!rP.error) convites++
      }
      setResultado({ companyId, convites })
      setStep(6)
      onCreated()
    } catch (e) { setErro((e as Error)?.message ?? 'Erro ao criar') } finally { setCriando(false) }
  }

  if (!open) return null

  const STEPS = [
    { n: 1, l: 'Empresa', icon: Building2 },
    { n: 2, l: 'Plano & áreas', icon: ClipboardCheck },
    { n: 3, l: 'Master', icon: Crown },
    { n: 4, l: 'Equipe', icon: Users },
    { n: 5, l: 'Revisão', icon: Check },
  ]

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG2, borderRadius: 16, width: '100%', maxWidth: 720, border: `1px solid ${BD}`, boxShadow: '0 24px 64px rgba(0,0,0,0.25)', margin: '20px 0' }}>
        {/* header + passos */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, color: TX, fontSize: 16, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Building2 size={18} color={GO} /> Incluir nova empresa</div>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', border: 'none', color: TXM, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        {step <= 5 && (
          <div style={{ display: 'flex', gap: 6, padding: '12px 20px 0', flexWrap: 'wrap' }}>
            {STEPS.map((s) => (
              <div key={s.n} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 999, color: step === s.n ? '#fff' : step > s.n ? G : TXD, background: step === s.n ? GO : step > s.n ? '#EAF7EE' : BG }}>
                {step > s.n ? <Check size={12} /> : <s.icon size={12} />} {s.n}. {s.l}
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: 20 }}>
          {/* P1 */}
          {step === 1 && (
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ fontSize: 11.5, color: TXM, fontWeight: 700 }}>CNPJ</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={cnpj} onChange={(e) => setCnpj(soDig(e.target.value).slice(0, 14))} placeholder="00000000000000" style={{ ...inp, maxWidth: 240, fontFamily: 'monospace' }} />
                <button onClick={buscarCnpj} disabled={buscando || cnpjLimpo.length !== 14} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: GO, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: buscando || cnpjLimpo.length !== 14 ? 0.6 : 1 }}>
                  {buscando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Buscar
                </button>
              </div>
              {cnpjMsg && <div style={{ fontSize: 12, color: cnpjMsg.ok ? G : R, fontWeight: 600 }}>{cnpjMsg.txt}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Razão social *</label><input value={razao} onChange={(e) => setRazao(e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Nome fantasia</label><input value={fantasia} onChange={(e) => setFantasia(e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Cidade/UF</label><input value={cidadeUf} onChange={(e) => setCidadeUf(e.target.value)} style={inp} /></div>
                <div><label style={lbl}>CNAE</label><input value={cnae} onChange={(e) => setCnae(e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Regime tributário</label>
                  <select value={regime} onChange={(e) => setRegime(e.target.value)} style={inp}>
                    <option value="simples">Simples Nacional</option><option value="presumido">Lucro Presumido</option><option value="real">Lucro Real</option><option value="mei">MEI</option>
                  </select>
                </div>
                <div><label style={lbl}>Inscrição estadual</label><input value={ie} onChange={(e) => setIe(e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Inscrição municipal</label><input value={im} onChange={(e) => setIm(e.target.value)} style={inp} /></div>
                <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Endereço</label><input value={endereco} onChange={(e) => setEndereco(e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Grupo (multi-CNPJ)</label>
                  <select value={grupoId} onChange={(e) => { setGrupoId(e.target.value); if (e.target.value) setNovoGrupo('') }} style={inp}>
                    <option value="">— sem grupo —</option>
                    {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                  </select>
                </div>
                <div><label style={lbl}>…ou novo grupo</label><input value={novoGrupo} onChange={(e) => { setNovoGrupo(e.target.value); if (e.target.value) setGrupoId('') }} placeholder="Nome do novo grupo" style={inp} /></div>
              </div>
            </div>
          )}

          {/* P2 planos */}
          {step === 2 && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 12.5, color: TXM }}>Escolha o(s) plano(s). As áreas contratadas (teto) saem dos planos.{vertSugerido && <> Sugestão pelo CNAE: <b style={{ color: GO }}>{vertSugerido}</b>.</>}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {planos.map((p) => {
                  const on = planIds.includes(p.id)
                  const sugerido = vertSugerido && p.vertical === vertSugerido
                  return (
                    <button key={p.id} onClick={() => togglePlano(p.id)} style={{ textAlign: 'left', border: `1.5px solid ${on ? GO : BD}`, background: on ? '#FBF4E4' : BG2, borderRadius: 12, padding: 12, cursor: 'pointer', position: 'relative' }}>
                      {sugerido && <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9.5, fontWeight: 800, color: GO, background: '#FBF4E4', border: `1px solid ${GO}`, borderRadius: 999, padding: '1px 6px' }}>sugerido</span>}
                      <div style={{ fontWeight: 800, color: TX, fontSize: 13.5, paddingRight: 54 }}>{p.nome}</div>
                      {p.vertical && <div style={{ fontSize: 11, color: TXD, marginTop: 2 }}>{p.vertical}</div>}
                      <div style={{ fontSize: 11.5, color: TXM, marginTop: 6, lineHeight: 1.35 }}>{p.description_v15 || p.descricao || ''}</div>
                      {(p.preco_min || p.preco_max) && <div style={{ fontSize: 11.5, color: TX, fontWeight: 700, marginTop: 6 }}>R$ {p.preco_min ?? '?'}{p.preco_max && p.preco_max !== p.preco_min ? `–${p.preco_max}` : ''}/mês</div>}
                      {on && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 800, color: GO, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={12} /> selecionado</div>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* P3 master */}
          {step === 3 && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ fontSize: 12.5, color: TXM }}>O <b>Master</b> (dono da conta) será convidado como <b>CLIENT_OWNER</b> — administra a empresa e libera acessos.</div>
              <div><label style={lbl}>Nome *</label><input value={master.nome} onChange={(e) => setMaster({ ...master, nome: e.target.value })} style={inp} /></div>
              <div><label style={lbl}>E-mail *</label><input value={master.email} onChange={(e) => setMaster({ ...master, email: e.target.value })} placeholder="master@empresa.com" style={inp} /></div>
              <div><label style={lbl}>Telefone</label><input value={master.telefone} onChange={(e) => setMaster({ ...master, telefone: e.target.value })} style={{ ...inp, maxWidth: 240 }} /></div>
            </div>
          )}

          {/* P4 equipe */}
          {step === 4 && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 12.5, color: TXM }}>Adicione a equipe (opcional). Só o <b>papel padrão</b> aqui — acesso fino área→tela é na tela "Gerenciar acessos" (Fase B).</div>
              {equipe.map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr auto', gap: 8, alignItems: 'center' }}>
                  <input value={p.nome} onChange={(e) => setPessoa(i, { nome: e.target.value })} placeholder="Nome" style={inp} />
                  <input value={p.email} onChange={(e) => setPessoa(i, { email: e.target.value })} placeholder="email@empresa.com" style={inp} />
                  <select value={p.papel} onChange={(e) => setPessoa(i, { papel: e.target.value as Papel })} style={inp}>
                    <option value="CLIENT_MANAGER">Gestor</option><option value="CLIENT_OPERATOR">Operador</option><option value="CLIENT_VIEWER">Visualizador</option>
                  </select>
                  <button onClick={() => delPessoa(i)} aria-label="Remover" style={{ background: 'transparent', border: 'none', color: R, cursor: 'pointer' }}><Trash2 size={15} /></button>
                </div>
              ))}
              <button onClick={addPessoa} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px dashed ${GO}`, color: GO, background: 'transparent', borderRadius: 8, padding: '7px 12px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}><Plus size={14} /> Adicionar pessoa</button>
            </div>
          )}

          {/* P5 revisão */}
          {step === 5 && (
            <div style={{ display: 'grid', gap: 10, fontSize: 13, color: TX }}>
              <Resumo l="Empresa" v={`${fantasia || razao} · ${cnpjLimpo}`} />
              <Resumo l="Local" v={cidadeUf || '—'} />
              <Resumo l="Planos" v={planIds.map((id) => planos.find((p) => p.id === id)?.nome ?? id).join(', ') || '—'} />
              <Resumo l="Grupo" v={grupoId ? (grupos.find((g) => g.id === grupoId)?.nome ?? '—') : (novoGrupo.trim() ? `${novoGrupo.trim()} (novo)` : '—')} />
              <Resumo l="Master" v={`${master.nome} · ${master.email}`} />
              <Resumo l="Equipe" v={equipe.filter((p) => p.email.trim()).map((p) => `${p.nome || p.email} (${PAPEL_LBL[p.papel]})`).join(', ') || '—'} />
              {erro && <div style={{ background: '#FEF2F2', border: `1px solid ${R}`, color: R, padding: 10, borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}>{erro}</div>}
              <div style={{ fontSize: 11.5, color: TXD }}>Ao criar: cria a empresa (sem duplicar CNPJ), ativa os planos e envia os convites (master + equipe).</div>
            </div>
          )}

          {/* P6 sucesso + checklist */}
          {step === 6 && resultado && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: G, fontWeight: 800, fontSize: 15 }}><Check size={18} /> Empresa criada!</div>
              <div style={{ fontSize: 12.5, color: TXM }}>{resultado.convites} convite(s) enviado(s) (master + equipe). Próximos passos para deixar a empresa pronta:</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                <ChecklistItem txt="Configurar emissor fiscal (certificado/série)" />
                <ChecklistItem txt="Conectar banco (Open Finance / extrato)" />
                <ChecklistItem txt="Importar produtos e clientes" />
              </ul>
              <div style={{ fontSize: 11.5, color: TXD }}>O checklist completo aparece no dashboard da empresa (onboarding).</div>
            </div>
          )}
        </div>

        {/* footer nav */}
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          {step <= 5 ? (
            <>
              <button onClick={() => (step === 1 ? onClose() : setStep(step - 1))} disabled={criando} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${BD}`, background: BG2, color: TX, borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                <ChevronLeft size={14} /> {step === 1 ? 'Cancelar' : 'Voltar'}
              </button>
              {step < 5 ? (
                <button onClick={() => setStep(step + 1)} disabled={!podeAvancar} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: GO, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: podeAvancar ? 1 : 0.5 }}>
                  Avançar <ChevronRight size={14} />
                </button>
              ) : (
                <button onClick={() => void criar()} disabled={criando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: GO, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: criando ? 0.6 : 1 }}>
                  {criando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Criar empresa
                </button>
              )}
            </>
          ) : (
            <button onClick={onClose} style={{ marginLeft: 'auto', background: GO, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Concluir</button>
          )}
        </div>
      </div>
    </div>
  )
}

const lbl: CSSProperties = { display: 'block', fontSize: 11, color: TXM, fontWeight: 700, marginBottom: 3 }
function Resumo({ l, v }: { l: string; v: string }) {
  return <div style={{ display: 'flex', gap: 10 }}><span style={{ minWidth: 84, color: TXD, fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 1 }}>{l}</span><span style={{ color: TX, fontWeight: 600 }}>{v}</span></div>
}
function ChecklistItem({ txt }: { txt: string }) {
  return <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: TX, background: BG, border: `1px solid ${BD}`, borderRadius: 8, padding: '8px 10px' }}><ClipboardCheck size={14} color={GO} /> {txt}</li>
}

'use client'

// Dados da Empresa — cadastral + logomarca. Completa o cabeçalho da OS impressa (logo/endereço).
// LÊ e GRAVA só campos cadastrais via RPC (fn_empresa_obter_dados / fn_empresa_salvar_dados) — NUNCA
// consulta companies direto (a tabela guarda segredos de integração). Logo via fn_empresa_salvar_logo
// (bucket company-assets, público). Prévia usa o MESMO OSHeaderEmpresa da impressão (RD-51). Mobile-first.
// Endereço em campos (Canal PS 4762a526/60675777, OK do CEO 13/10): CEP + Buscar preenche rua, bairro, cidade, UF e IBGE
// (CepEndereco, o mesmo do cadastro de clientes). fn_empresa_salvar_endereco valida (NF-e/NFS-e exigem), grava a UF
// fiscal e monta os textos endereco/cidade_estado que o cabeçalho da OS, a remessa e a NFS-e já leem.
import { useCallback, useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import OSHeaderEmpresa, { type EmpresaHeader } from '@/components/os/OSHeaderEmpresa'
import CepEndereco, { type EnderecoValue } from '@/components/comum/CepEndereco'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'

type Dados = {
  id: string; razao_social: string | null; nome_fantasia: string | null; cnpj: string | null
  inscricao_estadual: string | null; inscricao_municipal: string | null; cidade_estado: string | null
  endereco: string | null; cnae: string | null; regime_tributario: string | null; logo_url: string | null
  pais?: string | null; uf_fiscal?: string | null; cep?: string | null; logradouro?: string | null; numero?: string | null
  complemento?: string | null; bairro?: string | null; cidade?: string | null; codigo_ibge_municipio?: string | null
}
type Form = { razao_social: string; nome_fantasia: string; cnpj: string; inscricao_estadual: string; inscricao_municipal: string; cidade_estado: string; endereco: string; cnae: string; regime_tributario: string }
const FORM_VAZIO: Form = { razao_social: '', nome_fantasia: '', cnpj: '', inscricao_estadual: '', inscricao_municipal: '', cidade_estado: '', endereco: '', cnae: '', regime_tributario: '' }
const END_VAZIO: EnderecoValue = { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', codigo_ibge_municipio: '' }

function maskCEP(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}
// Mesmos textos que fn_empresa_salvar_endereco monta (prévia do cabeçalho da OS = o que vai ser gravado)
function montarEndereco(e: EnderecoValue): string {
  const cep = e.cep.replace(/\D/g, '')
  const rua = e.logradouro.trim() ? e.logradouro.trim() + (e.numero.trim() ? `, ${e.numero.trim()}` : '') + (e.complemento?.trim() ? ` - ${e.complemento.trim()}` : '') : ''
  return [rua, e.bairro.trim(), cep.length === 8 ? `CEP ${maskCEP(cep)}` : ''].filter(Boolean).join(', ')
}
// campos que a NF-e/NFS-e exigem do emitente brasileiro (a função do banco confere de novo)
function faltandoEndereco(e: EnderecoValue): string[] {
  const f: string[] = []
  if (e.cep.replace(/\D/g, '').length !== 8) f.push('CEP')
  if (!e.logradouro.trim()) f.push('logradouro')
  if (!e.numero.trim()) f.push('número (ou S/N)')
  if (!e.bairro.trim()) f.push('bairro')
  if (!e.cidade.trim()) f.push('cidade')
  if (e.uf.trim().length !== 2) f.push('UF')
  if (e.codigo_ibge_municipio.replace(/\D/g, '').length !== 7) f.push('código IBGE (use Buscar)')
  return f
}

const REGIMES = [
  { v: '', l: '— selecionar —' }, { v: 'simples_nacional', l: 'Simples Nacional' },
  { v: 'lucro_presumido', l: 'Lucro Presumido' }, { v: 'lucro_real', l: 'Lucro Real' }, { v: 'mei', l: 'MEI' },
]

function maskCNPJ(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export default function ConfigEmpresaPage() {
  const { companyIds, sel: selGlobal } = useCompanyIds()
  const [comps, setComps] = useState<Dados[]>([])
  const [sel, setSel] = useState<string>('')
  const [form, setForm] = useState<Form>(FORM_VAZIO)
  const [busy, setBusy] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')
  const [ieIsento, setIeIsento] = useState(false)
  const [end, setEnd] = useState<EnderecoValue>(END_VAZIO)

  const carregar = useCallback(async () => {
    if (!companyIds?.length) return
    const results = await Promise.all(companyIds.map((id) => supabase.rpc('fn_empresa_obter_dados', { p_company_id: id })))
    const list = results.map((r) => r.data as (Dados & { sucesso?: boolean }) | null).filter((d): d is Dados & { sucesso: boolean } => !!d && d.sucesso === true)
    setComps(list)
  }, [companyIds])

  useEffect(() => { void carregar() }, [carregar])

  // FIX-LOGO-SELETOR · a empresa editada é SEMPRE a do seletor global (ps_empresa_sel).
  // Sem isso o form abria na 1ª empresa da lista e ignorava o topo — dava pra ver/subir logo na
  // empresa errada. Consolidado/grupo (empresa do topo não está na lista): usa o dropdown interno.
  useEffect(() => {
    if (!comps.length) return
    const doTopo = comps.some((c) => c.id === selGlobal) ? selGlobal : null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSel((s) => doTopo ?? (comps.some((c) => c.id === s) ? s : comps[0].id))
  }, [comps, selGlobal])

  // popula o form quando muda a empresa selecionada / recarrega
  useEffect(() => {
    const d = comps.find((c) => c.id === sel)
    if (!d) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      razao_social: d.razao_social ?? '', nome_fantasia: d.nome_fantasia ?? '', cnpj: maskCNPJ(d.cnpj ?? ''),
      inscricao_estadual: d.inscricao_estadual ?? '', inscricao_municipal: d.inscricao_municipal ?? '',
      cidade_estado: (d.cidade_estado ?? '').trim(), endereco: d.endereco ?? '', cnae: d.cnae ?? '',
      regime_tributario: d.regime_tributario ?? '',
    })
    setEnd({
      cep: maskCEP(d.cep ?? ''), logradouro: d.logradouro ?? '', numero: d.numero ?? '', complemento: d.complemento ?? '',
      bairro: d.bairro ?? '', cidade: d.cidade ?? '', uf: d.uf_fiscal ?? '', codigo_ibge_municipio: d.codigo_ibge_municipio ?? '',
    })
  }, [sel, comps])

  // flag de isenção (chamado #776): vem por RPC própria — a tela não lê companies direto
  useEffect(() => {
    if (!sel) return
    let vivo = true
    void Promise.resolve(supabase.rpc('fn_empresa_obter_ie_isento', { p_company_id: sel })).then(({ data }) => { if (vivo) setIeIsento(data === true) })
    return () => { vivo = false }
  }, [sel, comps])

  const emp = comps.find((c) => c.id === sel) ?? null
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const brasileira = (emp?.pais ?? 'Brasil') === 'Brasil'
  // com endereço em campos, os textos do cabeçalho saem dos campos; sem nenhum campo, fica o texto antigo
  const temCampos = !!(end.logradouro.trim() || end.cidade.trim())
  const enderecoTxt = temCampos ? montarEndereco(end) : form.endereco
  const cidadeUfTxt = temCampos && end.cidade.trim() ? (end.uf.trim() ? `${end.cidade.trim()}/${end.uf.trim().toUpperCase()}` : end.cidade.trim()) : form.cidade_estado
  const faltando = brasileira ? faltandoEndereco(end) : []

  // prévia do cabeçalho: LIVE dos campos do form + logo atual
  const header: EmpresaHeader = {
    nome: form.nome_fantasia || form.razao_social, razao_social: form.razao_social, cnpj: form.cnpj,
    ie: ieIsento ? 'Isento' : form.inscricao_estadual, im: form.inscricao_municipal, endereco: enderecoTxt, cidade_estado: cidadeUfTxt, logo: emp?.logo_url,
  }

  async function salvar() {
    if (!sel) return
    if (!form.razao_social.trim()) { setMsg('Erro: Razão social é obrigatória.'); return }
    if (faltando.length) { setMsg('Erro: a NF-e e a NFS-e exigem o endereço completo. Falta: ' + faltando.join(', ') + '.'); return }
    setSalvando(true); setMsg('')
    const { data, error } = await supabase.rpc('fn_empresa_salvar_dados', {
      p_company_id: sel, p_razao_social: form.razao_social, p_nome_fantasia: form.nome_fantasia, p_cnpj: form.cnpj,
      p_inscricao_estadual: ieIsento ? '' : form.inscricao_estadual, p_inscricao_municipal: form.inscricao_municipal,
      p_cidade_estado: cidadeUfTxt, p_endereco: enderecoTxt, p_cnae: form.cnae, p_regime_tributario: form.regime_tributario,
    })
    if (error) { setSalvando(false); setMsg('Erro: ' + error.message); return }
    const j = data as { sucesso?: boolean; erro?: string; mensagem?: string } | null
    if (!j?.sucesso) { setSalvando(false); setMsg('Erro: ' + (j?.erro === 'sem_acesso' ? 'Você não tem permissão para editar esta empresa.' : (j?.mensagem ?? j?.erro ?? 'não salvou'))); return }
    const re = await supabase.rpc('fn_empresa_salvar_endereco', {
      p_company_id: sel, p_cep: end.cep, p_logradouro: end.logradouro, p_numero: end.numero, p_complemento: end.complemento ?? '',
      p_bairro: end.bairro, p_cidade: end.cidade, p_uf: end.uf, p_codigo_ibge: end.codigo_ibge_municipio,
    })
    const je = re.data as { sucesso?: boolean; mensagem?: string; erro?: string } | null
    if (re.error || je?.sucesso !== true) { setSalvando(false); setMsg('Erro: ' + (re.error?.message ?? je?.mensagem ?? je?.erro ?? 'não salvou o endereço')); return }
    const r = await supabase.rpc('fn_empresa_salvar_ie_isento', { p_company_id: sel, p_ie_isento: ieIsento })
    setSalvando(false)
    if (r.error || (r.data as { sucesso?: boolean } | null)?.sucesso !== true) { setMsg('Erro: não consegui salvar a isenção de inscrição estadual.'); return }
    setMsg('✅ Dados da empresa salvos.'); void carregar()
  }

  async function enviarLogo(file: File) {
    if (!sel) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) { setMsg('Erro: envie PNG, JPG, WEBP ou SVG.'); return }
    if (file.size > 2 * 1024 * 1024) { setMsg('Erro: imagem acima de 2MB. Envie uma menor.'); return }
    setBusy(true); setMsg('')
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
      // Caminho: {company_id}/logo.{ext} — a policy company_assets_write exige foldername[1]=company_id;
      // nome estável (substitui, não acumula versão). upsert:true troca o arquivo no lugar.
      const path = `${sel}/logo.${ext}`
      const up = await supabase.storage.from('company-assets').upload(path, file, { upsert: true, contentType: file.type })
      if (up.error) throw up.error
      const pub = supabase.storage.from('company-assets').getPublicUrl(path)
      const { data, error } = await supabase.rpc('fn_empresa_salvar_logo', { p_company_id: sel, p_logo_url: pub.data.publicUrl })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string } | null
      if (!j?.sucesso) { setMsg('Erro: ' + (j?.erro ?? 'não salvou')); return }
      setMsg('✅ Logo atualizado.'); void carregar()
    } catch (e) { setMsg('Erro ao enviar: ' + (e as Error).message) } finally { setBusy(false) }
  }

  async function removerLogo() {
    if (!sel || !confirm('Remover a logomarca desta empresa?')) return
    setBusy(true); setMsg('')
    const { error } = await supabase.rpc('fn_empresa_salvar_logo', { p_company_id: sel, p_logo_url: '' })
    setBusy(false)
    if (error) { setMsg('Erro: ' + error.message); return }
    setMsg('Logomarca removida.'); void carregar()
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Configurações</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 10px' }}>Dados da Empresa</h1>

        {/* Deixa explícito QUAL empresa está sendo editada (segue o seletor do topo) */}
        {emp && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: ESP, background: '#FFF8E7', border: `0.5px solid ${GOLD}`, borderRadius: 999, padding: '4px 12px', marginBottom: 12 }}>
            <span style={{ color: MUT }}>Editando:</span>
            <strong style={{ fontWeight: 700 }}>{emp.nome_fantasia || emp.razao_social || '—'}</strong>
            {emp.cnpj && <span style={{ color: MUT }}>· {maskCNPJ(emp.cnpj)}</span>}
          </div>
        )}

        {comps.length > 1 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ ...inp, maxWidth: 340, display: 'block' }}>
              {comps.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</option>)}
            </select>
            <AjudaCampo chave="empresa.dados.empresa" />
          </label>
        )}
        {msg && <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 12, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

        {/* Cadastro */}
        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 12 }}>Cadastro</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Campo label={<>Razão social *<AjudaCampo chave="empresa.dados.razao_social" /></>} span><input value={form.razao_social} onChange={(e) => set('razao_social', e.target.value)} style={inp} /></Campo>
            <Campo label={<>Nome fantasia<AjudaCampo chave="empresa.dados.nome_fantasia" /></>}><input value={form.nome_fantasia} onChange={(e) => set('nome_fantasia', e.target.value)} style={inp} /></Campo>
            <Campo label={<>CNPJ<AjudaCampo chave="empresa.dados.cnpj" /></>}><input value={form.cnpj} onChange={(e) => set('cnpj', maskCNPJ(e.target.value))} inputMode="numeric" placeholder="00.000.000/0000-00" style={inp} /></Campo>
            <Campo label={<>Inscrição estadual<AjudaCampo chave="empresa.dados.ie" /></>}>
              <input value={ieIsento ? '' : form.inscricao_estadual} onChange={(e) => set('inscricao_estadual', e.target.value)} disabled={ieIsento} placeholder={ieIsento ? 'Isento' : ''} style={{ ...inp, ...(ieIsento ? { background: '#EEE9E0', color: MUT, cursor: 'not-allowed' } : {}) }} />
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12.5, color: ESP }}>
                <input type="checkbox" checked={ieIsento} onChange={(e) => setIeIsento(e.target.checked)} style={{ width: 16, height: 16 }} />
                Isento de inscrição estadual<AjudaCampo chave="empresa.dados.ie_isento" />
              </span>
            </Campo>
            <Campo label={<>Inscrição municipal<AjudaCampo chave="empresa.dados.im" /></>}><input value={form.inscricao_municipal} onChange={(e) => set('inscricao_municipal', e.target.value)} style={inp} /></Campo>
            <Campo label={<>CNAE<AjudaCampo chave="empresa.dados.cnae" /></>}><input value={form.cnae} onChange={(e) => set('cnae', e.target.value)} placeholder="0000-0/00" style={inp} /></Campo>
            <Campo label={<>Regime tributário<AjudaCampo chave="empresa.dados.regime" /></>}>
              <select value={form.regime_tributario} onChange={(e) => set('regime_tributario', e.target.value)} style={inp}>
                {REGIMES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </Campo>
          </div>
          {/* Endereço em campos — a NF-e/NFS-e exige do emitente; o texto do cabeçalho da OS é montado daqui */}
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, margin: '18px 0 10px' }}>
            Endereço {brasileira ? '(sai na nota fiscal e no cabeçalho da OS)' : '(empresa no exterior)'}
          </div>
          {!temCampos && form.endereco.trim() && (
            <div style={{ fontSize: 11.5, color: ESP, background: '#FFF8E7', border: `0.5px solid ${GOLD}`, borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
              Endereço anterior (texto livre): <strong>{form.endereco}</strong>{form.cidade_estado ? ` · ${form.cidade_estado}` : ''}. Preencha os campos abaixo.
            </div>
          )}
          <div data-testid="empresa-endereco">
            <CepEndereco value={end} onChange={(p) => setEnd((e) => ({ ...e, ...p, ...(p.cep !== undefined ? { cep: maskCEP(p.cep) } : {}) }))} ibgeObrigatorio={brasileira} ajuda="empresa.dados" />
          </div>
          {brasileira && faltando.length > 0 && (
            <div data-testid="empresa-endereco-falta" style={{ fontSize: 11.5, color: VERM, marginTop: 8 }}>
              Para emitir nota, complete: {faltando.join(', ')}.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button data-testid="empresa-salvar" onClick={() => void salvar()} disabled={salvando || !emp} style={{ ...btnPrim, background: GOLD, color: ESP, opacity: (salvando || !emp) ? 0.6 : 1, cursor: salvando ? 'wait' : 'pointer' }}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>

        {/* Logomarca */}
        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 10 }}>Logomarca</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ ...btnPrim, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
              <AjudaCampo chave="empresa.dados.logo" />
              {busy ? 'Enviando…' : emp?.logo_url ? 'Trocar logo' : 'Enviar logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }} disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarLogo(f) }} />
            </label>
            {emp?.logo_url && <button onClick={removerLogo} disabled={busy} style={btnGhost}>Remover</button>}
          </div>
          <div style={{ fontSize: 10.5, color: MUT, marginTop: 8 }}>PNG, JPG, WEBP ou SVG, até 2MB. A logo aparece nos orçamentos, nas ordens de serviço e no topo do sistema.</div>
          {/* BRAND-1 · aviso útil (não é erro): sem badge vermelho, sem bloqueio */}
          {emp && !emp.logo_url && (
            <div style={{ fontSize: 11.5, color: ESP, background: '#FFF8E7', border: `0.5px solid ${GOLD}`, borderRadius: 8, padding: '8px 10px', marginTop: 10 }}>
              Sua empresa ainda não tem logo. Ele aparece nos orçamentos, nas ordens de serviço e no topo do sistema.
            </div>
          )}
        </div>

        {/* Prévia */}
        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700, marginBottom: 10 }}>Prévia do cabeçalho (como sai na OS)</div>
          {emp ? <OSHeaderEmpresa empresa={header} /> : <div style={{ color: MUT, fontSize: 13 }}>Selecione uma empresa.</div>}
          {emp && !enderecoTxt.trim() && <div style={{ fontSize: 11, color: MUT, marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}><Info size={12} aria-hidden /> Sem endereço, a linha de endereço não aparece na OS. Preencha acima e salve.</div>}
        </div>
      </div>
    </div>
  )
}

function Campo({ label, span, children }: { label: React.ReactNode; span?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', ...(span ? { gridColumn: '1 / -1' } : {}) }}>
      <span style={{ fontSize: 11, color: MUT, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}
const inp: React.CSSProperties = { width: '100%', fontSize: 13, padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', color: ESP, boxSizing: 'border-box', fontFamily: 'inherit' }
const btnPrim: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#FFF', background: ESP, border: 'none', borderRadius: 9, padding: '9px 18px', display: 'inline-block' }
const btnGhost: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: ESP, background: '#FFF', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }

'use client'
// Administração › Vendedores (CEO 29/10/2026): liga cada usuário do PS Gestão ao código de vendedor/supervisor/gerente
// do ERP de origem. Esse vínculo define o que a pessoa vê no Meu painel de vendas (trava no banco, fn_bi_comercial_painel).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', ok: '#1a8f63', bad: '#C0392B', bg2: '#F0ECE3' }
const ROTA = '/dashboard/admin/vendedores'
// Códigos de retorno da RPC fn_com_vendedor_acesso_salvar → frase do usuário (nunca mostrar o código cru).
const ERRO_SALVAR: Record<string, string> = {
  codigo_inexistente: 'Esse código de vendedor não está mais na equipe que vem do ERP de origem.',
  usuario_fora_da_empresa: 'Esse usuário não faz parte desta empresa. Convide-o em Administração › Acessos antes de ligar.',
}
type Membro = { codigo: string; nome: string; cargo: string; superior: string | null; user_id: string | null; ativo: boolean | null; usuario: string | null; email: string | null }
type Usuario = { user_id: string; nome: string; email: string; papel: string }

export default function VendedoresAcesso() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [equipe, setEquipe] = useState<Membro[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [escolha, setEscolha] = useState<Record<string, string>>({})
  // Cadastro direto (usuário → código do ERP de origem): o jeito mais curto de liberar um vendedor.
  const [novoUser, setNovoUser] = useState('')
  const [novoCod, setNovoCod] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const { data, error } = await supabase.rpc('fn_com_vendedor_acesso_listar', { p_company_id: empresa })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar os vendedores. Tente de novo.')); return }
    setErro(null)
    const d = data as { equipe: Membro[]; usuarios: Usuario[] }
    setEquipe(d.equipe ?? []); setUsuarios(d.usuarios ?? [])
    setEscolha(Object.fromEntries((d.equipe ?? []).map((m) => [m.codigo, m.ativo && m.user_id ? m.user_id : ''])))
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  // Gerente/diretor são LÍDERES (fn_bi_comercial_scope os coloca em modo 'lider' — veem a equipe toda); NÃO recebem
  // a função restritiva "Vendedor Comercial" aqui. Vendedor/supervisor recebem (passam a ver só painel/app deles).
  const ehLider = (cargo: string | null) => /^\s*(gerente|diretor)/i.test(cargo || '')

  async function salvar(m: Membro, userEscolhido?: string) {
    const user = (userEscolhido ?? escolha[m.codigo]) || null
    const { data, error } = await supabase.rpc('fn_com_vendedor_acesso_salvar', { p_company_id: empresa, p_codigo: m.codigo, p_user_id: user })
    const r = data as { ok: boolean; erro?: string; acao?: string } | null
    if (error || !r?.ok) {
      const motivo = r?.erro ? (ERRO_SALVAR[r.erro] ?? 'Não foi possível concluir. Confira os dados e tente de novo.') : ''
      setMsg(error ? `Não salvou: ${erroAmigavel(error)}` : `Não salvou: ${motivo}`)
      void carregar(); return
    }
    // Ao LIGAR um vendedor/supervisor, aplica a função "Vendedor Comercial" (industria_comercial): ela restringe o
    // menu dele ao Meu painel de vendas + App de vendas (rbac_papel_modulo). Sem função, o RD-97 libera tudo — não é o
    // que queremos para o vendedor. O dado continua isolado pelo código (com_vendedor_acesso / fn_bi_comercial_scope).
    let aviso = ''
    if (user && r.acao === 'vinculado' && !ehLider(m.cargo)) {
      const { data: pr, error: pe } = await supabase.rpc('fn_acessos_definir_papel_rbac', { p_company_id: empresa, p_user_id: user, p_papel_slug: 'industria_comercial' })
      const prr = pr as { ok: boolean; erro?: string } | null
      if (pe || !prr?.ok) aviso = ` Atenção: liberei o acesso, mas não consegui aplicar a função Vendedor Comercial (${pe ? erroAmigavel(pe) : prr?.erro}). Aplique em Administração › Acessos.`
    }
    setMsg(`${m.nome}: ${r.acao === 'vinculado' ? `acesso liberado${!ehLider(m.cargo) ? ' (função Vendedor Comercial aplicada)' : ' (líder — vê a equipe)'}` : 'acesso retirado'}.${aviso}`)
    void carregar()
  }

  const ligados = equipe.filter((m) => m.ativo && m.user_id).length
  const porCodigo = new Map(equipe.map((m) => [m.codigo, m]))
  const rotuloSuperior = (cod: string | null) => {
    if (!cod) return '—'
    const s = porCodigo.get(cod)
    return s ? `${cod} · ${s.cargo}` : cod
  }
  // Quantas pessoas ficam debaixo do código (o vínculo prende a subárvore: supervisor/gerente veem a equipe deles).
  const tamanhoEquipe = (cod: string): number => {
    const vistos = new Set<string>([cod]); let fila = [cod]
    while (fila.length) { const prox = equipe.filter((e) => e.superior && fila.includes(e.superior) && !vistos.has(e.codigo)).map((e) => e.codigo); prox.forEach((c) => vistos.add(c)); fila = prox }
    return vistos.size - 1
  }
  const ORDEM_CARGO = ['Gerente', 'Supervisor', 'Vendedor']
  const cargos = [...new Set(equipe.map((m) => m.cargo || 'Outros'))].sort((a, b) => (ORDEM_CARGO.indexOf(a) + 1 || 99) - (ORDEM_CARGO.indexOf(b) + 1 || 99) || a.localeCompare(b, 'pt-BR'))
  const selCod = novoCod ? porCodigo.get(novoCod) : undefined
  const atualDoUser = novoUser ? equipe.find((m) => m.ativo && m.user_id === novoUser) : undefined
  async function cadastrar() {
    if (!selCod || !novoUser) return
    setSalvando(true)
    await salvar(selCod, novoUser)
    setSalvando(false); setNovoUser(''); setNovoCod('')
  }
  return (
    <div style={{ background: C.off, minHeight: '100%', color: C.esp, padding: 'clamp(12px, 3vw, 24px)' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 14 }}>
        <div>
          <a href="/dashboard/admin" style={{ fontSize: 12, color: C.gold, textDecoration: 'none' }}>← Administração</a>
          <h1 style={{ margin: '4px 0 2px', fontSize: 24, fontFamily: 'Georgia, serif', fontWeight: 400 }}>Vendedores e o Meu painel de vendas</h1>
          <p style={{ margin: 0, fontSize: 13, color: C.m, maxWidth: '70ch' }}>
            A equipe abaixo vem do ERP de origem. Escolha o usuário de cada pessoa: o vendedor passa a ver só a própria venda; o supervisor e o gerente veem a equipe deles. Quem ainda não tem usuário é convidado em Administração › Acessos.
          </p>
        </div>
        {!empresa && <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 14 }}>Escolha uma empresa no topo.</div>}
        {erro && <div role="alert" style={{ color: C.bad }}>{erro}</div>}
        {msg && <div role="status" style={{ fontSize: 13, color: msg.startsWith('Não salvou') ? C.bad : C.ok }}>{msg}</div>}
        {empresa && !erro && equipe.length > 0 && (
          <div data-testid="novo-vinculo" style={{ background: '#fff', border: `1px solid ${C.gold}`, borderRadius: 14, padding: 16, display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Cadastrar vendedor</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.m }}>1. Usuário do PS Gestão</span>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <select data-testid="novo-usuario" aria-label="Usuário do PS Gestão" value={novoUser} onChange={(e) => setNovoUser(e.target.value)}
                    style={{ font: 'inherit', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.bd}`, minWidth: 240, maxWidth: 320 }}>
                    <option value="">Escolha o usuário…</option>
                    {usuarios.map((u) => <option key={u.user_id} value={u.user_id}>{u.nome}{u.email && u.email !== u.nome ? ` (${u.email})` : ''}</option>)}
                  </select>
                  <AjudaCampo chave="com.vendedores.novo_usuario" rota={ROTA} />
                </div>
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.m }}>2. Código no ERP de origem</span>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <select data-testid="novo-codigo" aria-label="Código no ERP de origem" value={novoCod} onChange={(e) => setNovoCod(e.target.value)}
                    style={{ font: 'inherit', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.bd}`, minWidth: 260, maxWidth: 360, fontVariantNumeric: 'tabular-nums' }}>
                    <option value="">Escolha o código…</option>
                    {cargos.map((cg) => (
                      <optgroup key={cg} label={cg}>
                        {equipe.filter((m) => (m.cargo || 'Outros') === cg).map((m) => (
                          <option key={m.codigo} value={m.codigo}>
                            {m.codigo}{m.nome && !m.nome.endsWith(m.codigo) ? ` · ${m.nome}` : ''} · superior {rotuloSuperior(m.superior)}{m.ativo && m.usuario ? ` · hoje: ${m.usuario}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <AjudaCampo chave="com.vendedores.novo_codigo" rota={ROTA} />
                </div>
              </div>
              <button type="button" data-testid="novo-vinculo-salvar" disabled={!novoUser || !novoCod || salvando} onClick={() => void cadastrar()}
                style={{ font: 'inherit', fontWeight: 700, padding: '9px 18px', borderRadius: 8, border: 0, background: C.gold, color: '#fff', cursor: !novoUser || !novoCod || salvando ? 'default' : 'pointer', opacity: !novoUser || !novoCod || salvando ? 0.45 : 1 }}>
                {salvando ? 'Liberando…' : 'Liberar acesso'}
              </button>
            </div>
            {selCod && (
              <div style={{ fontSize: 12.5, color: C.m, lineHeight: 1.55, background: C.off, borderRadius: 10, padding: '10px 12px' }}>
                <strong style={{ color: C.esp }}>{selCod.codigo}</strong> · {selCod.cargo} · superior {rotuloSuperior(selCod.superior)}.{' '}
                {ehLider(selCod.cargo)
                  ? 'Líder: vê a venda da empresa toda no Meu painel.'
                  : tamanhoEquipe(selCod.codigo) > 0
                    ? `Vê a própria carteira e a da equipe abaixo dele (${tamanhoEquipe(selCod.codigo)} pessoa(s)). Recebe a função Vendedor Comercial.`
                    : 'Vê só a própria carteira. Recebe a função Vendedor Comercial (menu só com o painel e o app de vendas).'}
                {selCod.ativo && selCod.usuario && <div style={{ color: C.bad }}>Hoje este código está com {selCod.usuario}: ao liberar, passa para o usuário escolhido.</div>}
                {atualDoUser && atualDoUser.codigo !== selCod.codigo && <div style={{ color: C.bad }}>Este usuário hoje está no código {atualDoUser.codigo}: cada usuário fica com um código só, então ele sai do {atualDoUser.codigo}.</div>}
              </div>
            )}
          </div>
        )}
        {empresa && !erro && (
          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 14, overflowX: 'auto' }}>
            <div style={{ fontSize: 13, color: C.m, marginBottom: 8, display: 'inline-flex', alignItems: 'center' }}>{ligados} de {equipe.length} pessoas com acesso liberado<AjudaCampo chave="com.vendedores.acesso" rota={ROTA} /></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ color: C.m, textAlign: 'left' }}><th style={{ padding: 6 }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>Código<AjudaCampo chave="com.vendedores.col_codigo" rota={ROTA} /></span></th><th style={{ padding: 6 }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>Nome no ERP<AjudaCampo chave="com.vendedores.col_nome" rota={ROTA} /></span></th><th style={{ padding: 6 }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>Cargo<AjudaCampo chave="com.vendedores.col_cargo" rota={ROTA} /></span></th><th style={{ padding: 6 }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>Superior<AjudaCampo chave="com.vendedores.col_superior" rota={ROTA} /></span></th><th style={{ padding: 6 }}>Usuário do PS Gestão<AjudaCampo chave="com.vendedores.vinculo" rota={ROTA} /></th><th style={{ padding: 6 }}>Ação<AjudaCampo chave="com.vendedores.salvar" rota={ROTA} /></th></tr></thead>
              <tbody>
                {equipe.map((m) => (
                  <tr key={m.codigo} style={{ borderTop: `1px solid ${C.bg2}` }}>
                    <td style={{ padding: 6, fontVariantNumeric: 'tabular-nums' }}>{m.codigo}</td>
                    <td style={{ padding: 6 }}>{m.nome}</td>
                    <td style={{ padding: 6 }}>
                      {m.cargo}
                      {m.ativo && m.user_id && !ehLider(m.cargo) && (
                        <div style={{ fontSize: 11, color: C.m, marginTop: 2 }}>Função: <strong style={{ color: C.gold }}>Vendedor Comercial</strong> (vê só painel/app)</div>
                      )}
                      {m.ativo && m.user_id && ehLider(m.cargo) && (
                        <div style={{ fontSize: 11, color: C.m, marginTop: 2 }}>Líder — vê a equipe</div>
                      )}
                    </td>
                    <td style={{ padding: 6, fontVariantNumeric: 'tabular-nums', color: C.m }}>{rotuloSuperior(m.superior)}</td>
                    <td style={{ padding: 6 }}>
                      <select aria-label={`Usuário de ${m.nome}`} value={escolha[m.codigo] ?? ''} onChange={(e) => setEscolha({ ...escolha, [m.codigo]: e.target.value })}
                        style={{ font: 'inherit', padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.bd}`, maxWidth: 260 }}>
                        <option value="">— sem acesso —</option>
                        {usuarios.map((u) => <option key={u.user_id} value={u.user_id}>{u.nome}{u.email && u.email !== u.nome ? ` (${u.email})` : ''}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 6 }}>
                      <button type="button" onClick={() => void salvar(m)} disabled={(escolha[m.codigo] ?? '') === ((m.ativo && m.user_id) || '')}
                        style={{ font: 'inherit', padding: '6px 12px', borderRadius: 8, border: 0, background: C.gold, color: C.esp, cursor: 'pointer', opacity: (escolha[m.codigo] ?? '') === ((m.ativo && m.user_id) || '') ? 0.4 : 1 }}>Salvar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {equipe.length === 0 && <div style={{ fontSize: 13, color: C.m }}>A equipe comercial ainda não chegou do ERP de origem.</div>}
          </div>
        )}
      </div>
    </div>
  )
}

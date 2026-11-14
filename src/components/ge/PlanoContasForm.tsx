'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/cadastros/plano-contas'

export type TipoConta = 'receita' | 'despesa' | 'custo' | 'financeiro' | 'investimento'

export const TIPOS: Array<{ value: TipoConta; label: string; icone: string; cor: string }> = [
  { value: 'receita',      label: 'Receita',      icone: '📈', cor: '#16A34A' },
  { value: 'despesa',      label: 'Despesa',      icone: '📉', cor: '#DC2626' },
  { value: 'custo',        label: 'Custo',        icone: '💸', cor: '#EA580C' },
  { value: 'financeiro',   label: 'Financeiro',   icone: '🏦', cor: '#3B82F6' },
  { value: 'investimento', label: 'Investimento', icone: '📊', cor: '#8B5CF6' },
]

const GRUPOS_POR_TIPO: Record<TipoConta, Array<{ value: string; label: string }>> = {
  receita: [
    { value: 'receita_bruta', label: 'Receita Bruta' },
    { value: 'receita_financeira', label: 'Receita Financeira' },
    { value: 'outras_receitas', label: 'Outras Receitas' },
  ],
  despesa: [
    { value: 'despesa_pessoal', label: 'Despesa Pessoal' },
    { value: 'despesa_administrativa', label: 'Despesa Administrativa' },
    { value: 'tributos', label: 'Tributos' },
    { value: 'despesas_financeiras', label: 'Despesas Financeiras' },
  ],
  custo: [
    { value: 'custo_mercadoria', label: 'Custo de Mercadoria' },
    { value: 'custo_servico', label: 'Custo de Serviço' },
    { value: 'custo_direto', label: 'Custo Direto' },
    { value: 'custo_indireto', label: 'Custo Indireto' },
    { value: 'custo_variavel', label: 'Custo Variável' },
  ],
  financeiro: [
    { value: 'juros', label: 'Juros' },
    { value: 'taxas_bancarias', label: 'Taxas Bancárias' },
    { value: 'rendimentos', label: 'Rendimentos' },
    { value: 'tarifas', label: 'Tarifas' },
    { value: 'iof', label: 'IOF' },
  ],
  investimento: [
    { value: 'aquisicao', label: 'Aquisição' },
    { value: 'manutencao', label: 'Manutenção' },
    { value: 'aporte', label: 'Aporte' },
    { value: 'resgate', label: 'Resgate' },
  ],
}

function grupoDefault(tipo: TipoConta): string {
  return GRUPOS_POR_TIPO[tipo][0].value
}

// Mensagem de negócio quando a RPC recusa sem mensagem própria (RD-99: sem erro cru do banco).
function mensagemErro(codigo?: string): string {
  switch (codigo) {
    case 'codigo_duplicado': return 'Já existe uma conta com este código neste plano.'
    case 'codigo_obrigatorio': return 'Informe o código da conta.'
    case 'descricao_obrigatoria': return 'Informe a descrição da conta.'
    case 'grupo_obrigatorio': return 'Selecione o grupo DRE da conta.'
    case 'tipo_obrigatorio': return 'Selecione o tipo da conta.'
    case 'sem_acesso': return 'Você não tem acesso a esta empresa.'
    case 'conta_global_nao_editavel': return 'Contas do modelo padrão não podem ser editadas.'
    case 'nao_encontrado': return 'Conta não encontrada. Recarregue a página e tente de novo.'
    case 'nao_autenticado': return 'Sessão expirada. Entre novamente para salvar.'
    default: return 'Não foi possível salvar a conta. Verifique os dados e tente novamente.'
  }
}

export interface ContaPlano {
  id: string
  codigo: string
  descricao: string
  grupo: string
  tipo: TipoConta
  pai_codigo: string | null
  nivel: number | null
  ativo: boolean
  is_totalizador: boolean
}

interface Props {
  companyId: string
  conta: ContaPlano | null
  contasExistentes: ContaPlano[]
  onClose: () => void
  onSaved: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 13,
  color: '#3D2314',
  background: '#FFFFFF',
  boxSizing: 'border-box',
}

export default function PlanoContasForm({ companyId, conta, contasExistentes, onClose, onSaved }: Props) {
  const [codigo, setCodigo] = useState(conta?.codigo ?? '')
  const [descricao, setDescricao] = useState(conta?.descricao ?? '')
  const [tipo, setTipo] = useState<TipoConta>(conta?.tipo ?? 'despesa')
  const [grupo, setGrupo] = useState(conta?.grupo ?? grupoDefault(conta?.tipo ?? 'despesa'))
  const [paiCodigo, setPaiCodigo] = useState(conta?.pai_codigo ?? '')
  const [nivel, setNivel] = useState<number>(conta?.nivel ?? 2)
  const [isTotalizador, setIsTotalizador] = useState<boolean>(conta?.is_totalizador ?? false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const opcoesGrupo = GRUPOS_POR_TIPO[tipo]
  const opcoesPai = contasExistentes.filter((c) => c.nivel === 1 && c.tipo === tipo && c.id !== conta?.id)

  useEffect(() => {
    const valido = opcoesGrupo.some((g) => g.value === grupo)
    if (!valido) setGrupo(grupoDefault(tipo))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo])

  useEffect(() => {
    if (nivel === 1 && paiCodigo) setPaiCodigo('')
  }, [nivel, paiCodigo])

  function handleTipoChange(t: TipoConta) {
    setTipo(t)
    setPaiCodigo('')
  }

  async function handleSalvar() {
    if (!codigo.trim()) { setErro('Código obrigatório'); return }
    if (!descricao.trim()) { setErro('Descrição obrigatória'); return }
    if (!grupo) { setErro('Grupo é obrigatório'); return }

    setSalvando(true)
    setErro(null)

    // Escrita guardada por RPC (fn_plano_contas_salvar): valida código único com
    // mensagem amigável, respeita RLS/multi-tenant e grava audit_log_global (RD-98 p4).
    const { data, error } = await supabase.rpc('fn_plano_contas_salvar', {
      p_id: conta?.id ?? null,
      p_company_id: companyId,
      p_codigo: codigo.trim(),
      p_descricao: descricao.trim(),
      p_tipo: tipo,
      p_grupo: grupo,
      p_pai_codigo: paiCodigo || null,
      p_nivel: nivel,
      p_is_totalizador: isTotalizador,
    })

    setSalvando(false)

    if (error) {
      // Nunca vaza o texto cru do banco (RD-99): mensagem em linguagem do usuário.
      setErro('Não foi possível salvar a conta agora. Tente novamente em instantes.')
      return
    }

    const res = (data ?? {}) as { ok?: boolean; erro?: string; mensagem?: string }
    if (res.ok === false) {
      setErro(res.mensagem ?? mensagemErro(res.erro))
      return
    }

    onSaved()
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#FAF7F2', borderRadius: 12, maxWidth: 540, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ background: '#3D2314', color: '#FAF7F2', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0, zIndex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{conta?.id ? 'Editar' : 'Nova'} conta do plano</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', color: '#FAF7F2', border: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 24 }}>
          {erro && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{erro}</div>
          )}

          <Campo label="Tipo *" ajuda="plano_contas.tipo">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TIPOS.map((t) => {
                const ativo = tipo === t.value
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => handleTipoChange(t.value)}
                    style={{
                      flex: '1 1 calc(33% - 6px)',
                      minWidth: 100,
                      padding: '8px',
                      borderRadius: 6,
                      fontSize: 11,
                      cursor: 'pointer',
                      background: ativo ? t.cor : '#FFFFFF',
                      color: ativo ? '#FAF7F2' : '#3D2314',
                      border: `0.5px solid ${t.cor}`,
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      letterSpacing: 0.4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <span aria-hidden>{t.icone}</span> {t.label}
                  </button>
                )
              })}
            </div>
          </Campo>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <Campo label="Código *" hint="Ex: 3.1 · 4.3.06" ajuda="plano_contas.codigo">
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="x.x.xx" style={inputStyle} />
            </Campo>
            <Campo label="Descrição *" ajuda="plano_contas.descricao">
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Aluguel" style={inputStyle} />
            </Campo>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Campo label="Nível" ajuda="plano_contas.nivel">
              <select value={nivel} onChange={(e) => setNivel(parseInt(e.target.value, 10))} style={inputStyle}>
                <option value={1}>1 (Grupo principal)</option>
                <option value={2}>2 (Subconta)</option>
              </select>
            </Campo>
            <Campo label="Grupo DRE *" hint="Obrigatório (NOT NULL)" ajuda="plano_contas.grupo_dre">
              <select value={grupo} onChange={(e) => setGrupo(e.target.value)} style={inputStyle}>
                {opcoesGrupo.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </Campo>
          </div>

          {nivel === 2 && opcoesPai.length > 0 && (
            <Campo label="Conta-pai" hint="Grupo onde essa subconta entra" ajuda="plano_contas.conta_pai">
              <select value={paiCodigo} onChange={(e) => setPaiCodigo(e.target.value)} style={inputStyle}>
                <option value="">— Sem pai —</option>
                {opcoesPai.map((p) => (
                  <option key={p.id} value={p.codigo}>
                    {p.codigo} · {p.descricao}
                  </option>
                ))}
              </select>
            </Campo>
          )}

          <div style={{ background: 'rgba(200,148,26,0.08)', border: '0.5px solid rgba(200,148,26,0.3)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={isTotalizador} onChange={(e) => setIsTotalizador(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#C8941A', marginTop: 2 }} />
              <span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#3D2314' }}>Σ É linha totalizadora <AjudaCampo chave="plano_contas.totalizadora" rota={ROTA_AJUDA} /></span>
                <small style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.6)', marginTop: 2 }}>
                  Soma os filhos automaticamente · não recebe lançamentos diretos.
                </small>
              </span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={salvando}
              style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '10px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSalvar}
              disabled={salvando}
              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer' }}
            >
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, hint, ajuda, children }: { label: string; hint?: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {label}{ajuda && <> <AjudaCampo chave={ajuda} rota={ROTA_AJUDA} /></>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.5)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

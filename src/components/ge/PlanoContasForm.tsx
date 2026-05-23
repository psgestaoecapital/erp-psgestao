'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const GRUPOS_RECEITA = [
  { value: 'receita_bruta', label: 'Receita Bruta' },
  { value: 'receita_financeira', label: 'Receita Financeira' },
  { value: 'outras_receitas', label: 'Outras Receitas' },
]
const GRUPOS_DESPESA = [
  { value: 'custo_variavel', label: 'Custo Variável' },
  { value: 'despesa_pessoal', label: 'Despesa Pessoal' },
  { value: 'despesa_administrativa', label: 'Despesa Administrativa' },
  { value: 'tributos', label: 'Tributos' },
  { value: 'despesas_financeiras', label: 'Despesas Financeiras' },
]

export interface ContaPlano {
  id: string
  codigo: string
  descricao: string
  grupo: string
  tipo: 'receita' | 'despesa'
  pai_codigo: string | null
  nivel: number | null
  ativo: boolean
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
  const [tipo, setTipo] = useState<'receita' | 'despesa'>(conta?.tipo ?? 'despesa')
  const [grupo, setGrupo] = useState(
    conta?.grupo ?? ((conta?.tipo ?? 'despesa') === 'receita' ? 'receita_bruta' : 'despesa_administrativa'),
  )
  const [paiCodigo, setPaiCodigo] = useState(conta?.pai_codigo ?? '')
  const [nivel, setNivel] = useState<number>(conta?.nivel ?? 2)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const opcoesGrupo = tipo === 'receita' ? GRUPOS_RECEITA : GRUPOS_DESPESA
  const opcoesPai = contasExistentes.filter((c) => c.nivel === 1 && c.tipo === tipo && c.id !== conta?.id)

  // Se o tipo muda, garante que `grupo` (NOT NULL) está numa opção válida do novo tipo
  // e zera o pai (que era de outro tipo).
  useEffect(() => {
    const valido = opcoesGrupo.some((g) => g.value === grupo)
    if (!valido) setGrupo(tipo === 'receita' ? 'receita_bruta' : 'despesa_administrativa')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo])

  // Nível 1 não tem pai — limpa se cair pra 1.
  useEffect(() => {
    if (nivel === 1 && paiCodigo) setPaiCodigo('')
  }, [nivel, paiCodigo])

  function handleTipoChange(t: 'receita' | 'despesa') {
    setTipo(t)
    setPaiCodigo('')
  }

  async function handleSalvar() {
    if (!codigo.trim()) { setErro('Código obrigatório'); return }
    if (!descricao.trim()) { setErro('Descrição obrigatória'); return }
    if (!grupo) { setErro('Grupo é obrigatório'); return }

    setSalvando(true)
    setErro(null)

    const payload = {
      company_id: companyId,
      codigo: codigo.trim(),
      descricao: descricao.trim(),
      tipo,
      grupo, // NOT NULL — sempre tem valor
      pai_codigo: paiCodigo || null,
      nivel,
      ativo: conta?.ativo ?? true,
    }

    const result = conta?.id
      ? await supabase.from('erp_plano_contas').update(payload).eq('id', conta.id)
      : await supabase.from('erp_plano_contas').insert(payload)

    setSalvando(false)
    if (result.error) setErro('Erro: ' + result.error.message)
    else onSaved()
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

          <Campo label="Tipo *">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['receita', 'despesa'] as const).map((t) => {
                const ativo = tipo === t
                const cor = t === 'receita' ? '#3B6D11' : '#A32D2D'
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTipoChange(t)}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                      background: ativo ? cor : '#FFFFFF',
                      color: ativo ? '#FAF7F2' : '#3D2314',
                      border: `0.5px solid ${cor}`,
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      letterSpacing: 0.5,
                    }}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </Campo>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <Campo label="Código *" hint="Ex: 3.1 · 4.3.06">
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder={tipo === 'receita' ? '3.x.xx' : '4.x.xx'} style={inputStyle} />
            </Campo>
            <Campo label="Descrição *">
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Aluguel" style={inputStyle} />
            </Campo>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Campo label="Nível">
              <select value={nivel} onChange={(e) => setNivel(parseInt(e.target.value, 10))} style={inputStyle}>
                <option value={1}>1 (Grupo principal)</option>
                <option value={2}>2 (Subconta)</option>
              </select>
            </Campo>
            <Campo label="Grupo DRE *" hint="Obrigatório (NOT NULL)">
              <select value={grupo} onChange={(e) => setGrupo(e.target.value)} style={inputStyle}>
                {opcoesGrupo.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </Campo>
          </div>

          {nivel === 2 && opcoesPai.length > 0 && (
            <Campo label="Conta-pai" hint="Grupo onde essa subconta entra">
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

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.5)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

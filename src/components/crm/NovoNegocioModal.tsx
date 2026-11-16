'use client'
// PS CRM · cadastro rápido de negócio (RD-99: nome + empresa + valor e pronto). Grava pela RPC fn_crm_oportunidade_criar
// (fim do insert direto): o banco escolhe o funil padrão e a 1ª etapa, põe o vendedor como responsável e grava o histórico.
import { useEffect, useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { supabase } from '@/lib/supabase'
import { C, Campo, inp, btnPri, btnSec, rpcCrm, type ConfigCrm } from './crmUi'

type Cli = { id: string; nome: string }

export default function NovoNegocioModal({ aberto, onFechar, onCriado, empresa, cfg, funilId }: {
  aberto: boolean; onFechar: () => void; onCriado: (id: string) => void
  empresa: string; cfg: ConfigCrm; funilId?: string | null
}) {
  const funis = cfg.funis.filter((f) => f.ativo)
  const [titulo, setTitulo] = useState('')
  const [funil, setFunil] = useState<string>(funilId ?? funis[0]?.id ?? '')
  const [etapa, setEtapa] = useState('')
  const [valor, setValor] = useState('')
  const [origem, setOrigem] = useState('')
  const [resp, setResp] = useState('')
  const [previsao, setPrevisao] = useState('')
  const [cliBusca, setCliBusca] = useState('')
  const [cli, setCli] = useState<Cli | null>(null)
  const [sugestoes, setSugestoes] = useState<Cli[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => { if (aberto) { setTitulo(''); setValor(''); setCli(null); setCliBusca(''); setErro(null); setEtapa(''); setPrevisao(''); setOrigem(''); setResp(''); setFunil(funilId ?? funis[0]?.id ?? '') } }, [aberto]) // eslint-disable-line react-hooks/exhaustive-deps

  const etapas = useMemo(() => funis.find((f) => f.id === funil)?.etapas.filter((e) => e.tipo_etapa === 'normal') ?? [], [funis, funil])

  useEffect(() => {
    const t = cliBusca.trim()
    if (cli || t.length < 2) { setSugestoes([]); return }
    const h = setTimeout(async () => {
      const { data } = await supabase.from('erp_clientes').select('id, nome_fantasia, razao_social')
        .eq('company_id', empresa).is('excluido_em', null).or(`nome_fantasia.ilike.%${t.replace(/[%,()]/g, ' ')}%,razao_social.ilike.%${t.replace(/[%,()]/g, ' ')}%`).limit(8)
      setSugestoes(((data ?? []) as { id: string; nome_fantasia: string; razao_social: string | null }[]).map((c) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social || '—' })))
    }, 250)
    return () => clearTimeout(h)
  }, [cliBusca, cli, empresa])

  async function criarEmpresa() {
    const nome = cliBusca.trim()
    if (!nome) return
    try {
      const r = await rpcCrm<{ id: string }>('fn_crm_empresa_salvar', { p_company_id: empresa, p_dados: { nome } })
      setCli({ id: r.id, nome }); setSugestoes([])
    } catch (e) { setErro((e as Error).message) }
  }

  async function salvar() {
    setSalvando(true); setErro(null)
    try {
      const r = await rpcCrm<{ id: string }>('fn_crm_oportunidade_criar', {
        p_company_id: empresa,
        p_dados: {
          titulo: titulo || (cli ? `Negócio – ${cli.nome}` : ''), funil_id: funil || null, etapa_id: etapa || null,
          cliente_id: cli?.id ?? null, valor_estimado: valor ? Number(valor.replace(/\./g, '').replace(',', '.')) : null,
          origem_id: origem || null, responsavel_id: resp || null, data_prevista_fechamento: previsao || null,
        },
      })
      onCriado(r.id)
    } catch (e) { setErro((e as Error).message) } finally { setSalvando(false) }
  }

  const gestor = cfg.papel === 'diretor' || cfg.papel === 'gerente'
  return (
    <Modal open={aberto} onClose={onFechar} title="Novo negócio" subtitle="Nome e empresa já bastam — o resto dá para completar depois." maxWidth={560}
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onFechar} style={btnSec}>Cancelar</button>
        <button onClick={() => void salvar()} disabled={salvando || (!titulo.trim() && !cli)} style={{ ...btnPri, opacity: salvando || (!titulo.trim() && !cli) ? 0.5 : 1 }} data-testid="crm-novo-salvar">{salvando ? 'Salvando…' : 'Criar negócio'}</button>
      </div>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {erro && <div role="alert" style={{ color: C.RED, fontSize: 13 }}>{erro}</div>}
        <Campo rotulo="Empresa" ajuda="crm.novo.empresa">
          {cli ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...inp }}>
              <strong style={{ flex: 1 }}>{cli.nome}</strong>
              <button onClick={() => { setCli(null); setCliBusca('') }} style={{ background: 'none', border: 'none', color: C.TEXTM, cursor: 'pointer' }} aria-label="Trocar empresa">trocar</button>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <input style={inp} value={cliBusca} onChange={(e) => setCliBusca(e.target.value)} placeholder="Buscar empresa ou pessoa…" data-testid="crm-novo-empresa" />
              {cliBusca.trim().length >= 2 && (
                <div style={{ position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: `1px solid ${C.BORDA}`, borderRadius: 10, boxShadow: '0 8px 20px rgba(61,35,20,.12)', overflow: 'hidden' }}>
                  {sugestoes.map((s) => (
                    <button key={s.id} type="button" onClick={() => { setCli(s); setSugestoes([]) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 14, color: C.ESPRESSO }}>{s.nome}</button>
                  ))}
                  <button type="button" onClick={() => void criarEmpresa()} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderTop: `1px solid ${C.BORDA}`, background: '#FBF6EA', cursor: 'pointer', fontSize: 13.5, color: C.DOURADO, fontWeight: 700 }}>+ Cadastrar &quot;{cliBusca.trim()}&quot;</button>
                </div>
              )}
            </div>
          )}
        </Campo>
        <Campo rotulo="Nome do negócio" ajuda="crm.novo.titulo">
          <input style={inp} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={cli ? `Negócio – ${cli.nome}` : 'Ex.: Contrato anual – Clínica'} data-testid="crm-novo-titulo" />
        </Campo>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Campo rotulo="Valor estimado (R$)" ajuda="crm.novo.valor" largura={160}>
            <input style={inp} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0,00" data-testid="crm-novo-valor" />
          </Campo>
          <Campo rotulo="Previsão de fechamento" ajuda="crm.novo.previsao" largura={160}>
            <input style={inp} type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} />
          </Campo>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {funis.length > 1 && (
            <Campo rotulo="Funil" ajuda="crm.pipeline.funil" largura={180}>
              <select style={inp} value={funil} onChange={(e) => { setFunil(e.target.value); setEtapa('') }}>
                {funis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </Campo>
          )}
          <Campo rotulo="Etapa inicial" ajuda="crm.novo.etapa" largura={180}>
            <select style={inp} value={etapa} onChange={(e) => setEtapa(e.target.value)}>
              <option value="">{etapas[0]?.rotulo ?? '—'} (primeira)</option>
              {etapas.slice(1).map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Origem" ajuda="crm.novo.origem" largura={180}>
            <select style={inp} value={origem} onChange={(e) => setOrigem(e.target.value)}>
              <option value="">—</option>
              {cfg.origens.filter((o) => o.ativo).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </Campo>
          {gestor && (
            <Campo rotulo="Responsável" ajuda="crm.novo.responsavel" largura={180}>
              <select style={inp} value={resp} onChange={(e) => setResp(e.target.value)}>
                <option value="">Eu</option>
                {cfg.equipe.filter((u) => u.id !== cfg.eu).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </Campo>
          )}
        </div>
      </div>
    </Modal>
  )
}

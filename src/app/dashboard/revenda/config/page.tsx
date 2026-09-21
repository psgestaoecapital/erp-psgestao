'use client'

// Revenda · Onda R2 (Tela 2) — Configuração da garagem. Um lugar só para os parâmetros que a garagem
// usa para pensar o custo de carregar cada carro (RD-65: fonte única). O topo mostra o custo de ocupação
// AO VIVO enquanto se digita. Nada finge zero (RD-51): sem parâmetro, diz "não configurado". Salvar exige
// PRÉVIA (fn_veic_config_previa_efeito) — mostra quantos veículos mudam de preço mínimo — e confirmação.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5',
  red: '#B42318', redBg: '#FDECEC',
}
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const numOrNull = (s: string): number | null => { const n = Number(String(s).replace(',', '.')); return String(s).trim() !== '' && Number.isFinite(n) ? n : null }

type Carrego = {
  ok?: boolean
  ocupacao_dia: number | null; ocupacao_status: 'ok' | 'nao_configurado'
  custo_fixo_mensal: { ok?: boolean; valor: number | null; fonte: string }
  vagas: number | null
  capital_dia_pct: number | null; capital_status: 'ok' | 'nao_configurado'; taxa_capital_aa: number | null
  depreciacao: { fonte: string; status: string; mensagem?: string; curva?: unknown }
}
type Cfg = {
  vagas_operacionais?: number | null; area_patio_m2?: number | null; endereco_patio?: string | null
  custo_fixo_mensal_manual?: number | null; taxa_capital_aa?: number | null
  usa_floor_plan?: boolean | null; floor_plan_banco?: string | null; floor_plan_taxa_aa?: number | null
  depreciacao_fonte?: string | null; garantia_prazo_meses?: number | null
  comissao_base?: string | null; meta_veiculos_mes?: number | null; margem_minima_pct?: number | null
  margem_alvo_pct?: number | null; impostos_venda_pct?: number | null; comissao_venda_pct?: number | null
  provisao_garantia_pct?: number | null; semaforo_verde_ate_dias?: number | null
  semaforo_amarelo_ate_dias?: number | null; vistoria_modo_padrao?: string | null
}
type Obter = { ok?: boolean; existe?: boolean; falta?: string[]; config?: Cfg; carrego?: Carrego; erro?: string }
type Previa = {
  ok?: boolean; erro?: string; total_veiculos?: number; mudam_preco_minimo?: number
  exemplos?: { modelo: string | null; placa: string | null; antes: number | null; depois: number | null }[]
  encargos_antes_pct?: number; encargos_depois_pct?: number; margem_antes_pct?: number | null; margem_depois_pct?: number | null
}

// Rótulos do array "falta" devolvido por fn_veic_config_obter.
const FALTA_LABEL: Record<string, string> = {
  estrutura: 'Estrutura (vagas)', custo_fixo: 'Custo fixo mensal', capital: 'Custo do capital',
  margem: 'Margem alvo', impostos: 'Impostos / comissão / garantia', depreciacao: 'Depreciação',
  garantia: 'Prazo de garantia', comissao: 'Base da comissão', meta: 'Meta de vendas',
}

type Form = {
  vagas: string; area: string; endereco: string
  custoFixo: string; taxaCapital: string
  usaFloorPlan: boolean; floorBanco: string; floorTaxa: string
  deprecFonte: 'nao_calcular' | 'fipe' | 'curva_propria'
  garantiaMeses: string; comissaoBase: '' | 'lucro_real' | 'venda'
  metaMes: string; margemMinima: string
  margemAlvo: string; impostos: string; comissaoPct: string; garantiaPct: string
  semVerde: string; semAmarelo: string; vistoria: 'rapida' | 'completa'
}
const s = (v: number | null | undefined) => (v == null ? '' : String(v))

function formDe(c?: Cfg | null): Form {
  return {
    vagas: s(c?.vagas_operacionais), area: s(c?.area_patio_m2), endereco: c?.endereco_patio ?? '',
    custoFixo: s(c?.custo_fixo_mensal_manual), taxaCapital: s(c?.taxa_capital_aa ?? 15),
    usaFloorPlan: !!c?.usa_floor_plan, floorBanco: c?.floor_plan_banco ?? '', floorTaxa: s(c?.floor_plan_taxa_aa),
    deprecFonte: (c?.depreciacao_fonte as Form['deprecFonte']) ?? 'nao_calcular',
    garantiaMeses: s(c?.garantia_prazo_meses), comissaoBase: (c?.comissao_base as Form['comissaoBase']) ?? '',
    metaMes: s(c?.meta_veiculos_mes), margemMinima: s(c?.margem_minima_pct),
    margemAlvo: s(c?.margem_alvo_pct ?? 20), impostos: s(c?.impostos_venda_pct), comissaoPct: s(c?.comissao_venda_pct),
    garantiaPct: s(c?.provisao_garantia_pct), semVerde: s(c?.semaforo_verde_ate_dias ?? 30),
    semAmarelo: s(c?.semaforo_amarelo_ate_dias ?? 60), vistoria: (c?.vistoria_modo_padrao as Form['vistoria']) ?? 'rapida',
  }
}
// dados enviados ao banco — chave presente é autoritativa (fn_veic_config_salvar). Números vão como string.
function dadosDe(f: Form): Record<string, unknown> {
  return {
    vagas_operacionais: f.vagas, area_patio_m2: f.area, endereco_patio: f.endereco,
    custo_fixo_mensal_manual: f.custoFixo, taxa_capital_aa: f.taxaCapital,
    usa_floor_plan: f.usaFloorPlan, floor_plan_banco: f.floorBanco, floor_plan_taxa_aa: f.floorTaxa,
    depreciacao_fonte: f.deprecFonte, garantia_prazo_meses: f.garantiaMeses, comissao_base: f.comissaoBase,
    meta_veiculos_mes: f.metaMes, margem_minima_pct: f.margemMinima,
    margem_alvo_pct: f.margemAlvo, impostos_venda_pct: f.impostos, comissao_venda_pct: f.comissaoPct,
    provisao_garantia_pct: f.garantiaPct, semaforo_verde_ate_dias: f.semVerde,
    semaforo_amarelo_ate_dias: f.semAmarelo, vistoria_modo_padrao: f.vistoria,
  }
}

// Regras de comissão do vendedor (veic_comissao_regra) — a marcada precifica o estoque (item 3).
type RegraComissao = { tipo_atendimento: string; base: '' | 'fipe' | 'fixo' | 'preco' | 'lucro'; percentual: string; valor_fixo: string; rotulo: string; usar_na_precificacao: boolean; ativo: boolean }
const regraVazia = (): RegraComissao => ({ tipo_atendimento: '', base: '', percentual: '', valor_fixo: '', rotulo: '', usar_na_precificacao: false, ativo: true })

export default function ConfigGaragemPage() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [obter, setObter] = useState<Obter | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [f, setF] = useState<Form>(formDe(null))
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [salvando, setSalvando] = useState(false)
  // R4c · bloco Entrega (checklist + termo) — save próprio, fora da prévia de preço mínimo.
  const [entItens, setEntItens] = useState<{ item: string; obrigatorio: boolean }[]>([])
  const [entTermo, setEntTermo] = useState('')
  const [entFonte, setEntFonte] = useState<string>('fabrica')
  const [entSalvando, setEntSalvando] = useState(false)
  // item 2c-b · regras de comissão do vendedor (a marcada precifica o estoque).
  const [regras, setRegras] = useState<RegraComissao[]>([])
  const [regrasSalvando, setRegrasSalvando] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setObter(null); setCarregando(false); return }
    setCarregando(true)
    const { data } = await supabase.rpc('fn_veic_config_obter', { p_company_id: companyId })
    const r = data as Obter | null
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : 'Falha ao carregar a configuração.'); setCarregando(false); return }
    setErro(null); setObter(r); setF(formDe(r.config)); setCarregando(false)
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const carregarEntrega = useCallback(async () => {
    if (!companyId) { setEntItens([]); setEntTermo(''); return }
    const { data } = await supabase.rpc('fn_veic_config_entrega_obter', { p_company_id: companyId })
    const r = data as { ok?: boolean; fonte?: string; itens?: { item: string; obrigatorio: boolean }[]; termo?: string | null } | null
    if (!r?.ok) return
    setEntItens((r.itens ?? []).map((i) => ({ item: i.item, obrigatorio: !!i.obrigatorio })))
    setEntTermo(r.termo ?? ''); setEntFonte(r.fonte ?? 'fabrica')
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarEntrega() }, [carregarEntrega])

  async function salvarEntrega() {
    if (!companyId) return
    setEntSalvando(true); setErro(null)
    const { data: { session } } = await supabase.auth.getSession()
    const { data } = await supabase.rpc('fn_veic_config_entrega_salvar', { p_company_id: companyId, p_itens: entItens, p_termo: entTermo || null, p_user: session?.user?.id ?? null })
    setEntSalvando(false)
    const r = data as { ok?: boolean; erro?: string; mensagem?: string } | null
    if (!r?.ok) { setErro(r?.mensagem || (r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (r?.erro || 'Falha ao salvar a entrega.'))); return }
    setMsg('Checklist e termo de entrega salvos.'); setEntFonte('empresa'); void carregarEntrega()
  }

  const carregarRegras = useCallback(async () => {
    if (!companyId) { setRegras([]); return }
    const { data } = await supabase.rpc('fn_veic_comissao_regras_obter', { p_company_id: companyId })
    const r = data as { ok?: boolean; regras?: { tipo_atendimento: string; base: string; percentual: number | null; valor_fixo: number | null; rotulo: string | null; usar_na_precificacao: boolean; ativo: boolean }[] } | null
    if (!r?.ok) return
    setRegras((r.regras ?? []).map((x) => ({
      tipo_atendimento: x.tipo_atendimento ?? '', base: (x.base as RegraComissao['base']) ?? '',
      percentual: x.percentual == null ? '' : String(x.percentual), valor_fixo: x.valor_fixo == null ? '' : String(x.valor_fixo),
      rotulo: x.rotulo ?? '', usar_na_precificacao: !!x.usar_na_precificacao, ativo: x.ativo !== false,
    })))
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarRegras() }, [carregarRegras])

  async function salvarRegras() {
    if (!companyId) return
    setRegrasSalvando(true); setErro(null)
    const { data: { session } } = await supabase.auth.getSession()
    const payload = regras.filter((r) => r.tipo_atendimento.trim() && r.base)
    const { data } = await supabase.rpc('fn_veic_comissao_regras_salvar', { p_company_id: companyId, p_regras: payload, p_user: session?.user?.id ?? null })
    setRegrasSalvando(false)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) {
      setErro(r?.erro === 'mais_de_uma_regra_precifica' ? 'Só uma regra pode precificar o estoque — marque apenas uma.'
        : r?.erro === 'base_invalida' ? 'Escolha a base de cada regra.'
        : r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (r?.erro || 'Falha ao salvar as regras.')); return
    }
    setMsg('Regras de comissão salvas.'); void carregarRegras()
  }
  // marcar uma regra p/ precificar desmarca as outras (só uma pode).
  const marcarPrecifica = (i: number) => setRegras((xs) => xs.map((x, j) => ({ ...x, usar_na_precificacao: j === i })))

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }))

  // Custo de ocupação AO VIVO (RD-51): custo fixo mensal ÷ (vagas × 30). Sem vagas ou custo → não configurado.
  const ocupacaoDia = useMemo(() => {
    const vagas = numOrNull(f.vagas); const cf = numOrNull(f.custoFixo)
    if (vagas != null && vagas > 0 && cf != null && cf > 0) return Math.round((cf / (vagas * 30)) * 100) / 100
    return null
  }, [f.vagas, f.custoFixo])
  const capitalDiaPct = useMemo(() => {
    const t = numOrNull(f.taxaCapital)
    return t != null && t > 0 ? Math.round((t / 365) * 1e6) / 1e6 : null
  }, [f.taxaCapital])

  async function pedirPrevia() {
    if (!companyId) return
    setSalvando(true); setErro(null)
    const { data } = await supabase.rpc('fn_veic_config_previa_efeito', { p_company_id: companyId, p_config_nova: dadosDe(f) })
    setSalvando(false)
    const r = data as Previa | null
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (r?.erro || 'Falha ao calcular a prévia.')); return }
    setPrevia(r)
  }

  async function confirmarSalvar() {
    if (!companyId) return
    setSalvando(true); setErro(null)
    const { data: { session } } = await supabase.auth.getSession()
    const { data } = await supabase.rpc('fn_veic_config_salvar', { p_company_id: companyId, p_dados: dadosDe(f), p_user: session?.user?.id ?? null })
    setSalvando(false); setPrevia(null)
    const r = data as { ok?: boolean; erro?: string } | null
    if (!r?.ok) { setErro(r?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (r?.erro || 'Falha ao salvar.')); return }
    setMsg('Configuração salva.'); void carregar()
  }

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>
  if (carregando) return <div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando configuração…</div>

  const falta = obter?.falta ?? []
  const fipeTravado = f.deprecFonte === 'fipe'

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.esp, maxWidth: 640, margin: '0 auto', padding: '18px 16px 64px' }}>
      <a href="/dashboard/revenda" style={{ fontSize: 12, color: C.gold, textDecoration: 'none' }}>← voltar ao painel</a>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700, marginTop: 8 }}>🚗 Comércio · Revenda</div>
      <h1 style={{ fontSize: 23, fontWeight: 700, margin: '2px 0 6px' }}>Configuração da garagem</h1>
      <p style={{ fontSize: 12.5, color: C.espM, margin: '0 0 14px', lineHeight: 1.5 }}>
        Um lugar só para os parâmetros que sustentam a conta de cada carro (RD-65). O que ficar em branco a tela mostra como
        <b> não configurado</b> — nunca finge R$ 0.
      </p>

      {msg && <div style={{ background: C.greenBg, color: C.green, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setMsg(null)}>{msg}</div>}
      {erro && <div style={{ background: C.redBg, color: C.red, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }} onClick={() => setErro(null)}>{erro}</div>}

      {/* CUSTO DE OCUPAÇÃO AO VIVO */}
      <div style={{ background: C.esp, color: '#fff', borderRadius: 14, padding: '15px 17px', marginBottom: 14 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: '#E9C77A', fontWeight: 700 }}>Custo de ocupação</div>
        <div style={{ fontSize: 28, fontWeight: 800, margin: '3px 0 2px' }}>
          {ocupacaoDia != null ? `${brl(ocupacaoDia)}` : 'não configurado'}
          {ocupacaoDia != null && <span style={{ fontSize: 13, fontWeight: 500, color: '#D8C9B8' }}> / veículo / dia</span>}
        </div>
        <div style={{ fontSize: 11.5, color: '#C9B79F' }}>
          {ocupacaoDia != null
            ? `custo fixo ${brl(numOrNull(f.custoFixo))} ÷ (${numOrNull(f.vagas)} vagas × 30 dias)`
            : 'preencha vagas e custo fixo mensal para ver o custo por veículo'}
          {capitalDiaPct != null && ` · capital ${(capitalDiaPct * 100).toFixed(4)}%/dia`}
        </div>
      </div>

      {/* O QUE FALTA */}
      {falta.length > 0 && (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amber}66`, borderRadius: 12, padding: '11px 14px', marginBottom: 14, fontSize: 12.5, color: '#8A4B08' }}>
          <b>Falta configurar:</b> {falta.map((k) => FALTA_LABEL[k] ?? k).join(' · ')}
        </div>
      )}

      {/* ESTRUTURA */}
      <Bloco titulo="Estrutura do pátio" hint="Quantas vagas a garagem opera — é o divisor do custo de ocupação.">
        <Grid>
          <Campo l="Vagas operacionais" v={f.vagas} onChange={(x) => set('vagas', x)} tipo="int" ph="ex.: 30" />
          <Campo l="Área do pátio (m²)" v={f.area} onChange={(x) => set('area', x)} tipo="dec" ph="opcional" />
        </Grid>
        <Campo l="Endereço do pátio" v={f.endereco} onChange={(x) => set('endereco', x)} tipo="texto" ph="opcional" full />
      </Bloco>

      {/* CUSTO FIXO */}
      <Bloco titulo="Custo fixo mensal" hint="Aluguel, luz, equipe, seguro — o que a garagem gasta por mês para existir.">
        <Campo l="Custo fixo mensal (R$)" v={f.custoFixo} onChange={(x) => set('custoFixo', x)} tipo="dec" ph="ex.: 40000" full />
        <div style={{ fontSize: 11.5, color: C.espL, marginTop: 6 }}>
          O rateio automático por contas do plano (média de 3 meses) entra quando o de-para gerencial↔contábil estiver ligado.
          Por ora, informe o valor à mão.
        </div>
      </Bloco>

      {/* CAPITAL */}
      <Bloco titulo="Custo do capital" hint="Quanto custa manter dinheiro parado no carro (juros de oportunidade ou floor plan).">
        <Campo l="Taxa de capital (% a.a.)" v={f.taxaCapital} onChange={(x) => set('taxaCapital', x)} tipo="dec" ph="ex.: 15" full />
        <div style={{ fontSize: 11.5, color: C.espL, margin: '4px 0 10px' }}>Referência: ~1,2% a.m. ≈ 15% a.a.</div>
        <Toggle checado={f.usaFloorPlan} onChange={(x) => set('usaFloorPlan', x)} l="Uso floor plan (estoque financiado por banco)" />
        {f.usaFloorPlan && (
          <Grid>
            <Campo l="Banco do floor plan" v={f.floorBanco} onChange={(x) => set('floorBanco', x)} tipo="texto" ph="ex.: Banco X" />
            <Campo l="Taxa do floor plan (% a.a.)" v={f.floorTaxa} onChange={(x) => set('floorTaxa', x)} tipo="dec" ph="% a.a." />
          </Grid>
        )}
      </Bloco>

      {/* DEPRECIAÇÃO */}
      <Bloco titulo="Depreciação" hint="Como a garagem trata a perda de valor do carro parado.">
        <label style={{ fontSize: 11.5, color: C.espM }}>Fonte da depreciação
          <select value={f.deprecFonte} onChange={(e) => set('deprecFonte', e.target.value as Form['deprecFonte'])} style={sel_()}>
            <option value="nao_calcular">Não calcular (honesto)</option>
            <option value="fipe">FIPE (indisponível — D7)</option>
            <option value="curva_propria">Curva própria</option>
          </select>
        </label>
        {fipeTravado && (
          <div style={{ background: C.amberBg, color: '#8A4B08', borderRadius: 8, padding: '8px 11px', marginTop: 8, fontSize: 12 }}>
            ⚠️ Integração FIPE ainda não disponível (D7). Enquanto isso a depreciação fica travada — o carrego não a usa.
          </div>
        )}
      </Bloco>

      {/* GARANTIA */}
      <Bloco titulo="Garantia padrão" hint="Prazo de garantia oferecido na venda (entra na provisão).">
        <Campo l="Prazo de garantia (meses)" v={f.garantiaMeses} onChange={(x) => set('garantiaMeses', x)} tipo="int" ph="ex.: 3" full />
      </Bloco>

      {/* COMISSÃO */}
      <Bloco titulo="Comissão do vendedor" hint="Sobre o que a comissão é calculada.">
        <label style={{ fontSize: 11.5, color: C.espM }}>Base da comissão
          <select value={f.comissaoBase} onChange={(e) => set('comissaoBase', e.target.value as Form['comissaoBase'])} style={sel_()}>
            <option value="">— escolher —</option>
            <option value="lucro_real">Lucro real do carro</option>
            <option value="venda">Valor da venda</option>
          </select>
        </label>
      </Bloco>

      {/* REGRAS DE COMISSÃO (item 2c-b) — por tipo de atendimento; a marcada precifica o estoque */}
      <Bloco titulo="Regras de comissão do vendedor" hint="Por tipo de atendimento (ex.: trouxe a venda, atendeu na loja). A regra marcada como 'usa no preço mínimo' é a que entra no preço mínimo (item 3) — só uma pode. Em branco = não configurado.">
        <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
          {regras.map((r, i) => {
            const upd = (patch: Partial<RegraComissao>) => setRegras((xs) => xs.map((x, j) => j === i ? { ...x, ...patch } : x))
            return (
              <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <input value={r.rotulo} onChange={(e) => upd({ rotulo: e.target.value })} placeholder="rótulo (ex.: Trouxe a venda — 1% FIPE)"
                    style={{ flex: '2 1 180px', boxSizing: 'border-box', padding: 8, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white }} />
                  <input value={r.tipo_atendimento} onChange={(e) => upd({ tipo_atendimento: e.target.value })} placeholder="tipo (ex.: trouxe_venda)"
                    style={{ flex: '1 1 130px', boxSizing: 'border-box', padding: 8, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white, fontFamily: 'monospace' }} />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={r.base} onChange={(e) => upd({ base: e.target.value as RegraComissao['base'] })} style={{ flex: '1 1 120px', padding: 8, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white }}>
                    <option value="">— base —</option>
                    <option value="fipe">% da FIPE</option>
                    <option value="fixo">R$ fixo</option>
                    <option value="preco">% do preço</option>
                    <option value="lucro">% do lucro</option>
                  </select>
                  {r.base === 'fixo'
                    ? <input value={r.valor_fixo} onChange={(e) => upd({ valor_fixo: e.target.value })} inputMode="decimal" placeholder="R$ fixo" style={{ flex: '1 1 90px', boxSizing: 'border-box', padding: 8, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white }} />
                    : <input value={r.percentual} onChange={(e) => upd({ percentual: e.target.value })} inputMode="decimal" placeholder="%" disabled={!r.base} style={{ flex: '1 1 90px', boxSizing: 'border-box', padding: 8, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: r.base ? C.white : C.cream }} />}
                  <label style={{ fontSize: 11.5, color: C.esp, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                    <input type="radio" name="usar_precifica" checked={r.usar_na_precificacao} onChange={() => marcarPrecifica(i)} style={{ accentColor: C.gold }} />usa no preço mínimo
                  </label>
                  <label style={{ fontSize: 11.5, color: C.espM, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={r.ativo} onChange={(e) => upd({ ativo: e.target.checked })} style={{ width: 15, height: 15, accentColor: C.gold }} />ativa
                  </label>
                  <button onClick={() => setRegras((xs) => xs.filter((_, j) => j !== i))} style={{ border: `1px solid ${C.border}`, background: C.white, color: C.red, borderRadius: 8, padding: '6px 9px', cursor: 'pointer', fontSize: 12 }}>remover</button>
                </div>
              </div>
            )
          })}
          {regras.length === 0 && <div style={{ fontSize: 12, color: C.espL }}>Nenhuma regra — o preço mínimo usa a Comissão % da config abaixo.</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setRegras((xs) => [...xs, regraVazia()])} style={{ border: `1px dashed ${C.border}`, background: C.white, color: C.gold, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12.5 }}>+ adicionar regra</button>
          <button disabled={regrasSalvando} onClick={() => void salvarRegras()} style={{ border: 'none', background: C.gold, color: '#fff', borderRadius: 8, padding: '7px 14px', cursor: regrasSalvando ? 'wait' : 'pointer', fontSize: 12.5, fontWeight: 700 }}>{regrasSalvando ? 'Salvando…' : 'Salvar regras de comissão'}</button>
        </div>
      </Bloco>

      {/* IMPOSTOS E MARGENS */}
      <Bloco titulo="Impostos e margens" hint="Percentuais que incidem sobre o preço. Em branco = não configurado (o piso avisa).">
        <Grid>
          <Campo l="Impostos %" v={f.impostos} onChange={(x) => set('impostos', x)} tipo="dec" />
          <Campo l="Comissão %" v={f.comissaoPct} onChange={(x) => set('comissaoPct', x)} tipo="dec" />
          <Campo l="Garantia %" v={f.garantiaPct} onChange={(x) => set('garantiaPct', x)} tipo="dec" />
          <Campo l="Margem alvo %" v={f.margemAlvo} onChange={(x) => set('margemAlvo', x)} tipo="dec" ph="ex.: 20" />
          <Campo l="Margem mínima %" v={f.margemMinima} onChange={(x) => set('margemMinima', x)} tipo="dec" ph="piso" />
        </Grid>
      </Bloco>

      {/* SEMÁFORO */}
      <Bloco titulo="Semáforo de tempo no pátio" hint="Até quantos dias cada faixa (verde/amarelo). Acima do amarelo é vermelho.">
        <Grid>
          <Campo l="Verde até (dias)" v={f.semVerde} onChange={(x) => set('semVerde', x)} tipo="int" ph="ex.: 30" />
          <Campo l="Amarelo até (dias)" v={f.semAmarelo} onChange={(x) => set('semAmarelo', x)} tipo="int" ph="ex.: 60" />
        </Grid>
      </Bloco>

      {/* META */}
      <Bloco titulo="Meta de vendas" hint="Quantos veículos a garagem quer vender por mês.">
        <Campo l="Meta (veículos / mês)" v={f.metaMes} onChange={(x) => set('metaMes', x)} tipo="int" ph="ex.: 12" full />
      </Bloco>

      {/* VISTORIA PADRÃO */}
      <Bloco titulo="Vistoria padrão" hint="Modo sugerido ao abrir uma vistoria nova.">
        <label style={{ fontSize: 11.5, color: C.espM }}>Modo
          <select value={f.vistoria} onChange={(e) => set('vistoria', e.target.value as Form['vistoria'])} style={sel_()}>
            <option value="rapida">Rápida (9 itens)</option>
            <option value="completa">Completa (80 itens)</option>
          </select>
        </label>
      </Bloco>

      {/* ENTREGA (R4c) — checklist e termo por empresa. Save próprio, não mexe no preço mínimo. */}
      <Bloco titulo="Entrega (checklist e termo)" hint="Os itens que o cliente confere na entrega e o texto padrão do termo. Os obrigatórios travam a conclusão da entrega.">
        <div style={{ fontSize: 11, color: entFonte === 'empresa' ? C.green : C.espL, marginBottom: 8 }}>{entFonte === 'empresa' ? 'Usando o checklist desta empresa.' : 'Usando o checklist padrão de fábrica — edite e salve para personalizar.'}</div>
        <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
          {entItens.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={it.item} onChange={(e) => setEntItens((xs) => xs.map((x, j) => j === i ? { ...x, item: e.target.value } : x))} placeholder="item do checklist"
                style={{ flex: 1, boxSizing: 'border-box', padding: 9, fontSize: 13.5, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white }} />
              <label style={{ fontSize: 11, color: C.espM, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={it.obrigatorio} onChange={(e) => setEntItens((xs) => xs.map((x, j) => j === i ? { ...x, obrigatorio: e.target.checked } : x))} style={{ width: 15, height: 15, accentColor: C.gold }} />obrig.
              </label>
              <button onClick={() => setEntItens((xs) => xs.filter((_, j) => j !== i))} style={{ border: `1px solid ${C.border}`, background: C.white, color: C.red, borderRadius: 8, padding: '6px 9px', cursor: 'pointer', fontSize: 12 }}>remover</button>
            </div>
          ))}
        </div>
        <button onClick={() => setEntItens((xs) => [...xs, { item: '', obrigatorio: true }])} style={{ border: `1px dashed ${C.border}`, background: C.white, color: C.gold, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12.5, marginBottom: 10 }}>+ adicionar item</button>
        <label style={{ fontSize: 11.5, color: C.espM, display: 'block' }}>Texto padrão do termo (opcional — se vazio, usa o modelo do sistema)
          <textarea value={entTermo} onChange={(e) => setEntTermo(e.target.value)} rows={4} placeholder="Ex.: cláusulas próprias da loja…"
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 10, fontSize: 13.5, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white, resize: 'vertical' }} />
        </label>
        <button disabled={entSalvando} onClick={() => void salvarEntrega()} style={{ marginTop: 10, background: entSalvando ? C.espL : C.gold, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: entSalvando ? 'wait' : 'pointer' }}>{entSalvando ? 'Salvando…' : 'Salvar checklist e termo'}</button>
      </Bloco>

      <button disabled={salvando} onClick={() => void pedirPrevia()} style={{ marginTop: 8, width: '100%', background: salvando ? C.espL : C.gold, color: '#fff', border: 'none', borderRadius: 12, padding: '14px 22px', fontSize: 16, fontWeight: 800, cursor: salvando ? 'wait' : 'pointer' }}>
        {salvando ? 'Calculando…' : 'Ver efeito e salvar'}
      </button>
      <div style={{ fontSize: 11.5, color: C.espL, textAlign: 'center', marginTop: 8 }}>Antes de gravar, a tela mostra quantos veículos mudam de preço mínimo.</div>

      {previa && <PreviaModal previa={previa} salvando={salvando} onCancel={() => setPrevia(null)} onConfirm={() => void confirmarSalvar()} />}
    </div>
  )
}

function PreviaModal({ previa, salvando, onCancel, onConfirm }: { previa: Previa; salvando: boolean; onCancel: () => void; onConfirm: () => void }) {
  const mudam = previa.mudam_preco_minimo ?? 0
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.white, borderRadius: 14, padding: 20, width: 'min(500px,100%)', maxHeight: '86vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Efeito da mudança</div>
        <div style={{ fontSize: 12.5, color: C.espM, marginBottom: 12, lineHeight: 1.45 }}>
          Confira antes de gravar. O preço mínimo é recalculado com os encargos e a margem novos.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <Stat l="Encargos" v={`${previa.encargos_antes_pct ?? 0}% → ${previa.encargos_depois_pct ?? 0}%`} />
          <Stat l="Margem alvo" v={`${previa.margem_antes_pct ?? '—'}% → ${previa.margem_depois_pct ?? '—'}%`} />
        </div>

        <div style={{ background: mudam > 0 ? C.amberBg : C.greenBg, border: `1px solid ${mudam > 0 ? C.amber + '66' : C.green + '44'}`, borderRadius: 10, padding: '11px 13px', fontSize: 13, color: mudam > 0 ? '#8A4B08' : C.green }}>
          {mudam > 0
            ? <><b>{mudam}</b> de {previa.total_veiculos ?? 0} veículo(s) mudam de preço mínimo.</>
            : <>Nenhum veículo muda de preço mínimo com esta configuração.</>}
        </div>

        {(previa.exemplos?.length ?? 0) > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11.5, textTransform: 'uppercase', color: C.espM, fontWeight: 700, marginBottom: 5 }}>Exemplos</div>
            {previa.exemplos!.map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: i ? `1px solid ${C.cream}` : 'none', fontSize: 12.5 }}>
                <span style={{ color: C.esp }}>{e.modelo || 'Veículo'} {e.placa ? `· ${e.placa}` : ''}</span>
                <span style={{ fontFamily: 'monospace' }}>{e.antes != null ? brl(e.antes) : '—'} → <b>{e.depois != null ? brl(e.depois) : '—'}</b></span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '9px 16px', border: `1px solid ${C.border}`, borderRadius: 9, background: C.white, color: C.espM, fontWeight: 700, cursor: 'pointer' }}>Voltar</button>
          <button disabled={salvando} onClick={onConfirm} style={{ padding: '9px 18px', border: 'none', borderRadius: 9, background: salvando ? C.espL : C.gold, color: '#fff', fontWeight: 800, cursor: salvando ? 'wait' : 'pointer' }}>{salvando ? 'Salvando…' : 'Confirmar e salvar'}</button>
        </div>
      </div>
    </div>
  )
}

function Stat({ l, v }: { l: string; v: string }) {
  return <div style={{ background: C.cream, borderRadius: 9, padding: '8px 11px' }}><div style={{ fontSize: 10.5, textTransform: 'uppercase', color: C.espM, fontWeight: 700 }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700, color: C.esp }}>{v}</div></div>
}

function Bloco({ titulo, hint, children }: { titulo: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{titulo}</div>
      {hint && <div style={{ fontSize: 11.5, color: C.espL, margin: '2px 0 10px', lineHeight: 1.45 }}>{hint}</div>}
      {children}
    </div>
  )
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>{children}</div>
}
function Campo({ l, v, onChange, tipo, ph, full }: { l: string; v: string; onChange: (v: string) => void; tipo: 'int' | 'dec' | 'texto'; ph?: string; full?: boolean }) {
  return (
    <label style={{ fontSize: 11.5, color: C.espM, display: 'block', gridColumn: full ? '1 / -1' : undefined }}>{l}
      <input value={v} onChange={(e) => onChange(e.target.value)} inputMode={tipo === 'texto' ? 'text' : 'decimal'} placeholder={ph}
        style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 10, fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white }} />
    </label>
  )
}
function Toggle({ checado, onChange, l }: { checado: boolean; onChange: (v: boolean) => void; l: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.esp, cursor: 'pointer', margin: '6px 0' }}>
      <input type="checkbox" checked={checado} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16 }} />
      {l}
    </label>
  )
}
function sel_(): React.CSSProperties {
  return { width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 10, fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 8, color: C.esp, background: C.white }
}

// Aba "Infraestrutura" do Painel de Codes (CEO 16/10 19:15) — regras puras (sem React, sem rede), para a tela e para o gate
// scripts/gates/check-infraestrutura.ts. Os números vêm de fn_dev_infra_desempenho / fn_dev_infra_agentes (equipe PS).
//   • semáforo verde/amarelo/vermelho SÓ nos números do bloco 3; os limites ficam em LIMITES e aparecem no "?".
//   • leitura tolerante: dado ruim vira null/0, nunca exceção (um bloco com erro não derruba a aba).
import { estadoSessao, type Lease } from '@/lib/dev/painelCodes'

export type Semaforo = 'verde' | 'amarelo' | 'vermelho' | 'sem_dado'
export type Janela = 'hoje' | 'd7'

/** Limite de cada número: `bom` = vale verde; `medio` = vale amarelo; além disso, vermelho. `menor` = quanto menor, melhor. */
export const LIMITES = {
  resp_20min_pct: { menor: false, bom: 90, medio: 70, unidade: '%' },
  chamados_idade_media_h: { menor: true, bom: 4, medio: 24, unidade: 'h' },
  aberta_pronta_min: { menor: true, bom: 240, medio: 720, unidade: 'min' },
  esteira_sensiveis_esperando: { menor: true, bom: 3, medio: 8, unidade: '' },
  esteira_migrations_na_fila: { menor: true, bom: 2, medio: 5, unidade: '' },
  pronta_publicada_min: { menor: true, bom: 60, medio: 180, unidade: 'min' },
  publicadas_por_hora: { menor: false, bom: 4, medio: 2, unidade: '/h' },
  saldo: { menor: true, bom: 3, medio: 10, unidade: '' },
  main_vermelha_min: { menor: true, bom: 0, medio: 60, unidade: 'min' },
  auditor_nota_hub: { menor: false, bom: 70, medio: 40, unidade: '' },
  achados_abertos: { menor: true, bom: 5, medio: 15, unidade: '' },
  achado_correcao_min: { menor: true, bom: 1440, medio: 4320, unidade: 'min' },
} as const
export type ChaveLimite = keyof typeof LIMITES

export function semaforo(chave: ChaveLimite, valor: number | null | undefined): Semaforo {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return 'sem_dado'
  const l = LIMITES[chave]
  if (l.menor) return valor <= l.bom ? 'verde' : valor <= l.medio ? 'amarelo' : 'vermelho'
  return valor >= l.bom ? 'verde' : valor >= l.medio ? 'amarelo' : 'vermelho'
}

/** Pior dos semáforos (sem_dado não pesa). */
export function pior(lista: Semaforo[]): Semaforo {
  const v = lista.filter(s => s !== 'sem_dado')
  if (!v.length) return 'sem_dado'
  return v.includes('vermelho') ? 'vermelho' : v.includes('amarelo') ? 'amarelo' : 'verde'
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const zero = (x: unknown): number => num(x) ?? 0
const mapa = (x: unknown): Record<string, number> => {
  const o: Record<string, number> = {}
  if (x && typeof x === 'object' && !Array.isArray(x)) for (const [k, v] of Object.entries(x as Record<string, unknown>)) o[k] = zero(v)
  return o
}

export type NumerosJanela = {
  chamados_novos: number; resp_20min_pct: number | null
  prs_produzidas: number; prs_publicadas: number; publicadas_por_hora: number | null
  aberta_pronta_min: number | null; pronta_publicada_min: number | null; por_code: Record<string, number>
  auditor_telas: number; auditor_vereditos: Record<string, number>; auditor_nota_hub: number | null
  achados_abertos: number; achados_fechados: number; achado_correcao_min: number | null
}
export type Desempenho = {
  hoje: NumerosJanela; d7: NumerosJanela
  chamados_abertos: number; chamados_idade_media_h: number | null
  esteira_estados: Record<string, number>; esteira_sensiveis_esperando: number; esteira_migrations_na_fila: number
  main_vermelha_min: number; gerado_em: string | null
}

function lerJanela(j: unknown): NumerosJanela {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>
  return {
    chamados_novos: zero(o.chamados_novos), resp_20min_pct: num(o.resp_20min_pct),
    prs_produzidas: zero(o.prs_produzidas), prs_publicadas: zero(o.prs_publicadas), publicadas_por_hora: num(o.publicadas_por_hora),
    aberta_pronta_min: num(o.aberta_pronta_min), pronta_publicada_min: num(o.pronta_publicada_min), por_code: mapa(o.por_code),
    auditor_telas: zero(o.auditor_telas), auditor_vereditos: mapa(o.auditor_vereditos), auditor_nota_hub: num(o.auditor_nota_hub),
    achados_abertos: zero(o.achados_abertos), achados_fechados: zero(o.achados_fechados), achado_correcao_min: num(o.achado_correcao_min),
  }
}

export function lerDesempenho(d: unknown): Desempenho | null {
  const o = d as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || o.ok !== true) return null
  return {
    hoje: lerJanela(o.hoje), d7: lerJanela(o.d7),
    chamados_abertos: zero(o.chamados_abertos), chamados_idade_media_h: num(o.chamados_idade_media_h),
    esteira_estados: mapa(o.esteira_estados), esteira_sensiveis_esperando: zero(o.esteira_sensiveis_esperando),
    esteira_migrations_na_fila: zero(o.esteira_migrations_na_fila), main_vermelha_min: zero(o.main_vermelha_min),
    gerado_em: typeof o.gerado_em === 'string' ? o.gerado_em : null,
  }
}

/** Saldo = produzidas − publicadas na janela (positivo = a entrada supera a saída). */
export const saldo = (n: NumerosJanela) => n.prs_produzidas - n.prs_publicadas

export type Etapa = 'pedido' | 'constroi' | 'esteira' | 'publicacao' | 'auditor' | 'volta'
export const ETAPAS: { id: Etapa; nome: string; descricao: string }[] = [
  { id: 'pedido', nome: 'Pedido', descricao: 'Chamado do cliente, pacote do roadmap ou achado do auditor.' },
  { id: 'constroi', nome: 'Code constrói', descricao: 'O Code assume (trava no chamado) e abre a PR.' },
  { id: 'esteira', nome: 'Esteira', descricao: 'Checks, gates e, nas PRs sensíveis, o revisor.' },
  { id: 'publicacao', nome: 'Publicação', descricao: 'Via rápida ou rodada; lote de até 3 migrations.' },
  { id: 'auditor', nome: 'Code-Auditor', descricao: 'Pós-merge: Hub completo; nas outras verticais, checagem barata.' },
  { id: 'volta', nome: 'Volta', descricao: 'O achado vira chamado interno, o Code corrige e o auditor reaudita.' },
]

export type Metrica = { chave: string; rotulo: string; valor: string; semaforo: Semaforo; limite?: ChaveLimite; ajuda: string }
export type ResumoEtapa = { id: Etapa; nome: string; descricao: string; principal: Metrica; metricas: Metrica[]; semaforo: Semaforo }

const fmt = (v: number | null, dec = 0, un = '') => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: dec })}${un ? ' ' + un : ''}`)
export function fmtMin(v: number | null): string {
  if (v === null) return '—'
  if (v < 90) return `${Math.round(v)} min`
  if (v < 2880) return `${(v / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
  return `${(v / 1440).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
}
const m = (chave: string, rotulo: string, valor: string, sem: Semaforo, ajuda: string, limite?: ChaveLimite): Metrica => ({ chave, rotulo, valor, semaforo: sem, ajuda, limite })

/** Os seis resumos (um por caixa do fluxograma) para a janela escolhida. */
export function resumirEtapas(d: Desempenho, j: Janela): ResumoEtapa[] {
  const n = d[j]
  const sal = saldo(n)
  const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
  const vered = (k: string) => n.auditor_vereditos[k] ?? 0
  const porEtapa: Record<Etapa, Metrica[]> = {
    pedido: [
      m('abertos', 'Chamados de clientes abertos', fmt(d.chamados_abertos), 'sem_dado', 'Chamados novos ou em análise, sem os internos do auditor e sem robôs de teste.'),
      m('novos', 'Novos no período', fmt(n.chamados_novos), 'sem_dado', 'Chamados de clientes criados na janela escolhida.'),
      m('resp20', 'Respondidos em até 20 min', n.resp_20min_pct === null ? '—' : `${fmt(n.resp_20min_pct, 1)}%`, semaforo('resp_20min_pct', n.resp_20min_pct), 'Dos novos, quantos tiveram o primeiro movimento (assumido ou respondido) em até 20 minutos.', 'resp_20min_pct'),
      m('idade', 'Idade média dos abertos', d.chamados_idade_media_h === null ? '—' : fmtMin(d.chamados_idade_media_h * 60), semaforo('chamados_idade_media_h', d.chamados_idade_media_h), 'Há quanto tempo, em média, os chamados abertos esperam.', 'chamados_idade_media_h'),
    ],
    constroi: [
      m('produzidas', 'PRs produzidas', fmt(n.prs_produzidas), 'sem_dado', 'PRs abertas na janela (evento "aberta" de erp_dev_entrega).'),
      m('aberta_pronta', 'Tempo médio aberta → pronta', fmtMin(n.aberta_pronta_min), semaforo('aberta_pronta_min', n.aberta_pronta_min), 'Da abertura da PR até ela ficar pronta (Ready), nas que ficaram prontas na janela.', 'aberta_pronta_min'),
    ],
    esteira: [
      m('sensiveis', 'Sensíveis esperando o revisor', fmt(d.esteira_sensiveis_esperando), semaforo('esteira_sensiveis_esperando', d.esteira_sensiveis_esperando), 'PRs da via revisada esperando a autorização do revisor.', 'esteira_sensiveis_esperando'),
      m('migrations', 'Migrations na fila', fmt(d.esteira_migrations_na_fila), semaforo('esteira_migrations_na_fila', d.esteira_migrations_na_fila), 'PRs com migration ainda na rodada (a fila publica uma por vez; lote de até 3).', 'esteira_migrations_na_fila'),
      m('pronta_pub', 'Tempo médio pronta → publicada', fmtMin(n.pronta_publicada_min), semaforo('pronta_publicada_min', n.pronta_publicada_min), 'Da PR ficar pronta até a publicação, nas publicadas na janela.', 'pronta_publicada_min'),
      m('estados', 'PRs por estado', Object.entries(d.esteira_estados).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—', 'sem_dado', 'Retrato da tabela erp_esteira_pr_estado.'),
    ],
    publicacao: [
      m('por_hora', 'Publicadas por hora', n.publicadas_por_hora === null ? '—' : fmt(n.publicadas_por_hora, 2, '/h'), semaforo('publicadas_por_hora', n.publicadas_por_hora), 'PRs publicadas dividido pelas horas da janela. Meta do CEO: 4 por hora.', 'publicadas_por_hora'),
      m('saldo', 'Saldo produzidas − publicadas', `${sal > 0 ? '+' : ''}${sal}`, semaforo('saldo', sal), 'Positivo = a entrada supera a saída.', 'saldo'),
      m('main', 'Main vermelha', d.main_vermelha_min === 0 ? 'não' : fmtMin(d.main_vermelha_min), semaforo('main_vermelha_min', d.main_vermelha_min), 'Minutos do episódio atual de main vermelha (dentro do dia).', 'main_vermelha_min'),
    ],
    auditor: [
      m('telas', 'Telas auditadas', fmt(n.auditor_telas), 'sem_dado', 'Telas com auditoria nova na janela.'),
      m('vereditos', 'Vereditos', `OK ${vered('OURO') + vered('PRATA') + vered('OK')} · piorou ${vered('PIOROU')} · quebrou ${vered('QUEBRADO')} · não auditada ${vered('PENDENTE')}`, 'sem_dado', 'Vereditos gravados em gold_veredito_triplo. Bronze conta como OK abaixo do ouro; aparece em "Outros".'),
      m('outros', 'Outros vereditos', fmt(Math.max(0, total(n.auditor_vereditos) - vered('OURO') - vered('PRATA') - vered('OK') - vered('PIOROU') - vered('QUEBRADO') - vered('PENDENTE'))), 'sem_dado', 'Vereditos que não são OK, piorou, quebrou nem pendente (por exemplo, bronze).'),
      m('nota', 'Nota média do Hub', fmt(n.auditor_nota_hub, 1), semaforo('auditor_nota_hub', n.auditor_nota_hub), 'Média de score_evolucao_pct das telas do Hub analisadas na janela.', 'auditor_nota_hub'),
    ],
    volta: [
      m('abertos', 'Achados internos abertos', fmt(n.achados_abertos), semaforo('achados_abertos', n.achados_abertos), 'Chamados internos do auditor ainda não concluídos, criados na janela.', 'achados_abertos'),
      m('fechados', 'Achados fechados', fmt(n.achados_fechados), 'sem_dado', 'Chamados internos do auditor concluídos na janela.'),
      m('correcao', 'Tempo médio de correção', fmtMin(n.achado_correcao_min), semaforo('achado_correcao_min', n.achado_correcao_min), 'Da criação do achado até a conclusão, nos concluídos na janela.', 'achado_correcao_min'),
    ],
  }
  const principalDe: Record<Etapa, string> = { pedido: 'resp20', constroi: 'produzidas', esteira: 'sensiveis', publicacao: 'por_hora', auditor: 'telas', volta: 'abertos' }
  return ETAPAS.map(e => {
    const ms = porEtapa[e.id]
    return { ...e, metricas: ms, principal: ms.find(x => x.chave === principalDe[e.id]) ?? ms[0], semaforo: pior(ms.map(x => x.semaforo)) }
  })
}

// ---- Bloco 2: agentes ----
export type AgenteInfra = {
  agente: string; aciona: boolean; observacao: string
  cron_job: string | null; cron_agenda: string | null; cron_ativo: boolean | null
  iniciada_em: string | null; renovada_em: string | null
}
export function lerAgentes(d: unknown): AgenteInfra[] | null {
  const o = d as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || o.ok !== true || !Array.isArray(o.agentes)) return null
  const s = (x: unknown) => (typeof x === 'string' ? x : null)
  return o.agentes.filter(a => a && typeof a === 'object' && typeof (a as any).agente === 'string').map(a => {
    const r = a as Record<string, unknown>
    return {
      agente: r.agente as string, aciona: r.aciona === true, observacao: s(r.observacao) ?? '',
      cron_job: s(r.cron_job), cron_agenda: s(r.cron_agenda), cron_ativo: typeof r.cron_ativo === 'boolean' ? r.cron_ativo : null,
      iniciada_em: s(r.iniciada_em), renovada_em: s(r.renovada_em),
    }
  })
}

export const AGENTES_INFRA = ['gilberto-produto', 'gilberto-esteira', 'gilberto-chamados', 'jordana-code', 'rodrigo-code', 'gilberto-desenv', 'gilberto-revisor', 'eng-chefe-auto'] as const
/** Rótulo mostrado; o identificador interno nunca muda. */
export const NOME_AGENTE = (id: string) => (id === 'eng-chefe-auto' ? 'Code-Auditor' : id)

// Agenda de intervalo fixo (passo de 5 minutos) vira "a cada 5 min"; qualquer outra volta como veio.
export function legivelCron(agenda: string | null): string {
  if (!agenda) return 'por evento'
  const mm = /^\*\/(\d+) \* \* \* \*$/.exec(agenda.trim())
  if (mm) return `a cada ${mm[1]} min`
  return agenda
}

export type EstadoAgente = 'trabalhando' | 'esperando' | 'dormindo'
/** Trabalhando = sessão ativa (lease < 12 min); esperando = acionável com sessão nas últimas 24 h; dormindo = sem sessão em 24 h ou desligado. */
export function estadoAgente(a: AgenteInfra, agora: Date): EstadoAgente {
  const lease: Lease | undefined = a.iniciada_em && a.renovada_em ? { agente: a.agente, sessao_ref: null, iniciada_em: a.iniciada_em, renovada_em: a.renovada_em } : undefined
  const s = estadoSessao(lease, agora)
  if (s.ativa) return 'trabalhando'
  if (!a.aciona) return 'dormindo'
  if ('paradoDesde' in s && s.paradoDesde && agora.getTime() - s.paradoDesde.getTime() < 24 * 3600_000) return 'esperando'
  return 'dormindo'
}

/** Leis em destaque (CEO): fonte é a seção "ESTADO CONSOLIDADO" do documento vivo da vertical infraestrutura. */
export const LEIS: { id: string; titulo: string; texto: string }[] = [
  { id: 'rd97', titulo: 'RD-97', texto: 'Nenhuma mudança pode gerar instabilidade, perda de dado ou regressão na base dos clientes. Padrão aditivo, plano de volta em toda PR que toca banco, financeiro, fiscal ou autenticação.' },
  { id: 'autovigia', titulo: 'Quem constrói não se auto-vigia', texto: 'O Code que fez a PR não a autoriza: a vigilância é do revisor e do Code-Auditor.' },
  { id: 'delegacao', titulo: 'Delegação', texto: 'Cada Code age só dentro da sua carteira e das categorias delegadas; núcleo só com OK do CEO.' },
  { id: 'cofre', titulo: 'Cofre só do CEO', texto: 'Segredos e chaves são do CEO; nenhum agente os lê, grava ou repassa.' },
]

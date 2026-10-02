// Gate · Chamados em equipe T1+T2 (SPEC rev. 9, seções 1 e 2 — CEO 02/10). Sem rede.
// 1) Regras puras da fila (visões Meus / Todos / Sem dono e os botões da trava).
// 2) A migration mantém as travas que o CEO aprovou: um atendente por vez (gatilho em sugestoes e na conversa),
//    puxar com motivo + confirmação < 2 h (CEO sem confirmação), direcionar com motivo só por atendente/responsável/CEO,
//    carteira só pelo CEO, histórico só de inserção, expiração 24 h com aviso, robô só em DEMO, autoria por auth.uid().
// 3) A tela usa as funções da trava (nunca update direto de atendente_id) e o sino leva ao chamado.
import { readFileSync } from 'node:fs'
import { filtrarVisao, trava, puxarPedeConfirmacao, ehMeu, semDono, type ItemEquipe } from '../../src/lib/sugestoes/filaAtendimento'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

// ── 1. regras puras ──
const EU = 'eu', OUTRA = 'outra', DEMO = 'demo-co'
const demos = new Set([DEMO])
const it = (o: Partial<ItemEquipe>): ItemEquipe => ({ responsavel_id: null, atendente_id: null, interno: false, company_id: 'c1', ...o })
const rows = [
  it({ responsavel_id: EU }),                                 // da minha carteira
  it({ responsavel_id: OUTRA, atendente_id: EU }),            // puxado por mim
  it({ responsavel_id: OUTRA }),                              // da outra
  it({ responsavel_id: null }),                               // sem dono
  it({ responsavel_id: null, interno: true }),                // interno (não é "sem dono")
  it({ responsavel_id: null, company_id: DEMO }),             // demo (não é "sem dono")
]
ok(filtrarVisao(rows, 'meus', EU, demos).length === 2, 'Meus = minha carteira + o que estou atendendo')
ok(filtrarVisao(rows, 'todos', EU, demos).length === rows.length, 'Todos = toda a fila (a equipe vê tudo)')
ok(filtrarVisao(rows, 'todos', EU, demos, OUTRA).length === 2, 'Todos com filtro por responsável')
ok(filtrarVisao(rows, 'sem_dono', EU, demos).length === 1, 'Sem dono = empresa cliente sem responsável (fora interno e demo)')
ok(ehMeu(rows[1], EU) && !semDono(rows[4], demos) && !semDono(rows[5], demos), 'ehMeu / semDono')

const livre = trava(it({}), EU, false)
ok(livre.podeAssumir && !livre.podePuxar && !livre.podeLiberar, 'livre → Assumir')
const deOutra = trava(it({ atendente_id: OUTRA, responsavel_id: OUTRA }), EU, false)
ok(deOutra.podePuxar && !deOutra.podeAssumir && !deOutra.podeLiberar && !deOutra.podeDirecionar, 'com outra pessoa → só Puxar')
const meu = trava(it({ atendente_id: EU }), EU, false)
ok(meu.podeLiberar && meu.podeDirecionar && !meu.podePuxar, 'comigo → Liberar e Direcionar')
const ceo = trava(it({ atendente_id: OUTRA }), EU, true)
ok(ceo.podePuxar && ceo.podeLiberar && ceo.podeDirecionar, 'CEO → puxa, libera e direciona qualquer um')
const resp = trava(it({ atendente_id: OUTRA, responsavel_id: EU }), EU, false)
ok(resp.podeDirecionar, 'responsável da carteira direciona')
const agora = Date.parse('2026-10-02T12:00:00Z')
ok(puxarPedeConfirmacao('2026-10-02T11:45:00Z', false, agora), 'mexido há 15 min → pede confirmação')
ok(!puxarPedeConfirmacao('2026-10-02T09:00:00Z', false, agora), 'mexido há 3 h → não pede')
ok(!puxarPedeConfirmacao('2026-10-02T11:45:00Z', true, agora), 'CEO não precisa de confirmação')

// ── 2. migration ──
const mig = readFileSync('supabase/migrations/20261002150000_chamados_equipe_carteira_trava.sql', 'utf8')
const fn = (nome: string) => {
  const i = mig.indexOf(`FUNCTION public.${nome}(`)
  if (i < 0) return ''
  const fim = mig.indexOf('END $$', i)
  return mig.slice(i, fim < 0 ? undefined : fim + 6)
}
const guarda = fn('fn__sugestao_trava_guarda')
ok(/CREATE TRIGGER trg_sugestao_trava_guarda BEFORE UPDATE ON public\.sugestoes/.test(mig), 'gatilho de trava em sugestoes (vale para TODAS as funções e update direto)')
ok(/RAISE EXCEPTION 'Chamado #% em atendimento por/.test(guarda) && /ERRCODE = '42501'/.test(guarda), 'quem não é o atendente é recusado (42501) com o nome de quem está atendendo')
ok(/fn__chamado_ceo_pode\(\)/.test(guarda) && /v_uid = OLD\.user_id/.test(guarda), 'CEO passa; o autor do chamado passa')
ok(/CREATE TRIGGER trg_sugestao_mensagem_trava BEFORE INSERT ON public\.sugestao_mensagem/.test(mig), 'mensagem da equipe na conversa passa pela mesma trava')
const puxar = fn('fn_chamado_puxar')
ok(/motivo_obrigatorio/.test(puxar) && /v_min < 120/.test(puxar) && /precisa_confirmar/.test(puxar) && /NOT v_ceo/.test(puxar), 'puxar: motivo + confirmação < 2 h (CEO sem confirmação)')
ok(/fn__chamado_avisar\(p_id, s\.atendente_id/.test(puxar), 'puxar avisa quem estava atendendo')
const dir = fn('fn_chamado_direcionar')
ok(/motivo_obrigatorio/.test(dir) && /s\.atendente_id = v_uid OR s\.responsavel_id = v_uid OR public\.fn__chamado_ceo_pode\(\)/.test(dir), 'direcionar: motivo, só atendente/responsável/CEO')
ok(/so_ceo/.test(fn('fn_carteira_definir')) && /fn__chamado_ceo_pode\(\)/.test(fn('fn_carteira_definir')), 'carteira só pelo CEO')
ok(/BEFORE UPDATE OR DELETE ON public\.sugestao_atendimento_hist/.test(mig), 'histórico só de inserção (RD-30)')
const expira = fn('fn_chamados_trava_expirar')
ok(/interval '24 hours'/.test(expira) && /interval '20 hours'/.test(expira) && /'expirar'/.test(expira), 'trava expira em 24 h com aviso 4 h antes')
ok(/cron\.schedule\('chamados-trava-expirar-hora'/.test(mig), 'robô de hora em hora da expiração')
ok(/c\.is_demo\)\)/.test(fn('fn__chamado_pode_atuar')), 'robô (fora da equipe) só atua em empresa DEMO')
ok(/'Stephany', 'suporte'/.test(mig), 'Stephany na equipe (ver, assumir, puxar), sem carteira')
ok(!/p_user\b/.test(fn('fn_chamado_assumir') + puxar + dir + fn('fn_chamado_liberar')), 'quem age é auth.uid(), nunca um p_user do cliente')
ok(/'implantacao'/.test(mig) && /v_robo/.test(mig), 'implantação registrada no histórico (abertos com CEO/robô)')

// ── 3. tela ──
const tela = readFileSync('src/app/dashboard/atendimento/page.tsx', 'utf8')
for (const f of ['fn_chamado_assumir', 'fn_chamado_puxar', 'fn_chamado_liberar', 'fn_chamado_direcionar', 'fn_chamado_historico', 'fn_chamado_equipe_listar'])
  ok(tela.includes(`'${f}'`), `fila usa ${f}`)
ok(!/atendente_id\s*:/.test(tela.replace(/atendente_id: string \| null/g, '')), 'a tela nunca grava atendente_id direto')
ok(/visao-meus|visao-\$\{k\}/.test(tela) && /'sem_dono'/.test(tela), 'visões Meus / Todos / Sem dono na fila')
ok(readFileSync('src/components/layout/TopNav.tsx', 'utf8').includes("n.tipo === 'atendimento'"), 'sino leva ao chamado na fila')
ok(readFileSync('src/app/dashboard/admin/carteira/page.tsx', 'utf8').includes("'fn_carteira_definir'"), 'Administração › Carteira edita pela função do banco')

if (falhas) { console.error(`\ncheck-chamados-equipe: ${falhas} falha(s)`); process.exit(1) }
console.log('\nChamados em equipe T1+T2: ok')

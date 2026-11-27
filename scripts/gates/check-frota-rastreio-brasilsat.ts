// Gate (SPEC 27/11 PARTE E) — rastreamento de frota pelo rastreador (provider técnico `brasilsat`). Sem rede.
// Prova: (1) a assinatura md5(md5(senha)+time) e os conversores do protocolo; (2) a edge só lê a credencial pelo
// Cofre e não loga a senha; (3) a migration é aditiva (RLS, REVOKE anon, cadência e histórico parametrizados) e não
// toca a coleta existente (atak_conexao_config / erp_credencial / erp_sync_log); (4) a tela tem estado vazio e o
// playback atrás da flag.
import { readFileSync, readdirSync } from 'node:fs'
import {
  md5Hex, assinatura, converterDispositivos, converterPosicoes, converterPlayback, distanciaKm, mensagemErro, lotes,
  janelaDia, converterMileage, converterAlarmes, converterCercas, cercaDoPonto, derivarViagensParadas, type PontoRota,
} from '../../supabase/functions/frota-rastreio-sync/protocolo'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── (1) protocolo ──
ok(md5Hex('') === 'd41d8cd98f00b204e9800998ecf8427e', 'md5("") = vetor RFC 1321')
ok(md5Hex('abc') === '900150983cd24fb0d6963f7d28e17f72', 'md5("abc") = vetor RFC 1321')
ok(md5Hex('The quick brown fox jumps over the lazy dog') === '9e107d9d372bb6826bd81d3542a419d6', 'md5 de frase longa')
ok(md5Hex('a'.repeat(1000)).length === 32, 'md5 de entrada com vários blocos')
ok(assinatura('123456', 1700000000) === md5Hex('e10adc3949ba59abbe56e057f20f883e' + '1700000000'), 'signature = md5(md5(senha) + time)')

const disp = converterDispositivos([{ imei: '86123', devicename: 'Truck 01', platenumber: 'ABC1D23', devicetype: 'X3', activatedtime: 1700000000 }, { imei: '' }])
ok(disp.length === 1 && disp[0].placa === 'ABC1D23' && disp[0].ativado_em === '2023-11-14T22:13:20.000Z', 'device/list: converte e descarta sem imei')
const pos = converterPosicoes([
  { imei: '1', latitude: -27.1, longitude: -52.6, gpstime: 1700000000, speed: 60, accstatus: 1, todaymileage: 12500, mileage: -1 },
  { imei: '2', latitude: 0, longitude: 0, gpstime: 1700000000 },            // sem fixo
  { imei: '3', latitude: -27.1, longitude: -52.6, gpstime: 0 },             // sem hora
])
ok(pos.length === 1 && pos[0].ignicao === true && pos[0].velocidade_kmh === 60, 'track: converte e descarta sem fixo/sem hora')
ok(pos[0].km_hoje === 12.5 && pos[0].odometro === null, 'track: mileage/todaymileage vêm em METROS → km; -1 = sem dado')
const rota = converterPlayback('-52.6,-27.1,1700000000,50,90;-52.61,-27.11,1700000060,55,90;;lixo')
ok(rota.length === 2 && rota[1].t === 1700000060, 'playback: record "lng,lat,gpstime,speed,course;…"')
ok(distanciaKm([{ lat: -27, lng: -52 }, { lat: -28, lng: -52 }]) > 110 && distanciaKm([{ lat: -27, lng: -52 }, { lat: -28, lng: -52 }]) < 112, 'distância haversine ~111 km por grau')
ok(/Conectores/.test(mensagemErro(20001)) && !/\d{5}/.test(mensagemErro(99999)), 'erro da API vira texto do usuário (nunca código cru)')
ok(lotes([1, 2, 3, 4, 5], 2).length === 3, 'lotes de até 100 imeis')

// ── (2) edge ──
const fn = readFileSync('supabase/functions/frota-rastreio-sync/index.ts', 'utf8')
ok(/fn_credencial_ler/.test(fn) && /p_provider: "brasilsat"/.test(fn), 'edge lê a credencial pelo Cofre (fn_credencial_ler, provider brasilsat)')
ok(!/console\.(log|warn|error)\([^)]*senha/i.test(fn) && !/senha[^\n]*respond\(/.test(fn), 'edge não loga nem devolve a senha')
ok(/fn_frota_rastreio_acesso/.test(fn) && /somente_servico/.test(fn), 'edge: cron só com serviço; usuário só com acesso à empresa')
ok(/playback_habilitado/.test(fn), 'edge: rota histórica atrás da flag playback_habilitado')
const fnCodigo = fn.replace(/^\s*\/\/[^\n]*$/gm, '')
ok(!/atak_conexao_config|erp_sync_log/.test(fnCodigo) && !/from\("erp_credencial"\)/.test(fnCodigo), 'edge não toca a coleta existente')

// ── (3) migration ──
const mig = readdirSync('supabase/migrations').find((f) => /_frota_rastreio_brasilsat\.sql$/.test(f))
ok(!!mig, 'migration do rastreamento existe')
const sql = mig ? readFileSync(`supabase/migrations/${mig}`, 'utf8') : ''
const semComentario = sql.replace(/--[^\n]*/g, '')
for (const t of ['frota_rastreio_config', 'frota_rastreio_dispositivo', 'frota_rastreio_posicao'])
  ok(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`).test(sql), `RLS ligada em ${t}`)
ok(/REVOKE ALL ON public\.frota_rastreio_config, public\.frota_rastreio_dispositivo, public\.frota_rastreio_posicao FROM anon/.test(sql), 'REVOKE anon nas tabelas')
for (const f of ['fn_frota_rastreio_painel', 'fn_frota_brasilsat_status', 'fn_frota_rastreio_acesso', 'fn_frota_rastreio_dispatch', 'fn_frota_rastreio_empresas_devidas', 'fn_frota_rastreio_tem_credencial'])
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon`).test(sql), `REVOKE anon em ${f}`)
ok(/cadencia_min\s+integer NOT NULL DEFAULT 10/.test(sql), 'CADÊNCIA parametrizada (default provisório 10 min)')
ok(/playback_habilitado boolean NOT NULL DEFAULT false/.test(sql), 'HISTÓRICO desligado por padrão')
ok(!/(UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE)\s+public\.(atak_conexao_config|erp_credencial|erp_sync_log)\b/i.test(semComentario), 'migration não escreve na coleta existente')
ok(!/CREATE OR REPLACE FUNCTION public\.fn_(credencial|bi_temas|ponto)/.test(sql), 'migration não reescreve função existente')

// ── (4) tela ──
const tela = readFileSync('src/app/dashboard/inteligencia/logistica/page.tsx', 'utf8')
ok(/fn_frota_rastreio_painel/.test(tela), 'tela lê a porta fn_frota_rastreio_painel')
ok(/tem_credencial/.test(tela) && /\/dashboard\/conectores/.test(tela), 'sem credencial: estado vazio com o caminho para cadastrar')
ok(/playback_habilitado/.test(tela), 'tela: rota histórica só com a flag ligada')

// ── cópia diária, km oficial, alarmes, cercas, viagens/paradas (pacote Eng. Chefe 27/11) ──
const j = janelaDia('2026-11-26')
ok(new Date(j.ini * 1000).toISOString() === '2026-11-26T03:00:00.000Z' && j.fim - j.ini === 86400, 'janela do dia = 00h–24h de Brasília (minuto 0, exigido pelo mileage)')
ok(converterMileage([{ imei: '1', mileage: 412.34 }, { imei: '', mileage: 3 }])[0].km === 412.3, 'device/mileage: km oficial por imei')
const al = converterAlarmes('9', [{ alarmtype: 7, systemtime: 1700000000, gpstime: 1699999990, latitude: -27, longitude: -52, speed: 95, geofenceid: 0 }, { alarmtype: 99, systemtime: 1700000100 }])
ok(al.length === 2 && al[0].tipo_nome === 'Excesso de velocidade' && al[0].cerca_id === null && al[1].tipo_nome === 'Alarme 99', 'alarm/list2: tipo em português, sem cerca quando id 0')
const cer = converterCercas([{ id: '1', name: 'Planta', type: 2, parameter: '-52.6,-27.1,500' }, { id: '2', name: 'Fazenda', type: 3, parameter: '-52,-27;-52,-26;-51,-26;-51,-27' }, { id: '3', type: 3, parameter: '1,1' }])
ok(cer.length === 2 && cer[0].raio_m === 500 && cer[1].poligono?.length === 4, 'geofence/list: círculo "lng,lat,raio" e polígono "lng,lat;…"')
ok(cercaDoPonto({ lat: -27.101, lng: -52.6 }, cer) === 'Planta' && cercaDoPonto({ lat: -26.5, lng: -51.5 }, cer) === 'Fazenda' && cercaDoPonto({ lat: -30, lng: -50 }, cer) === null, 'ponto dentro de círculo e de polígono')
// dia sintético: parado 20 min na planta → anda ~11 km → para 3 min (semáforo) → anda → rastreador dorme 40 min (lacuna) → anda
const dia: PontoRota[] = []
let t = 1700000000
const push = (lat: number, lng: number, v: number) => { dia.push({ lat, lng, t, em: new Date(t * 1000).toISOString(), velocidade: v, curso: 0 }) }
for (let i = 0; i < 21; i++) { push(-27.1, -52.6, 0); t += 60 }                       // 20 min parado
for (let i = 1; i <= 10; i++) { push(-27.1 - i * 0.01, -52.6, 60); t += 60 }          // ~11 km
for (let i = 0; i < 4; i++) { push(-27.2, -52.6, 0); t += 60 }                         // 3 min (não é parada)
for (let i = 1; i <= 5; i++) { push(-27.2 - i * 0.01, -52.6, 60); t += 60 }
t += 40 * 60; push(-27.25, -52.6, 0); t += 60                                          // lacuna de 40 min no mesmo lugar
for (let i = 1; i <= 5; i++) { push(-27.25 - i * 0.01, -52.6, 60); t += 60 }
const dv = derivarViagensParadas(dia)
ok(dv.paradas.length === 2 && dv.paradas[0].duracao_min >= 20 && dv.paradas[1].duracao_min >= 40, 'paradas: ≥ 5 min contam (inclui lacuna do rastreador); semáforo de 3 min não')
ok(dv.viagens.length === 2 && dv.viagens[0].km > 16 && dv.viagens[0].velocidade_max === 60, 'viagens: trechos entre paradas, com km e velocidade máxima')
ok(derivarViagensParadas([]).viagens.length === 0, 'dia sem pontos: nada derivado')

const fnAj = readFileSync('supabase/functions/frota-rastreio-sync/index.ts', 'utf8')
ok(/fn_frota_rastreio_token_ler/.test(fnAj) && /fn_frota_rastreio_token_gravar/.test(fnAj), 'token único: guardado no Vault e reaproveitado')
ok(/modo === "diario"/.test(fnAj) && /\/api\/device\/mileage/.test(fnAj) && /\/api\/alarm\/list2/.test(fnAj) && /\/api\/geofence\/list/.test(fnAj), 'edge: cópia diária, km oficial, alarmes e cercas')
ok(!/\/api\/(command|geofence\/(add|edit|delete)|device\/alertsettings\/set|user\/)/.test(fnAj), 'edge: só leitura da plataforma (sem comando, bloqueio, cerca ou alarme escrito)')

const migAj = readdirSync('supabase/migrations').find((f) => /_frota_rastreio_ajustes\.sql$/.test(f))
const sqlAj = migAj ? readFileSync(`supabase/migrations/${migAj}`, 'utf8') : ''
ok(!!migAj, 'migration de ajustes existe')
ok(/fn_frota_placa_canonica/.test(sqlAj) && /chr\(65 \+ substr\(x, 5, 1\)::int\)/.test(sqlAj), 'placa antiga → Mercosul (5º caractere 0-9 → A-J)')
ok(/ind_fin_titulo_mv/.test(sqlAj) && /frota_custo_regra/.test(sqlAj) && /\^\(ADF\|ADS\)\$/.test(sqlAj), 'custo pelos títulos do ERP com regras editáveis, sem adiantamentos')
ok(/interval '90 days'/.test(sqlAj) && /frota-rastreio-diario/.test(sqlAj), 'bruto 90 dias + cron da cópia diária')
ok(/'frota_rastreio_vinculo','frota_rastreio_ponto','frota_km_dia','frota_viagem','frota_parada',\s*'frota_copia_dia','frota_alarme','frota_cerca','frota_custo_regra'/.test(sqlAj) && /REVOKE ALL ON public\.%I FROM anon, PUBLIC/.test(sqlAj), 'RLS + REVOKE anon em todas as tabelas novas')
ok(!/(UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE)\s+public\.(atak_conexao_config|erp_credencial|erp_sync_log|ind_fin_titulo_mv)\b/i.test(sqlAj.replace(/--[^\n]*/g, '')), 'ajustes não escrevem na coleta nem nos títulos')
ok(/fn_frota_rastreio_vincular/.test(tela) && /divergencias/.test(tela) && /custo_mes/.test(tela) && /log\.bi\.subconta/.test(tela), 'tela: divergências com confirmação, custo/km do ERP e dica da subconta')

if (falhas) { console.error(`\n${falhas} falha(s) — check-frota-rastreio-brasilsat`); process.exit(1) }
console.log('\ncheck-frota-rastreio-brasilsat OK')

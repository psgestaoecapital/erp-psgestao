// Gate — bloco "Diagnóstico da Esteira" na aba Codes (Eng. Chefe 20/10): regras do semáforo + ligações estáticas. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { classificarVaga, classificarVazao, classificarLeak, type VagaDiag, type Diagnostico } from '../../src/lib/dev/diagnosticoEsteira'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const v = (o: Partial<VagaDiag>): VagaDiag => ({ vaga: 0, ciclos_24h: 5, abertas: 0, ultimo_inicio: 'x', ultimo_fim: 'y', ultima_pr: 1, ultimo_motivo: null, ultimo_ciclo_s: 1320, mediana_ciclo_s: 1200, ciclos_curtos_24h: 0, ...o })

ok(classificarVaga(v({}), 0).sem === 'verde', 'ciclo 22 min → verde')
ok(classificarVaga(v({ ultimo_ciclo_s: 72 }), 0).sem === 'amarelo', 'ciclo 72 s → amarelo (abortando)')
ok(classificarVaga(v({ ultimo_ciclo_s: 72, ultimo_motivo: 'migration órfã RD-52' }), 0).causa === 'migration órfã RD-52', 'causa nomeada quando ruim')
ok(classificarVaga(v({}), 120).sem === 'vermelho', 'reserva presa > 90 min → vermelho')
const agora = new Date('2026-10-20T12:00:00Z')
const vz = (pub_1h: number) => classificarVazao({ pub_1h, pub_24h: 10, mediana_pronta_pub_min: 30, ultima_pub: '2026-10-20T11:48:00Z' }, agora)
ok(vz(4).sem === 'verde' && vz(2).sem === 'amarelo' && vz(0).sem === 'vermelho', 'vazão vs meta 4/h')
ok(vz(4).haMin === 12, 'há 12 min sem publicar')
const base = { presas: [], duplicadas: [] } as unknown as Diagnostico
ok(classificarLeak(base) === 'verde' && classificarLeak({ ...base, presas: [{ pr_numero: 1, vaga: 0, min: 100 }] }) === 'vermelho', 'leak: vazio verde, presa vermelho')

const comp = readFileSync('src/components/dev/DiagnosticoEsteira.tsx', 'utf8')
ok(comp.includes("rpc('fn_esteira_diagnostico')"), 'bloco lê fn_esteira_diagnostico')
ok(readFileSync('src/components/dev/PainelCodes.tsx', 'utf8').includes('<DiagnosticoEsteira />'), 'montado na aba Codes')
const mig = readdirSync('supabase/migrations').filter((f) => f.endsWith('esteira_diagnostico_aba_codes.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('')
ok(mig.includes('fn_dev_painel_pode_ver()') && mig.includes('REVOKE ALL ON FUNCTION public.fn_esteira_diagnostico() FROM PUBLIC, anon'), 'RPC com guarda e sem anon')
ok(['diag.vagas', 'diag.vazao', 'diag.leak', 'diag.fila'].every((c) => mig.includes(`'${c}'`) && comp.includes(`"${c}"`)), '"?" (RD-95) de cada bloco, chave no banco')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }

// Gate: o robô Gold audita rota do Hub (/dashboard/projetos, /dashboard/hub) na demo da Construtora Modelo,
// nunca na demo de Comércio (default geral), onde o Hub aparece vazio e o veredito sai errado.
import { readFileSync } from 'node:fs'
const src = readFileSync('src/app/api/gold/auditar-rota/route.ts', 'utf8')
const erros: string[] = []
if (!/EMPRESA_BOT_HUB\s*=\s*'b0700000-0000-4000-a000-000000000006'/.test(src)) erros.push('EMPRESA_BOT_HUB deve apontar para a Construtora Modelo (…0006)')
if (!/ehHub\s*=\s*rota\.startsWith\('\/dashboard\/projetos'\)/.test(src)) erros.push('ehHub deve cobrir /dashboard/projetos')
if (!/ehHub \? EMPRESA_BOT_HUB/.test(src)) erros.push('empresaAudit deve escolher EMPRESA_BOT_HUB para rota do Hub')
if (erros.length) { console.error('check-gold-robo-empresa-hub: FALHOU\n- ' + erros.join('\n- ')); process.exit(1) }
console.log('check-gold-robo-empresa-hub: ok')
// Login do robô em cliente à parte (senão o cliente de serviço vira `authenticated` e o insert da jornada dá permission denied).
{
  const e2: string[] = []
  if (!/authClient\.auth\.signInWithPassword\(/.test(src)) e2.push('signInWithPassword deve usar authClient, não o cliente de serviço')
  if (/\bsupabase\.auth\.signInWithPassword\(/.test(src)) e2.push('o cliente de serviço não pode fazer signInWithPassword')
  if (!/insErr/.test(src)) e2.push('o insert em gold_camada2_validacoes deve conferir o erro')
  if (e2.length) { console.error('check-gold-robo-empresa-hub: FALHOU\n- ' + e2.join('\n- ')); process.exit(1) }
}

'use client'

import React, { useState, useMemo, useCallback } from 'react'

type Cargo = 'ceo' | 'diretor' | 'gerente' | 'supervisor'
type Especie = 'suinos' | 'bovinos' | 'aves' | 'laticinios' | 'industrializados'

const C = {
  bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2',
  muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5',
  espresso: '#3D2314', teal: '#009688', purple: '#7E57C2', orange: '#FF9800',
}

// ═══════════════════════════════════════════════════════════
// 200+ KPIs ORGANIZED BY CROSS-FUNCTIONAL MATRIX
// ═══════════════════════════════════════════════════════════
interface KPI { id: string; nome: string; valor: number; unid: string; meta: number; area1: string; area2: string }

const MATRIZES = [
  { id: 'prod_custo', nome: 'Produtividade x Custo', a1: 'Producao', a2: 'Financeiro', cor: C.gold },
  { id: 'qual_rend', nome: 'Qualidade x Rendimento', a1: 'Qualidade', a2: 'Producao', cor: C.teal },
  { id: 'energ_vol', nome: 'Energia x Volume', a1: 'Utilidades', a2: 'Producao', cor: C.orange },
  { id: 'rh_prod', nome: 'RH x Producao', a1: 'RH', a2: 'Producao', cor: C.purple },
  { id: 'log_com', nome: 'Logistica x Comercial', a1: 'Logistica', a2: 'Comercial', cor: C.blue },
  { id: 'campo_ind', nome: 'Campo x Industria', a1: 'Campo', a2: 'Industria', cor: '#8BC34A' },
  { id: 'manut_oee', nome: 'Manutencao x OEE', a1: 'Manutencao', a2: 'Producao', cor: '#FF5722' },
  { id: 'amb_efic', nome: 'Ambiental x Eficiencia', a1: 'Ambiental', a2: 'Operacional', cor: '#00BCD4' },
  { id: 'seg_prod', nome: 'Seguranca x Producao', a1: 'Seguranca', a2: 'Producao', cor: '#F44336' },
  { id: 'fin_oper', nome: 'Financeiro x Operacional', a1: 'Financeiro', a2: 'Operacional', cor: C.gold },
]

function r(min: number, max: number, dec: number = 1): number {
  return parseFloat((min + Math.random() * (max - min)).toFixed(dec))
}

function generateAllKPIs(): KPI[] {
  const kpis: KPI[] = []
  let id = 0
  const add = (nome: string, valor: number, unid: string, meta: number, a1: string, a2: string) => {
    kpis.push({ id: 'k' + (id++), nome, valor, unid, meta, area1: a1, area2: a2 })
  }

  // PRODUCAO x CUSTO (25 KPIs)
  add('Custo/kg Produzido', r(4.5,9.2), 'R$/kg', 6.80, 'Producao', 'Financeiro')
  add('Custo/Cabeca Abatida', r(180,450), 'R$', 280, 'Producao', 'Financeiro')
  add('Custo MP/kg Produto', r(3.2,7.8), 'R$/kg', 5.50, 'Producao', 'Financeiro')
  add('Custo Conversao/kg', r(0.8,2.5), 'R$/kg', 1.50, 'Producao', 'Financeiro')
  add('Custo Embalagem/kg', r(0.15,0.65), 'R$/kg', 0.35, 'Producao', 'Financeiro')
  add('Custo MOD/kg', r(0.4,1.8), 'R$/kg', 0.95, 'Producao', 'Financeiro')
  add('Custo Overhead/kg', r(0.3,1.2), 'R$/kg', 0.60, 'Producao', 'Financeiro')
  add('Produtividade kg/Homem/Hora', r(25,85), 'kg/h/h', 55, 'Producao', 'Financeiro')
  add('Volume Producao Diario', r(50,350), 'ton', 200, 'Producao', 'Financeiro')
  add('Capacidade Utilizada', r(65,98), '%', 85, 'Producao', 'Financeiro')
  add('Cab/Hora Abate', r(80,320), 'cab/h', 200, 'Producao', 'Financeiro')
  add('Cab/Dia Abate', r(800,5000), 'cab', 3000, 'Producao', 'Financeiro')
  add('kg Produzido/Turno', r(15000,80000), 'kg', 45000, 'Producao', 'Financeiro')
  add('Custo Fixo/kg', r(0.5,2.0), 'R$/kg', 1.0, 'Producao', 'Financeiro')
  add('Custo Variavel/kg', r(3.5,7.0), 'R$/kg', 5.0, 'Producao', 'Financeiro')
  add('Break-Even Volume', r(60,180), 'ton/dia', 120, 'Producao', 'Financeiro')
  add('Margem Contribuicao/kg', r(0.8,4.5), 'R$/kg', 2.50, 'Producao', 'Financeiro')
  add('ROI Linha Producao', r(8,35), '%', 20, 'Producao', 'Financeiro')
  add('Payback Investimento', r(12,60), 'meses', 24, 'Producao', 'Financeiro')
  add('Custo Parada/Hora', r(2000,15000), 'R$/h', 5000, 'Producao', 'Financeiro')
  add('Perda Financeira Quebra', r(10000,150000), 'R$/mes', 50000, 'Producao', 'Financeiro')
  add('Custo Retrabalho/Mes', r(5000,80000), 'R$', 20000, 'Producao', 'Financeiro')
  add('Valor Agregado/kg', r(2,12), 'R$/kg', 6, 'Producao', 'Financeiro')
  add('Indice Valor Agregado', r(1.2,3.5), 'x', 2.0, 'Producao', 'Financeiro')
  add('Mix Produto Premium', r(15,55), '%', 35, 'Producao', 'Financeiro')

  // QUALIDADE x RENDIMENTO (25 KPIs)
  add('Rendimento Carcaca', r(48,58), '%', 52, 'Qualidade', 'Producao')
  add('Yield Desossa', r(38,54), '%', 46, 'Qualidade', 'Producao')
  add('Yield Cortes Nobres', r(18,32), '%', 25, 'Qualidade', 'Producao')
  add('Yield Industrializados', r(85,98), '%', 92, 'Qualidade', 'Producao')
  add('Quebra Total Processo', r(1.5,6.0), '%', 3.0, 'Qualidade', 'Producao')
  add('Quebra Desossa', r(0.8,3.5), '%', 1.8, 'Qualidade', 'Producao')
  add('Quebra Embalagem', r(0.3,2.0), '%', 0.8, 'Qualidade', 'Producao')
  add('Quebra Congelamento', r(0.5,3.0), '%', 1.2, 'Qualidade', 'Producao')
  add('PPM Defeitos', r(500,5000), 'ppm', 2000, 'Qualidade', 'Producao')
  add('Taxa Rejeicao CQ', r(0.5,5.0), '%', 2.0, 'Qualidade', 'Producao')
  add('NC SIF/Mes', r(0,8), 'un', 0, 'Qualidade', 'Producao')
  add('NC Clientes/Mes', r(0,15), 'un', 3, 'Qualidade', 'Producao')
  add('Indice Reclamacao', r(0.1,2.0), '%', 0.5, 'Qualidade', 'Producao')
  add('Temp Media Carcaca', r(-2,4), 'C', 0, 'Qualidade', 'Producao')
  add('Temp Tunel Cong.', r(-38,-25), 'C', -35, 'Qualidade', 'Producao')
  add('pH Medio 24h', r(5.4,6.2), 'pH', 5.8, 'Qualidade', 'Producao')
  add('Shelf Life Medio', r(20,120), 'dias', 60, 'Qualidade', 'Producao')
  add('Analises Micro OK', r(90,99.5), '%', 98, 'Qualidade', 'Producao')
  add('Swab Superficie OK', r(85,99), '%', 95, 'Qualidade', 'Producao')
  add('Audit Score GMP', r(70,98), '%', 90, 'Qualidade', 'Producao')
  add('APPCC Conformidade', r(88,100), '%', 95, 'Qualidade', 'Producao')
  add('Rastreabilidade', r(90,100), '%', 100, 'Qualidade', 'Producao')
  add('Recall Risk Score', r(0,25), 'pts', 5, 'Qualidade', 'Producao')
  add('Certificacoes Ativas', r(3,12), 'un', 8, 'Qualidade', 'Producao')
  add('Training Hours CQ', r(8,40), 'h/mes', 20, 'Qualidade', 'Producao')

  // ENERGIA x VOLUME (20 KPIs)
  add('kWh/ton Produzida', r(80,220), 'kWh/t', 130, 'Utilidades', 'Producao')
  add('kWh/Cabeca', r(8,35), 'kWh', 18, 'Utilidades', 'Producao')
  add('Custo Energia/kg', r(0.05,0.25), 'R$/kg', 0.12, 'Utilidades', 'Producao')
  add('Consumo Gas m3/ton', r(15,60), 'm3/t', 30, 'Utilidades', 'Producao')
  add('Vapor kg/ton Produto', r(200,600), 'kg/t', 350, 'Utilidades', 'Producao')
  add('Fator Potencia', r(0.85,0.98), 'FP', 0.92, 'Utilidades', 'Producao')
  add('Demanda Ponta', r(60,95), '%', 80, 'Utilidades', 'Producao')
  add('Eficiencia Caldeira', r(75,95), '%', 88, 'Utilidades', 'Producao')
  add('COP Refrigeracao', r(2.5,5.0), 'COP', 3.5, 'Utilidades', 'Producao')
  add('Agua m3/ton', r(5,20), 'm3/t', 10, 'Utilidades', 'Producao')
  add('Agua m3/Cabeca', r(0.3,1.5), 'm3', 0.7, 'Utilidades', 'Producao')
  add('Custo Agua/kg', r(0.01,0.08), 'R$/kg', 0.03, 'Utilidades', 'Producao')
  add('Reuso Agua', r(10,60), '%', 35, 'Utilidades', 'Producao')
  add('Efluente m3/ton', r(3,15), 'm3/t', 8, 'Utilidades', 'Producao')
  add('DBO Efluente', r(50,500), 'mg/L', 150, 'Utilidades', 'Producao')
  add('Custo Utilidades/kg', r(0.15,0.55), 'R$/kg', 0.30, 'Utilidades', 'Producao')
  add('Ar Comprimido m3/h', r(200,1200), 'm3/h', 600, 'Utilidades', 'Producao')
  add('Perda Termica', r(5,25), '%', 10, 'Utilidades', 'Producao')
  add('Peak Shaving Economia', r(5,30), '%', 15, 'Utilidades', 'Producao')
  add('Carbon Footprint kg CO2/ton', r(200,800), 'kgCO2/t', 400, 'Utilidades', 'Producao')

  // RH x PRODUCAO (20 KPIs)
  add('Headcount Producao', r(200,3000), 'col', 800, 'RH', 'Producao')
  add('Absenteismo', r(2,12), '%', 4, 'RH', 'Producao')
  add('Turnover Mensal', r(1,8), '%', 3, 'RH', 'Producao')
  add('Turnover Anual', r(15,80), '%', 35, 'RH', 'Producao')
  add('Custo Turnover/Mes', r(10000,200000), 'R$', 50000, 'RH', 'Producao')
  add('Hora Extra %', r(2,20), '%', 8, 'RH', 'Producao')
  add('Custo HE/Mes', r(20000,300000), 'R$', 80000, 'RH', 'Producao')
  add('Acidentes CAT', r(0,5), 'un/mes', 0, 'RH', 'Producao')
  add('Acidentes SPT', r(0,15), 'un/mes', 2, 'RH', 'Producao')
  add('Taxa Frequencia TF', r(2,25), 'TF', 8, 'RH', 'Producao')
  add('Taxa Gravidade TG', r(10,500), 'TG', 50, 'RH', 'Producao')
  add('Dias Perdidos Acidente', r(0,60), 'dias', 5, 'RH', 'Producao')
  add('NR Conformidade', r(75,100), '%', 95, 'RH', 'Producao')
  add('Treinamento h/col/mes', r(2,16), 'h', 8, 'RH', 'Producao')
  add('Polivalencia', r(1.2,3.0), 'idx', 2.0, 'RH', 'Producao')
  add('Clima Organizacional', r(55,90), 'pts', 75, 'RH', 'Producao')
  add('Custo Folha/kg', r(0.3,1.5), 'R$/kg', 0.70, 'RH', 'Producao')
  add('Produtividade R$/col', r(8000,35000), 'R$/col', 18000, 'RH', 'Producao')
  add('Afastamentos INSS', r(0,20), 'un', 5, 'RH', 'Producao')
  add('Ergonomia Score', r(50,95), 'pts', 80, 'RH', 'Producao')

  // LOGISTICA x COMERCIAL (20 KPIs)
  add('Frete/kg Expedido', r(0.08,0.45), 'R$/kg', 0.20, 'Logistica', 'Comercial')
  add('OTIF', r(80,99), '%', 95, 'Logistica', 'Comercial')
  add('Lead Time Pedido', r(1,7), 'dias', 2, 'Logistica', 'Comercial')
  add('Acuracidade Estoque', r(88,99.5), '%', 97, 'Logistica', 'Comercial')
  add('Giro Estoque', r(8,30), 'x/ano', 18, 'Logistica', 'Comercial')
  add('Dias Estoque', r(5,45), 'dias', 15, 'Logistica', 'Comercial')
  add('Estoque Obsoleto', r(0.5,5), '%', 1, 'Logistica', 'Comercial')
  add('Devolucao/Avaria', r(0.2,3), '%', 0.8, 'Logistica', 'Comercial')
  add('Custo Logistico Total', r(3,12), '%', 6, 'Logistica', 'Comercial')
  add('Ocupacao Cameras', r(60,98), '%', 85, 'Logistica', 'Comercial')
  add('Preco Medio/kg Venda', r(8,28), 'R$/kg', 16, 'Logistica', 'Comercial')
  add('Mix Merc. Interno', r(40,85), '%', 65, 'Logistica', 'Comercial')
  add('Mix Exportacao', r(15,60), '%', 35, 'Logistica', 'Comercial')
  add('Clientes Ativos', r(50,500), 'un', 200, 'Logistica', 'Comercial')
  add('Inadimplencia', r(0.5,8), '%', 2, 'Logistica', 'Comercial')
  add('Ticket Medio Pedido', r(2000,50000), 'R$', 15000, 'Logistica', 'Comercial')
  add('Pedidos/Dia', r(20,300), 'un', 100, 'Logistica', 'Comercial')
  add('Fill Rate', r(85,99), '%', 95, 'Logistica', 'Comercial')
  add('Custo Picking/Pedido', r(5,35), 'R$', 12, 'Logistica', 'Comercial')
  add('Cross-Docking %', r(10,60), '%', 30, 'Logistica', 'Comercial')

  // CAMPO x INDUSTRIA (20 KPIs)
  add('Preco Arroba/kg Vivo', r(4,16), 'R$/kg', 8, 'Campo', 'Industria')
  add('Peso Medio Chegada', r(80,550), 'kg', 120, 'Campo', 'Industria')
  add('Uniformidade Lote', r(70,95), '%', 85, 'Campo', 'Industria')
  add('Mortalidade Transporte', r(0.01,0.5), '%', 0.1, 'Campo', 'Industria')
  add('Condenacao Ante-Mortem', r(0.1,2.0), '%', 0.5, 'Campo', 'Industria')
  add('Condenacao Post-Mortem', r(0.5,5.0), '%', 1.5, 'Campo', 'Industria')
  add('Hematomas/Contusoes', r(1,15), '%', 3, 'Campo', 'Industria')
  add('Jejum Adequado', r(80,100), '%', 95, 'Campo', 'Industria')
  add('Distancia Media Granja', r(30,300), 'km', 100, 'Campo', 'Industria')
  add('Custo Frete Animal', r(0.05,0.30), 'R$/kg', 0.12, 'Campo', 'Industria')
  add('Integracao Produtores', r(50,500), 'un', 200, 'Campo', 'Industria')
  add('Conversao Alimentar', r(1.8,3.5), 'CA', 2.4, 'Campo', 'Industria')
  add('GPD Granja', r(0.5,1.2), 'kg/dia', 0.85, 'Campo', 'Industria')
  add('IEP (suinos)', r(130,160), 'dias', 142, 'Campo', 'Industria')
  add('Leitoes/Porca/Ano', r(22,32), 'un', 28, 'Campo', 'Industria')
  add('Custo Producao Campo', r(3,9), 'R$/kg', 5.5, 'Campo', 'Industria')
  add('Compliance Antibiotico', r(90,100), '%', 100, 'Campo', 'Industria')
  add('Bem-Estar Animal Score', r(60,100), 'pts', 85, 'Campo', 'Industria')
  add('Rastreabilidade Campo', r(80,100), '%', 100, 'Campo', 'Industria')
  add('Certificacao Granja', r(60,100), '%', 90, 'Campo', 'Industria')

  // MANUTENCAO x OEE (20 KPIs)
  add('OEE Global', r(65,95), '%', 85, 'Manutencao', 'Producao')
  add('Disponibilidade', r(80,99), '%', 95, 'Manutencao', 'Producao')
  add('Performance', r(78,98), '%', 92, 'Manutencao', 'Producao')
  add('Qualidade OEE', r(90,99.8), '%', 98, 'Manutencao', 'Producao')
  add('MTBF', r(20,200), 'horas', 80, 'Manutencao', 'Producao')
  add('MTTR', r(0.5,8), 'horas', 2, 'Manutencao', 'Producao')
  add('Backlog Manutencao', r(50,500), 'horas', 150, 'Manutencao', 'Producao')
  add('Preventiva/Total', r(40,85), '%', 70, 'Manutencao', 'Producao')
  add('Corretiva/Total', r(15,60), '%', 25, 'Manutencao', 'Producao')
  add('Custo Manut/kg', r(0.05,0.30), 'R$/kg', 0.12, 'Manutencao', 'Producao')
  add('Custo Manut/Faturamento', r(1,6), '%', 2.5, 'Manutencao', 'Producao')
  add('Paradas Nao-Programadas', r(2,40), 'h/mes', 10, 'Manutencao', 'Producao')
  add('Spare Parts Giro', r(2,12), 'x/ano', 6, 'Manutencao', 'Producao')
  add('Estoque Pecas Valor', r(50000,500000), 'R$', 150000, 'Manutencao', 'Producao')
  add('Ordens Servico/Mes', r(50,500), 'un', 200, 'Manutencao', 'Producao')
  add('OS Atrasadas', r(5,40), '%', 10, 'Manutencao', 'Producao')
  add('Confiabilidade', r(80,99), '%', 95, 'Manutencao', 'Producao')
  add('Preditiva %', r(5,40), '%', 20, 'Manutencao', 'Producao')
  add('Lubrificacao Compliance', r(75,100), '%', 95, 'Manutencao', 'Producao')
  add('Calibracao em Dia', r(80,100), '%', 100, 'Manutencao', 'Producao')

  // AMBIENTAL x EFICIENCIA (15 KPIs)
  add('Residuos kg/ton Prod', r(20,120), 'kg/t', 50, 'Ambiental', 'Operacional')
  add('Reciclagem %', r(30,85), '%', 60, 'Ambiental', 'Operacional')
  add('Subprodutos Aproveit.', r(60,98), '%', 90, 'Ambiental', 'Operacional')
  add('Farinha/Oleo Rendimento', r(20,45), '%', 35, 'Ambiental', 'Operacional')
  add('Receita Subprodutos', r(0.5,3.0), 'R$/kg', 1.5, 'Ambiental', 'Operacional')
  add('DQO Efluente', r(100,2000), 'mg/L', 500, 'Ambiental', 'Operacional')
  add('Lodo Gerado ton/mes', r(10,200), 'ton', 50, 'Ambiental', 'Operacional')
  add('Emissao GEE tCO2/ton', r(0.5,3.0), 'tCO2/t', 1.2, 'Ambiental', 'Operacional')
  add('Licenca Ambiental Score', r(70,100), '%', 90, 'Ambiental', 'Operacional')
  add('Multas Ambientais Ano', r(0,5), 'un', 0, 'Ambiental', 'Operacional')
  add('Biogas Aproveitamento', r(0,80), '%', 40, 'Ambiental', 'Operacional')
  add('ESG Score', r(40,90), 'pts', 70, 'Ambiental', 'Operacional')
  add('Selo Verde Compliance', r(60,100), '%', 85, 'Ambiental', 'Operacional')
  add('Eficiencia Graxaria', r(70,95), '%', 85, 'Ambiental', 'Operacional')
  add('Custo Ambiental/kg', r(0.02,0.15), 'R$/kg', 0.05, 'Ambiental', 'Operacional')

  // SEGURANCA x PRODUCAO (15 KPIs)
  add('Acidentes Totais/Mes', r(0,10), 'un', 0, 'Seguranca', 'Producao')
  add('Incidentes Reportados', r(5,50), 'un/mes', 20, 'Seguranca', 'Producao')
  add('Near Miss', r(10,80), 'un/mes', 40, 'Seguranca', 'Producao')
  add('Dias Sem Acidente', r(5,365), 'dias', 180, 'Seguranca', 'Producao')
  add('EPI Conformidade', r(80,100), '%', 98, 'Seguranca', 'Producao')
  add('CIPA Reunioes', r(60,100), '%', 100, 'Seguranca', 'Producao')
  add('Insalubridade %', r(10,50), '%', 25, 'Seguranca', 'Producao')
  add('Custo Acidente/Mes', r(0,100000), 'R$', 10000, 'Seguranca', 'Producao')
  add('DDS Realizados', r(60,100), '%', 95, 'Seguranca', 'Producao')
  add('Ergonomia AET Score', r(50,95), 'pts', 80, 'Seguranca', 'Producao')
  add('Ruido dB Medio', r(75,100), 'dB', 82, 'Seguranca', 'Producao')
  add('Temperatura Ambiente', r(5,35), 'C', 18, 'Seguranca', 'Producao')
  add('LTIR', r(0,5), 'idx', 1, 'Seguranca', 'Producao')
  add('Afastamento Doenca %', r(1,10), '%', 3, 'Seguranca', 'Producao')
  add('Brigada Treinada', r(70,100), '%', 95, 'Seguranca', 'Producao')

  // FINANCEIRO x OPERACIONAL (20 KPIs)
  add('Faturamento Bruto/Mes', r(5,50), 'M R$', 20, 'Financeiro', 'Operacional')
  add('EBITDA %', r(5,22), '%', 15, 'Financeiro', 'Operacional')
  add('Margem Bruta', r(12,35), '%', 22, 'Financeiro', 'Operacional')
  add('Margem Liquida', r(2,15), '%', 8, 'Financeiro', 'Operacional')
  add('ROA', r(3,20), '%', 12, 'Financeiro', 'Operacional')
  add('ROIC', r(8,30), '%', 18, 'Financeiro', 'Operacional')
  add('Capital de Giro Dias', r(15,60), 'dias', 30, 'Financeiro', 'Operacional')
  add('Ciclo Financeiro', r(10,50), 'dias', 25, 'Financeiro', 'Operacional')
  add('PMR', r(15,45), 'dias', 25, 'Financeiro', 'Operacional')
  add('PMP', r(20,60), 'dias', 35, 'Financeiro', 'Operacional')
  add('CAPEX/Faturamento', r(2,12), '%', 5, 'Financeiro', 'Operacional')
  add('Endividamento/EBITDA', r(0.5,4.0), 'x', 2.0, 'Financeiro', 'Operacional')
  add('Receita/Colaborador', r(15000,80000), 'R$/col', 35000, 'Financeiro', 'Operacional')
  add('Custo Total/Receita', r(75,95), '%', 85, 'Financeiro', 'Operacional')
  add('Ponto Equilibrio', r(50,85), '%', 65, 'Financeiro', 'Operacional')
  add('Preco Medio Export', r(3,12), 'US$/kg', 6, 'Financeiro', 'Operacional')
  add('Variacao Cambial Impact', r(-5,5), '%', 0, 'Financeiro', 'Operacional')
  add('Hedge %', r(20,80), '%', 50, 'Financeiro', 'Operacional')
  add('EVA/Mes', r(-500000,2000000), 'R$', 500000, 'Financeiro', 'Operacional')
  add('Market Share Regional', r(5,35), '%', 18, 'Financeiro', 'Operacional')

  return kpis
}

const CARGOS: Record<Cargo, string> = {
  ceo: 'CEO / Presidente',
  diretor: 'Diretor Industrial',
  gerente: 'Gerente de Planta',
  supervisor: 'Supervisor',
}

const ESPECIES: Record<Especie, { label: string; cor: string }> = {
  suinos: { label: 'Suinos', cor: '#E91E63' },
  bovinos: { label: 'Bovinos', cor: '#795548' },
  aves: { label: 'Aves', cor: '#FF9800' },
  laticinios: { label: 'Laticinios', cor: '#2196F3' },
  industrializados: { label: 'Industrializados', cor: '#9C27B0' },
}

export default function IndustrialPage() {
  const [cargo, setCargo] = useState<Cargo>('ceo')
  const [especie, setEspecie] = useState<Especie>('suinos')
  const [tab, setTab] = useState('matrizes')
  const [matrizSel, setMatrizSel] = useState(MATRIZES[0].id)
  const [aiResult, setAiResult] = useState<any>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [busca, setBusca] = useState('')

  const allKPIs = useMemo(() => generateAllKPIs(), [])

  const kpisFiltrados = useMemo(() => {
    let filtered = allKPIs
    const mat = MATRIZES.find(m => m.id === matrizSel)
    if (mat && tab === 'matrizes') {
      filtered = allKPIs.filter(k => k.area1 === mat.a1 || k.area2 === mat.a2 || (k.area1 === mat.a2 && k.area2 === mat.a1))
    }
    if (busca) {
      const s = busca.toLowerCase()
      filtered = filtered.filter(k => k.nome.toLowerCase().includes(s) || k.area1.toLowerCase().includes(s) || k.area2.toLowerCase().includes(s))
    }
    return filtered
  }, [allKPIs, matrizSel, tab, busca])

  const runAI = useCallback(async () => {
    setAiLoading(true)
    try {
      const sample = allKPIs.slice(0, 60).map(k => ({ nome: k.nome, valor: k.valor, unid: k.unid, meta: k.meta, areas: k.area1 + '/' + k.area2 }))
      const resp = await fetch('/api/industrial/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kpis: sample, especie, cargo }),
      })
      const data = await resp.json()
      setAiResult(data)
    } catch { setAiResult({ alertas: [], oportunidades: [], cruzamentos: [], error: 'Erro de conexao' }) }
    setAiLoading(false)
  }, [allKPIs, especie, cargo])

  const statusColor = (k: KPI) => {
    if (k.unid === '%' || k.unid === 'pts' || k.unid === 'idx') {
      return k.valor >= k.meta * 0.95 ? C.green : k.valor >= k.meta * 0.8 ? C.yellow : C.red
    }
    if (k.nome.toLowerCase().includes('custo') || k.nome.toLowerCase().includes('quebra') || k.nome.toLowerCase().includes('acidente')) {
      return k.valor <= k.meta * 1.05 ? C.green : k.valor <= k.meta * 1.2 ? C.yellow : C.red
    }
    return k.valor >= k.meta * 0.9 ? C.green : k.valor >= k.meta * 0.7 ? C.yellow : C.red
  }

  const fmtVal = (k: KPI) => {
    if (k.unid === 'R$' || k.unid === 'R$/kg' || k.unid === 'R$/h' || k.unid === 'R$/col' || k.unid === 'M R$') {
      return k.valor >= 1000000 ? 'R$ ' + (k.valor/1000000).toFixed(1) + 'M' : k.valor >= 1000 ? 'R$ ' + (k.valor/1000).toFixed(1) + 'K' : 'R$ ' + k.valor.toFixed(2)
    }
    return k.valor % 1 === 0 ? String(k.valor) : k.valor.toFixed(k.valor < 1 ? 2 : 1)
  }

  const alertCount = allKPIs.filter(k => statusColor(k) === C.red).length
  const warnCount = allKPIs.filter(k => statusColor(k) === C.yellow).length
  const okCount = allKPIs.filter(k => statusColor(k) === C.green).length

  const tabSt = (t: string): React.CSSProperties => ({
    padding: '9px 16px', cursor: 'pointer', border: 'none', fontWeight: 600, fontSize: 11,
    background: tab === t ? C.gold : 'transparent', color: tab === t ? C.espresso : C.muted,
    borderRadius: '8px 8px 0 0',
  })

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      {/* HEADER */}
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.gold, margin: 0 }}>Industrial</h1>
        <div style={{ fontSize: 10, color: C.muted }}>200+ KPIs | Cruzamento entre Areas | Analise IA | Campo ao Comercial</div>
      </div>

      {/* SELECTORS */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {(Object.keys(CARGOS) as Cargo[]).map(c => (
          <button key={c} onClick={() => setCargo(c)} style={{
            padding: '6px 12px', borderRadius: 6, border: 'none', fontSize: 11, cursor: 'pointer', fontWeight: 600,
            background: cargo === c ? C.gold : C.card, color: cargo === c ? C.espresso : C.muted,
          }}>{CARGOS[c]}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {(Object.keys(ESPECIES) as Especie[]).map(e => (
          <button key={e} onClick={() => setEspecie(e)} style={{
            padding: '5px 12px', borderRadius: 16, fontSize: 10, cursor: 'pointer', fontWeight: 600,
            border: especie === e ? '2px solid ' + ESPECIES[e].cor : '2px solid ' + C.border,
            background: especie === e ? ESPECIES[e].cor + '20' : 'transparent',
            color: especie === e ? ESPECIES[e].cor : C.muted,
          }}>{ESPECIES[e].label}</button>
        ))}
        <span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>
          {allKPIs.length} KPIs | {alertCount} criticos | {warnCount} atencao | {okCount} OK
        </span>
      </div>

      {/* SUMMARY BAR */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Criticos', val: alertCount, color: C.red },
          { label: 'Atencao', val: warnCount, color: C.yellow },
          { label: 'OK', val: okCount, color: C.green },
          { label: 'Total KPIs', val: allKPIs.length, color: C.gold },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, background: C.card, borderRadius: 8, padding: '10px 12px', borderTop: '3px solid ' + s.color, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 9, color: C.muted }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid ' + C.border }}>
        <button style={tabSt('matrizes')} onClick={() => setTab('matrizes')}>Matrizes Cruzadas</button>
        <button style={tabSt('todos')} onClick={() => setTab('todos')}>Todos KPIs</button>
        <button style={tabSt('ia')} onClick={() => { setTab('ia'); if (!aiResult) runAI() }}>Analise IA</button>
      </div>

      {/* TAB: MATRIZES */}
      {tab === 'matrizes' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {MATRIZES.map(m => {
              const mKpis = allKPIs.filter(k => k.area1 === m.a1 || k.area2 === m.a2)
              const crits = mKpis.filter(k => statusColor(k) === C.red).length
              return (
                <button key={m.id} onClick={() => setMatrizSel(m.id)} style={{
                  padding: '8px 12px', borderRadius: 8, border: matrizSel === m.id ? '2px solid ' + m.cor : '1px solid ' + C.border,
                  background: matrizSel === m.id ? m.cor + '15' : C.bg, cursor: 'pointer', textAlign: 'left',
                  color: C.text, minWidth: 140,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: m.cor }}>{m.nome}</div>
                  <div style={{ fontSize: 9, color: C.muted }}>{mKpis.length} KPIs {crits > 0 ? '| ' + crits + ' crit' : ''}</div>
                </button>
              )
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {kpisFiltrados.map(k => (
              <div key={k.id} style={{ background: C.bg, borderRadius: 6, padding: 10, borderLeft: '3px solid ' + statusColor(k) }}>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 2 }}>{k.area1} x {k.area2}</div>
                <div style={{ fontSize: 10, color: C.text, fontWeight: 500, marginBottom: 4 }}>{k.nome}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: statusColor(k) }}>{fmtVal(k)}</span>
                  <span style={{ fontSize: 9, color: C.muted }}>{k.unid}</span>
                </div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>Meta: {k.meta} {k.unid}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: TODOS */}
      {tab === 'todos' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar KPI..."
            style={{ width: '100%', padding: '8px 12px', background: C.bg, border: '1px solid ' + C.border, color: C.text, borderRadius: 6, fontSize: 12, marginBottom: 12 }} />
          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: C.card }}>{['', 'KPI', 'Valor', 'Meta', 'Unid', 'Areas'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: C.gold, fontWeight: 600, fontSize: 10 }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {kpisFiltrados.map(k => (
                  <tr key={k.id} style={{ borderBottom: '1px solid ' + C.border }}>
                    <td style={{ padding: '4px 8px', width: 8 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(k) }} /></td>
                    <td style={{ padding: '4px 8px', fontWeight: 500 }}>{k.nome}</td>
                    <td style={{ padding: '4px 8px', fontWeight: 700, color: statusColor(k) }}>{fmtVal(k)}</td>
                    <td style={{ padding: '4px 8px', color: C.muted }}>{k.meta}</td>
                    <td style={{ padding: '4px 8px', color: C.muted, fontSize: 10 }}>{k.unid}</td>
                    <td style={{ padding: '4px 8px', fontSize: 9, color: C.muted }}>{k.area1} x {k.area2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>{kpisFiltrados.length} KPIs exibidos</div>
        </div>
      )}

      {/* TAB: IA */}
      {tab === 'ia' && (
        <div style={{ background: C.card, borderRadius: '0 8px 8px 8px', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, color: C.gold, fontSize: 14 }}>Analise IA — Cruzamento Inteligente</div>
            <button onClick={runAI} disabled={aiLoading} style={{
              background: C.gold, color: C.espresso, border: 'none', padding: '8px 16px', borderRadius: 6,
              fontWeight: 700, cursor: 'pointer', fontSize: 11, opacity: aiLoading ? 0.5 : 1,
            }}>{aiLoading ? 'Analisando...' : 'Reanalisar'}</button>
          </div>

          {aiLoading && <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Analisando {allKPIs.length} KPIs com IA...</div>}

          {aiResult && !aiLoading && (
            <div>
              {/* Alertas */}
              {aiResult.alertas?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.red, marginBottom: 8 }}>Alertas Criticos</div>
                  {aiResult.alertas.map((a: any, i: number) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 8, padding: 12, marginBottom: 6, borderLeft: '3px solid ' + C.red }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{a.icone} {a.titulo}</div>
                      <div style={{ fontSize: 11, color: C.muted, margin: '4px 0' }}>{a.desc}</div>
                      <div style={{ fontSize: 11, color: C.gold, fontWeight: 600 }}>Acao: {a.acao}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Oportunidades */}
              {aiResult.oportunidades?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>Oportunidades</div>
                  {aiResult.oportunidades.map((o: any, i: number) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 8, padding: 12, marginBottom: 6, borderLeft: '3px solid ' + C.green }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{o.icone} {o.titulo}</div>
                      <div style={{ fontSize: 11, color: C.muted, margin: '4px 0' }}>{o.desc}</div>
                      <div style={{ fontSize: 11, color: C.gold, fontWeight: 600 }}>Acao: {o.acao}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Cruzamentos */}
              {aiResult.cruzamentos?.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 8 }}>Cruzamentos Inteligentes</div>
                  {aiResult.cruzamentos.map((c: any, i: number) => (
                    <div key={i} style={{ background: C.bg, borderRadius: 8, padding: 12, marginBottom: 6, borderLeft: '3px solid ' + C.blue }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: C.blue }}>{c.titulo}</div>
                      <div style={{ fontSize: 11, color: C.muted, margin: '4px 0' }}>{c.desc}</div>
                      <div style={{ fontSize: 11, color: C.orange, fontWeight: 600 }}>Impacto: {c.impacto}</div>
                    </div>
                  ))}
                </div>
              )}

              {aiResult.error && <div style={{ color: C.red, fontSize: 12 }}>Erro: {aiResult.error}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
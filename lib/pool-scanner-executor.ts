// lib/pool-scanner-executor.ts
// Módulo separado que varre pools reais via Pool Finder → analisa → injeta no Pregão

import { getTopPools, type PoolInfo } from './pool-finder'
import type { OkSignal } from './pregão'

type PregãoRef = {
  receberOK: (signal: OkSignal) => void
  adicionarLog: (msg: string) => void
}

export class PoolScannerExecutor {
  private intervalo: ReturnType<typeof setInterval> | null = null
  private pregao: PregãoRef | null = null
  private ultimaVarredura = 0
  private lastPools: PoolInfo[] = []

  connect(pregao: PregãoRef) {
    this.pregao = pregao
  }

  start() {
    if (!this.pregao) {
      console.warn('[PoolScanner] Pregão não conectado — chamar connect() primeiro')
      return
    }
    console.log('[PoolScanner] Iniciando varredura de pools a cada 5min...')
    this.varrer()
    this.intervalo = setInterval(() => this.varrer(), 5 * 60 * 1000)
  }

  stop() {
    if (this.intervalo) {
      clearInterval(this.intervalo)
      this.intervalo = null
    }
  }

  getLastPools() { return this.lastPools }

  private async varrer() {
    const agora = Date.now()
    if (agora - this.ultimaVarredura < 60_000) return // rate limit 1min
    this.ultimaVarredura = agora

    try {
      const pools = await getTopPools('polygon')
      this.lastPools = pools

      const oportunidades = pools
        .filter((p: PoolInfo) => p.score >= 40)
        .slice(0, 3)

      if (oportunidades.length === 0) return

      for (const pool of oportunidades) {
        const desvio = Math.abs(pool.priceChange1h)
        if (desvio < 0.1) {
          const lucroPotencial = pool.volumeUSD24h * 0.00001
          if (lucroPotencial > 0.01) {
            this.pregao?.adicionarLog(
              `[PoolScanner] ✓ ${pool.token0}/${pool.token1} score=${pool.score} lucro est. $${lucroPotencial.toFixed(4)}`,
            )
            this.pregao?.receberOK({
              pregueiro: `PoolScanner:${pool.dex ?? 'unknown'}`,
              par: `${pool.token0}→${pool.token1}`,
              fromToken: pool.token0,
              toToken: pool.token1,
              rede: 'polygon',
              confianca: Math.min(90, pool.score),
              timestamp: Date.now(),
              poolAddress: pool.address,
              dex: pool.dex,
            })
          }
        }
      }
    } catch (e) {
      console.warn('[PoolScanner] Varredura falhou:', e)
    }
  }
}

export const poolScannerExecutor = new PoolScannerExecutor()

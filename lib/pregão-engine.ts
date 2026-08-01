// RI-BANK-8 Stage 3 — lib/pregão-engine.ts
//
// Extracts the trading cycle (alternarCiclo/runCycle) out of
// PregãoDashboard.tsx into a standalone singleton, following the same
// pattern already used by `modoGrao`
// (examples/trading/strategies/modo-grão.ts): a class instance that owns
// its own start/stop loop, independent of any React component's mount
// lifecycle, exposing getState()/onChange()/onLog() for whoever wants to
// observe it.
//
// WHY THIS EXISTS: RI-UX-2 Stage 1 found that today's cycle (still living
// as cicloRef/cicloAtivo inside PregãoDashboard.tsx) dies the moment the
// component unmounts — which happens on every tab switch away from
// Operator/Ledger/Debug, not just when the user clicks "Parar". RI-BANK-8
// Stage 2 proved this with an automated test
// (lib/security/ri-bank-8-stage2-cycle-unmount-bug.test.ts). This module
// is the fix: once started, it keeps running regardless of which UI tab
// is selected or which component is mounted.
//
// SCOPE OF THIS FILE (RI-BANK-8 Stage 3): create the engine only.
// PregãoDashboard.tsx is NOT modified and does NOT import this file yet —
// that migration is RI-BANK-8 Stage 5. Until then, this module exists in
// the repository but is not wired into the running app at all.
//
// TWO DELIBERATE DIFFERENCES FROM THE CODE THIS WAS EXTRACTED FROM:
//
// 1. [D4 network-capture bug, fixed here] The original runCycle closed
//    over `agenteRede` — the network captured at the moment
//    alternarCiclo() started — and used it for executarCicloAgentes(),
//    while everything else in the component read the always-current
//    `redeRef.current`. Switching networks mid-run therefore behaved
//    inconsistently. This engine has no such split: every cycle iteration
//    re-reads `this._rede` (kept current via setRede()) for every call,
//    with no captured closure value anywhere.
//
// 2. [New: mainnet confirmation gate] The original code had exactly one
//    gate before real trading: NEXT auto-cycle effect
//    (PregãoDashboard.tsx:100-123) only checked
//    localStorage["arcflow_auto_ciclo"] — the same flag for testnet and
//    mainnet alike. This engine requires a SEPARATE, explicit
//    `confirmMainnet: true` argument to start() whenever the resolved
//    network is not a testnet. This is new safety behavior, not present
//    in the code being replaced — it does not relax anything that existed
//    before; it is strictly more restrictive. Same fail-closed spirit as
//    ADMIN_PANIC_KEY having no fallback (RI-BANK-4) and the panic route
//    rejecting unauthenticated POSTs (RI-BANK-7). The gate is re-checked
//    on every single cycle (see runOneCycle below), not just at start() —
//    if the network changes from testnet to mainnet while the loop is
//    already running unconfirmed, the engine stops itself instead of
//    silently trading on mainnet without consent.
//
// WHAT WAS DELIBERATELY LEFT OUT (documented, not an oversight):
//
// - `cicloVisRef` (PregãoDashboard.tsx:302, 310-313): confirmed dead code
//   in RI-BANK-8 Stage 1 D1 (declared, read, cleared, but never assigned
//   anywhere in the file). Not carried over.
// - `atualizarTudo()` (PregãoDashboard.tsx:296-300, called at D1 items 17
//   and 27): calls React setState (setOrdens/setStatus/setCashBox) — that
//   is UI-layer glue, not engine behavior, and belongs in the component
//   during Stage 5. The engine instead calls `this.notify()` after every
//   cycle so any future subscriber (the component, in Stage 5) knows a
//   cycle just completed; the component can react by calling its own
//   atualizarTudo() at that point, or — simpler — keep relying on
//   `pregão`'s own onOrdem/onCashBoxChange events exactly as it does
//   today, since those are unrelated to this engine and unaffected by
//   this extraction.
//
// BEHAVIOR DIFFERENCE FROM setInterval, INTENTIONAL (per Stage 3 mandate:
// follow the modoGrao while/sleep pattern instead of setInterval):
// stopping is not instantaneous. `stop()` flips a flag; the currently
// in-flight cycle (if any) finishes, and the loop notices the flag is
// false on its next check before sleeping again — worst case, one full
// cicloIntervaloSegundos of delay between stop() and the loop actually
// exiting. The original setInterval-based code stopped immediately
// (clearInterval cancels a pending timer synchronously). This is the same
// trade-off modoGrao already accepts. Flagging it explicitly because it
// is a real, user-visible behavior change once Stage 5 wires the UI to
// this engine — not something to silently inherit.

import { NETWORKS, type NetworkKey } from "@/lib/real-swap-executor"
import { pregão } from "@/lib/pregão"
import { resumeFromPanic, setTestnetMode } from "@/lib/circuit-breaker"
import { poolScannerExecutor } from "@/lib/pool-scanner-executor"

export interface PregãoEngineState {
  ativo: boolean
  rede: string
  cicloIntervaloSegundos: number
  ultimoCicloEm: number | null
  ultimoErro: string | null
  mainnetConfirmado: boolean
}

export type StartResult =
  | { started: true }
  | { started: false; reason: "already_active" }
  | { started: false; reason: "mainnet_confirmation_required" }

function resolveIsTestnet(rede: string): boolean {
  const net = NETWORKS[rede as NetworkKey]
  // Mirrors PregãoDashboard.tsx:325 — unknown/unconfigured network
  // defaults to treating it AS testnet (fail toward the safer, more
  // restricted mode), same default the original code already used.
  return net?.isTestnet ?? true
}

class PregãoEngine {
  private _ativo = false
  private _rede = ""
  private _cicloIntervaloSegundos = 10
  private _ultimoCicloEm: number | null = null
  private _ultimoErro: string | null = null
  private _mainnetConfirmado = false

  private listeners: Array<() => void> = []
  private logListeners: Array<(msg: string) => void> = []

  // ── Observação (mesmo padrão de pregão.onLog / modoGrao.onChange) ──────

  getState(): PregãoEngineState {
    return {
      ativo: this._ativo,
      rede: this._rede,
      cicloIntervaloSegundos: this._cicloIntervaloSegundos,
      ultimoCicloEm: this._ultimoCicloEm,
      ultimoErro: this._ultimoErro,
      mainnetConfirmado: this._mainnetConfirmado,
    }
  }

  onChange(cb: () => void): () => void {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter(c => c !== cb) }
  }

  onLog(cb: (msg: string) => void): () => void {
    this.logListeners.push(cb)
    return () => { this.logListeners = this.logListeners.filter(c => c !== cb) }
  }

  private notify(): void {
    for (const cb of this.listeners) cb()
  }

  private log(msg: string): void {
    for (const cb of this.logListeners) cb(msg)
  }

  // ── Configuração (chamado pelo consumidor sempre que o contexto muda —
  //    ex.: o usuário troca de rede na UI, mesmo com o ciclo já rodando) ──

  setRede(rede: string): void {
    this._rede = rede
    this.notify()
  }

  setCicloIntervalo(segundos: number): void {
    this._cicloIntervaloSegundos = segundos
    this.notify()
  }

  // ── Start/stop ───────────────────────────────────────────────────────

  start(opts?: { confirmMainnet?: boolean }): StartResult {
    if (this._ativo) return { started: false, reason: "already_active" }

    const isTestnet = resolveIsTestnet(this._rede)
    if (!isTestnet && opts?.confirmMainnet !== true) {
      // [Mainnet gate] Fail-closed: recusa iniciar em mainnet sem
      // confirmação explícita, separada da flag geral de auto-início.
      return { started: false, reason: "mainnet_confirmation_required" }
    }
    this._mainnetConfirmado = !isTestnet ? true : opts?.confirmMainnet === true

    // D1 items 7-9
    this._ativo = true
    const agenteRede = this._rede
    pregão.setRedeAtiva(agenteRede)

    // Kick off the async setup + loop without blocking start()'s caller —
    // mirrors alternarCiclo() being an async function fired from an
    // onClick without being awaited by the render itself.
    void this.armar()

    this.notify()
    return { started: true }
  }

  stop(): void {
    // D1 items 1, 3-6 (item 2, cicloVisRef, is confirmed dead code —
    // see file header — not carried over)
    this._ativo = false
    poolScannerExecutor.stop()
    const isTestnet = resolveIsTestnet(this._rede)
    if (isTestnet) {
      import("@/lib/pregao-arc").then(m => m.parar()).catch(e =>
        this.log(`⚠️ Erro ao parar pregao-arc: ${e instanceof Error ? e.message : e}`)
      )
    }
    this.log("⏹️ Ciclo dos Pregueiros parado")
    this.notify()
  }

  toggle(opts?: { confirmMainnet?: boolean }): StartResult | { started: false; reason: "stopped" } {
    if (this._ativo) {
      this.stop()
      return { started: false, reason: "stopped" }
    }
    return this.start(opts)
  }

  // ── Setup (D1 items 10-18, minus a UI-only atualizarTudo() call — see
  //    file header) ────────────────────────────────────────────────────

  private async armar(): Promise<void> {
    const isTestnet = resolveIsTestnet(this._rede)

    await resumeFromPanic()                 // D1 item 10
    await setTestnetMode(isTestnet)          // D1 item 11
    pregão.limparOrdensTravadas()            // D1 item 12
    poolScannerExecutor.connect(pregão)      // D1 item 13
    poolScannerExecutor.start()              // D1 item 14

    if (isTestnet) {                         // D1 item 15
      const { iniciar } = await import("@/lib/pregao-arc")
      iniciar()
    }

    this.log(`🔁 Ciclo dos Pregueiros iniciado na rede ${this._rede} (a cada ${this._cicloIntervaloSegundos}s)`)
    this.log(`🔄 Circuit breaker resetado — modo ${isTestnet ? "testnet" : "mainnet"}`)
    this.log(`🌐 Agentes: ${isTestnet ? "single-network" : `single-network (${this._rede})`}`)
    // D1 item 17 (atualizarTudo()) intentionally not reproduced here —
    // see file header. this.notify() below covers the engine-state half
    // of what atualizarTudo() did; the pregão-data half is already
    // covered by pregão's own onOrdem/onCashBoxChange events.
    this.notify()

    this.loop() // fire-and-forget, matches D1 item 18's setInterval kickoff
  }

  // ── Loop (modoGrao pattern: while/sleep instead of setInterval — see
  //    file header for the accepted stop-latency trade-off) ─────────────

  private async loop(): Promise<void> {
    while (this._ativo) {
      // [Mainnet gate, re-checked every cycle] If the network changed to
      // a non-testnet one mid-run without mainnet confirmation, stop
      // instead of silently trading on mainnet without consent. This is
      // the direct consequence of always reading the CURRENT network
      // (the D4 fix) combined with the new mainnet gate — without this
      // check, "always use the current network" would have created a way
      // to bypass the gate by switching networks after an already-running
      // testnet-confirmed cycle.
      const isTestnet = resolveIsTestnet(this._rede)
      if (!isTestnet && !this._mainnetConfirmado) {
        this._ultimoErro = "Rede mudou para mainnet sem confirmação — ciclo parado por segurança"
        this.log(`🛑 ${this._ultimoErro}`)
        this.stop()
        return
      }

      await this.runOneCycle(isTestnet)
      this._ultimoCicloEm = Date.now()
      this.notify()

      if (!this._ativo) break
      await sleep(this._cicloIntervaloSegundos * 1000)
    }
  }

  // ── One cycle body (D1 items 19-27) ─────────────────────────────────

  private async runOneCycle(isTestnet: boolean): Promise<void> {
    const rede = this._rede // read once per cycle, but always the CURRENT value — D4 fix

    await resumeFromPanic()             // D1 item 19
    pregão.limparOrdensTravadas()       // D1 item 20

    try {                                // D1 item 21
      const { executarCicloPregueiros } = await import("@/lib/pregueiro")
      const { executarCicloAgentes } = await import("@/lib/agentes-do-pregão")
      const { professor } = await import("@/lib/professor")

      await executarCicloPregueiros(rede).catch(e => this.log(`❌ Pregoeiros: ${e?.message ?? e}`)) // D1 item 22
      await executarCicloAgentes(rede).catch(e => this.log(`❌ Agentes: ${e?.message ?? e}`))        // D1 item 23 — FIXED: `rede` is always current, not a captured closure

      if (!isTestnet) {                   // D1 items 24-25
        await professor.gerarPacotes().catch(e => this.log(`❌ Professor: ${e?.message ?? e}`))
        await pregão.executarPacotes().catch(e => this.log(`❌ Pacote: ${e?.message ?? e}`))
      }
      if (isTestnet) {                    // D1 item 26 — no .catch chained here, matches the original exactly (protected only by this outer try/catch)
        const { executarCiclo: executarArc } = await import("@/lib/pregao-arc")
        await executarArc()
      }
      this._ultimoErro = null
    } catch (e) {
      this._ultimoErro = e instanceof Error ? e.message : String(e)
      this.log(`❌ Ciclo: ${this._ultimoErro}`)
    }
    // D1 item 27 (atualizarTudo()) — see file header; this.notify() is
    // called by the caller (loop()) right after this returns.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const pregãoEngine = new PregãoEngine()

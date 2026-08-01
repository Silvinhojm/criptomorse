// RI-BANK-2 Stage 2 — pregao-wiring-structural.test.ts
//
// Structural (not behavioral) check for the RI-BANK-1 B1-01 finding:
// escriturário.prepararOrdem and executarCicloAgentes are only ever
// called from inside PregãoDashboard.tsx's useEffect (a client-side React
// component) -- there is no server-side worker/cron driving them. A unit
// test of pregão.ts/corretor.ts/escriturario.ts in isolation cannot prove
// "nobody else calls this function" -- that is a fact about the whole
// repository's call graph, not about any one module's internal logic.
// This test greps the repository itself and asserts the caller count and
// caller identity, as a repeatable proxy for that wiring fact. It is a
// snapshot of today's wiring, not a guarantee the architecture must stay
// this way -- if it fails after a future change, that's the point: it
// means the wiring changed and RI-BANK-1's finding needs re-verification,
// not a change to fix here.

import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const REPO_ROOT = join(__dirname, "..")

function grepCallers(symbol: string): string[] {
  // Match `<symbol>(` calls (real invocations), not just any mention of
  // the identifier (imports, comments, definitions).
  const pattern = `${symbol}\\(`
  let output: string
  try {
    output = execSync(
      `git -c core.quotepath=false grep -n -E "${pattern}" -- "*.ts" "*.tsx"`,
      { cwd: REPO_ROOT, encoding: "utf-8" },
    )
  } catch (e: any) {
    // git grep exits 1 when it finds nothing -- that's a legitimate
    // "zero matches" result, not a tool failure.
    if (e.status === 1) return []
    throw e
  }
  return output.split("\n").filter((line) => line.trim().length > 0)
}

function isDefinitionLine(line: string, symbol: string): boolean {
  // Filters out the function's own declaration line and this test file's
  // own occurrences of the symbol name (in comments/log messages).
  return (
    line.includes(`function ${symbol}`) ||
    line.includes(`async ${symbol}(`) ||
    line.includes("pregao-wiring-structural.test.ts:")
  )
}

export async function runPregaoWiringStructuralTests(): Promise<void> {
  // ================================================================
  // [STRUCTURAL, documents RI-BANK-1 B1-01] escriturário.prepararOrdem
  // ================================================================
  {
    const lines = grepCallers("prepararOrdem")
    const callSites = lines.filter((line) => !isDefinitionLine(line, "prepararOrdem"))
    console.log("[prepararOrdem call sites]")
    for (const l of callSites) console.log("  " + l)

    expect(callSites.length === 1, `expected exactly 1 real call site for escriturário.prepararOrdem, found ${callSites.length}. If this is >1, the browser-dependency finding (RI-BANK-1 B1-01) may need re-verification -- a new caller could mean a server-side path now exists, or it could just be test/dead code; read the new call site before concluding either way.`)
    expect(callSites[0].includes("PregãoDashboard.tsx"), `the single call site must be inside PregãoDashboard.tsx (the client-side React dashboard), got: ${callSites[0]}`)
  }

  // ================================================================
  // [STRUCTURAL, CORRECTS RI-BANK-1 B1-01] executarCicloAgentes
  //
  // RI-BANK-1 stated "não há nenhum lugar fora desse componente
  // client-side que chame executarCicloAgentes", naming only
  // PregãoDashboard.tsx. Running this test for the first time (RI-BANK-2
  // Stage 2) found a THIRD call site RI-BANK-1 missed:
  // lib/arc-training.ts:169, inside ArcTraining._runCycle() (its own
  // 15s setInterval, started by arcTraining.start()).
  //
  // This does not contradict the underlying architectural claim --
  // ArcTrainingPanel.tsx (the only caller of arcTraining.start()) is
  // itself "use client" and is rendered *inside* PregãoDashboard.tsx
  // (see PregãoDashboard.tsx:744, `<ArcTrainingPanel .../>`) -- so the
  // whole chain is still reachable only through that one dashboard
  // component tree, just with one more layer of indirection than
  // RI-BANK-1 traced. The finding is corrected here to be precise, not
  // walked back.
  // ================================================================
  {
    const lines = grepCallers("executarCicloAgentes")
    const callSites = lines.filter((line) => !line.includes("export async function executarCicloAgentes"))
    console.log("[executarCicloAgentes call sites]")
    for (const l of callSites) console.log("  " + l)

    const KNOWN_CALLER_FILES = ["PregãoDashboard.tsx", "arc-training.ts"]
    expect(callSites.length >= 1, "expected at least 1 real call site for executarCicloAgentes")
    const unknownCallers = callSites.filter((line) => !KNOWN_CALLER_FILES.some((f) => line.includes(f)))
    expect(unknownCallers.length === 0, `found a caller of executarCicloAgentes outside the known browser-only chain (PregãoDashboard.tsx, lib/arc-training.ts) -- this may mean a new, possibly server-side entry point now exists and RI-BANK-1 B1-01 needs re-verification: ${JSON.stringify(unknownCallers)}`)

    // If arc-training.ts calls it, arc-training.ts's own driving method
    // (arcTraining.start()) must itself only be reachable from a "use
    // client" component -- otherwise the indirection could hide a
    // server-side path.
    if (callSites.some((line) => line.includes("arc-training.ts"))) {
      const startCallers = grepCallers("arcTraining\\.start")
      expect(startCallers.length >= 1, "arc-training.ts calls executarCicloAgentes, so arcTraining.start() must have at least one caller to trace")
      for (const line of startCallers) {
        expect(line.includes("ArcTrainingPanel.tsx"), `arcTraining.start() must only be called from ArcTrainingPanel.tsx (a client component nested inside PregãoDashboard.tsx), found: ${line}`)
      }
    }
  }

  // ================================================================
  // [STRUCTURAL, corroborating check] Every file in the traced chain is
  // really a client component (so "browser tab must be open" is a
  // meaningful claim, not a mislabeled server component) or, for
  // arc-training.ts (a plain .ts module, not itself a component), that
  // its only consumer is one.
  // ================================================================
  {
    const dashboardPath = join(REPO_ROOT, "app", "components", "PregãoDashboard.tsx")
    const dashboardContent = readFileSync(dashboardPath, "utf-8")
    expect(dashboardContent.trimStart().startsWith('"use client"'), 'PregãoDashboard.tsx must start with "use client" for the browser-dependency finding to hold -- if this ever changes to a server component, RI-BANK-1 B1-01 needs re-verification')

    const panelPath = join(REPO_ROOT, "app", "components", "ArcTrainingPanel.tsx")
    const panelContent = readFileSync(panelPath, "utf-8")
    expect(panelContent.trimStart().startsWith('"use client"'), 'ArcTrainingPanel.tsx must start with "use client" -- it is the sole caller of arcTraining.start(), and must remain client-side for the corrected finding above to hold')

    const dashboardRendersPanel = /<ArcTrainingPanel\b/.test(dashboardContent)
    expect(dashboardRendersPanel, "PregãoDashboard.tsx must render <ArcTrainingPanel /> -- otherwise ArcTrainingPanel could be mounted on some other, unaudited page")
  }

  console.log("ALL_PREGAO_WIRING_STRUCTURAL_ASSERTIONS_PASSED=YES")
}

runPregaoWiringStructuralTests()

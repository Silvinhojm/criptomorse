import { readFileSync } from "node:fs"
import { join } from "node:path"

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message) }

const directory = join(process.cwd(), "lib", "agent-framework", "types")
const modules = [
  "f1e-digest-contracts",
  "f1e-canonicalization",
  "f1e-digests",
  "f1e-projections",
  "f1e-redaction",
  "f1e-client-dto",
  "f1e-client-mapper",
  "f1e-client",
  "f1e-golden-vectors",
] as const

function source(name: string): string { return readFileSync(join(directory, `${name}.ts`), "utf8") }
function localImports(text: string): readonly string[] {
  return [...text.matchAll(/(?:from\s+|import\s*)["']\.\/(f1e-[^"']+)["']/g)].map((match) => match[1]).filter((name) => modules.includes(name as typeof modules[number]))
}

export function runImportGuards(): void {
  for (const moduleName of modules) expect(!/export\s+\*/.test(source(moduleName)), `${moduleName} has no export star`)
  expect(!localImports(source("f1e-digests")).some((name) => /projections|redaction|client/.test(name)), "digests isolation")
  expect(!localImports(source("f1e-redaction")).some((name) => /client/.test(name)), "redaction isolation")
  expect(!localImports(source("f1e-client-dto")).includes("f1e-redaction"), "DTO does not import redaction internals")
  expect(!localImports(source("f1e-client")).includes("f1e-client-mapper"), "client barrel cannot reach mapper")
  expect(!modules.filter((name) => name !== "f1e-golden-vectors").some((name) => localImports(source(name)).includes("f1e-golden-vectors")), "golden vectors are leaf")
  expect(!source("f1e-client-mapper").includes("...result") && !source("f1e-client-mapper").includes("...projection"), "mapper is explicit allowlist")

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (moduleName: string): void => {
    expect(!visiting.has(moduleName), `combined import graph cycle at ${moduleName}`)
    if (visited.has(moduleName)) return
    visiting.add(moduleName)
    for (const dependency of localImports(source(moduleName))) visit(dependency)
    visiting.delete(moduleName)
    visited.add(moduleName)
  }
  for (const moduleName of modules) visit(moduleName)
}

runImportGuards()

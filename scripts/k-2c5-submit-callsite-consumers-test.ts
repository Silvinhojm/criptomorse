import { readFileSync } from "fs"
import { resolve } from "node:path"
import type {
  OperationalUnavailableEvidenceStatus,
  SubmissionResult,
} from "../lib/agent-framework/ICoordinator"

const ts = require(
  resolve(process.cwd(), "node_modules/typescript/lib/typescript.js")
) as typeof import("typescript")

let passed = 0
let failed = 0

function assert(label: string, condition: boolean): void {
  if (condition) {
    passed++
    console.log(`  ✅ ${label}`)
  } else {
    failed++
    console.error(`  ❌ ${label}`)
  }
}

function visit(node: import("typescript").Node, visitor: (candidate: import("typescript").Node) => void): void {
  visitor(node)
  ts.forEachChild(node, child => visit(child, visitor))
}

function descendants<T extends import("typescript").Node>(
  node: import("typescript").Node,
  predicate: (candidate: import("typescript").Node) => candidate is T
): T[] {
  const matches: T[] = []
  visit(node, candidate => {
    if (predicate(candidate)) matches.push(candidate)
  })
  return matches
}

function isResultProperty(node: import("typescript").Node, property: string): boolean {
  return ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "result"
    && node.name.text === property
}

function isOperationalKindGuard(statement: import("typescript").Statement): statement is import("typescript").IfStatement {
  if (!ts.isIfStatement(statement) || !ts.isBinaryExpression(statement.expression)) return false
  const expression = statement.expression
  return expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && isResultProperty(expression.left, "kind")
    && ts.isStringLiteral(expression.right)
    && expression.right.text === "operational_unavailable"
}

function isSubmitCall(node: import("typescript").Node): node is import("typescript").CallExpression {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "frameworkCoordinator"
    && node.expression.name.text === "submitProposal"
}

function containsResultProperty(node: import("typescript").Node, property: string): boolean {
  return descendants(node, ts.isPropertyAccessExpression)
    .some(candidate => isResultProperty(candidate, property))
}

function returnStatements(node: import("typescript").Node): import("typescript").ReturnStatement[] {
  return descendants(node, ts.isReturnStatement)
}

interface ConsumerProof {
  sourceFile: import("typescript").SourceFile
  container: import("typescript").FunctionLikeDeclaration
  block: import("typescript").Block
  submitCall: import("typescript").CallExpression
  resultStatement: import("typescript").VariableStatement
  kindGuard: import("typescript").IfStatement
  firstConsensusRead: import("typescript").PropertyAccessExpression
  submitCallPosition: number
  kindGuardPosition: number
  firstConsensusReadPosition: number
  operationalBranchTerminates: boolean
  operationalBranchReturnValue: "VOID" | "FALSE" | "OTHER"
  publicReasonUsed: boolean
  consensusReadInsideOperationalBranch: boolean
  executionResultReadInsideOperationalBranch: boolean
  awaitBetweenSubmitResultAndKindGuard: number
  economicCallBetweenResultAndGuard: number
  guardImmediatelyFollowsResult: boolean
}

function parseSource(relativePath: string): import("typescript").SourceFile {
  const absolutePath = resolve(process.cwd(), relativePath)
  return ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
}

function isExecutableFunctionLike(
  node: import("typescript").Node
): node is import("typescript").FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node)
}

function enclosingFunction(node: import("typescript").Node): import("typescript").FunctionLikeDeclaration {
  let current: import("typescript").Node | undefined = node.parent
  while (current && !isExecutableFunctionLike(current)) current = current.parent
  if (!current || !isExecutableFunctionLike(current)) throw new Error("submitProposal call is not inside a function")
  return current
}

function enclosingVariableStatement(node: import("typescript").Node): import("typescript").VariableStatement {
  let current: import("typescript").Node | undefined = node
  while (current && !ts.isVariableStatement(current)) current = current.parent
  if (!current) throw new Error("submitProposal result is not assigned by a variable statement")
  return current
}

function enclosingBlock(node: import("typescript").Node): import("typescript").Block {
  let current: import("typescript").Node | undefined = node.parent
  while (current && !ts.isBlock(current)) current = current.parent
  if (!current) throw new Error("statement is not inside a block")
  return current
}

function analyzeConsumer(relativePath: string, functionName?: string): ConsumerProof {
  const sourceFile = parseSource(relativePath)
  const submitCalls = descendants(sourceFile, isSubmitCall)
  const submitCall = functionName
    ? submitCalls.find(call => {
        const fn = enclosingFunction(call)
        return "name" in fn && fn.name && ts.isIdentifier(fn.name) && fn.name.text === functionName
      })
    : submitCalls[0]

  if (!submitCall) throw new Error(`submitProposal call not found in ${relativePath}`)
  const container = enclosingFunction(submitCall)
  const resultStatement = enclosingVariableStatement(submitCall)
  const block = enclosingBlock(resultStatement)
  const resultDeclaration = resultStatement.declarationList.declarations.find(declaration =>
    ts.isIdentifier(declaration.name) && declaration.name.text === "result"
  )
  if (!resultDeclaration || !resultDeclaration.initializer || !ts.isAwaitExpression(resultDeclaration.initializer)) {
    throw new Error(`submitProposal return is not assigned to awaited result in ${relativePath}`)
  }

  const statementIndex = block.statements.findIndex(statement => statement === resultStatement)
  if (statementIndex < 0) throw new Error(`result statement is not a direct statement in ${relativePath}`)
  const kindGuard = block.statements.slice(statementIndex + 1).find(isOperationalKindGuard)
  if (!kindGuard) throw new Error(`operational_unavailable guard not found in ${relativePath}`)

  const consensusReads = descendants(block, ts.isPropertyAccessExpression)
    .filter(node => isResultProperty(node, "consensus") && node.getStart(sourceFile) > submitCall.getStart(sourceFile))
    .sort((a, b) => a.getStart(sourceFile) - b.getStart(sourceFile))
  const firstConsensusRead = consensusReads[0]
  if (!firstConsensusRead) throw new Error(`result.consensus read not found in ${relativePath}`)

  const branchReturns = returnStatements(kindGuard.thenStatement)
  const operationalReturn = branchReturns[0]
  const returnValue = !operationalReturn
    ? "OTHER"
    : !operationalReturn.expression
      ? "VOID"
      : operationalReturn.expression.kind === ts.SyntaxKind.FalseKeyword
        ? "FALSE"
        : "OTHER"
  const betweenStatements = block.statements.slice(
    statementIndex + 1,
    block.statements.findIndex(statement => statement === kindGuard)
  )
  const betweenNodeCount = <T extends import("typescript").Node>(
    predicate: (candidate: import("typescript").Node) => candidate is T
  ): number => betweenStatements.reduce((count, statement) => count + descendants(statement, predicate).length, 0)

  return {
    sourceFile,
    container,
    block,
    submitCall,
    resultStatement,
    kindGuard,
    firstConsensusRead,
    submitCallPosition: submitCall.getStart(sourceFile),
    kindGuardPosition: kindGuard.getStart(sourceFile),
    firstConsensusReadPosition: firstConsensusRead.getStart(sourceFile),
    operationalBranchTerminates: branchReturns.length > 0,
    operationalBranchReturnValue: returnValue,
    publicReasonUsed: containsResultProperty(kindGuard.thenStatement, "publicReason"),
    consensusReadInsideOperationalBranch: containsResultProperty(kindGuard.thenStatement, "consensus"),
    executionResultReadInsideOperationalBranch: containsResultProperty(kindGuard.thenStatement, "executionResult"),
    awaitBetweenSubmitResultAndKindGuard: betweenNodeCount(ts.isAwaitExpression),
    economicCallBetweenResultAndGuard: betweenNodeCount(ts.isCallExpression),
    guardImmediatelyFollowsResult: block.statements[statementIndex + 1] === kindGuard,
  }
}

function printProof(label: string, proof: ConsumerProof): void {
  console.log(`\n${label}:`)
  console.log(`SUBMIT_CALL_POSITION=${proof.submitCallPosition}`)
  console.log(`KIND_GUARD_POSITION=${proof.kindGuardPosition}`)
  console.log(`FIRST_CONSENSUS_READ_POSITION=${proof.firstConsensusReadPosition}`)
  console.log(`OPERATIONAL_BRANCH_TERMINATES=${proof.operationalBranchTerminates ? "YES" : "NO"}`)
  console.log(`OPERATIONAL_BRANCH_RETURN_VALUE=${proof.operationalBranchReturnValue}`)
  console.log(`PUBLIC_REASON_USED=${proof.publicReasonUsed ? "YES" : "NO"}`)
  console.log(`CONSENSUS_READ_INSIDE_OPERATIONAL_BRANCH=${proof.consensusReadInsideOperationalBranch ? "YES" : "NO"}`)
  console.log(`AWAIT_BETWEEN_SUBMIT_RESULT_AND_KIND_GUARD=${proof.awaitBetweenSubmitResultAndKindGuard}`)
  console.log(`ECONOMIC_CALL_BETWEEN_RESULT_AND_GUARD=${proof.economicCallBetweenResultAndGuard}`)
}

const unavailableStatus: OperationalUnavailableEvidenceStatus = "unavailable"
const unprovenStatus: OperationalUnavailableEvidenceStatus = "unproven"
// @ts-expect-error OperationalUnavailable cannot claim available evidence.
const forbiddenStatus: OperationalUnavailableEvidenceStatus = "available"
void unavailableStatus
void unprovenStatus
void forbiddenStatus

const localNarrowingProof = (result: SubmissionResult): boolean => {
  if (result.kind === "operational_unavailable") {
    return result.publicReason === "Operational recovery required"
  }
  return result.consensus.approved
}
void localNarrowingProof

function main(): void {
  console.log("\n=== K-2c.5 Consumer Structural AST Tests ===\n")
  const agentes = analyzeConsumer("lib/agentes-do-pregão.ts")
  const pregao = analyzeConsumer("lib/pregão.ts", "submeterSinalAoCoordinator")

  printProof("AGENTES", agentes)
  printProof("PREGÃO", pregao)

  assert("AGENTES submit result assigned to identifiable variable", ts.isVariableStatement(agentes.resultStatement))
  assert("AGENTES guard immediately follows submit result", agentes.guardImmediatelyFollowsResult)
  assert("AGENTES submit precedes kind guard", agentes.submitCallPosition < agentes.kindGuardPosition)
  assert("AGENTES kind guard precedes first consensus read", agentes.kindGuardPosition < agentes.firstConsensusReadPosition)
  assert("AGENTES unavailable branch uses publicReason", agentes.publicReasonUsed)
  assert("AGENTES unavailable branch does not read consensus", !agentes.consensusReadInsideOperationalBranch)
  assert("AGENTES unavailable branch does not read executionResult", !agentes.executionResultReadInsideOperationalBranch)
  assert("AGENTES unavailable branch terminates", agentes.operationalBranchTerminates)
  assert("AGENTES unavailable branch returns void", agentes.operationalBranchReturnValue === "VOID")
  assert("AGENTES has zero await between result and guard", agentes.awaitBetweenSubmitResultAndKindGuard === 0)
  assert("AGENTES has zero calls between result and guard", agentes.economicCallBetweenResultAndGuard === 0)
  const agentesRejectionGuards = agentes.block.statements.filter((statement): statement is import("typescript").IfStatement =>
    ts.isIfStatement(statement) && containsResultProperty(statement.expression, "consensus")
  )
  const agentesNormalRejection = agentesRejectionGuards.find(statement =>
    ts.isPrefixUnaryExpression(statement.expression)
    && statement.expression.operator === ts.SyntaxKind.ExclamationToken
    && ts.isPropertyAccessExpression(statement.expression.operand)
    && statement.expression.operand.name.text === "approved"
  )
  assert("AGENTES normal rejection path remains", Boolean(
    agentesNormalRejection
    && returnStatements(agentesNormalRejection.thenStatement).some(ret => !ret.expression)
  ))
  assert("AGENTES normal approved continuation remains", Boolean(
    agentesNormalRejection && !agentesNormalRejection.elseStatement
  ))

  assert("PREGÃO submit result assigned to identifiable variable", ts.isVariableStatement(pregao.resultStatement))
  assert("PREGÃO guard immediately follows submit result", pregao.guardImmediatelyFollowsResult)
  assert("PREGÃO submit precedes kind guard", pregao.submitCallPosition < pregao.kindGuardPosition)
  assert("PREGÃO kind guard precedes first consensus read", pregao.kindGuardPosition < pregao.firstConsensusReadPosition)
  assert("PREGÃO unavailable branch uses publicReason", pregao.publicReasonUsed)
  assert("PREGÃO unavailable branch does not read consensus", !pregao.consensusReadInsideOperationalBranch)
  assert("PREGÃO unavailable branch does not read executionResult", !pregao.executionResultReadInsideOperationalBranch)
  assert("PREGÃO unavailable branch terminates", pregao.operationalBranchTerminates)
  assert("PREGÃO unavailable branch returns false", pregao.operationalBranchReturnValue === "FALSE")
  assert("PREGÃO has zero await between result and guard", pregao.awaitBetweenSubmitResultAndKindGuard === 0)
  assert("PREGÃO has zero calls between result and guard", pregao.economicCallBetweenResultAndGuard === 0)
  const pregaoReturns = returnStatements(pregao.block)
  const trueReturns = pregaoReturns.filter(ret => ret.expression?.kind === ts.SyntaxKind.TrueKeyword)
  const falseReturns = pregaoReturns.filter(ret => ret.expression?.kind === ts.SyntaxKind.FalseKeyword)
  assert("PREGÃO return true remains after guard and consensus", trueReturns.length === 1 && trueReturns[0].getStart(pregao.sourceFile) > pregao.firstConsensusReadPosition)
  assert("PREGÃO normal rejection continues returning false", falseReturns.length >= 2)
  const catchClauses = descendants(pregao.container, ts.isCatchClause)
  assert("PREGÃO catch continues returning false", catchClauses.some(clause =>
    returnStatements(clause.block).some(ret => ret.expression?.kind === ts.SyntaxKind.FalseKeyword)
  ))

  console.log("\nCOORDINATOR_BEHAVIORAL_PROOF=K2C5 operational suite")
  console.log("CONSUMER_CONTROL_FLOW_PROOF=AST structural suite")
  console.log("END_TO_END_CONSUMER_RUNTIME_PROOF=NOT_RUN")
  console.log("TESTABILITY_LIMITATION=The Pregão runtime graph is not safely import-isolated in the current architecture. K-2c.5 uses behavioral Coordinator tests plus AST control-flow proof for the two minimal consumer guards. No production test seam was added.")
  console.log("TESTABILITY_LIMITATION_SEVERITY=MEDIUM")
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed) process.exitCode = 1
}

main()

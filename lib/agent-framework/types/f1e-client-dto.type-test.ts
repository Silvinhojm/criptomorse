import type { ProofDigest } from "./f1d-settlement-identities"
import type { RedactionManifestDigest, RedactionManifestDigestRef } from "./f1e-digest-contracts"
import type { ClientServerOnlyGuards, DisclosedValue, F1eAggregateClientDto, PublicAnchorRef, PublicAuditRef } from "./f1e-client-dto"

type Assert<T extends true> = T
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Not<T extends boolean> = T extends true ? false : true
type ExactKeys<T, Keys extends PropertyKey> = Exclude<keyof T, Keys> extends never ? Exclude<Keys, keyof T> extends never ? true : false : false

type ExpectedDtoKeys = keyof ClientServerOnlyGuards | "kind" | "status" | "reasonCodes" | "auditRef" | "anchorCurrentRef" | "anchorHistory" | "manifestRef" | "manifestDigest"
type _exactDtoKeys = Assert<ExactKeys<F1eAggregateClientDto, ExpectedDtoKeys>>
type _fourVariants = Assert<IsAssignable<
  | { disclosure: "INCLUDED"; value: PublicAuditRef | null }
  | { disclosure: "OMITTED" }
  | { disclosure: "MASKED"; maskedDisplay: string }
  | { disclosure: "COMMIT_ONLY"; valueDigest: ProofDigest },
  DisclosedValue<PublicAuditRef>
>>
type _nullNotDisclosure = Assert<Not<IsAssignable<null, DisclosedValue<PublicAuditRef>>>>
type _crossFieldRejected = Assert<Not<IsAssignable<{ disclosure: "MASKED"; maskedDisplay: string; value: PublicAuditRef }, DisclosedValue<PublicAuditRef>>>>
type _bareDigestRejected = Assert<Not<IsAssignable<RedactionManifestDigest, F1eAggregateClientDto["manifestDigest"]>>>
type _descriptorlessRejected = Assert<Not<IsAssignable<{ kind: "REDACTION_MANIFEST_DIGEST_REF"; digest: RedactionManifestDigest }, RedactionManifestDigestRef>>>
type _nestedSecretsRejected = Assert<Not<IsAssignable<{ disclosure: "INCLUDED"; value: { secrets: string } }, F1eAggregateClientDto["auditRef"]>>>
type _nestedEvidenceRejected = Assert<Not<IsAssignable<{ disclosure: "INCLUDED"; value: { rawEvidence: string } }, F1eAggregateClientDto["anchorCurrentRef"]>>>
type _nestedCapabilityRejected = Assert<Not<IsAssignable<{ state: "ANCHORED"; ref: PublicAnchorRef; historical: true; capabilityRefs: readonly string[] }, F1eAggregateClientDto["anchorHistory"][number]>>>
type GuardKeys = "secrets" | "credentials" | "rawCapability" | "capabilityRefs" | "providerToken" | "signingMaterial" | "otp" | "keyShare" | "rawSignature" | "privatePrompt" | "rawEvidence" | "handoff" | "evidenceRefs" | "authorityRefs" | "fencing" | "provenance" | "confirmationProof"
type _all17Guards = Assert<ExactKeys<ClientServerOnlyGuards, GuardKeys>>

export type ClientDtoTypeTests = _exactDtoKeys | _fourVariants | _nullNotDisclosure | _crossFieldRejected | _bareDigestRejected | _descriptorlessRejected | _nestedSecretsRejected | _nestedEvidenceRejected | _nestedCapabilityRejected | _all17Guards

/** Unversioned diagnostics remain valid; versioned diagnostics may not move backwards. */
export function shouldAcceptDiagnostics(
  diagnosticVersion: number | undefined,
  synchronizedVersion: number | undefined,
): boolean {
  return diagnosticVersion == null
    || synchronizedVersion == null
    || diagnosticVersion >= synchronizedVersion
}

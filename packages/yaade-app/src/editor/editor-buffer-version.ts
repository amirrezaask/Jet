/** Tracks a Monaco alternative-version token without retaining document text. */
export class EditorBufferVersionToken {
  constructor(private savedAlternativeVersionId: number) {}

  isDirty(currentAlternativeVersionId: number): boolean {
    return currentAlternativeVersionId !== this.savedAlternativeVersionId
  }

  markSaved(currentAlternativeVersionId: number): void {
    this.savedAlternativeVersionId = currentAlternativeVersionId
  }

  savedVersion(): number {
    return this.savedAlternativeVersionId
  }
}

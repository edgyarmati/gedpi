export interface FixedEditorClusterInput {
  width: number;
  terminalRows: number;
  editorLines: string[];
  footerLines?: string[];
  widgetAboveLines?: string[];
  widgetBelowLines?: string[];
}

export interface FixedEditorClusterRender {
  lines: string[];
}

export function renderFixedEditorCluster(input: FixedEditorClusterInput): FixedEditorClusterRender {
  const width = Math.max(1, input.width);
  const maxRows = Math.max(1, input.terminalRows - 1);

  const editor = input.editorLines.map((line) => line ?? "");
  const footer = (input.footerLines ?? []).map((line) => line ?? "");
  const above = (input.widgetAboveLines ?? []).map((line) => line ?? "");
  const below = (input.widgetBelowLines ?? []).map((line) => line ?? "");

  const total = editor.length + footer.length + above.length + below.length;
  if (total > maxRows) {
    // Priority: editor > footer > below widgets > above widgets
    const available = maxRows;
    const editorLines = editor.slice(0, available);
    let remaining = available - editorLines.length;
    const footerLines = footer.slice(0, remaining);
    remaining -= footerLines.length;
    const belowLines = below.slice(0, remaining);
    remaining -= belowLines.length;
    const aboveLines = above.slice(0, remaining);
    return { lines: [...aboveLines, ...editorLines, ...footerLines, ...belowLines] };
  }

  return { lines: [...above, ...editor, ...footer, ...below] };
}

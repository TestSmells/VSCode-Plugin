import * as vscode from 'vscode';
import * as path from 'node:path';
import { runDetector } from './testSmellDetector';

const COMMAND = 'testSmellDetector.analyzeCurrentFile';
const SOURCE = 'Test Smell Detector';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(SOURCE);
  const diagnostics = vscode.languages.createDiagnosticCollection('testSmellDetector');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const generations = new Map<string, number>();
  const findings = new Map<string, { range: vscode.Range; message: string }[]>();
  const key = (uri: vscode.Uri) => uri.toString();
  const isJavaTest = (doc: vscode.TextDocument) => doc.languageId === 'java' && doc.uri.scheme === 'file' && /(?:Test|Tests|IT|Spec)\.java$/i.test(path.basename(doc.fileName));

  async function productionFile(doc: vscode.TextDocument): Promise<string | undefined> {
    const name = path.basename(doc.fileName).replace(/(?:Tests|Test|IT|Spec)\.java$/i, '.java');
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) return undefined;
    const hits = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, `**/${name}`), '**/{target,build,out,node_modules}/**', 30);
    const candidates = hits.filter(uri => uri.fsPath !== doc.fileName);
    // Prefer an adjacent src/main path, then the shortest candidate path.
    candidates.sort((a, b) => Number(/[/\\]src[/\\]main[/\\]/.test(b.fsPath)) - Number(/[/\\]src[/\\]main[/\\]/.test(a.fsPath)) || a.fsPath.length - b.fsPath.length);
    return candidates[0]?.fsPath;
  }

  function clear(doc: vscode.TextDocument): void {
    const id = key(doc.uri);
    clearTimeout(timers.get(id));
    timers.delete(id);
    generations.set(id, (generations.get(id) ?? 0) + 1);
    diagnostics.delete(doc.uri);
    findings.delete(id);
  }

  function reportFailure(error: unknown, doc: vscode.TextDocument, interactive: boolean): void {
    output.appendLine(`${doc.fileName}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    if (interactive) {
      output.show(true);
      void vscode.window.showErrorMessage('Test smell analysis failed. See Test Smell Detector output.');
    }
  }

  async function analyze(doc: vscode.TextDocument, interactive: boolean): Promise<void> {
    if (!isJavaTest(doc)) {
      if (interactive) void vscode.window.showWarningMessage('Open a saved Java test file such as ExampleTest.java.');
      return;
    }
    clear(doc);
    const id = key(doc.uri);
    const generation = generations.get(id)!;
    if (doc.isDirty) {
      if (interactive) void vscode.window.showWarningMessage('Save the Java test file before analyzing it.');
      return;
    }
    let production = await productionFile(doc);
    if (!production && interactive) {
      const selected = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Java files': ['java'] }, title: 'Select the production file for this test' });
      production = selected?.[0]?.fsPath;
      if (production === doc.fileName) {
        void vscode.window.showWarningMessage('Choose the production Java file, not the test file itself.');
        return;
      }
    }
    if (!production) {
      output.appendLine(`Skipped ${doc.fileName}: no matching production Java file found.`);
      return;
    }
    if (generation !== generations.get(id) || doc.isClosed || doc.isDirty) return;
    try {
      const run = () => runDetector({
        applicationName: vscode.workspace.getWorkspaceFolder(doc.uri)?.name ?? path.basename(path.dirname(doc.fileName)),
        javaPath: vscode.workspace.getConfiguration('testSmellDetector', doc.uri).get('javaPath', 'java'),
        jarPath: context.asAbsolutePath('detector/tsdetect.jar'),
        testFilePath: doc.fileName,
        productionFilePath: production,
      });
      const result = interactive
        ? await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Analyzing ${path.basename(doc.fileName)}...` }, run)
        : await run();
      if (generation !== generations.get(id) || doc.isClosed || doc.isDirty) return;
      // Method ranges come from the Java parser, matched to engine-confirmed elements.
      const match = /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/.exec(doc.getText());
      const fallbackRange = match
        ? new vscode.Range(doc.positionAt(match.index + match[0].length - match[1].length), doc.positionAt(match.index + match[0].length))
        : doc.lineAt(0).range;
      const hoverItems: { range: vscode.Range; message: string }[] = [];
      const entries = result.findings.map(finding => {
        let range = fallbackRange;
        let located = false;
        const location = finding.location;
        if (location && location.startLine <= doc.lineCount && location.endLine <= doc.lineCount
          && location.startColumn - 1 <= doc.lineAt(location.startLine - 1).text.length
          && location.endColumn - 1 <= doc.lineAt(location.endLine - 1).text.length) {
          range = new vscode.Range(location.startLine - 1, location.startColumn - 1,
            location.endLine - 1, location.endColumn - 1);
          located = true;
        }
        const detail = located
          ? `${finding.scope === 'method' ? 'Method' : 'Class'}: ${finding.elementName}. The underline marks the declaration, not an exact offending statement.`
          : 'File-level result. A unique declaration location is unavailable.';
        const message = `${finding.name} detected. ${detail}`;
        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = SOURCE;
        diagnostic.code = finding.name;
        hoverItems.push({ range, message });
        return diagnostic;
      });
      diagnostics.set(doc.uri, entries);
      if (hoverItems.length) findings.set(id, hoverItems);
      if (interactive) {
        output.clear();
        output.appendLine('Test Smell Detector Results');
        output.appendLine('===========================');
        output.appendLine(`Test file: ${doc.fileName}`);
        output.appendLine(`Production file: ${production}`);
        output.appendLine(`Test methods: ${result.numberOfTestMethods}`);
        output.appendLine('');
        output.appendLine(entries.length ? `Detected smell types (${result.detectedSmells.length}):` : 'No test smells detected.');
        for (const name of result.detectedSmells) output.appendLine(`- ${name}`);
        for (const finding of result.findings) {
          output.appendLine(`  ${finding.name}: ${finding.scope} ${finding.elementName}${finding.location ? ` at line ${finding.location.startLine}` : ''}`);
        }
        output.show(true);
        const selection = await vscode.window.showInformationMessage(
          `Analysis complete: ${result.detectedSmells.length} smell type(s), ${entries.length} finding(s).`,
          'Open Problems',
        );
        if (selection === 'Open Problems') {
          await vscode.commands.executeCommand('workbench.actions.view.problems');
        }
      } else {
        output.appendLine(`${doc.fileName}: ${result.numberOfTestMethods} test method(s), ${entries.length} smell(s)${entries.length ? `: ${result.detectedSmells.join(', ')}` : ''}`);
      }
    } catch (error) {
      if (generation === generations.get(id)) reportFailure(error, doc, interactive);
    }
  }

  function schedule(doc: vscode.TextDocument): void {
    if (!isJavaTest(doc)) return;
    clear(doc);
    const id = key(doc.uri);
    if (!vscode.workspace.getConfiguration('testSmellDetector', doc.uri).get('analyzeOnSave', true)) return;
    timers.set(id, setTimeout(() => { timers.delete(id); void analyze(doc, false); }, 500));
  }

  context.subscriptions.push(
    output, diagnostics,
    vscode.commands.registerCommand(COMMAND, () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc) return analyze(doc, true);
      return vscode.window.showWarningMessage('Open a Java test file first.');
    }),
    vscode.workspace.onDidSaveTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument(event => { if (isJavaTest(event.document)) clear(event.document); }),
    vscode.workspace.onDidCloseTextDocument(clear),
    vscode.window.onDidChangeActiveTextEditor(editor => { if (editor && isJavaTest(editor.document)) schedule(editor.document); }),
    vscode.languages.registerHoverProvider({ language: 'java', scheme: 'file' }, {
      provideHover(doc, position) {
        const items = findings.get(key(doc.uri))?.filter(item => item.range.contains(position));
        if (!items?.length) return undefined;
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown('**Test smell findings**\n\n');
        for (const item of items) {
          markdown.appendText(item.message);
          markdown.appendMarkdown('\n\n');
        }
        return new vscode.Hover(markdown, items[0].range);
      },
    }),
    { dispose: () => { for (const timer of timers.values()) clearTimeout(timer); } },
  );
  if (vscode.window.activeTextEditor) schedule(vscode.window.activeTextEditor.document);
}

export function deactivate(): void {}

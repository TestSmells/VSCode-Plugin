import * as vscode from 'vscode';
import * as path from 'node:path';
import { runDetector } from './testSmellDetector';

// This ID must match the command contributed in package.json.
const ANALYZE_CURRENT_FILE_COMMAND = 'testSmellDetector.analyzeCurrentFile';
const DIAGNOSTIC_SOURCE = 'Test Smell Detector';

/**
 * tsDetect currently reports smells for the complete test file rather than an
 * exact source line. Anchor diagnostics to the declared test class so VS Code
 * can show an honest file-level result in the Problems panel.
 */
function findTestClassRange(document: vscode.TextDocument): vscode.Range {
  const source = document.getText();
  const declaration = /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/.exec(
    source,
  );

  if (!declaration) {
    return new vscode.Range(0, 0, 0, 0);
  }

  const className = declaration[1];
  const classNameOffset =
    declaration.index + declaration[0].lastIndexOf(className);

  return new vscode.Range(
    document.positionAt(classNameOffset),
    document.positionAt(classNameOffset + className.length),
  );
}

/** Convert file-level smell names into native VS Code warning diagnostics. */
function createDiagnostics(
  document: vscode.TextDocument,
  detectedSmells: string[],
): vscode.Diagnostic[] {
  const range = findTestClassRange(document);

  return detectedSmells.map((smell) => {
    const diagnostic = new vscode.Diagnostic(
      range,
      `${smell} detected in this test file (file-level result).`,
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = DIAGNOSTIC_SOURCE;
    diagnostic.code = smell;
    return diagnostic;
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Test Smell Detector');
  const diagnostics = vscode.languages.createDiagnosticCollection(
    'testSmellDetector',
  );
  const analyzeCurrentFile = vscode.commands.registerCommand(
    ANALYZE_CURRENT_FILE_COMMAND,
    async () => {
      const editor = vscode.window.activeTextEditor;

      // tsDetect reads source from disk, so require an active, saved Java file
      // before starting the detector workflow.
      if (!editor) {
        await vscode.window.showErrorMessage(
          'Open a Java test file before running Test Smell Detector.',
        );
        return;
      }

      const { document } = editor;
      const fileName = path.basename(document.fileName);

      if (document.languageId !== 'java') {
        await vscode.window.showWarningMessage(
          `${fileName} is not recognized as a Java file.`,
        );
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

      if (!productionFiles?.length) {
        return;
      }

      const productionFilePath = productionFiles[0].fsPath;
      if (productionFilePath === document.fileName) {
        await vscode.window.showWarningMessage(
          'Choose the production Java file, not the test file itself.',
        );
        return;
      }

      // Results from an older analysis are no longer reliable once a new run
      // starts. They will be replaced below if this analysis succeeds.
      diagnostics.delete(document.uri);
      const analyzedDocumentVersion = document.version;

      const javaPath = vscode.workspace
        .getConfiguration('testSmellDetector')
        .get<string>('javaPath', 'java');

      try {
        // Keep VS Code responsive and show visible progress while Java runs.
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Analyzing ${fileName} for test smells...`,
          },
          () =>
            runDetector({
              applicationName:
                workspaceFolder?.name ??
                path.basename(path.dirname(document.fileName)),
              javaPath,
              jarPath: context.asAbsolutePath('detector/tsdetect.jar'),
              productionFilePath,
              testFilePath: document.fileName,
            }),
        );

        // Do not publish results for source code that changed while the Java
        // process was running. The user can save and run the command again.
        if (
          document.isClosed ||
          document.isDirty ||
          document.version !== analyzedDocumentVersion
        ) {
          await vscode.window.showWarningMessage(
            `${fileName} changed during analysis. Save it and analyze again.`,
          );
          return;
        }

        // Keep the detailed run summary in the Output channel while native
        // diagnostics provide the editor-facing Problems experience.
        output.clear();
        output.appendLine('Test Smell Detector Results');
        output.appendLine('===========================');
        output.appendLine(`Test file: ${doc.fileName}`);
        output.appendLine(`Production file: ${production}`);
        output.appendLine(`Test methods: ${result.numberOfTestMethods}`);
        output.appendLine('');

        // Publishing diagnostics makes the smells appear in VS Code's Problems
        // panel and adds warning squiggles at the test class declaration.
        diagnostics.set(
          document.uri,
          createDiagnostics(document, result.detectedSmells),
        );

        if (result.detectedSmells.length === 0) {
          output.appendLine('No test smells detected.');
          output.show(true);
          await vscode.window.showInformationMessage(
            `No test smells detected in ${fileName}.`,
          );
        } else {
          output.appendLine(`Detected smells (${result.detectedSmells.length}):`);
          for (const smell of result.detectedSmells) {
            output.appendLine(`- ${smell}`);
          }
          output.show(true);
          const selection = await vscode.window.showWarningMessage(
            `${result.detectedSmells.length} test smell(s) detected in ${fileName}.`,
            'Open Problems',
          );

          if (selection === 'Open Problems') {
            await vscode.commands.executeCommand('workbench.actions.view.problems');
          }
        }
      } catch (error: unknown) {
        // Do not leave results from an earlier successful run visible after a
        // failed analysis.
        diagnostics.delete(document.uri);

        // Preserve technical details for debugging while keeping the pop-up
        // notification short and actionable.
        const message = error instanceof Error ? error.message : String(error);
        output.clear();
        output.appendLine('Test Smell Detector failed');
        output.appendLine('==========================');
        output.appendLine(message);
        if (error instanceof Error && error.stack) {
          output.appendLine('');
          output.appendLine(error.stack);
        }
        output.show(true);
        const selection = await vscode.window.showInformationMessage(
          `Analysis complete: ${entries.length} test smell(s).`,
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
        const item = findings.get(key(doc.uri));
        if (!item?.range.contains(position)) return undefined;
        const markdown = new vscode.MarkdownString(`**Test smells in this file**\n\n${item.names.map(name => `- ${name}`).join('\n')}\n\nTSDetect reports file-level findings; this location marks the test class.`);
        return new vscode.Hover(markdown, item.range);
      },
    }),
    { dispose: () => { for (const timer of timers.values()) clearTimeout(timer); } },
  );

  // Editing or closing a document invalidates its last file-level result.
  const clearDiagnosticsOnChange = vscode.workspace.onDidChangeTextDocument(
    ({ document }) => diagnostics.delete(document.uri),
  );
  const clearDiagnosticsOnClose = vscode.workspace.onDidCloseTextDocument(
    (document) => diagnostics.delete(document.uri),
  );

  // VS Code disposes all registered resources when the extension unloads.
  context.subscriptions.push(
    analyzeCurrentFile,
    output,
    diagnostics,
    clearDiagnosticsOnChange,
    clearDiagnosticsOnClose,
  );
}

export function deactivate(): void {}

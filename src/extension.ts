import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  isLikelyJavaTestDocument,
  ProductionFileResolver,
} from './productionFileResolver';
import { DetectorFinding, runDetector } from './testSmellDetector';

const ANALYZE_CURRENT_FILE_COMMAND = 'testSmellDetector.analyzeCurrentFile';
const DIAGNOSTIC_SOURCE = 'Test Smell Detector';
const ANALYSIS_DEBOUNCE_MILLISECONDS = 500;

interface AnalysisRequest {
  generation: number;
  interactive: boolean;
}

/**
 * Find the declared test class for findings that do not have one unambiguous
 * method or class location.
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

/** Convert a one-based bridge location into a validated VS Code range. */
function getFindingRange(
  document: vscode.TextDocument,
  finding: DetectorFinding,
): vscode.Range | undefined {
  const location = finding.location;
  if (!location) {
    return undefined;
  }

  const startLine = location.startLine - 1;
  const startCharacter = location.startColumn - 1;
  const endLine = location.endLine - 1;
  const endCharacter = location.endColumn - 1;

  if (
    startLine < 0 ||
    endLine < startLine ||
    endLine >= document.lineCount ||
    startCharacter < 0 ||
    endCharacter < 0 ||
    startCharacter > document.lineAt(startLine).text.length ||
    endCharacter > document.lineAt(endLine).text.length ||
    (startLine === endLine && endCharacter <= startCharacter)
  ) {
    return undefined;
  }

  return new vscode.Range(
    startLine,
    startCharacter,
    endLine,
    endCharacter,
  );
}

/** Convert engine findings into native VS Code warning diagnostics. */
function createDiagnostics(
  document: vscode.TextDocument,
  findings: DetectorFinding[],
  detectedSmells: string[],
): vscode.Diagnostic[] {
  const fallbackRange = findTestClassRange(document);
  const displayFindings: DetectorFinding[] =
    findings.length > 0
      ? findings
      : detectedSmells.map((name) => ({
          name,
          scope: 'file',
          elementName: '',
        }));

  return displayFindings.map((finding) => {
    const mappedRange = getFindingRange(document, finding);
    const range = mappedRange ?? fallbackRange;
    const message = mappedRange
      ? `${finding.name} detected in ${finding.scope} ${finding.elementName}. The underline marks the affected declaration.`
      : `${finding.name} detected in this test file (exact source location unavailable).`;
    const diagnostic = new vscode.Diagnostic(
      range,
      message,
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = DIAGNOSTIC_SOURCE;
    diagnostic.code = finding.name;
    return diagnostic;
  });
}

/** Activate the command, diagnostics, and incremental on-save analysis. */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(DIAGNOSTIC_SOURCE);
  const diagnostics = vscode.languages.createDiagnosticCollection(
    'testSmellDetector',
  );
  const productionFileResolver = new ProductionFileResolver(context);
  const scheduledAnalyses = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  const analysisGenerations = new Map<string, number>();
  const analysisQueues = new Map<string, Promise<void>>();

  const documentKey = (document: vscode.TextDocument): string =>
    document.uri.toString();

  const getGeneration = (document: vscode.TextDocument): number =>
    analysisGenerations.get(documentKey(document)) ?? 0;

  const nextGeneration = (document: vscode.TextDocument): number => {
    const generation = getGeneration(document) + 1;
    analysisGenerations.set(documentKey(document), generation);
    return generation;
  };

  const clearScheduledAnalysis = (document: vscode.TextDocument): void => {
    const key = documentKey(document);
    const timer = scheduledAnalyses.get(key);
    if (timer) {
      clearTimeout(timer);
      scheduledAnalyses.delete(key);
    }
  };

  const isCurrentRequest = (
    document: vscode.TextDocument,
    generation: number,
    version: number,
  ): boolean =>
    !document.isClosed &&
    !document.isDirty &&
    getGeneration(document) === generation &&
    document.version === version;

  const reportAutomaticMessage = (message: string): void => {
    output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  };

  const analyzeDocument = async (
    document: vscode.TextDocument,
    request: AnalysisRequest,
  ): Promise<void> => {
    const fileName = path.basename(document.fileName);

    if (document.languageId !== 'java') {
      if (request.interactive) {
        void vscode.window.showWarningMessage(
          `${fileName} is not recognized as a Java file.`,
        );
      }
      return;
    }

    if (document.uri.scheme !== 'file' || document.isUntitled) {
      if (request.interactive) {
        void vscode.window.showWarningMessage(
          `Save ${fileName} locally before analyzing it.`,
        );
      }
      return;
    }

    if (document.isDirty) {
      if (request.interactive) {
        void vscode.window.showWarningMessage(
          `Save your changes to ${fileName} before analyzing it.`,
        );
      }
      return;
    }

    const analyzedDocumentVersion = document.version;
    try {
      const productionFilePath = await productionFileResolver.resolve(
        document,
        request.interactive,
      );

      if (!productionFilePath) {
        if (!request.interactive) {
          reportAutomaticMessage(
            `Skipped ${fileName}: no matching production Java file was found. Run Analyze Current File once to select and remember it.`,
          );
        }
        return;
      }

      if (
        !isCurrentRequest(
          document,
          request.generation,
          analyzedDocumentVersion,
        )
      ) {
        return;
      }

      diagnostics.delete(document.uri);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const javaPath = vscode.workspace
        .getConfiguration('testSmellDetector', document.uri)
        .get<string>('javaPath', 'java');
      const run = () =>
        runDetector({
          applicationName:
            workspaceFolder?.name ??
            path.basename(path.dirname(document.fileName)),
          javaPath,
          jarPath: context.asAbsolutePath('detector/tsdetect.jar'),
          productionFilePath,
          testFilePath: document.fileName,
        });
      const result = request.interactive
        ? await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Analyzing ${fileName} for test smells...`,
            },
            run,
          )
        : await run();

      if (
        !isCurrentRequest(
          document,
          request.generation,
          analyzedDocumentVersion,
        )
      ) {
        if (request.interactive && !document.isClosed) {
          void vscode.window.showWarningMessage(
            `${fileName} changed during analysis. Save it and analyze again.`,
          );
        }
        return;
      }

      if (result.detectedSmells.length === 0) {
        diagnostics.delete(document.uri);
      } else {
        diagnostics.set(
          document.uri,
          createDiagnostics(
            document,
            result.findings,
            result.detectedSmells,
          ),
        );
      }

      if (request.interactive) {
        output.clear();
        output.appendLine('Test Smell Detector Results');
        output.appendLine('===========================');
        output.appendLine(`Test file: ${document.fileName}`);
        output.appendLine(`Production file: ${productionFilePath}`);
        output.appendLine(`Test methods: ${result.numberOfTestMethods}`);
        output.appendLine('');

        if (result.detectedSmells.length === 0) {
          output.appendLine('No test smells detected.');
          output.show(true);
          void vscode.window.showInformationMessage(
            `No test smells detected in ${fileName}.`,
          );
        } else {
          output.appendLine(
            `Detected smells (${result.detectedSmells.length}):`,
          );
          for (const smell of result.detectedSmells) {
            output.appendLine(`- ${smell}`);
          }
          output.appendLine('');
          output.appendLine(`Mapped findings (${result.findings.length}):`);
          for (const finding of result.findings) {
            const mappedElement = finding.location
              ? `${finding.scope} ${finding.elementName} at line ${finding.location.startLine}`
              : 'file level (exact declaration unavailable)';
            output.appendLine(`- ${finding.name}: ${mappedElement}`);
          }
          output.show(true);
          void vscode.window
            .showWarningMessage(
              `${result.findings.length} test smell finding(s) detected in ${fileName}.`,
              'Open Problems',
            )
            .then((selection) => {
              if (selection === 'Open Problems') {
                void vscode.commands.executeCommand(
                  'workbench.actions.view.problems',
                );
              }
            });
        }
      } else {
        reportAutomaticMessage(
          `${fileName}: ${result.numberOfTestMethods} test method(s), ${result.findings.length} smell finding(s).`,
        );
      }
    } catch (error: unknown) {
      if (getGeneration(document) !== request.generation) {
        return;
      }

      diagnostics.delete(document.uri);
      const message = error instanceof Error ? error.message : String(error);

      if (request.interactive) {
        output.clear();
        output.appendLine('Test Smell Detector failed');
        output.appendLine('==========================');
        output.appendLine(message);
        if (error instanceof Error && error.stack) {
          output.appendLine('');
          output.appendLine(error.stack);
        }
        output.show(true);
        void vscode.window.showErrorMessage(
          'Test smell analysis failed. See the Test Smell Detector output for details.',
        );
      } else {
        reportAutomaticMessage(`Analysis failed for ${fileName}: ${message}`);
      }
    }
  };

  /**
   * Serialize detector runs for one document. A newer generation invalidates
   * queued or running work, while different test files may run independently.
   */
  const enqueueAnalysis = (
    document: vscode.TextDocument,
    request: AnalysisRequest,
  ): Promise<void> => {
    const key = documentKey(document);
    const previousAnalysis = analysisQueues.get(key) ?? Promise.resolve();
    const nextAnalysis = previousAnalysis
      .catch(() => undefined)
      .then(async () => {
        if (
          getGeneration(document) !== request.generation ||
          document.isClosed ||
          document.isDirty
        ) {
          return;
        }
        await analyzeDocument(document, request);
      });

    analysisQueues.set(key, nextAnalysis);
    const cleanUpQueue = (): void => {
      if (analysisQueues.get(key) === nextAnalysis) {
        analysisQueues.delete(key);
      }
    };
    void nextAnalysis.then(cleanUpQueue, cleanUpQueue);
    return nextAnalysis;
  };

  const scheduleIncrementalAnalysis = (
    document: vscode.TextDocument,
  ): void => {
    if (!isLikelyJavaTestDocument(document)) {
      return;
    }

    const analyzeOnSave = vscode.workspace
      .getConfiguration('testSmellDetector', document.uri)
      .get<boolean>('analyzeOnSave', true);
    if (!analyzeOnSave) {
      return;
    }

    clearScheduledAnalysis(document);
    const generation = nextGeneration(document);
    const key = documentKey(document);
    const timer = setTimeout(() => {
      scheduledAnalyses.delete(key);
      void enqueueAnalysis(document, {
        generation,
        interactive: false,
      });
    }, ANALYSIS_DEBOUNCE_MILLISECONDS);
    scheduledAnalyses.set(key, timer);
  };

  const analyzeCurrentFile = vscode.commands.registerCommand(
    ANALYZE_CURRENT_FILE_COMMAND,
    async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document) {
        await vscode.window.showErrorMessage(
          'Open a Java test file before running Test Smell Detector.',
        );
        return;
      }

      clearScheduledAnalysis(document);
      const generation = nextGeneration(document);
      await enqueueAnalysis(document, {
        generation,
        interactive: true,
      });
    },
  );

  const analyzeAfterSave = vscode.workspace.onDidSaveTextDocument(
    scheduleIncrementalAnalysis,
  );

  const invalidateAfterChange = vscode.workspace.onDidChangeTextDocument(
    ({ document, contentChanges }) => {
      // VS Code can emit this event when only the document's dirty/save state
      // changes. Ignore those empty events so they do not cancel a scheduled
      // on-save analysis or invalidate a manual analysis already in progress.
      if (document.languageId !== 'java' || contentChanges.length === 0) {
        return;
      }
      clearScheduledAnalysis(document);
      nextGeneration(document);
      diagnostics.delete(document.uri);
    },
  );

  const cleanUpClosedDocument = vscode.workspace.onDidCloseTextDocument(
    (document) => {
      clearScheduledAnalysis(document);
      nextGeneration(document);
      diagnostics.delete(document.uri);
    },
  );

  const handleConfigurationChange = vscode.workspace.onDidChangeConfiguration(
    (event) => {
      if (!event.affectsConfiguration('testSmellDetector.analyzeOnSave')) {
        return;
      }

      for (const timer of scheduledAnalyses.values()) {
        clearTimeout(timer);
      }
      scheduledAnalyses.clear();
      for (const [key, generation] of analysisGenerations) {
        analysisGenerations.set(key, generation + 1);
      }
    },
  );

  context.subscriptions.push(
    analyzeCurrentFile,
    analyzeAfterSave,
    invalidateAfterChange,
    cleanUpClosedDocument,
    handleConfigurationChange,
    output,
    diagnostics,
    {
      dispose: () => {
        for (const timer of scheduledAnalyses.values()) {
          clearTimeout(timer);
        }
      },
    },
  );
}

/** VS Code disposes all extension resources registered during activation. */
export function deactivate(): void {}

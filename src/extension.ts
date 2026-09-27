import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  isLikelyJavaTestDocument,
  ProductionFileResolver,
} from './productionFileResolver';
import { runDetector } from './testSmellDetector';

const ANALYZE_CURRENT_FILE_COMMAND = 'testSmellDetector.analyzeCurrentFile';
const DIAGNOSTIC_SOURCE = 'Test Smell Detector';
const ANALYSIS_DEBOUNCE_MILLISECONDS = 500;

interface AnalysisRequest {
  generation: number;
  interactive: boolean;
}

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
        await vscode.window.showWarningMessage(
          `${fileName} is not recognized as a Java file.`,
        );
      }
      return;
    }

    if (document.uri.scheme !== 'file' || document.isUntitled) {
      if (request.interactive) {
        await vscode.window.showWarningMessage(
          `Save ${fileName} locally before analyzing it.`,
        );
      }
      return;
    }

    if (document.isDirty) {
      if (request.interactive) {
        await vscode.window.showWarningMessage(
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
          await vscode.window.showWarningMessage(
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
          createDiagnostics(document, result.detectedSmells),
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
          await vscode.window.showInformationMessage(
            `No test smells detected in ${fileName}.`,
          );
        } else {
          output.appendLine(
            `Detected smells (${result.detectedSmells.length}):`,
          );
          for (const smell of result.detectedSmells) {
            output.appendLine(`- ${smell}`);
          }
          output.show(true);
          const selection = await vscode.window.showWarningMessage(
            `${result.detectedSmells.length} test smell(s) detected in ${fileName}.`,
            'Open Problems',
          );
          if (selection === 'Open Problems') {
            await vscode.commands.executeCommand(
              'workbench.actions.view.problems',
            );
          }
        }
      } else {
        reportAutomaticMessage(
          `${fileName}: ${result.numberOfTestMethods} test method(s), ${result.detectedSmells.length} smell(s).`,
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
        await vscode.window.showErrorMessage(
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
    ({ document }) => {
      if (document.languageId !== 'java') {
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

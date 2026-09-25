import * as vscode from 'vscode';
import * as path from 'node:path';

import { runDetector } from './testSmellDetector';

// This ID must match the command contributed in package.json.
const ANALYZE_CURRENT_FILE_COMMAND = 'testSmellDetector.analyzeCurrentFile';

/**
 * VS Code calls activate the first time the contributed command is invoked.
 * This function owns the user-facing workflow; process execution stays in a
 * separate module so it can be tested without launching VS Code.
 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Test Smell Detector');
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

      if (document.uri.scheme !== 'file' || document.isUntitled) {
        await vscode.window.showWarningMessage(
          `Save ${fileName} locally before analyzing it.`,
        );
        return;
      }

      if (document.isDirty) {
        await vscode.window.showWarningMessage(
          `Save your changes to ${fileName} before analyzing it.`,
        );
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

      // tsDetect requires a test/production pair. Automatic matching can
      // replace this manual prompt in a future version.
      const productionFiles = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri:
          workspaceFolder?.uri ?? vscode.Uri.file(path.dirname(document.fileName)),
        filters: {
          'Java source files': ['java'],
        },
        openLabel: 'Use as production file',
        title: `Select the production file tested by ${fileName}`,
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

        // This MVP reports file-level results in an Output channel. Richer
        // source locations can later be converted into VS Code diagnostics.
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
          output.appendLine(`Detected smells (${result.detectedSmells.length}):`);
          for (const smell of result.detectedSmells) {
            output.appendLine(`- ${smell}`);
          }
          output.show(true);
          await vscode.window.showWarningMessage(
            `${result.detectedSmells.length} test smell(s) detected in ${fileName}.`,
          );
        }
      } catch (error: unknown) {
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

        await vscode.window.showErrorMessage(
          'Test smell analysis failed. See the Test Smell Detector output for details.',
        );
      }
    },
  );

  // VS Code disposes both resources automatically when the extension unloads.
  context.subscriptions.push(analyzeCurrentFile, output);
}

/** No explicit shutdown work is required for the command-based MVP. */
export function deactivate(): void {}

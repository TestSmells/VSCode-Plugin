import * as path from 'node:path';
import * as vscode from 'vscode';

// This ID must match the command contributed in package.json.
const ANALYZE_CURRENT_FILE_COMMAND = 'testSmellDetector.analyzeCurrentFile';

/**
 * VS Code calls activate the first time the contributed command is invoked.
 * This pre-integration prototype only validates and identifies the active Java
 * file; it does not contain or execute the tsDetect engine.
 */
export function activate(context: vscode.ExtensionContext): void {
  const analyzeCurrentFile = vscode.commands.registerCommand(
    ANALYZE_CURRENT_FILE_COMMAND,
    async () => {
      const editor = vscode.window.activeTextEditor;

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

      await vscode.window.showInformationMessage(
        `Ready to analyze ${fileName}. Detector integration is not included on this branch.`,
      );
    },
  );

  // VS Code disposes the command registration when the extension unloads.
  context.subscriptions.push(analyzeCurrentFile);
}

/** No explicit shutdown work is required for this command-based prototype. */
export function deactivate(): void {}

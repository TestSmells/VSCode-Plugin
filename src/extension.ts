// Import Node.js path tools so we can get a filename from a complete file path.
import * as path from 'node:path';

// Import the VS Code API so the extension can use editors, commands, and messages.
import * as vscode from 'vscode';

// Store the command's internal ID in one place to avoid repeating the string.
// This ID must exactly match the command declared in package.json.
const ANALYZE_CURRENT_FILE_COMMAND = 'testSmellDetector.analyzeCurrentFile';

// VS Code calls this activate function when the user first runs our command.
// The context object lets VS Code manage resources created by the extension.
export function activate(context: vscode.ExtensionContext): void {
  // Register the function that should run when the user selects our command.
  const analyzeCurrentFile = vscode.commands.registerCommand(
    // Tell VS Code which registered command this function belongs to.
    ANALYZE_CURRENT_FILE_COMMAND,

    // Use an async function because showing VS Code messages returns Promises.
    async () => {
      // Ask VS Code for the editor tab that the user is currently viewing.
      const editor = vscode.window.activeTextEditor;

      // Check whether the user has any text editor open.
      if (!editor) {
        // Show an error message when there is no active file to inspect.
        await vscode.window.showErrorMessage(
          // Explain what the user must do before running the command again.
          'Open a Java test file before running Test Smell Detector.',
        );

        // Stop this command because there is no file to inspect.
        return;
      }

      // Get the document object, which contains information about the open file.
      const { document } = editor;

      // Convert the full path into a short name such as CalculatorTest.java.
      const fileName = path.basename(document.fileName);

      // Make sure VS Code recognizes the active document as Java source code.
      if (document.languageId !== 'java') {
        // Warn the user that the selected file is not a Java file.
        await vscode.window.showWarningMessage(
          // Insert the current filename into the warning with a template string.
          `${fileName} is not recognized as a Java file.`,
        );

        // Stop because this prototype is intended for Java test files.
        return;
      }

      // Check that the Java document is a real local file and has been named.
      if (document.uri.scheme !== 'file' || document.isUntitled) {
        // Ask the user to save the new or non-local document before continuing.
        await vscode.window.showWarningMessage(
          // Include the filename so the message clearly identifies the document.
          `Save ${fileName} locally before analyzing it.`,
        );

        // Stop because a future detector will need a saved local file path.
        return;
      }

      // Check whether the document contains changes that have not been saved.
      if (document.isDirty) {
        // Ask the user to save so a future detector reads the newest code.
        await vscode.window.showWarningMessage(
          // Tell the user exactly which file still has unsaved changes.
          `Save your changes to ${fileName} before analyzing it.`,
        );

        // Stop until the document on disk matches the code visible in VS Code.
        return;
      }

      // Confirm that the active document passed every validation check.
      await vscode.window.showInformationMessage(
        // Explain that this branch validates the file but does not run tsDetect.
        `Ready to analyze ${fileName}. Detector integration is not included on this branch.`,
      );
    },
  );

  // Give the command registration to VS Code for automatic cleanup on shutdown.
  context.subscriptions.push(analyzeCurrentFile);
}

// VS Code calls deactivate when it unloads the extension.
// This function is empty because the prototype has no manual cleanup work.
export function deactivate(): void {}

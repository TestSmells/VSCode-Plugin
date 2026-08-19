# Test Smell Detector for VS Code

This branch contains the VS Code extension prototype from before the tsDetect
engine was integrated.

## Current prototype

The extension contributes one command:

- **Test Smell Detector: Analyze Current File**

The command validates the active editor and identifies a saved Java file. It
provides a clear message when there is no active editor, the active file is not
Java, or the file has unsaved changes.

This branch intentionally does not include:

- The compiled `tsdetect.jar`
- Temporary CSV generation or parsing
- Java child-process execution
- Production-file selection
- Test-smell result output

## Run locally

1. Run `npm install`.
2. Open this folder in VS Code.
3. Press `F5` to open an Extension Development Host.
4. Open a saved Java file in the new window.
5. Run **Test Smell Detector: Analyze Current File** from the Command Palette.

The extension will confirm that the Java file is ready, but it will not perform
test-smell analysis on this branch.

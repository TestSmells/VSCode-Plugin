# Test Smell Detector for VS Code

This repository contains a minimum VS Code extension prototype for integrating
the Java-based Test Smell Detector (`tsDetect`).

## Current prototype

The extension contributes one command:

- **Test Smell Detector: Analyze Current File**

The command validates the active editor, asks for the corresponding production
Java file, runs the bundled tsDetect engine, and publishes detected test smells
to both the **Test Smell Detector** Output panel and VS Code's **Problems**
panel.

Each detected smell is represented as a warning diagnostic. Because the
current tsDetect output reports smells at file level rather than exact source
locations, the warning is anchored to the Java test class name. VS Code also
shows a warning squiggle and its standard diagnostic hover at that location.

This first prototype uses tsDetect's existing file-pair input format, so the
production class must be selected manually. Automatic production-file matching
is outside the current scope.

## Requirements

- Java must be installed and available as `java` on the system path.
- The test and production Java files must be saved locally.

If Java is installed under a different executable path, set
`testSmellDetector.javaPath` in VS Code settings.

## Run locally

1. Run `npm install`.
2. Open this folder in VS Code.
3. Press `F5` to open an Extension Development Host.
4. In the new window, open a saved Java test file and keep it as the active
   editor.
5. Open the Command Palette and run **Test Smell Detector: Analyze Current
   File**.
6. Select the corresponding production Java file when prompted.
7. Review the detected smells in the **Problems** panel and the detailed run
   summary in the **Test Smell Detector** Output panel.

## Prototype limitations

- Analysis runs only when the command is invoked.
- The production file is selected manually.
- Results are reported at file level, so diagnostics mark the test class rather
  than the exact expression that caused a smell.

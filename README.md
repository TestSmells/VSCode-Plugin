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

The extension also performs incremental analysis when a Java test file is
saved. Only the saved test/production pair is analyzed, and only that test
file's diagnostics are refreshed. Automatic analysis can be disabled with the
`testSmellDetector.analyzeOnSave` setting.

Each detected smell is represented as a warning diagnostic. Because the
current tsDetect output reports smells at file level rather than exact source
locations, the warning is anchored to the Java test class name. VS Code also
shows a warning squiggle and its standard diagnostic hover at that location.

tsDetect uses a test/production file pair. The extension first remembers a
production file selected during a manual analysis. It can also match common
names such as `CalculatorTest.java` to `Calculator.java` and prefers files
under `src/main`. If an automatic run cannot find a match, run **Analyze Current
File** once and select the production file manually.

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
8. Modify and save the Java test file. The extension reruns tsDetect after a
   short delay and replaces that file's diagnostics automatically.

## Incremental analysis

- Runs only for saved local Java test files.
- Recognizes common test suffixes such as `Test`, `Tests`, `IT`, and `Spec`, as
  well as Java files under `src/test`.
- Waits briefly after a save to avoid redundant work.
- Serializes detector runs for the same file and ignores outdated results.
- Allows different test files to be analyzed independently.
- Removes stale diagnostics as soon as a Java file changes.
- Can be disabled through the `testSmellDetector.analyzeOnSave` setting.

## Prototype limitations

- Production-file matching follows common project and filename conventions;
  unusual project layouts may require one manual selection.
- Results are reported at file level, so diagnostics mark the test class rather
  than the exact expression that caused a smell.

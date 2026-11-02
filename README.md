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

Each detected smell is represented as a warning diagnostic. The extension maps
engine-confirmed method and class names to their Java declaration ranges. When
an exact declaration is unavailable, the warning falls back to the test class.
VS Code also shows a warning squiggle and its standard diagnostic hover at that
location.

tsDetect uses a test/production file pair. The extension first remembers a
production file selected during a manual analysis. It can also match common
names such as `CalculatorTest.java` to `Calculator.java` and prefers files
under `src/main`. If an automatic run cannot find a match, run **Analyze Current
File** once and select the production file manually.

## Requirements

- Java 11 or newer must be installed and available as `java` on the system
  path.
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

## Choose reported smells

Every supported smell is enabled by default. To choose which findings the
extension reports:

1. Open VS Code **Settings**.
2. Search for **Test Smell Detector**.
3. Under **Test Smell Detector > Smells**, check or clear individual smells.
4. Run **Analyze Current File** again, or save the test file when incremental
   analysis is enabled.

Disabled smells are filtered from the Problems panel, Output panel, editor
squiggles, hover messages, and result notification on the next analysis. The
bundled engine still evaluates the file, so changing these preferences does
not alter tsDetect itself.

## Detector execution and troubleshooting

Each detector process has a 60-second timeout by default. Change
`testSmellDetector.analysisTimeoutSeconds` in VS Code settings to a value from
1 through 600 seconds when a larger project needs more time. A process that
exceeds the limit is stopped so it cannot run indefinitely.

Manual analysis displays cancellable VS Code progress. Select **Cancel** in the
progress notification to stop Java and clear results from the cancelled run.
Starting a newer analysis for the same file also stops the older process and
prevents its results from being published.

Failures and cancellations clear that file's existing diagnostics. The Test
Smell Detector Output channel records the failure category, executable,
arguments, timeout, exit code, process signal, and captured standard output and
error. Missing-Java messages direct the user to install Java 11 or configure
`testSmellDetector.javaPath`; missing-JAR messages recommend reinstalling from
a complete VSIX package.

## Automated checks

The GitHub Actions workflow runs for pull requests targeting `main`, pushes to
`main`, and manual workflow runs. It installs dependencies with `npm ci`,
type-checks and compiles the TypeScript extension, compares all regression
fixtures with their expected tsDetect results, and builds an installable VSIX.

The same checks can be run locally with Node.js 22 or newer and Java 11 or
newer:

```sh
npm ci
npm run check
npm run compile
npm run test:preferences
npm run test:execution
npm run test:corpus
npm run package:vsix
```

The preference, execution-control, and corpus tests expect compiled files in
`out/`, so run `npm run compile` first. The packaging command creates
`test-smell-detector.vsix`. In GitHub Actions, that file is retained as the
`test-smell-detector-vsix` workflow artifact.

## Prototype limitations

- Production-file matching follows common project and filename conventions;
  unusual project layouts may require one manual selection.
- Diagnostics identify the affected method or class when tsDetect provides a
  confirmed element name. Some findings can only be shown at class or file
  level because the detector does not report the exact expression that caused
  the smell.

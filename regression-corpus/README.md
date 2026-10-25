# Shared tsDetect regression corpus

This directory is the versioned, shared input corpus for the VS Code and
Eclipse integrations. Both integrations should run the same Java source pairs
through the same tsDetect engine and compare their normalized results with
`expected-results.json`.

The corpus is intentionally stored in the VS Code repository. The Eclipse
workflow should check out a documented version of this repository and use this
directory instead of maintaining a separate copy.

## Directory layout

- `cases/` contains one small test/production source pair per scenario.
- `expected-results.json` records the normalized result for every scenario.
- `expected-results.schema.json` defines and documents the manifest format.

Each case is independent. Its `testFile` and `productionFile` paths are listed
in the manifest, so a runner must not rely on a particular Java project layout.
The source files are detector inputs rather than a runnable Java application;
JUnit libraries do not need to be installed to analyze them.

## Covered scenarios

The initial ten cases cover:

1. A known smell in JUnit 4.
2. A known smell in JUnit 5.
3. A small JUnit 5 test expected to be smell-free.
4. Several assertions without explanations.
5. A test method with no assertion.
6. Multiple tests that exercise the same production method.
7. The conventional `ClassNameTest.java` naming pattern.
8. The alternative `ClassNameIT.java` naming pattern.
9. Intentionally malformed Java input.
10. Valid source files stored in a path containing spaces.

Some cases cover more than one category. The expected manifest records what
the pinned detector actually reports, not what the fixture name alone implies.

## Normalized results

A corpus runner should normalize detector output before comparison:

- Report smell names exactly as they appear in the tsDetect CSV header.
- Remove duplicate smell names and sort them alphabetically.
- Store the number of discovered test methods as a non-negative integer.
- Store source paths relative to this repository with `/` separators.
- Ignore temporary paths, timestamps, progress text, and CSV column order.
- Convert a failed detector invocation into a stable error category. Do not
  compare machine-specific absolute paths or a complete stack trace.

`status: "success"` means the detector returned a result row. A success may
contain zero smells. `status: "error"` means the case is expected to fail in a
specific, documented way, such as rejecting malformed Java input.

## Pinned-engine compatibility notes

- The pinned engine counts a package-private JUnit 5 method as a test method,
  but its individual smell visitors only inspect public methods. Case 03 keeps
  this modern JUnit 5 style visible in the baseline instead of hiding it.
- A runner must use the manifest paths directly. In particular, it must not
  reject the `InventoryIT.java` case merely because its name does not end in
  `Test.java`.
- The malformed case currently fails with JavaParser's
  `ParseProblemException`. The normalized expectation records the stable error
  category and identifying exception name, not the temporary files or full
  stack trace.
- The expected smell lists are compatibility baselines for the pinned engine.
  They do not claim that every detector classification is semantically ideal.

## Adding or changing a case

1. Add a new directory under `cases/` containing one test file and its related
   production file.
2. Keep the source minimal so a failure is easy to understand.
3. Add one manifest entry with a unique ID and a short purpose.
4. Run the pinned detector and record its normalized result.
5. Validate `expected-results.json` against the schema.
6. Run the corpus through both IDE integrations before changing an expected
   result. Document any intentional difference instead of silently accepting
   it.

The malformed-input fixture is intentionally invalid Java and must not be
"fixed" by formatting or compilation tools.

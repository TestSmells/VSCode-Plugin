# Bundled tsDetect engine

`tsdetect.jar` is a local prototype build of
[TestSmells/TestSmellDetector](https://github.com/TestSmells/TestSmellDetector)
at commit `e89ce1a28d56db314d159e8957591aef6002173d`.

It was built as the Maven `jar-with-dependencies` artifact using Java 11. The
detector is licensed separately under GNU GPL version 3; see `LICENSE` in this
directory. Review the GPL source-distribution requirements before publishing
or distributing an extension package that contains this JAR.

`tsdetect-locations.jar` is the extension's small integration bridge. It calls
the bundled detector API, maps engine-confirmed method and class names to
JavaParser declaration ranges, and returns those findings to the TypeScript
adapter. Its source is kept in `java/LocationBridge.java`.

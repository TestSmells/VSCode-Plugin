import com.github.javaparser.JavaParser;
import com.github.javaparser.Range;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import java.io.File;
import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import testsmell.AbstractSmell;
import testsmell.SmellyElement;
import testsmell.TestClass;
import testsmell.TestFile;
import testsmell.TestMethod;
import testsmell.TestSmellDetector;
import testsmell.Util;
import thresholds.DefaultThresholds;

/**
 * Runs tsDetect and maps its smelly method or class names to JavaParser source
 * ranges. Ambiguous elements remain file-level findings instead of being
 * assigned to a declaration that may be incorrect.
 */
public final class LocationBridge {
    private static final String FORMAT_VERSION = "TSDETECT_LOCATIONS_V1";

    private LocationBridge() {}

    public static void main(String[] arguments) throws Exception {
        if (arguments.length != 4) {
            throw new IllegalArgumentException(
                "Expected application, test, production, and output paths."
            );
        }

        String applicationName = arguments[0];
        String testFilePath = arguments[1];
        String productionFilePath = arguments[2];
        Path outputPath = Path.of(arguments[3]);

        TestFile testFile = new TestFile(
            applicationName,
            testFilePath,
            productionFilePath
        );
        TestFile result = new TestSmellDetector(new DefaultThresholds())
            .detectSmells(testFile);
        CompilationUnit compilationUnit = JavaParser.parse(
            new File(testFilePath)
        );
        List<MethodDeclaration> methods = compilationUnit.getNodesByType(
            MethodDeclaration.class
        );
        List<TypeDeclaration> types = compilationUnit.getNodesByType(
            TypeDeclaration.class
        );

        try (
            Writer output = Files.newBufferedWriter(
                outputPath,
                StandardCharsets.UTF_8
            )
        ) {
            writeRow(
                output,
                FORMAT_VERSION,
                String.valueOf(result.getNumberOfTestMethods())
            );

            for (AbstractSmell smell : result.getTestSmells()) {
                if (smell == null || !smell.hasSmell()) {
                    continue;
                }

                boolean wroteFinding = false;
                for (SmellyElement element : smell.getSmellyElements()) {
                    if (element == null || !element.isSmelly()) {
                        continue;
                    }

                    wroteFinding = true;
                    writeFinding(output, smell.getSmellName(), element, methods, types);
                }

                if (!wroteFinding) {
                    writeFinding(output, smell.getSmellName(), "file", "", null);
                }
            }
        }
    }

    private static void writeFinding(
        Writer output,
        String smellName,
        SmellyElement element,
        List<MethodDeclaration> methods,
        List<TypeDeclaration> types
    ) throws IOException {
        String elementName = element.getElementName();
        List<Node> matches = new ArrayList<>();
        String scope = "file";

        if (element instanceof TestMethod) {
            for (MethodDeclaration method : methods) {
                if (
                    method.getNameAsString().equals(elementName)
                    && Util.isValidTestMethod(method)
                ) {
                    matches.add(method.getName());
                }
            }
            if (matches.size() == 1) {
                scope = "method";
            }
        } else if (element instanceof TestClass) {
            for (TypeDeclaration type : types) {
                if (type.getNameAsString().equals(elementName)) {
                    matches.add(type.getName());
                }
            }
            if (matches.size() == 1) {
                scope = "class";
            }
        }

        Node matchedNode = matches.size() == 1 ? matches.get(0) : null;
        writeFinding(output, smellName, scope, elementName, matchedNode);
    }

    private static void writeFinding(
        Writer output,
        String smellName,
        String scope,
        String elementName,
        Node node
    ) throws IOException {
        Optional<Range> range = node == null
            ? Optional.empty()
            : node.getRange();

        if (range.isEmpty()) {
            writeRow(output, smellName, "file", elementName, "", "", "", "");
            return;
        }

        Range sourceRange = range.get();
        writeRow(
            output,
            smellName,
            scope,
            elementName,
            String.valueOf(sourceRange.begin.line),
            String.valueOf(sourceRange.begin.column),
            String.valueOf(sourceRange.end.line),
            String.valueOf(sourceRange.end.column + 1)
        );
    }

    private static void writeRow(Writer output, String... values)
        throws IOException {
        for (int index = 0; index < values.length; index += 1) {
            if (index > 0) {
                output.write(',');
            }
            output.write('"');
            output.write(values[index].replace("\"", "\"\""));
            output.write('"');
        }
        output.write('\n');
    }
}
